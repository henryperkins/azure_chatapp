"""
services/file_storage.py

Purpose: Abstracts file storage operations
Features:
    Supports local, Azure Blob, and AWS S3
    backends, Conditional imports for optional
    cloud dependencies, Consistent interface
    for saving, retrieving, and deleting files
"""

import os
import hashlib
import logging
import tempfile
from pathlib import Path
from io import IOBase
from typing import Any, Optional, Union, cast, BinaryIO
from uuid import UUID

# Local imports
from config import settings
from utils.serializers import serialize_uuid

logger = logging.getLogger(__name__)

# ----------------------------------------------------
# Conditional imports for Azure, S3.
# We define them here so they're never unbound.
# ----------------------------------------------------
AZURE_AVAILABLE = True
AWS_AVAILABLE = True

BlobServiceClient = None
ContentSettings = None
boto3 = None

try:
    # Async Azure library
    from azure.storage.blob.aio import BlobServiceClient as AzureBlobServiceClient
    from azure.storage.blob import ContentSettings as AzureContentSettings
except ImportError:
    AZURE_AVAILABLE = False
else:
    BlobServiceClient = AzureBlobServiceClient
    ContentSettings = AzureContentSettings

try:
    import boto3 as Boto3
except ImportError:
    AWS_AVAILABLE = False
else:
    boto3 = Boto3

# ----------------------------------------------------
# Define a clear union for the file content
# ----------------------------------------------------
FileContent = Union[bytes, bytearray, memoryview, BinaryIO]


def ensure_bytes(file_content: FileContent) -> bytes:
    """
    Convert various input types to raw bytes:
    - bytes, bytearray, memoryview => direct conversion
    - file-like objects => read from them
    """
    if isinstance(file_content, (bytes, bytearray, memoryview)):
        return bytes(file_content)  # memoryview/bytearray -> bytes

    # If it's a file-like object
    # (BinaryIO typically extends IOBase, but checking IOBase is more general)
    if isinstance(file_content, IOBase):
        content = file_content.read()
        if not isinstance(content, bytes):
            raise TypeError("File-like object did not return bytes when read()")
        # Reset pointer if seekable
        if file_content.seekable():
            file_content.seek(0)
        return content

    raise TypeError(
        "file_content must be bytes-like or a file-like object returning bytes"
    )


def format_bytes(size: float) -> str:
    """Format bytes to human-readable string (matches frontend exactly)."""
    if size < 1024:
        return f"{int(size)} Bytes"
    units = ["KB", "MB", "GB", "TB"]
    for unit in units:
        size /= 1024.0
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f} {unit}"
    return f"{size:.1f} {units[-1]}"


class FileStorage:
    """
    Handles storage operations for files, supporting local and cloud (Azure, S3).
    """

    def __init__(
        self,
        storage_type: str = "local",
        local_path: str = "./uploads",
        azure_connection_string: Optional[str] = None,
        azure_container_name: Optional[str] = None,
        aws_access_key: Optional[str] = None,
        aws_secret_key: Optional[str] = None,
        aws_bucket_name: Optional[str] = None,
        aws_region: Optional[str] = None,
    ):
        self.storage_type = storage_type.lower()

        # ----- Local -----
        if self.storage_type == "local":
            self.local_path = Path(local_path)
            self.local_path.mkdir(parents=True, exist_ok=True)

        # ----- Azure -----
        elif self.storage_type == "azure":
            if not AZURE_AVAILABLE:
                raise ImportError(
                    "Azure storage dependencies not installed. "
                    "Install with 'pip install azure-storage-blob'"
                )
            if not azure_connection_string or not azure_container_name:
                raise ValueError(
                    "Must provide azure_connection_string and azure_container_name."
                )

            # Import directly to ensure we have the correct class
            from azure.storage.blob.aio import BlobServiceClient

            self.blob_service_client = BlobServiceClient.from_connection_string(
                azure_connection_string
            )
            self.azure_container_name = azure_container_name
            self.container_client = self.blob_service_client.get_container_client(
                azure_container_name
            )

        # ----- AWS S3 -----
        elif self.storage_type == "s3":
            if not AWS_AVAILABLE:
                raise ImportError(
                    "AWS dependencies not installed. Install with 'pip install boto3'"
                )
            if not all([aws_access_key, aws_secret_key, aws_bucket_name, aws_region]):
                raise ValueError("Must provide AWS credentials, bucket, and region.")

            self.aws_bucket_name = aws_bucket_name
            self.s3_client = cast(Any, boto3).client(
                "s3",
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region,
            )
        else:
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def save_file(
        self,
        file_content: FileContent,
        filename: str,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        project_id: Optional[UUID] = None,
    ) -> str:
        """
        Save the file_content to the configured storage and return the file path or URL.
        """
        # Convert content to bytes
        content = ensure_bytes(file_content)

        # Create a hash-based prefix
        file_hash = hashlib.sha256(content).hexdigest()[:12]
        prefix = serialize_uuid(project_id) if project_id else None
        storage_filename = (
            f"{prefix}_{file_hash}_{filename}" if prefix else f"{file_hash}_{filename}"
        )

        if self.storage_type == "local":
            return await self._save_bytes_local(content, storage_filename)
        elif self.storage_type == "azure":
            return await self._save_bytes_azure(
                content, storage_filename, content_type, metadata
            )
        elif self.storage_type == "s3":
            return await self._save_bytes_s3(
                content, storage_filename, content_type, metadata
            )
        else:
            raise ValueError(f"Unsupported storage type: {self.storage_type}")

    async def _save_bytes_local(self, content: bytes, filename: str) -> str:
        # Ensure directory exists - including any nested directories
        file_path = Path(self.local_path) / filename
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with file_path.open("wb") as f:
            f.write(content)
            f.flush()
        # Optional verification code (commented out):
        # with file_path.open("rb") as verify_f:
        #     if verify_f.read() != content:
        #         raise IOError("File write verification failed")
        return str(file_path)

    async def _save_bytes_azure(
        self,
        content: bytes,
        filename: str,
        content_type: Optional[str],
        metadata: Optional[dict[str, Any]],
    ) -> str:
        from azure.storage.blob import ContentSettings as AzureContentSettings

        blob_client = self.container_client.get_blob_client(filename)

        content_settings = None
        if content_type:
            content_settings = AzureContentSettings(content_type=content_type)

        # Convert metadata values to strings as required by Azure
        str_metadata = {k: str(v) for k, v in (metadata or {}).items()}

        await blob_client.upload_blob(
            content,
            overwrite=True,
            content_settings=content_settings,
            metadata=str_metadata,
        )
        return f"azure://{self.azure_container_name}/{filename}"

    async def _save_bytes_s3(
        self,
        content: bytes,
        filename: str,
        content_type: Optional[str],
        metadata: Optional[dict[str, Any]],
    ) -> str:
        import asyncio

        extra_args: dict[str, Any] = {}
        if content_type:
            extra_args["ContentType"] = content_type
        if metadata:
            extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

        # Write to temp file to use .upload_file (sync)
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(content)
            temp_file_path = temp_file.name

        try:
            # Wrap sync call in a thread for non-blocking
            await asyncio.to_thread(
                self.s3_client.upload_file,
                temp_file_path,
                self.aws_bucket_name,
                filename,
                ExtraArgs=extra_args,
            )
        finally:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)

        return f"s3://{self.aws_bucket_name}/{filename}"

    async def get_file(self, file_path: str) -> bytes:
        """
        Retrieve file content from storage. Return as bytes.
        """
        # ----- Local -----
        if self.storage_type == "local":
            if os.path.exists(file_path):
                return Path(file_path).read_bytes()
            raise FileNotFoundError(f"Local file not found: {file_path}")

        # ----- Azure -----
        elif self.storage_type == "azure" and file_path.startswith("azure://"):
            parts = file_path.replace("azure://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.azure_container_name:
                raise ValueError(f"Invalid Azure blob URL: {file_path}")
            blob_name = parts[1]
            blob_client = self.container_client.get_blob_client(blob_name)
            download = await blob_client.download_blob()
            return await download.readall()

        # ----- S3 -----
        elif self.storage_type == "s3" and file_path.startswith("s3://"):
            import asyncio

            parts = file_path.replace("s3://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.aws_bucket_name:
                raise ValueError(f"Invalid S3 URL: {file_path}")
            s3_key = parts[1]

            with tempfile.NamedTemporaryFile() as temp_file:
                await asyncio.to_thread(
                    self.s3_client.download_fileobj,
                    self.aws_bucket_name,
                    s3_key,
                    temp_file,
                )
                temp_file.seek(0)
                return temp_file.read()

        else:
            raise ValueError(f"Unsupported or invalid file path format: {file_path}")

    async def delete_file(self, file_path: str) -> bool:
        """
        Delete a file from storage, returning True if it was deleted,
        or False if it did not exist (or was invalid).
        """
        # ----- Local -----
        if self.storage_type == "local":
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    return True
                except FileNotFoundError:
                    return False
                except Exception as e:
                    logger.error(f"Error deleting local file {file_path}: {e}")
                    raise
            else:
                return False

        # ----- Azure -----
        elif self.storage_type == "azure" and file_path.startswith("azure://"):
            parts = file_path.replace("azure://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.azure_container_name:
                raise ValueError(f"Invalid Azure blob URL: {file_path}")
            blob_name = parts[1]
            blob_client = self.container_client.get_blob_client(blob_name)
            try:
                await blob_client.delete_blob()
                return True
            except Exception as e:
                logger.error(f"Error deleting Azure blob {blob_name}: {e}")
                return False

        # ----- S3 -----
        elif self.storage_type == "s3" and file_path.startswith("s3://"):
            import asyncio

            parts = file_path.replace("s3://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.aws_bucket_name:
                raise ValueError(f"Invalid S3 URL: {file_path}")
            s3_key = parts[1]
            try:
                await asyncio.to_thread(
                    self.s3_client.delete_object,
                    Bucket=self.aws_bucket_name,
                    Key=s3_key,
                )
                return True
            except Exception as e:
                logger.error(f"Error deleting S3 object {s3_key}: {e}")
                return False

        else:
            return False


# ----------------------------------------------------
# Configuration & Helpers
# ----------------------------------------------------
async def get_storage_config() -> dict[str, Any]:
    """
    Return standard config from your 'settings' object or environment.
    Adjust attribute names as needed for your environment.
    """
    return {
        "storage_type": getattr(settings, "FILE_STORAGE_TYPE", "local"),
        "local_path": getattr(settings, "LOCAL_UPLOADS_DIR", "./uploads"),
        "azure_connection_string": getattr(
            settings, "AZURE_STORAGE_CONNECTION_STRING", None
        ),
        "azure_container_name": getattr(settings, "AZURE_STORAGE_CONTAINER", None),
        "aws_access_key": getattr(settings, "AWS_ACCESS_KEY", None),
        "aws_secret_key": getattr(settings, "AWS_SECRET_KEY", None),
        "aws_bucket_name": getattr(settings, "AWS_BUCKET_NAME", None),
        "aws_region": getattr(settings, "AWS_REGION", None),
    }


def get_file_storage(config: dict[str, Any]) -> FileStorage:
    """
    Create a FileStorage instance based on config dictionary.
    """
    return FileStorage(**config)


# ----------------------------------------------------
# Simpler top-level functions
# ----------------------------------------------------
async def save_file_to_storage(
    file_content: FileContent, filename: str, project_id: Optional[UUID] = None
) -> str:
    """
    Convenience function to save a file using the global config.
    """
    config = await get_storage_config()
    storage = get_file_storage(config)
    return await storage.save_file(file_content, filename, project_id=project_id)


async def get_file_from_storage(file_path: str) -> bytes:
    """
    Convenience function to retrieve a file as bytes.
    """
    config = await get_storage_config()
    storage = get_file_storage(config)
    return await storage.get_file(file_path)


async def delete_file_from_storage(file_path: str) -> bool:
    """
    Convenience function to delete a file from storage.
    """
    config = await get_storage_config()
    storage = get_file_storage(config)
    return await storage.delete_file(file_path)

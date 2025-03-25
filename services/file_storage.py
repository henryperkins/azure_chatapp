"""
file_storage.py
--------------
Service for handling file storage operations with both local and cloud options.
Provides abstraction layer between storage mechanisms and application logic.
"""
import os
import logging
import hashlib
import tempfile
from typing import Optional, Dict, Any, BinaryIO, Union, IO  # noqa: F401
import httpx
from uuid import UUID
from utils.serializers import serialize_uuid
from azure.storage.blob import ContentSettings 
# Cloud storage import conditionals to avoid hard dependencies
try:
    from azure.storage.blob import BlobServiceClient
    AZURE_AVAILABLE = True
except ImportError:
    AZURE_AVAILABLE = False

try:
    import boto3
    AWS_AVAILABLE = True
except ImportError:
    AWS_AVAILABLE = False

logger = logging.getLogger(__name__)

class FileStorage:
    """
    Handles storage operations for files, supporting both local and cloud storage.
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
        aws_region: Optional[str] = None
    ):
        """
        Initialize storage service based on selected type.
        
        Args:
            storage_type: Storage backend ('local', 'azure', or 's3')
            local_path: Path for local file storage if using 'local'
            azure_*: Azure Blob Storage parameters
            aws_*: AWS S3 storage parameters
        """
        self.storage_type = storage_type.lower()
        
        # Initialize local storage
        if self.storage_type == "local":
            self.local_path = local_path
            os.makedirs(local_path, exist_ok=True)
            
        # Initialize Azure Blob Storage
        elif self.storage_type == "azure":
            if not AZURE_AVAILABLE:
                raise ImportError("Azure storage dependencies not installed. Install with 'pip install azure-storage-blob'")
            if not azure_connection_string or not azure_container_name:
                raise ValueError("Azure connection string and container name are required for Azure storage")
            self.azure_connection_string = azure_connection_string
            self.azure_container_name = azure_container_name
            self.blob_service_client = BlobServiceClient.from_connection_string(azure_connection_string)  # type: ignore
            self.container_client = self.blob_service_client.get_container_client(azure_container_name)
            
        # Initialize AWS S3
        elif self.storage_type == "s3":
            if not AWS_AVAILABLE:
                raise ImportError("AWS dependencies not installed. Install with 'pip install boto3'")
            if not all([aws_access_key, aws_secret_key, aws_bucket_name, aws_region]):
                raise ValueError("AWS access key, secret key, bucket name and region are required for S3 storage")
            self.aws_bucket_name = aws_bucket_name
            self.s3_client = boto3.client(  # type: ignore
                's3',
                aws_access_key_id=aws_access_key,
                aws_secret_access_key=aws_secret_key,
                region_name=aws_region
            )
        else:
            # This handles any storage_type not caught by previous conditions
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def save_file(
        self, 
        file_content: bytes | BinaryIO, 
        filename: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
        project_id: UUID | None = None
    ) -> str:
        """
        Save a file to the configured storage.
        
        Args:
            file_content: File content as bytes or file-like object
            filename: Name of the file
            content_type: MIME content type
            metadata: Optional metadata to store with the file
            project_id: Optional project ID for organization
            
        Returns:
            Storage path or URL where the file is stored
        """
        # Generate file hash for uniqueness
        content_to_save = None
        
        # Better handling of different input types
        if isinstance(file_content, bytes):
            file_hash = hashlib.sha256(file_content).hexdigest()[:12]
            content_to_save = file_content
        elif hasattr(file_content, 'read') and callable(getattr(file_content, 'read')):
            # It's a file-like object with a read method
            content_to_save = file_content.read()
            file_hash = hashlib.sha256(content_to_save).hexdigest()[:12]
            file_content.seek(0)  # Reset file pointer
        else:
            # Try to convert other bytes-like objects (bytearray, memoryview)
            try:
                content_to_save = bytes(file_content)  # type: ignore
                file_hash = hashlib.sha256(content_to_save).hexdigest()[:12]
            except TypeError:
                raise TypeError("file_content must be bytes-like or a file-like object")
        
        # Create a storage-specific filename/path with project id for better organization
        storage_filename = f"{serialize_uuid(project_id)}_{file_hash}_{filename}" if project_id else f"{file_hash}_{filename}"
                
        # Local storage implementation
        if self.storage_type == "local":
            file_path = os.path.join(self.local_path, storage_filename)
            
            # Write the file with checksum validation
            with open(file_path, "wb") as f:
                if isinstance(file_content, bytes):
                    f.write(file_content)
                    # Verify write integrity
                    f.flush()
                    with open(file_path, "rb") as verify_f:
                        written = verify_f.read()
                        if written != file_content:
                            raise IOError("File write verification failed")
                else:
                    # If it's already been read for the hash, use the cached content
                    if content_to_save:
                        f.write(content_to_save) 
                    else:
                        # Otherwise, read and write in chunks for larger files
                        chunk = file_content.read(8192)
                        while chunk:
                            f.write(chunk)
                            chunk = file_content.read(8192)
            
            return file_path
            
        # Azure Blob Storage implementation
        elif self.storage_type == "azure":
            blob_client = self.container_client.get_blob_client(storage_filename)
            
            # Set content settings if provided
            content_settings = None
            if content_type:
                content_settings = ContentSettings(content_type=content_type)
            
            # Convert metadata values to strings as required by Azure
            str_metadata = {k: str(v) for k, v in (metadata or {}).items()}
            
            # Upload the content
            if isinstance(file_content, bytes):
                await blob_client.upload_blob(
                    file_content, 
                    overwrite=True,
                    content_settings=content_settings,
                    metadata=str_metadata
                )
            else:
                # If it's a file-like object
                await blob_client.upload_blob(
                    file_content, 
                    overwrite=True,
                    content_settings=content_settings,
                    metadata=str_metadata
                )
                
            return f"azure://{self.azure_container_name}/{storage_filename}"
            
        # AWS S3 implementation
        elif self.storage_type == "s3":
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
            if metadata:
                extra_args['Metadata'] = {k: str(v) for k, v in metadata.items()}
            
            # For S3, we need to create a temp file if we have a bytes object
            if isinstance(file_content, bytes):
                with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                    temp_file.write(file_content)
                    temp_file_path = temp_file.name
                
                try:
                    # Upload from the temp file
                    self.s3_client.upload_file(
                        temp_file_path, 
                        self.aws_bucket_name, 
                        storage_filename,
                        ExtraArgs=extra_args
                    )
                finally:
                    # Clean up the temp file
                    if os.path.exists(temp_file_path):
                        os.unlink(temp_file_path)
            else:
                # Upload directly from file-like object
                self.s3_client.upload_fileobj(
                    file_content, 
                    self.aws_bucket_name, 
                    storage_filename,
                    ExtraArgs=extra_args
                )
                
            return f"s3://{self.aws_bucket_name}/{storage_filename}"

    async def get_file(self, file_path: str) -> bytes:
        """
        Retrieve file content from storage.
        
        Args:
            file_path: Path or URL where the file is stored
            
        Returns:
            File content as bytes
        """
        # Local storage
        if self.storage_type == "local" or os.path.exists(file_path):
            with open(file_path, "rb") as f:
                return f.read()
                
        # Azure Blob Storage
        elif self.storage_type == "azure" and file_path.startswith("azure://"):
            # Extract container and blob name from the URL
            parts = file_path.replace("azure://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.azure_container_name:
                raise ValueError(f"Invalid Azure blob URL: {file_path}")
            
            blob_name = parts[1]
            blob_client = self.container_client.get_blob_client(blob_name)
            
            # Download the blob
            download = await blob_client.download_blob()
            return await download.readall()
            
        # AWS S3
        elif self.storage_type == "s3" and file_path.startswith("s3://"):
            # Extract bucket and key from the URL
            parts = file_path.replace("s3://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.aws_bucket_name:
                raise ValueError(f"Invalid S3 URL: {file_path}")
            
            s3_key = parts[1]
            
            # Download to a temporary file
            with tempfile.NamedTemporaryFile() as temp_file:
                self.s3_client.download_fileobj(
                    self.aws_bucket_name,
                    s3_key,
                    temp_file
                )
                temp_file.seek(0)
                return temp_file.read()
                
        # Handle other URLs (http/https) for flexibility
        elif file_path.startswith(("http://", "https://")):
            async with httpx.AsyncClient() as client:
                response = await client.get(file_path)
                response.raise_for_status()
                return response.content
                
        else:
            raise ValueError(f"Unsupported file path format: {file_path}")

    async def delete_file(self, file_path: str) -> bool:
        """
        Delete a file from storage.
        
        Args:
            file_path: Path or URL where the file is stored
            
        Returns:
            True if the file was deleted, False if it didn't exist
        """
        # Local storage
        if self.storage_type == "local" or os.path.exists(file_path):
            try:
                os.remove(file_path)
                return True
            except FileNotFoundError:
                return False
            except Exception as e:
                logger.error(f"Error deleting local file {file_path}: {e}")
                raise
                
        # Azure Blob Storage
        elif self.storage_type == "azure" and file_path.startswith("azure://"):
            # Extract container and blob name from the URL
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
                
        # AWS S3
        elif self.storage_type == "s3" and file_path.startswith("s3://"):
            # Extract bucket and key from the URL
            parts = file_path.replace("s3://", "").split("/", 1)
            if len(parts) != 2 or parts[0] != self.aws_bucket_name:
                raise ValueError(f"Invalid S3 URL: {file_path}")
            
            s3_key = parts[1]
            
            try:
                self.s3_client.delete_object(
                    Bucket=self.aws_bucket_name,
                    Key=s3_key
                )
                return True
            except Exception as e:
                logger.error(f"Error deleting S3 object {s3_key}: {e}")
                return False
                
        else:
            raise ValueError(f"Unsupported file path format: {file_path}")

# Factory function to create a FileStorage instance based on configuration
def get_file_storage(config: dict[str, Any]) -> FileStorage:
    """
    Create and configure a FileStorage instance based on configuration.
    
    Args:
        config: Configuration dictionary with storage settings
        
    Returns:
        Configured FileStorage instance
    """
    storage_type = config.get("storage_type", "local")
    
    if storage_type == "local":
        return FileStorage(
            storage_type="local",
            local_path=config.get("local_path", "./uploads")
        )
    elif storage_type == "azure":
        return FileStorage(
            storage_type="azure",
            azure_connection_string=config.get("azure_connection_string"),
            azure_container_name=config.get("azure_container_name")
        )
    elif storage_type == "s3":
        return FileStorage(
            storage_type="s3",
            aws_access_key=config.get("aws_access_key"),
            aws_secret_key=config.get("aws_secret_key"),
            aws_bucket_name=config.get("aws_bucket_name"),
            aws_region=config.get("aws_region")
        )
    else:
        raise ValueError(f"Unsupported storage type: {storage_type}")


# Simple helper functions for direct use in routes
async def save_file_to_storage(
    file_content: bytes | BinaryIO, 
    filename: str, 
    project_id: UUID | None = None
) -> str:
    """
    Simplified function to save a file to storage.
    Uses the local storage option by default.
    """
    storage = FileStorage(storage_type="local")
    return await storage.save_file(file_content, filename, project_id=project_id)

async def get_file_from_storage(file_path: str) -> bytes:
    """
    Simplified function to retrieve a file from storage.
    """
    storage = FileStorage(storage_type="local")
    return await storage.get_file(file_path)

async def delete_file_from_storage(file_path: str) -> bool:
    """
    Simplified function to delete a file from storage.
    """
    storage = FileStorage(storage_type="local")
    return await storage.delete_file(file_path)

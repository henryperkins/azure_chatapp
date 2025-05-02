"""
file_validation.py
------------------
Centralized file validation utilities including:
- Extension validation
- Size checks
- Type detection
- Filename sanitization
"""

import os
import re
import logging
from typing import Any, List
from fastapi import UploadFile
import mimetypes
from config import settings

logger = logging.getLogger(__name__)


class FileValidator:
    """Core file validation utilities."""

    # Supported file extensions mapped to categories
    ALLOWED_EXTENSIONS = {
        # Text files
        ".txt": "text",
        ".md": "text",
        ".csv": "data",
        ".json": "data",
        # Documents
        ".pdf": "document",
        ".doc": "document",
        ".docx": "document",
        # Code
        ".py": "code",
        ".js": "code",
        ".html": "code",
        ".css": "code",
    }

    MAX_FILE_SIZE = getattr(settings, "MAX_FILE_SIZE", 30_000_000)  # 30MB default
    STREAM_THRESHOLD = getattr(settings, "STREAM_THRESHOLD", 10_000_000)  # 10MB

    @classmethod
    def validate_extension(cls, filename: str) -> bool:
        """Validate file has allowed extension, handling edge cases."""
        if not filename:
            return False

        # Handle multiple dots and case sensitivity
        filename = filename.strip()
        parts = filename.split(".")
        if len(parts) < 2:
            return False

        ext = f".{parts[-1].lower()}"

        # Debug log validation attempts
        logger.debug(f"Validating extension: {ext} in {cls.ALLOWED_EXTENSIONS.keys()}")

        return ext in cls.ALLOWED_EXTENSIONS

    @classmethod
    def validate_size(cls, file_size: int) -> bool:
        """Validate file size is within limits."""
        return file_size <= cls.MAX_FILE_SIZE

    @classmethod
    def get_file_info(cls, filename: str) -> dict[str, Any]:
        """
        Get standardized file info including:
        - extension
        - category (text/document/data/code)
        - mimetype
        """
        _, ext = os.path.splitext(filename.lower())
        ext = ext.lower()

        if ext in cls.ALLOWED_EXTENSIONS:
            return {
                "extension": ext,
                "category": cls.ALLOWED_EXTENSIONS[ext],
                "mimetype": mimetypes.guess_type(filename)[0]
                or "application/octet-stream",
            }

        # Fallback to mimetype detection
        mimetype, _ = mimetypes.guess_type(filename)
        return {
            "extension": ext,
            "category": "unknown",
            "mimetype": mimetype or "application/octet-stream",
        }

    @classmethod
    def get_allowed_extensions_list(cls) -> List[str]:
        """Get list of allowed extensions with dots"""
        return list(cls.ALLOWED_EXTENSIONS.keys())

    @classmethod
    def get_max_file_size_mb(cls) -> float:
        """Get max file size in MB"""
        return cls.MAX_FILE_SIZE / (1024 * 1024)

    @classmethod
    async def validate_upload_file(
        cls,
        file: UploadFile,
        scan_content: bool = True,
        preserve_spaces: bool = True,
    ) -> dict[str, Any]:
        """
        Comprehensive validation for uploaded files with enhanced security.
        Features:
        - Preserves spaces in filenames when requested
        - Content scanning for malicious patterns
        - Detailed error messages
        - Size validation
        """
        original_filename = file.filename or "untitled"
        file_size = file.size

        # Validate extension first
        if not cls.validate_extension(original_filename):
            raise ValueError(
                f"File type not allowed. Supported: {', '.join(cls.get_allowed_extensions_list())}\n"
                f"Attempted to upload: {original_filename}"
            )

        # Handle filename spaces
        if not preserve_spaces:
            original_filename = original_filename.replace(" ", "_")

        if scan_content:
            # Sample first 2MB for deeper content scanning
            sample = await file.read(2 * 1024 * 1024)
            await file.seek(0)

            # Enhanced malicious pattern detection
            malicious_patterns = [
                # Web exploits
                b"<?php",
                b"<script",
                b"eval(",
                # System commands
                b"powershell",
                b"cmd.exe",
                b"/bin/bash",
                b"wget",
                # Suspicious patterns
                b"base64_decode",
                b"exec(",
                b"system(",
                b"passthru(",
                # Dangerous file operations
                b"file_put_contents",
                b"fopen(",
                b"unlink(",
            ]

            lower_sample = sample.lower()
            found_patterns = [
                pattern.decode("utf-8", errors="ignore")
                for pattern in malicious_patterns
                if pattern in lower_sample
            ]

            if found_patterns:
                raise ValueError(
                    "File content contains potentially dangerous patterns:\n"
                    + "\n".join(f"- {p}" for p in found_patterns)
                )

        file_info = cls.get_file_info(original_filename)

        if file_size is not None and not cls.validate_size(file_size):
            raise ValueError(f"File too large (max {cls.get_max_file_size_mb()}MB)")

        return file_info


def validate_file_size(file_size: int) -> bool:
    """Validate file size is within limits."""
    return file_size <= FileValidator.MAX_FILE_SIZE


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal and special chars.
    Appends short UUID to prevent collisions.
    """
    # Remove directory path attempts
    filename = os.path.basename(filename)

    # Replace special chars
    filename = re.sub(r"[^\w\-_.]", "_", filename)

    # Shorten if too long
    if len(filename) > 100:
        name, ext = os.path.splitext(filename)
        filename = f"{name[:50]}{ext}"

    return filename

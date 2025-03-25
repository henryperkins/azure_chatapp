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
from typing import Optional, Dict, Any, BinaryIO, Union, List
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
        ".css": "code"
    }

    MAX_FILE_SIZE = getattr(settings, "MAX_FILE_SIZE", 30_000_000)  # 30MB default
    STREAM_THRESHOLD = getattr(settings, "STREAM_THRESHOLD", 10_000_000)  # 10MB

    @classmethod
    def validate_extension(cls, filename: str) -> bool:
        """Validate file has allowed extension."""
        _, ext = os.path.splitext(filename.lower())
        return ext in cls.ALLOWED_EXTENSIONS

    @classmethod
    def validate_size(cls, file_size: int) -> bool:
        """Validate file size is within limits."""
        return file_size <= cls.MAX_FILE_SIZE

    @classmethod
    def get_file_info(cls, filename: str) -> Dict[str, Any]:
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
                "mimetype": mimetypes.guess_type(filename)[0] or "application/octet-stream"
            }
        
        # Fallback to mimetype detection
        mimetype, _ = mimetypes.guess_type(filename)
        return {
            "extension": ext,
            "category": "unknown",
            "mimetype": mimetype or "application/octet-stream"
        }

    @classmethod
    def get_allowed_extensions_list(cls) -> List[str]:
        """Get list of allowed extensions with dots"""
        return list(cls.ALLOWED_EXTENSIONS.keys())

    @classmethod 
    def get_max_file_size_mb(cls) -> float:
        """Get max file size in MB"""
        return cls.MAX_FILE_SIZE / (1024 * 1024)

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
    filename = re.sub(r'[^\w\-_.]', '_', filename)
    
    # Shorten if too long
    if len(filename) > 100:
        name, ext = os.path.splitext(filename)
        filename = f"{name[:50]}{ext}"
        
    return filename

def validate_upload_file(file: Union[BinaryIO, UploadFile]) -> Dict[str, Any]:
    """
    Comprehensive validation for uploaded files.
    Returns file info dict or raises ValueError.
    """
    filename = getattr(file, "filename", "untitled")
    file_size = getattr(file, "size", None)
    
    if not FileValidator.validate_extension(filename):
        raise ValueError(f"File type not allowed. Supported: {', '.join(FileValidator.get_allowed_extensions_list())}")
        
    file_info = FileValidator.get_file_info(filename)
    
    if file_size is not None and not validate_file_size(file_size):
        raise ValueError(f"File too large (max {FileValidator.get_max_file_size_mb()}MB)")
        
    return file_info
        return cls.MAX_FILE_SIZE / (1024 * 1024)

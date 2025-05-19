```python
"""
file_upload_schemas.py
----------------------
Contains Pydantic models used by file_upload.py for describing upload responses, etc.
"""

from pydantic import BaseModel, Field
from typing import Optional

class FileUploadResponse(BaseModel):
    """
    Response schema for a successful file creation (upload).
    Mirrors key aspects from Azure's REST response.
    """
    file_id: str
    filename: str
    purpose: str
    created_at: int
    status: str
    object_type: str = Field(
        default="file",
        examples=["file"],
        description="Type of uploaded object"
    )

```
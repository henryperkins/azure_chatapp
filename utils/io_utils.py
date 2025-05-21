from io import BytesIO, IOBase
from typing import Union, BinaryIO

FileContent = Union[bytes, bytearray, memoryview, BinaryIO]

def ensure_bytes(file_content: FileContent) -> bytes:
    """
    Convert various input types to raw bytes:
    - bytes, bytearray, memoryview => direct conversion
    - file-like objects => read from them
    """
    if isinstance(file_content, (bytes, bytearray, memoryview)):
        return bytes(file_content)
    if isinstance(file_content, IOBase):
        content = file_content.read()
        if not isinstance(content, bytes):
            raise TypeError("File-like object did not return bytes when read()")
        if file_content.seekable():
            file_content.seek(0)
        return content
    raise TypeError(
        "file_content must be bytes-like or a file-like object returning bytes"
    )

def to_binary_io(data: Union[FileContent, str]) -> BinaryIO:
    """
    Convert bytes-like, BinaryIO, or file path to a BinaryIO object.
    """
    if isinstance(data, str):
        import os
        if os.path.exists(data):
            return open(data, "rb")
        else:
            raise ValueError(f"File path does not exist: {data}")
    elif isinstance(data, (bytes, bytearray, memoryview)):
        return BytesIO(data)
    elif isinstance(data, IOBase):
        data.seek(0)
        return data
    elif hasattr(data, "read") and hasattr(data, "seek"):
        data.seek(0)
        return data
    else:
        raise TypeError(
            "Invalid file_content type. Must be bytes, bytearray, memoryview, BinaryIO, or a valid file path string."
        )

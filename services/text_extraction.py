"""
text_extraction.py
-----------------
Service for extracting text content from various file formats.
Supports plain text, PDF, DOC/DOCX, JSON, CSV, and code files.
"""
import os
import json
import csv
import re
import io
import logging
from typing import Union, Dict, Any, Optional, BinaryIO, List, Tuple
import mimetypes
import chardet

logger = logging.getLogger(__name__)

# Define conditional imports to avoid hard dependencies
try:
    import docx
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

try:
    import pypdf
    PDF_AVAILABLE = True
except ImportError:
    try:
        # Attempt fallback to older PyPDF2
        import PyPDF2
        PDF_AVAILABLE = True
        pypdf = PyPDF2  # Alias for compatibility
    except ImportError:
        PDF_AVAILABLE = False

# File type mapping with extension to mimetype and metadata
FILE_TYPE_MAP = {
    # Text files
    "txt": {"mimetype": "text/plain", "category": "text"},
    "md": {"mimetype": "text/markdown", "category": "text"},
    
    # Document files
    "pdf": {"mimetype": "application/pdf", "category": "document"},
    "doc": {"mimetype": "application/msword", "category": "document"},
    "docx": {"mimetype": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "category": "document"},
    
    # Data files
    "csv": {"mimetype": "text/csv", "category": "data"},
    "json": {"mimetype": "application/json", "category": "data"},
    
    # Code files
    "py": {"mimetype": "text/x-python", "category": "code"},
    "js": {"mimetype": "application/javascript", "category": "code"},
    "html": {"mimetype": "text/html", "category": "code"},
    "css": {"mimetype": "text/css", "category": "code"},
}

class TextExtractionError(Exception):
    """Exception raised for errors during text extraction."""
    pass

class TextExtractor:
    """
    Extracts text content from various file formats.
    """
    def __init__(self):
        # Verify if optional dependencies are available and log warnings
        if not PDF_AVAILABLE:
            logger.warning("PDF extraction features limited: pypdf or PyPDF2 not installed. Install with 'pip install pypdf'")
        if not DOCX_AVAILABLE:
            logger.warning("DOCX extraction features limited: python-docx not installed. Install with 'pip install python-docx'")

    def get_file_info(self, filename: str) -> Dict[str, Any]:
        """
        Get file information based on filename or content.
        
        Args:
            filename: Name of the file
            
        Returns:
            Dictionary with mimetype, category, and extension
        """
        _, ext = os.path.splitext(filename.lower())
        ext = ext[1:] if ext.startswith('.') else ext
        
        if ext in FILE_TYPE_MAP:
            info = FILE_TYPE_MAP[ext].copy()
            info['extension'] = ext
            return info
        
        # Use mimetypes as fallback
        mimetype, _ = mimetypes.guess_type(filename)
        if not mimetype:
            # Default to plain text
            mimetype = "text/plain"
            category = "text"
        else:
            # Determine category based on mimetype
            if mimetype.startswith("text/"):
                category = "text"
            elif mimetype.startswith("application/"):
                if any(keyword in mimetype for keyword in ["pdf", "word", "document"]):
                    category = "document"
                elif any(keyword in mimetype for keyword in ["json", "xml"]):
                    category = "data"
                else:
                    category = "unknown"
            else:
                category = "unknown"
                
        return {
            "mimetype": mimetype,
            "category": category,
            "extension": ext
        }
    
    async def extract_text(
        self, 
        file_content: Union[bytes, BinaryIO, str],
        filename: Optional[str] = None,
        mimetype: Optional[str] = None
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Extract text from file content based on file type.
        
        Args:
            file_content: Content as bytes, file-like object, or filepath
            filename: Optional filename to determine file type
            mimetype: Optional mimetype to determine file type
            
        Returns:
            Tuple of (extracted_text, metadata_dict)
        """
        # Handle string input as filepath
        if isinstance(file_content, str) and os.path.exists(file_content):
            with open(file_content, 'rb') as f:
                file_content = f.read()
        
        # Convert file-like object to bytes if needed
        if hasattr(file_content, 'read'):
            # Read the content
            if hasattr(file_content, 'seek'):
                file_content.seek(0)
            content_bytes = file_content.read()
            if hasattr(file_content, 'seek'):
                file_content.seek(0)
        else:
            content_bytes = file_content
            
        # If content is bytes, create a BytesIO for readers that need file-like objects
        file_obj = io.BytesIO(content_bytes) if isinstance(content_bytes, bytes) else file_content
        
        # Reset file pointer just to be safe
        if hasattr(file_obj, 'seek'):
            file_obj.seek(0)
        
        # Determine file type from filename or mimetype
        file_info = {}
        if filename:
            file_info = self.get_file_info(filename)
        elif mimetype:
            # Find extension from mimetype
            for ext, info in FILE_TYPE_MAP.items():
                if info["mimetype"] == mimetype:
                    file_info = info.copy()
                    file_info["extension"] = ext
                    break
            
            # If not found in our map, use basic info
            if not file_info:
                file_info = {
                    "mimetype": mimetype,
                    "category": "unknown",
                    "extension": ""
                }
        
        # If we still don't have info, try to detect from content
        if not file_info:
            # Try to detect content type from bytes
            # This is simplistic - a production system would use more robust detection
            if content_bytes.startswith(b'%PDF'):
                file_info = FILE_TYPE_MAP.get("pdf", {}).copy()
                file_info["extension"] = "pdf"
            elif content_bytes.startswith(b'PK\x03\x04'):
                # This could be DOCX, XLSX, etc. - let's assume DOCX
                file_info = FILE_TYPE_MAP.get("docx", {}).copy()
                file_info["extension"] = "docx"
            elif content_bytes.startswith(b'{') and content_bytes.rstrip().endswith(b'}'):
                # Likely JSON
                file_info = FILE_TYPE_MAP.get("json", {}).copy()
                file_info["extension"] = "json"
            else:
                # Default to text and try to detect encoding
                encoding_result = chardet.detect(content_bytes)
                encoding = encoding_result['encoding'] if encoding_result['confidence'] > 0.7 else 'utf-8'
                
                file_info = {
                    "mimetype": "text/plain",
                    "category": "text",
                    "extension": "txt",
                    "encoding": encoding
                }
        
        # Extract based on category and extension
        try:
            category = file_info.get("category", "text")
            ext = file_info.get("extension", "")
            
            if category == "text" or ext in ["txt", "md"]:
                return self._extract_from_text(content_bytes, file_info)
            elif category == "document":
                if ext == "pdf":
                    return self._extract_from_pdf(file_obj, file_info)
                elif ext in ["doc", "docx"]:
                    return self._extract_from_docx(file_obj, file_info)
            elif category == "data":
                if ext == "json":
                    return self._extract_from_json(content_bytes, file_info)
                elif ext == "csv":
                    return self._extract_from_csv(content_bytes, file_info)
            elif category == "code" or ext in ["py", "js", "html", "css"]:
                return self._extract_from_code(content_bytes, file_info)
            
            # Fallback to text extraction for unknown types
            return self._extract_from_text(content_bytes, file_info)
            
        except Exception as e:
            logger.exception(f"Error extracting text: {e}")
            raise TextExtractionError(f"Failed to extract text: {str(e)}")
    
    def _extract_from_text(self, content: bytes, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from plain text files."""
        # Detect encoding if not already provided
        encoding = file_info.get("encoding")
        if not encoding:
            result = chardet.detect(content)
            encoding = result['encoding'] if result['confidence'] > 0.7 else 'utf-8'
            
        try:
            text = content.decode(encoding)
        except UnicodeDecodeError:
            # Fallback to utf-8 with error handling
            text = content.decode('utf-8', errors='replace')
            
        # Count lines and words for metadata
        line_count = text.count('\n') + 1
        word_count = len(re.findall(r'\b\w+\b', text))
        
        metadata = {
            **file_info,
            "line_count": line_count,
            "word_count": word_count,
            "char_count": len(text),
            "encoding": encoding
        }
        
        return text, metadata
    
    def _extract_from_pdf(self, file_obj: BinaryIO, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from PDF files."""
        if not PDF_AVAILABLE:
            raise TextExtractionError("PDF extraction requires pypdf or PyPDF2 library")
            
        try:
            # Reset file pointer
            if hasattr(file_obj, 'seek'):
                file_obj.seek(0)
                
            reader = pypdf.PdfReader(file_obj)
            page_count = len(reader.pages)
            text = ""
            
            # Extract text from each page
            for page_num in range(page_count):
                page = reader.pages[page_num]
                text += page.extract_text() + "\n\n"
                
            # Cleanup any excessive whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            
            metadata = {
                **file_info,
                "page_count": page_count,
                "word_count": len(re.findall(r'\b\w+\b', text)),
                "char_count": len(text)
            }
            
            return text, metadata
            
        except Exception as e:
            raise TextExtractionError(f"PDF extraction error: {str(e)}")
    
    def _extract_from_docx(self, file_obj: BinaryIO, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from DOCX files."""
        if not DOCX_AVAILABLE:
            raise TextExtractionError("DOCX extraction requires python-docx library")
            
        try:
            # Reset file pointer
            if hasattr(file_obj, 'seek'):
                file_obj.seek(0)
                
            doc = docx.Document(file_obj)
            paragraphs = [p.text for p in doc.paragraphs]
            text = "\n".join(paragraphs)
            
            metadata = {
                **file_info,
                "paragraph_count": len(paragraphs),
                "word_count": len(re.findall(r'\b\w+\b', text)),
                "char_count": len(text)
            }
            
            return text, metadata
            
        except Exception as e:
            raise TextExtractionError(f"DOCX extraction error: {str(e)}")
    
    def _extract_from_json(self, content: bytes, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from JSON files."""
        try:
            # First try UTF-8 decoding
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            # Fallback with replacement
            text = content.decode('utf-8', errors='replace')
            
        try:
            # Try to parse as JSON for metadata
            json_data = json.loads(text)
            
            # Get information about the JSON structure
            if isinstance(json_data, dict):
                structure = "object"
                keys = list(json_data.keys())
                top_level_count = len(keys)
            elif isinstance(json_data, list):
                structure = "array"
                top_level_count = len(json_data)
                keys = []
            else:
                structure = "primitive"
                top_level_count = 1
                keys = []
                
            # Create a more readable text representation for larger objects
            if len(text) > 1000:
                formatted_text = json.dumps(json_data, indent=2)
            else:
                formatted_text = text
                
            metadata = {
                **file_info,
                "json_structure": structure,
                "top_level_count": top_level_count,
                "keys": keys[:10],  # First 10 keys for reference
                "char_count": len(text)
            }
            
            return formatted_text, metadata
            
        except json.JSONDecodeError:
            # If JSON parsing fails, just return the text
            return text, {
                **file_info,
                "parsing_error": "Invalid JSON",
                "char_count": len(text)
            }
    
    def _extract_from_csv(self, content: bytes, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from CSV files."""
        try:
            # Try common encodings
            encodings = ['utf-8', 'latin-1', 'cp1252']
            text = None
            
            for encoding in encodings:
                try:
                    text = content.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            
            if text is None:
                # Last resort - replace invalid chars
                text = content.decode('utf-8', errors='replace')
                
            # Parse CSV to extract headers and sample data
            csv_reader = csv.reader(io.StringIO(text))
            rows = list(csv_reader)
            
            if not rows:
                return text, {**file_info, "char_count": len(text)}
                
            headers = rows[0] if rows else []
            row_count = len(rows)
            
            # Format as text with headers and sample data
            formatted_text = text
            
            metadata = {
                **file_info,
                "row_count": row_count,
                "column_count": len(headers),
                "headers": headers,
                "char_count": len(text)
            }
            
            return formatted_text, metadata
            
        except Exception as e:
            # If CSV parsing fails, return raw text
            try:
                text = content.decode('utf-8', errors='replace')
            except Exception:
                text = str(content)
                
            return text, {
                **file_info,
                "parsing_error": f"CSV extraction error: {str(e)}",
                "char_count": len(text)
            }
    
    def _extract_from_code(self, content: bytes, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from code files with rudimentary parsing."""
        try:
            # Decode content
            try:
                text = content.decode('utf-8')
            except UnicodeDecodeError:
                text = content.decode('utf-8', errors='replace')
                
            # Count lines and identify structure based on file type
            lines = text.split('\n')
            line_count = len(lines)
            
            # Get file extension for language-specific parsing
            ext = file_info.get("extension", "")
            
            # Basic code structure analysis
            metadata = {**file_info, "line_count": line_count, "char_count": len(text)}
            
            # Language-specific parsing
            if ext == "py":
                # Python-specific metadata: count classes, functions, imports
                class_count = len(re.findall(r'^\s*class\s+\w+', text, re.MULTILINE))
                function_count = len(re.findall(r'^\s*def\s+\w+', text, re.MULTILINE))
                import_count = len(re.findall(r'^\s*import\s+\w+|^\s*from\s+\w+\s+import', text, re.MULTILINE))
                
                metadata.update({
                    "class_count": class_count,
                    "function_count": function_count,
                    "import_count": import_count
                })
                
            elif ext == "js":
                # JavaScript-specific metadata
                function_count = len(re.findall(r'function\s+\w+|const\s+\w+\s*=\s*\(.*\)\s*=>|let\s+\w+\s*=\s*\(.*\)\s*=>|var\s+\w+\s*=\s*\(.*\)\s*=>', text))
                class_count = len(re.findall(r'class\s+\w+', text))
                import_count = len(re.findall(r'import\s+.*\s+from', text))
                
                metadata.update({
                    "function_count": function_count,
                    "class_count": class_count,
                    "import_count": import_count
                })
                
            elif ext == "html":
                # HTML-specific metadata
                tag_pattern = r'<(\w+)[^>]*>'
                tags = re.findall(tag_pattern, text)
                
                # Count common HTML elements
                tag_counts = {}
                for tag in ['div', 'p', 'a', 'span', 'img', 'ul', 'li', 'h1', 'h2', 'h3', 'table']:
                    tag_counts[tag] = tags.count(tag)
                    
                metadata.update({
                    "tag_counts": tag_counts,
                    "total_tags": len(tags)
                })
                
            elif ext == "css":
                # CSS-specific metadata
                selector_count = len(re.findall(r'[^}]*{', text))
                property_count = len(re.findall(r':\s*[^;]+;', text))
                
                metadata.update({
                    "selector_count": selector_count,
                    "property_count": property_count
                })
                
            return text, metadata
            
        except Exception as e:
            logger.exception(f"Code extraction error: {e}")
            
            # Fallback to plain text
            try:
                text = content.decode('utf-8', errors='replace')
            except Exception:
                text = str(content)
                
            return text, {
                **file_info,
                "parsing_error": f"Code extraction error: {str(e)}",
                "char_count": len(text)
            }

# Factory function to create a TextExtractor instance
def get_text_extractor() -> TextExtractor:
    """Create and return a TextExtractor instance."""
    return TextExtractor()
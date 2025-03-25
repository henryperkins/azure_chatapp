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

# Try to import tiktoken
try:
    import tiktoken
    TIKTOKEN_AVAILABLE = True
except ImportError:
    TIKTOKEN_AVAILABLE = False
    tiktoken = None  # Set to None after the import attempt fails
    print("Warning: tiktoken not installed. Token counts will be estimates. `pip install tiktoken` for accurate counts.")


from utils.file_validation import FileValidator


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
        if not TIKTOKEN_AVAILABLE:
            logger.warning("Token counting will be approximate: tiktoken not installed. Install with 'pip install tiktoken'")

    def get_file_info(self, filename: str) -> Dict[str, Any]:
        """
        Get file information based on filename or content.
        
        Args:
            filename: Name of the file
            
        Returns:
            Dictionary with mimetype, category, and extension
        """
        return FileValidator.get_file_info(filename)

    def _count_tokens(self, text: str) -> int:
        """Counts tokens using tiktoken if available, otherwise estimates."""
        if TIKTOKEN_AVAILABLE and tiktoken is not None:
            try:
                encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(text))
            except Exception as e:
                logger.error(f"tiktoken encoding error: {e}. Falling back to character estimate.")
                return len(text) // 4  # Fallback to char estimation
        else:
            return len(text) // 4  # Char estimation

    def _create_chunks(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """
        Splits text into chunks with specified token overlap.
        
        Args:
            text: The text to split
            chunk_size: Target size of each chunk in tokens
            overlap: Number of tokens to overlap between chunks
            
        Returns:
            List of text chunks with overlaps
        """
        if not text:
            return []

        # For small texts, just return as a single chunk
        if len(text) < chunk_size * 4:  # Rough estimation
            return [text]

        chunks = []

        # Get sentences (simple split for now)
        sentences = re.split(r'(?<=[.!?])\s+', text)

        current_chunk = []
        current_size = 0

        for sentence in sentences:
            # Estimate sentence tokens
            sentence_tokens = len(sentence) // 4

            if current_size + sentence_tokens > chunk_size and current_chunk:
                # Save current chunk
                chunks.append(" ".join(current_chunk))

                # Keep overlap sentences
                overlap_tokens = 0
                overlap_sentences = []

                # Work backwards from the end to get overlap
                for s in reversed(current_chunk):
                    s_tokens = len(s) // 4
                    if overlap_tokens + s_tokens <= overlap:
                        overlap_sentences.insert(0, s)
                        overlap_tokens += s_tokens
                    else:
                        break

                # Start new chunk with overlap
                current_chunk = overlap_sentences
                current_size = overlap_tokens

            # Add current sentence
            current_chunk.append(sentence)
            current_size += sentence_tokens

        # Add the last chunk if not empty
        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    def _get_file_obj(self, file_content: Union[bytes, BinaryIO, str, bytearray, memoryview]) -> BinaryIO:
        """Helper function to convert file_content to a BinaryIO object."""
        if isinstance(file_content, str):
            if os.path.exists(file_content):
                return open(file_content, 'rb')
            else:
                raise ValueError(f"File path does not exist: {file_content}")
        elif isinstance(file_content, (bytes, bytearray, memoryview)):
            return io.BytesIO(file_content)
        elif isinstance(file_content, BinaryIO):
            file_content.seek(0)
            return file_content
        elif hasattr(file_content, 'read') and hasattr(file_content, 'seek'):
            file_content.seek(0)
            return file_content
        else:
            raise TypeError("Invalid file_content type. Must be bytes, bytearray, memoryview, BinaryIO, or a valid file path string.")

    def extract_text(
        self,
        file_content: Union[bytes, BinaryIO, str],
        filename: Optional[str] = None,
        mimetype: Optional[str] = None,
        chunk_size: int = 1000,
        chunk_overlap: int = 200
    ) -> Tuple[List[str], Dict[str, Any]]:
        """
        Extract text from file content based on file type.
        
        Args:
            file_content: Content as bytes, file-like object, or filepath
            filename: Optional filename to determine file type
            mimetype: Optional mimetype to determine file type
            chunk_size: Target size of each chunk in tokens
            chunk_overlap: Number of tokens to overlap between chunks
            
        Returns:
            Tuple of (extracted_text_chunks, metadata_dict)
        """
        file_obj = self._get_file_obj(file_content)

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
            content_bytes = file_obj.read()
            file_obj.seek(0)
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
            
            text = ""
            metadata = {}
            
            if category == "text" or ext in ["txt", "md"]:
                text, metadata = self._extract_from_text(file_obj.read(), file_info)
            elif category == "document":
                if ext == "pdf":
                    text, metadata = self._extract_from_pdf(file_obj, file_info)
                elif ext in ["doc", "docx"]:
                    text, metadata = self._extract_from_docx(file_obj, file_info)
            elif category == "data":
                if ext == "json":
                    text, metadata = self._extract_from_json(file_obj.read(), file_info)
                elif ext == "csv":
                    text, metadata = self._extract_from_csv(file_obj.read(), file_info)
                elif ext == "xlsx":
                    text, metadata = self._extract_from_text(file_obj.read(), file_info)  # Placeholder
            elif category == "code" or ext in ["py", "js", "html", "css"]:
                text, metadata = self._extract_from_code(file_obj.read(), file_info)
            else:
                # Fallback to text extraction for unknown types
                text, metadata = self._extract_from_text(file_obj.read(), file_info)
            
            # Create chunks from the text
            chunks = self._create_chunks(text, chunk_size, chunk_overlap)
            
            # Update metadata with chunking info
            metadata.update({
                "chunk_count": len(chunks),
                "chunk_size": chunk_size,
                "chunk_overlap": chunk_overlap,
            })
            
            return chunks, metadata
            
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
            text = content.decode(encoding if encoding else 'utf-8')
        except UnicodeDecodeError:
            # Fallback to utf-8 with error handling
            text = content.decode('utf-8', errors='replace')

        # Count lines and words for metadata
        line_count = text.count('\n') + 1
        word_count = len(re.findall(r'\b\w+\b', text))
        token_count = self._count_tokens(text)  # Use the token counter

        metadata = {
            **file_info,
            "line_count": line_count,
            "word_count": word_count,
            "char_count": len(text),
            "encoding": encoding,
            "token_count": token_count,  # Add token count
        }

        return text, metadata

    def _extract_from_pdf(self, file_obj: BinaryIO, file_info: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """Extract text from PDF files."""
        if not PDF_AVAILABLE:
            raise TextExtractionError("PDF extraction requires pypdf or PyPDF2 library")

        try:
            # Reset file pointer
            file_obj.seek(0)

            reader = pypdf.PdfReader(file_obj)
            page_count = len(reader.pages)
            text = ""
            
            # Extract text with layout preservation
            for page in reader.pages:
                text += page.extract_text(
                    extraction_mode="layout",  # Preserve spacing/indentation
                    layout_mode_space_vertically=True,
                    layout_mode_scale_overlap=0.5
                ) + "\n\n"

            # Cleanup any excessive whitespace
            text = re.sub(r'\s+', ' ', text).strip()

            token_count = self._count_tokens(text)  # Use the token counter

            metadata = {
                **file_info,
                "page_count": page_count,
                "word_count": len(re.findall(r'\b\w+\b', text)),
                "char_count": len(text),
                "token_count": token_count,  # Add token count
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
            file_obj.seek(0)

            doc = docx.Document(file_obj)
            paragraphs = [p.text for p in doc.paragraphs]
            text = "\n".join(paragraphs)

            token_count = self._count_tokens(text)  # Use the token counter

            metadata = {
                **file_info,
                "paragraph_count": len(paragraphs),
                "word_count": len(re.findall(r'\b\w+\b', text)),
                "char_count": len(text),
                "token_count": token_count,  # Add token count

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

            token_count = self._count_tokens(formatted_text)  # Use the token counter

            metadata = {
                **file_info,
                "json_structure": structure,
                "top_level_count": top_level_count,
                "keys": keys[:10],  # First 10 keys for reference
                "char_count": len(text),
                "token_count": token_count,  # Add token count
            }

            return formatted_text, metadata

        except json.JSONDecodeError:
            # If JSON parsing fails, just return the text

            token_count = self._count_tokens(text)  # Token count on raw text
            return text, {
                **file_info,
                "parsing_error": "Invalid JSON",
                "char_count": len(text),
                "token_count": token_count,  # Add token count
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
                token_count = self._count_tokens(text)  # Use the token counter
                return text, {**file_info, "char_count": len(text), "token_count": token_count}

            headers = rows[0] if rows else []
            row_count = len(rows)

            # Format as text with headers and sample data
            formatted_text = text

            token_count = self._count_tokens(formatted_text)   # Use the token counter

            metadata = {
                **file_info,
                "row_count": row_count,
                "column_count": len(headers),
                "headers": headers,
                "char_count": len(text),
                "token_count": token_count,  # Add token count
            }

            return formatted_text, metadata

        except Exception as e:
            # If CSV parsing fails, return raw text
            try:
                text = content.decode('utf-8', errors='replace')
            except Exception:
                text = str(content)
            token_count = self._count_tokens(text)  # Use the token counter

            return text, {
                **file_info,
                "parsing_error": f"CSV extraction error: {str(e)}",
                "char_count": len(text),
                "token_count": token_count,   # Add token count
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
            token_count = self._count_tokens(text)   # Use the token counter

            metadata = {**file_info, "line_count": line_count, "char_count": len(text), "token_count": token_count, }

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

            token_count = self._count_tokens(text)  # Token count

            return text, {
                **file_info,
                "parsing_error": f"Code extraction error: {str(e)}",
                "char_count": len(text),
                "token_count": token_count,   # Add token count
            }

# Factory function to create a TextExtractor instance
def get_text_extractor() -> TextExtractor:
    """Create and return a TextExtractor instance."""
    return TextExtractor()

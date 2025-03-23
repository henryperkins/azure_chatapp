"""
vector_db.py
-----------
Service for handling vector embeddings and similarity search functionality.
Supports different embedding models and both in-memory and database storage.
"""

import logging
import json
import os
import uuid
import numpy as np
from typing import List, Dict, Any, Optional
from models.project_file import ProjectFile

# Constants for vector DB configuration
VECTOR_DB_STORAGE_PATH = "./storage/vector_db"
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200

logger = logging.getLogger(__name__)

# Try importing optional dependencies
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.warning("sentence-transformers not installed. Install with 'pip install sentence-transformers' for local embedding generation")

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False
    logger.warning("faiss-cpu not installed. Install with 'pip install faiss-cpu' for faster vector search")

try:
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not installed. Install with 'pip install scikit-learn' for fallback similarity calculations")


class VectorDBError(Exception):
    """Exception raised for errors in vector operations."""
    pass


class VectorDB:
    """
    Handles vector embeddings and similarity search operations.
    """
    def __init__(
        self,
        embedding_model: str = "all-MiniLM-L6-v2",
        use_faiss: bool = True,
        storage_path: Optional[str] = None
    ):
        """
        Initialize the vector database with the specified embedding model.
        
        Args:
            embedding_model: Name of sentence-transformers model to use
            use_faiss: Whether to use FAISS for search (if available)
            storage_path: Optional path to save vectors (if None, in-memory only)
        """
        self.embedding_model_name = embedding_model
        self.storage_path = storage_path
        self.use_faiss = use_faiss and FAISS_AVAILABLE
        
        # Initialize embedding model if available
        self.embedding_model = None
        if SENTENCE_TRANSFORMERS_AVAILABLE:
            try:
                self.embedding_model = SentenceTransformer(embedding_model)
                logger.info(f"Initialized embedding model: {embedding_model}")
            except Exception as e:
                logger.error(f"Error initializing embedding model: {str(e)}")
                raise VectorDBError(f"Failed to initialize embedding model: {str(e)}")
        else:
            logger.warning("Using external embedding API as sentence-transformers is not available")
        
        # Storage for vectors and metadata
        self.vectors = {}  # id -> vector
        self.metadata = {}  # id -> metadata
        
        # FAISS index (if available)
        self.index = None
        self.id_map = []  # Maps FAISS indices to document IDs
        
        # Initialize FAISS if available
        if self.use_faiss:
            try:
                self.index = None  # Will be initialized when adding first vector
            except Exception as e:
                logger.error(f"Error initializing FAISS: {str(e)}")
                self.use_faiss = False
    
    def get_embedding_dimension(self) -> int:
        """
        Get the dimension of embeddings for the current model.
        
        Returns:
            Dimension of the embedding vectors
        """
        if self.embedding_model is not None:
            return self.embedding_model.get_sentence_embedding_dimension()
        
        # Default dimension for typical models
        return 384
    
    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of text chunks.
        
        Args:
            texts: List of text chunks to embed
            
        Returns:
            List of embedding vectors (as lists of floats)
        """
        if not texts:
            return []
            
        if self.embedding_model is not None:
            # Use local model
            try:
                embeddings = self.embedding_model.encode(texts)
                # Convert to list of lists for serialization
                return embeddings.tolist()
            except Exception as e:
                logger.error(f"Error generating embeddings: {str(e)}")
                raise VectorDBError(f"Failed to generate embeddings: {str(e)}")
        else:
            # Use external embedding API
            try:
                from config import settings
                import httpx
                
                # Check which API to use
                if settings.EMBEDDING_API == "openai":
                    url = "https://api.openai.com/v1/embeddings"
                    headers = {
                        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "input": texts,
                        "model": "text-embedding-3-small"
                    }
                elif settings.EMBEDDING_API == "cohere":
                    url = "https://api.cohere.ai/v1/embed"
                    headers = {
                        "Authorization": f"Bearer {settings.COHERE_API_KEY}",
                        "Content-Type": "application/json"
                    }
                    payload = {
                        "texts": texts,
                        "model": "embed-english-v3.0",
                        "input_type": "search_document"
                    }
                else:
                    raise VectorDBError("No valid embedding API configured")
                
                # Make API request
                async with httpx.AsyncClient() as client:
                    response = await client.post(url, json=payload, headers=headers, timeout=30)
                    response.raise_for_status()
                    data = response.json()
                    
                    if settings.EMBEDDING_API == "openai":
                        return [item['embedding'] for item in data['data']]
                    elif settings.EMBEDDING_API == "cohere":
                        return data['embeddings']
                    
            except Exception as e:
                logger.error(f"Error calling external embedding API: {str(e)}")
                raise VectorDBError(f"Failed to generate embeddings via API: {str(e)}")
    
    async def add_documents(
        self,
        chunks: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        ids: Optional[List[str]] = None
    ) -> List[str]:
        """
        Add documents/chunks to the vector database.
        
        Args:
            chunks: List of text chunks to add
            metadatas: Optional list of metadata for each chunk
            ids: Optional list of IDs for each chunk
            
        Returns:
            List of IDs for the added chunks
        """
        if not chunks:
            return []
            
        # Generate embeddings
        embeddings = await self.generate_embeddings(chunks)
        if not embeddings:
            return []
            
        # Generate IDs if not provided
        if ids is None:
            ids = [str(uuid.uuid4()) for _ in range(len(chunks))]
        
        # Use empty metadata if not provided
        if metadatas is None:
            metadatas = [{} for _ in range(len(chunks))]
            
        # Add to in-memory storage
        for i, (doc_id, embedding, metadata) in enumerate(zip(ids, embeddings, metadatas)):
            self.vectors[doc_id] = embedding
            self.metadata[doc_id] = {
                **metadata,
                "text": chunks[i]
            }
        
        # Update FAISS index if using it
        if self.use_faiss:
            # Convert to numpy array
            embeddings_np = np.array(embeddings, dtype=np.float32)
            
            # Create index if not exists
            if self.index is None:
                dimension = embeddings_np.shape[1]
                self.index = faiss.IndexFlatL2(dimension)
                
            # Add to index
            self.index.add(embeddings_np)
            # Update ID mapping
            self.id_map.extend(ids)
        
        # Persist to disk if storage path is provided
        if self.storage_path:
            await self._save_to_disk()
            
        return ids
    
    async def search(
        self,
        query: str,
        top_k: int = 5,
        filter_metadata: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for documents similar to the query text.
        
        Args:
            query: Query text to search for
            top_k: Number of results to return
            filter_metadata: Optional filter criteria for metadata
            
        Returns:
            List of dictionaries with results (id, text, score, metadata)
        """
        # Generate query embedding
        query_embedding = await self.generate_embeddings([query])
        if not query_embedding or not query_embedding[0]:
            raise VectorDBError("Failed to generate embedding for query")
        
        query_vector = query_embedding[0]
        
        # Different search strategies based on available libraries
        if self.use_faiss and self.index is not None:
            # Convert to numpy array
            query_np = np.array([query_vector], dtype=np.float32)
            
            # Search using FAISS
            distances, indices = self.index.search(query_np, min(top_k, len(self.id_map)))
            
            # Transform results
            results = []
            for i, (dist, idx) in enumerate(zip(distances[0], indices[0])):
                if idx < len(self.id_map):
                    doc_id = self.id_map[idx]
                    if doc_id in self.metadata:
                        # Convert distance to similarity score (1 - normalized distance)
                        score = max(0.0, 1.0 - (dist / 100.0))
                        
                        # Apply metadata filter
                        if filter_metadata and not self._matches_filter(self.metadata[doc_id], filter_metadata):
                            continue
                            
                        results.append({
                            "id": doc_id,
                            "text": self.metadata[doc_id].get("text", ""),
                            "score": float(score),
                            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"}
                        })
                        
            return results
        elif SKLEARN_AVAILABLE:
            # Fallback to scikit-learn cosine similarity
            
            # Get all vectors
            ids = list(self.vectors.keys())
            vectors = [self.vectors[id] for id in ids]
            
            if not vectors:
                return []
                
            # Compute similarity scores
            try:
                vectors_np = np.array(vectors)
                query_np = np.array([query_vector])
                
                similarities = cosine_similarity(query_np, vectors_np)[0]
                
                # Create (id, score) pairs and sort by score
                id_score_pairs = [(id, float(score)) for id, score in zip(ids, similarities)]
                id_score_pairs.sort(key=lambda x: x[1], reverse=True)
                
                # Apply metadata filter and build results
                results = []
                for doc_id, score in id_score_pairs:
                    if doc_id in self.metadata:
                        if filter_metadata and not self._matches_filter(self.metadata[doc_id], filter_metadata):
                            continue
                            
                        results.append({
                            "id": doc_id,
                            "text": self.metadata[doc_id].get("text", ""),
                            "score": score,
                            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"}
                        })
                    
                    if len(results) >= top_k:
                        break
                        
                return results
            except Exception as e:
                logger.error(f"Error in sklearn similarity search: {str(e)}")
                raise VectorDBError(f"Failed to compute vector similarity: {str(e)}")
        else:
            # Fallback to manual cosine similarity
            results = []
            
            for doc_id, vector in self.vectors.items():
                # Apply metadata filter
                if filter_metadata and not self._matches_filter(self.metadata.get(doc_id, {}), filter_metadata):
                    continue
                
                # Manual cosine similarity
                try:
                    dot_product = sum(a * b for a, b in zip(query_vector, vector))
                    query_norm = sum(a * a for a in query_vector) ** 0.5
                    doc_norm = sum(b * b for b in vector) ** 0.5
                    
                    if query_norm > 0 and doc_norm > 0:
                        similarity = dot_product / (query_norm * doc_norm)
                    else:
                        similarity = 0.0
                        
                    results.append({
                        "id": doc_id,
                        "text": self.metadata.get(doc_id, {}).get("text", ""),
                        "score": float(similarity),
                        "metadata": {k: v for k, v in self.metadata.get(doc_id, {}).items() if k != "text"}
                    })
                except Exception as e:
                    logger.error(f"Error calculating similarity for document {doc_id}: {str(e)}")
            
            # Sort by score and limit to top_k
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:top_k]
    
    def _matches_filter(self, metadata: Dict[str, Any], filter_criteria: Dict[str, Any]) -> bool:
        """
        Check if metadata matches the filter criteria.
        
        Args:
            metadata: Document metadata
            filter_criteria: Filter requirements
            
        Returns:
            True if metadata matches all filter criteria
        """
        for key, value in filter_criteria.items():
            if key not in metadata:
                return False
                
            # Handle different types of criteria
            if isinstance(value, list):
                # List means "one of these values"
                if metadata[key] not in value:
                    return False
            elif callable(value):
                # Function means "call with metadata value"
                if not value(metadata[key]):
                    return False
            else:
                # Direct comparison
                if metadata[key] != value:
                    return False
                    
        return True
    
    async def delete_by_ids(self, ids: List[str]) -> int:
        """
        Delete documents by their IDs.
        
        Args:
            ids: List of document IDs to delete
            
        Returns:
            Number of documents deleted
        """
        if not ids:
            return 0
            
        # Count deleted items
        deleted_count = 0
        
        # Remove from in-memory storage
        for doc_id in ids:
            if doc_id in self.vectors:
                del self.vectors[doc_id]
                deleted_count += 1
            if doc_id in self.metadata:
                del self.metadata[doc_id]
        
        # For FAISS, we need to rebuild the index
        if self.use_faiss and deleted_count > 0:
            # Get remaining vectors
            remaining_ids = list(self.vectors.keys())
            remaining_vectors = [self.vectors[id] for id in remaining_ids]
            
            # Rebuild index
            if remaining_vectors:
                vectors_np = np.array(remaining_vectors, dtype=np.float32)
                dimension = vectors_np.shape[1]
                self.index = faiss.IndexFlatL2(dimension)
                self.index.add(vectors_np)
                self.id_map = remaining_ids
            else:
                self.index = None
                self.id_map = []
        
        # Persist changes if storage path is provided
        if self.storage_path and deleted_count > 0:
            await self._save_to_disk()
            
        return deleted_count
    
    async def delete_by_filter(self, filter_metadata: Dict[str, Any]) -> int:
        """
        Delete documents matching filter criteria.
        
        Args:
            filter_metadata: Filter criteria for metadata
            
        Returns:
            Number of documents deleted
        """
        if not filter_metadata:
            return 0
            
        # Find IDs to delete
        ids_to_delete = []
        for doc_id, metadata in self.metadata.items():
            if self._matches_filter(metadata, filter_metadata):
                ids_to_delete.append(doc_id)
        
        # Delete by IDs
        return await self.delete_by_ids(ids_to_delete)
    
    async def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            Document data or None if not found
        """
        if doc_id not in self.metadata:
            return None
            
        return {
            "id": doc_id,
            "text": self.metadata[doc_id].get("text", ""),
            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"},
            "vector": self.vectors.get(doc_id)
        }
    
    async def _save_to_disk(self) -> None:
        """Save the current state to disk."""
        if not self.storage_path:
            return
            
        try:
            # Ensure directory exists
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            
            # Prepare data
            data = {
                "vectors": self.vectors,
                "metadata": self.metadata,
                "model": self.embedding_model_name
            }
            
            # Save to file
            with open(self.storage_path, 'w') as f:
                json.dump(data, f)
                
        except Exception as e:
            logger.error(f"Error saving vector DB to disk: {str(e)}")
    
    async def load_from_disk(self) -> bool:
        """
        Load vectors and metadata from disk.
        
        Returns:
            True if loaded successfully
        """
        if not self.storage_path or not os.path.exists(self.storage_path):
            return False
            
        try:
            # Load from file
            with open(self.storage_path, 'r') as f:
                data = json.load(f)
            
            # Validate model compatibility
            if data.get("model") != self.embedding_model_name:
                logger.warning(
                    f"Model mismatch in saved data: {data.get('model')} vs {self.embedding_model_name}. "
                    "Using saved data anyway but this may cause issues."
                )
            
            # Load data
            self.vectors = data.get("vectors", {})
            self.metadata = data.get("metadata", {})
            
            # Rebuild FAISS index
            if self.use_faiss and self.vectors:
                # Get all vectors
                ids = list(self.vectors.keys())
                vectors = [self.vectors[id] for id in ids]
                
                # Convert to numpy array
                vectors_np = np.array(vectors, dtype=np.float32)
                
                # Create and populate index
                dimension = vectors_np.shape[1]
                self.index = faiss.IndexFlatL2(dimension)
                self.index.add(vectors_np)
                self.id_map = ids
                
            return True
            
        except Exception as e:
            logger.error(f"Error loading vector DB from disk: {str(e)}")
            return False


# Factory function to get or create a vector database instance
async def get_vector_db(
    model_name: str = "all-MiniLM-L6-v2",
    use_faiss: bool = True,
    storage_path: Optional[str] = None,
    load_existing: bool = True
) -> VectorDB:
    """
    Get or create a vector database.
    
    Args:
        model_name: Embedding model to use
        use_faiss: Whether to use FAISS for search (if available)
        storage_path: Path to save/load vectors
        load_existing: Whether to load existing data from storage_path
        
    Returns:
        VectorDB instance
    """
    # Create vector DB
    vector_db = VectorDB(
        embedding_model=model_name,
        use_faiss=use_faiss,
        storage_path=storage_path
    )
    
    # Load existing data if requested
    if load_existing and storage_path and os.path.exists(storage_path):
        await vector_db.load_from_disk()
        
    return vector_db


# Process and embed a new file for similarity search
async def process_file_for_search(
    project_file: ProjectFile,
    vector_db: VectorDB,
    file_content: bytes,
    chunk_size: int = 1000,
    chunk_overlap: int = 200
) -> Dict[str, Any]:
    """
    Process a file for similarity search.
    
    Args:
        project_file: The project file to process
        vector_db: The vector DB to add to
        file_content: Raw file content as bytes
        chunk_size: Size of chunks in tokens
        chunk_overlap: Overlap between chunks in tokens
        
    Returns:
        Dictionary with processing results and stats
    """
    from services.text_extraction import get_text_extractor
    
    # Get text extractor
    text_extractor = get_text_extractor()
    
    try:
        # Extract text and metadata from file
        text_chunks, metadata = await text_extractor.extract_text(
            file_content,
            filename=project_file.filename,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )
        
        # Prepare metadata for each chunk
        chunk_metadatas = []
        for i in range(len(text_chunks)):
            chunk_metadatas.append({
                "file_id": str(project_file.id),
                "project_id": str(project_file.project_id),
                "chunk_index": i,
                "total_chunks": len(text_chunks),
                "file_name": project_file.filename,
                "file_type": project_file.file_type,
                "source": "project_file"
            })
        
        # Generate IDs for chunks
        chunk_ids = [f"{project_file.id}_chunk_{i}" for i in range(len(text_chunks))]
        
        # Add to vector database
        if text_chunks and chunk_metadatas:
            added_ids = await vector_db.add_documents(
                chunks=text_chunks,
                metadatas=chunk_metadatas,
                ids=chunk_ids
            )
            
            # Return process stats
            return {
                "file_id": str(project_file.id),
                "chunk_count": len(text_chunks),
                "token_count": metadata.get("token_count", 0),
                "added_ids": added_ids,
                "success": True,
                "metadata": metadata
            }
        else:
            # No chunks extracted
            return {
                "file_id": str(project_file.id),
                "chunk_count": 0,
                "token_count": 0,
                "added_ids": [],
                "success": False,
                "error": "No text chunks extracted",
                "metadata": metadata
            }
            
    except Exception as e:
        logger.error(f"Error processing file {project_file.filename} for search: {str(e)}")
        return {
            "file_id": str(project_file.id),
            "success": False,
            "error": str(e),
            "chunk_count": 0,
            "token_count": 0,
            "added_ids": []
        }


# Find relevant context for a query
async def search_context_for_query(
    query: str,
    vector_db: VectorDB,
    project_id: Optional[str] = None,
    top_k: int = 5,
) -> List[Dict[str, Any]]:
    """
    Search for relevant context for a query.
    
    Args:
        query: The query text
        vector_db: The vector DB to search
        project_id: Optional project ID to filter by
        top_k: Number of results to return
        
    Returns:
        List of relevant context pieces with similarity scores
    """
    # Prepare filter if project_id is provided
    filter_metadata = {"project_id": project_id} if project_id else None
    
    # Search vector DB
    results = await vector_db.search(
        query=query,
        top_k=top_k,
        filter_metadata=filter_metadata
    )
    
    return results

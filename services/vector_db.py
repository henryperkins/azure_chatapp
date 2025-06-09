"""
vector_db.py
-----------
Service for handling vector embeddings and similarity search functionality.
Supports different embedding models and both in-memory and database storage.

Key Improvements:
- Unified search backend selection
- Reduced code duplication
- Better error handling
- Cleaner organization
"""

import logging
import json
import os
import uuid
from typing import List, Any, Optional, Callable
from uuid import UUID

from db import get_async_session_context

import numpy as np
import httpx

from models.project_file import ProjectFile

logger = logging.getLogger(__name__)

# Optional dependencies
SENTENCE_TRANSFORMERS_AVAILABLE = False
FAISS_AVAILABLE = False
SKLEARN_AVAILABLE = False

# Global references to optional imports
faiss = None
SentenceTransformer = None

try:
    from sentence_transformers import SentenceTransformer as _SentenceTransformer

    SentenceTransformer = _SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    logger.warning(
        "sentence-transformers not installed. Install with 'pip install sentence-transformers' "
        "for local embedding generation"
    )

try:
    import faiss as _faiss

    faiss = _faiss
    FAISS_AVAILABLE = True
except ImportError:
    logger.warning(
        "faiss-cpu not installed. Install with 'pip install faiss-cpu' for faster vector search"
    )

try:
    from sklearn.metrics.pairwise import cosine_similarity

    SKLEARN_AVAILABLE = True
except ImportError:
    logger.warning(
        "scikit-learn not installed. Install with 'pip install scikit-learn' for fallback similarity calculations"
    )


class VectorDBError(Exception):
    """Exception raised for errors in vector operations."""

    pass


# Constants for vector DB configuration
VECTOR_DB_STORAGE_PATH = "./storage/vector_db"
DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 200


class VectorDB:
    """
    Handles vector embeddings and similarity search operations.

    IMPORTANT:
    - All documents require project_id, knowledge_base_id, and file_id in metadata
    - Search filters should always include both project_id and knowledge_base_id
    """

    def __init__(
        self,
        embedding_model: str = "all-MiniLM-L6-v2",
        use_faiss: bool = True,
        storage_path: Optional[str] = None,
    ):
        """Initialize vector database with the specified embedding model."""
        self.embedding_model_name = embedding_model
        self.storage_path = storage_path
        self.use_faiss = use_faiss and FAISS_AVAILABLE

        # Initialize components
        self._initialize_faiss()
        self._initialize_embedding_model()

        # In-memory storage
        self.vectors: dict[str, List[float]] = {}  # doc_id -> vector
        self.metadata: dict[str, dict[str, Any]] = {}  # doc_id -> metadata
        self.id_map: List[str] = []  # Maps FAISS internal indices to document IDs

    def _initialize_faiss(self) -> None:
        """Initialize FAISS components with proper error handling."""
        self.faiss = faiss if self.use_faiss else None
        self.index = None
        if self.use_faiss and not self.faiss:
            logger.warning("FAISS import failed despite FAISS_AVAILABLE=True")
            self.use_faiss = False

    def _initialize_embedding_model(self) -> None:
        """Initialize the embedding model with proper error handling."""
        self.embedding_model = None
        if not SENTENCE_TRANSFORMERS_AVAILABLE or not SentenceTransformer:
            logger.info(
                f"Using external embedding API for model: {self.embedding_model_name}"
            )
            return

        try:
            self.embedding_model = SentenceTransformer(self.embedding_model_name)
            logger.info(
                f"Initialized local embedding model: {self.embedding_model_name}"
            )
            self._warmup_embedding_model()
        except Exception as e:
            logger.error(f"Error initializing embedding model: {str(e)}")
            raise VectorDBError(f"Failed to initialize embedding model: {str(e)}")

    def _warmup_embedding_model(self) -> None:
        """Perform initial warmup of the embedding model."""
        if self.embedding_model and hasattr(self.embedding_model, "encode"):
            try:
                self.embedding_model.encode([""])
            except Exception as e:
                logger.warning(f"Model warmup failed: {str(e)}")

    async def test_connection(self) -> dict[str, Any]:
        """Test the vector database connection and basic functionality."""
        try:
            model_ready = (
                self.embedding_model is not None or not SENTENCE_TRANSFORMERS_AVAILABLE
            )
            faiss_ready = not self.use_faiss or (
                FAISS_AVAILABLE and self.faiss is not None
            )

            return {
                "is_healthy": model_ready and faiss_ready,
                "index_count": len(self.vectors),
                "model_ready": model_ready,
                "faiss_ready": faiss_ready,
            }
        except Exception as e:
            logger.error(f"Connection test failed: {str(e)}")
            return {
                "is_healthy": False,
                "index_count": 0,
                "model_ready": False,
                "faiss_ready": False,
                "error": str(e),
            }

    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings for the current model."""
        if self.embedding_model and hasattr(
            self.embedding_model, "get_sentence_embedding_dimension"
        ):
            try:
                dim = self.embedding_model.get_sentence_embedding_dimension()
                if dim is not None:
                    return dim
            except Exception as e:
                logger.warning(f"Failed to get embedding dimension: {str(e)}")

        # Fallback for API-based models
        model_dimensions = {
            "text-embedding-3-small": 1536,
            "text-embedding-3-large": 3072,
            "embed-english": 1024,
        }
        return model_dimensions.get(
            self.embedding_model_name, 384
        )  # Default for all-MiniLM-L6-v2

    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of text chunks."""
        if not texts:
            return []

        try:
            if self.embedding_model and hasattr(self.embedding_model, "encode"):
                return await self._generate_local_embeddings(texts)
            return await self._generate_api_embeddings(texts)
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            raise VectorDBError(f"Failed to generate embeddings: {str(e)}")

    async def _generate_local_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using local sentence-transformers model."""
        if not self.embedding_model or not hasattr(self.embedding_model, "encode"):
            raise VectorDBError("Embedding model not properly initialized")

        try:
            import asyncio
            loop = asyncio.get_running_loop()
            # Run blocking encode in a thread pool to avoid blocking event loop
            embeddings = await loop.run_in_executor(None, self.embedding_model.encode, texts)
            return embeddings.tolist()
        except Exception as e:
            logger.error(f"Error generating local embeddings: {str(e)}")
            raise VectorDBError(f"Failed to generate embeddings: {str(e)}")

    async def _generate_api_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using an external API (OpenAI, Cohere, etc.)."""
        from config import settings

        try:
            if settings.EMBEDDING_API == "openai":
                return await self._generate_openai_embeddings(texts)
            if settings.EMBEDDING_API == "cohere":
                return await self._generate_cohere_embeddings(texts)
            raise VectorDBError("No valid embedding API configured")
        except Exception as e:
            logger.error(f"Error calling external embedding API: {str(e)}")
            raise VectorDBError(f"Failed to generate embeddings via API: {str(e)}")

    async def _generate_openai_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using OpenAI API."""
        from config import settings

        url = "https://api.openai.com/v1/embeddings"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {"input": texts, "model": "text-embedding-3-small"}

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]

    async def _generate_cohere_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using Cohere API."""
        from config import settings

        url = "https://api.cohere.ai/v1/embed"
        headers = {
            "Authorization": f"Bearer {settings.COHERE_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "texts": texts,
            "model": "embed-english-v3.0",
            "input_type": "search_document",
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            return data["embeddings"]

    async def add_documents(
        self,
        chunks: List[str],
        metadatas: Optional[List[dict[str, Any]]] = None,
        ids: Optional[List[str]] = None,
        batch_size: int = 100,
    ) -> List[str]:
        """Add documents in batches to the vector database."""
        if not chunks:
            return []

        # Validate and prepare inputs
        ids = ids or [str(uuid.uuid4()) for _ in range(len(chunks))]
        metadatas = metadatas or [{} for _ in range(len(chunks))]
        self._validate_metadatas(metadatas)

        successful_ids = []
        for i in range(0, len(chunks), batch_size):
            batch_end = min(i + batch_size, len(chunks))
            batch_results = await self._process_document_batch(
                chunks[i:batch_end], metadatas[i:batch_end], ids[i:batch_end]
            )
            successful_ids.extend(batch_results)

        if self.storage_path and successful_ids:
            await self._save_to_disk()

        return successful_ids

    def _validate_metadatas(self, metadatas: List[dict[str, Any]]) -> None:
        """Validate that all metadatas contain required fields."""
        required_fields = ["project_id", "knowledge_base_id", "file_id"]
        for i, metadata in enumerate(metadatas):
            missing_fields = [
                field for field in required_fields if field not in metadata
            ]
            if missing_fields:
                logger.error(
                    f"Missing required metadata fields: {missing_fields} for document {i}"
                )
                raise VectorDBError(
                    "Documents require project_id, knowledge_base_id, and file_id in metadata"
                )

    async def _process_document_batch(
        self, chunks: List[str], metadatas: List[dict[str, Any]], ids: List[str]
    ) -> List[str]:
        """Process a single batch of documents."""
        embeddings = await self.generate_embeddings(chunks)
        if not embeddings:
            return []

        successful_ids = []
        for doc_id, embedding, metadata, text in zip(
            ids, embeddings, metadatas, chunks
        ):
            self.vectors[doc_id] = embedding
            self.metadata[doc_id] = {**metadata, "text": text}
            successful_ids.append(doc_id)

        if self.use_faiss and embeddings:
            self._update_faiss_index(embeddings, ids)

        return successful_ids

    def _update_faiss_index(
        self, embeddings: List[List[float]], ids: List[str]
    ) -> None:
        """Update FAISS index with new embeddings."""
        if not (self.use_faiss and FAISS_AVAILABLE):
            return

        try:
            embeddings_np = np.array(embeddings, dtype=np.float32)
            if self.index is None:
                dimension = self.get_embedding_dimension()
                self.index = faiss.IndexFlatL2(dimension)  # type: ignore

            if embeddings_np.size > 0:
                self.index.add(embeddings_np)  # type: ignore
                self.id_map.extend(ids)
        except Exception as e:
            logger.error(f"Error updating FAISS index: {str(e)}")
            raise VectorDBError(f"Failed to update FAISS index: {str(e)}") from e

    def _get_search_backend(self) -> Callable:
        """Returns appropriate search function based on available libraries."""
        if self.use_faiss and FAISS_AVAILABLE and self.index and self.id_map:
            return self._search_with_faiss
        if SKLEARN_AVAILABLE:
            return self._search_with_sklearn
        return self._search_manual

    async def search(
        self,
        query: str,
        top_k: int = 5,
        filter_metadata: dict[str, Any] | None = None,
    ) -> List[dict[str, Any]]:
        """Search for documents similar to the query text."""
        if not query:
            raise VectorDBError("Query cannot be empty")

        try:
            query_embedding = await self.generate_embeddings([query])
            if not query_embedding or not query_embedding[0]:
                raise VectorDBError("Failed to generate embedding for query")

            search_func = self._get_search_backend()
            return await search_func(query_embedding[0], top_k, filter_metadata)
        except Exception as e:
            logger.error(f"Search failed: {str(e)}")
            raise VectorDBError(f"Search operation failed: {str(e)}") from e

    async def _search_with_faiss(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[dict[str, Any]],
    ) -> List[dict[str, Any]]:
        """FAISS-based similarity search implementation."""
        results = []
        query_np = np.array([query_vector], dtype=np.float32)
        k = min(top_k, len(self.id_map))

        try:
            distances, indices = self.index.search(query_np, k)  # type: ignore
            if distances is not None and indices is not None:
                for dist, idx in zip(distances[0], indices[0]):
                    if 0 <= idx < len(self.id_map):
                        doc_id = self.id_map[idx]
                        if doc_id in self.metadata:
                            if filter_metadata and not self._matches_filter(
                                self.metadata[doc_id], filter_metadata
                            ):
                                continue
                            score = max(0.0, 1.0 - (dist / 100.0))
                            results.append(self._format_result(doc_id, score))
        except Exception as e:
            logger.error(f"FAISS search failed: {str(e)}")
            raise VectorDBError(f"Search operation failed: {str(e)}") from e

        return results

    async def _search_with_sklearn(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[dict[str, Any]],
    ) -> List[dict[str, Any]]:
        """scikit-learn based cosine similarity search."""
        ids = list(self.vectors.keys())
        vectors = [self.vectors[d_id] for d_id in ids]
        if not vectors:
            return []

        vectors_np = np.array(vectors)
        query_np = np.array([query_vector])
        similarities = cosine_similarity(query_np, vectors_np)[0]  # type: ignore

        id_score_pairs = [
            (doc_id, float(score))
            for doc_id, score in zip(ids, similarities)
            if not filter_metadata
            or self._matches_filter(self.metadata.get(doc_id, {}), filter_metadata)
        ]
        id_score_pairs.sort(key=lambda x: x[1], reverse=True)

        return [
            self._format_result(doc_id, score)
            for doc_id, score in id_score_pairs[:top_k]
        ]

    async def _search_manual(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[dict[str, Any]],
    ) -> List[dict[str, Any]]:
        """Manual cosine similarity as a fallback."""
        results = []
        for doc_id, vector in self.vectors.items():
            if filter_metadata and not self._matches_filter(
                self.metadata.get(doc_id, {}), filter_metadata
            ):
                continue

            similarity = self._calculate_cosine_similarity(query_vector, vector)
            results.append(self._format_result(doc_id, similarity))

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _calculate_cosine_similarity(
        self, vec1: List[float], vec2: List[float]
    ) -> float:
        """Compute cosine similarity between two vectors."""
        try:
            dot_product = sum(a * b for a, b in zip(vec1, vec2))
            norm1 = sum(a * a for a in vec1) ** 0.5
            norm2 = sum(b * b for b in vec2) ** 0.5
            return dot_product / (norm1 * norm2) if norm1 > 0 and norm2 > 0 else 0.0
        except Exception as e:
            logger.error(f"Error calculating similarity: {str(e)}")
            return 0.0

    def _format_result(self, doc_id: str, score: float) -> dict[str, Any]:
        """Format search result for consistent output."""
        return {
            "id": doc_id,
            "text": self.metadata[doc_id].get("text", ""),
            "score": float(score),
            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"},
        }

    def _matches_filter(
        self, metadata: dict[str, Any], filter_criteria: dict[str, Any]
    ) -> bool:
        """Check if document metadata matches the given filter criteria."""
        for key, value in filter_criteria.items():
            if key not in metadata:
                return False
            if isinstance(value, list):
                if metadata[key] not in value:
                    return False
            elif callable(value):
                if not value(metadata[key]):
                    return False
            else:
                if metadata[key] != value:
                    return False
        return True

    async def delete_by_ids(self, ids: List[str]) -> int:
        """Delete documents by their IDs."""
        if not ids:
            return 0

        deleted_count = 0
        for doc_id in ids:
            if doc_id in self.vectors:
                del self.vectors[doc_id]
                deleted_count += 1
            if doc_id in self.metadata:
                del self.metadata[doc_id]

        if deleted_count > 0:
            if self.use_faiss:
                self._rebuild_faiss_index()
            if self.storage_path:
                await self._save_to_disk()

        return deleted_count

    def _rebuild_faiss_index(self) -> None:
        """Rebuild the FAISS index after deletions."""
        if not (self.use_faiss and FAISS_AVAILABLE):
            return

        try:
            remaining_ids = list(self.vectors.keys())
            if not remaining_ids:
                self.index = None
                self.id_map = []
                return

            remaining_vectors = [self.vectors[d_id] for d_id in remaining_ids]
            vectors_np = np.array(remaining_vectors, dtype=np.float32)

            dimension = self.get_embedding_dimension()
            self.index = faiss.IndexFlatL2(dimension)  # type: ignore

            if vectors_np.size > 0:
                self.index.add(vectors_np)  # type: ignore
            self.id_map = remaining_ids

            logger.info(f"Rebuilt FAISS index with {len(remaining_ids)} vectors")
        except Exception as e:
            logger.error(f"Failed to rebuild FAISS index: {str(e)}")
            self.index = None
            self.id_map = []

    async def delete_by_filter(self, filter_metadata: dict[str, Any]) -> int:
        """Delete documents matching a given filter."""
        if not filter_metadata:
            return 0

        ids_to_delete = [
            doc_id
            for doc_id, meta in self.metadata.items()
            if self._matches_filter(meta, filter_metadata)
        ]
        return await self.delete_by_ids(ids_to_delete)

    async def get_document(self, doc_id: str) -> Optional[dict[str, Any]]:
        """Get a document by its ID."""
        if doc_id not in self.metadata:
            return None

        return {
            "id": doc_id,
            "text": self.metadata[doc_id].get("text", ""),
            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"},
            "vector": self.vectors.get(doc_id),
        }

    async def get_stats(self) -> dict[str, Any]:
        """Get basic statistics about the vector database.

        Returns:
            Dictionary containing:
            - index_size: Number of vectors in index
            - model_name: Name of embedding model
            - is_healthy: Boolean indicating if connection is healthy
        """
        conn_status = await self.test_connection()
        return {
            "index_size": len(self.vectors),
            "model_name": self.embedding_model_name,
            "is_healthy": conn_status["is_healthy"],
        }

    async def get_knowledge_base_status(
        self, project_id: UUID, db: Any
    ) -> dict[str, Any]:
        """Get comprehensive status of the knowledge base for a project.

        This method provides detailed metrics and health information about
        the vector database for a specific project.

        Args:
            project_id: UUID of the project
            db: Database session for querying related records

        Returns:
            dict containing status information about:
            - Vector DB health (connection, model, index)
            - Storage metrics (size, location)
            - Content metrics (document count, file types)
        """
        connection_status = await self.test_connection()
        storage_exists = (
            os.path.exists(self.storage_path) if self.storage_path else False
        )

        # Count documents by type
        doc_types = {}
        for meta in self.metadata.values():
            if meta.get("project_id") == str(project_id):
                file_type = meta.get("file_type", "unknown")
                doc_types[file_type] = doc_types.get(file_type, 0) + 1

        # Get storage size
        storage_size_mb = 0
        if storage_exists and self.storage_path:
            try:
                storage_size_mb = os.path.getsize(self.storage_path) / (1024 * 1024)
            except Exception as e:
                logger.error(f"Error getting storage size: {str(e)}")

        return {
            "vector_db": {
                "status": "active" if connection_status["is_healthy"] else "error",
                "index_size": len(self.vectors),
                "embedding_model": self.embedding_model_name,
                **connection_status,
            },
            "storage": {
                "path": self.storage_path,
                "exists": storage_exists,
                "size_mb": storage_size_mb,
            },
            "documents": {
                "total_count": sum(
                    1
                    for meta in self.metadata.values()
                    if meta.get("project_id") == str(project_id)
                ),
                "by_type": doc_types,
            },
        }

    async def _save_to_disk(self) -> None:
        """Persist the current state to disk."""
        if not self.storage_path:
            return

        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
        data = {
            "vectors": self.vectors,
            "metadata": self.metadata,
            "model": self.embedding_model_name,
        }
        with open(self.storage_path, "w") as f:
            json.dump(data, f)

    async def load_from_disk(self) -> bool:
        """Load vectors and metadata from disk."""
        if not self.storage_path or not os.path.exists(self.storage_path):
            return False

        with open(self.storage_path, "r") as f:
            data = json.load(f)
            self.vectors = data.get("vectors", {})
            self.metadata = data.get("metadata", {})
            if "model" in data and data["model"] != self.embedding_model_name:
                logger.warning(
                    f"Loaded model {data['model']} differs from current model {self.embedding_model_name}"
                )

        if self.use_faiss:
            self._rebuild_faiss_index()

        return True


async def process_file_for_search(
    project_file: ProjectFile,
    vector_db: VectorDB,
    file_content: bytes,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    knowledge_base_id: Optional[UUID] = None,
) -> dict[str, Any]:
    """Process a file for similarity search."""
    from services.text_extraction import get_text_extractor

    text_extractor = get_text_extractor()

    try:
        if not project_file.project_id:
            raise ValueError("File must be associated with a project")

        # Extract text chunks
        text_chunks, metadata = await text_extractor.extract_text(
            file_content,
            filename=project_file.filename,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

        # Prepare metadata
        resolved_kb_id = knowledge_base_id or (
            project_file.project.knowledge_base.id
            if getattr(project_file, "project", None) and project_file.project.knowledge_base
            else None
        )

        if not resolved_kb_id:
            raise ValueError("Knowledge base ID is required")

        chunk_metadatas = []
        for i in range(len(text_chunks)):
            chunk_metadatas.append(
                {
                    "file_id": str(project_file.id),
                    "project_id": str(project_file.project_id),
                    "knowledge_base_id": str(resolved_kb_id),
                    "chunk_index": i,
                    "total_chunks": len(text_chunks),
                    "file_name": project_file.filename,
                    "file_type": project_file.file_type,
                    "source": "project_file",
                }
            )

        # Add to vector database
        added_ids = await vector_db.add_documents(
            chunks=text_chunks,
            metadatas=chunk_metadatas,
            ids=[f"{project_file.id}_chunk_{i}" for i in range(len(text_chunks))],
        )

        return {
            "file_id": str(project_file.id),
            "chunk_count": len(text_chunks),
            "token_count": metadata.get("token_count", 0),
            "added_ids": added_ids,
            "success": True,
            "metadata": metadata,
        }

    except Exception as e:
        logger.error(f"Error processing file {project_file.filename}: {str(e)}")
        return {
            "file_id": str(project_file.id),
            "success": False,
            "error": str(e),
            "chunk_count": 0,
            "token_count": 0,
            "added_ids": [],
        }


async def search_context_for_query(
    query: str, vector_db: VectorDB, project_id: Optional[str] = None, top_k: int = 5
) -> List[dict[str, Any]]:
    """Search for relevant context for a query within a project."""
    filter_metadata = {"project_id": project_id} if project_id else None
    return await vector_db.search(
        query=query, top_k=top_k, filter_metadata=filter_metadata
    )


async def cleanup_project_resources(
    project_id: UUID, storage_root: str = VECTOR_DB_STORAGE_PATH
) -> bool:
    """Delete all vector resources for a project."""
    storage_path = os.path.join(storage_root, str(project_id))

    try:
        vector_db = await initialize_project_vector_db(
            project_id=project_id, storage_root=storage_root
        )

        await vector_db.delete_by_filter({"project_id": str(project_id)})

        if os.path.exists(storage_path):
            import shutil

            shutil.rmtree(storage_path)

        return True
    except Exception as e:
        logger.error(f"Failed to cleanup project vectors: {str(e)}")
        return False


async def process_files_for_project(
    project_id: UUID,
    file_ids: Optional[List[UUID]] = None,
    db: Optional[Any] = None,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> dict[str, Any]:
    """
    Batch process project files with progress tracking.

    If *db* is None we open/close our own AsyncSession so the
    helper is safe to call from background tasks.
    """
    if db is None:
        async with get_async_session_context() as session:
            return await process_files_for_project(
                project_id,
                file_ids=file_ids,
                db=session,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )

    # --------- existing body of the function goes here ---------
    from sqlalchemy import select

    # Initialize vector DB for project
    vector_db = await initialize_project_vector_db(project_id)

    # Initialize file storage
    from services.file_storage import get_file_storage, get_storage_config

    config = await get_storage_config()
    storage = get_file_storage(config)

    results: dict[str, Any] = {
        "processed": 0,  # int
        "failed": 0,  # int
        "errors": [],  # List[str]
        "details": [],  # List[dict[str, Any]]
    }

    # Get file records to process
    if db:
        query = select(ProjectFile).where(ProjectFile.project_id == project_id)
        if file_ids:
            query = query.where(ProjectFile.id.in_(file_ids))

        file_records = await db.execute(query)
        file_records = file_records.scalars().all()
    else:
        # If no DB session, we should at least have file IDs
        if not file_ids:
            return {
                "processed": 0,
                "failed": 0,
                "errors": ["Database session or file IDs required"],
                "details": [],
            }
        file_records = []

    # Process each file
    for file_record in file_records:
        try:
            # Get file content from storage
            content = await storage.get_file(file_record.file_path)

            # Process the file
            result = await process_file_for_search(
                project_file=file_record,
                vector_db=vector_db,
                file_content=content,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )

            # Track results
            results["details"].append(result)
            if result["success"]:
                results["processed"] += 1
            else:
                results["failed"] += 1
                if "error" in result:
                    results["errors"].append(
                        f"File {file_record.id}: {result['error']}"
                    )

        except Exception as e:
            results["failed"] += 1
            results["errors"].append(f"File {file_record.id}: {str(e)}")
            logger.error(f"Error processing file {file_record.id}: {str(e)}")

    return results

async def get_vector_db(
    model_name: str, storage_path: str, load_existing: bool = True
) -> VectorDB:
    """
    Creates a new VectorDB instance given a model name and storage path.
    Optionally loads existing data from disk if load_existing is True.
    """
    vdb = VectorDB(
        embedding_model=model_name, use_faiss=True, storage_path=storage_path
    )
    if load_existing:
        await vdb.load_from_disk()
    return vdb


async def initialize_project_vector_db(
    project_id: UUID,
    storage_root: str = VECTOR_DB_STORAGE_PATH,
    embedding_model: Optional[str] = None,
) -> VectorDB:
    """
    Initializes a VectorDB for a project, loading from disk if an index file is present.
    Delegates to VectorDBManager.get_for_project for canonical logic.
    """
    from services.knowledgebase_helpers import VectorDBManager   # import locally to avoid circulars
    return await VectorDBManager.get_for_project(
        project_id=project_id,
        model_name=embedding_model,   # may be None ➜ manager resolves default / KB setting
        db=None,                      # legacy wrapper keeps same public API
    )

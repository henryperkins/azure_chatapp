"""
vector_db.py
-----------
Service for handling vector embeddings and similarity search functionality.
Supports different embedding models and both in-memory and database storage.

IMPORTANT:
- All documents require project_id, knowledge_base_id, and file_id in metadata
- Search filters should always include both project_id and knowledge_base_id
"""

import logging
import json
import os
import uuid
from typing import List, Dict, Any, Optional

import numpy as np
import httpx

from models.project_file import ProjectFile

logger = logging.getLogger(__name__)

# Optional dependencies
SENTENCE_TRANSFORMERS_AVAILABLE = False
FAISS_AVAILABLE = False
SKLEARN_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer

    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    logger.warning(
        "sentence-transformers not installed. Install with 'pip install sentence-transformers' "
        "for local embedding generation"
    )

try:
    import faiss

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

        # Initialize FAISS if available
        self.faiss = faiss if self.use_faiss else None
        if self.use_faiss and not self.faiss:
            logger.warning("FAISS import failed despite FAISS_AVAILABLE=True")
            self.use_faiss = False

        # Initialize embedding model if available
        self.embedding_model = None
        if SENTENCE_TRANSFORMERS_AVAILABLE and embedding_model:
            try:
                self.embedding_model = SentenceTransformer(embedding_model)
                logger.info(f"Initialized local embedding model: {embedding_model}")
            except Exception as e:
                logger.error(
                    f"Error initializing embedding model {embedding_model}: {str(e)}"
                )
                raise VectorDBError(f"Failed to initialize embedding model: {str(e)}")
        else:
            logger.info(f"Using external embedding API for model: {embedding_model}")

        # In-memory storage for vectors and metadata
        self.vectors: Dict[str, List[float]] = {}  # doc_id -> vector
        self.metadata: Dict[str, Dict[str, Any]] = {}  # doc_id -> metadata

        # FAISS index (if used)
        self.index = None
        self.id_map: List[str] = []  # Maps FAISS internal indices to document IDs

    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings for the current model."""
        if self.embedding_model and hasattr(
            self.embedding_model, "get_sentence_embedding_dimension"
        ):
            dim = self.embedding_model.get_sentence_embedding_dimension()
            if dim is not None:
                return dim

        # Default fallback dimension for known or unknown models
        if self.embedding_model_name == "text-embedding-3-small":
            return 1536
        elif self.embedding_model_name == "text-embedding-3-large":
            return 3072
        elif self.embedding_model_name == "embed-english-v3.0":
            return 1024
        return 384  # Default for all-MiniLM-L6-v2

    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of text chunks."""
        if not texts:
            return []

        try:
            # Local model?
            if self.embedding_model and hasattr(self.embedding_model, "encode"):
                return await self._generate_local_embeddings(texts)
            # Otherwise, use external API
            return await self._generate_api_embeddings(texts)
        except Exception as e:
            logger.error(f"Error generating embeddings: {str(e)}")
            raise VectorDBError(f"Failed to generate embeddings: {str(e)}")

    async def _generate_local_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using local sentence-transformers model."""
        try:
            if self.embedding_model and hasattr(self.embedding_model, "encode"):
                embeddings = self.embedding_model.encode(texts)
            else:
                raise VectorDBError("Embedding model not properly initialized")
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
            elif settings.EMBEDDING_API == "cohere":
                return await self._generate_cohere_embeddings(texts)
            else:
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
        metadatas: Optional[List[Dict[str, Any]]] = None,
        ids: Optional[List[str]] = None,
        batch_size: int = 100,
    ) -> List[str]:
        """Add documents in batches to the vector database."""
        if not chunks:
            return []

        # Generate IDs if not provided
        if ids is None:
            ids = [str(uuid.uuid4()) for _ in range(len(chunks))]

        # Use empty metadata if not provided
        if metadatas is None:
            metadatas = [{} for _ in range(len(chunks))]

        # Validate required metadata fields
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

        successful_ids = []

        # Process in batches
        for i in range(0, len(chunks), batch_size):
            batch_end = min(i + batch_size, len(chunks))
            batch_chunks = chunks[i:batch_end]
            batch_metadatas = metadatas[i:batch_end]
            batch_ids = ids[i:batch_end]

            try:
                batch_results = await self._process_document_batch(
                    batch_chunks, batch_metadatas, batch_ids
                )
                successful_ids.extend(batch_results)
            except Exception as e:
                logger.error(f"Error processing batch {i // batch_size}: {str(e)}")

        # Save to disk if we have a storage path
        if self.storage_path and successful_ids:
            await self._save_to_disk()

        return successful_ids

    async def _process_document_batch(
        self, chunks: List[str], metadatas: List[Dict[str, Any]], ids: List[str]
    ) -> List[str]:
        """Process a single batch of documents."""
        embeddings = await self.generate_embeddings(chunks)
        if not embeddings:
            return []

        successful_ids = []
        for i, (doc_id, embedding, metadata) in enumerate(
            zip(ids, embeddings, metadatas)
        ):
            self.vectors[doc_id] = embedding
            self.metadata[doc_id] = {**metadata, "text": chunks[i]}
            successful_ids.append(doc_id)

        # Update FAISS index if used
        if self.use_faiss and FAISS_AVAILABLE and embeddings:
            try:
                self._update_faiss_index(embeddings, ids)
            except Exception as e:
                logger.error(f"Error updating FAISS index: {str(e)}")
                raise VectorDBError(f"Failed to update FAISS index: {str(e)}") from e

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
                dimension = embeddings_np.shape[1]
                self.index = faiss.IndexFlatL2(dimension)  # type: ignore

            if self.index is not None and embeddings_np.size > 0:
                self.index.add(embeddings_np)  # type: ignore

            self.id_map.extend(ids)
        except Exception as e:
            logger.error(f"Error updating FAISS index: {str(e)}")

    async def search(
        self,
        query: str,
        top_k: int = 5,
        filter_metadata: Optional[Dict[str, Any]] = None,
        query_expansion: bool = True,
    ) -> List[Dict[str, Any]]:
        """Search for documents similar to the query text."""
        if not query:
            raise VectorDBError("Query cannot be empty")

        try:
            query_embedding = await self.generate_embeddings([query])
            if not query_embedding or not query_embedding[0]:
                raise VectorDBError("Failed to generate embedding for query")

            query_vector = query_embedding[0]

            # Use FAISS if available
            if self.use_faiss and FAISS_AVAILABLE and self.index and self.id_map:
                return await self._search_with_faiss(
                    query_vector, top_k, filter_metadata
                )
            # Otherwise fallback to scikit-learn if available
            elif SKLEARN_AVAILABLE:
                return await self._search_with_sklearn(
                    query_vector, top_k, filter_metadata
                )
            else:
                return await self._search_manual(query_vector, top_k, filter_metadata)
        except Exception as e:
            logger.error(f"Search failed: {str(e)}")
            raise VectorDBError(f"Search operation failed: {str(e)}") from e

    async def _search_with_faiss(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """FAISS-based similarity search implementation."""
        results = []
        query_np = np.array([query_vector], dtype=np.float32)
        k = min(top_k, len(self.id_map))

        try:
            distances, indices = self.index.search(query_np, k)  # type: ignore
            if (
                distances is not None
                and indices is not None
                and len(distances) > 0
                and len(indices) > 0
            ):
                for dist, idx in zip(distances[0], indices[0]):
                    if 0 <= idx < len(self.id_map):
                        doc_id = self.id_map[idx]
                        if doc_id in self.metadata:
                            # Convert L2 distance to a rough similarity score
                            score = max(0.0, 1.0 - (dist / 100.0))
                            if filter_metadata and not self._matches_filter(
                                self.metadata[doc_id], filter_metadata
                            ):
                                continue
                            results.append(self._format_result(doc_id, score))
        except Exception as e:
            logger.error(f"FAISS search failed: {str(e)}")
            raise VectorDBError(f"Search operation failed: {str(e)}") from e

        return results

    async def _search_with_sklearn(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """scikit-learn based cosine similarity search."""
        ids = list(self.vectors.keys())
        vectors = [self.vectors[d_id] for d_id in ids]
        if not vectors:
            return []

        vectors_np = np.array(vectors)
        query_np = np.array([query_vector])

        # Use cosine_similarity from scikit-learn
        similarities = cosine_similarity(query_np, vectors_np)[0]  # type: ignore

        id_score_pairs = [
            (doc_id, float(score)) for doc_id, score in zip(ids, similarities)
        ]
        id_score_pairs.sort(key=lambda x: x[1], reverse=True)

        results = []
        for doc_id, score in id_score_pairs:
            if doc_id in self.metadata:
                if filter_metadata and not self._matches_filter(
                    self.metadata[doc_id], filter_metadata
                ):
                    continue
                results.append(self._format_result(doc_id, score))

            if len(results) >= top_k:
                break

        return results

    async def _search_manual(
        self,
        query_vector: List[float],
        top_k: int,
        filter_metadata: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Manual cosine similarity as a fallback if FAISS/scikit-learn are unavailable."""
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
            if norm1 > 0 and norm2 > 0:
                return dot_product / (norm1 * norm2)
            return 0.0
        except Exception as e:
            logger.error(f"Error calculating similarity: {str(e)}")
            return 0.0

    def _format_result(self, doc_id: str, score: float) -> Dict[str, Any]:
        """Format search result for consistent output."""
        return {
            "id": doc_id,
            "text": self.metadata[doc_id].get("text", ""),
            "score": float(score),
            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"},
        }

    def _matches_filter(
        self, metadata: Dict[str, Any], filter_criteria: Dict[str, Any]
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

        if self.use_faiss and FAISS_AVAILABLE and deleted_count > 0:
            self._rebuild_faiss_index()

        if self.storage_path and deleted_count > 0:
            await self._save_to_disk()

        return deleted_count

    def _rebuild_faiss_index(self) -> None:
        """Rebuild the FAISS index after deletions."""
        if not (self.use_faiss and FAISS_AVAILABLE):
            return

        remaining_ids = list(self.vectors.keys())
        remaining_vectors = [self.vectors[d_id] for d_id in remaining_ids]
        if remaining_vectors:
            vectors_np = np.array(remaining_vectors, dtype=np.float32)
            dimension = vectors_np.shape[1]
            self.index = faiss.IndexFlatL2(dimension)  # type: ignore
            if vectors_np.size > 0:
                self.index.add(vectors_np)  # type: ignore
            self.id_map = remaining_ids
        else:
            self.index = None
            self.id_map = []

    async def delete_by_filter(self, filter_metadata: Dict[str, Any]) -> int:
        """Delete documents matching a given filter."""
        if not filter_metadata:
            return 0

        ids_to_delete = []
        for doc_id, meta in self.metadata.items():
            if self._matches_filter(meta, filter_metadata):
                ids_to_delete.append(doc_id)

        return await self.delete_by_ids(ids_to_delete)

    async def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get a document by its ID."""
        if doc_id not in self.metadata:
            return None

        return {
            "id": doc_id,
            "text": self.metadata[doc_id].get("text", ""),
            "metadata": {k: v for k, v in self.metadata[doc_id].items() if k != "text"},
            "vector": self.vectors.get(doc_id),
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

        try:
            with open(self.storage_path, "r") as f:
                data = json.load(f)

            if data.get("model") != self.embedding_model_name:
                logger.warning(
                    f"Model mismatch in saved data: {data.get('model')} vs {self.embedding_model_name}. "
                    "Using saved data anyway, but this may cause issues."
                )

            self.vectors = data.get("vectors", {})
            self.metadata = data.get("metadata", {})

            # Rebuild FAISS index if needed
            if self.use_faiss and FAISS_AVAILABLE and self.vectors:
                self._rebuild_faiss_index()

            return True
        except Exception as e:
            logger.error(f"Error loading vector DB from disk: {str(e)}")
            return False


# Public API functions
async def get_vector_db(
    model_name: str = "all-MiniLM-L6-v2",
    use_faiss: bool = True,
    storage_path: Optional[str] = None,
    load_existing: bool = True,
) -> VectorDB:
    """Get or create a vector database instance."""
    vector_db = VectorDB(
        embedding_model=model_name, use_faiss=use_faiss, storage_path=storage_path
    )

    if load_existing and storage_path and os.path.exists(storage_path):
        await vector_db.load_from_disk()

    return vector_db


async def process_file_for_search(
    project_file: ProjectFile,
    vector_db: VectorDB,
    file_content: bytes,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> Dict[str, Any]:
    """Process a file for similarity search by extracting chunks and storing them in the vector DB."""
    from services.text_extraction import get_text_extractor

    text_extractor = get_text_extractor()

    try:
        if not project_file.project_id:
            raise ValueError(
                "File must be associated with a project for vector storage"
            )

        # Extract text chunks
        text_chunks, metadata = text_extractor.extract_text(
            file_content,
            filename=project_file.filename,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

        # Attempt to resolve knowledge_base_id from the project
        knowledge_base_id = None
        if hasattr(project_file, "project") and project_file.project:
            if hasattr(project_file.project, "knowledge_base_id"):
                knowledge_base_id = project_file.project.knowledge_base_id

        chunk_metadatas = []
        for i in range(len(text_chunks)):
            meta = {
                "file_id": str(project_file.id),
                "project_id": str(project_file.project_id),
                "knowledge_base_id": (
                    str(knowledge_base_id) if knowledge_base_id else None
                ),
                "chunk_index": i,
                "total_chunks": len(text_chunks),
                "file_name": project_file.filename,
                "file_type": project_file.file_type,
                "source": "project_file",
            }
            # knowledge_base_id is required
            if not meta["knowledge_base_id"]:
                raise ValueError(
                    "Project must have an associated knowledge base for vector storage"
                )

            chunk_metadatas.append(meta)

        chunk_ids = [f"{project_file.id}_chunk_{i}" for i in range(len(text_chunks))]

        # Add chunks to vector database
        if text_chunks and chunk_metadatas:
            added_ids = await vector_db.add_documents(
                chunks=text_chunks, metadatas=chunk_metadatas, ids=chunk_ids
            )
            return {
                "file_id": str(project_file.id),
                "chunk_count": len(text_chunks),
                "token_count": metadata.get("token_count", 0),
                "added_ids": added_ids,
                "success": True,
                "metadata": metadata,
            }
        else:
            return {
                "file_id": str(project_file.id),
                "chunk_count": 0,
                "token_count": 0,
                "added_ids": [],
                "success": False,
                "error": "No text chunks extracted",
                "metadata": metadata,
            }

    except Exception as e:
        logger.error(
            f"Error processing file {project_file.filename} for search: {str(e)}"
        )
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
) -> List[Dict[str, Any]]:
    """Search for relevant context for a query within a project."""
    filter_metadata = {"project_id": project_id} if project_id else None
    results = await vector_db.search(
        query=query, top_k=top_k, filter_metadata=filter_metadata
    )
    return results

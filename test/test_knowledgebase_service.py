"""
test_knowledgebase_service.py
-----------------------------
Comprehensive tests for knowledge base functionality, covering:
- Knowledge base creation and management
- File upload processing
- Vector storage and retrieval
- Search capabilities
- Token management
"""

import os
import asyncio
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from datetime import datetime
from uuid import UUID, uuid4
from io import BytesIO

from fastapi import HTTPException, BackgroundTasks, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from services.knowledgebase_service import (
    create_knowledge_base,
    upload_file_to_project,
    delete_project_file,
    search_project_context,
    get_kb_status,
    get_knowledge_base_health,
    get_project_files_stats,
    ensure_project_has_knowledge_base,
    process_single_file_for_search,
    toggle_project_kb,
)
from models.project import Project
from models.knowledge_base import KnowledgeBase
from models.project_file import ProjectFile
from models.user import User
from utils.file_validation import FileValidator


# -------------------------------------------------------------
# Fixtures
# -------------------------------------------------------------

@pytest.fixture
def mock_db():
    """Create a mock database session"""
    db = AsyncMock(spec=AsyncSession)
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.get = AsyncMock()
    db.scalar = AsyncMock()
    db.delete = AsyncMock()
    return db


@pytest.fixture
def mock_project():
    """Create a mock project"""
    project = MagicMock(spec=Project)
    project.id = uuid4()
    project.name = "Test Project"
    project.knowledge_base_id = None
    project.token_usage = 0
    project.max_tokens = 1000000
    return project


@pytest.fixture
def mock_kb():
    """Create a mock knowledge base"""
    kb = MagicMock(spec=KnowledgeBase)
    kb.id = uuid4()
    kb.name = "Test Knowledge Base"
    kb.embedding_model = "all-MiniLM-L6-v2"
    kb.is_active = True
    kb.project_id = uuid4()
    kb.created_at = datetime.now()
    return kb


@pytest.fixture
def mock_file_record():
    """Create a mock project file record"""
    file = MagicMock(spec=ProjectFile)
    file.id = uuid4()
    file.project_id = uuid4()
    file.filename = "test_file.txt"
    file.file_path = f"/uploads/{file.id}/test_file.txt"
    file.file_type = "text"
    file.file_size = 1024
    file.created_at = datetime.now()
    file.config = {
        "token_count": 150,
        "file_extension": "txt",
        "search_processing": {
            "status": "success",
            "chunk_count": 2,
            "processed_at": datetime.now().isoformat()
        }
    }
    return file


@pytest.fixture
def mock_user():
    """Create a mock user"""
    user = MagicMock(spec=User)
    user.id = 1
    user.email = "test@example.com"
    return user


@pytest.fixture
def mock_upload_file():
    """Create a mock uploaded file"""
    content = b"This is test content for the file upload test."
    file = MagicMock(spec=UploadFile)
    file.filename = "test.txt"
    file.file = BytesIO(content)
    file.content_type = "text/plain"
    file.size = len(content)

    # Add read method that simulates file-like behavior
    async def mock_read():
        file.file.seek(0)
        return file.file.read()

    file.read = mock_read
    file.seek = AsyncMock()

    return file


@pytest.fixture
def mock_background_tasks():
    """Create a mock background tasks"""
    tasks = MagicMock(spec=BackgroundTasks)
    tasks.add_task = MagicMock()
    return tasks


@pytest.fixture
def mock_storage():
    """Create a mock storage manager"""
    storage = MagicMock()
    storage.save_file = AsyncMock(return_value="/uploads/test-file.txt")
    storage.get_file = AsyncMock(return_value=b"File content")
    storage.delete_file = AsyncMock(return_value=True)
    return storage


@pytest.fixture
def mock_vector_db():
    """Create a mock vector database"""
    vector_db = MagicMock()
    vector_db.search = AsyncMock(return_value=[
        {
            "id": "chunk-1",
            "score": 0.92,
            "text": "This is a matching text chunk",
            "metadata": {
                "file_id": str(uuid4()),
                "chunk_index": 0
            }
        }
    ])
    vector_db.delete_by_filter = AsyncMock()
    vector_db.get_knowledge_base_status = AsyncMock(return_value={
        "vector_count": 10,
        "embedding_model": "all-MiniLM-L6-v2",
        "dimensions": 384,
        "index_status": "ready"
    })
    return vector_db


# -------------------------------------------------------------
# Knowledge Base Creation Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_knowledge_base(mock_db, mock_project):
    """Test creating a new knowledge base"""
    mock_db.get.return_value = mock_project

    with patch("services.knowledgebase_service.get_by_id", new=AsyncMock(return_value=mock_project)), \
         patch("services.knowledgebase_service.save_model", new=AsyncMock()) as mock_save:

        kb = await create_knowledge_base(
            name="Test KB",
            project_id=mock_project.id,
            description="Test description",
            db=mock_db
        )

        # Verify KB was created with expected values
        assert kb.name == "Test KB"
        assert kb.description == "Test description"
        assert kb.project_id == mock_project.id
        assert kb.is_active is True

        # Verify it was saved to DB twice (once for KB, once for project)
        assert mock_save.call_count == 2


@pytest.mark.asyncio
async def test_create_kb_project_not_found(mock_db):
    """Test creating a KB with non-existent project"""
    with patch("services.knowledgebase_service.get_by_id", new=AsyncMock(return_value=None)):
        with pytest.raises(ValueError, match="Project not found"):
            await create_knowledge_base(
                name="Test KB",
                project_id=uuid4(),
                db=mock_db
            )


@pytest.mark.asyncio
async def test_create_kb_already_exists(mock_db, mock_project):
    """Test creating a KB when project already has one"""
    mock_project.knowledge_base_id = uuid4()

    with patch("services.knowledgebase_service.get_by_id", new=AsyncMock(return_value=mock_project)):
        with pytest.raises(ValueError, match="Project already has a knowledge base"):
            await create_knowledge_base(
                name="Test KB",
                project_id=mock_project.id,
                db=mock_db
            )


# -------------------------------------------------------------
# File Upload Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_upload_file_to_project(
    mock_db, mock_project, mock_kb, mock_upload_file,
    mock_background_tasks, mock_storage
):
    """Test uploading a file to a project"""
    mock_project.knowledge_base_id = mock_kb.id

    # Setup mocks
    with patch("services.knowledgebase_service._validate_project_and_kb",
              new=AsyncMock(return_value=(mock_project, mock_kb))), \
         patch("services.knowledgebase_service._process_upload_file_info",
              new=AsyncMock(return_value={
                  "sanitized_filename": "test.txt",
                  "file_ext": "txt",
                  "file_type": "text"
              })), \
         patch("services.knowledgebase_service._estimate_file_tokens",
              new=AsyncMock(return_value={
                  "token_estimate": 100,
                  "metadata": {"encoding": "utf-8"}
              })), \
         patch("services.knowledgebase_service.StorageManager.get",
              return_value=mock_storage), \
         patch("services.knowledgebase_service._store_uploaded_file",
              new=AsyncMock(return_value="/uploads/test.txt")), \
         patch("services.knowledgebase_service._create_file_record",
              new=AsyncMock(return_value=mock_file_record())) as mock_create_record, \
         patch("services.knowledgebase_service.save_model",
              new=AsyncMock()) as mock_save, \
         patch("services.knowledgebase_service.TokenManager.update_usage",
              new=AsyncMock()) as mock_update_tokens:

        result = await upload_file_to_project(
            project_id=mock_project.id,
            file=mock_upload_file,
            db=mock_db,
            background_tasks=mock_background_tasks
        )

        # Verify file record was created and saved
        assert mock_save.called

        # Verify tokens were updated
        assert mock_update_tokens.called

        # Verify background processing was scheduled
        assert mock_background_tasks.add_task.called

        # Verify result contains file metadata
        assert result["filename"] == "test_file.txt"
        assert result["file_type"] == "text"


@pytest.mark.asyncio
async def test_upload_file_exceeds_token_limit(mock_db, mock_project, mock_kb, mock_upload_file):
    """Test uploading a file that would exceed token limit"""
    mock_project.token_usage = 900000
    mock_project.max_tokens = 1000000

    with patch("services.knowledgebase_service._validate_project_and_kb",
              new=AsyncMock(return_value=(mock_project, mock_kb))), \
         patch("services.knowledgebase_service._process_upload_file_info",
              new=AsyncMock(return_value={
                  "sanitized_filename": "test.txt",
                  "file_ext": "txt",
                  "file_type": "text"
              })), \
         patch("services.knowledgebase_service._estimate_file_tokens",
              new=AsyncMock(return_value={
                  "token_estimate": 150000,  # Would exceed limit
                  "metadata": {"encoding": "utf-8"}
              })):

        with pytest.raises(ValueError, match="would exceed the project's token limit"):
            await upload_file_to_project(
                project_id=mock_project.id,
                file=mock_upload_file,
                db=mock_db
            )


# -------------------------------------------------------------
# File Deletion Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_project_file(mock_db, mock_project, mock_file_record, mock_storage):
    """Test deleting a project file"""
    file_id = mock_file_record.id
    mock_project.knowledge_base_id = uuid4()

    with patch("services.knowledgebase_service._validate_file_access",
              new=AsyncMock(return_value=(mock_project, mock_file_record))), \
         patch("services.knowledgebase_service.StorageManager.get",
              return_value=mock_storage), \
         patch("services.knowledgebase_service._delete_file_from_storage",
              new=AsyncMock(return_value="success")) as mock_delete_storage, \
         patch("services.knowledgebase_service._delete_file_vectors",
              new=AsyncMock()) as mock_delete_vectors, \
         patch("services.knowledgebase_service.TokenManager.update_usage",
              new=AsyncMock()) as mock_update_tokens:

        result = await delete_project_file(
            project_id=mock_project.id,
            file_id=file_id,
            db=mock_db
        )

        # Verify file was deleted from storage
        assert mock_delete_storage.called

        # Verify vectors were deleted
        assert mock_delete_vectors.called

        # Verify tokens were updated (decreased)
        assert mock_update_tokens.called

        # Verify DB record was deleted
        assert mock_db.delete.called

        # Check response
        assert result["success"] is True
        assert result["file_id"] == str(file_id)


@pytest.mark.asyncio
async def test_delete_file_not_found(mock_db, mock_project):
    """Test deleting a non-existent file"""
    with patch("services.knowledgebase_service._validate_file_access",
              new=AsyncMock(return_value=(mock_project, None))):

        with pytest.raises(HTTPException) as excinfo:
            await delete_project_file(
                project_id=mock_project.id,
                file_id=uuid4(),
                db=mock_db
            )

        assert excinfo.value.status_code == 404
        assert "File not found" in str(excinfo.value.detail)


# -------------------------------------------------------------
# Search and Knowledge Base Query Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_search_project_context(mock_db, mock_project, mock_vector_db):
    """Test searching project context"""
    mock_project.knowledge_base_id = uuid4()
    mock_project.knowledge_base = MagicMock()
    mock_project.knowledge_base.embedding_model = "all-MiniLM-L6-v2"

    with patch("services.knowledgebase_service._validate_user_and_project",
              new=AsyncMock(return_value=mock_project)), \
         patch("services.knowledgebase_service.VectorDBManager.get_for_project",
              new=AsyncMock(return_value=mock_vector_db)), \
         patch("services.knowledgebase_service._execute_search",
              new=AsyncMock(return_value=[{
                  "id": "chunk-1",
                  "score": 0.92,
                  "text": "This is a matching text chunk",
                  "metadata": {"file_id": str(uuid4())}
              }])), \
         patch("services.knowledgebase_service._enhance_with_file_info",
              new=AsyncMock(return_value=[{
                  "id": "chunk-1",
                  "score": 0.92,
                  "text": "This is a matching text chunk",
                  "metadata": {"file_id": str(uuid4())},
                  "file_info": {
                      "filename": "test.txt",
                      "file_type": "text",
                      "file_size": 1024,
                      "created_at": datetime.now().isoformat()
                  }
              }])) as mock_enhance:

        result = await search_project_context(
            project_id=mock_project.id,
            query="test query",
            db=mock_db,
            top_k=5
        )

        # Verify search was enhanced with file info
        assert mock_enhance.called

        # Check response
        assert result["query"] == "test query"
        assert len(result["results"]) == 1
        assert result["result_count"] == 1


@pytest.mark.asyncio
async def test_search_invalid_query(mock_db, mock_project):
    """Test searching with invalid query"""
    # Test with empty query
    with pytest.raises(ValueError) as excinfo:
        await search_project_context(
            project_id=mock_project.id,
            query="",
            db=mock_db
        )
    assert "Query must be at least 2 characters" in str(excinfo.value)

    # Test with single character
    with pytest.raises(ValueError) as excinfo:
        await search_project_context(
            project_id=mock_project.id,
            query="a",
            db=mock_db
        )
    assert "Query must be at least 2 characters" in str(excinfo.value)


# -------------------------------------------------------------
# KB Status Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_kb_status_exists(mock_db, mock_project, mock_kb):
    """Test getting KB status when KB exists"""
    mock_project.knowledge_base_id = mock_kb.id

    with patch("services.knowledgebase_service.get_by_id", side_effect=[mock_project, mock_kb]):
        status = await get_kb_status(mock_project.id, mock_db)

        assert status["exists"] is True
        assert status["isActive"] is True
        assert status["project_id"] == str(mock_project.id)


@pytest.mark.asyncio
async def test_get_kb_status_not_exists(mock_db, mock_project):
    """Test getting KB status when KB doesn't exist"""
    mock_project.knowledge_base_id = None

    with patch("services.knowledgebase_service.get_by_id", return_value=mock_project):
        status = await get_kb_status(mock_project.id, mock_db)

        assert status["exists"] is False
        assert status["isActive"] is False
        assert status["project_id"] == str(mock_project.id)


# -------------------------------------------------------------
# Dependency Management Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_process_single_file_with_missing_dependencies(mock_db, mock_file_record, mock_vector_db):
    """Test processing a file with missing dependencies"""
    file_id = mock_file_record.id
    project_id = UUID('3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd')
    kb_id = uuid4()

    mock_storage = MagicMock()
    mock_storage.get_file = AsyncMock(return_value=b"File content")

    # Test proper error handling when text extraction dependencies are missing
    with patch("services.knowledgebase_service.get_by_id", return_value=mock_file_record), \
         patch("services.knowledgebase_service.StorageManager.get", return_value=mock_storage), \
         patch("services.knowledgebase_service.VectorDBManager.get_for_project", return_value=mock_vector_db), \
         patch("services.knowledgebase_service.process_file_for_search",
              new=AsyncMock(return_value={"success": False, "error": "Missing library: docx"})), \
         patch("services.knowledgebase_service.save_model", new=AsyncMock()) as mock_save:

        await process_single_file_for_search(
            file_id=file_id,
            project_id=project_id,
            knowledge_base_id=kb_id,
            db=mock_db
        )

        # Verify file record was updated with error status
        assert mock_save.called

        # Check the file record config was updated with error
        file_config = mock_file_record.config
        assert file_config["search_processing"]["status"] == "error"
        assert "error" in file_config["search_processing"]


# -------------------------------------------------------------
# Transaction Tests
# -------------------------------------------------------------

@pytest.mark.asyncio
async def test_ensure_knowledge_base_with_race_condition(mock_db, mock_project, mock_kb):
    """Test ensuring KB with simulated race condition (another process creates KB)"""
    # Initially project has no KB
    mock_project.knowledge_base_id = None

    # First call to create_knowledge_base should throw an error simulating conflict
    create_kb_mock = AsyncMock(side_effect=[
        ValueError("Conflict: Another process created a KB"),  # First call fails
        mock_kb  # Second call succeeds (after retry)
    ])

    with patch("services.knowledgebase_service._validate_user_and_project", return_value=mock_project), \
         patch("services.knowledgebase_service.create_knowledge_base", new=create_kb_mock):

        # This should gracefully handle the race condition
        result = await ensure_project_has_knowledge_base(
            project_id=mock_project.id,
            db=mock_db
        )

        # Verify we got a KB despite the race condition
        assert result is not None
        assert result == mock_kb


if __name__ == "__main__":
    pytest.main(["-xvs", __file__])

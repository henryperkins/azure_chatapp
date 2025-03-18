"""
knowledgebase_service.py
------------------------
Contains logic for managing ProjectFile entries (knowledge base files) in a dedicated layer:
 - Validation of file uploads
 - Upload to local or cloud storage
 - Database interactions for ProjectFile (create, read, delete)
"""
import os
import hashlib
from uuid import UUID
from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from models.project_file import ProjectFile
from models.project import Project

# Increase to 30MB as per plan
MAX_FILE_BYTES = 30_000_000  # 30MB

# Expanded allowed file extensions per project plan
ALLOWED_FILE_EXTENSIONS = {
    ".txt", ".pdf", ".doc", ".docx", ".csv", ".json",
    ".js", ".html", ".css", ".py", ".md"
}

def validate_file_extension(filename: str) -> bool:
    """Validates that a filename has an allowed extension"""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_FILE_EXTENSIONS

# Simple token estimation function
def estimate_tokens_from_file(content: bytes, filename: str) -> int:
    """Estimates the number of tokens in file content.
    
    This is a simple estimation - for production, use a proper tokenizer like tiktoken.
    """
    try:
        # Try to decode as text
        text_content = content.decode('utf-8')
        # Rough estimate: 1 token ~= 4 characters for English text
        return len(text_content) // 4
    except UnicodeDecodeError:
        # For binary files, use a rougher estimate based on size
        return len(content) // 8  # Very rough estimate for binary files

async def upload_file_to_project(
    project_id: UUID,
    file: UploadFile,
    db: AsyncSession,
    uploads_dir: str = "./uploads"
) -> ProjectFile:
    """
    Handles uploading the file to local storage and creating the ProjectFile record.
    Performs validation on file size and type.
    Updates project token usage tracking.
    """
    # Validate file extension
    if not validate_file_extension(file.filename):
        raise HTTPException(
            status_code=400, 
            detail=f"File type not allowed. Supported types: {', '.join(ALLOWED_FILE_EXTENSIONS)}"
        )
    
    # Read file content
    contents = await file.read()
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large (>{MAX_FILE_BYTES/1_000_000}MB).")
    
    # Generate file hash for storage
    file_hash = hashlib.sha256(contents).hexdigest()[:12]
    os.makedirs(uploads_dir, exist_ok=True)
    file_path = os.path.join(
        uploads_dir, f"{project_id}_{file_hash}_{file.filename}"
    )
    
    # Estimate tokens
    token_estimate = estimate_tokens_from_file(contents, file.filename)
    
    # Get project to check token limits
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalars().first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if adding this file would exceed token limit
    if project.token_usage + token_estimate > project.max_tokens:
        raise HTTPException(
            status_code=400, 
            detail=f"Adding this file would exceed the project's token limit of {project.max_tokens}"
        )
    
    # Write file to disk
    with open(file_path, "wb") as f:
        f.write(contents)
    
    # Create new ProjectFile record
    pf = ProjectFile(
        project_id=project_id,
        filename=file.filename,
        file_path=file_path,  # Using consistent field name
        file_size=len(contents),
        file_type=os.path.splitext(file.filename)[1][1:],  # Remove the dot
        order_index=0,  # Default order
        metadata={"token_estimate": token_estimate}  # Store token estimate in metadata
    )
    
    db.add(pf)
    
    # Update project token usage
    project.token_usage += token_estimate
    
    await db.commit()
    await db.refresh(pf)
    return pf

async def list_project_files(project_id: UUID, db: AsyncSession):
    """
    Retrieves all files associated with the given project.
    """
    query = select(ProjectFile).where(ProjectFile.project_id == project_id)
    result = await db.execute(query)
    return result.scalars().all()

async def get_project_file(project_id: UUID, file_id: UUID, db: AsyncSession):
    """
    Retrieve a specific file record for the given project.
    """
    query = select(ProjectFile).where(
        ProjectFile.id == file_id,
        ProjectFile.project_id == project_id
    )
    result = await db.execute(query)
    return result.scalars().first()

async def delete_project_file(project_id: UUID, file_id: UUID, db: AsyncSession):
    """
    Deletes the file from local storage and removes the DB record.
    Also updates the project token usage.
    """
    # Get file record
    file_record = await get_project_file(project_id, file_id, db)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get token estimate from metadata
    token_estimate = 0
    if file_record.metadata and "token_estimate" in file_record.metadata:
        token_estimate = file_record.metadata["token_estimate"]
    
    # Get project to update token usage
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalars().first()
    
    # Delete the physical file if it exists
    if file_record.file_path and os.path.exists(file_record.file_path):
        try:
            os.remove(file_record.file_path)
        except OSError as e:
            # Log error but continue with DB deletion
            print(f"Error deleting file: {e}")
    
    # Delete the database record
    await db.execute(
        delete(ProjectFile).where(ProjectFile.id == file_id)
    )
    
    # Update project token usage if project exists
    if project and token_estimate > 0:
        project.token_usage = max(0, project.token_usage - token_estimate)  # Ensure we don't go below 0
    
    await db.commit()
    return {"success": True, "message": "File deleted successfully"}
# Code Duplication Analysis & Refactoring Plan

After thorough analysis of the codebase, I've identified several areas of code duplication across both backend and frontend components. Here's a comprehensive plan to refactor these duplications without creating new modules or implementing new features.

## 1. Backend Service Layer Duplication

### 1.1. Common Patterns Found

| Pattern | Description | Affected Files |
|---------|-------------|----------------|
| Project Access Validation | Repeated code for checking project existence and user permissions | `project_service.py`, `artifact_service.py`, `knowledgebase_service.py` |
| Resource Validation | Similar patterns for validating sub-resources (artifacts, files) | `artifact_service.py`, `knowledgebase_service.py` |
| DB Query Patterns | Duplicate pagination, sorting, and filtering logic | All service files |
| Error Handling | Similar HTTP exception patterns | All service files |
| Stats Collection | Repeated pattern for aggregating resource statistics | `project_service.py`, `artifact_service.py`, `knowledgebase_service.py` |

### 1.2. Refactoring Plan for Backend Services

#### Consolidate Resource Access Validation in project_service.py

```python
# In project_service.py, enhance existing validate_project_access to be more reusable

async def validate_project_access(project_id: UUID, user: User, db: AsyncSession) -> Project:
    """
    Ensures the project with UUID-based ID belongs to the user and is not archived. 
    Raises HTTPException on access issues.
    """
    # Existing implementation (keep as is)
    
    return project

# Add a new generic resource validation function that other services can use
async def validate_resource_access(
    resource_id: UUID, 
    project_id: UUID, 
    user: User, 
    db: AsyncSession,
    model_class,
    resource_name: str = "Resource"
) -> Any:
    """
    Generic method for validating access to any project-related resource.
    All services can use this for artifacts, files, etc.
    
    Args:
        resource_id: UUID of the resource
        project_id: UUID of the project
        user: User object
        db: Database session
        model_class: The SQLAlchemy model class of the resource
        resource_name: Human-readable name for error messages
        
    Returns:
        The resource object if found and accessible
        
    Raises:
        HTTPException: If resource not found or user lacks permission
    """
    # First validate project access
    project = await validate_project_access(project_id, user, db)
    
    # Then check for the resource
    result = await db.execute(
        select(model_class).where(
            model_class.id == resource_id,
            model_class.project_id == project_id
        )
    )
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")
    
    return resource

# Add a generic paginated query function for reuse
async def get_paginated_resources(
    db: AsyncSession,
    model_class,
    project_id: UUID,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    additional_filters = None
):
    """
    Generic function for paginated queries of project resources with sorting.
    
    Args:
        db: Database session
        model_class: SQLAlchemy model class to query
        project_id: Project ID to filter by
        sort_by: Field to sort by
        sort_desc: True for descending order
        skip: Pagination offset
        limit: Page size
        additional_filters: Optional additional filter conditions
        
    Returns:
        List of resources
    """
    # Build base query
    query = select(model_class).where(model_class.project_id == project_id)
    
    # Apply additional filters if provided
    if additional_filters:
        query = query.where(additional_filters)
    
    # Apply sorting
    if hasattr(model_class, sort_by):
        sort_field = getattr(model_class, sort_by)
        query = query.order_by(desc(sort_field) if sort_desc else asc(sort_field))
    else:
        # Default to created_at
        query = query.order_by(desc(model_class.created_at) if sort_desc else asc(model_class.created_at))
    
    # Apply pagination
    query = query.offset(skip).limit(limit)
    
    # Execute query
    result = await db.execute(query)
    return result.scalars().all()
```

#### Refactor artifact_service.py to use common functions

```python
# In artifact_service.py

# Replace duplicate validation code with calls to project_service
async def get_artifact(
    db: AsyncSession,
    artifact_id: UUID,
    project_id: UUID,
    user_id: Optional[int] = None
) -> Artifact:
    """Retrieve an artifact by ID."""
    
    # If user_id is provided, validate user's access to the project
    if user_id is not None:
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Use the shared validation function
        from services.project_service import validate_resource_access
        return await validate_resource_access(
            artifact_id, 
            project_id, 
            user, 
            db, 
            Artifact,
            "Artifact"
        )
    
    # If no user_id provided, just check if artifact exists in project
    result = await db.execute(
        select(Artifact).where(
            Artifact.id == artifact_id,
            Artifact.project_id == project_id
        )
    )
    artifact = result.scalars().first()
    
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    
    return artifact

# Refactor list_artifacts to use the shared pagination function
async def list_artifacts(
    project_id: UUID,
    db: AsyncSession,
    conversation_id: Optional[UUID] = None,
    content_type: Optional[str] = None,
    search_term: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True,
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """List artifacts with filtering, searching and pagination."""
    
    # Validate user's access to the project if user_id is provided
    if user_id is not None:
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        from services.project_service import validate_project_access
        await validate_project_access(project_id, user, db)
    
    # Build additional filters based on parameters
    additional_filters = None
    filters = []
    
    if conversation_id:
        filters.append(Artifact.conversation_id == conversation_id)
    
    if content_type:
        if content_type in ARTIFACT_TYPES:
            # If it's a main type, include all subtypes
            subtypes = ARTIFACT_TYPES[content_type]
            filters.append(or_(
                Artifact.content_type == content_type,
                Artifact.content_type.in_(subtypes)
            ))
        else:
            # Otherwise do exact match
            filters.append(Artifact.content_type == content_type)
    
    if search_term:
        # Search in name and content
        search_pattern = f"%{search_term}%"
        filters.append(or_(
            Artifact.name.ilike(search_pattern),
            Artifact.content.ilike(search_pattern)
        ))
    
    if filters:
        additional_filters = and_(*filters)
    
    # Use the shared pagination function
    from services.project_service import get_paginated_resources
    artifacts = await get_paginated_resources(
        db=db,
        model_class=Artifact,
        project_id=project_id,
        sort_by=sort_by,
        sort_desc=sort_desc,
        skip=skip,
        limit=limit,
        additional_filters=additional_filters
    )
    
    # Convert to list of dictionaries without full content
    artifact_list = []
    for artifact in artifacts:
        artifact_dict = {
            "id": str(artifact.id),
            "project_id": str(artifact.project_id),
            "conversation_id": str(artifact.conversation_id) if artifact.conversation_id else None,
            "name": artifact.name,
            "content_type": artifact.content_type,
            "created_at": artifact.created_at,
            "metadata": artifact.metadata,
            # Include a preview of content rather than full content
            "content_preview": artifact.content[:150] + "..." if len(artifact.content) > 150 else artifact.content
        }
        artifact_list.append(artifact_dict)
    
    return artifact_list
```

Similarly, refactor `knowledgebase_service.py` to use these common functions.

## 2. Frontend JavaScript Duplication

### 2.1. Common Patterns Found

| Pattern | Description | Affected Files |
|---------|-------------|----------------|
| Utility Functions | Same helper functions duplicated | `projectDashboard.js`, `projectManager.js` |
| API Request Handling | Similar fetch logic and error handling | All JS files |
| UI Rendering | Repeated project and artifact rendering logic | `projectDashboard.js`, `projectManager.js` |
| File Upload Logic | Duplicate upload handling | `projectDashboard.js`, `projectManager.js` |

### 2.2. Refactoring Plan for Frontend Code

#### Enhance formatting.js to be a central utility module

```javascript
// In formatting.js - consolidate all utility functions

/**
 * Format file size in bytes to human-readable format
 */
export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Calculate token usage percentage
 */
export function calculateTokenPercentage(tokenUsage, maxTokens) {
    return maxTokens > 0 ? Math.round((tokenUsage / maxTokens) * 100) : 0;
}

/**
 * Get icon class for file type
 */
export function getFileTypeIcon(fileType) {
    const iconMap = {
        txt: "fas fa-file-alt",
        pdf: "fas fa-file-pdf",
        doc: "fas fa-file-word",
        docx: "fas fa-file-word",
        xls: "fas fa-file-excel",
        xlsx: "fas fa-file-excel",
        ppt: "fas fa-file-powerpoint",
        pptx: "fas fa-file-powerpoint",
        csv: "fas fa-file-csv",
        json: "fas fa-file-code",
        xml: "fas fa-file-code",
        html: "fas fa-file-code",
        css: "fas fa-file-code",
        js: "fas fa-file-code",
        py: "fas fa-file-code",
        jpg: "fas fa-file-image",
        jpeg: "fas fa-file-image",
        png: "fas fa-file-image",
        gif: "fas fa-file-image",
        zip: "fas fa-file-archive",
        rar: "fas fa-file-archive",
        md: "fas fa-file-alt"
    };
    
    return iconMap[fileType.toLowerCase()] || "fas fa-file";
}

/**
 * Standard fetch API request with consistent error handling
 */
export async function apiRequest(url, method = 'GET', data = null, options = {}) {
    const defaultOptions = {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include"
    };
    
    const requestOptions = { ...defaultOptions, ...options };
    
    if (data && method !== 'GET' && !options.body) {
        requestOptions.body = JSON.stringify(data);
    }
    
    try {
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        
        // Handle both JSON and non-JSON responses
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error(`API request error for ${url}:`, error);
        
        // Use notification system if available
        if (window.showNotification) {
            window.showNotification(`Request failed: ${error.message}`, "error");
        }
        
        throw error;
    }
}

/**
 * Show a modal with the specified content
 */
export function showModal(content) {
    const modalEl = document.getElementById('modal') || createModalElement();
    const modalContentEl = modalEl.querySelector('.modal-content');
    
    modalContentEl.innerHTML = content;
    modalEl.classList.remove('hidden');
    
    // Ensure any close buttons work
    const closeButtons = modalEl.querySelectorAll('[onclick="closeModal()"]');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', () => closeModal());
    });
}

/**
 * Create a modal element if it doesn't exist
 */
function createModalElement() {
    const modalEl = document.createElement('div');
    modalEl.id = 'modal';
    modalEl.className = 'fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50';
    
    modalEl.innerHTML = `
        <div class="modal-content bg-white rounded-lg shadow-xl p-6 max-w-md w-full max-h-screen overflow-auto">
            <!-- Content will be inserted here -->
        </div>
    `;
    
    document.body.appendChild(modalEl);
    return modalEl;
}

/**
 * Close the modal
 */
export function closeModal() {
    const modalEl = document.getElementById('modal');
    if (modalEl) {
        modalEl.classList.add('hidden');
    }
}
```

#### Update projectDashboard.js to use the utility module

```javascript
// In projectDashboard.js - remove duplicate functions and import from formatting.js
import { formatBytes, calculateTokenPercentage, getFileTypeIcon, apiRequest, showModal, closeModal } from './formatting.js';

// Store the current active project
let currentProject = null;
let projectFiles = [];
let projectArtifacts = [];
let projectConversations = [];

// Initialize the dashboard when document is ready
document.addEventListener("DOMContentLoaded", () => {
    initProjectDashboard();
    setupEventListeners();
});

// The rest of the code remains the same, but replaces direct implementations with imported functions
async function loadProjects() {
    try {
        const data = await apiRequest("/api/projects");
        renderProjectList(data);
    } catch (error) {
        console.error("Error loading projects:", error);
    }
}

// Continue replacing other functions with calls to the shared utilities
```

Similarly, update `projectManager.js` to use the formatting.js utilities.

## 3. Route Handler Duplication

### 3.1. Refactoring Plan for Route Handlers

#### Enhance auth_deps.py with project validation

```python
# In utils/auth_deps.py

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
from models.user import User
from models.project import Project
from db import get_async_session
from services.project_service import validate_project_access

async def get_current_user_and_token():
    # Existing implementation
    pass

async def get_validated_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
) -> Project:
    """
    Dependency that validates project access for the current user.
    Can be used in any route that needs project validation.
    """
    return await validate_project_access(project_id, current_user, db)
```

#### Update project_routes.py to use the new dependency

```python
# In project_routes.py

from utils.auth_deps import get_current_user_and_token, get_validated_project

# Replace this:
@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == current_user.id)
    )
    proj = result.scalars().first()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    # Current user ID is a Column[int] from the model. Convert explicitly to int.
    # Remove cast usage entirely, rely on user.id being a normal int.
    # Pass the entire user object rather than user_id
    project = await validate_project_access(project_id, current_user, db)
    return project

# With this:
@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project: Project = Depends(get_validated_project)
):
    """
    Retrieves details for a single project. Must belong to the user.
    """
    return project
```

## Implementation Strategy

1. **Start with utility refactoring**:
   - Enhance `formatting.js` with all shared utility functions
   - Update frontend files to use these utilities

2. **Backend service consolidation**:
   - Add common functions to `project_service.py`
   - Refactor one service at a time to use these functions

3. **Route handler improvements**:
   - Enhance auth dependencies
   - Update route handlers to use shared dependencies

This refactoring approach focuses on reducing duplicated code without creating new modules or implementing new features, significantly improving maintainability and reducing potential for inconsistencies.
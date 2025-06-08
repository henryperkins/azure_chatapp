# Knowledge Base Readiness Management System

## Problem Statement

The current knowledgebase implementation uses lazy initialization, which creates timing issues where the chat manager expects KB functionality to be available before dependencies are properly initialized. This leads to:

- Chat becoming available before KB UI is ready
- Vector database only initializing on first use (potential timeouts)
- KB component waiting until project details view loads
- Missing startup validation for required dependencies
- Silent failures without user feedback

## Root Cause Analysis

### Why Components Are Initialized Lazily

**1. Optional Dependencies** (`services/vector_db.py:30-67`)
- Heavy ML libraries like `sentence-transformers` and `faiss-cpu` may not be installed
- System gracefully degrades: FAISS → sklearn → manual cosine similarity
- Avoids startup failures when advanced features aren't available

**2. Resource Intensity** (`services/vector_db.py:128-144`)
- Loading transformer models is memory/CPU expensive
- Model warmup procedures are time-consuming
- Better to defer until actually needed

**3. Project-Specific Configuration** (`services/knowledgebase_helpers.py:116-146`)
- Each project has its own vector database instance
- Different embedding models per project
- Can't initialize until project context is known

**4. User Experience Optimization** (`static/js/knowledgeBaseComponent.js:248-286`)
- Not all users need KB features
- Mobile views may not have KB UI elements
- Avoids performance penalty for non-KB users

**5. Frontend Bootstrap Timing** (`static/js/knowledgeBaseManager.js:28-53`)
- Uses lazy placeholders during early bootstrap
- API client may not be ready when KB component initializes
- Allows UI structure setup before dependencies are available

## Proposed Solution: KB Readiness Management System

**Core Concept**: Add a lightweight readiness layer that can quickly determine KB availability without triggering expensive initialization, combined with graceful degradation patterns.

### Architecture Overview

The solution implements a **readiness check system** that preserves lazy initialization benefits while ensuring chat operations only proceed when KB dependencies are actually available.

## Implementation

### 1. Backend Readiness Service

Create `services/kb_readiness_service.py`:

```python
from dataclasses import dataclass
from typing import Dict, Optional
import logging
from uuid import UUID

logger = logging.getLogger(__name__)

@dataclass
class KBReadinessStatus:
    """Represents the readiness state of knowledgebase functionality"""
    available: bool
    reason: Optional[str] = None
    fallback_available: bool = False
    missing_dependencies: list[str] = None

class KBReadinessService:
    """Fast readiness checks without triggering expensive initialization"""
    
    _instance = None
    _status_cache: Dict[str, KBReadinessStatus] = {}
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    async def check_global_readiness(self) -> KBReadinessStatus:
        """Check if KB system can work at all (fast dependency check)"""
        cache_key = "global"
        if cache_key in self._status_cache:
            return self._status_cache[cache_key]
        
        missing_deps = []
        fallback_available = False
        
        # Check optional dependencies without importing
        try:
            import sentence_transformers
        except ImportError:
            missing_deps.append("sentence-transformers")
        
        try:
            import faiss
        except ImportError:
            missing_deps.append("faiss-cpu")
        
        try:
            import sklearn
            fallback_available = True
        except ImportError:
            missing_deps.append("scikit-learn")
        
        # If all vector search methods are missing, KB is unavailable
        if "faiss-cpu" in missing_deps and "scikit-learn" in missing_deps:
            status = KBReadinessStatus(
                available=False,
                reason="No vector search backend available",
                missing_dependencies=missing_deps
            )
        else:
            status = KBReadinessStatus(
                available=True,
                fallback_available=fallback_available,
                missing_dependencies=missing_deps
            )
        
        self._status_cache[cache_key] = status
        return status
    
    async def check_project_readiness(self, project_id: UUID) -> KBReadinessStatus:
        """Check if KB is ready for specific project (includes global + project checks)"""
        global_status = await self.check_global_readiness()
        if not global_status.available:
            return global_status
        
        cache_key = f"project_{project_id}"
        if cache_key in self._status_cache:
            return self._status_cache[cache_key]
        
        # Fast check: does project have KB files without full initialization
        from services.knowledgebase_service import get_project_knowledge_base
        from db.db import get_async_session
        
        try:
            async with get_async_session() as db:
                kb = await get_project_knowledge_base(project_id, db)
                if not kb or not kb.is_active:
                    status = KBReadinessStatus(
                        available=False,
                        reason="Knowledge base not configured for project"
                    )
                else:
                    # Check if vector files exist
                    storage_path = f"./storage/vector_db/{project_id}"
                    import os
                    if not os.path.exists(storage_path):
                        status = KBReadinessStatus(
                            available=False,
                            reason="No indexed files found"
                        )
                    else:
                        status = KBReadinessStatus(available=True)
        except Exception as e:
            logger.error(f"Error checking project KB readiness: {e}")
            status = KBReadinessStatus(
                available=False,
                reason=f"Error checking project KB: {str(e)}"
            )
        
        self._status_cache[cache_key] = status
        return status
    
    def invalidate_cache(self, project_id: Optional[UUID] = None):
        """Invalidate readiness cache when KB state changes"""
        if project_id:
            cache_key = f"project_{project_id}"
            self._status_cache.pop(cache_key, None)
        else:
            self._status_cache.clear()
```

### 2. Health Check Endpoint

Add to `routes/knowledge_base_routes.py`:

```python
@router.get("/health/{project_id}")
async def check_kb_health(
    project_id: UUID,
    current_user_tuple: Tuple[User, str] = Depends(get_current_user_and_token),
):
    """Fast health check for KB readiness without triggering initialization"""
    current_user, _ = current_user_tuple
    
    from services.kb_readiness_service import KBReadinessService
    
    readiness_service = KBReadinessService.get_instance()
    status = await readiness_service.check_project_readiness(project_id)
    
    return {
        "available": status.available,
        "reason": status.reason,
        "fallback_available": status.fallback_available,
        "missing_dependencies": status.missing_dependencies or []
    }
```

### 3. Frontend Readiness Service

Create `static/js/knowledgeBaseReadinessService.js`:

```javascript
export function createKnowledgeBaseReadinessService({ DependencySystem, apiClient, logger }) {
    if (!DependencySystem || !apiClient || !logger) {
        throw new Error('[KBReadinessService] Missing required dependencies');
    }

    const MODULE = 'KBReadinessService';
    const readinessCache = new Map();
    
    return {
        async checkProjectReadiness(projectId, options = {}) {
            const { useCache = true, timeout = 5000 } = options;
            const cacheKey = `project_${projectId}`;
            
            if (useCache && readinessCache.has(cacheKey)) {
                const cached = readinessCache.get(cacheKey);
                // Cache for 30 seconds
                if (Date.now() - cached.timestamp < 30000) {
                    return cached.status;
                }
            }
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                const response = await apiClient.get(
                    `/api/knowledge-base/health/${projectId}`,
                    { signal: controller.signal }
                );
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    const status = await response.json();
                    readinessCache.set(cacheKey, {
                        status,
                        timestamp: Date.now()
                    });
                    return status;
                } else {
                    throw new Error(`Health check failed: ${response.status}`);
                }
            } catch (error) {
                logger.warn('KB readiness check failed', error, { 
                    context: `${MODULE}.checkProjectReadiness`,
                    projectId 
                });
                
                // Return pessimistic status on error
                return {
                    available: false,
                    reason: 'Health check failed',
                    fallback_available: false,
                    missing_dependencies: []
                };
            }
        },
        
        async waitForReadiness(projectId, options = {}) {
            const { maxAttempts = 5, interval = 1000 } = options;
            
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const status = await this.checkProjectReadiness(projectId, { useCache: false });
                
                if (status.available) {
                    return status;
                }
                
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, interval));
                }
            }
            
            // Final attempt with cache disabled
            return await this.checkProjectReadiness(projectId, { useCache: false });
        },
        
        invalidateCache(projectId = null) {
            if (projectId) {
                readinessCache.delete(`project_${projectId}`);
            } else {
                readinessCache.clear();
            }
        },
        
        cleanup() {
            readinessCache.clear();
        }
    };
}
```

### 4. Chat Manager Integration

Modify chat manager to include readiness checks:

```javascript
// In chat.js or wherever KB integration happens
async function sendMessageWithKnowledgeBase(message, projectId) {
    const kbReadinessService = DependencySystem.modules.get('kbReadinessService');
    
    if (!kbReadinessService) {
        logger.warn('KB readiness service not available', { context: 'Chat.sendMessage' });
        return await sendMessageWithoutKB(message);
    }
    
    // Fast readiness check
    const kbStatus = await kbReadinessService.checkProjectReadiness(projectId);
    
    if (!kbStatus.available) {
        logger.info('KB not available, sending without context', { 
            context: 'Chat.sendMessage',
            reason: kbStatus.reason,
            projectId 
        });
        
        // Show user-friendly message about KB unavailability
        showKBUnavailableMessage(kbStatus);
        
        return await sendMessageWithoutKB(message);
    }
    
    // KB is ready, proceed with knowledge-enhanced chat
    return await sendMessageWithKB(message, projectId);
}

function showKBUnavailableMessage(kbStatus) {
    const message = kbStatus.reason === 'No indexed files found' 
        ? 'No knowledge base files found for this project. Upload files to enable AI context.'
        : `Knowledge base temporarily unavailable: ${kbStatus.reason}`;
    
    // Use existing notification system
    showNotification(message, 'info');
}
```

### 5. User Feedback System

Add KB status indicator to UI:

```javascript
// Add to knowledgeBaseComponent.js or chat UI
function createKBStatusIndicator() {
    return `
        <div id="kb-status-indicator" class="hidden">
            <div class="alert alert-info">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span id="kb-status-message">Knowledge base status</span>
            </div>
        </div>
    `;
}

async function updateKBStatusIndicator(projectId) {
    const kbReadinessService = DependencySystem.modules.get('kbReadinessService');
    const indicator = document.getElementById('kb-status-indicator');
    const message = document.getElementById('kb-status-message');
    
    if (!kbReadinessService || !indicator || !message) return;
    
    const status = await kbReadinessService.checkProjectReadiness(projectId);
    
    if (status.available) {
        indicator.classList.add('hidden');
    } else {
        indicator.classList.remove('hidden');
        message.textContent = getKBStatusMessage(status);
    }
}

function getKBStatusMessage(status) {
    switch (status.reason) {
        case 'No indexed files found':
            return 'Upload files to enable AI knowledge base features';
        case 'Knowledge base not configured for project':
            return 'Knowledge base not enabled for this project';
        case 'No vector search backend available':
            return 'Knowledge base dependencies missing (admin contact required)';
        default:
            return `Knowledge base temporarily unavailable: ${status.reason}`;
    }
}
```

### 6. Integration Points

**Register in `appInitializer.js`:**
```javascript
// Early in coreInit phase
const kbReadinessService = createKnowledgeBaseReadinessService({
    DependencySystem,
    apiClient: DependencySystem.modules.get('apiClient'),
    logger
});
DependencySystem.register('kbReadinessService', kbReadinessService);
```

**Update `ai_response.py`:**
```python
# Before knowledge context retrieval
from services.kb_readiness_service import KBReadinessService

if conversation.project_id and conversation.use_knowledge_base:
    readiness_service = KBReadinessService.get_instance()
    status = await readiness_service.check_project_readiness(conversation.project_id)
    
    if status.available:
        try:
            knowledge_context = await retrieve_knowledge_context(...)
        except Exception as e:
            logger.error(f"KB search failed despite readiness check: {e}")
            # Continue without context
    else:
        logger.info(f"KB not ready for project {conversation.project_id}: {status.reason}")
        # Continue without context, optionally inform user
```

## Benefits of This Solution

1. **Preserves Lazy Loading** - Expensive initialization still deferred
2. **Fast Readiness Checks** - Lightweight dependency verification
3. **Graceful Degradation** - Chat works without KB when unavailable  
4. **User Transparency** - Clear feedback about KB status
5. **Cache Optimization** - Avoids repeated health checks
6. **Developer Friendly** - Easy to extend and debug

## Implementation Steps

1. Create the backend readiness service
2. Add health check endpoint to KB routes
3. Implement frontend readiness service
4. Update chat manager with readiness checks
5. Add user feedback components
6. Register services in initialization sequence
7. Update AI response handler with readiness validation

## Testing Strategy

1. **Unit Tests**: Test readiness service with various dependency states
2. **Integration Tests**: Verify chat behavior with KB unavailable/available
3. **E2E Tests**: User workflow with KB state transitions
4. **Performance Tests**: Ensure readiness checks don't impact chat latency

This approach eliminates timing issues while maintaining the performance and flexibility benefits of the current lazy initialization strategy.
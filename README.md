# Azure OpenAI Chat Application

A full-stack, project-based chat and knowledge management application leveraging Azure OpenAI, Anthropic Claude, JWT authentication, and a modular ES6 frontend with Tailwind CSS and DaisyUI.

## 2025 Remediation Roadmap – Status Snapshot

| Phase | Status | Highlights |
|-------|--------|------------|
| 1 – Foundation Stabilization | ✅ **Completed** (2025-06-09) | DI compliance, centralized auth & project services, tests & linting green |
| 2 – Component Decomposition | ⚙️ **In Progress** (kicked-off 2025-06-09) | Chat scaffolding (`chatUIController`, `conversationManager`, `messageHandler`) registered via DI, migration slices underway |
| 3 – Event System Consolidation | ⏸️ Pending | unify legacy buses into `eventService` |
| 4 – State Management Cleanup | ⏸️ Pending | introduce `uiStateService`, remove local component state |
| 5 – Testing & Validation | ⏸️ Pending | E2E, memory & perf benchmarks |


## Features

- Project-based organization: each user can manage multiple projects
- Real-time chat with AI models (Claude, GPT, Azure OpenAI, etc.)
- JWT authentication with secure HttpOnly cookies and CSRF protection
- File and artifact management per project
- Knowledge base per project with file upload, search, and reindexing
- Modular, event-driven frontend (ES6 modules, DependencySystem DI)
- Tailwind CSS with DaisyUI for theming
- Sentry integration for error and performance monitoring (backend & frontend)
- Docker-based deployment and local development support

## Project Structure

```
azure_chatapp/
├── models/                # Database models (User, Project, Conversation, File, Artifact, KnowledgeBase, etc.)
├── routes/                # API endpoints (auth, projects, files, artifacts, knowledge base, conversations, preferences, sentry test)
│   ├── projects/
│   ├── knowledge_base_routes.py
│   ├── unified_conversations.py
│   ├── user_preferences.py
│   ├── sentry_test.py
│   └── admin.py
├── services/              # Business logic/services
├── db/                    # Database connection/session management
├── utils/                 # Shared utilities (auth_utils, db_utils, sentry_utils, serializers, etc.)
├── static/                # Frontend assets
│   ├── html/
│   ├── js/                # ES6 modules (app.js, projectManager.js, chat.js, modelConfig.js, etc.)
│   └── css/               # Tailwind styles
├── config.py
├── main.py                # FastAPI entrypoint
├── requirements.txt       # Python dependencies
└── package.json           # Frontend dependencies and scripts
```

## Core API Endpoints

### Authentication

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}
```
Response:
```json
{
  "access_token": "jwt.token.here",
  "refresh_token": "refresh.token.here",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

### Project Management

```http
POST /api/projects
Content-Type: application/json
Authorization: Bearer {token}

{
  "name": "AI Research",
  "description": "Market analysis project"
}
```
Response:
```json
{
  "id": 123,
  "name": "AI Research",
  "description": "Market analysis project",
  "created_at": "2025-03-16T22:38:22Z"
}
```

```http
GET /api/projects/123
Authorization: Bearer {token}
```
Response:
```json
{
  "id": 123,
  "name": "AI Research",
  "description": "Market analysis project",
  "attached_chats": ["chat_abc123"],
  "files": ["report.pdf"]
}
```

### Real-time Chat

```http
WebSocket wss://yourapp.com/chat
Headers:
Authorization: Bearer {token}
```
Message format:
```json
{
  "project_id": 123,
  "message": "Analyze Q4 trends",
  "context": {"temperature": 0.7}
}
```
Response stream:
```json
{
  "content": "Q4 shows 15% growth...",
  "tokens_used": 42,
  "is_complete": false
}
```

## Frontend Architecture

- Modular ES6 codebase with strict dependency injection (`DependencySystem`)
- Main entrypoint: `static/js/app.js`
- Core modules: `projectManager.js`, `chat.js`, `modelConfig.js`, `projectDashboard.js`, `projectListComponent.js`, `projectDetailsComponent.js`, `sidebar.js`, `knowledgeBaseComponent.js`
- UI enhancements occur after DOM and dependencies are ready
- Sentry monitoring for frontend errors and performance

## Deployment

```bash
# Build production image
docker build -t azure-chatapp:prod --target production .

# Run with environment variables
docker run -d -p 80:80 \
  -e DATABASE_URL="postgresql+asyncpg://user:pass@db:5432/azure_chatapp?sslmode=disable" \
  -e SESSION_SECRET="your-session-secret" \
  -e JWT_SECRET="your-jwt-secret" \
  azure-chatapp:prod
```

## Development Setup

```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
npm install
npm run watch:css

# Start FastAPI app
uvicorn main:app --reload
```

> **WARNING:** This codebase uses insecure/debug configuration by default (relaxed CORS, cookies, and session settings). Do **NOT** use in production without hardening security settings in `config.py` and environment variables.

## Architectural Diagrams

### Chat Initialization (Block Diagram)

```mermaid
graph TD
    A[app.js] -->|import| B(DependencySystem)
    A --"init()"--> Stage1(1. Core DI creation)
    Stage1 --> Stage2(2. createNotify)
    Stage2 --> Stage3(3. createEventHandlers)
    Stage3 --> Stage4(4. createApiClient)
    Stage4 --> Stage5(5. createChatManager)
    B -.->|register(...)| A
    Stage3 ---> Stage5
    Stage5 --> Stage6(6. createProjectManager)
    Stage6 --> Stage7(7. UI bootstrap)
    A -.->|"DOM ready ⇢ waitForDepsAndDom() (async)"| RegListeners(registerAppListeners)
    RegListeners --> NavChange(trackListener window, locationchange → handleNavigationChange)
    RegListeners --> ChatTrigger(setupChatInitializationTrigger)
    RegListeners --> GlobalHooks(global auth / error hooks)
```

### Chat Sequence (First Load → First Message)

```mermaid
sequenceDiagram
    participant Browser
    participant app.js
    participant DependencySystem
    participant chatManager
    participant eventHandlers
    participant API

    Browser->>app.js: DOMContentLoaded
    app.js->>app.js: init()
    app.js->>app.js: createDomAPI() etc.
    app.js->>app.js: createNotify()
    app.js->>app.js: createEventHandlers()
    app.js->>app.js: createChatManager()
    app.js->>DependencySystem: register('chatManager', inst)
    app.js->>app.js: registerAppListeners()

    app.js->>app.js: handleNavigationChange() (URL ?project=123&chatId=abc)
    app.js->>projectManager: pm.loadProjectDetails(123)
    activate projectManager
    projectManager->>API: GET /api/projects/123
    API-->>projectManager: Project Data
    deactivate projectManager
    app.js-->>app.js: pm emits 'projectLoaded'

    app.js->>chatManager: await initialize({projectId:123,...})
    activate chatManager
    chatManager->>chatManager: _setupUIElements()
    chatManager->>eventHandlers: _bindEvents() (trackListener adds DOM handlers)
    chatManager->>chatManager: loadConversation('abc')
    activate chatManager
    par
        chatManager->>API: GET /projects/123/conversations/abc
    and
        chatManager->>API: GET /projects/123/conversations/abc/messages
    end
    API-->>chatManager: Conversation Data
    API-->>chatManager: Messages Data
    deactivate chatManager
    chatManager->>chatManager: _renderMessages()
    chatManager->>chatManager: _updateURLWithConversationId()
    chatManager-->>app.js: dispatch 'chatmanager:initialized'
    deactivate chatManager
    app.js->>app.js: resolve initialize()

    Browser->>chatManager: User types message (keydown Enter)
    activate chatManager
    chatManager->>chatManager: sendMessage() → queue.add()
    chatManager->>chatManager: queue.process()
    chatManager->>API: _sendMessageToAPI() POST /projects/123/conversations/abc/messages
    API-->>chatManager: {assistant_message: ...}
    chatManager->>chatManager: _processAssistantResponse()
    chatManager->>chatManager: _showMessage('assistant', ...)
    deactivate chatManager
```

## Contributing

1. Create feature branch: `git checkout -b feature/your-idea`
2. Commit changes: `git commit -am 'Add awesome feature'`
3. Push branch: `git push origin feature/your-idea`
4. Open pull request

---

**Looking for development, architecture, or code quality policies?
See [Code Generation Guardrails – 2025 Update] and [CLAUDE.md] for in-depth guardrails, CI requirements, and contributor onboarding.**

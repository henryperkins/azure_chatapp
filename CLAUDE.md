# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Azure Chat Application Commands and Guidelines

## Development Setup
```bash
# Setup Python environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend build (Tailwind CSS)
npm install
npm run build:css
npm run dev:css -- --watch  # For development mode

# Start application
uvicorn main:app --reload
```

## Testing
```bash
# Run all tests
pytest

# Run a single test file/module
pytest path/to/test_file.py

# Run a specific test function
pytest path/to/test_file.py::test_function_name -v

# Run with coverage
pytest --cov=./ --cov-report=term

# Run Playwright tests
npx playwright test
```

## Linting and Formatting
```bash
# Run pylint on a specific file
pylint path/to/file.py

# Run pylint on entire codebase
find . -name "*.py" -not -path "*/venv/*" | xargs pylint

# CSS linting
npm run lint:css
```

## Database Management
```bash
# Reset database (WARNING: Deletes all data)
python scripts/reset_database.py

# Create migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head
```

## Project Structure
```
azure_chatapp/
├── db/
│   ├── db.py
│   ├── db.sqlite3
│   └── schema_manager.py
├── docs/
│   ├── daisyui.md
│   └── tailwindcss4guide.md
├── models/
│   ├── user.py
│   ├── conversation.py
│   ├── message.py
│   ├── project.py
│   ├── project_file.py
│   └── knowledge_base.py
├── routes/
│   ├── admin.py
│   ├── knowledge_base_routes.py
│   ├── unified_conversations.py
│   ├── user_preferences.py
│   └── projects/
│       ├── artifacts.py
│       ├── files.py
│       └── projects.py
├── schemas/
│   ├── chat_schemas.py
│   ├── file_upload_schemas.py
│   └── project_schemas.py
├── scripts/
│   ├── add_last_activity_column.py
│   └── list_user_passwords.py
├── services/
│   ├── artifact_service.py
│   ├── conversation_service.py
│   ├── file_storage.py
│   ├── knowledgebase_service.py
│   ├── project_service.py
│   ├── user_service.py
│   └── vector_db.py
├── static/
│   ├── css/
│   ├── html/
│   │   ├── base.html
│   │   ├── chat_ui.html
│   │   ├── login.html
│   │   └── project_list.html
│   └── js/
│       ├── app.js
│       ├── auth.js
│       ├── chat.js
│       ├── chatExtensions.js
│       ├── debug-project.js
│       ├── eventHandler.js
│       ├── FileUploadComponent.js
│       ├── fixes-verification.js
│       ├── formatting.js
│       ├── knowledgeBaseComponent.js
│       ├── modalManager.js
│       ├── modelConfig.js
│       ├── notification-handler.js
│       ├── projectDashboard.js
│       ├── projectDashboardUtils.js
│       ├── projectDetailsComponent.js
│       ├── projectListComponent.js
│       ├── projectManager.js
│       ├── sentry-init.js
│       ├── sidebar.js
│       ├── theme-toggle.js
│       ├── uiRenderer.js
│       └── utils.js
├── tests/
├── utils/
│   ├── ai_helper.py
│   ├── auth_utils.py
│   ├── openai.py
│   └── sentry_utils.py
├── main.py
├── auth.py
├── config.py
├── alembic.ini
├── requirements.txt
├── package.json
└── tailwind.config.js
```

## Sentry Integration
```python
# Server-side Sentry configuration in config.py
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_ENABLED = os.getenv("SENTRY_ENABLED", "false").lower() in ("true", "1")
SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0"))
SENTRY_PROFILES_SAMPLE_RATE = float(os.getenv("SENTRY_PROFILES_SAMPLE_RATE", "1.0"))
```

```javascript
// Client-side Sentry configuration
// Enable Sentry in development (localhost): localStorage.setItem('enable_monitoring', 'true')
// Disable Sentry in production: localStorage.setItem('disable_monitoring', 'true')
```

The application uses Sentry for comprehensive error tracking and monitoring:

### Features
- **Server-side**: FastAPI integration, automated error capture, context management, performance tracing
- **Client-side**: Browser tracing, session replay, console capture, context lines
- **Privacy**: Data filtering for sensitive information (passwords, tokens, auth headers)
- **Distributed Tracing**: End-to-end request tracing between frontend and backend
- **Performance**: Transaction monitoring, custom spans, and profile sampling
- **MCP Integration**: Enhanced functionality via Model Context Protocol server

Key files: `utils/sentry_utils.py`, `utils/mcp_sentry.py`, `static/js/sentry-init.js`

## Code Style Guidelines
- **Imports**: Group standard library, third-party, and local imports (separated by newlines)
- **Type Hints**: Use typing module; annotate function parameters and return values
- **Docstrings**: Triple quotes for modules and functions with description and parameters
- **Error Handling**: Use try/except with specific exceptions; log errors with context
- **Naming**: snake_case for variables/functions, PascalCase for classes, UPPER_CASE for constants
- **Formatting**: 4 spaces for indentation, maximum line length of 100 characters
- **SQLAlchemy**: Use async session with proper relationship definitions
- **FastAPI**: Router grouping by feature, dependency injection for auth/DB
- **Frontend**: Vanilla JavaScript with Tailwind CSS v4 and DaisyUI for styling
- **Security**: Follow OWASP practices; use JWT tokens; validate all inputs
- **Logging**: Use built-in logging module with appropriate severity levels
- **Azure**: Use Azure best practices for cloud-related code

When completing tasks, run appropriate tests and linting before committing changes.
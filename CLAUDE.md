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

## Linting
```bash
# Run pylint
pylint path/to/file.py

# Run pylint on entire codebase
find . -name "*.py" -not -path "*/venv/*" | xargs pylint
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

## Code Style Guidelines
- **Imports**: Group standard library, third-party, and local imports (separated by newlines)
- **Type Hints**: Use typing module; annotate function parameters and return values
- **Docstrings**: Triple quotes for modules and functions with description and parameters
- **Error Handling**: Use try/except with specific exceptions; log errors with context
- **Naming**: snake_case for variables/functions, PascalCase for classes, UPPER_CASE for constants
- **Formatting**: 4 spaces for indentation, maximum line length of 100 characters
- **SQLAlchemy**: Use async session with proper relationship definitions
- **FastAPI**: Router grouping by feature, dependency injection for auth/DB
- **Frontend**: Vanilla JavaScript with Tailwind CSS for styling
- **Security**: Follow OWASP practices; use JWT tokens; validate all inputs
- **Logging**: Use built-in logging module with appropriate severity levels
- **Azure**: Use Azure best practices for cloud-related code

When completing tasks, run appropriate tests and linting before committing changes.
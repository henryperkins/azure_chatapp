# 🛡️ Python Backend Code Guardrails

These guidelines strictly apply to all Python backend development, maintenance, and AI-assisted code generation within this project. They ensure consistency, maintainability, performance, and security throughout your FastAPI backend applications.

## 1. Application Structure

* **FastAPI Initialization**:
  * **✅ Do**: Define application initialization explicitly in `main.py`
  * **✅ Do**: Modularize with domain-specific `APIRouter` files (e.g., `conversations_router.py`, `projects_router.py`)
  * **❌ Avoid**: Defining routes directly in `main.py` or mixing unrelated routes in the same file

* **Route Handlers (Thin Controllers)**:
  * **✅ Do**: Limit handlers to these responsibilities only:
    1. Validating request data with Pydantic models
    2. Calling appropriate service methods with validated data
    3. Transforming service responses into HTTP responses
  * **❌ Avoid**: Direct database queries in route handlers (e.g., `db.execute()`, SQLAlchemy `select()`)
  * **❌ Avoid**: Business logic implementation in route handlers

* **Response Models**:
  * **✅ Do**: Always use specific Pydantic models for `response_model` in route decorators
  * **❌ Avoid**: Generic response types like `response_model=dict` or `response_model=Any`

* **Package Organization**:
  * **✅ Do**: Keep `__init__.py` files minimal, primarily for package organization
  * **❌ Avoid**: Complex logic or side-effect imports in `__init__.py` files

## 2. Dependency Injection

* **Explicit Dependency Injection**:
  * **✅ Do**: Use FastAPI's `Depends()` for all dependencies (DB sessions, services, config, HTTP clients)
  * **✅ Do**: Clearly indicate dependencies in function signatures
  * **❌ Avoid**: Hidden dependencies through global imports

* **Service Class Dependencies**:
  * **✅ Do**: Inject dependencies via constructor parameters (e.g. `def __init__(self, db: AsyncSession, settings: Settings)`)
  * **✅ Do**: Create factory functions for service instantiation (e.g., `get_user_service()`)
  * **❌ Avoid**: Service classes directly importing dependencies

* **Resource Management**:
  * **✅ Do**: Defer initialization of expensive resources to DI system or lifecycle events
  * **❌ Avoid**: Module-level initialization (e.g., `client = ApiClient(settings.API_KEY)` at file top)
  * **❌ Avoid**: Direct imports of settings (e.g., `from config import settings`)

## 3. Services and Business Logic

* **Domain Isolation**:
  * **✅ Do**: Define services by clear domain boundaries (e.g., `user_service.py`, `project_service.py`)
  * **❌ Avoid**: Mixing domain logic across service boundaries

* **Business Logic Encapsulation**:
  * **✅ Do**: Place all data manipulation, validation, and state changes in service layer
  * **✅ Do**: Make services own all database interactions for their domain
  * **❌ Avoid**: Data manipulation or domain logic in routes or utilities

* **Service Return Values and Errors**:
  * **✅ Do**: Return plain data structures (Pydantic models, dicts, lists)
  * **✅ Do**: Raise domain-specific exceptions (e.g., `ProjectNotFoundError`) from a custom exception hierarchy
  * **❌ Avoid**: Raising FastAPI `HTTPException` directly from services
  * **❌ Avoid**: Returning FastAPI `Response` objects from services

## 4. Database Management

* **Asynchronous ORM Usage**:
  * **✅ Do**: Use asynchronous SQLAlchemy with consistent patterns
  * **✅ Do**: Centralize DB utility functions (e.g., transaction management)
  * **❌ Avoid**: Synchronous SQLAlchemy operations or raw SQL in async code paths

* **Database Access Confinement**:
  * **✅ Do**: Keep all database operations within service layer
  * **❌ Avoid**: Database queries in route handlers, utilities, or middleware

* **Query Optimization**:
  * **✅ Do**: Use appropriate eager loading techniques for related entities (`selectinload`, `joinedload`)
  * **✅ Do**: Know and address N+1 query patterns
  * **❌ Avoid**: Nested loops performing database queries

## 5. Authentication & Security

* **Session Management**:
  * **✅ Do**: Use `HttpOnly`, `Secure`, and appropriate `SameSite` cookie attributes
  * **✅ Do**: Implement proper CSRF protection
  * **❌ Avoid**: Storing authentication tokens in localStorage without additional security

* **Authorization Checks**:
  * **✅ Do**: Validate all user permissions against authenticated context
  * **✅ Do**: Re-verify user access for all protected resources
  * **❌ Avoid**: Trusting client-supplied IDs or parameters without validation

* **Auth/Authz Separation**:
  * **✅ Do**: Separate authentication (who is the user) from authorization (what can they access)
  * **✅ Do**: Place authorization logic in services where business context is available
  * **⚠️ Exception**: Core authentication utilities may raise `HTTPException` with 401/403 status codes

## 6. Configuration Management

* **Pydantic Settings**:
  * **✅ Do**: Define all configuration via Pydantic's `BaseSettings` class
  * **✅ Do**: Source configuration primarily from environment variables
  * **❌ Avoid**: Hard-coded sensitive values or configuration constants

* **Configuration Injection**:
  * **✅ Do**: Inject settings via DI system (`Depends(get_settings)`)
  * **✅ Do**: Pass only needed configuration sections to services/components
  * **❌ Avoid**: Direct imports of global settings object outside app initialization

## 7. Logging and Monitoring

* **Structured Logging**:
  * **✅ Do**: Use JSON-structured logging consistently
  * **✅ Do**: Include contextual metadata (request IDs, user IDs, correlation IDs)
  * **❌ Avoid**: Unstructured string logs or direct `print()` statements

* **Observability**:
  * **✅ Do**: Integrate with error tracking (e.g., Sentry) for exceptions
  * **✅ Do**: Set up performance monitoring for critical paths
  * **❌ Avoid**: Silently catching exceptions without proper logging

* **Client Logging**:
  * **✅ Do**: Handle client-side logs asynchronously without blocking
  * **❌ Avoid**: Synchronous log processing in the main request flow

## 8. Validation and Serialization

* **Pydantic Everywhere**:
  * **✅ Do**: Use Pydantic for all request/response validation
  * **✅ Do**: Define specific models for different API operations
  * **❌ Avoid**: Manual validation or direct dictionary access

* **Schema Strictness**:
  * **✅ Do**: Enable strict schema validation by default
  * **✅ Do**: Validate input constraints beyond simple type checking
  * **❌ Avoid**: Loose validation or assuming valid input

## 9. Background and Long-Running Tasks

* **Task Isolation**:
  * **✅ Do**: Move long-running operations to dedicated task handlers
  * **✅ Do**: Queue tasks through service layer (using `BackgroundTasks` or message queue)
  * **❌ Avoid**: Blocking operations in request handlers

* **Task Management**:
  * **✅ Do**: Provide task status tracking and error handling
  * **✅ Do**: Consider idempotency for critical tasks
  * **❌ Avoid**: Fire-and-forget without monitoring for critical operations

## 10. External Integrations

* **Client Encapsulation**:
  * **✅ Do**: Use dedicated client modules for each external service
  * **✅ Do**: Abstract API details behind clean interfaces
  * **❌ Avoid**: Scattered API calls throughout the codebase

* **Error Handling**:
  * **✅ Do**: Translate external errors to application-specific exceptions
  * **✅ Do**: Implement appropriate retry strategies
  * **❌ Avoid**: Leaking third-party exceptions to your application code

## 11. Utility Modules & Shared Code

* **Import Safety**:
  * **✅ Do**: Ensure all modules are side-effect free at import time
  * **✅ Do**: Defer I/O operations, network calls, or heavy computation
  * **❌ Avoid**: Environment reads, file operations, or third-party service initialization at import

* **ML Models & Heavy Resources**:
  * **✅ Do**: Load large ML models lazily or through lifecycle events
  * **✅ Do**: Manage shared resources with proper lifecycle hooks
  * **❌ Avoid**: Eagerly loading models at module import time

* **Module Constants**:
  * **✅ Do**: Define configurable parameters in `config.py` with Pydantic
  * **✅ Do**: Limit module-level constants to truly static, non-configurable values
  * **❌ Avoid**: Configuration-derived module-level constants

* **Async Patterns**:
  * **✅ Do**: Make all I/O operations properly async (`aiofiles`, `asyncio.to_thread`, etc.)
  * **✅ Do**: Use `asyncio.sleep()` instead of `time.sleep()`
  * **❌ Avoid**: Any blocking calls in async code paths

* **HTTP Clients**:
  * **✅ Do**: Use `httpx.AsyncClient` for all HTTP requests
  * **✅ Do**: Inject HTTP clients via DI rather than creating new instances
  * **❌ Avoid**: Creating client instances per-request without proper lifecycle management

* **Input/Output Safety**:
  * **✅ Do**: Sanitize user input especially for file operations and HTML content
  * **✅ Do**: Configure operation limits and thresholds via `config.py`
  * **❌ Avoid**: Blindly trusting or processing user-supplied content

## 12. Middleware

* **Middleware Organization**:
  * **✅ Do**: Define middleware in dedicated modules
  * **✅ Do**: Document clear responsibility boundaries
  * **❌ Avoid**: Business logic in middleware components

* **Middleware Scope**:
  * **✅ Do**: Use middleware only for cross-cutting concerns
  * **✅ Do**: Consider request context, logging, error handling, headers
  * **❌ Avoid**: Domain-specific logic in middleware

## 13. Testing

* **Test Coverage**:
  * **✅ Do**: Write comprehensive tests with `pytest`
  * **✅ Do**: Use `pytest-asyncio` for testing async code
  * **❌ Avoid**: Untested or poorly tested code paths

* **Testable Services**:
  * **✅ Do**: Design services to accept mockable dependencies
  * **✅ Do**: Use dependency overrides for integration tests
  * **❌ Avoid**: Hard-to-test dependencies or global state

* **Route Testing Strategy**:
  * **✅ Do**: Focus on request validation and response formatting
  * **✅ Do**: Verify service method calls with appropriate arguments
  * **❌ Avoid**: Testing business logic through HTTP endpoints

## 14. Performance

* **Async Consistency**:
  * **✅ Do**: Maintain async/await throughout the entire call stack
  * **✅ Do**: Use appropriate async libraries for I/O operations
  * **❌ Avoid**: Mixing synchronous and asynchronous code inappropriately

* **Resource Management**:
  * **✅ Do**: Use connection pooling for databases and external services
  * **✅ Do**: Close resources properly (e.g., with context managers)
  * **❌ Avoid**: Resource leaks or excessive connection creation

* **Data Access Optimization**:
  * **✅ Do**: Analyze query performance regularly
  * **✅ Do**: Use caching where appropriate
  * **❌ Avoid**: N+1 queries and unoptimized data access patterns

## 15. Code Duplication (DRY Principle)

* **Common Pattern Extraction**:
  * **✅ Do**: Identify and abstract repeated code patterns
  * **✅ Do**: Create reusable utilities for common operations
  * **❌ Avoid**: Copy-pasting similar logic across services

* **Shared Business Logic**:
  * **✅ Do**: Extract shared validation or processing into base classes or utilities
  * **✅ Do**: Use composition over inheritance for sharing behavior
  * **❌ Avoid**: Duplicated business rules across different services

## 🚩 Red Flag Checklist (for AI and Developers)

Actively detect and eliminate these anti-patterns:

* Database queries directly in route handlers
* Business logic outside the service layer
* `response_model=dict` in route decorators
* Blocking operations in async code paths
* Resources initialized at module scope
* Direct imports of configuration settings
* Synchronous file I/O or network calls in async methods
* Services raising `HTTPException`
* Mutable module-level state without proper management
* Missing contextual information in logs
* Unhandled exceptions with no error logging
* Hard-coded configuration values

---

These guardrails are designed to be clear, actionable, and easily interpreted by both human developers and AI code generation tools. They ensure code quality, maintainability, and security across the codebase.

# Sentry Integration Summary

This document outlines the steps and actions taken to integrate Sentry into the FastAPI application. The integration enables error monitoring, performance tracing, distributed tracing, and helps with diagnosing issues via test endpoints.

---

## 1. Sentry SDK Initialization

- **Imports and Integrations:**
  - Imported `sentry_sdk` along with key integrations:
    - **FastAPI Integration:** for automatic request instrumentation.
    - **SQLAlchemy Integration:** to capture database queries.
    - **Asyncio Integration:** for asynchronous framework support.
    - **Logging Integration:** to capture log events as breadcrumbs and errors.
- **Configuration in main.py:**
  - Configured Sentry with DSN, environment, application release (using `APP_VERSION`), and sampling rates for both traces and profiles.
  - Enabled stack trace attachment.
  - Set up a `before_send` handler to filter events based on `SENTRY_ENABLED` setting.
  - Called a utility function (`configure_sentry_loggers()`) to ignore noisy loggers and reduce event noise.

---

## 2. Sentry Tracing Middleware

- **Middleware Implementation (utils/middlewares.py):**
  - Created `SentryTracingMiddleware` to:
    - Extract trace headers (using `extract_sentry_trace`) from incoming requests.
    - Create a Sentry transaction for each HTTP request.
    - Tag transactions with HTTP method, URL, and user info (when available).
    - Measure response time and set transaction status based on HTTP status codes.
  - Integrated this middleware conditionally into the middleware stack in `main.py` based on the Sentry configuration.

---

## 3. Sentry Utility Functions

- **Utility Module (utils/sentry_utils.py):**
  - **Logger Configuration:** Function `configure_sentry_loggers()` to ignore several noisy log sources.
  - **MCP Server Connection Check:** Function `check_sentry_mcp_connection()` to validate the connection to the Sentry MCP server.
  - **Trace Header Extraction:** Function `extract_sentry_trace()` to pull trace information (`sentry-trace` and `baggage` headers) from incoming requests.
  - **Injecting Trace Headers:** Function `inject_sentry_trace_headers()` to add Sentry trace data to outgoing responses.
  - **Tagging:** Function `tag_transaction()` allows setting tags (like unique test IDs) on the current Sentry transaction or span.
  - **Span Management:** A context manager `sentry_span()` to create nested spans, useful for marking sub-operations within a transaction.

---

## 4. Test Endpoints for Sentry Integration

- **Sentry Testing Routes (routes/sentry_test.py):**
  - **/test-error:** An endpoint that intentionally raises an exception to verify that errors are captured by Sentry. It logs the error, tags the transaction with a test error ID, captures the exception, and re-raises it as an HTTP error.
  - **/test-message:** An endpoint that sends a custom message to Sentry. It creates tags and logs a message, then uses `sentry_sdk.capture_message` to report the event.
  - **/test-performance:** An endpoint that creates multiple spans simulating a database query, an external API call, and nested processing to verify performance tracing in Sentry.
- These endpoints are conditionally registered in `main.py` when the environment is not production, ensuring that they are used only in development/testing.

---

## 5. Router and Middleware Registration

- **Router Inclusion in main.py:**
  - All the Sentry testing routes from `routes/sentry_test.py` were conditionally added.
- **Middleware Integration:**
  - The `SentryTracingMiddleware` was added to the middleware list when Sentry is enabled, alongside other security middlewares such as TrustedHostMiddleware and SessionMiddleware.

---

## Conclusion

The Sentry integration in the application accomplishes the following:
- **Error Monitoring:** Automatic capturing of unhandled exceptions and validation via test endpoints.
- **Performance Tracing:** Detailed transaction and span data creation from request middleware and explicit test endpoints.
- **Distributed Tracing:** Propagation of trace headers between services.
- **Utilities:** Supporting functions to manage logger configurations, extract and inject trace context, and tag transactions.

This setup facilitates comprehensive monitoring, making it easier to diagnose and optimize the application's behavior under production-like conditions.

---

## Future Considerations

- **Sampling Adjustments:** Fine-tune sampling rates for traces and profiles based on actual production usage.
- **Extended Integrations:** Consider additional integrations for frameworks or services as needed.
- **Event Filtering:** Enhance the `before_send` functionality to further filter or enrich events.
- **Periodic Review:** Regularly review Sentry dashboards to adjust ignored loggers and performance thresholds.

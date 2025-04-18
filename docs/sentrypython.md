# Sentry.io Python SDK: Implementation, Usage & Reference Guide

This guide provides a comprehensive overview of integrating, configuring, and utilizing the Sentry SDK for Python applications, covering error monitoring, performance tracing, profiling, logging, framework integrations, and advanced customization.

## 1. Installation

Install the core SDK package using pip. You can include extras for specific frameworks or features to ensure necessary dependencies are installed.

```bash
# Core SDK (required)
pip install --upgrade sentry-sdk

# Example: Include FastAPI support
pip install --upgrade 'sentry-sdk[fastapi]'

# Example: Include Flask and SQLAlchemy support
pip install --upgrade 'sentry-sdk[flask,sqlalchemy]'

# Example: Include support for tracing Celery tasks and Redis
pip install --upgrade 'sentry-sdk[celery,redis]'
```

Refer to the official Sentry documentation or the [[Sentry Python Integrations]] list for available extras.

## 2. Basic Initialization (`sentry_sdk.init`)

Initialize the SDK as early as possible in your application's entry point (e.g., `manage.py`, `app.py`, `wsgi.py`). This configures Sentry and enables its automatic instrumentation features.

```python
import sentry_sdk
import logging # Example: for configuring logging integration

# --- Example Integration Imports (only needed if configuring them explicitly) ---
# from sentry_sdk.integrations.flask import FlaskIntegration
# from sentry_sdk.integrations.django import DjangoIntegration
# from sentry_sdk.integrations.fastapi import FastApiIntegration
# from sentry_sdk.integrations.starlette import StarletteIntegration
# from sentry_sdk.integrations.logging import LoggingIntegration
# from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

sentry_sdk.init(
    # --- Core Configuration (Required) ---
    dsn="YOUR_DSN_HERE",  # Get this from Sentry Settings > Projects > Client Keys (DSN)

    # --- Recommended Basic Configuration ---
    release="your-app-name@1.2.3", # Match your deployment version/tag/commit
    environment="production",      # 'development', 'staging', 'production', etc.

    # --- Performance Monitoring (Tracing) ---
    # Enable tracing by setting one of these (mutually exclusive):
    traces_sample_rate=1.0,        # Capture 100% of transactions. Adjust for production (0.0 to 1.0).
    # traces_sampler=my_traces_sampler, # Or use a function for dynamic sampling (see Sampling section)

    # --- Profiling ---
    # Enable profiling by setting one of these (requires tracing enabled):
    profiles_sample_rate=1.0,      # Profile 100% of *sampled* transactions. Adjust for production (0.0 to 1.0).
    # profiles_sampler=my_profiles_sampler, # Or use a function for dynamic sampling

    # --- Integrations ---
    # Most are auto-enabled if the library is installed. List explicitly to configure options.
    # integrations=[
    #     FlaskIntegration(transaction_style="url"),
    #     LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
    #     SqlalchemyIntegration(),
    # ],
    # default_integrations=False, # Disable Logging, Stdlib, Excepthook etc. (Rarely needed)
    # auto_enabling_integrations=False, # Disable Flask, Django, Celery etc. auto-detection

    # --- Data Privacy ---
    send_default_pii=False, # Set True to automatically send User IPs, usernames etc. (Use with caution!)

    # --- Event Filtering/Modification Callbacks ---
    # before_send=filter_or_modify_error_event,
    # before_breadcrumb=filter_or_modify_breadcrumb,
    # before_send_transaction=filter_or_modify_transaction_event,

    # --- Other Useful Options ---
    # attach_stacktrace=True, # Add stack traces to capture_message events
    # max_breadcrumbs=100,    # Default number of breadcrumbs stored
    # debug=True,             # Enable SDK's own debug logging (for development)
    # ignore_errors=[ValueError, MyCustomIgnoredError], # List of Exception types to ignore
)
```

*(See the full [Configuration Options Reference](#configuration-options-reference) below for more details.)*

## 3. Core Usage: Capturing Data & Adding Context

While integrations handle much automatically, you can manually interact with the SDK.

### Capturing Exceptions

```python
try:
    result = 1 / 0
except ZeroDivisionError as e:
    sentry_sdk.capture_exception(e) # Captures exception with stack trace
```

### Capturing Messages

```python
sentry_sdk.capture_message("User profile updated successfully.", level="info")
# Levels: 'fatal', 'error', 'warning', 'info', 'debug'
```

### Enriching Events: User, Tags, Context, Breadcrumbs

#### User Context

```python
sentry_sdk.set_user({
    "id": "user_db_id_99",
    "email": "dev@example.com",
    "username": "developer_jane",
    "ip_address": "{{auto}}" # Requires send_default_pii=True and web integration
})
# Clear user on logout: sentry_sdk.set_user(None)
```

#### Tags (Searchable Key/Value Strings)

```python
sentry_sdk.set_tag("payment.gateway", "stripe")
sentry_sdk.set_tag("user.segment", "enterprise")
```

#### Custom Context (Non-Searchable Structured Data)

```python
sentry_sdk.set_context("flight_details", {
    "departure_code": "SFO",
    "arrival_code": "LHR",
    "booking_ref": "XYZ789",
    "seats": ["12A", "12B"]
})
```

#### Breadcrumbs (Trail of Events)

```python
sentry_sdk.add_breadcrumb(
    category='db.query',
    message='Fetched user preferences',
    level='debug',
    data={'user_id': 123, 'query_duration_ms': 55}
)
```

### Scope Management

Apply context temporarily using `with sentry_sdk.push_scope():`.

```python
with sentry_sdk.push_scope() as scope:
    scope.set_tag("job_id", "process-emails-123")
    sentry_sdk.capture_message("Starting email batch processing")
    try:
        # ... process emails ...
    except Exception as e:
        sentry_sdk.capture_exception(e) # job_id tag is included
# Tag is removed outside the scope
```

## 4. Integrations

Integrations connect Sentry to your frameworks and libraries, automating data capture.

### How they Work

*   **Auto-Enabled:** Most common integrations (Flask, Django, Celery, SQLAlchemy, Redis, Logging, Stdlib, etc.) are enabled automatically if the library is detected and `auto_enabling_integrations` is `True` (default).
*   **Default Integrations:** Core integrations hooking into Python's standard library or interpreter (Logging, Stdlib, Excepthook, Dedupe, Atexit, etc.) are enabled unless `default_integrations` is `False`.
*   **Configuration:** List an integration explicitly in `sentry_sdk.init(integrations=[...])` to configure its options.
*   **Disabling:** Use `disabled_integrations=[IntegrationClass()]` or `auto_enabling_integrations=False` / `default_integrations=False` to disable specific or groups of integrations.

### Common Integration Examples

*   **Web Frameworks (Flask, Django, FastAPI):** Automatically capture request data, create transactions for requests, link errors to requests, report unhandled exceptions. Configurable options like `transaction_style` (FastAPI/Starlette).
*   **Databases (SQLAlchemy, asyncpg, Redis, MongoDB):** Automatically create spans for database queries/commands, recorded as breadcrumbs.
*   **Task Queues (Celery, RQ, Huey, ARQ):** Automatically create transactions for tasks, propagate tracing context.
*   **Logging:** Captures standard Python `logging` records as breadcrumbs or events (see details below).
*   **Stdlib:** Instruments standard library modules like `http.client` (used by `requests`, `urllib3`) and `subprocess` to create breadcrumbs.

*(Refer to [[Sentry Python Integrations]] list for categories and auto-enable status.)*

### Logging Integration In-Depth

*   Enabled by default (`Default Integrations`).
*   Listens to Python's standard `logging` module.
*   **Default Behavior:**
    *   `INFO` and higher level logs -> Breadcrumbs
    *   `ERROR` and higher level logs -> Sentry Events
    *   `logger.exception()` -> Sentry Event with exception info.
*   **Customization:**
    ```python
    import logging
    from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger

    sentry_sdk.init(
        dsn="YOUR_DSN_HERE",
        integrations=[
            LoggingIntegration(
                level=logging.DEBUG,       # Breadcrumb level
                event_level=logging.WARNING # Event level
            )
        ]
    )
    # Ignore specific noisy loggers
    ignore_logger("some_verbose_library")
    ```

## 5. Performance Monitoring (Tracing)

Captures timed operations (transactions and spans) to analyze performance. Requires `traces_sample_rate` or `traces_sampler` > 0.

### Automatic Instrumentation

Integrations (Web frameworks, DBs, Task Queues, HTTP clients via Stdlib) automatically create transactions and spans for common operations.

### Manual Instrumentation

For custom code blocks or unsupported libraries.

#### Creating Transactions

Wrap logical units of work (e.g., a background task, a complex calculation).

```python
import time
import sentry_sdk

def run_report(report_id):
    # Start a transaction
    with sentry_sdk.start_transaction(op="task", name=f"Generate Report {report_id}") as transaction:
        transaction.set_tag("report.type", "financial")
        # ... load data ...
        time.sleep(0.5)
        # ... generate report ...
        time.sleep(1.0)
        # Transaction automatically finishes on exit
```

#### Creating Spans (within a Transaction)

Wrap smaller operations within a transaction.

**Using Context Manager:**

```python
def process_data(data):
    with sentry_sdk.start_span(op="data.parse", description="Parse Input Data"):
        parsed = parse(data) # Your parsing function
    with sentry_sdk.start_span(op="data.validate", description="Validate Parsed Data"):
        validate(parsed) # Your validation function
    return parsed
```

**Using Decorator (`@sentry_sdk.trace`):**

```python
@sentry_sdk.trace(op="db.query", description="Fetch User Data")
def get_user_from_db(user_id):
    # ... database logic ...
    span = sentry_sdk.get_current_span()
    if span: span.set_tag("db.query.type", "SELECT")
    return db_result

# Call within an active transaction
user = get_user_from_db(123)
```

**Manually Start/Finish:**

```python
def manual_span_example():
    span = sentry_sdk.start_span(op="manual.op", description="Manual Step")
    try:
        # ... do work ...
    finally:
        span.finish() # Essential!
```

#### Nesting Spans

Spans automatically nest based on context managers or decorator calls. Manual nesting uses `parent_span.start_child(...)`.

#### `functions_to_trace`

Instrument functions globally via `sentry_sdk.init`:

```python
sentry_sdk.init(
    # ... other options ...
    traces_sample_rate=1.0,
    functions_to_trace=[
        {"qualified_name": "my_module.utils.slow_utility_function"},
        {"qualified_name": "my_app.services.ApiService.make_external_call"},
    ]
)
```

#### Adding Data to Spans/Transactions

Use `set_tag()` (searchable) or `set_data()` (non-searchable, richer types).

```python
with sentry_sdk.start_span(op="cache.get", description="Fetch from Redis") as span:
    span.set_tag("cache.key_prefix", "user:")
    span.set_data("cache.hit", True)
    span.set_data("cache.item_size", 512)
    span.set_data("cache.keys_fetched", ["user:123", "user:456"]) # Arrays allowed
```

### Span Data Conventions

Sentry follows OpenTelemetry semantic conventions where possible. Key `op` prefixes include:
*   `http.server`: Incoming web request
*   `http.client`: Outgoing HTTP request
*   `db.query`: Database query
*   `db`: General DB operation
*   `cache.get`, `cache.put`: Cache operations
*   `queue.publish`, `queue.process`: Message queue operations
*   `ai.completion`: AI/ML model inference

Common data attributes (use underscores, lowercase): `http.request.method`, `http.response.status_code`, `db.system`, `db.operation`, `cache.hit`, `code.filepath`, `code.lineno`, `thread.id`. *(See [[Sentry Python Tracing Guide]] for full tables)*.

### Custom Instrumentation Examples

*   **HTTP Requests:** (Often auto-instrumented via Stdlib) Manual example:
    ```python
    import requests
    from urllib.parse import urlparse

    def instrumented_get(url):
        parsed_url = urlparse(url)
        with sentry_sdk.start_span(op="http.client", description=f"GET {url}") as span:
            span.set_data("http.request.method", "GET")
            span.set_data("url", url) # Full URL
            if parsed_url.hostname: span.set_data("server.address", parsed_url.hostname)
            if parsed_url.port: span.set_data("server.port", parsed_url.port)
            if parsed_url.query: span.set_data("http.query", "?" + parsed_url.query)

            response = requests.get(url)

            span.set_http_status(response.status_code) # Use helper for status
            if 'content-length' in response.headers:
                 span.set_data("http.response_content_length", int(response.headers['content-length']))
            return response
    ```
*   **Queues:** Instrument message publishing and processing.
    ```python
    # Producer Side (within a transaction)
    with sentry_sdk.start_span(op="queue.publish", description=f"Publish to {queue_name}") as span:
        span.set_data("messaging.destination.name", queue_name)
        span.set_data("messaging.message.id", message_id)
        body_size = len(message_body.encode('utf-8'))
        span.set_data("messaging.message.body.size", body_size)

        trace_headers = {
            "sentry-trace": sentry_sdk.get_traceparent() or "",
            "baggage": sentry_sdk.get_baggage() or ""
        }
        # ... publish message_body with trace_headers ...

    # Consumer Side
    # incoming_headers = ... get headers from message ...
    # queue_name = ...
    # message_id = ...
    # body_size = ...
    # received_timestamp = ... # when message was picked up
    # published_timestamp = ... # if available from message metadata

    transaction = sentry_sdk.continue_trace(incoming_headers, op="queue.process", name=f"Process {queue_name}")
    with sentry_sdk.start_transaction(transaction):
        with sentry_sdk.start_span(op="queue.process", description=f"Process {queue_name}") as span:
            span.set_data("messaging.destination.name", queue_name)
            span.set_data("messaging.message.id", message_id)
            span.set_data("messaging.message.body.size", body_size)
            # Optional: Calculate latency
            # if published_timestamp:
            #     latency_ms = (received_timestamp - published_timestamp).total_seconds() * 1000
            #     span.set_data("messaging.message.receive.latency", latency_ms)

            try:
                # ... process message ...
                transaction.set_status("ok")
            except Exception as e:
                transaction.set_status("internal_error")
                sentry_sdk.capture_exception(e)
                raise
    ```
*   **Caches:** Instrument cache hits and misses.
    ```python
    # Cache Get
    key = "my-cache-key"
    with sentry_sdk.start_span(op="cache.get", description=f"GET {key}") as span:
        span.set_data("cache.key", [key])
        value = cache_library.get(key) # Your cache library
        hit = value is not None
        span.set_data("cache.hit", hit)
        if hit:
            try:
                span.set_data("cache.item_size", len(pickle.dumps(value))) # Example sizing
            except Exception: pass # Ignore errors during instrumentation

    # Cache Put
    key = "another-key"
    value = {"data": 123}
    with sentry_sdk.start_span(op="cache.put", description=f"PUT {key}") as span:
         span.set_data("cache.key", [key])
         try:
             span.set_data("cache.item_size", len(pickle.dumps(value))) # Example sizing
         except Exception: pass
         cache_library.set(key, value) # Your cache library
    ```

### Custom Trace Propagation

For integrating with systems not automatically handled or across non-HTTP boundaries.

*   **Outgoing:** Add `sentry-trace` and `baggage` headers to your request/message metadata.
    ```python
    outgoing_headers = {
        "sentry-trace": sentry_sdk.get_traceparent() or "", # Get current trace context
        "baggage": sentry_sdk.get_baggage() or ""       # Get baggage data
    }
    # ... send request/message with outgoing_headers ...
    ```
*   **Incoming:** Extract headers and continue the trace.
    ```python
    # incoming_headers = ... dict containing 'sentry-trace' and 'baggage' ...
    transaction = sentry_sdk.continue_trace(incoming_headers, name="My Custom Task", op="task")
    with sentry_sdk.start_transaction(transaction):
        # ... task logic ...
    ```

## 6. Profiling

Captures function call stacks over time to identify CPU-bound bottlenecks. Requires `profiles_sample_rate` or `profiles_sampler` > 0 and Tracing enabled.

### Transaction-Based Profiling (Default Mode)

*   Enabled by setting `profiles_sample_rate` or `profiles_sampler`.
*   A profile is captured for the duration of each *sampled transaction*.
*   Profile duration is limited (typically 30 seconds max).

### Continuous Profiling (SDK >= 2.21.0)

*   Captures profiling data for the entire process lifetime, uploading periodically.
*   Not tied directly to individual transaction durations.
*   Enable via experimental options or session sample rate:
    ```python
    sentry_sdk.init(
        # ... DSN, traces_sample_rate=1.0 ...
        # Option 1: Via capture rate experiment (preferred for backend)
        _experiments={
            "continuous_profiling_capture_rate": 101, # Profiler sampling frequency in Hz
        },
        # Option 2: Via session sampling (less common for typical backend)
        # profile_session_sample_rate=1.0, # Sample 100% of "sessions" (process lifetime)
    )
    ```
*   Can also be started manually (`sentry_sdk.profiler.start_profiler()`) or automatically with transactions (`_experiments={"continuous_profiling_auto_start": True}`).

## 7. Advanced Configuration: Filtering & Sampling

Control the volume and type of data sent to Sentry.

### Filtering Events (`before_send`)

Modify or drop error/message events before they are sent.

```python
def filter_or_modify_error_event(event, hint):
    # Example: Drop validation errors
    if 'exc_info' in hint:
        exc_type, exc_value, tb = hint['exc_info']
        if isinstance(exc_value, (MyValidationError, AnotherValidationError)):
            return None # Drop event

    # Example: Add extra data based on exception type
    if 'exc_info' in hint and isinstance(hint['exc_info'][1], ConnectionError):
        event.setdefault('extra', {})['network_retries'] = get_retry_count()

    # Example: Scrub sensitive data from request body (if PII is sent)
    if 'request' in event and 'data' in event['request']:
         if isinstance(event['request']['data'], dict):
              event['request']['data'].pop('password', None) # Basic scrubbing

    return event # Return the (modified) event to send it

sentry_sdk.init(
    # ...
    before_send=filter_or_modify_error_event
)
```

### Filtering Breadcrumbs (`before_breadcrumb`)

```python
def filter_or_modify_breadcrumb(breadcrumb, hint):
    # Example: Drop noisy SQL breadcrumbs
    if breadcrumb.get("category") == "db.sql.query" and \
       breadcrumb.get("message", "").startswith("SELECT ... FROM noisy_table"):
        return None

    # Example: Redact sensitive info from HTTP breadcrumb data
    if breadcrumb.get("category") == "http" and 'data' in breadcrumb and 'url' in breadcrumb['data']:
         if 'token=' in breadcrumb['data']['url']:
             breadcrumb['data']['url'] = "[REDACTED_URL]"

    return breadcrumb

sentry_sdk.init(
    # ...
    before_breadcrumb=filter_or_modify_breadcrumb
)
```

### Filtering Transactions (`before_send_transaction`)

Modify or drop performance transaction events.

```python
from urllib.parse import urlparse

def filter_or_modify_transaction_event(event, hint):
    # Example: Drop health check transactions
    transaction_name = event.get('transaction')
    if transaction_name and 'health' in transaction_name.lower():
        return None

    # Example: Drop transactions based on request URL path
    if 'request' in event and 'url' in event['request']:
        try:
            path = urlparse(event['request']['url']).path
            if path == '/ping':
                return None
        except Exception:
            pass # Ignore parsing errors

    # Example: Add a tag to all transactions
    event.setdefault('tags', {})['processed_by_hook'] = 'true'

    return event

sentry_sdk.init(
    # ...
    before_send_transaction=filter_or_modify_transaction_event
)
```

### Event Hints

The `hint` dictionary passed to `before_send` and `before_breadcrumb` contains original objects used to create the event/breadcrumb. Common keys:
*   `exc_info`: `(type, value, traceback)` tuple for exceptions.
*   `log_record`: The original `logging.LogRecord` instance.
*   `httplib_request`: Original `http.client.HTTPConnection` request object for Stdlib integration breadcrumbs.

### Sampling Configuration

Control event volume using sampling rates.

*   **Error Sampling:**
    *   `sample_rate`: (0.0-1.0) Static rate for all errors.
    *   `error_sampler`: `(event, hint) -> float` function for dynamic error sampling based on type or other data.

*   **Transaction Sampling (Tracing):**
    *   `traces_sample_rate`: (0.0-1.0) Static rate for all transactions.
    *   `traces_sampler`: `(sampling_context) -> float | bool` function for dynamic transaction sampling. `sampling_context` contains `transaction_context` (`name`, `op`), `parent_sampled` (boolean), and custom data passed to `start_transaction`. **It's strongly recommended to respect `parent_sampled` to avoid breaking distributed traces.**

    ```python
    def my_traces_sampler(sampling_context):
        # Respect parent decision if available
        if sampling_context.get("parent_sampled") is not None:
            return sampling_context["parent_sampled"]

        # Sample based on transaction name or op
        tx_context = sampling_context.get("transaction_context", {})
        op = tx_context.get("op")
        name = tx_context.get("name")

        if op == "http.server" and name and "/admin/" in name:
            return 1.0 # Sample all admin requests
        elif op == "celery.task":
            return 0.1 # Sample 10% of celery tasks
        else:
            return 0.01 # Sample 1% of everything else
    ```
*   **Profiling Sampling:**
    *   `profiles_sample_rate`: (0.0-1.0) Percentage of *sampled transactions* to profile.
    *   `profiles_sampler`: `(sampling_context) -> float | bool` function for dynamic profiling decisions based on transaction context.

*   **Sampling Precedence:**
    1.  Direct `sampled=True/False` passed to `start_transaction`.
    2.  Decision from `traces_sampler` (if defined). Can override parent decision (use with caution).
    3.  Parent's sampling decision (if `traces_sampler` isn't defined or returns `None` / doesn't check parent).
    4.  `traces_sample_rate` (if no sampler and no parent decision).

## 8. Configuration Options Reference Table

| Option                        | Type                                         | Default       | Description                                                                                             |
| :---------------------------- | :------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------ |
| `dsn`                         | `string`                                     | `None`        | **Required.** Your project DSN.                                                                         |
| `release`                     | `string`                                     | Auto-detected | Application version/tag.                                                                                |
| `environment`                 | `string`                                     | Auto-detected | Deployment environment (`production`, `staging`).                                                       |
| `send_default_pii`            | `boolean`                                    | `False`       | Send user IP addresses, cookies, usernames, request bodies etc.                                         |
| `traces_sample_rate`          | `float` (0.0-1.0)                            | `0.0`         | Static percentage of transactions to sample for tracing.                                                  |
| `traces_sampler`              | `callable`                                   | `None`        | Function `(sampling_context) -> float | bool` for dynamic trace sampling.                                      |
| `profiles_sample_rate`        | `float` (0.0-1.0)                            | `0.0`         | Percentage of *sampled transactions* to profile.                                                          |
| `profiles_sampler`            | `callable`                                   | `None`        | Function `(sampling_context) -> float | bool` for dynamic profile sampling.                                  |
| `integrations`                | `list`                                       | (Defaults)    | List of integration instances to enable/configure.                                                      |
| `default_integrations`        | `boolean`                                    | `True`        | Enable/disable core integrations (Logging, Stdlib, Excepthook, etc.).                                     |
| `auto_enabling_integrations`  | `boolean`                                    | `True`        | Automatically enable framework/library integrations based on installed packages.                        |
| `disabled_integrations`       | `list`                                       | `[]`          | List of integration *classes* to explicitly disable.                                                    |
| `before_send`                 | `callable`                                   | `None`        | Function `(event, hint) -> event \| None` to modify/filter error/message events.                          |
| `before_send_transaction`     | `callable`                                   | `None`        | Function `(event, hint) -> event \| None` to modify/filter transaction events.                          |
| `before_breadcrumb`           | `callable`                                   | `None`        | Function `(breadcrumb, hint) -> breadcrumb \| None` to modify/filter breadcrumbs.                           |
| `ignore_errors`               | `list`                                       | `[]`          | List of exception *types* (classes) to ignore.                                                          |
| `debug`                       | `boolean`                                    | `False`       | Enable verbose SDK's own debug logging.                                                                 |
| `attach_stacktrace`           | `boolean`                                    | `False`       | Attach stack traces to `capture_message` events.                                                        |
| `max_breadcrumbs`             | `int`                                        | `100`         | Maximum number of breadcrumbs stored per scope.                                                         |
| `functions_to_trace`          | `list[dict]`                                 | `[]`          | List `[{"qualified_name": "..."}]` for automatic function tracing.                                      |
| `sample_rate`                 | `float` (0.0-1.0)                            | `1.0`         | Static percentage of *error* events to send.                                                            |
| `error_sampler`               | `callable`                                   | `None`        | Function `(event, hint) -> float` for dynamic *error* event sampling.                                   |
| `max_value_length`            | `int`                                        | `1024`        | Max length for string values in context/breadcrumbs before truncation.                                  |
| `send_client_reports`         | `boolean`                                    | `True`        | Send SDK diagnostic reports to Sentry.                                                                  |
| `shutdown_timeout`            | `float`                                      | `2.0`         | Seconds to wait for flushing events on shutdown (via `AtexitIntegration`). `0` disables wait.         |
| `propagate_traces`            | `boolean`                                    | `True`        | Whether integrations should automatically propagate `sentry-trace` / `baggage` headers.                   |
| `trace_propagation_targets`   | `list[str \| re.Pattern]`                    | `['.*']`      | List of URL patterns (regex or string contains) to which tracing headers *should* be propagated.        |
| `_experiments`                | `dict`                                       | `{}`          | For enabling experimental features (e.g., `continuous_profiling_auto_start`, `continuous_profiling_capture_rate`). |
| `profile_session_sample_rate` | `float` (0.0-1.0)                            | `0.0`         | (Continuous Profiling) Sample rate based on process lifetime "sessions". Use with `_experiments` options. |


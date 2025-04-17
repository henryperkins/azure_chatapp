# Enable Profiling in Your App

Profiling with Sentry allows you to monitor your software's performance by sampling the program's call stack in various environments. This feature collects function-level information about your code, enabling you to fine-tune performance, enhance user satisfaction, and reduce costs. Sentry's profiler captures function calls and their exact locations, aggregates them, and shows you the most common code paths, highlighting areas for optimization.

## Basic Profiling Setup

To enable profiling in your Python application, follow these steps:

```python
import sentry_sdk

def profiles_sampler(sampling_context):
    # Define your sampling logic here
    # return a number between 0 and 1 or a boolean

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",

    # Add data like request headers and IP for users, if applicable
    send_default_pii=True,

    traces_sample_rate=1.0,

    # Set a uniform sample rate
    profiles_sample_rate=1.0,

    # Alternatively, control sampling dynamically
    profiles_sampler=profiles_sampler
)
```

## Continuous Profiling

Starting from version 2.21.0, Sentry offers continuous profiling, which allows you to collect profiling data without the 30-second limitation. This mode periodically uploads profiling data while your application runs.

### Manual Start and Stop

```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    send_default_pii=True,
    traces_sample_rate=1.0,

    # Collect profiles for all sessions
    profile_session_sample_rate=1.0,
)

sentry_sdk.profiler.start_profiler()

# Application code here

sentry_sdk.profiler.stop_profiler()
```

### Automatic Start with Transactions

For applications like web servers, you can automatically start the continuous profiler when a transaction begins:

```python
import sentry_sdk

sentry_sdk.init(
    dsn="https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
    send_default_pii=True,
    traces_sample_rate=1.0,
    _experiments={
      "continuous_profiling_auto_start": True,
    },
)
```

### Sampling

- **Sampling Decision**: The sampling decision for continuous profiling is made once when the SDK is configured and applies to the entire process.
- **Reducing Profiles**: The new APIs do not include sampling functionality. To reduce the number of profiles, manage it at the callsites.

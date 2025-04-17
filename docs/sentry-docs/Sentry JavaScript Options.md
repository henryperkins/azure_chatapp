## Learn more about how the SDK can be configured via options. These are being passed to the init function and therefore set when the SDK is first initialized.

- [Core Options](#core-options)
    - [dsn](#dsn)
    - [debug](#debug)
    - [release](#release)
    - [environment](#environment)
    - [tunnel](#tunnel)
    - [maxBreadcrumbs](#maxBreadcrumbs)
    - [attachStacktrace](#attachStacktrace)
    - [initialScope](#initialScope)
    - [maxValueLength](#maxValueLength)
    - [normalizeDepth](#normalizeDepth)
    - [normalizeMaxBreadth](#normalizeMaxBreadth)
    - [enabled](#enabled)
    - [sendClientReports](#sendClientReports)
    - [integrations](#integrations)
    - [defaultIntegrations](#defaultIntegrations)
    - [beforeBreadcrumb](#beforeBreadcrumb)
    - [transport](#transport)
    - [transportOptions](#transportOptions)
- [Error Monitoring Options](#error-monitoring-options)
    - [sampleRate](#sampleRate)
    - [beforeSend](#beforeSend)
    - [ignoreErrors](#ignoreErrors)
    - [denyUrls](#denyUrls)
    - [allowUrls](#allowUrls)
- [Tracing Options](#tracing-options)
    - [tracesSampleRate](#tracesSampleRate)
    - [tracesSampler](#tracesSampler)
    - [tracePropagationTargets](#tracePropagationTargets)
    - [beforeSendTransaction](#beforeSendTransaction)
    - [beforeSendSpan](#beforeSendSpan)
    - [ignoreTransactions](#ignoreTransactions)
- [Session Replay Options](#session-replay-options)
    - [replaysSessionSampleRate](#replaysSessionSampleRate)
    - [replaysOnErrorSampleRate](#replaysOnErrorSampleRate)
- [Profiling Options](#profiling-options)
    - [profilesSampleRate](#profilesSampleRate)

### [dsn](#dsn)

|   |   |
|---|---|
|Type|`string`|

The DSN tells the SDK where to send the events. If this is not set, the SDK will not send any events. Learn more about [DSN utilization](https://docs.sentry.io/product/sentry-basics/dsn-explainer/#dsn-utilization).

Copied

```
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
});
```

### [debug](#debug)

|   |   |
|---|---|
|Type|`boolean`|
|Default|`false`|

Turns debug mode on or off. If debug is enabled SDK will attempt to print out useful debugging information about what the SDK is doing.

### [release](#release)

|   |   |
|---|---|
|Type|`string`|

Sets the release. Release names are strings, but some formats are detected by Sentry and might be rendered differently. Learn more about how to send release data so Sentry can tell you about regressions between releases and identify the potential source in [the releases documentation](https://docs.sentry.io/product/releases/) or the [sandbox](https://try.sentry-demo.com/demo/start/?scenario=releases&projectSlug=react&source=docs).

In the browser, the SDK will try to read this value from `window.SENTRY_RELEASE.id` if available.

### [environment](#environment)

|   |   |
|---|---|
|Type|`string`|
|Default|`production`|

Sets the environment. Defaults to `development` or `production` depending on whether the application is packaged.

Environments tell you where an error occurred, whether that's in your production system, your staging server, or elsewhere.

Sentry automatically creates an environment when it receives an event with the environment parameter set.

Environments are case-sensitive. The environment name can't contain newlines, spaces or forward slashes, can't be the string "None", or exceed 64 characters. You can't delete environments, but you can hide them.

### [tunnel](#tunnel)

|   |   |
|---|---|
|Type|`string`|

Sets the URL that will be used to transport captured events. This can be used to work around ad-blockers or to have more granular control over events sent to Sentry. Adding your DSN is still required when using this option so necessary attributes can be set on the generated Sentry data. This option **requires the implementation** of a custom server endpoint. Learn more and find examples in [Dealing with Ad-Blockers](https://docs.sentry.io/platforms/javascript/troubleshooting/#dealing-with-ad-blockers).

|   |   |
|---|---|
|Type|`number`|
|Default|`100`|

This variable controls the total amount of breadcrumbs that should be captured. You should be aware that Sentry has a [maximum payload size](https://develop.sentry.dev/sdk/data-model/envelopes/#size-limits) and any events exceeding that payload size will be dropped.

### [attachStacktrace](#attachStacktrace)

|   |   |
|---|---|
|Type|`boolean`|
|Default|`false`|

When enabled, stack traces are automatically attached to all messages logged. Stack traces are always attached to exceptions; however, when this option is set, stack traces are also sent with messages. This option, for instance, means that stack traces appear next to all messages captured with `Sentry.captureMessage()`.

Grouping in Sentry is different for events with stack traces and without. As a result, you will get new groups as you enable or disable this flag for certain events.

### [initialScope](#initialScope)

|   |   |
|---|---|
|Type|`CaptureContext`|

Data to be set to the initial scope. Initial scope can be defined either as an object or a callback function, as shown below.

Copied

```
// Using an object
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  initialScope: {
    tags: { "my-tag": "my value" },
    user: { id: 42, email: "john.doe@example.com" },
  },
});

// Using a callback function
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  initialScope: (scope) => {
    scope.setTags({ a: "b" });
    return scope;
  },
});
```

### [maxValueLength](#maxValueLength)

|   |   |
|---|---|
|Type|`number`|
|Default|`250`|

Maximum number of characters every string property on events sent to Sentry can have before it will be truncated.

### [normalizeDepth](#normalizeDepth)

|   |   |
|---|---|
|Type|`number`|
|Default|`3`|

Sentry SDKs normalize any contextual data to a given depth. Any data beyond this depth will be trimmed and marked using its type instead (`[Object]` or `[Array]`), without walking the tree any further. By default, walking is performed three levels deep.

### [normalizeMaxBreadth](#normalizeMaxBreadth)

|   |   |
|---|---|
|Type|`number`|
|Default|`1000`|

This is the maximum number of properties or entries that will be included in any given object or array when the SDK is normalizing contextual data. Any data beyond this depth will be dropped.

### [enabled](#enabled)

|   |   |
|---|---|
|Type|`boolean`|
|Default|`true`|

Specifies whether this SDK should send events to Sentry. Setting this to `enabled: false` doesn't prevent all overhead from Sentry instrumentation. To disable Sentry completely, depending on environment, call `Sentry.init` conditionally.

### [sendClientReports](#sendClientReports)

|   |   |
|---|---|
|Type|`boolean`|
|Default|`true`|

Set this option to `false` to disable sending of client reports. Client reports are a protocol feature that let clients send status reports about themselves to Sentry. They are currently mainly used to emit outcomes for events that were never sent.

### [integrations](#integrations)

|   |   |
|---|---|
|Type|`Array<Integration> \| (integrations: Array<Integration>) => Array<Integration>`|
|Default|`[]`|

Pass additional integrations that should be initialized with the SDK. Integrations are pieces of code that can be used to extend the SDK's functionality. They can be used to add custom event processors, context providers, or to hook into the SDK's lifecycle.

See [integration docs](https://docs.sentry.io/platforms/javascript/configuration/integrations/) for more information.

### [defaultIntegrations](#defaultIntegrations)

|   |   |
|---|---|
|Type|`undefined \| false`|

This can be used to disable integrations that are added by default. When set to `false`, no default integrations are added.

See [integration docs](https://docs.sentry.io/platforms/javascript/configuration/integrations/#modifying-default-integrations) to see how you can modify the default integrations.

### [beforeBreadcrumb](#beforeBreadcrumb)

|   |   |
|---|---|
|Type|`(breadcrumb: Breadcrumb, hint?: BreadcrumbHint) => Breadcrumb \| null`|

This function is called with a breadcrumb object before the breadcrumb is added to the scope. When nothing is returned from the function, the breadcrumb is dropped. To pass the breadcrumb through, return the first argument, which contains the breadcrumb object. The callback gets a second argument (called a "hint") which contains the original object from which the breadcrumb was created to further customize what the breadcrumb should look like.

### [transport](#transport)

|   |   |
|---|---|
|Type|`(transportOptions: TransportOptions) => Transport`|

The JavaScript SDK uses a transport to send events to Sentry. On modern browsers, most transports use the browsers' fetch API to send events. Transports will drop an event if it fails to send due to a lack of connection.

In the browser, a `fetch`-based transport is used by default.

### [transportOptions](#transportOptions)

|   |   |
|---|---|
|Type|`TransportOptions`|

Options used to configure the transport. This is an object with the following possible optional keys:

- `headers`: An object containing headers to be sent with every request.
- `fetchOptions`: An object containing options to be passed to the `fetch` call. Used by the SDK's fetch transport.

### [sampleRate](#sampleRate)

|   |   |
|---|---|
|Type|`number`|
|Default|`1.0`|

Configures the sample rate for error events, in the range of `0.0` to `1.0`. The default is `1.0`, which means that 100% of error events will be sent. If set to `0.1`, only 10% of error events will be sent. Events are picked randomly.

### [beforeSend](#beforeSend)

|   |   |
|---|---|
|Type|`(event: Event, hint: EventHint) => Event \| null`|

This function is called with an SDK-specific message or error event object, and can return a modified event object, or `null` to skip reporting the event. This can be used, for instance, for manual PII stripping before sending.

By the time `beforeSend` is executed, all scope data has already been applied to the event. Further modification of the scope won't have any effect.

### [ignoreErrors](#ignoreErrors)

|   |   |
|---|---|
|Type|`Array<string \| RegExp>`|
|Default|`[]`|

A list of strings or regex patterns that match error messages that shouldn't be sent to Sentry. Messages that match these strings or regular expressions will be filtered out before they're sent to Sentry. When using strings, partial matches will be filtered out, so if you need to filter by exact match, use regex patterns instead. By default, all errors are sent.

### [denyUrls](#denyUrls)

|   |   |
|---|---|
|Type|`Array<string \| RegExp>`|
|Default|`[]`|

An array of strings or regex patterns that match the URLs of scripts where errors have been created. Errors that have been created on these URLs won't be sent to Sentry. If you use this option, errors will not be sent when the top stack frame file URL contains or matches at least one entry in the `denyUrls` array. All string entries in the array will be matched with `stackFrameUrl.contains(entry)`, while all RegEx entries will be matched with `stackFrameUrl.match(entry)`.

This matching logic applies to captured exceptions not raw message events. By default, all errors are sent.

### [allowUrls](#allowUrls)

|   |   |
|---|---|
|Type|`Array<string \| RegExp>`|
|Default|`[]`|

An array of strings or regex patterns that match the URLs of scripts where errors have been created. Only errors that have been created on these URLs will be sent to Sentry. If you use this option, errors will only be sent when the top stack frame file URL contains or matches at least one entry in the allowUrls array. All string entries in the array will be matched with `stackFrameUrl.contains(entry)`, while all RegEx entries will be matched with `stackFrameUrl.match(entry)`.

For example, if you add `'foo.com'` to the array, errors created on `https://bar.com/myfile/foo.com` will be captured because URL will be matched with "contains" logic and the last segment of the URL contains `foo.com`.

This matching logic applies for captured exceptions, not raw message events. By default, all errors are sent.

If your scripts are loaded from `cdn.example.com` and your site is `example.com`, you can set `allowUrls` to the follwing to exclusively capture errors being created in scripts in these locations:

Copied

```
Sentry.init({
  allowUrls: [/https?:\/\/((cdn|www)\.)?example\.com/],
});
```

### [tracesSampleRate](#tracesSampleRate)

|   |   |
|---|---|
|Type|`number`|

A number between `0` and `1`, controlling the percentage chance a given transaction will be sent to Sentry. (`0` represents 0% while `1` represents 100%.) Applies equally to all transactions created in the app. Either this or `tracesSampler` must be defined to enable tracing.

### [tracesSampler](#tracesSampler)

|   |   |
|---|---|
|Type|`(samplingContext: SamplingContext) => number \| boolean`|

A function responsible for determining the percentage chance a given transaction will be sent to Sentry. It will automatically be passed information about the transaction and the context in which it's being created, and must return a number between `0` (0% chance of being sent) and `1` (100% chance of being sent). Can also be used for filtering transactions, by returning 0 for those that are unwanted. Either this or `tracesSampleRate` must be defined to enable tracing.

The `samplingContext` object passed to the function has the following properties:

- `parentSampled`: The sampling decision of the parent transaction. This is `true` if the parent transaction was sampled, and `false` if it was not.
- `name`: The name of the span as it was started.
- `attributes`: The initial attributes of the span.

### [tracePropagationTargets](#tracePropagationTargets)

|   |   |
|---|---|
|Type|`Array<string \| RegExp>`|

An optional property that controls which downstream services receive tracing data, in the form of a `sentry-trace` and a `baggage` header attached to any outgoing HTTP requests.

The option may contain a list of strings or regex against which the URLs of outgoing requests are matched. If one of the entries in the list matches the URL of an outgoing request, trace data will be attached to that request. String entries do not have to be full matches, meaning the URL of a request is matched when it _contains_ a string provided through the option.

On the browser, all outgoing requests to the same origin will be propagated by default.

If you want to disable trace propagation, you can set this option to `[]`.

### [beforeSendTransaction](#beforeSendTransaction)

|   |   |
|---|---|
|Type|`(event: TransactionEvent, hint: EventHint) => TransactionEvent \| null`|

This function is called with a transaction event object, and can return a modified transaction event object, or `null` to skip reporting the event. This can be used, for instance, for manual PII stripping before sending.

### [beforeSendSpan](#beforeSendSpan)

|   |   |
|---|---|
|Type|`(span: SpanJSON) => SpanJSON \| null`|

This function is called with a serialized span object, and can return a modified span object. This might be useful for manually stripping PII from spans. This function is only called for root spans and all children. If you want to drop the root span, including all of its child spans, use [`beforeSendTransaction`](#beforeSendTransaction) instead.

### [ignoreTransactions](#ignoreTransactions)

|   |   |
|---|---|
|Type|`Array<string \| RegExp>`|
|Default|`[]`|

A list of strings or regex patterns that match transaction names that shouldn't be sent to Sentry. Transactions that match these strings or regular expressions will be filtered out before they're sent to Sentry. When using strings, partial matches will be filtered out, so if you need to filter by exact match, use regex patterns instead. By default, transactions spanning typical API health check requests are filtered out.

### [replaysSessionSampleRate](#replaysSessionSampleRate)

|   |   |
|---|---|
|Type|`number`|

The sample rate for replays that begin recording immediately and last the entirety of the user's session. `1.0` collects all replays, and `0` collects none.

### [replaysOnErrorSampleRate](#replaysOnErrorSampleRate)

|   |   |
|---|---|
|Type|`number`|

The sample rate for replays that are recorded when an error happens. This type of replay will record up to a minute of events prior to the error and continue recording until the session ends. `1.0` collects all sessions with an error, and `0` collects none.

### [profilesSampleRate](#profilesSampleRate)

|   |   |
|---|---|
|Type|`number`|

A number between `0` and `1`, controlling the percentage chance a given sampled transaction will be profiled. (`0` represents 0% while `1` represents 100%.) Applies equally to all transactions created in the app. This is relative to the tracing sample rate - e.g. `0.5` means 50% of sampled transactions will be profiled.

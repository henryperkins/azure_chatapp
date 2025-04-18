# Sentry.io Browser JavaScript: Implementation, Usage & Reference Guide

This guide provides a comprehensive overview of how to integrate, configure, and use the Sentry SDK for JavaScript in browser environments.

## 1. Installation & Setup

There are several ways to include the Sentry SDK in your web application.

### a) Recommended: Loader Script (Easiest & Auto-Updating)

The Loader Script is the simplest way to get started. It handles loading the correct SDK bundle, keeps it updated, and buffers events that occur before the full SDK is ready.

1.  **Get the Script:** Go to your Sentry project settings: **Settings > Projects > [Your Project] > Client Keys (DSN)**. Click "Configure" and copy the script tag from the "JavaScript Loader" section.
2.  **Add to HTML:** Place the copied `<script>` tag as the **very first script** in the `<head>` of your HTML document. This ensures it can capture errors from any subsequent scripts.

    ```html
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8" />
        <title>My App</title>
        <!-- Sentry Loader Script (obtained from Sentry UI) - Place First! -->
        <script
          src="https://js.sentry-cdn.com/[YOUR_DSN_PUBLIC_KEY].min.js"
          crossorigin="anonymous"
        ></script>
        <!-- Other meta tags, CSS links -->
    </head>
    <body>
        <!-- Your app content -->
        <!-- Other scripts -->
    </body>
    </html>
    ```

3.  **Default Behavior:** By default, the loader enables Error Monitoring, Tracing (`tracesSampleRate: 1.0`), and Session Replay (`replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`).

### b) Using CDN Bundles

If you prefer manual control over the SDK version and bundle type, you can use direct CDN links. Choose the bundle that fits your needs (Error Monitoring, Tracing, Replay).

1.  **Choose a Bundle:** Select the appropriate bundle URL from the [CDN Bundle Reference](#cdn-bundle-reference) below.
2.  **Add to HTML:** Include the `<script>` tag, preferably early in your `<head>`. Remember to include the integrity hash.

    ```html
    <!-- Example: Bundle with Error Monitoring & Tracing -->
    <script
      src="https://browser.sentry-cdn.com/9.5.0/bundle.tracing.min.js"
      integrity="sha384-nsiByevQ25GvAyX+c3T3VctX7x10qZpYsLt3dfkBt04A71M451kWQEu+K4r1Uuk3"
      crossorigin="anonymous"
    ></script>
    ```

### c) Using npm (with a Bundler)

If you use a build tool like Webpack, Rollup, or Vite:

1.  **Install Package:**
    ```bash
    npm install @sentry/browser
    # or
    yarn add @sentry/browser
    ```
2.  **Import in your Code:**
    ```javascript
    import * as Sentry from "@sentry/browser";
    ```

## 2. Initialization (`Sentry.init`)

After including the SDK, you need to initialize it. This tells Sentry *where* to send events (your DSN) and configures its behavior.

### Basic Initialization

```javascript
import * as Sentry from "@sentry/browser"; // If using npm

Sentry.init({
  dsn: "https://yourPublicKey@o0.ingest.sentry.io/0", // REQUIRED: Get this from Sentry settings

  // === Recommended Configuration ===
  release: "my-project-name@1.0.0", // Set to your application's version
  environment: "production", // Set to 'development', 'staging', 'production', etc.
  integrations: [
    // Add integrations based on the features you need (or the bundle you chose)
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      // Session Replay specific options
      maskAllText: true,
      blockAllMedia: true,
    }),
    // Other default integrations are usually included automatically
  ],

  // === Performance Monitoring ===
  tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring. Adjust in production!
  // or use tracesSampler for dynamic sampling
  // tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/], // Control distributed tracing headers

  // === Session Replay ===
  replaysSessionSampleRate: 0.1, // Capture 10% of user sessions for replay.
  replaysOnErrorSampleRate: 1.0, // Capture 100% of sessions with errors for replay.

  // === Other Common Options ===
  // beforeSend: (event, hint) => { /* Modify or drop event */ return event; },
  // ignoreErrors: [/SpecificErrorToIgnore/],
  // allowUrls: [/https?:\/\/((cdn|www)\.)?example\.com/],
});
```

### Initialization with Loader Script

If using the Loader Script, it implicitly calls `Sentry.init` with your DSN. To add *custom* configuration:

1.  Define `window.sentryOnLoad` **before** the loader script tag.
2.  Call `Sentry.init` inside this function (DSN is not needed here).

```html
<script>
  // Define this *before* the loader script tag
  window.sentryOnLoad = function() {
    Sentry.init({
      // Custom configuration overrides defaults set by the loader
      release: "my-app@2.1.0",
      environment: "staging",
      tracesSampleRate: 0.5, // Override default
      replaysSessionSampleRate: 0, // Disable session replay unless error occurs
      // Add integrations if needed (e.g., if you disabled defaults in Sentry UI)
      // integrations: [ Sentry.browserTracingIntegration() ],
    });
    // You can also call other Sentry APIs here
    Sentry.setTag("initial_config", "complete");
  };
</script>

<!-- Sentry Loader Script -->
<script src="https://js.sentry-cdn.com/[YOUR_DSN_PUBLIC_KEY].min.js" crossorigin="anonymous"></script>
```

*(See the full [Configuration Options Reference](#configuration-options-reference) below for all available settings.)*

## 3. Core Usage: Capturing Data

Once initialized, you can interact with the Sentry SDK.

### Capturing Errors

Sentry automatically captures unhandled exceptions and promise rejections. You can also manually capture errors:

```javascript
try {
  potentiallyFailingFunction();
} catch (error) {
  Sentry.captureException(error);
}

// Capture with additional context scoped to this event
try {
  anotherFailingFunction();
} catch (error) {
  Sentry.withScope(scope => {
    scope.setTag("page_section", "payment_form");
    scope.setLevel("warning");
    Sentry.captureException(error);
  });
}
```

### Capturing Messages

Send informational messages or warnings:

```javascript
Sentry.captureMessage("User completed onboarding step 3.", "info"); // Levels: fatal, error, warning, log, info, debug
```

### Adding Breadcrumbs

Breadcrumbs track events leading up to an error. Many are added automatically (clicks, console logs, XHR/fetch, navigation). Add custom ones:

```javascript
Sentry.addBreadcrumb({
  category: 'auth',
  message: 'User logged in',
  level: 'info',
  data: { userId: 'user123' } // Optional arbitrary data
});
```

### Setting User Context

Identify the user experiencing the issue:

```javascript
Sentry.setUser({
  id: 'user_backend_id_456',
  email: 'jane.doe@example.com',
  username: 'janedoe',
  ip_address: '{{auto}}' // Let Sentry detect IP (requires sendDefaultPii: true)
  // You can add other custom fields
  // segment: 'premium'
});

// To clear user data (on logout):
Sentry.setUser(null);
```

### Setting Tags

Tags are searchable key/value pairs used for filtering issues:

```javascript
Sentry.setTag("ui.theme", "dark");
Sentry.setTag("user.plan", "free");

// Set multiple tags
Sentry.setTags({
  "browser.name": "chrome",
  "feature.flag.new_dashboard": true // Values are strings
});
```

### Setting Custom Context

Attach arbitrary, non-searchable structured data:

```javascript
Sentry.setContext("device_details", {
  memory: navigator.deviceMemory || 'unknown',
  cores: navigator.hardwareConcurrency || 'unknown',
  connection: navigator.connection ? navigator.connection.effectiveType : 'unknown'
});

// Clear a context
Sentry.setContext("device_details", null);
```

## 4. Advanced Features

### Performance Monitoring (Tracing)

Requires a tracing-enabled bundle/integration (`bundle.tracing.min.js` or `BrowserTracing`).

- Captures page loads, navigations, and resource timings automatically.
- Allows creating custom transactions and spans:

```javascript
// Start a custom transaction
const transaction = Sentry.startTransaction({ name: "Process Upload" });
Sentry.configureScope(scope => scope.setSpan(transaction)); // Make it active

try {
  // Create child spans for operations
  const span1 = transaction.startChild({ op: 'parse', description: 'Parse File Header' });
  parseHeader();
  span1.end();

  const span2 = transaction.startChild({ op: 'http.client', description: 'Upload Data Chunk' });
  await uploadChunk();
  span2.end();

} catch (e) {
  Sentry.captureException(e);
  transaction.setStatus("internal_error");
} finally {
  transaction.end(); // Finish the transaction
}
```

### Session Replay

Requires a replay-enabled bundle/integration (`bundle.replay.min.js` or `Replay`).

- Records user sessions as video-like replays.
- Configuration is done via `Sentry.init` (see sample rates above) and integration options:

```javascript
Sentry.init({
  // ... other options
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,      // Mask all text content
      blockAllMedia: true,     // Block images, videos, etc.
      // networkDetailAllowUrls: ['https://api.myapp.com/users/'], // Selectively unmask network request bodies
    }),
  ],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

### Event Attachments

Attach files (logs, config, data) to events for more context.

```javascript
// Add an attachment to the current scope (will be sent with the *next* event)
try {
  // Generate some data or read a log snippet
  const logData = getRecentLogEntries(); // Your function
  Sentry.getCurrentScope().addAttachment({
    filename: 'recent_logs.txt',
    data: logData, // Must be string or Uint8Array
    contentType: 'text/plain'
  });
  throw new Error("Failed processing user data");
} catch(e) {
  Sentry.captureException(e); // Attachment will be sent with this event
}

// Clear attachments from the scope if needed
// Sentry.getCurrentScope().clearAttachments();
```

**Limits:** Max 20MB compressed request, 100MB uncompressed attachments per event. Persist for 30 days.

## 5. Source Maps

Essential for readable stack traces from minified/uglified production code.

1.  **Generate Source Maps:** Configure your build tool (Webpack, Rollup, etc.) to output source maps (`.js.map` files) alongside your minified JavaScript.
2.  **Upload to Sentry (Recommended):** Use `sentry-cli`.
    *   **Install:** `npm install @sentry/cli -g` or use `npx @sentry/cli`
    *   **Configure Auth:** Set environment variables:
        ```bash
        export SENTRY_AUTH_TOKEN=your_auth_token
        export SENTRY_ORG=your-sentry-org-slug
        export SENTRY_PROJECT=your-sentry-project-slug
        ```
    *   **Upload:** After building your project:
        ```bash
        sentry-cli sourcemaps upload \
          --release="my-project-name@1.0.0" \ # MUST match 'release' in Sentry.init
          ./path/to/your/build/output # Directory containing JS and MAP files
          # Optional: --url-prefix '~/assets' # If served from a subpath
        ```
3.  **Alternative:** Host source maps publicly (less secure, requires correct `SourceMap` header).

## 6. Configuration Options Reference

These options are passed to `Sentry.init({...})`.

*(Adapted from [[Sentry JavaScript Options]])*

### Core Options

| Option              | Type                                                                    | Default      | Description                                                                                                                               |
| :------------------ | :---------------------------------------------------------------------- | :----------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `dsn`               | `string`                                                                |              | **Required.** Your project's Data Source Name from Sentry settings.                                                                       |
| `debug`             | `boolean`                                                               | `false`      | Enable verbose SDK logging to the console for debugging Sentry itself.                                                                    |
| `release`           | `string`                                                                |              | Your application's version (e.g., `myapp@1.2.3`, git SHA). Crucial for source maps and regression tracking. Reads `window.SENTRY_RELEASE.id`. |
| `environment`       | `string`                                                                | `production` | The deployment environment (e.g., `production`, `staging`, `development`).                                                                |
| `tunnel`            | `string`                                                                |              | URL endpoint to proxy Sentry requests (e.g., for ad-blocker workarounds). Requires a server-side implementation.                           |
| `maxBreadcrumbs`    | `number`                                                                | `100`        | Maximum number of breadcrumbs to store.                                                                                                   |
| `attachStacktrace`  | `boolean`                                                               | `false`      | Attach stack traces to `captureMessage` events.                                                                                           |
| `initialScope`      | `object \| function`                                                    |              | Data (tags, user, context) to apply to the initial scope.                                                                                 |
| `maxValueLength`    | `number`                                                                | `250`        | Max length for string values in context data before truncation.                                                                           |
| `normalizeDepth`    | `number`                                                                | `3`          | How deep to normalize nested objects/arrays in context data.                                                                              |
| `normalizeMaxBreadth` | `number`                                                              | `1000`       | Max number of properties/items in objects/arrays during normalization.                                                                    |
| `enabled`           | `boolean`                                                               | `true`       | Disable the SDK entirely (prevents sending events). `Sentry.init` can be called conditionally for complete removal.                       |
| `sendClientReports` | `boolean`                                                               | `true`       | Allow the SDK to send diagnostic reports about itself to Sentry.                                                                          |
| `integrations`      | `Integration[] \| function`                                             | `[]`         | Array of integrations to use, or a function to modify default integrations.                                                               |
| `defaultIntegrations` | `false`                                                                 |              | Set to `false` to disable all default integrations.                                                                                       |
| `beforeBreadcrumb`  | `(breadcrumb, hint) => breadcrumb \| null`                              |              | Callback to modify or drop a breadcrumb before it's recorded.                                                                             |
| `transport`         | `(options) => Transport`                                                |              | Function to provide a custom event transport implementation.                                                                              |
| `transportOptions`  | `object`                                                                |              | Options for the default transport (e.g., `{ headers: {...}, fetchOptions: {...} }`).                                                     |

### Error Monitoring Options

| Option         | Type                             | Default | Description                                                                                                                             |
| :------------- | :------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `sampleRate`   | `number` (0.0-1.0)               | `1.0`   | Percentage of error events to send. `0.5` means 50%.                                                                                    |
| `beforeSend`   | `(event, hint) => event \| null` |         | Callback to modify or drop an error/message event just before sending.                                                                  |
| `ignoreErrors` | `(string \| RegExp)[]`           | `[]`    | List of error messages (strings or regex) to ignore. Matched errors won't be sent.                                                      |
| `denyUrls`     | `(string \| RegExp)[]`           | `[]`    | Errors originating from scripts whose URLs match these patterns won't be sent.                                                          |
| `allowUrls`    | `(string \| RegExp)[]`           | `[]`    | Only errors originating from scripts whose URLs match these patterns *will* be sent. Overrides `denyUrls` if both are present.           |

### Tracing Options

| Option                   | Type                                         | Default | Description                                                                                                                      |
| :----------------------- | :------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------- |
| `tracesSampleRate`       | `number` (0.0-1.0)                           |         | Percentage of transactions to send. Required (or `tracesSampler`) to enable tracing.                                             |
| `tracesSampler`          | `(context) => number \| boolean`             |         | Function for dynamic transaction sampling based on context (name, attributes, parent decision). Required (or `tracesSampleRate`). |
| `tracePropagationTargets`| `(string \| RegExp)[]`                       | (origin)| URLs to which `sentry-trace` and `baggage` headers should be added for distributed tracing. `[]` disables propagation.          |
| `beforeSendTransaction`  | `(event, hint) => event \| null`             |         | Callback to modify or drop a transaction event before sending.                                                                   |
| `beforeSendSpan`         | `(span: SpanJSON) => SpanJSON \| null`       |         | Callback to modify or drop a serialized span before sending (for PII scrubbing, etc.). Affects root & children.                  |
| `ignoreTransactions`     | `(string \| RegExp)[]`                       | `[]`    | List of transaction names (strings or regex) to ignore. Matched transactions won't be sent.                                      |

### Session Replay Options

| Option                    | Type               | Default | Description                                                                         |
| :------------------------ | :----------------- | :------ | :---------------------------------------------------------------------------------- |
| `replaysSessionSampleRate`| `number` (0.0-1.0) |         | Percentage of user sessions to record for replay (when no error occurs).            |
| `replaysOnErrorSampleRate`| `number` (0.0-1.0) |         | Percentage of user sessions *with errors* to record for replay (includes buffer). |

### Profiling Options

| Option               | Type               | Default | Description                                                                               |
| :------------------- | :----------------- | :------ | :---------------------------------------------------------------------------------------- |
| `profilesSampleRate` | `number` (0.0-1.0) |         | Percentage of *sampled transactions* to also capture a profile. Requires tracing enabled. |

## 7. Best Practices & Tips

*   **Loader Script Placement:** Always place the Loader Script as the absolute first script in your HTML `<head>`.
*   **`defer` Attribute:** If using `defer` on your other scripts, ensure the Sentry SDK script (CDN or Loader) also has `defer` and comes first among deferred scripts. Avoid mixing `async` and `defer` in ways that might cause Sentry to load late.
*   **CSP:** If you have a Content Security Policy, allow Sentry's domains:
    *   `script-src`: `https://browser.sentry-cdn.com` (for CDN), `https://js.sentry-cdn.com` (for Loader)
    *   `connect-src`: `*.sentry.io` (or your specific DSN ingest domain, e.g., `oXXXX.ingest.sentry.io`)
*   **Release Naming:** Use a consistent and meaningful `release` format (e.g., `project-name@version`, `project-name@git-commit-sha`). Ensure it matches between your build/upload process and `Sentry.init`.
*   **Sampling:** Don't send 100% of transactions (`tracesSampleRate: 1.0`) or replays (`replaysSessionSampleRate`) in high-traffic production environments unless necessary. Adjust sampling rates to manage volume and cost. Use `tracesSampler` for fine-grained control.
*   **PII:** Be mindful of Personally Identifiable Information. Use `beforeSend`, `beforeSendSpan`, replay masking/blocking options, and configure server-side scrubbing in Sentry settings if needed. Avoid `sendDefaultPii: true` unless you have explicitly assessed the privacy implications.
*   **Loader Script API Guarding:** When using the Loader script, core APIs like `captureException` are available immediately. For other APIs, use `Sentry.onLoad()` to ensure the full SDK is loaded:
    ```javascript
    window.Sentry && Sentry.onLoad(function() {
      // Safe to use any Sentry API here
      const client = Sentry.getClient();
      if (client) {
        // ...
      }
    });
    ```

## 8. CDN Bundle Reference

*(From [[Loader Script Guide]])*

Sentry's CDN (`https://browser.sentry-cdn.com/[VERSION]/`) hosts various bundles. Common ones include:

*   `bundle.min.js`: Error monitoring only.
*   `bundle.tracing.min.js`: Error monitoring + Tracing.
*   `bundle.replay.min.js`: Error monitoring + Session Replay.
*   `bundle.tracing.replay.min.js`: Error monitoring + Tracing + Session Replay.

Modifiers:
*   `.es5`: Use ES5 version (default is ES6 since v7).
*   `.debug.min`: Minified bundle *with* debug logging included.
*   (no `.min`): Unminified bundle with debug logging.

Integrity hashes for specific versions can be found in the [Sentry Release Registry](https://github.com/getsentry/sentry-release-registry/tree/master/packages/npm/@sentry/browser).

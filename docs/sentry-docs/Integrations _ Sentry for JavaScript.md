---
title: "Integrations | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/"
desc: "Learn more about how integrations extend the functionality of our SDK to cover common libraries and environments automatically."
readingTime: "3~5min"
---


# Integrations | Sentry for JavaScript

> Learn more about how integrations extend the functionality of our SDK to cover common libraries and environments automatically.

The Sentry SDK uses integrations to hook into the functionality of popular libraries to automatically instrument your application and give you the best data out of the box.

Integrations automatically add error instrumentation, performance instrumentation, and/or extra context information to your application. Some are enabled by default, but you can disable them or modify their settings.

###

||**Auto Enabled**|**Errors**|**Tracing**|**Replay**|**Additional Context**|
|---|---|---|---|---|---|
|[breadcrumbsIntegration](app://obsidian.md/breadcrumbs)|✓||||✓|
|[browserApiErrorsIntegration](app://obsidian.md/browserapierrors)|✓|✓||||
|[browserSessionIntegration](app://obsidian.md/browsersession)|✓||||✓|
|[dedupeIntegration](app://obsidian.md/dedupe)|✓|✓||||
|[functionToStringIntegration](app://obsidian.md/functiontostring)|✓|||||
|[globalHandlersIntegration](app://obsidian.md/globalhandlers)|✓|✓||||
|[httpContextIntegration](app://obsidian.md/httpcontext)|✓||||✓|
|[inboundFiltersIntegration](app://obsidian.md/inboundfilters)|✓|✓||||
|[linkedErrorsIntegration](app://obsidian.md/linkederrors)|✓|✓||||
|[browserProfilingIntegration](app://obsidian.md/browserprofiling)|||✓|||
|[browserTracingIntegration](app://obsidian.md/browsertracing)|||✓||✓|
|[captureConsoleIntegration](app://obsidian.md/captureconsole)||✓|||✓|
|[contextLinesIntegration](app://obsidian.md/contextlines)||✓||||
|[extraErrorDataIntegration](app://obsidian.md/extraerrordata)|||||✓|
|[featureFlagsIntegration](app://obsidian.md/featureflags)|||||✓|
|[httpClientIntegration](app://obsidian.md/httpclient)||✓||||
|[launchDarklyIntegration](app://obsidian.md/launchdarkly)|||||✓|
|[moduleMetadataIntegration](app://obsidian.md/modulemetadata)|||||✓|
|[openFeatureIntegration](app://obsidian.md/openfeature)|||||✓|
|[replayCanvasIntegration](app://obsidian.md/replaycanvas)||||✓||
|[replayIntegration](app://obsidian.md/replay)||||✓|✓|
|[reportingObserverIntegration](app://obsidian.md/reportingobserver)||✓||||
|[rewriteFramesIntegration](app://obsidian.md/rewriteframes)||✓||||
|[statsigIntegration](app://obsidian.md/statsig)|||||✓|
|[unleashIntegration](app://obsidian.md/unleash)|||||✓|

##

To disable system integrations, set`defaultIntegrations: false`when calling`init()`.

To override their settings, provide a new instance with your config to the`integrations`option. For example, to turn off browser capturing console calls:

Copied

```
`Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",

integrations: [
Sentry.linkedErrorsIntegration({
limit: 7,
}),
],
});`
```

##

You can add additional integrations in your`init`call:

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
integrations: [Sentry.reportingObserverIntegration()],
});`
```

Alternatively, you can add integrations via`Sentry.addIntegration()`. This is useful if you only want to enable an integration in a specific environment or if you want to load an integration later. For all other cases, we recommend you use the`integrations`option.

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
integrations: [],
});

Sentry.addIntegration(Sentry.reportingObserverIntegration());`
```

##

Lazy-loading lets you add pluggable integrations without increasing the initial bundle size. You can do this in two ways:

###

You can add the integration with a dynamic import using`import()`. This method loads the integration from the npm package. To avoid running into issues with`import()`, you should use a bundler that supports dynamic imports. If you're using a tool like Vite for your project, the bundling process is probably already set up.

Copied

```
`Sentry.init({
// Note, Replay is NOT instantiated below:
integrations: [],
});

// Sometime later
import("@sentry/browser").then((lazyLoadedSentry) => {
Sentry.addIntegration(lazyLoadedSentry.replayIntegration());
});`
```

###

You can also lazy-load pluggable integrations via`Sentry.lazyLoadIntegration()`. This will attempt to load the integration from the Sentry CDN. Note that this function will reject if it fails to load the integration from the Sentry CDN, which can happen if a user has an ad-blocker or if there's a network problem. You should always make sure that rejections are handled for this function in your application.

Copied

```
`async function loadHttpClient() {
const httpClientIntegration = await Sentry.lazyLoadIntegration(
"httpClientIntegration",
);
Sentry.addIntegration(httpClientIntegration());
}`
```

Lazy loading is available for the following integrations:

- `replayIntegration`
- `replayCanvasIntegration`
- `feedbackIntegration`
- `feedbackModalIntegration`
- `feedbackScreenshotIntegration`
- `captureConsoleIntegration`
- `contextLinesIntegration`
- `linkedErrorsIntegration`
- `dedupeIntegration`
- `extraErrorDataIntegration`
- `httpClientIntegration`
- `reportingObserverIntegration`
- `rewriteFramesIntegration`
- `browserProfilingIntegration`

##

If you only want to remove a single or some of the default integrations, instead of disabling all of them with`defaultIntegrations: false`, you can use the following syntax to filter out the ones you don't want.

This example removes the integration for adding breadcrumbs to the event, which is enabled by default:

Copied

```
`Sentry.init({
// ...
integrations: function (integrations) {
// integrations will be all default integrations
return integrations.filter(function (integration) {
return integration.name !== "Breadcrumbs";
});
},
});`
```

##

You can also create [custom integrations](app://obsidian.md/custom).

##

- #### [Breadcrumbs](app://obsidian.md/platforms/javascript/configuration/integrations/breadcrumbs/)

Wraps native browser APIs to capture breadcrumbs. (default)
- #### [BrowserApiErrors](app://obsidian.md/platforms/javascript/configuration/integrations/browserapierrors/)

Wraps native time and events APIs (`setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener/removeEventListener`) in `try/catch` blocks to handle async exceptions. (default)
- #### [BrowserProfiling](app://obsidian.md/platforms/javascript/configuration/integrations/browserprofiling/)

Capture profiling data for the Browser.
- #### [BrowserSession](app://obsidian.md/platforms/javascript/configuration/integrations/browsersession/)

Track healthy Sessions in the Browser.
- #### [BrowserTracing](app://obsidian.md/platforms/javascript/configuration/integrations/browsertracing/)

Capture performance data for the Browser.
- #### [CaptureConsole](app://obsidian.md/platforms/javascript/configuration/integrations/captureconsole/)

Captures all Console API calls via `captureException` or `captureMessage`.
- #### [ContextLines](app://obsidian.md/platforms/javascript/configuration/integrations/contextlines/)

Adds source code from inline JavaScript of the current page's HTML.
- #### [Dedupe](app://obsidian.md/platforms/javascript/configuration/integrations/dedupe/)

Deduplicate certain events to avoid receiving duplicate errors. (default)
- #### [ExtraErrorData](app://obsidian.md/platforms/javascript/configuration/integrations/extraerrordata/)

Extracts all non-native attributes from the error object and attaches them to the event as extra data.
- #### [FunctionToString](app://obsidian.md/platforms/javascript/configuration/integrations/functiontostring/)

Allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers. (default)
- #### [Generic Feature Flags Integration](app://obsidian.md/platforms/javascript/configuration/integrations/featureflags/)

Learn how to attach custom feature flag data to Sentry error events.
- #### [GlobalHandlers](app://obsidian.md/platforms/javascript/configuration/integrations/globalhandlers/)

Attaches global handlers to capture uncaught exceptions and unhandled rejections. (default)
- #### [HttpClient](app://obsidian.md/platforms/javascript/configuration/integrations/httpclient/)

Captures errors on failed requests from Fetch and XHR and attaches request and response information.
- #### [HttpContext](app://obsidian.md/platforms/javascript/configuration/integrations/httpcontext/)

Attaches HTTP request information, such as URL, user-agent, referrer, and other headers to the event. (default)
- #### [InboundFilters](app://obsidian.md/platforms/javascript/configuration/integrations/inboundfilters/)

Allows you to ignore specific errors based on the type, message, or URLs in a given exception. (default)
- #### [LaunchDarkly](app://obsidian.md/platforms/javascript/configuration/integrations/launchdarkly/)

Learn how to use Sentry with LaunchDarkly.
- #### [LinkedErrors](app://obsidian.md/platforms/javascript/configuration/integrations/linkederrors/)

Allows you to configure linked errors. (default)
- #### [ModuleMetadata](app://obsidian.md/platforms/javascript/configuration/integrations/modulemetadata/)

Adds module metadata to stack frames.
- #### [OpenFeature](app://obsidian.md/platforms/javascript/configuration/integrations/openfeature/)

Learn how to use Sentry with OpenFeature.
- #### [Replay](app://obsidian.md/platforms/javascript/configuration/integrations/replay/)

Capture a video-like reproduction of what was happening in the user's browser.
- #### [ReplayCanvas](app://obsidian.md/platforms/javascript/configuration/integrations/replaycanvas/)

Capture session replays from HTML canvas elements.
- #### [ReportingObserver](app://obsidian.md/platforms/javascript/configuration/integrations/reportingobserver/)

Captures the reports collected via the `ReportingObserver` interface and sends them to Sentry.
- #### [RewriteFrames](app://obsidian.md/platforms/javascript/configuration/integrations/rewriteframes/)

Allows you to apply a transformation to each frame of the stack trace.
- #### [Statsig](app://obsidian.md/platforms/javascript/configuration/integrations/statsig/)

Learn how to use Sentry with Statsig.
- #### [Unleash](app://obsidian.md/platforms/javascript/configuration/integrations/unleash/)

Learn how to use Sentry with Unleash.

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

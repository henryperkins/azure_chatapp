---
title: "CaptureConsole | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/captureconsole/"
desc: "Captures all Console API calls via `captureException` or `captureMessage`."
readingTime: "0~1min"
---


# CaptureConsole | Sentry for JavaScript

> Captures all Console API calls via `captureException` or `captureMessage`.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [CaptureConsole](app://obsidian.md/platforms/javascript/configuration/integrations/captureconsole/)

## Captures all Console API calls via `captureException` or `captureMessage`.

*Import name:`Sentry.captureConsoleIntegration`*

This integration captures all Console API calls and redirects them to Sentry using the SDK's captureMessage or captureException call, depending on the log level. It then re-triggers to preserve default native behavior:

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
integrations: [Sentry.captureConsoleIntegration()],
});`
```

##

###

*Type:`string[]`*

Array of methods that should be captured. Defaults to`['log', 'info', 'warn', 'error', 'debug', 'assert']`

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

---
title: "ContextLines | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/contextlines/"
desc: "Adds source code from inline JavaScript of the current page's HTML."
readingTime: "0~1min"
---


# ContextLines | Sentry for JavaScript

> Adds source code from inline JavaScript of the current page's HTML.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [ContextLines](app://obsidian.md/platforms/javascript/configuration/integrations/contextlines/)

## Adds source code from inline JavaScript of the current page's HTML.

*Import name:`Sentry.contextLinesIntegration`*

This integration adds source code from inline JavaScript of the current page's HTML (e.g. JS in`<script>`tags) to stack traces of captured errors. It*can't*collect source code from assets referenced by your HTML (e.g.`<script src="..." />`).

The`ContextLines`integration is useful when you have inline JS code in HTML pages that can't be accessed by Sentry's backend, for example, due to a login-protected page.

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
integrations: [Sentry.contextLinesIntegration()],
});`
```

##

###

*Type:`number`*

The number of lines to collect around each stack frame's line number. Defaults to 7.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

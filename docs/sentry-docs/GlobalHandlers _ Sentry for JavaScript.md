---
title: "GlobalHandlers | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/globalhandlers/"
desc: "Attaches global handlers to capture uncaught exceptions and unhandled rejections. (default)"
readingTime: "0~1min"
---


# GlobalHandlers | Sentry for JavaScript

> Attaches global handlers to capture uncaught exceptions and unhandled rejections. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [GlobalHandlers](app://obsidian.md/platforms/javascript/configuration/integrations/globalhandlers/)

## Attaches global handlers to capture uncaught exceptions and unhandled rejections. (default)

*Import name:`Sentry.globalHandlersIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

This integration attaches global handlers to capture uncaught exceptions and unhandled rejections. It captures errors and unhandled promise rejections by default.

Copied

```
`Sentry.init({
integrations: [Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true })],
});`
```

##

###

*Type:`boolean`*

Capture errors bubbled to`onerror`.

###

*Type:`boolean`*

Capture unhandled promise rejections.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

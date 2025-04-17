---
title: "FunctionToString | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/functiontostring/"
desc: "Allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers. (default)"
readingTime: "0~1min"
---


# FunctionToString | Sentry for JavaScript

> Allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [FunctionToString](app://obsidian.md/platforms/javascript/configuration/integrations/functiontostring/)

## Allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers. (default)

*Import name:`Sentry.functionToStringIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

This integration allows the SDK to provide original functions and method names, even when those functions or methods are wrapped by our error or breadcrumb handlers.

Copied

```
`Sentry.init({
integrations: [Sentry.functionToStringIntegration()],
});`
```

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

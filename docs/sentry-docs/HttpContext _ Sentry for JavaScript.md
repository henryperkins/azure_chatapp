---
title: "HttpContext | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/httpcontext/"
desc: "Attaches HTTP request information, such as URL, user-agent, referrer, and other headers to the event. (default)"
readingTime: "0~1min"
---


# HttpContext | Sentry for JavaScript

> Attaches HTTP request information, such as URL, user-agent, referrer, and other headers to the event. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [HttpContext](app://obsidian.md/platforms/javascript/configuration/integrations/httpcontext/)

## Attaches HTTP request information, such as URL, user-agent, referrer, and other headers to the event. (default)

*Import name:`Sentry.httpContextIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

This integration attaches HTTP request information, such as URL, user-agent, referrer, and other headers, to the event. It allows us to correctly catalog and tag events with specific OS, browser, and version information.

Copied

```
`Sentry.init({
integrations: [Sentry.httpContextIntegration()],
});`
```

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

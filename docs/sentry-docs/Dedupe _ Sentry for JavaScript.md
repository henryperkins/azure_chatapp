---
title: "Dedupe | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/dedupe/"
desc: "Deduplicate certain events to avoid receiving duplicate errors. (default)"
readingTime: "0~1min"
---


# Dedupe | Sentry for JavaScript

> Deduplicate certain events to avoid receiving duplicate errors. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [Dedupe](app://obsidian.md/platforms/javascript/configuration/integrations/dedupe/)

## Deduplicate certain events to avoid receiving duplicate errors. (default)

*Import name:`Sentry.dedupeIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

This integration deduplicates certain events. It can be helpful if you're receiving many duplicate errors. Note, that Sentry only compares stack traces and fingerprints.

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
integrations: [Sentry.dedupeIntegration()],
});`
```

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

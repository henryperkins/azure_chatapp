---
title: "Replay | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/replay/"
desc: "Capture a video-like reproduction of what was happening in the user's browser."
readingTime: "0~1min"
---


# Replay | Sentry for JavaScript

> Capture a video-like reproduction of what was happening in the user's browser.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [Replay](app://obsidian.md/platforms/javascript/configuration/integrations/replay/)

## Capture a video-like reproduction of what was happening in the user's browser.

*Import name:`Sentry.replayIntegration`*

[Session Replay](app://obsidian.md/product/explore/session-replay/)helps you get to the root cause of an error or latency issue faster by providing you with a video-like reproduction of what was happening in the user's browser before, during, and after the issue. You can rewind and replay your application's DOM state and see key user interactions, like mouse clicks, scrolls, network requests, and console entries, in a single combined UI inspired by your browser's DevTools.

Read more about [setting up Session Replay](app://obsidian.md/session-replay/).

Copied

```
`Sentry.init({
integrations: [Sentry.replayIntegration()],
});`
```

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

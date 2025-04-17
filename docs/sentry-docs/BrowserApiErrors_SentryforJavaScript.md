---
title: "BrowserApiErrors | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/browserapierrors/"
desc: "Wraps native time and events APIs (`setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener/removeEventListener`) in `try/catch` blocks to handle async exceptions. (default)"
readingTime: "1~2min"
---


# BrowserApiErrors | Sentry for JavaScript

> Wraps native time and events APIs (`setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener/removeEventListener`) in `try/catch` blocks to handle async exceptions. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [BrowserApiErrors](app://obsidian.md/platforms/javascript/configuration/integrations/browserapierrors/)

## Wraps native time and events APIs (`setTimeout`, `setInterval`, `requestAnimationFrame`, `addEventListener/removeEventListener`) in `try/catch` blocks to handle async exceptions. (default)

*Import name:`Sentry.browserApiErrorsIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

This integration wraps native time and event APIs (`setTimeout`,`setInterval`,`requestAnimationFrame`,`addEventListener/removeEventListener`) in`try/catch`blocks to handle async exceptions.

Copied

```
`Sentry.init({
integrations: [
Sentry.browserApiErrorsIntegration({
setTimeout: true,
setInterval: true,
requestAnimationFrame: true,
XMLHttpRequest: true,
eventTarget: true,
}),
],
});`
```

##

###

*Type:`boolean`*

Instrument the`setTimeout`browser built-in method.

###

*Type:`boolean`*

Instrument the`setInterval`browser built-in method.

###

*Type:`boolean`*

Instrument the`requestAnimationFrame`browser built-in method.

###

*Type:`boolean`*

Instrument the`XMLHttpRequest`browser built-in method.

###

*Type:`boolean | string[]`*

Instrument the`addEventListener`browser built-in method for a set number of default event targets. To override the default event targets, provide an array of strings with the event target names.

List of default event targets:

- `EventTarget`
- `Window`
- `Node`
- `ApplicationCache`
- `AudioTrackList`
- `BroadcastChannel`
- `ChannelMergerNode`
- `CryptoOperation`
- `EventSource`
- `FileReader`
- `HTMLUnknownElement`
- `IDBDatabase`
- `IDBRequest`
- `IDBTransaction`
- `KeyOperation`
- `MediaController`
- `MessagePort`
- `ModalWindow`
- `Notification`
- `SVGElementInstance`
- `Screen`
- `SharedWorker`
- `TextTrack`
- `TextTrackCue`
- `TextTrackList`
- `WebSocket`
- `WebSocketWorker`
- `Worker`
- `XMLHttpRequest`
- `XMLHttpRequestEventTarget`
- `XMLHttpRequestUpload`

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

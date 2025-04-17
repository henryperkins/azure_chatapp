---
title: "Breadcrumbs | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/breadcrumbs/"
desc: "Wraps native browser APIs to capture breadcrumbs. (default)"
readingTime: "0~2min"
---


# Breadcrumbs | Sentry for JavaScript

> Wraps native browser APIs to capture breadcrumbs. (default)

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [Breadcrumbs](app://obsidian.md/platforms/javascript/configuration/integrations/breadcrumbs/)

## Wraps native browser APIs to capture breadcrumbs. (default)

*Import name:`Sentry.breadcrumbsIntegration`*

This integration is enabled by default. If you'd like to modify your default integrations, read [this](app://obsidian.md/#modifying-default-integrations).

The`breadcrumbsIntegration`wraps native APIs to capture breadcrumbs.

By default, the Sentry SDK wraps the`console`,`dom`,`fetch`,`history`, and`xhr`browser APIs to add breadcrumbs. You can opt out of capturing breadcrumbs for specific parts of your application (for example, you could say don't capture`console.log`calls as breadcrumbs) via the options below.

Copied

```
`Sentry.init({
integrations: [
Sentry.breadcrumbsIntegration({
console: true,
dom: true,
fetch: true,
history: true,
xhr: true,
}),
],
});`
```

##

###

*Type:`boolean`*

Log calls to`console.log`,`console.debug`, and so on.

###

*Type:`boolean`|`{ serializeAttribute: string | string[] }`*

Log all click and keypress events.

When an object with a`serializeAttribute`key is provided, the Breadcrumbs integration will look for given attribute(s) in DOM elements while generating the breadcrumb trails. Matched elements will be followed by their custom attributes, instead of their`id`s or`class`names.

###

*Type:`boolean`*

Log HTTP requests done with the Fetch API.

###

*Type:`boolean`*

Log calls to`history.pushState`and related APIs.

###

*Type:`boolean`*

Log whenever we send an event to the server.

###

*Type:`boolean`*

Log HTTP requests done with the XHR API.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

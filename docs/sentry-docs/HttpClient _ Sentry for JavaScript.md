---
title: "HttpClient | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/httpclient/"
desc: "Captures errors on failed requests from Fetch and XHR and attaches request and response information."
readingTime: "0~2min"
---


# HttpClient | Sentry for JavaScript

> Captures errors on failed requests from Fetch and XHR and attaches request and response information.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Configuration](app://obsidian.md/platforms/javascript/configuration/)
- [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)
- [HttpClient](app://obsidian.md/platforms/javascript/configuration/integrations/httpclient/)

## Captures errors on failed requests from Fetch and XHR and attaches request and response information.

*Import name:`Sentry.httpClientIntegration`*

This integration captures errors on failed requests from Fetch and XHR and attaches request and response information.

By default, error events don't contain header or cookie data. You can change this behavior by setting`sendDefaultPii: true`in your root`Sentry.init({})`config.

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
integrations: [Sentry.httpClientIntegration()]

// This option is required for capturing headers and cookies.
sendDefaultPii: true,
});`
```

##

###

*Type:`(number|[number, number])[]`*

This array can contain tuples of`[begin, end]`(both inclusive), single status codes, or a combination of the two. Default:`[[500, 599]]`

###

*Type:`(string|RegExp)[]`*

An array of request targets that should be considered, for example`['http://example.com/api/test']`would interpret any request to this URL as a failure. This array can contain Regexes, strings, or a combination of the two. Default:`[/.*/]`

###

*Type:`boolean`*

This option is required for capturing headers and cookies.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

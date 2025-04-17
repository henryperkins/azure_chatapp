---
title: "APIs | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/apis/"
desc: "Learn more about APIs of the SDK."
readingTime: "12~16min"
---


# APIs | Sentry for JavaScript

> Learn more about APIs of the SDK.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [APIs](app://obsidian.md/platforms/javascript/apis/)

## Learn more about APIs of the SDK.

This page shows all available top-level APIs of the SDK. You can use these APIs as the primary way to:

- Configure the SDK after initialization
- Manually capture different types of events
- Enrich events with additional data
- ... and more!

These APIs are functions that you can use as follows - they are all available on the top-level`Sentry`object:

Copied

```
`import * as Sentry from "@sentry/browser";

Sentry.setTag("tag", "value");`
```

##

##

### [init](https://docs.sentry.io/platforms/javascript/apis/#init)

```
functioninit(options:InitOptions):Client|undefined
```

Initialize the SDK with the given options. See [Options](app://obsidian.md/platforms/javascript/configuration/options/) for the options you can pass to`init`.

### [getClient](https://docs.sentry.io/platforms/javascript/apis/#getClient)

```
functiongetClient():Client|undefined
```

Returns the currently active client.

### [setCurrentClient](https://docs.sentry.io/platforms/javascript/apis/#setCurrentClient)

```
functionsetCurrentClient(client:Client):void
```

Make the given client the current client. You do not need this if you use`init()`, this is only necessary if you are manually setting up a client.

### [lastEventId](https://docs.sentry.io/platforms/javascript/apis/#lastEventId)

```
functionlastEventId():string|undefined
```

Returns the ID of the last sent error event. Note that this does not guarantee that this event ID exists, as it may have been dropped along the way.

### [flush](https://docs.sentry.io/platforms/javascript/apis/#flush)

```
functionflush(timeout?:number):Promise<boolean>
```

Parameters

timeout

```
`number`
```

Maximum time in ms the client should wait to flush its event queue. Omitting this parameter will cause the client to wait until all events are sent before resolving the promise.

Flushes all pending events.

### [isEnabled](https://docs.sentry.io/platforms/javascript/apis/#isEnabled)

```
functionisEnabled():boolean
```

Returns true if the SDK is initialized & enabled.

### [close](https://docs.sentry.io/platforms/javascript/apis/#close)

```
functionclose(timeout?:number):Promise<boolean>
```

Parameters

timeout

```
`number`
```

Maximum time in ms the client should wait to flush its event queue. Omitting this parameter will cause the client to wait until all events are sent before resolving the promise.

Flushes all pending events and disables the SDK. Note that this does not remove any listeners the SDK may have set up. After a call to`close`, the current client cannot be used anymore. It's important to only call`close`immediately before shutting down the application.

Alternatively, theflushmethod drains the event queue while keeping the client enabled for continued use.

### [addEventProcessor](https://docs.sentry.io/platforms/javascript/apis/#addEventProcessor)

```
functionaddEventProcessor(processor:EventProcessor):void
```

Parameters

processor

```
`(event: Event, hint: EventHint) => Event | null | Promise<Event | null>`
```

Adds an event processor to the SDK. An event processor receives every event before it is sent to Sentry. It can either mutate the event (and return it) or return`null`to discard the event. Event processors can also return a promise, but it is recommended to use this only when necessary as it slows down event processing.

Event processors added via`Sentry.addEventProcessor()`will be applied to all events in your application. If you want to add an event processor that only applies to certain events, you can also add one to a scope as follows:

Copied

```
`Sentry.withScope((scope) => {
scope.addEventProcessor((event) => {
// this will only be applied to events captured within this scope
return event;
});

Sentry.captureException(new Error("test"));
});`
```

What is the difference to `beforeSend` / `beforeSendTransaction`?

`beforeSend`and`beforeSendTransaction`are guaranteed to be run last, after all other event processors, (which means they get the final version of the event right before it's sent, hence the name). Event processors added with`addEventProcessor`are run in an undetermined order, which means changes to the event may still be made after the event processor runs.

There can only be a single`beforeSend`/`beforeSendTransaction`processor, but you can add multiple event processors via`addEventProcessor()`.

### [addIntegration](https://docs.sentry.io/platforms/javascript/apis/#addIntegration)

```
functionaddIntegration(integration:Integration):void
```

Adds an integration to the SDK. This can be used to conditionally add integrations after`Sentry.init()`has been called. Note that it is recommended to pass integrations to`init`instead of calling this method, where possible.

See [Integrations](app://obsidian.md/platforms/javascript/configuration/integrations/)for more information on how to use integrations.

### [lazyLoadIntegration](https://docs.sentry.io/platforms/javascript/apis/#lazyLoadIntegration)

```
functionlazyLoadIntegration(name:string,scriptNonce?:string):Promise<Integration>
```

Lazy load an integration. This expects the name to be e.g.`replayIntegration`. It will load the script from the CDN, and return a promise that resolves to the integration, which can then be added to the SDK using`addIntegration`:

Copied

```
`Sentry.lazyLoadIntegration("replayIntegration")
.then((integration) => {
Sentry.addIntegration(integration);
})
.catch((error) => {
// Make sure to handle errors here!
// This rejects e.g. if the CDN bundle cannot be loaded
});`
```

If you use a bundler, using e.g.`const { replayIntegration } = await import('@sentry/browser')`is recommended instead.

SeeIntegrationsfor more information on how to use integrations.

##

### [captureException](https://docs.sentry.io/platforms/javascript/apis/#captureException)

```
functioncaptureException(exception:unknown,captureContext?:CaptureContext):EventId
```

Parameters

exception*

```
`unknown`
```

The exception to capture. For best results, pass an `Error` object but it accepts any kind of value.

captureContext

```
`CaptureContext {`

`user?: User {`

`id?:``string | number,`

`email?:``string,`

`ip_address?:``string,`

`username?:``string,`

}

`level?:``"fatal" | "error" | "warning" | "log" | "info" | "debug",`

`// Additional data that should be sent with the exception.`

`extra?:``Record<string, unknown>,`

`// Additional tags that should be sent with the exception.`

`tags?:``Record<string, string>,`

`contexts?:``Record<string, Record<string, unknown>>,`

`fingerprint?:``string[],`

}
```

Optional additional data to attach to the Sentry event.

Capture an exception event and send it to Sentry. Note that you can pass not only`Error`objects, but also other objects as`exception`- in that case, the SDK will attempt to serialize the object for you, and the stack trace will be generated by the SDK and may be less accurate.

### [captureMessage](https://docs.sentry.io/platforms/javascript/apis/#captureMessage)

```
functioncaptureMessage(message:string,captureContext?:CaptureContext|SeverityLevel):EventId
```

Parameters

message*

```
`string`
```

The message to capture.

captureContext

```
`CaptureContext {`

`user?: User {`

`id?:``string | number,`

`email?:``string,`

`ip_address?:``string,`

`username?:``string,`

}

`level?:``"fatal" | "error" | "warning" | "log" | "info" | "debug",`

`// Additional data that should be sent with the exception.`

`extra?:``Record<string, unknown>,`

`// Additional tags that should be sent with the exception.`

`tags?:``Record<string, string>,`

`contexts?:``Record<string, Record<string, unknown>>,`

`fingerprint?:``string[],`

}
```

Optional additional data to attach to the Sentry event.

Capture a message event and send it to Sentry. Optionally, instead of a`CaptureContext`, you can also pass a`SeverityLevel`as second argument, e.g.`"error"`or`"warning"`.

Messages show up as issues on your issue stream, with the message as the issue name.

##

### [setTag](https://docs.sentry.io/platforms/javascript/apis/#setTag)

```
functionsetTag(key:string,value:string):void
```

Set a tag to be sent with Sentry events.

### [setTags](https://docs.sentry.io/platforms/javascript/apis/#setTags)

```
functionsetTags(tags:Record<string,string>):void
```

Set multiple tags to be sent with Sentry events.

### [setContext](https://docs.sentry.io/platforms/javascript/apis/#setContext)

```
functionsetContext(name:string,context:Record<string,unknown>):void
```

Set a context to be sent with Sentry events. Custom contexts allow you to attach arbitrary data to an event. You cannot search these, but they are viewable on the issue page - if you need to be able to filter for certain data, use [tags](app://obsidian.md/#setTag)instead.

There are no restrictions on context name. In the context object, all keys are allowed except for`type`, which is used internally.

By default, Sentry SDKs normalize nested structured context data up to three levels deep. Any data beyond this depth will be trimmed and marked using its type instead. To adjust this default, use the [normalizeDepth](app://obsidian.md/platforms/javascript/configuration/options/#normalize-depth)SDK option.

Learn more about conventions for common contexts in the [contexts interface developer documentation](https://develop.sentry.dev/sdk/data-model/event-payloads/contexts/).

Example

Context data is structured and can contain any data you want:

Copied

```
`Sentry.setContext("character", {
name: "Mighty Fighter",
age: 19,
attack_type: "melee",
});`
```

```
functionsetExtra(name:string,extra:unknown):void
```

Set additional data to be sent with Sentry events.

```
functionsetExtras(extras:Record<string,unknown>):void
```

Set multiple additional data entries to be sent with Sentry events.

### [setUser](https://docs.sentry.io/platforms/javascript/apis/#setUser)

```
functionsetUser(user:User|null):void
```

Parameters

user

```
`User {`

`// Your internal identifier for the user`

`id?:``string | number,`

`// Sentry is aware of email addresses and can display things such as Gravatars and unlock messaging capabilities`

`email?:``string,`

`// Typically used as a better label than the internal id`

`username?:``string,`

`// The user's IP address. If the user is unauthenticated, Sentry uses the IP address as a unique identifier for the user`

`ip_address?:``string,`

}
```

Set a user to be sent with Sentry events. Set to`null`to unset the user. In addition to the specified properties of the`User`object, you can also add additional arbitrary key/value pairs.

Capturing User IP-Addresses

On the browser, if the users'`ip_address`is set to`"{{ auto }}"`, Sentry will infer the IP address from the connection between your app and Sentrys' server.`{{auto}}`is automatically set if you have configured`sendDefaultPii: true`in your [SDK configuration](app://obsidian.md/platforms/javascript/configuration/options/#sendDefaultPii).

To ensure your users' IP addresses are never stored in your event data, you can go to your project settings, click on "Security & Privacy", and enable "Prevent Storing of IP Addresses" or use Sentry's [server-side data scrubbing](app://obsidian.md/security-legal-pii/scrubbing/) to remove`$user.ip_address`. Adding such a rule ultimately overrules any other logic.

### [addBreadcrumb](https://docs.sentry.io/platforms/javascript/apis/#addBreadcrumb)

```
functionaddBreadcrumb(breadcrumb:Breadcrumb,hint?:Hint):void
```

Parameters

breadcrumb*

```
`Breadcrumb {`

`// If a message is provided, it is rendered as text with all whitespace preserved.`

`message?:``string,`

`// The type influences how a breadcrumb is rendered in Sentry. When in doubt, leave it at `default`.`

`type?:``"default" | "debug" | "error" | "info" | "navigation" | "http" | "query" | "ui" | "user",`

`// The level is used in the UI to emphasize or deemphasize the breadcrumb.`

`level?:``"fatal" | "error" | "warning" | "log" | "info" | "debug",`

`// Typically it is a module name or a descriptive string. For instance, `ui.click` could be used to indicate that a click happened`

`category?:``string,`

`// Additional data that should be sent with the breadcrumb.`

`data?:``Record<string, unknown>,`

}
```

hint

```
`Record<string, unknown>`
```

A hint object containing additional information about the breadcrumb.

You can manually add breadcrumbs whenever something interesting happens. For example, you might manually record a breadcrumb if the user authenticates or another state change occurs.

##

### [startSpan](https://docs.sentry.io/platforms/javascript/apis/#startSpan)

```
functionstartSpan<T>(options:StartSpanOptions,callback:(span:Span)=>T):T
```

Parameters

options*

```
`StartSpanOptions {`

`name:``string,`

`// Attributes to add to the span.`

`attributes?:``Record<string, string | number | boolean | null | undefined>,`

`// The timestamp to use for the span start. If not provided, the current time will be used.`

`startTime?:``number,`

`// The operation name for the span. This is used to group spans in the UI`

`op?:``string,`

`// If true, the span will be forced to be sent as a transaction, even if it is not the root span.`

`forceTransaction?:``boolean,`

`// The parent span for the new span. If not provided, the current span will be used.`

`parentSpan?:``Span | null,`

`// If true, the span will only be created if there is an active span.`

`onlyIfParent?:``boolean,`

}
```

callback*

```
`(span: Span) => T`
```

Starts a new span, that is active in the provided callback. This span will be a child of the currently active span, if there is one.

Any spans created inside of the callback will be children of this span.

The started span will automatically be ended when the callback returns, and will thus measure the duration of the callback. The callback cann also be an async function.

Examples

Copied

```
`// Synchronous example
Sentry.startSpan({ name: "my-span" }, (span) => {
measureThis();
});

// Asynchronous example
const status = await Sentry.startSpan(
{ name: "my-span" },
async (span) => {
const status = await doSomething();
return status;
},
);`
```

See [Tracing Instrumentation](app://obsidian.md/platforms/javascript/tracing/instrumentation/)for more information on how to work with spans.

### [startInactiveSpan](https://docs.sentry.io/platforms/javascript/apis/#startInactiveSpan)

```
functionstartInactiveSpan<T>(options:StartSpanOptions):Span
```

Parameters

options*

```
`StartSpanOptions {`

`name:``string,`

`// Attributes to add to the span.`

`attributes?:``Record<string, string | number | boolean | null | undefined>,`

`// The timestamp to use for the span start. If not provided, the current time will be used.`

`startTime?:``number,`

`// The operation name for the span. This is used to group spans in the UI`

`op?:``string,`

`// If true, the span will be forced to be sent as a transaction, even if it is not the root span.`

`forceTransaction?:``boolean,`

`// The parent span for the new span. If not provided, the current span will be used.`

`parentSpan?:``Span | null,`

`// If true, the span will only be created if there is an active span.`

`onlyIfParent?:``boolean,`

}
```

Starts a new span. This span will be a child of the currently active span, if there is one. The returned span has to be ended manually via`span.end()`when the span is done.

Examples

Copied

```
`const span = Sentry.startInactiveSpan({ name: "my-span" });
doSomething();
span.end();`
```

SeeTracing Instrumentationfor more information on how to work with spans.

### [startSpanManual](https://docs.sentry.io/platforms/javascript/apis/#startSpanManual)

```
functionstartSpanManual<T>(options:StartSpanOptions,callback:(span:Span)=>T):T
```

Parameters

options*

```
`StartSpanOptions {`

`name:``string,`

`// Attributes to add to the span.`

`attributes?:``Record<string, string | number | boolean | null | undefined>,`

`// The timestamp to use for the span start. If not provided, the current time will be used.`

`startTime?:``number,`

`// The operation name for the span. This is used to group spans in the UI`

`op?:``string,`

`// If true, the span will be forced to be sent as a transaction, even if it is not the root span.`

`forceTransaction?:``boolean,`

`// The parent span for the new span. If not provided, the current span will be used.`

`parentSpan?:``Span | null,`

`// If true, the span will only be created if there is an active span.`

`onlyIfParent?:``boolean,`

}
```

callback*

```
`(span: Span) => T`
```

Starts a new span, that is active in the provided callback. This span will be a child of the currently active span, if there is one.

Any spans created inside of the callback will be children of this span.

The started span will*not*automatically end - you have to call`span.end()`when the span is done. Please note that the span will still only be the parent span of spans created inside of the callback, while the callback is active. In most cases, you will want to use`startSpan`or`startInactiveSpan`instead.

Examples

Copied

```
`const status = await Sentry.startSpanManual(
{ name: "my-span" },
async (span) => {
const status = await doSomething();
span.end();
return status;
},
);`
```

SeeTracing Instrumentationfor more information on how to work with spans.

### [continueTrace](https://docs.sentry.io/platforms/javascript/apis/#continueTrace)

```
functioncontinueTrace<T>(options:TraceOptions,callback:()=>T):T
```

Parameters

options

```
`TraceOptions {`

`// The sentry-trace header.`

`sentryTrace?:``string,`

`// The baggage header.`

`baggage?:``string,`

}
```

callback

```
`() => T`
```

The callback to continue the trace.

Continues a trace in the provided callback. Any spans created inside of the callback will be linked to the trace.

### [suppressTracing](https://docs.sentry.io/platforms/javascript/apis/#suppressTracing)

```
functionsuppressTracing<T>(callback:()=>T):T
```

Ensure that all spans created inside of the provided callback are not sent to Sentry.

### [startNewTrace](https://docs.sentry.io/platforms/javascript/apis/#startNewTrace)

```
functionstartNewTrace<T>(callback:()=>T):T
```

Start a new trace that is active in the provided callback.

### [startBrowserTracingPageLoadSpan](https://docs.sentry.io/platforms/javascript/apis/#startBrowserTracingPageLoadSpan)

```
functionstartBrowserTracingPageLoadSpan(client:Client,options:StartSpanOptions):Span|undefined
```

Start an pageload span that will be automatically ended when the page is considered idle. If a pageload/navigation span is currently ongoing, it will automatically be ended first. In most cases, you do not need to call this, as the`browserTracingIntegration`will automatically do that for you. However, if you opt-out of pageload spans, you can use this method to manually start such a span. Please note that this function will do nothing if`browserTracingIntegration`has not been enabled.

### [startBrowserTracingNavigationSpan](https://docs.sentry.io/platforms/javascript/apis/#startBrowserTracingNavigationSpan)

```
functionstartBrowserTracingNavigationSpan(client:Client,options:StartSpanOptions):Span|undefined
```

Start an navigation span that will be automatically ended when the page is considered idle. If a pageload/navigation span is currently ongoing, it will automatically be ended first. In most cases, you do not need to call this, as the`browserTracingIntegration`will automatically do that for you. However, if you opt-out of navigation spans, you can use this method to manually start such a span. Please note that this function will do nothing if`browserTracingIntegration`has not been enabled.

##

These utilities can be used for more advanced tracing use cases.

### [spanToJSON](https://docs.sentry.io/platforms/javascript/apis/#spanToJSON)

```
functionspanToJSON(span:Span):SpanJSON
```

Convert a span to a JSON object.

### [updateSpanName](https://docs.sentry.io/platforms/javascript/apis/#updateSpanName)

```
functionupdateSpanName(span:Span,name:string):void
```

Update the name of a span. Use this over`span.updateName(name)`to ensure that the span is updated in all backends.

### [getActiveSpan](https://docs.sentry.io/platforms/javascript/apis/#getActiveSpan)

```
functiongetActiveSpan():Span|undefined
```

Get the currently active span.

### [getRootSpan](https://docs.sentry.io/platforms/javascript/apis/#getRootSpan)

```
functiongetRootSpan(span:Span):Span
```

Get the root span of a span.

### [withActiveSpan](https://docs.sentry.io/platforms/javascript/apis/#withActiveSpan)

```
functionwithActiveSpan<T>(span:Span|null,callback:()=>T):T
```

Runs the provided callback with the given span as the active span. If`null`is provided, the callback will have no active span.

##

Sessions allow you to track the release health of your application. See the [Releases & Health](app://obsidian.md/platforms/javascript/configuration/releases/#sessions)page for more information.

### [startSession](https://docs.sentry.io/platforms/javascript/apis/#startSession)

```
functionstartSession():void
```

Starts a new session.

### [endSession](https://docs.sentry.io/platforms/javascript/apis/#endSession)

```
functionendSession():void
```

Ends the current session (but does not send it to Sentry).

### [captureSession](https://docs.sentry.io/platforms/javascript/apis/#captureSession)

```
functioncaptureSession(end=false):void
```

Sends the current session on the scope to Sentry. Pass`true`as argument to end the session first.

##

See [Scopes](app://obsidian.md/platforms/javascript/enriching-events/scopes/)for more information on how to use scopes, as well as for an explanation of the different types of scopes (current scope, isolation scope, and global scope).

### [withScope](https://docs.sentry.io/platforms/javascript/apis/#withScope)

```
functionwithScope(callback:(scope:Scope)=>void):void
```

Forks the current scope and calls the callback with the forked scope.

### [withIsolationScope](https://docs.sentry.io/platforms/javascript/apis/#withIsolationScope)

```
functionwithIsolationScope(callback:(scope:Scope)=>void):void
```

Forks the current isolation scope and calls the callback with the forked scope.

### [getCurrentScope](https://docs.sentry.io/platforms/javascript/apis/#getCurrentScope)

```
functiongetCurrentScope():Scope
```

Returns the [current scope](app://obsidian.md/platforms/javascript/enriching-events/scopes/#current-scope).

Note that in most cases you should not use this API, but instead use`withScope`to generate and access a local scope. There are no guarantees about the consistency of`getCurrentScope`across different parts of your application, as scope forking may happen under the hood at various points.

##

### [captureFeedback](https://docs.sentry.io/platforms/javascript/apis/#captureFeedback)

```
functioncaptureFeedback(feedback:Feedback,hint?:Hint):string
```

Parameters

feedback

```
`Feedback {`

`message:``string,`

`name?:``string,`

`email?:``string,`

`url?:``string,`

`source?:``string,`

`// The event id that this feedback is associated with.`

`associatedEventId?:``string,`

`tags?:``Record<string, string>,`

}
```

The feedback to capture.

hint

```
`Hint {`

`// Optional additional data to attach to the Sentry event.`

`captureContext?: CaptureContext {`

`user?: User {`

`id?:``string | number,`

`email?:``string,`

`ip_address?:``string,`

`username?:``string,`

}

`level?:``"fatal" | "error" | "warning" | "log" | "info" | "debug",`

`// Additional data that should be sent with the exception.`

`extra?:``Record<string, unknown>,`

`// Additional tags that should be sent with the exception.`

`tags?:``Record<string, string>,`

`contexts?:``Record<string, Record<string, unknown>>,`

`fingerprint?:``string[],`

}

}
```

Optional hint object containing additional information about the feedback.

Send user feedback to Sentry.

### [getFeedback](https://docs.sentry.io/platforms/javascript/apis/#getFeedback)

```
functiongetFeedback():ReturnType<feedbackIntegration>|undefined
```

Get the feedback integration, if it has been added. This can be used to access the feedback integration in a type-safe way.

### [sendFeedback](https://docs.sentry.io/platforms/javascript/apis/#sendFeedback)

```
functionsendFeedback(feedback:Feedback,hint?:Hint):Promise<string>
```

Parameters

feedback

```
`Feedback {`

`message:``string,`

`name?:``string,`

`email?:``string,`

`url?:``string,`

`source?:``string,`

`// The event id that this feedback is associated with.`

`associatedEventId?:``string,`

`tags?:``Record<string, string>,`

}
```

The feedback to capture.

hint

```
`Hint {`

`// Optional additional data to attach to the Sentry event.`

`captureContext?: CaptureContext {`

`user?: User {`

`id?:``string | number,`

`email?:``string,`

`ip_address?:``string,`

`username?:``string,`

}

`level?:``"fatal" | "error" | "warning" | "log" | "info" | "debug",`

`// Additional data that should be sent with the exception.`

`extra?:``Record<string, unknown>,`

`// Additional tags that should be sent with the exception.`

`tags?:``Record<string, string>,`

`contexts?:``Record<string, Record<string, unknown>>,`

`fingerprint?:``string[],`

}

}
```

Optional hint object containing additional information about the feedback.

This method is similar to [captureFeedback](https://docs.sentry.io/platforms/javascript/apis/#capturefeedback), but it returns a promise that resolves only when the feedback was successfully sent to Sentry. It will reject if the feedback cannot be sent.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

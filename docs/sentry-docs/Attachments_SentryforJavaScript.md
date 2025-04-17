---
title: "Attachments | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/enriching-events/attachments/"
desc: "Learn more about how Sentry can store additional files in the same request as event attachments."
readingTime: "1~3min"
---


# Attachments | Sentry for JavaScript

> Learn more about how Sentry can store additional files in the same request as event attachments.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Enriching Events](app://obsidian.md/platforms/javascript/enriching-events/)
- [Attachments](app://obsidian.md/platforms/javascript/enriching-events/attachments/)

## Learn more about how Sentry can store additional files in the same request as event attachments.

Sentry can enrich your events for further investigation by storing additional files, such as config or log files, as attachments.

##

You'll first need to import the SDK, as usual:

Copied

```
`import * as Sentry from "@sentry/browser";`
```

Attachments live on the`Scope`and will be sent with all events.

Copied

```
`// Add an attachment
Sentry.getCurrentScope().addAttachment({
filename: "attachment.txt",
data: "Some content",
});

// Clear attachments
Sentry.getCurrentScope().clearAttachments();`
```

An attachment has the following fields:

`filename`

The filename is required and will be displayed in [sentry.io](https://sentry.io/).

`data`

The content of the attachment is required and is either a`string`or`Uint8Array`.

`contentType`

The type of content stored in this attachment. Any [MIME type](https://www.iana.org/assignments/media-types/media-types.xhtml) may be used; the default is`application/octet-stream`.

`mimetype`

The specific media content type that determines how the attachment is rendered in the Sentry UI. We currently support and can render the following MIME types:

- `text/plain`
- `text/css`
- `text/csv`
- `text/html`
- `text/javascript`
- `text/json`or`text/x-json`or`application/json`or`application/ld+json`
- `image/jpeg`
- `image/png`
- `image/gif`

##

It's possible to add, remove, or modify attachments before an event is sent by way of the [beforeSend](app://obsidian.md/platforms/javascript/configuration/options/#before-send)hook or a global event processor.

Copied

```
`Sentry.init({
dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
beforeSend: (event, hint) => {
hint.attachments = [
{ filename: "screenshot.png", data: captureScreen() },
];
return event;
},
});

Sentry.addEventProcessor((event, hint) => {
hint.attachments = [{ filename: "log.txt", data: readLogFile() }];
return event;
});`
```

Attachments persist for 30 days; if your total storage included in your quota is exceeded, attachments will not be stored. You can delete attachments or their containing events at any time. Deleting an attachment does not affect your quota - Sentry counts an attachment toward your quota as soon as it is stored.

Learn more about how attachments impact your [quota](app://obsidian.md/pricing/quotas/).

###

To limit access to attachments, navigate to your organization's**General Settings**, then select the*Attachments Access*dropdown to set appropriate access — any member of your organization, the organization billing owner, member, admin, manager, or owner.

By default, access is granted to all members when storage is enabled. If a member does not have access to the project, the ability to download an attachment is not available; the button will be greyed out in Sentry. The member may only view that an attachment is stored.

##

Attachments display on the bottom of the**Issue Details**page for the event that is shown.

Alternately, attachments also appear in the*Attachments*tab on the**Issue Details**page, where you can view the*Type*of attachment, as well as associated events. Click the Event ID to open the**Issue Details**of that specific event.

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

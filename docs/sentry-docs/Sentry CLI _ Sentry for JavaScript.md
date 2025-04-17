---
title: "Sentry CLI | Sentry for JavaScript"
source: "https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/cli/"
desc: "Upload your source maps using Sentry CLI."
readingTime: "2~4min"
---


# Sentry CLI | Sentry for JavaScript

> Upload your source maps using Sentry CLI.

- [Home](app://obsidian.md/)
- [Platforms](app://obsidian.md/platforms/)
- [JavaScript](app://obsidian.md/platforms/javascript/)
- [Source Maps](app://obsidian.md/platforms/javascript/sourcemaps/)
- [Uploading Source Maps](app://obsidian.md/platforms/javascript/sourcemaps/uploading/)
- [Sentry CLI](app://obsidian.md/platforms/javascript/sourcemaps/uploading/cli/)

## Upload your source maps using Sentry CLI.

In this guide, you'll learn how to successfully upload source maps using our`sentry-cli`tool.

##

The easiest way to configure source map uploading using the Sentry CLI is with Sentry's Wizard:

Copied

```
`npx @sentry/wizard@latest -i sourcemaps`
```

The wizard will guide you through the following steps:

- Logging into Sentry and selecting a project
- Installing the necessary Sentry packages
- Configuring your build tool to generate and upload source maps
- Configuring your CI to upload source maps

If you want to configure source map uploading using the CLI, follow the steps below.

##

###

You can generate source maps using the tooling of your choice. See examples from other guides linked underUploading Source Maps.

###

Make sure`sentry-cli`is configured for your project. For that you can use environment variables:

`.env.local`

Copied

```
`SENTRY_ORG=example-org
SENTRY_PROJECT=example-project
SENTRY_AUTH_TOKEN=sntrys_YOUR_TOKEN_HERE`
```

###

Debug IDs are used to match the stack frame of an event with its corresponding minified source and source map file. Visit [What are Debug IDs](app://obsidian.md/platforms/javascript/sourcemaps/troubleshooting_js/debug-ids/)if you want to learn more about Debug IDs.

To inject Debug IDs, use the following command:

Copied

```
`sentry-cli sourcemaps inject /path/to/directory`
```

####

Minified source files should contain at the end a comment named`debugId`like:

`example_minified_file.js`

Copied

```
`...
//# debugId=<debug_id>
//# sourceMappingURL=<sourcemap_url>`
```

Source maps should contain a field named`debug_id`like:

`example_source_map.js.map`

Copied

```
`{
...
"debug_id":"<debug_id>",
...
}`
```

###

After you've injected Debug IDs into your artifacts, upload them using the following command.

Copied

```
`sentry-cli sourcemaps upload /path/to/directory`
```

####

Open up Sentry and navigate to**Project Settings > Source Maps**. If you choose “Artifact Bundles” in the tabbed navigation, you'll see all the artifact bundles that have been successfully uploaded to Sentry.

###

If you're following this guide from your local machine, then you've successfully:

1. Generated minified source and source map files (artifacts) by running your application's build process
2. Injected Debug IDs into the artifacts you've just generated
3. Uploaded those artifacts to Sentry with our upload command

The last step is deploying a new version of your application using the generated artifacts you created in step one.**We strongly recommend that you integrate`sentry-cli`into your CI/CD Pipeline**, to ensure each subsequent deploy will automatically inject debug IDs into each artifact and upload them directly to Sentry.

###

####

Provide a`release`property in your SDK options.

Copied

```
`Sentry.init({
// This value must be identical to the release name specified during upload
// with the `sentry-cli`.
release: "<release_name>",
});`
```

Afterwards, run the`sourcemaps upload`command with the additional`--release`option. Please ensure that the value specified for`<release_name>`is the same value specified in your SDK options.

Copied

```
`sentry-cli sourcemaps upload --release=<release_name> /path/to/directory`
```

####

In addition to`release`, you can also add a`dist`to your uploaded artifacts, to set the distribution identifier for uploaded files. To do so, run the`sourcemaps upload`command with the additional`--dist`option.

Provide`release`and`dist`properties in your SDK options.

Copied

```
`Sentry.init({
// These values must be identical to the release and dist names specified during upload
// with the `sentry-cli`.
release: "<release_name>",
dist: "<dist_name>",
});`
```

The distribution identifier is used to distinguish between multiple files of the same name within a single release.`dist`can be used to disambiguate build or deployment variants.

Copied

```
`sentry-cli sourcemaps upload --release=<release_name> --dist=<dist_name> /path/to/directory`
```

Was this helpful?

**Help improve this content**
Our documentation is open source and available on GitHub. Your contributions are welcome, whether fixing a typo (drat!) or suggesting an update ("yeah, this would be better").

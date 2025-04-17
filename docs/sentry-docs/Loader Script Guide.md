The Loader Script is the easiest way to initialize the Sentry SDK. The Loader Script also automatically keeps your Sentry SDK up to date and offers configuration for different Sentry features.

To use the loader, go in the Sentry UI to **Settings > Projects > (select project) > Client Keys (DSN)**, and then press the "Configure" button. Copy the script tag from the "JavaScript Loader" section and include it as the first script on your page. By including it first, you allow it to catch and buffer events from any subsequent scripts, while still ensuring the full SDK doesn't load until after everything else has run.

Copied

```
<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
></script>
```

By default, Tracing and Session Replay are enabled.

To have correct stack traces for minified asset files when using the Loader Script, you will have to either [host your Source Maps publicly](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/hosting-publicly/) or [upload them to Sentry](https://docs.sentry.io/platforms/javascript/sourcemaps/).

The loader has a few configuration options:

- What version of the SDK to load
- Using Tracing
- Using Session Replay
- Showing debug logs

To configure the version, use the dropdown in the "JavaScript Loader" settings, directly beneath the script tag you copied earlier.

[![JavaScript Loader Settings](https://docs.sentry.io/_next/image/?url=%2Fmdx-images%2Fjs-loader-settings-ZNXIUMHF.png%232346x828&w=3840&q=75)](https://docs.sentry.io/mdx-images/js-loader-settings-ZNXIUMHF.png)

Note that because of caching, it can take a few minutes for version changes made here to take effect.

If you only use the Loader for errors, the loader won't load the full SDK until triggered by one of the following:

- an unhandled error
- an unhandled promise rejection
- a call to `Sentry.captureException`
- a call to `Sentry.captureMessage`
- a call to `Sentry.captureEvent`

Once one of those occurs, the loader will buffer that event and immediately request the full SDK from our CDN. Any events that occur between that request being made and the completion of SDK initialization will also be buffered, and all buffered events will be sent to Sentry once the SDK is fully initialized.

Alternatively, you can set the loader to request the full SDK earlier: still as part of page load, but _after_ all of the other JavaScript on the page has run. (In other words, in a subsequent event loop.) To do this, include `data-lazy="no"` in your script tag.

Copied

```
<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
  data-lazy="no"
></script>
```

Finally, if you want to control the timing yourself, you can call `Sentry.forceLoad()`. You can do this as early as immediately after the loader runs (which has the same effect as setting `data-lazy="no"`) and as late as the first unhandled error, unhandled promise rejection, or call to `Sentry.captureMessage` or `Sentry.captureEvent` (which has the same effect as not calling it at all). Note that you can't delay loading past one of the aforementioned triggering events.

If Tracing and/or Session Replay is enabled, the SDK will immediately fetch and initialize the bundle to make sure it can capture transactions and/or replays once the page loads.

While the Loader Script will work out of the box without any configuration in your application, you can still configure the SDK according to your needs.

For Tracing, the SDK will be initialized with `tracesSampleRate: 1` by default. This means that the SDK will capture all traces.

For Session Replay, the defaults are `replaysSessionSampleRate: 0.1` and `replaysOnErrorSampleRate: 1`. This means Replays will be captured for 10% of all normal sessions and for all sessions with an error.

You can configure the release by adding the following to your page:

Copied

```
<script>
  window.SENTRY_RELEASE = {
    id: "...",
  };
</script>
```

The loader script always includes a call to `Sentry.init` with a default configuration, including your DSN. If you want to [configure your SDK](https://docs.sentry.io/platforms/javascript/configuration/options/) beyond that, you can configure a custom init call by defining a `window.sentryOnLoad` function. Whatever is defined inside of this function will _always_ be called first, before any other SDK method is called.

**Be sure to define this function _before_ you add the loader script, to ensure it can be called at the right time:**

Copied

```
<script>
  // Configure sentryOnLoad before adding the Loader Script
  window.sentryOnLoad = function () {
    Sentry.init({
      // add custom config here
    });
  };
</script>

<script
  src="https://js.sentry-cdn.com/d815bc9d689a9255598e0007ae5a2f67.min.js"
  crossorigin="anonymous"
></script>
```

Inside of the `window.sentryOnLoad` function, you can configure a custom `Sentry.init()` call. You can configure your SDK exactly the way you would if you were using the CDN, with one difference: your `Sentry.init()` call doesn't need to include your DSN, since it's already been set. Inside of this function, the full Sentry SDK is guaranteed to be loaded & available.

Copied

```
<script>
  // Configure sentryOnLoad before adding the Loader Script
  window.sentryOnLoad = function () {
    Sentry.init({
      release: " ... ",
      environment: " ... "
    });
    Sentry.setTag(...);
    // etc.
  };
</script>
```

By default, the loader will make sure you can call these functions directly on `Sentry` at any time, even if the SDK is not yet loaded:

- `Sentry.captureException()`
- `Sentry.captureMessage()`
- `Sentry.captureEvent()`
- `Sentry.addBreadcrumb()`
- `Sentry.withScope()`
- `Sentry.showReportDialog()`

If you want to call any other method when using the Loader, you have to guard it with `Sentry.onLoad()`. Any callback given to `onLoad()` will be called either immediately (if the SDK is already loaded), or later once the SDK has been loaded:

Copied

```
// Guard against window.Sentry not being available, e.g. due to Ad-blockers
window.Sentry &&
  Sentry.onLoad(function () {
    // Inside of this callback,
    // we guarantee that `Sentry` is fully loaded and all APIs are available
    const client = Sentry.getClient();
    // do something custom here
  });
```

When using the Loader Script with just errors, the script injects the SDK asynchronously. This means that only _unhandled errors_ and _unhandled promise rejections_ will be caught and buffered before the SDK is fully loaded. Specifically, capturing [breadcrumb data](https://docs.sentry.io/platforms/javascript/enriching-events/breadcrumbs/) will not be available until the SDK is fully loaded and initialized. To reduce the amount of time these features are unavailable, set `data-lazy="no"` or call `forceLoad()` as described above.

If you want to understand the inner workings of the loader itself, you can read the documented source code in all its glory over at the [Sentry repository](https://github.com/getsentry/sentry/blob/master/src/sentry/templates/sentry/js-sdk-loader.ts).

Sentry supports loading the JavaScript SDK from a CDN. Generally we suggest using our Loader instead. If you _must_ use a CDN, see [Available Bundles](#available-bundles) below.

To use Sentry for error and tracing, you can use the following bundle:

Copied

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.tracing.min.js"
  integrity="sha384-nsiByevQ25GvAyX+c3T3VctX7x10qZpYsLt3dfkBt04A71M451kWQEu+K4r1Uuk3"
  crossorigin="anonymous"
></script>
```

To use Sentry for error and tracing, as well as for [Session Replay](https://docs.sentry.io/platforms/javascript/session-replay), you can use the following bundle:

Copied

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.tracing.replay.min.js"
  integrity="sha384-o/GEuWSkrvEGEtjN67ud+ssWsPJyX6RPCWqDvd8EE0N5nm6Id38XSS62lM4ETM0O"
  crossorigin="anonymous"
></script>
```

To use Sentry for error monitoring, as well as for [Session Replay](https://docs.sentry.io/platforms/javascript/session-replay), but **not for tracing**, you can use the following bundle:

Copied

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.replay.min.js"
  integrity="sha384-sJyrIOyOVMSgXus33HKLNkRL49UaLxzIlyNGPo/Frj1n5lE9RPIYt5VVvOiVCs0p"
  crossorigin="anonymous"
></script>
```

If you only use Sentry for error monitoring, and don't need performance tracing or replay functionality, you can use the following bundle:

Copied

```
<script
  src="https://browser.sentry-cdn.com/9.5.0/bundle.min.js"
  integrity="sha384-5uFF6g91sxV2Go9yGCIngIx1AD3yg6buf0YFt7PSNheVk6CneEMSH6Eap5+e+8gt"
  crossorigin="anonymous"
></script>
```

Once you've included the Sentry SDK bundle in your page, you can use Sentry in your own bundle:

Copied

```
Sentry.init({
  dsn: "https://d815bc9d689a9255598e0007ae5a2f67@o4508070823395328.ingest.us.sentry.io/4508935977238528",
  // this assumes your build process replaces `process.env.npm_package_version` with a value
  release: "my-project-name@" + process.env.npm_package_version,
  integrations: [
    // If you use a bundle with tracing enabled, add the BrowserTracing integration
    Sentry.browserTracingIntegration(),
    // If you use a bundle with session replay enabled, add the Replay integration
    Sentry.replayIntegration(),
  ],

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,

  // Set `tracePropagationTargets` to control for which URLs distributed tracing should be enabled
  tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
});
```

Our CDN hosts a variety of bundles:

- `@sentry/browser` with error monitoring only (named `bundle.<modifiers>.js`)
- `@sentry/browser` with error and tracing (named `bundle.tracing.<modifiers>.js`)
- `@sentry/browser` with error and session replay (named `bundle.replay.<modifiers>.js`)
- `@sentry/browser` with error, tracing and session replay (named `bundle.tracing.replay.<modifiers>.js`)
- each of the integrations in `@sentry/integrations` (named `<integration-name>.<modifiers>.js`)

Each bundle is offered in both ES6 and ES5 versions. Since v7 of the SDK, the bundles are ES6 by default. To use the ES5 bundle, add the `.es5` modifier.

Each version has three bundle varieties:

- minified (`.min`)
- unminified (no `.min`), includes debug logging
- minified with debug logging (`.debug.min`)

Bundles that include debug logging output more detailed log messages, which can be helpful for debugging problems. Make sure to [enable debug](https://docs.sentry.io/platforms/javascript/configuration/options/#debug) to see debug messages in the console. Unminified and debug logging bundles have a greater bundle size than minified ones.

For example:

- `bundle.js` is `@sentry/browser`, compiled to ES6 but not minified, with debug logging included (as it is for all unminified bundles)
- `rewriteframes.es5.min.js` is the `RewriteFrames` integration, compiled to ES5 and minified, with no debug logging
- `bundle.tracing.es5.debug.min.js` is `@sentry/browser` with tracing enabled, compiled to ES5 and minified, with debug logging included

|File|Integrity Checksum|
|---|---|
|browserprofiling.debug.min.js|`sha384-0yjIBAnoaK5b99+CYwdpkB7zPf7oVKoqpjAazXbaVz8MxdO4WnpE9qPk5en6ePpd`|
|browserprofiling.js|`sha384-dwuVMhDGTCBRsKGPKkc4F2RBLDTfWFglZMNd1CGGF7xm94+H1B0msSSw16ifS8Fp`|
|browserprofiling.min.js|`sha384-8OpgNXro0agY0OOlo+KhXB6u37MhAOPw4YfKnWnORSH8xRS7VTkf34+cSB5IIkjP`|
|bundle.debug.min.js|`sha384-cnEOJ/u984q5Nkn6RtAUHTW04p+/nDKBIpF1f1g1G/sLTjA9BLjwKNMNgAITzKyV`|
|bundle.feedback.debug.min.js|`sha384-b0Y1gMtHgPX5iISwumbmmDAeCdGCOoXK8l6zl7Ymr7kdyC2xzRC5yIfBPXWibrdP`|
|bundle.feedback.js|`sha384-msl09+Yll+mCZrkKUxKn1UcKw3dXcqwsDD78eDEUFYNNyv5CX670lTK4bz657QVN`|
|bundle.feedback.min.js|`sha384-u+TGqcIcBlN8rAovDEtfrX27JtfU8Zzu3Onkp8e53BeTuEb8uz4Kb6cqCktnSXk9`|
|bundle.js|`sha384-tp3yw+HTlc7fvXIBgN94nBbA/jjPL89lde+1B+LkmLlVr4IvwDlQHqeIaJXIYtul`|
|bundle.min.js|`sha384-5uFF6g91sxV2Go9yGCIngIx1AD3yg6buf0YFt7PSNheVk6CneEMSH6Eap5+e+8gt`|
|bundle.replay.debug.min.js|`sha384-QEyytSngzyALQWVOGVfmCqwKfdUcyy+L3sp6+IE2o4jGhawrCBAqpwQncQihq7sa`|
|bundle.replay.js|`sha384-B2WFy75oyf2aNUhvY+g5gVjIteE8B8wlG4BCC+cUQZborDzI4EZJjr+HAwNwDWWX`|
|bundle.replay.min.js|`sha384-sJyrIOyOVMSgXus33HKLNkRL49UaLxzIlyNGPo/Frj1n5lE9RPIYt5VVvOiVCs0p`|
|bundle.tracing.debug.min.js|`sha384-zZAYrGlJVdsXneAIXqcsMaCUYS65drIPt1JzbynhnNKwBvNluL+Ou+LyNNUP8H/v`|
|bundle.tracing.js|`sha384-Iw737zuRcOiGNbRmsWBSA17nCEbheKhfoqbG/3/9JScn1+WV/V6KdisyboGHqovH`|
|bundle.tracing.min.js|`sha384-nsiByevQ25GvAyX+c3T3VctX7x10qZpYsLt3dfkBt04A71M451kWQEu+K4r1Uuk3`|
|bundle.tracing.replay.debug.min.js|`sha384-cHIVvVa6o6jvPPqW0mGjU9OhhMNYJg28OJFtPA/6998Ock6bPS03Z+jh3D9GNmtj`|
|bundle.tracing.replay.feedback.debug.min.js|`sha384-SUxvZchslXkR1yulqiDu/V3a+xCxmHBI4s/1IVw+oMG/ucL1rbcJEoauKLULZtIl`|
|bundle.tracing.replay.feedback.js|`sha384-HuuwtDXT8F/bHorLeDkSoJr7EAFabAFYgwe6MWrKu/pVoeehqVeho9TLCtJJ6e4D`|
|bundle.tracing.replay.feedback.min.js|`sha384-f0kPHT5Sxxx7PJldJAQZTVoxO18SxmQw0dUWJQ7/ItH4tVhjiuw9BHvmCyWpY0NK`|
|bundle.tracing.replay.js|`sha384-UbZ7EYQ9bQjZn7KUAq9kXkuO+3t7ONxAqW2pdSRTDacOAPXNjC5DOVmEJBNa/IV9`|
|bundle.tracing.replay.min.js|`sha384-o/GEuWSkrvEGEtjN67ud+ssWsPJyX6RPCWqDvd8EE0N5nm6Id38XSS62lM4ETM0O`|
|captureconsole.debug.min.js|`sha384-on/e4HfdOsfVayAsErLXPB/aHyliorXJWcGcr2CqaABbX0xCSU/6preBbla2amsW`|
|captureconsole.js|`sha384-8ZEhKPNk4cTPtrzlme6XrW/+YYUt8F8/BZg4gRoD0rL9XJ7Oiah7yxvvVTklOi5p`|
|captureconsole.min.js|`sha384-5dE8ewUfcCKAtzvZW4PnXTTON9WmJu3NSvvZG2x6De8gZGxKvPt2KbrpLpdi5d7l`|
|contextlines.debug.min.js|`sha384-kBYcMRH7pzV1N5fS5ge1Y2Ry4e52uChUU+K6tPfDLWWNTLEn8jO6ekGfgP3p5Fqc`|
|contextlines.js|`sha384-U7gnW4u3a0RK1vzD7NO4iw/J8YdgiCqu/JZLBrWGftDJWuz5uELE48zbRpOmZIwh`|
|contextlines.min.js|`sha384-ZIcl9TMPG/CFZWJaXdZH99EHKs1FVzn5yo5YXmNQsu4GFvKHvd5w893eXLVnMXcw`|
|dedupe.debug.min.js|`sha384-appidVJd4lQHMDH9yyAUcN/0gXXKBfqyR82KiEs2eaM24NRA8etcwxSGmcWmSqN4`|
|dedupe.js|`sha384-Xrk2HjxMhy02fKTH4twH90ngRqHFiPWLqGr9h3EfOhs9WSFdCFzgmpBCUip+JIKS`|
|dedupe.min.js|`sha384-lR0FS+fB5waZrwdZKHmh8RS455FrQBh2DMM3tXENej/u7MPzKnP50Ara4pAd2nSU`|
|extraerrordata.debug.min.js|`sha384-AdrBYl3KrgesxeCrCYHHWZ7UpODWGYeq0J46KGQgE6klOJjb6KFFvCNIXl0rChcN`|
|extraerrordata.js|`sha384-yUeXH8o+zRSoIpoErOXf9z4lI67pI23byJ1/xFKI6skdD6yXqHEGeJQUdEBTmOSO`|
|extraerrordata.min.js|`sha384-k+FX/pL6OLkJ596fxaGNRiLbrQMp+pjx5SJkX8By6aOjf4d38QGo+AdVzEGnC3uV`|
|feedback-modal.debug.min.js|`sha384-A8iOkQCMsMSDZPOnWjH2a4KYoKhyopOJmvY4sBDaTctUYI0l24aM79c9N4xMZz5M`|
|feedback-modal.js|`sha384-AIUYNLvdHDIjC4a8k+qZBeMR7kX4jhIOwGq6b7/tIv3obUA53BVvsCYs0lD/rM8n`|
|feedback-modal.min.js|`sha384-TlZikhp/WfnlmcCxNgHwydix/2UzFRHRfFiBL6UUR7XX87N/1hcYYQ3iQeBGbIJR`|
|feedback-screenshot.debug.min.js|`sha384-vDNtDagpybCh0rAZSlpZVuxw0Z6vYhVgsPQss66BqaWA8A18f5m1tLb4Okdrfisw`|
|feedback-screenshot.js|`sha384-F0QfltmtRaYLwRUDN0wB2WAHoxox/tUlrNzODPw7o7q8WD30utboeVcHmoJ6kVpP`|
|feedback-screenshot.min.js|`sha384-n9v3V7+6jdO8zFc9iM8xD2pjl5TOh7nE2o/lXq96zM/vzi4srFGth3ccne0tLs4Y`|
|feedback.debug.min.js|`sha384-nh05EV7w7Bt36BN3GtkgdA9xj9nwPRY3Zs5G8jO/wylPrZ6JxbxAuC9k5sNpGws7`|
|feedback.js|`sha384-mZ6DzagXRkmCY8J3PYaVlYcBqSNZ6qgxhclYv4AJSTSDj3D85ORNfVceaLxNuAbu`|
|feedback.min.js|`sha384-HJqp2k0mFm0GyZ65eQXycZtNzf6yyrMZ216HMJVTZ6uaF3uhUp8+esXrpLkcMxMV`|
|graphqlclient.debug.min.js|`sha384-nS8aLmlktdD6n7QAAH0EjmODBmTyEE5OFAJXwYQxQv+xwZkC/7niYiVipAQP8L3K`|
|graphqlclient.js|`sha384-aPArkwwbGNYMbcsFBmKegDdER5n6bJieaubj7jXk8c5PAlAApRWVkD47nKXEWPBG`|
|graphqlclient.min.js|`sha384-nODkumrMdxvUw0oDHLs0sTulUgkMCvZqb3cP7mOYvVOtjSkQCPh4jqVB7GZg4kSP`|
|httpclient.debug.min.js|`sha384-uQo4FrcROLSTGev8S9H7S73drPdOAcPLV5lcoDy1x877FLFsRVuk57zV2Wn2VL+r`|
|httpclient.js|`sha384-v0bu7yVLV09oH3QAdcEOLQy27zL+XoMXkEJDDKLFg0Y9O7QJyXtJ9aolqF2wuS5T`|
|httpclient.min.js|`sha384-mE16WCqZPg+xqmwcHafslE8FQP+/NzXn+4Omko5WGZ+Kj//8fBPZfTkXkofFGFcy`|
|modulemetadata.debug.min.js|`sha384-bhvZMyxA1X5LuUJ8/q3wfGqU8VgEAOEWOEjKqYDoe4+KCPVJu3zFWMNPGt9e0Tgb`|
|modulemetadata.js|`sha384-flsLQyrZtdJRMxNBtyOGCcz9qLcaEK37I//LQW1mqeSarlaMNZ0feMOwnLE7rSlL`|
|modulemetadata.min.js|`sha384-OTpZwkLuAwfQd+Oxv5zz86eYm8DPTkCpLsLNEWDWMwDbVSZU0RXumSwWY/YVQDtF`|
|multiplexedtransport.debug.min.js|`sha384-GoWQrOEaPNxj/WWExlgP6WTinI356cdfvXVwUKU/i+YrbKSzbVMEWReIt4eb1V7l`|
|multiplexedtransport.js|`sha384-Y6cGmRYuk59AkINeZpD7x4DJrFPi2coU1t318M68UZtoKZPq1NHZXQ4R2+/FFDYD`|
|multiplexedtransport.min.js|`sha384-ltiaNvlynTrcCjGurrCbGN9q0bmmlyCmwUasxgBOkzzbkGYT1lZ4CqcKMZJIK7zo`|
|replay-canvas.debug.min.js|`sha384-6HsMoO1AttDRUAUA1B5tHMAe+HYTpguqDH4BxmDoD6oRqJLaEY5QO5zgpLTf5vYY`|
|replay-canvas.js|`sha384-JRe/WzlIx21g6hRIoncdVhlnuasvNlui20dlPAi/ChqnBC/RXrXXsC4+6m4qGkQI`|
|replay-canvas.min.js|`sha384-hdg2mQb6hKnEiCJ8+TwD1uJMc9TwoOMSyDwlG7xpVncdkQI1473gdliMKtgcU8V6`|
|replay.debug.min.js|`sha384-VnvpJDhRds0TIO9uUSypTLoCyBFla2qpr/XA47uLRai4t7wByp6k8brxKTomDG2R`|
|replay.js|`sha384-WMCLALLVe3clSYI90R83wkfGdDsaSAg58h7BO4mDvEgyxtrTligROwGMA/Uy1pyI`|
|replay.min.js|`sha384-YEtl3gyE+SdRKMG/2/393dUpd6b3ljkgAfl57C6D1LHI7tHf2gvYNfW2PA18Ee/9`|
|reportingobserver.debug.min.js|`sha384-3JUiut4IkciN4XHLx5C8ZqahIry+a2j4ogs0e6mRXxEpqYHU3ttMAi+kvJH1/kYt`|
|reportingobserver.js|`sha384-8n9rPUs+SZNDS+6JQP6y77wp4lOQ3zhFlXtJTNTyKACeBssf7Av3ogsiX/A+5ssD`|
|reportingobserver.min.js|`sha384-k4hVrqKBeOD3JdSOk+ZdV2I67tp/tPzYWb8Ox3hnoYjS+AKJGmRFngjZPOzn7VAp`|
|rewriteframes.debug.min.js|`sha384-9qUmDifnEB8HljcpZpvxjzjGi3U6Y+4FQpPtXfAEikkN0OnaWZocgq8AFV5YjE6v`|
|rewriteframes.js|`sha384-vWW+uZh48pViY4Z8LJ2DTziQy2yxO7fRdev5fCyi503nj6WeYNifblX5knVRfa1J`|
|rewriteframes.min.js|`sha384-8RjRQN1fldKuGk1ZsQBu35buT5/2Wlh9NHEx1Gnr/eaR9Kv5f0F7mopVGvqlOhY2`|
|spotlight.debug.min.js|`sha384-yGOUVqPh+D4MQrndT9MrBNxI8moqtAAzWfJ1qswH06INuyjjob5IixdMMZGiPRWo`|
|spotlight.js|`sha384-L3wwoajq9rS1BzIjX+S2E0aw9AiLIXvg9xANW7o/qIa3/FMdIEK4r0aTVtuoX+Sr`|
|spotlight.min.js|`sha384-ufjQ0lnauqMqGRAMcVrNcysa/acVGOrhBI8VJMu9Pn4U5zOi4BhLuQNTjSDMQkgA`|

To find the integrity hashes for older SDK versions, you can view our SDK release registry for the Browser SDK [here](https://github.com/getsentry/sentry-release-registry/tree/master/packages/npm/@sentry/browser).

If you use the [`defer` script attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script#attr-defer), we strongly recommend that you place the script tag for the browser SDK first and mark all of your other scripts with `defer` (but not `async`). This will guarantee that that the Sentry SDK is executed before any of the others.

Without doing this you will find that it's possible for errors to occur before Sentry is loaded, which means you'll be flying blind to those issues.

If you have a Content Security Policy (CSP) set up on your site, you will need to add the `script-src` of wherever you're loading the SDK from, and the origin of your DSN. For example:

- `script-src: https://browser.sentry-cdn.com https://js.sentry-cdn.com`
- `connect-src: *.sentry.io`

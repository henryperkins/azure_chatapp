/**
 * Sentry Initialization Manager (Factory Pattern, Dependency Injection)
 * Refactored for strict DI, modularity, teardown, and centralized config.
 *
 * @param {Object} deps
 * @param {object} deps.config - Centralized config: {dsn, environment, release, sampleRates, integrations, ...}
 * @param {object} deps.env - Per-request environment values; e.g., user flags, app state.
 * @param {object} deps.dependencySystem - For advanced lookups if needed; can be omitted if not used.
 * @param {object} deps.domAPI - {createElement, addEventListener, removeEventListener, ...}
 * @param {object} deps.storage - {getItem, setItem} (localStorage-like).
 * @param {object} deps.notification - {log, warn, error}, for logging/notification.
 * @param {object} deps.navigator - Navigator API (for UA, onLine, etc.).
 * @param {object} deps.sanitizer - Sanitize injected HTML if needed.
 * @param {object} deps.sentryNamespace - Sentry object namespace (e.g., window.Sentry).
 * @param {object} deps.window - Reference to global window-like object.
 * @param {object} deps.document - Reference to global document-like object.
 *
 * @returns {object} { initialize, cleanup }
 */

export function createSentryManager(deps) {
  // Provide a robust notification fallback if not supplied
  if (!deps.notification) {
    deps.notification = {
      log: (...args) => { try { console.log(...args); } catch {} },
      warn: (...args) => { try { console.warn(...args); } catch {} },
      error: (...args) => { try { console.error(...args); } catch {} },
      debug: (...args) => { try { console.debug(...args); } catch {} }
    };
  }
  // Dependency validation
  const required = [
    "config",
    "env",
    "domAPI",
    "storage",
    "notification",
    "navigator",
    "window",
    "document",
    "sentryNamespace",
  ];
  for (const k of required) {
    if (!deps[k]) throw new Error(`SentryManager: missing dependency ${k}`);
  }
  const {
    config,
    env,
    domAPI,
    storage,
    notification,
    navigator,
    window,
    document,
    sentryNamespace,
  } = deps;

  let initialized = false;
  let cleanupCbs = [];
  let navigationObserver = null;

  // Determine if Sentry should be disabled based on config/env/user prefs
  function shouldDisableSentry() {
    try {
      // Configurable environment detection (dev detection)
      const hostname = window.location.hostname;
      const isDev = config.isDev
        ? config.isDev(hostname, env)
        : hostname === "localhost" || hostname === "127.0.0.1";

      const userDisabled =
        storage.getItem("disable_monitoring") === "true" ||
        (typeof env.disableMonitoring !== "undefined"
          ? !!env.disableMonitoring
          : false);

      if (isDev) {
        return !(storage.getItem("enable_monitoring") === "true");
      }
      return userDisabled;
    } catch {
      notification.warn("Sentry: localStorage check failed; will default to enabled");
      return false;
    }
  }

  // Sentry DSN getter (configurable)
  function getDsn() {
    return config.dsn || env.SENTRY_DSN || "YOUR_SENTRY_DSN_HERE";
  }

  // Environment getter
  function getEnvironment() {
    return (
      config.environment ||
      env.ENVIRONMENT ||
      (() => {
        const hn = window.location.hostname.toLowerCase();
        if (hn.includes("localhost") || hn.includes("127.0.0.1")) return "development";
        if (hn.includes("staging") || hn.includes("test")) return "staging";
        if (hn.includes("dev") || hn.includes("qa")) return "development";
        return "production";
      })()
    );
  }

  // Release getter
  function getReleaseVersion() {
    return config.release || env.APP_VERSION || "azure-chatapp@1.0.0";
  }

  // Sentry init logic with injected config and namespace
  function setupSentry() {
    if (initialized) {
      notification.log("[Sentry] Already initialized, skipping duplicate setup");
      return;
    }
    const Sentry = sentryNamespace.Sentry;
    if (!Sentry || typeof Sentry.init !== "function") {
      notification.error("[Sentry] Sentry namespace missing or invalid.");
      return;
    }
    const environment = getEnvironment();
    const releaseVersion = getReleaseVersion();
    Sentry.init({
      dsn: getDsn(),
      environment,
      release: releaseVersion,
      tracesSampleRate: config.sampleRates?.traces ?? (environment === "development" ? 1.0 : 0.1),
      replaysSessionSampleRate: config.sampleRates?.replaysSession ?? 0.0,
      replaysOnErrorSampleRate: config.sampleRates?.replaysOnError ?? 1.0,
      integrations: config.integrations
        ? config.integrations(Sentry)
        : [
            Sentry.browserTracingIntegration &&
              Sentry.browserTracingIntegration(),
            Sentry.BrowserTracing && Sentry.BrowserTracing(),
            Sentry.replayIntegration && Sentry.replayIntegration({
              maskAllText: true,
              blockAllMedia: true,
            }),
            Sentry.captureConsoleIntegration &&
              Sentry.captureConsoleIntegration(),
            Sentry.contextLinesIntegration &&
              Sentry.contextLinesIntegration(),
          ].filter(Boolean),
      beforeSend(event) {
        if (shouldDisableSentry()) return null;
        // Scrub sensitive URL params
        if (event.request?.url) {
          try {
            const url = new window.URL(event.request.url);
            ["token", "key", "secret", "password", "passwd", "auth"].forEach((param) => {
              if (url.searchParams.has(param)) {
                url.searchParams.set(param, "[redacted]");
              }
            });
            event.request.url = url.toString();
          } catch (err) {
            notification.error("Sentry: URL param redaction failed", err);
          }
        }
        return event;
      },
    });
    notification.log("[Sentry] Initialized successfully");

    Sentry.setTag("browser", navigator.userAgent);
    Sentry.setTag(
      "screen_resolution",
      `${window.screen.width}x${window.screen.height}`
    );
    Sentry.setTag("app_version", releaseVersion);

    Sentry.setContext("environment", {
      browser: { name: navigator.userAgent, online: navigator.onLine },
      screen: { width: window.screen.width, height: window.screen.height },
      document: { referrer: document.referrer, url: window.location.href },
    });

    // Wire up authStateChanged for user tracking, allowing teardown
    const authListener = (evt) => {
      if (evt.detail?.authenticated && evt.detail?.username) {
        Sentry.setUser({
          id: evt.detail.username,
          username: evt.detail.username,
        });
      } else {
        Sentry.setUser(null);
      }
    };
    domAPI.addEventListener(document, "authStateChanged", authListener);
    cleanupCbs.push(() =>
      domAPI.removeEventListener(document, "authStateChanged", authListener)
    );

    // Attach all global error handlers and keep cleanup refs
    attachGlobalSentryHandlers(Sentry);

    // Enhance fetch for tracing, if desired
    if (typeof config.enhanceFetch === "function") {
      cleanupCbs.push(config.enhanceFetch(deps, Sentry));
    }

    initialized = true;
  }

  // Global event/error handling with teardown
  function attachGlobalSentryHandlers(Sentry) {
    // Unhandled Promise Rejection
    const unhandledRejectionListener = (event) => {
      if (!(Sentry && typeof Sentry.captureException === "function")) return;
      const error = event.reason || new Error("Unhandled Promise Rejection");
      Sentry.captureException(error, {
        extra: {
          type: "unhandledrejection",
          promise: event.promise?.toString(),
          stack: error?.stack,
        },
      });
    };
    domAPI.addEventListener(window, "unhandledrejection", unhandledRejectionListener);
    cleanupCbs.push(() =>
      domAPI.removeEventListener(window, "unhandledrejection", unhandledRejectionListener)
    );

    // Window error
    const windowErrorListener = (event) => {
      if (!(Sentry && typeof Sentry.captureException === "function")) return;
      if (
        !event.message?.includes("auth") &&
        !event.filename?.includes("auth.js")
      ) {
        Sentry.captureException(event.error || new Error(event.message), {
          extra: {
            type: "window.onerror",
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        });
      }
    };
    domAPI.addEventListener(window, "error", windowErrorListener);
    cleanupCbs.push(() =>
      domAPI.removeEventListener(window, "error", windowErrorListener)
    );

    // UI click breadcrumb
    const clickListener = (event) => {
      if (!Sentry || typeof Sentry.addBreadcrumb !== "function") return;
      if (!event.target || event.target === document) return;
      Sentry.addBreadcrumb({
        category: "ui.click",
        message: `Clicked on <${event.target.tagName?.toLowerCase()}>`,
        level: "info",
        data: {
          id: event.target.id || null,
          class: event.target.className || null,
          text: event.target.textContent?.trim().slice(0, 80) || null,
        },
      });
    };
    domAPI.addEventListener(document, "click", clickListener);
    cleanupCbs.push(() =>
      domAPI.removeEventListener(document, "click", clickListener)
    );

    // Navigation breadcrumbs (MutationObserver and popstate)
    initNavigationTracking(Sentry);

    // Insert additional error/event handlers as desired...
  }

  // Navigation tracking setup/teardown
  function initNavigationTracking(Sentry) {
    // MutationObserver
    let lastHref = window.location.href;

    navigationObserver = new window.MutationObserver(() => {
      if (window.location.href !== lastHref && Sentry) {
        Sentry.addBreadcrumb({
          category: "navigation",
          message: `Navigated to: ${window.location.href}`,
          level: "info",
        });
        lastHref = window.location.href;
      }
    });
    try {
      navigationObserver.observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      notification.error("Sentry navigation tracking failed", error);
    }
    cleanupCbs.push(() => navigationObserver.disconnect());

    // popstate
    const popstateListener = () => {
      if (window.location.href !== lastHref && Sentry) {
        Sentry.addBreadcrumb({
          category: "navigation",
          message: `Navigated by popstate to: ${window.location.href}`,
          level: "info",
        });
        lastHref = window.location.href;
      }
    };
    domAPI.addEventListener(window, "popstate", popstateListener);
    cleanupCbs.push(() =>
      domAPI.removeEventListener(window, "popstate", popstateListener)
    );
  }

  // SDK loader logic (optional, or can depend on app - kept dependency injectable)
  function loadSentrySdk(then) {
    if (sentryNamespace.Sentry) {
      then();
      return;
    }
    const script = domAPI.createElement("script");
    script.src =
      config.sdkUrl ||
      "https://browser.sentry-cdn.com/7.50.0/bundle.min.js";
    script.crossOrigin = "anonymous";
    if (config.sdkIntegrity) {
      script.integrity = config.sdkIntegrity;
    }
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onload = () => {
      if (sentryNamespace.Sentry) {
        notification.log("[Sentry] SDK loaded successfully");
        then();
      } else {
        notification.error("[Sentry] SDK failed to load properly");
      }
    };
    script.onerror = () => {
      notification.error("[Sentry] Failed to load SDK from CDN");
    };
    domAPI.appendChild(document.head, script);
    cleanupCbs.push(() => {
      if (script.parentNode) script.parentNode.removeChild(script);
    });
  }

  // Initialize function (call to set up Sentry if not disabled)
  function initialize() {
    if (initialized) {
      notification.log("[Sentry] Already initialized, skipping");
      return;
    }
    if (shouldDisableSentry()) {
      notification.log("[Sentry] Disabled via environment or user preference");
      return;
    }
    // If SDK present, setup, else load then setup
    if (sentryNamespace.Sentry) {
      setupSentry();
    } else {
      loadSentrySdk(setupSentry);
    }
  }

  function cleanup() {
    for (const cb of cleanupCbs) {
      try {
        cb();
      } catch (e) {
        notification.warn("Sentry cleanup failed", e);
      }
    }
    cleanupCbs = [];
    initialized = false;
    navigationObserver = null;
  }

  // Return modular API
  return { initialize, cleanup };
}

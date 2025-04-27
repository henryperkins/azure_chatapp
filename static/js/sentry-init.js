/**
 * sentry-init.js
 *
 * Initializes and configures Sentry.io for:
 *  - Error monitoring
 *  - Performance tracing
 *  - Session Replay
 *
 * Loads as early as possible to capture errors, but attaches handlers only
 * after we verify Sentry is actually enabled and loaded.
 */

(function () {
  /**
   * Determines if Sentry should be disabled based on:
   *  - localStorage flag (disable_monitoring)
   *  - localhost or 127.0.0.1 environment
   * @returns {boolean}
   */
  function shouldDisableSentry() {
    try {
      // Check if we're in development mode
      const isDevelopment =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      // Check if user has explicitly disabled monitoring
      const userDisabled = localStorage.getItem('disable_monitoring') === 'true';

      // In development, only enable if explicitly requested (enable_monitoring='true')
      if (isDevelopment) {
        return !(localStorage.getItem('enable_monitoring') === 'true');
      }

      // In production, respect user preference
      return userDisabled;
    } catch (e) {
      // If localStorage is inaccessible (private mode, etc.), default to enabled
      return false;
    }
  }

  /**
   * Return the DSN to use. Replace with your own logic:
   *  - Inline DSN
   *  - Environment variables
   */
  function getDsn() {
    return (
      window.ENV?.SENTRY_DSN ||
      window.SENTRY_DSN ||
      'YOUR_SENTRY_DSN_HERE' // Replace with actual DSN
    );
  }

  /**
   * Detect environment. Customize as needed.
   */
  function detectEnvironment() {
    const hostname = window.location.hostname.toLowerCase();
    const env = window.ENV?.ENVIRONMENT || window.SENTRY_ENVIRONMENT;

    if (env) return env.toLowerCase();

    if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
      return 'development';
    } else if (hostname.includes('staging') || hostname.includes('test')) {
      return 'staging';
    } else if (hostname.includes('dev') || hostname.includes('qa')) {
      return 'development';
    }
    return 'production';
  }

  /**
   * Provide a release version if available (e.g., from CI).
   */
  function getReleaseVersion() {
    return window.APP_VERSION || 'azure-chatapp@1.0.0';
  }

  /**
   * The main initialization function, called first. If Sentry is disabled, we do nothing.
   */
  function initializeSentry() {
    if (shouldDisableSentry()) {
      console.log('[Sentry] Disabled based on environment or user preference');
      return;
    }

    const dsn = getDsn();
    if (!dsn) {
      console.warn('[Sentry] No DSN configured - skipping initialization');
      return;
    }

    // If Sentry is already loaded (e.g. via <script> in head), skip to setup
    if (window.Sentry) {
      console.log('[Sentry] SDK already available, setting up...');
      setupSentry();
      return;
    }

    // Otherwise, load the Sentry SDK dynamically
    const script = document.createElement('script');
    script.src = 'https://browser.sentry-cdn.com/7.50.0/bundle.min.js';
    script.crossOrigin = 'anonymous';
    script.integrity = 'sha384-ABC123...'; // optional integrity hash
    script.referrerPolicy = 'strict-origin-when-cross-origin';

    script.onload = function () {
      if (window.Sentry) {
        console.log('[Sentry] SDK loaded successfully');
        setupSentry();
      } else {
        console.error('[Sentry] SDK failed to load properly');
      }
    };
    script.onerror = function () {
      console.error('[Sentry] Failed to load SDK from CDN');
    };

    document.head.appendChild(script);
  }

  /**
   * Once Sentry is available, configure it and attach global handlers.
   */
  function setupSentry() {
    if (!window.Sentry || typeof Sentry.init !== 'function') {
      return; // Sentry script blocked or failed
    }

    const environment = detectEnvironment();
    const releaseVersion = getReleaseVersion();

    // Defer final Sentry.init if your app has phases, or init immediately
    const initWhenReady = () => {
      // Optional check if your app has a state object with phases:
      // e.g., only init Sentry after certain phases. If not needed, skip this.
      if (!window.app?.state || window.app?.state?.currentPhase === 'initialized') {
        Sentry.init({
          dsn: getDsn(),
          environment: environment,
          release: releaseVersion,
          tracesSampleRate: parseFloat(
            window.SENTRY_TRACES_SAMPLE_RATE ||
            (environment === 'development' ? '1.0' : '0.1')
          ),
          replaysSessionSampleRate: parseFloat(
            window.SENTRY_REPLAY_SESSION_SAMPLE_RATE || '0.0'
          ),
          replaysOnErrorSampleRate: parseFloat(
            window.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE || '1.0'
          ),
          integrations: [
            // New BrowserTracing integration for automatic performance tracing
            Sentry.browserTracingIntegration && Sentry.browserTracingIntegration({
              // tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/], // optional
            }),
            // Browser Tracing (legacy, can be removed if using browserTracingIntegration)
            Sentry.BrowserTracing && Sentry.BrowserTracing({
              // advanced tracing config
            }),
            // Session Replay
            Sentry.Replay && Sentry.Replay({
              maskAllText: true,
              blockAllMedia: true,
            }),
            // Capture console logs as breadcrumbs/events
            Sentry.captureConsoleIntegration && Sentry.captureConsoleIntegration({
              // Optional: specify levels to capture
              // levels: ['log', 'info', 'warn', 'error', 'debug', 'assert']
            }),
            Sentry.contextLinesIntegration && Sentry.contextLinesIntegration({
              // frameContextLines: 7 // (optional)
            }),
          ].filter(Boolean),
          beforeSend(event, hint) {
            // If user disables in real time or we discover dev environment
            if (shouldDisableSentry()) {
              return null;
            }
            // Example: scrub sensitive params
            if (event.request?.url) {
              try {
                const url = new URL(event.request.url);
                ['token', 'key', 'secret', 'password', 'passwd', 'auth'].forEach(param => {
                  if (url.searchParams.has(param)) {
                    url.searchParams.set(param, '[redacted]');
                  }
                });
                event.request.url = url.toString();
              } catch { }
            }
            return event;
          }
        });

        console.log('[Sentry] Initialized successfully');
        // Basic context/tags
        Sentry.setTag('browser', navigator.userAgent);
        Sentry.setTag('screen_resolution', `${window.screen.width}x${window.screen.height}`);
        Sentry.setTag('app_version', releaseVersion);

        // Set a broad environment context
        Sentry.setContext('environment', {
          browser: { name: navigator.userAgent, online: navigator.onLine },
          screen: { width: window.screen.width, height: window.screen.height },
          document: { referrer: document.referrer, url: window.location.href },
        });

        // Listen for auth changes to identify user
        document.addEventListener('authStateChanged', function (evt) {
          if (evt.detail?.authenticated && evt.detail?.username) {
            Sentry.setUser({ id: evt.detail.username, username: evt.detail.username });
          } else {
            Sentry.setUser(null);
          }
        });

        // Possibly define a user feedback dialog
        window.showUserFeedbackDialog = function (eventId) {
          if (window.Sentry && typeof Sentry.showReportDialog === 'function') {
            Sentry.showReportDialog({
              eventId: eventId,
              title: 'Cuéntanos más sobre el error',
              subtitle: 'Ayúdanos a identificar y corregir este problema rápidamente',
              labelName: 'Nombre',
              labelEmail: 'Email',
              labelComments: 'Comentarios',
              labelSubmit: 'Enviar reporte',
              successMessage: '¡Gracias por tu ayuda!',
            });
          }
        };

        // Attach all global error handlers
        attachGlobalSentryHandlers();
        // Enhance fetch with distributed tracing
        enhanceFetchForSentry();
      }
    };

    // If your app has a dedicated state machine, you might wait for a certain phase
    if (window.app?.state) {
      initWhenReady();
    } else {
      // Or, just do it after DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWhenReady);
      } else {
        initWhenReady();
      }
    }
  }

  /**
   * All Sentry-dependent, global error and event hooks should be attached AFTER Sentry is initialized.
   */
  function attachGlobalSentryHandlers() {
    // Unhandled rejections
    window.addEventListener('unhandledrejection', (event) => {
      if (!(window.Sentry && typeof Sentry.captureException === 'function')) return;
      const error = event.reason || new Error('Unhandled Promise Rejection');
      Sentry.captureException(error, {
        extra: {
          type: 'unhandledrejection',
          promise: event.promise?.toString(),
          stack: error?.stack
        },
      });
    });

    // Window errors
    window.addEventListener('error', (event) => {
      if (!(window.Sentry && typeof Sentry.captureException === 'function')) return;
      // Example skip logic for certain known logs:
      if (!event.message.includes('auth') && !event.filename?.includes('auth.js')) {
        Sentry.captureException(event.error || new Error(event.message), {
          extra: {
            type: 'window.onerror',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          }
        });
      }
    });

    // Override console.error
    // const originalConsoleError = console.error;
    // console.error = function (...args) {
    //   const err = args[0] instanceof Error ? args[0] : new Error(args.join(' '));
    //   if (window.Sentry && typeof Sentry.captureException === 'function') {
    //     Sentry.captureException(err, { extra: { type: 'console.error', args: args.slice(1) } });
    //   }
    //   originalConsoleError.apply(console, args);
    // };

    // Log user clicks as breadcrumbs
    document.addEventListener('click', (event) => {
      if (!window.Sentry || typeof Sentry.addBreadcrumb !== 'function') return;
      if (!event.target || event.target === document) return;
      Sentry.addBreadcrumb({
        category: 'ui.click',
        message: `Clicked on <${event.target.tagName.toLowerCase()}>`,
        level: 'info',
        data: {
          id: event.target.id || null,
          class: event.target.className || null,
          text: event.target.textContent?.trim().slice(0, 80) || null,
        },
      });
    });

    // Track navigation changes via MutationObserver or popstate
    initNavigationTracking();
  }

  /**
   * Simple MutationObserver approach to watch for SPA navigation changes
   */
  function initNavigationTracking() {
    if (!document.body || !window.Sentry) return;
    let lastHref = window.location.href;

    const navigationObserver = new MutationObserver(() => {
      if (window.location.href !== lastHref && window.Sentry) {
        Sentry.addBreadcrumb({
          category: 'navigation',
          message: `Navigated to: ${window.location.href}`,
          level: 'info',
        });
        lastHref = window.location.href;
      }
    });

    try {
      navigationObserver.observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      console.error('[Sentry] Navigation tracking failed:', error);
    }

    // Also, you might register popstate:
    window.addEventListener('popstate', () => {
      if (window.location.href !== lastHref && window.Sentry) {
        Sentry.addBreadcrumb({
          category: 'navigation',
          message: `Navigated by popstate to: ${window.location.href}`,
          level: 'info',
        });
        lastHref = window.location.href;
      }
    });
  }

  /**
   * Enhance fetch to propagate Sentry tracing headers, correlate backend errors, etc.
   */
  function enhanceFetchForSentry() {
    if (!window.fetch || !window.Sentry) return;

    // Optionally store the last known Sentry trace or baggage from responses
    const lastTraceHeaders = {
      'sentry-trace': null,
      'baggage': null,
    };
    window.__lastSentryTraceHeaders = lastTraceHeaders; // for debugging

    // Patch the built-in fetch
    const originalFetch = window.fetch;
    window.fetch = async function (input, init = {}) {
      let span = null;
      let reqInfo = {};

      try {
        // Attempt to attach request to active Sentry transaction
        const hub = Sentry.getCurrentHub && Sentry.getCurrentHub();
        const transaction = hub?.getScope()?.getTransaction();
        if (transaction) {
          span = transaction.startChild({
            op: 'http.client',
            description: `fetch ${typeof input === 'string' ? input : input?.url}`,
          });
        }

        // Prepare headers
        let headers = (init.headers && typeof init.headers.append !== 'function')
          ? { ...init.headers }
          : (init.headers || {});

        // Use any previously captured trace/baggage if not provided
        if (!headers['sentry-trace'] && lastTraceHeaders['sentry-trace']) {
          headers['sentry-trace'] = lastTraceHeaders['sentry-trace'];
        }
        if (!headers['baggage'] && lastTraceHeaders['baggage']) {
          headers['baggage'] = lastTraceHeaders['baggage'];
        }

        init.headers = headers;
        reqInfo = {
          url: (typeof input === 'string') ? input : input?.url,
          method: init.method || 'GET',
        };

        const response = await originalFetch.apply(this, [input, init]);

        // Grab any newly returned Sentry trace headers
        if (response.headers) {
          const sentryTrace = response.headers.get('sentry-trace');
          const baggage = response.headers.get('baggage');
          if (sentryTrace) lastTraceHeaders['sentry-trace'] = sentryTrace;
          if (baggage) lastTraceHeaders['baggage'] = baggage;
        }

        // If response has an error status, log a breadcrumb for debugging
        if (!response.ok) {
          let jsonBody = null;
          try {
            if (!response.bodyUsed) {
              jsonBody = await response.clone().json();
              response.jsonBody = jsonBody;
            }
          } catch (_) {
            // ignore if not JSON or body already consumed
          }

          // Optionally capture correlation from server (x-sentry-event-id, etc.)
          const sentryEventId =
            response.headers.get('x-sentry-event-id') ||
            response.jsonBody?.sentry_event_id;
          const traceId =
            response.headers.get('x-trace-id') ||
            response.jsonBody?.trace_id ||
            response.jsonBody?.traceId;
          if (sentryEventId) Sentry.setTag('backend_sentry_event_id', sentryEventId);
          if (traceId) Sentry.setTag('backend_trace_id', traceId);

          Sentry.addBreadcrumb({
            category: 'fetch',
            message: `Fetch failed: ${response.status} ${response.statusText}`,
            level: 'error',
            data: {
              ...reqInfo,
              status: response.status,
              responseBody: jsonBody,
            },
          });
        }

        // If we started a span, mark HTTP status & finish it
        if (span) {
          span.setHttpStatus(response.status);
          span.finish();
        }
        return response;
      } catch (error) {
        // If this is a network or parse error
        if (span) span.finish();
        Sentry.captureException(error, { extra: reqInfo });
        throw error;
      }
    };
  }

  // Expose a manual reportError fallback (safe to use even if Sentry not loaded)
  window.reportError = function (error, context = {}) {
    if (window.Sentry && typeof Sentry.captureException === 'function') {
      Sentry.captureException(error, { extra: context });
    }
    console.error('[Manual Error Report]', error, context);
  };

  // Make the Sentry init function globally accessible if needed
  window.initSentry = initializeSentry;

  // If a loader script calls sentryOnLoad, link to our init
  if (typeof window.sentryOnLoad === 'function') {
    const original = window.sentryOnLoad;
    window.sentryOnLoad = function () {
      console.log('[Sentry] Loader script calling sentryOnLoad callback');
      original();
      initializeSentry();
    };
  } else {
    // Otherwise initialize Sentry immediately
    initializeSentry();
  }
})();

/**
 * sentry-init.js
 *
 * Initializes and configures Sentry.io for:
 * - Error monitoring
 * - Performance tracking
 * - Session replay
 *
 * Loads as early as possible to capture all errors.
 * Dynamically injects the Sentry loader script unless disabled by user preference.
 * Replace 'YOUR_DSN_PUBLIC_KEY' with your actual public DSN key, or an ENV variable.
 */
(function () {
  /**
   * Determines if Sentry should be disabled based on:
   * - localStorage flag (disable_monitoring)
   * - localhost environment
   * @returns {boolean}
   */
  function shouldDisableSentry() {
    try {
      return (
        localStorage.getItem('disable_monitoring') === 'true' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      );
    } catch (e) {
      // If localStorage is inaccessible (e.g., in private mode), default to enabled
      return false;
    }
  }

  // Helper to retrieve your DSN (inline, environment variable, etc.)
  function getDsn() {
    // Retrieve DSN from environment configuration
    return window.ENV?.SENTRY_DSN || 'https://b03711f63d1160f48dcaeda3edae14ac@o4508070823395328.ingest.us.sentry.io/4509138383863808';
  }

  // Helper to detect environment
  function detectEnvironment() {
    return window.location.hostname.includes('localhost') ? 'development' : 'production';
  }

  // Helper to provide a release version
  function getReleaseVersion() {
    // Ideally: read from a global build variable or version file
    return window.APP_VERSION || 'azure-chatapp@1.0.0';
  }

  // Proceed only if not disabled
  if (!shouldDisableSentry()) {
    /**
     * Called when the Sentry Loader script has finished loading.
     * Configures Sentry using the Global Sentry object.
     */
    window.sentryOnLoad = function () {
      const environment = detectEnvironment();
      const releaseVersion = getReleaseVersion();

      Sentry.init({
        environment: environment,
        release: releaseVersion,

        // Adjust performance sample rates
        tracesSampleRate: environment === 'development'
          ? 1.0
          : parseFloat(window.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

        // Session replay sample rates
        replaysSessionSampleRate: 0.15,  // 15% of sessions
        replaysOnErrorSampleRate: 1.0,   // 100% of sessions with errors

        integrations: [
          // Browser Tracing
          Sentry.browserTracingIntegration(),

          // Session Replay
          Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
            networkDetailAllowUrls: []
          })
        ],

        /**
         * Filter or sanitize events before sending to Sentry.
         * @param {Object} event - The Sentry event object.
         * @param {Object} [hint] - Event context (unused here).
         */
        beforeSend: function (event, hint) {
          // Check again if user has disabled Sentry
          if (shouldDisableSentry()) {
            return null;
          }

          // Remove sensitive URL params
          if (event.request && event.request.url) {
            try {
              const url = new URL(event.request.url);
              const sensitiveParams = ['token', 'key', 'secret', 'password', 'passwd', 'auth'];
              sensitiveParams.forEach(param => {
                if (url.searchParams.has(param)) {
                  url.searchParams.set(param, '[redacted]');
                }
              });
              event.request.url = url.toString();
            } catch (e) {
              // If URL parsing fails, continue with original URL
            }
          }
          return event;
        }
      });

      // Enhanced context capture
      Sentry.setTag('app_version', window.APP_VERSION || 'unknown');
      Sentry.setTag('browser', navigator.userAgent);
      Sentry.setTag('screen_resolution', `${window.screen.width}x${window.screen.height}`);

      // Capture initial environment details
      Sentry.setContext('environment', {
        browser: {
          name: navigator.userAgent,
          online: navigator.onLine,
          language: navigator.language
        },
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          colorDepth: window.screen.colorDepth
        },
        document: {
          referrer: document.referrer,
          url: window.location.href
        }
      });

      // Monitor auth changes for user identification
      document.addEventListener('authStateChanged', function (event) {
        if (event.detail?.authenticated && event.detail?.username) {
          Sentry.setUser({
            id: event.detail.username,
            username: event.detail.username
            // Avoid storing additional PII
          });
        } else {
          Sentry.setUser(null);
        }
      });

      console.log('[Sentry] Initialized and configured');

      window.showUserFeedbackDialog = function (eventId) {
        if (window.Sentry && typeof Sentry.showReportDialog === 'function') {
          Sentry.showReportDialog({
            eventId: eventId,
            title: "Cuéntanos más sobre el error",
            subtitle: "Ayúdanos a identificar y corregir este problema rápidamente",
            subtitle2: "",
            labelName: "Nombre",
            labelEmail: "Email",
            labelComments: "Comentarios",
            labelSubmit: "Enviar reporte",
            successMessage: "¡Gracias por tu ayuda!"
          });
        }
      };
    };

    // Dynamically insert Sentry loader script
    const script = document.createElement('script');
    script.src = getDsn(); // e.g. 'https://js.sentry-cdn.com/YOUR_DSN_PUBLIC_KEY.min.js'
    script.crossOrigin = 'anonymous';

    // Insert script into the document
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }

  /**
   * Manually report errors from anywhere in the code.
   * @param {Error} error - The error to report.
   * @param {Object} [context={}] - Additional context about the error.
   */
  window.reportError = function (error, context = {}) {
    if (window.Sentry && typeof Sentry.captureException === 'function') {
      Sentry.captureException(error, { extra: context });
    }
     console.error('[Error]', error, context);
  };

  // Enhanced global error handlers
  function captureError(error, context = {}) {
    if (window.Sentry && typeof Sentry.captureException === 'function') {
      Sentry.withScope(scope => {
        scope.setLevel('error');
        scope.setExtras(context);
        Sentry.captureException(error);
      });
    }
    console.error('[Captured Error]', error, context);
  }

  // Global unhandled promise rejection handler
  window.addEventListener('unhandledrejection', function (event) {
    const error = event.reason || new Error('Unhandled Promise Rejection');
    captureError(error, {
      type: 'unhandledrejection',
      promise: event.promise.toString(),
      stack: error?.stack
    });
  });

  // Global error handler
  window.addEventListener('error', function (event) {
    captureError(event.error || new Error(event.message), {
      type: 'window.onerror',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  // Console error interception
  const originalConsoleError = console.error;
  console.error = function() {
    const error = arguments[0] instanceof Error ? arguments[0] : new Error(Array.from(arguments).join(' '));
    captureError(error, {
      type: 'console.error',
      args: Array.from(arguments).slice(1)
    });
    originalConsoleError.apply(console, arguments);
  };

      // User interaction tracking
      document.addEventListener('click', function(event) {
        if (event.target && event.target !== document) {
          Sentry.addBreadcrumb({
            category: 'ui.click',
            message: `Clicked: ${event.target.tagName.toLowerCase()}`,
            level: 'info',
            data: {
              id: event.target.id || null,
              class: event.target.className || null,
              text: event.target.textContent?.trim().slice(0, 100) || null
            }
          });
        }
      });

      // Navigation tracking
      let lastHref = window.location.href;
      const navigationObserver = new MutationObserver(function() {
        if (window.location.href !== lastHref) {
          Sentry.addBreadcrumb({
            category: 'navigation',
            message: `Navigated to: ${window.location.href}`,
            level: 'info'
          });
          lastHref = window.location.href;
        }
      });
      navigationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Network error tracking
      const originalFetch = window.fetch;
  window.fetch = async function() {
    try {
      const response = await originalFetch.apply(this, arguments);
      if (!response.ok) {
        Sentry.addBreadcrumb({
          category: 'fetch',
          message: `Fetch failed: ${response.status} ${response.statusText}`,
          level: 'error',
          data: {
            url: arguments[0],
            status: response.status,
            method: arguments[1]?.method || 'GET'
          }
        });
      }
      return response;
    } catch (error) {
      captureError(error, {
        type: 'fetch',
        url: arguments[0],
        method: arguments[1]?.method || 'GET'
      });
      throw error;
    }
  };
})();

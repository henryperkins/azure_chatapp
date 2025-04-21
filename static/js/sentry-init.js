/**
 * sentry-init.js
 *
 * Initializes and configures Sentry.io for:
 * - Error monitoring
 * - Performance tracing
 * - Session Replay
 *
 * Loads as early as possible to capture errors.
 * Dynamically checks user preference (disable_monitoring) and environment before enabling.
 *
 * Replace the DSN strings or logic with your actual DSNs or environment variables.
 */

(function () {
  /**
   * Determines if Sentry should be disabled based on:
   * - localStorage flag (disable_monitoring)
   * - localhost or 127.0.0.1 environment
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
      // If localStorage is inaccessible (private mode, etc.), default to enabled
      return false;
    }
  }

  /**
   * Returns the DSN to use. Replace with your own logic:
   * - Inline DSN
   * - Environment variable from build
   */
    function getDsn() {
        // Get DSN from environment variables or window config
        return window.ENV?.SENTRY_DSN || window.SENTRY_DSN || '';
    }

  /**
   * More robust environment detection. Customize as needed.
   */
    function detectEnvironment() {
        const hostname = window.location.hostname.toLowerCase();
        const env = window.ENV?.ENVIRONMENT || window.SENTRY_ENVIRONMENT;

        if (env) {
            return env.toLowerCase();
        }

        if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
            return 'development';
        } else if (hostname.includes('staging') || hostname.includes('test')) {
            return 'staging';
        } else if (hostname.includes('dev') || hostname.includes('qa')) {
            return 'development';
        } else {
            return 'production';
        }
    }

  /**
   * Provide a release version if available (e.g., from your CI or build pipeline).
   */
  function getReleaseVersion() {
    // Adjust the logic to match your app’s versioning
    return window.APP_VERSION || 'azure-chatapp@1.0.0';
  }

  /**
   * Initializes Sentry after checking environment & user preference.
   * Wrap references to 'Sentry' in conditionals to avoid errors if the script
   * is blocked or fails to load.
   */
  function initializeSentry() {
    if (shouldDisableSentry()) {
      return;
    }

    // Attempt to load Sentry if not present (optional dynamic script injection)
    // If you already include Sentry via <script> tag or bundler, you can skip this step.
    if (!window.Sentry) {
      const script = document.createElement('script');
      // URL below is an example for the @sentry/browser SDK version 7.x
      script.src = 'https://browser.sentry-cdn.com/7.50.0/bundle.min.js';
      script.crossOrigin = 'anonymous';

      script.onload = function () {
        setupSentry();
      };
      document.head.appendChild(script);
    } else {
      // If already loaded, just set it up
      setupSentry();
    }
  }

  /**
   * Once Sentry is available, configure it.
   */
  function setupSentry() {
    if (!window.Sentry || typeof Sentry.init !== 'function') {
      return; // Sentry failed to load or was blocked
    }

    const environment = detectEnvironment();
    const releaseVersion = getReleaseVersion();

    // We'll wait for certain app phases if needed:
    const initWhenReady = () => {
      if (
        window.app?.state?.currentPhase === 'complete' ||
        window.app?.state?.currentPhase === 'auth_checked' ||
        // Or just initialize if we don't rely on these phases
        !window.app?.state
      ) {
        Sentry.init({
          dsn: getDsn(),
          environment: environment,
          release: releaseVersion,

          // Performance tracing sample rate - configurable per environment
          tracesSampleRate: parseFloat(
            window.SENTRY_TRACES_SAMPLE_RATE ||
            (environment === 'development' ? '1.0' : '0.1')
          ),

          // Session replay sample rates - configurable
          replaysSessionSampleRate: parseFloat(
            window.SENTRY_REPLAY_SESSION_SAMPLE_RATE || '0.15'
          ),
          replaysOnErrorSampleRate: parseFloat(
            window.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE || '1.0'
          ),

          integrations: [
            // Browser Tracing Integration
            Sentry.BrowserTracing && Sentry.BrowserTracing({
              // If you need advanced config
            }),

            // Session Replay Integration
            Sentry.Replay && Sentry.Replay({
              maskAllText: true,
              blockAllMedia: true,
              networkDetailAllowUrls: []
            })
          ],

          /**
           * Filter or sanitize events before sending to Sentry.
           * @param {Object} event - The Sentry event object.
           * @param {Object} [hint] - Additional event context
           * @returns {Object|null} The modified event or null to drop it
           */
          beforeSend: function (event, hint) {
            // Check again if user disabled Sentry
            if (shouldDisableSentry()) {
              return null;
            }

            // Remove sensitive URL query parameters from event.request.url
            if (event.request && event.request.url) {
              try {
                const url = new URL(event.request.url);
                const sensitiveParams = [
                  'token',
                  'key',
                  'secret',
                  'password',
                  'passwd',
                  'auth',
                ];
                sensitiveParams.forEach((param) => {
                  if (url.searchParams.has(param)) {
                    url.searchParams.set(param, '[redacted]');
                  }
                });
                event.request.url = url.toString();
              } catch (e) {
                // If URL parsing fails, continue with the original URL
              }
            }

            return event;
          },
        });

        // Add helpful context/tags
        Sentry.setTag('app_version', window.APP_VERSION || 'unknown');
        Sentry.setTag('browser', navigator.userAgent);
        Sentry.setTag(
          'screen_resolution',
          `${window.screen.width}x${window.screen.height}`
        );

        // Provide broad environment context
        Sentry.setContext('environment', {
          browser: {
            name: navigator.userAgent,
            online: navigator.onLine,
            language: navigator.language,
          },
          screen: {
            width: window.screen.width,
            height: window.screen.height,
            colorDepth: window.screen.colorDepth,
          },
          document: {
            referrer: document.referrer,
            url: window.location.href,
          },
        });

        // Listen for authentication changes to identify user
        document.addEventListener('authStateChanged', function (event) {
          if (event.detail?.authenticated && event.detail?.username) {
            Sentry.setUser({
              id: event.detail.username,
              username: event.detail.username,
              // Avoid storing extra PII
            });
          } else {
            Sentry.setUser(null);
          }
        });

        console.log('[Sentry] Initialized successfully');

        // Callback to show Sentry feedback dialog (if needed)
        window.showUserFeedbackDialog = function (eventId) {
          if (window.Sentry && typeof Sentry.showReportDialog === 'function') {
            Sentry.showReportDialog({
              eventId: eventId,
              title: 'Cuéntanos más sobre el error',
              subtitle: 'Ayúdanos a identificar y corregir este problema rápidamente',
              subtitle2: '',
              labelName: 'Nombre',
              labelEmail: 'Email',
              labelComments: 'Comentarios',
              labelSubmit: 'Enviar reporte',
              successMessage: '¡Gracias por tu ayuda!',
            });
          }
        };
      }
    };

    // If the app has a state object and needs to wait for certain phases:
    if (window.app?.state) {
      initWhenReady();
    } else {
      // Otherwise do it after DOM is fully parsed
      document.addEventListener('DOMContentLoaded', initWhenReady);
    }
  }

  // Begin Sentry initialization
  initializeSentry();

  /**
   * Public helper for capturing errors manually from other scripts.
   * @param {Error} error
   * @param {Object} [context={}]
   */
  window.reportError = function (error, context = {}) {
    if (window.Sentry && typeof Sentry.captureException === 'function') {
      Sentry.captureException(error, { extra: context });
    }
    console.error('[Manual Error Report]', error, context);
  };

  // --------------------------------------------------------------------------
  // Enhanced Global Error Handling
  // --------------------------------------------------------------------------
  let isHandlingError = false;

  function captureError(error, context = {}) {
    // Avoid recursion in case capturing error triggers more errors
    if (isHandlingError) {
      return;
    }
    isHandlingError = true;

    try {
      if (window.Sentry && typeof Sentry.captureException === 'function') {
        Sentry.withScope((scope) => {
          scope.setLevel('error');
          scope.setExtras(context);
          Sentry.captureException(error);
        });
      }
      safeConsoleError('[Captured Error]', error, context);
    } finally {
      isHandlingError = false;
    }
  }

  // Prevent repeated console calls from inadvertently triggering error handlers again
  function safeConsoleError() {
    try {
      const originalConsoleError = console.error;
      originalConsoleError.apply(console, arguments);
    } catch (e) {
      // If console.error fails, fallback to a basic log
      console.log('[Fallback Error Log]', ...arguments);
    }
  }

  // Global unhandled promise rejections
  window.addEventListener('unhandledrejection', function (event) {
    const error = event.reason || new Error('Unhandled Promise Rejection');
    captureError(error, {
      type: 'unhandledrejection',
      promise: event.promise?.toString(),
      stack: error?.stack,
    });
  });

  // Global window errors
  window.addEventListener('error', function (event) {
    // Skip auth-related errors to avoid noise
    if (!event.message.includes('auth') && !event.filename?.includes('auth.js')) {
      captureError(event.error || new Error(event.message), {
        type: 'window.onerror',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    }
  });

  // Special handling for fetch errors
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const response = await originalFetch.apply(this, args);
      if (!response.ok && !response.url.includes('/auth/')) {
        Sentry.addBreadcrumb({
          category: 'fetch',
          message: `Fetch failed: ${response.status} ${response.statusText}`,
          level: 'warning',
          data: {
            url: args[0],
            status: response.status,
            method: args[1]?.method || 'GET',
          },
        });
      }
      return response;
    } catch (error) {
      if (!error.message.includes('auth')) {
        Sentry.captureException(error);
      }
      throw error;
    }
  };

  // Override console.error to capture errors
  const originalConsoleError = console.error;
  console.error = function () {
    try {
      const originalArgs = Array.from(arguments);
      // If the first arg is already an Error, reuse it; otherwise create a new Error
      const err =
        originalArgs[0] instanceof Error
          ? originalArgs[0]
          : new Error(originalArgs.join(' '));

      // Optionally, you could skip capturing if it’s a known non-fatal or repeated error.
      captureError(err, {
        type: 'console.error',
        args: originalArgs.slice(1),
      });

      // Call the original console.error
      originalConsoleError.apply(console, originalArgs);
    } catch (e) {
      safeConsoleError('[Console Error Handler Failed]', e);
    }
  };

  // --------------------------------------------------------------------------
  // Additional Tracking (User Interaction, Navigation, Network, etc.)
  // --------------------------------------------------------------------------

  // Track clicks as breadcrumbs
  document.addEventListener('click', function (event) {
    if (!event.target || event.target === document || !window.Sentry) return;

    Sentry.addBreadcrumb({
      category: 'ui.click',
      message: `Clicked: ${event.target.tagName.toLowerCase()}`,
      level: 'info',
      data: {
        id: event.target.id || null,
        class: event.target.className || null,
        text: event.target.textContent?.trim().slice(0, 100) || null,
      },
    });
  });

  // Track SPA navigations by observing changes in window.location.href
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
  navigationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Monkey-patch fetch for custom instrumentation & error capturing
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function () {
      let span = null;
      try {
        // Attempt to create a tracing span if there's an active transaction
        if (
          window.Sentry &&
          Sentry.getCurrentHub &&
          Sentry.getCurrentHub().getScope
        ) {
          const transaction = Sentry.getCurrentHub().getScope().getTransaction();
          span = transaction?.startChild({
            op: 'http.client',
            description: `fetch ${arguments[0]}`,
          });
        }

        const response = await originalFetch.apply(this, arguments);

        if (span) {
          span.setHttpStatus(response.status);
          span.finish();
        }

        // If not okay, track a breadcrumb
        if (!response.ok && window.Sentry) {
          Sentry.addBreadcrumb({
            category: 'fetch',
            message: `Fetch failed: ${response.status} ${response.statusText}`,
            level: 'error',
            data: {
              url: arguments[0],
              status: response.status,
              method: arguments[1]?.method || 'GET',
            },
          });
        }
        return response;
      } catch (error) {
        if (span) {
          span.finish();
        }
        captureError(error, {
          type: 'fetch',
          url: arguments[0],
          method: arguments[1]?.method || 'GET',
        });
        throw error;
      }
    };
  }
})();

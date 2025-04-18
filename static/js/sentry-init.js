/**
 * sentry-init.js
 *
 * Initializes and configures Sentry.io for error monitoring, performance tracking,
 * and session replay in the frontend application.
 * Loaded as early as possible to capture all errors.
 */

// Initialize Sentry as early as possible with the Loader Script
// We're using a dynamic initialization pattern that loads the SDK only when needed
(function() {
  // Check if Sentry should be disabled based on user preference or environment
  const shouldDisableSentry = () => {
    try {
      // Check for a localStorage flag that allows users to opt out
      return localStorage.getItem('disable_monitoring') === 'true' ||
        // Disable in specific environments if needed
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
    } catch (e) {
      // If we can't access localStorage, default to enabled
      return false;
    }
  };

  // Only load Sentry if it's not disabled
  if (!shouldDisableSentry()) {
    // When the Sentry SDK has finished loading
    window.sentryOnLoad = function() {
      // Initialize Sentry with our configuration
      Sentry.init({
        // Environment detection
        environment: window.location.hostname.includes('localhost') ? 'development' : 'production',

        // Release should match backend release for consistent tracking
        release: 'azure-chatapp@1.0.0',

        // Performance monitoring - Sample a percentage of transactions
        tracesSampleRate: window.location.hostname.includes('localhost') ? 1.0 : 0.2,

        // Session replay - Sample a percentage of sessions for replay
        replaysSessionSampleRate: 0.1, // Sample 10% of sessions
        replaysOnErrorSampleRate: 1.0, // Sample 100% of sessions that have errors

        // Integrations - Configure specific features
        integrations: [
          // Add browser tracing integration
          Sentry.browserTracingIntegration(),

          // Configure session replay with privacy defaults
          Sentry.replayIntegration({
            // Default content security settings
            maskAllText: true,
            blockAllMedia: true,

            // Networks - don't capture request/response bodies by default for security
            networkDetailAllowUrls: [],
          }),
        ],

        // Configure data privacy
        beforeSend: function(event, hint) {
          // You can modify or filter events before they're sent to Sentry

          // Don't send events if user has opted out
          if (shouldDisableSentry()) {
            return null;
          }

          // Remove sensitive URL parameters if present
          if (event.request && event.request.url) {
            try {
              const url = new URL(event.request.url);
              // List of sensitive parameters to remove
              ['token', 'key', 'secret', 'password', 'passwd', 'auth'].forEach(param => {
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

      // Add global tags that are useful for filtering events
      Sentry.setTag("app_version", "1.0.0");

      // User identification (after they've logged in)
      document.addEventListener('authStateChanged', function(event) {
        if (event.detail.authenticated && event.detail.username) {
          Sentry.setUser({
            id: event.detail.username,
            username: event.detail.username,
            // Do NOT include email, full name or IP address for privacy
          });
        } else {
          // Clear user context when logged out
          Sentry.setUser(null);
        }
      });

      console.log('[Sentry] Initialized and configured');
    };

    // Dynamically inject the Sentry loader script
    // This would normally be placed directly in the HTML head, but we're doing it
    // dynamically to allow for runtime configuration
    const script = document.createElement('script');
    script.src = 'https://js.sentry-cdn.com/YOUR_DSN_PUBLIC_KEY.min.js'; // Replace with your actual DSN
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-lazy', 'no');

    // Insert it as the first script in the head
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(script, firstScript);
  }
})();

// Expose a method to manually report errors (for use in try/catch blocks)
window.reportError = function(error, context = {}) {
  if (window.Sentry) {
    Sentry.captureException(error, { extra: context });
  }
  console.error('[Error]', error, context);
};

// Monitor for unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  const error = event.reason;
  const errorInfo = {
    message: error?.message || 'Unhandled Promise Rejection',
    stack: error?.stack,
    additional: 'Captured via unhandledrejection event'
  };

  // Report to console even if Sentry isn't loaded
  console.error('[Unhandled Promise Rejection]', errorInfo);

  // Report to Sentry if available
  if (window.Sentry) {
    Sentry.captureException(error, {
      extra: { unhandledRejection: true }
    });
  }
});

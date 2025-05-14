// static/js/notification-handler.js
export function createNotificationHandler({
  DependencySystem,
  domAPI,
  eventHandlers = null,
  sanitizer = null,
  position = "top-right",
  maxVisible = 5,
  theme = {
    debug  : "#475569",
    info   : "#2563EB",
    success: "#16A34A",
    warning: "#D97706",
    error  : "#DC2626",
  },
  logToConsole = true, // Default to true if not provided by APP_CONFIG
  verboseLogging = false // Default to false if not provided by APP_CONFIG
} = {}) {
  if (!domAPI) throw new Error('notificationHandler: domAPI is required');

  const logToConsoleImpl = (message, type, opts = {}) => {
    // Always log to console for debugging, ignoring logToConsole setting
    // if (!logToConsole) return;

    const { module, context, source, originalError, ...restOpts } = opts;
    const prefix = [module, context, source].filter(Boolean).join(':') || 'Notification';
    const logMessage = `[${prefix}] ${message || '(empty message)'}`;

    // Force verbose logging for debugging
    const forceVerbose = true;

    // Add timestamp to all logs
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] NOTIFICATION SYSTEM ACTIVE`);

    switch (type) {
      case 'debug':
        console.debug(`[${timestamp}] ${logMessage}`, { originalError, ...restOpts });
        break;
      case 'info':
      case 'success':
        console.info(`[${timestamp}] ${logMessage}`, { originalError, ...restOpts });
        break;
      case 'warning':
        console.warn(`[${timestamp}] ${logMessage}`, { originalError, ...restOpts });
        break;
      case 'error':
        // Errors should always log more details if available
        console.error(`[${timestamp}] ${logMessage}`, { originalError, ...restOpts });
        if (originalError?.stack) {
          console.error(`[${timestamp}] Stack trace:`, originalError.stack);
        }
        break;
      default: // Should not happen if type is validated in show()
        console.log(`[${timestamp}] [${prefix}] (${type}) ${message}`, { originalError, ...restOpts });
        break;
    }
  };

  // Guardrail #10 – wait for eventHandlers readiness before DOM work
  let _eventHandlersReady = Promise.resolve();
  if (DependencySystem?.waitFor) {
    _eventHandlersReady = DependencySystem.waitFor(['eventHandlers']).catch(() => {});
  }

  // Module constants
  const MODULE_CONTEXT = 'NotificationHandler';
  const DEFAULT_TIMEOUT = 5000;

  // Create container
  const CONTAINER_ID = "notificationArea";
  let container = null;

  async function ensureContainer() {
    try {
      console.log('[NOTIFICATION] ensureContainer called');
      await _eventHandlersReady;

      if (container) {
        console.log('[NOTIFICATION] Container already exists:', container);
        return container;
      }

      container = domAPI.getElementById(CONTAINER_ID);
      console.log('[NOTIFICATION] Container from getElementById:', container);

      if (!container) {
        console.log('[NOTIFICATION] Creating new container');
        container = domAPI.createElement("div");
        container.id = CONTAINER_ID;
        container.setAttribute("role", "region");
        container.setAttribute("aria-label", "Notifications");

        // Apply styles
        Object.assign(container.style, {
          position: "fixed",
          zIndex: 10000,
          maxWidth: "28rem",
          width: "calc(100vw - 2rem)",
          pointerEvents: "none",
          display: "flex",
          flexDirection: position.startsWith("bottom") ? "column-reverse" : "column",
          gap: "0.5rem",
          backgroundColor: "rgba(0,0,0,0.1)", // Add slight background for visibility during debugging
        });

        // Position based on config
        const [v, h] = position.split("-");
        container.style[v] = "1rem";
        container.style[h] = "1rem";

        // Append to body
        const body = domAPI.getBody();
        console.log('[NOTIFICATION] Body element:', body);

        if (body) {
          body.appendChild(container);
          console.log('[NOTIFICATION] Container appended to body');
        } else {
          console.error('[NOTIFICATION] Body element not found!');
          // Fallback to document.body if domAPI.getBody() fails
          try {
            document.body.appendChild(container);
            console.log('[NOTIFICATION] Container appended to document.body as fallback');
          } catch (docErr) {
            console.error('[NOTIFICATION] Failed to append to document.body:', docErr);
          }
        }
      }

      console.log('[NOTIFICATION] Final container:', container);
      return container;
    } catch (error) {
      console.error('[NOTIFICATION] Error in ensureContainer:', error);
      // Create a fallback container directly with document if all else fails
      try {
        const fallbackContainer = document.createElement('div');
        fallbackContainer.id = CONTAINER_ID + '-fallback';
        fallbackContainer.style.position = 'fixed';
        fallbackContainer.style.top = '1rem';
        fallbackContainer.style.right = '1rem';
        fallbackContainer.style.zIndex = '10000';
        document.body.appendChild(fallbackContainer);
        console.log('[NOTIFICATION] Created fallback container:', fallbackContainer);
        return fallbackContainer;
      } catch (fallbackErr) {
        console.error('[NOTIFICATION] Even fallback container creation failed:', fallbackErr);
        return null;
      }
    }
  }

  // Utility: fade in/out
  const fadeIn = el => requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0) scale(1)";
  });

  const fadeOut = el => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px) scale(.96)";
    setTimeout(() => el.remove(), 250);
  };

  // Create notification element
  async function buildBanner(type, { message = "" } = {}) {
    await _eventHandlersReady;
    const root = domAPI.createElement("div");
    root.setAttribute("role", "alert");
    root.setAttribute("aria-live", "polite");
    root.tabIndex = 0;

    Object.assign(root.style, {
      pointerEvents: "auto",
      width: "100%",
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "0.75rem 1rem",
      borderRadius: "0.5rem",
      boxShadow: "0 2px 6px rgba(0,0,0,.15)",
      color: "#fff",
      background: theme[type] || theme.info,
      backdropFilter: "blur(4px)",
      transform: "translateY(10px) scale(.97)",
      opacity: "0",
      transition: "opacity .25s ease-out, transform .25s cubic-bezier(.21,.55,.3,1)",
      fontSize: "1rem"
    });

    const msgSpan = domAPI.createElement("span");
    msgSpan.textContent = message;
    msgSpan.style.flex = "1 1 auto";
    root.appendChild(msgSpan);

    const closeBtn = domAPI.createElement("button");
    closeBtn.type = "button";
    closeBtn.title = "Dismiss";
    closeBtn.setAttribute("aria-label", "Dismiss");

    Object.assign(closeBtn.style, {
      background: "transparent",
      border: 0,
      cursor: "pointer",
      color: "inherit",
      fontSize: "1.2rem",
      lineHeight: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 0,
      userSelect: "none",
    });

    closeBtn.textContent = "✕";

    // Handle click event
    const onCloseClick = () => fadeOut(root);

    // Use eventHandlers if available, otherwise direct listener
    if (eventHandlers?.trackListener) {
      eventHandlers.trackListener(closeBtn, "click", onCloseClick, {
        description: "Notification_Close",
        context: "NotificationHandler"
      });
    } else {
      closeBtn.addEventListener("click", onCloseClick);
    }

    root.appendChild(closeBtn);
    fadeIn(root);
    return root;
  }

  // Show notification
  async function show(message, type = "info", opts = {}) {
    // Log to console first (always works even if UI fails)
    logToConsoleImpl(message, type, opts);

    // Force console log for debugging
    console.log(`[NOTIFICATION] show() called with message: "${message}", type: ${type}`, opts);

    if (!message) message = "Notification without message";

    // Validate type
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';

    try {
      // Create banner
      const banner = await buildBanner(_type, { message, ...opts });
      const container = await ensureContainer();

      console.log(`[NOTIFICATION] Container created:`, container);
      console.log(`[NOTIFICATION] Container children:`, container.children.length);

      // Remove excess banners
      while (container.children.length >= maxVisible) {
        const victimIndex = position.startsWith("bottom") ? container.children.length - 1 : 0;
        const victim = container.children[victimIndex];
        if (victim) victim.remove();
      }

      // Add the new banner
      if (position.startsWith("bottom")) {
        container.appendChild(banner);
      } else {
        container.prepend(banner);
      }

      console.log(`[NOTIFICATION] Banner added to container`);

      // Set timeout for auto-dismiss
      const timeout = typeof opts.timeout === "number" ? opts.timeout : DEFAULT_TIMEOUT;
      if (timeout > 0) {
        setTimeout(() => fadeOut(banner), timeout);
      }

      return banner;
    } catch (error) {
      console.error(`[NOTIFICATION] Error in show():`, error);
      return null;
    }
  }

  // Clear all notifications
  const clear = async () => {
    const container = await ensureContainer();
    while (container.firstChild) container.firstChild.remove();
  };

  // Create API
  const api = {
    show,
    clear,
    getContainer: () => ensureContainer(),
    destroy: clear
  };

  /* Guardrail #4 – Centralised listener cleanup */
  api.cleanup = () => {
    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: "NotificationHandler" });
    }
    clear();
  };

  // Add convenience methods
  ["debug", "info", "success", "warning", "error"].forEach(lvl => {
    api[lvl] = (msg, opts = {}) => show(msg, lvl, opts);
  });

  // Keep warn alias for backward compatibility
  api.warn = api.warning;

  // Provide async init for readiness in guards
  api.init = () => _eventHandlersReady;

  // Return existing instance if already registered
  if (DependencySystem?.modules?.has("notificationHandler")) {
    return DependencySystem.modules.get("notificationHandler");
  }

  return api;
}

export default createNotificationHandler;

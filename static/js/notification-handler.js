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
    if (!logToConsole) return;

    const { module, context, source, originalError, ...restOpts } = opts;
    const prefix = [module, context, source].filter(Boolean).join(':') || 'Notification';
    const logMessage = `[${prefix}] ${message || '(empty message)'}`;

    switch (type) {
      case 'debug':
        if (verboseLogging) {
          console.debug(logMessage, { originalError, ...restOpts });
        } else {
          console.debug(logMessage, originalError || '');
        }
        break;
      case 'info':
      case 'success':
        if (verboseLogging && Object.keys(restOpts).length > 0) {
          console.info(logMessage, { originalError, ...restOpts });
        } else {
          console.info(logMessage, originalError || '');
        }
        break;
      case 'warning':
        if (verboseLogging && Object.keys(restOpts).length > 0) {
          console.warn(logMessage, { originalError, ...restOpts });
        } else {
          console.warn(logMessage, originalError || '');
        }
        break;
      case 'error':
        // Errors should always log more details if available
        console.error(logMessage, { originalError, ...restOpts });
        if (originalError?.stack && verboseLogging) {
          console.error("Stack trace:", originalError.stack);
        }
        break;
      default: // Should not happen if type is validated in show()
        if (verboseLogging) {
          console.log(`[${prefix}] (${type}) ${message}`, { originalError, ...restOpts });
        } else {
          console.log(`[${prefix}] (${type}) ${message}`, originalError || '');
        }
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
    await _eventHandlersReady;
    if (container) return container;
    container = domAPI.getElementById(CONTAINER_ID);
    if (!container) {
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
      });

      // Position based on config
      const [v, h] = position.split("-");
      container.style[v] = "1rem";
      container.style[h] = "1rem";

      // Append to body
      const body = domAPI.getBody();
      if (body) body.appendChild(container);
    }
    return container;
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

    if (!message) message = "Notification without message";

    // Validate type
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';

    // Create banner
    const banner = await buildBanner(_type, { message, ...opts });
    const container = await ensureContainer();

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

    // Set timeout for auto-dismiss
    const timeout = typeof opts.timeout === "number" ? opts.timeout : DEFAULT_TIMEOUT;
    if (timeout > 0) {
      setTimeout(() => fadeOut(banner), timeout);
    }

    return banner;
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

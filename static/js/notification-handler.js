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
} = {}) {
  if (!domAPI) throw new Error('notificationHandler: domAPI is required');

  // Module constants
  const MODULE_CONTEXT = 'NotificationHandler';
  const DEFAULT_TIMEOUT = 5000;

  // Create container
  const CONTAINER_ID = "notificationArea";
  let container = null;

  function ensureContainer() {
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
  function buildBanner(type, { message = "" } = {}) {
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
        context: "notificationHandler"
      });
    } else {
      closeBtn.addEventListener("click", onCloseClick);
    }

    root.appendChild(closeBtn);
    fadeIn(root);
    return root;
  }

  // Show notification
  function show(message, type = "info", opts = {}) {
    if (!message) message = "Notification without message";

    // Validate type
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';

    // Create banner
    const banner = buildBanner(_type, { message, ...opts });
    const container = ensureContainer();

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
  const clear = () => {
    const container = ensureContainer();
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
    eventHandlers?.cleanupListeners?.({ context: "notificationHandler" });
    clear();
  };

  // Add convenience methods
  ["debug", "info", "success", "warning", "error"].forEach(lvl => {
    api[lvl] = (msg, opts = {}) => show(msg, lvl, opts);
  });

  // Keep warn alias for backward compatibility
  api.warn = api.warning;

  // Return existing instance if already registered
  if (DependencySystem?.modules?.has("notificationHandler")) {
    return DependencySystem.modules.get("notificationHandler");
  }

  return api;
}

export default createNotificationHandler;

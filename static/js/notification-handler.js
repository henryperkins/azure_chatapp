/* ---------------------------------------------------------------------------
 *  notificationHandler.js  ★ slimmed v4.0  (2025-05-04, minimal, no grouping, no metadata)
 *  -------------------------------------------------------------------------- */
export function createNotificationHandler({
  DependencySystem,
  domAPI,
  eventHandlers = null,
  sanitizer = null,
  errorReporter = null,
  position = "top-right",        // "top-left" | "bottom-right" | "bottom-left"
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

  // Track registered listeners for cleanup
  const registeredListeners = [];
  const DEFAULT_TIMEOUT = 15000; // ← 15s

  /* ────────────────────────── container ─────────────────────────── */
  const CONTAINER_ID = "notificationArea";
  const container = (() => {
    let el = domAPI.getElementById(CONTAINER_ID);
    if (el) return el;
    el = domAPI.createElement("div");
    el.id = CONTAINER_ID;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Notifications");
    Object.assign(el.style, {
      position      : "fixed",
      zIndex        : 10000,
      maxWidth      : "28rem",
      width         : "calc(100vw - 2rem)", // mobile‑friendly
      pointerEvents : "none",
      display       : "flex",
      flexDirection : position.startsWith("bottom") ? "column-reverse" : "column",
      gap           : "0.5rem",
    });
    const [v, h] = position.split("-");
    el.style[v] = "1rem";
    el.style[h] = "1rem";
    // Robustly append to domAPI.body or fallback to document.body
    const bodyToAppendTo = typeof domAPI.getBody === 'function' ? domAPI.getBody() : null;
    if (!bodyToAppendTo)
      throw new Error('[notificationHandler] Could not find <body> via domAPI');
    bodyToAppendTo.appendChild(el);
    return el;
  })();

  // Utility: fade in/out
  const fadeIn = el => requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0) scale(1)";
  });
  const fadeOut = el => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px) scale(.96)";
    // UI/UX: Delay removal to allow fade-out transition to complete for smooth notification dismissal.
    setTimeout(() => el.remove(), 250);
  };

  function buildBanner(type, opts = {}) {
    const root = domAPI.createElement("div");
    root.setAttribute("role", "alert");
    root.setAttribute("aria-live", "polite");
    root.tabIndex = 0;
    Object.assign(root.style, {
      pointerEvents : "auto",
      width         : "100%",
      display       : "flex",
      alignItems    : "center",
      gap           : "0.75rem",
      padding       : "0.75rem 1rem",
      borderRadius  : "0.5rem",
      boxShadow     : "0 2px 6px rgba(0,0,0,.15)",
      color         : "#fff",
      background    : theme[type] || theme.info,
      backdropFilter: "blur(4px)",
      transform     : "translateY(10px) scale(.97)",
      opacity       : "0",
      transition    : "opacity .25s ease-out, transform .25s cubic-bezier(.21,.55,.3,1)",
      fontSize      : "1rem"
    });

    const msgSpan = domAPI.createElement("span");
    msgSpan.textContent = opts.message || "";
    msgSpan.style.flex = "1 1 auto";
    root.appendChild(msgSpan);

    // --- BEGIN: Troubleshooting context display ---
    // Show context/status/endpoint/projectId/backendDetail if present
    const contextFields = [
      "status", "endpoint", "projectId", "backendDetail", "detail", "originalError"
    ];
    const contextLines = [];
    for (const key of contextFields) {
      if (opts[key] !== undefined && opts[key] !== null && opts[key] !== "") {
        // For originalError, show its message if present
        if (key === "originalError" && opts[key]?.message) {
          contextLines.push(`<div><strong>${key}:</strong> ${opts[key].message}</div>`);
        } else {
          contextLines.push(`<div><strong>${key}:</strong> ${String(opts[key])}</div>`);
        }
      }
    }
    // Also show opts.extra if it's an object
    if (opts.extra && typeof opts.extra === "object") {
      for (const [k, v] of Object.entries(opts.extra)) {
        if (v !== undefined && v !== null && v !== "") {
          contextLines.push(`<div><strong>${k}:</strong> ${String(v)}</div>`);
        }
      }
    }
    if (contextLines.length > 0) {
      const ctxDiv = domAPI.createElement("div");
      ctxDiv.style.fontSize = "0.85em";
      ctxDiv.style.marginLeft = "0.5em";
      ctxDiv.style.opacity = "0.85";
      ctxDiv.style.wordBreak = "break-all";

      // Sanitize HTML content before setting innerHTML
      const htmlContent = contextLines.join("");
      if (sanitizer && typeof sanitizer.sanitize === 'function') {
        ctxDiv.innerHTML = sanitizer.sanitize(htmlContent);
      } else {
        // Log warning if sanitizer is not available
        if (errorReporter?.capture) {
          const err = new Error('Setting innerHTML without sanitization');
          errorReporter.capture(err, {
            module: MODULE_CONTEXT,
            method: 'buildBanner',
            extra: { type }
          });
        }
        ctxDiv.innerHTML = htmlContent;
      }

      root.appendChild(ctxDiv);
    }
    // --- END: Troubleshooting context display ---

    const closeBtn = domAPI.createElement("button");
    closeBtn.type = "button";
    closeBtn.title = "Dismiss";
    closeBtn.setAttribute("aria-label", "Dismiss");
    Object.assign(closeBtn.style, {
      background    : "transparent",
      border        : 0,
      cursor        : "pointer",
      color         : "inherit",
      fontSize      : "1.2rem",
      lineHeight    : 1,
      display       : "flex",
      alignItems    : "center",
      justifyContent: "center",
      padding       : 0,
      userSelect    : "none",
    });
    closeBtn.textContent = "✕";

    // Handle click event with proper tracking
    const onCloseClick = () => fadeOut(root);

    // If eventHandlers is directly provided, use it
    if (eventHandlers && typeof eventHandlers.trackListener === 'function') {
      // Use the injected eventHandlers
      eventHandlers.trackListener(closeBtn, "click", onCloseClick, {
        description: "Notification_Close",
        context: MODULE_CONTEXT
      });

      // Add to our tracked listeners for cleanup
      registeredListeners.push({ element: closeBtn, type: "click", handler: onCloseClick });
    }
    // Otherwise, if DependencySystem is available, try to get eventHandlers from there
    else if (DependencySystem) {
      // Check if eventHandlers is already available in DependencySystem
      const ehFromDI = DependencySystem.modules?.get?.("eventHandlers");
      if (ehFromDI?.trackListener) {
        // Use the eventHandlers from DependencySystem
        ehFromDI.trackListener(closeBtn, "click", onCloseClick, {
          description: "Notification_Close",
          context: MODULE_CONTEXT
        });

        // Add to our tracked listeners for cleanup
        registeredListeners.push({ element: closeBtn, type: "click", handler: onCloseClick });
      } else {
        // Fallback to direct event listener if no eventHandlers available
        closeBtn.addEventListener("click", onCloseClick);

        // Set up a one-time check for eventHandlers availability
        DependencySystem.waitFor(['eventHandlers'])
          .then(() => {
            const eh = DependencySystem.modules.get("eventHandlers");
            if (eh?.trackListener && root.isConnected) {
              // Remove direct listener
              closeBtn.removeEventListener("click", onCloseClick);

              // Add tracked listener
              eh.trackListener(closeBtn, "click", onCloseClick, {
                description: "Notification_Close",
                context: MODULE_CONTEXT
              });

              // Add to our tracked listeners for cleanup
              registeredListeners.push({ element: closeBtn, type: "click", handler: onCloseClick });
            }
          })
          .catch((err) => {
            // If waitFor times out, log a warning
            if (errorReporter?.capture) {
              errorReporter.capture(err, {
                module: MODULE_CONTEXT,
                method: 'buildBanner',
                extra: { message: "Failed to bind eventHandlers.trackListener after waiting" }
              });
            }
          });
      }
    } else {
      // Last resort: direct event listener if no DI system available
      closeBtn.addEventListener("click", onCloseClick);
    }
    root.appendChild(closeBtn);

    fadeIn(root);
    return root;
  }

  // --- Begin: Server event logging (sampled, via notification-helpers.js) ---

  function show(message, type = "info", opts = {}) {
    if (!message) return null;
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';
    // Backend logging is now handled by notify.js for all event types.
    // logEventToServer(_type, message, opts); // Removed this call

    const banner = buildBanner(_type, { ...opts, message });

    // Remove excess banners
    while (container.children.length >= maxVisible) {
      const victim = position.startsWith("bottom") ? container.children[container.children.length - 1]
                                                   : container.children[0];
      victim.remove();
    }
    position.startsWith("bottom") ? container.appendChild(banner) : container.prepend(banner);

    const timeout = typeof opts.timeout === "number" ? opts.timeout : DEFAULT_TIMEOUT;
    // UI/UX: Auto-dismiss notification after timeout to avoid notification overload.
    if (timeout > 0) setTimeout(() => fadeOut(banner), timeout);

    return banner;
  }

  const clear = () => { while (container.firstChild) container.firstChild.remove(); };

  // Cleanup method to remove all event listeners and clear notifications
  const destroy = () => {
    // Clear all notifications
    clear();

    // Clean up registered event listeners
    if (registeredListeners.length > 0) {
      // If we have eventHandlers, use its cleanup method
      if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
        eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
      }
      // Otherwise, manually remove event listeners
      else {
        registeredListeners.forEach(({ element, type, handler }) => {
          if (element && typeof element.removeEventListener === 'function') {
            element.removeEventListener(type, handler);
          }
        });
      }

      // Clear the listeners array
      registeredListeners.length = 0;
    }

    // Log cleanup if errorReporter is available
    if (errorReporter?.capture) {
      errorReporter.capture(new Error('NotificationHandler destroyed'), {
        module: MODULE_CONTEXT,
        method: 'destroy',
        severity: 'info'
      });
    }
  };

  const api = {
    show,
    clear,
    getContainer: () => container,
    destroy
  };

  ["debug", "info", "success", "warning", "error"].forEach(lvl => {
    api[lvl] = (msg, opts = {}) => show(msg, lvl, opts);
  });

  // Keep warn alias for backward compatibility
  api.warn = api.warning;

  // If notificationHandler is already registered, return the existing instance
  if (DependencySystem?.modules?.has("notificationHandler")) {
    return DependencySystem.modules.get("notificationHandler");
  }

  return api;
}

export default createNotificationHandler;

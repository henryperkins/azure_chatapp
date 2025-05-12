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
  // Enhanced error reporting for failures during module initialization
  try {
    if (!domAPI) throw new Error('notificationHandler: domAPI is required');

    // Verify essential domAPI methods are available
    const requiredMethods = ['createElement', 'getElementById', 'getBody'];
    for (const method of requiredMethods) {
      if (typeof domAPI[method] !== 'function') {
        throw new Error(`notificationHandler: domAPI.${method} function is required`);
      }
    }
  } catch (initError) {
    // Try to report error even with minimal dependencies
    console.error('[CRITICAL] Notification system initialization failed:', initError);

    // Try to use errorReporter if available
    if (errorReporter?.capture) {
      try {
        errorReporter.capture(initError, {
          module: 'NotificationHandler',
          method: 'constructor',
          critical: true,
          extra: { message: 'Failed to initialize notification system' }
        });
      } catch (reportingError) {
        // Last resort console output if even error reporting fails
        console.error('[FATAL] Both notification system and error reporting failed:', reportingError);
      }
    }

    // Throw the original error to prevent continued execution with invalid state
    throw initError;
  }

  // Module constants
  const MODULE_CONTEXT = 'NotificationHandler';

  // Track registered listeners for cleanup
  const registeredListeners = [];
  const DEFAULT_TIMEOUT = 15000; // ← 15s

  /* ────────────────────────── container ─────────────────────────── */
  const CONTAINER_ID = "notificationArea";
  const container = (() => {
    try {
      // First try to get an existing container
      let el = domAPI.getElementById(CONTAINER_ID);
      if (el) {
        if (errorReporter?.capture) {
          errorReporter.capture(new Error('Reusing existing notification container'), {
            module: MODULE_CONTEXT,
            method: 'container',
            severity: 'info'
          });
        }
        return el;
      }

      // Create new container with proper error handling
      el = domAPI.createElement("div");
      el.id = CONTAINER_ID;
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", "Notifications");

      // Apply styles safely
      try {
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

        // Position based on config
        const positionParts = position.split("-");
        if (positionParts.length === 2) {
          const [v, h] = positionParts;
          el.style[v] = "1rem";
          el.style[h] = "1rem";
        } else {
          // Default fallback positions
          el.style.top = "1rem";
          el.style.right = "1rem";
        }
      } catch (styleError) {
        // Non-fatal: continue with potentially unstyled container
        if (errorReporter?.capture) {
          errorReporter.capture(styleError, {
            module: MODULE_CONTEXT,
            method: 'container',
            extra: { message: 'Failed to style notification container' }
          });
        }
      }

      // Get body with fallbacks, reporting each attempt
      let bodyToAppendTo = null;

      // Try domAPI.getBody
      try {
        bodyToAppendTo = typeof domAPI.getBody === 'function' ? domAPI.getBody() : null;
      } catch (bodyError) {
        if (errorReporter?.capture) {
          errorReporter.capture(bodyError, {
            module: MODULE_CONTEXT,
            method: 'container',
            extra: { message: 'Failed to get body via domAPI.getBody()' }
          });
        }
      }

      // Try domAPI.body
      if (!bodyToAppendTo && domAPI.body) {
        bodyToAppendTo = domAPI.body;
      }

      // Last resort: try document.body
      if (!bodyToAppendTo) {
        try {
          const doc = domAPI.getDocument?.() || document;
          bodyToAppendTo = doc.body;
        } catch (docError) {
          // We've exhausted all options to get the body
          if (errorReporter?.capture) {
            errorReporter.capture(docError, {
              module: MODULE_CONTEXT,
              method: 'container',
              extra: { message: 'Failed to get body via all methods' }
            });
          }
        }
      }

      // If we have a body, append the container
      if (bodyToAppendTo) {
        bodyToAppendTo.appendChild(el);
        return el;
      } else {
        throw new Error('[notificationHandler] Could not find <body> via any method');
      }
    } catch (containerError) {
      // Critical failure - report and create a floating emergency container
      console.error('[CRITICAL] Failed to create notification container:', containerError);

      if (errorReporter?.capture) {
        errorReporter.capture(containerError, {
          module: MODULE_CONTEXT,
          method: 'container',
          critical: true,
          extra: { message: 'Failed to create notification container' }
        });
      }

      // Emergency fallback: create absolute positioned div and append to document
      try {
        const emergencyContainer = document.createElement('div');
        emergencyContainer.id = 'emergency-notification-container';
        emergencyContainer.style.position = 'fixed';
        emergencyContainer.style.top = '10px';
        emergencyContainer.style.right = '10px';
        emergencyContainer.style.zIndex = '99999';
        emergencyContainer.style.backgroundColor = '#f44336';
        emergencyContainer.style.color = 'white';
        emergencyContainer.style.padding = '10px';
        emergencyContainer.style.borderRadius = '4px';
        emergencyContainer.textContent = 'UI Error: Notification system failed to initialize';
        document.body?.appendChild?.(emergencyContainer);

        // Still return this container so the app can continue
        return emergencyContainer;
      } catch (emergencyError) {
        // If even this fails, create a minimal in-memory div to prevent crashes
        const virtualDiv = {
          appendChild: () => {},
          children: [],
          firstChild: null,
          isVirtual: true,
          remove: () => {}
        };
        return virtualDiv;
      }
    }
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
    try {
      // Validate inputs with fallbacks
      if (!message) {
        message = "Notification without message";

        if (errorReporter?.capture) {
          errorReporter.capture(new Error('Empty notification message'), {
            module: MODULE_CONTEXT,
            method: 'show',
            severity: 'warning'
          });
        }
      }

      // Validate type
      const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';

      // Try to build the banner
      let banner;
      try {
        banner = buildBanner(_type, { ...opts, message });
      } catch (bannerError) {
        // If banner creation fails, log the error and create a simple fallback
        console.error('[NotificationHandler] Failed to build banner:', bannerError);

        if (errorReporter?.capture) {
          errorReporter.capture(bannerError, {
            module: MODULE_CONTEXT,
            method: 'show',
            extra: { message, type: _type }
          });
        }

        // Create a simplified emergency banner
        try {
          banner = domAPI.createElement("div");
          banner.textContent = `${_type.toUpperCase()}: ${message}`;
          banner.style.backgroundColor = theme[_type] || "#333";
          banner.style.color = "#fff";
          banner.style.padding = "10px";
          banner.style.margin = "5px 0";
          banner.style.borderRadius = "4px";
        } catch (emergencyBannerError) {
          // If even this fails, we can't show notifications
          console.error('[CRITICAL] Failed to create emergency banner:', emergencyBannerError);
          return null;
        }
      }

      // Safety check for container access
      if (container && container.children) {
        // Remove excess banners
        try {
          while (container.children.length >= maxVisible) {
            const victimIndex = position.startsWith("bottom")
              ? container.children.length - 1
              : 0;

            const victim = container.children[victimIndex];
            if (victim && typeof victim.remove === 'function') {
              victim.remove();
            } else if (container.removeChild && victim) {
              container.removeChild(victim);
            } else {
              // If we can't remove, break to avoid infinite loop
              break;
            }
          }
        } catch (removalError) {
          // Non-fatal: just log the error
          if (errorReporter?.capture) {
            errorReporter.capture(removalError, {
              module: MODULE_CONTEXT,
              method: 'show',
              extra: { message: 'Failed to remove excess banners' }
            });
          }
        }

        // Add the new banner
        try {
          if (position.startsWith("bottom")) {
            if (typeof container.appendChild === 'function') {
              container.appendChild(banner);
            }
          } else {
            if (typeof container.prepend === 'function') {
              container.prepend(banner);
            } else if (typeof container.insertBefore === 'function' && container.firstChild) {
              container.insertBefore(banner, container.firstChild);
            } else if (typeof container.appendChild === 'function') {
              // Fallback to appendChild if prepend not available
              container.appendChild(banner);
            }
          }
        } catch (appendError) {
          console.error('[NotificationHandler] Failed to add banner to container:', appendError);

          if (errorReporter?.capture) {
            errorReporter.capture(appendError, {
              module: MODULE_CONTEXT,
              method: 'show',
              extra: { message, type: _type }
            });
          }

          // Try emergency display method - append directly to body
          try {
            document.body.appendChild(banner);
          } catch (emergencyAppendError) {
            // Nothing more we can do
            return null;
          }
        }
      } else if (errorReporter?.capture) {
        // Container is invalid
        errorReporter.capture(new Error('Invalid notification container'), {
          module: MODULE_CONTEXT,
          method: 'show',
          extra: { message, type: _type, container }
        });
        return null;
      }

      // Set timeout for auto-dismiss
      try {
        const timeout = typeof opts.timeout === "number" ? opts.timeout : DEFAULT_TIMEOUT;
        if (timeout > 0) {
          setTimeout(() => {
            try {
              fadeOut(banner);
            } catch (fadeError) {
              // If fade fails, try direct removal
              if (banner && typeof banner.remove === 'function') {
                banner.remove();
              }
            }
          }, timeout);
        }
      } catch (timeoutError) {
        if (errorReporter?.capture) {
          errorReporter.capture(timeoutError, {
            module: MODULE_CONTEXT,
            method: 'show',
            extra: { message: 'Failed to set notification timeout' }
          });
        }
      }

      return banner;
    } catch (showError) {
      // Last resort error logging
      console.error('[CRITICAL] Notification system completely failed:', showError);

      if (errorReporter?.capture) {
        errorReporter.capture(showError, {
          module: MODULE_CONTEXT,
          method: 'show',
          critical: true,
          extra: { message, type }
        });
      }

      return null;
    }
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

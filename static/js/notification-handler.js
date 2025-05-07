 /* ---------------------------------------------------------------------------
 *  notificationHandler.js  ★ slimmed v4.0  (2025-05-04, minimal, no grouping, no metadata)
 *  -------------------------------------------------------------------------- */
export function createNotificationHandler({
  DependencySystem,
  domAPI = {
    getElementById: id => document.getElementById(id),
    createElement : tag => document.createElement(tag),
    body          : document.body,
  },
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
    const bodyToAppendTo = (domAPI && domAPI.body) ? domAPI.body : (typeof document !== "undefined" && document.body ? document.body : null);
    if (bodyToAppendTo) {
      bodyToAppendTo.appendChild(el);
    } else {
      // eslint-disable-next-line no-console
      console.error('[NotificationHandler] Could not find a body element to append the notification container.');
    }
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
    closeBtn.addEventListener("click", () => fadeOut(root));
    root.appendChild(closeBtn);

    fadeIn(root);
    return root;
  }

  function show(message, type = "info", opts = {}) {
    if (!message) return null;
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';
    const banner = buildBanner(_type, { ...opts, message });

    // Remove excess banners
    while (container.children.length >= maxVisible) {
      const victim = position.startsWith("bottom") ? container.children[container.children.length - 1]
                                                   : container.children[0];
      victim.remove();
    }
    position.startsWith("bottom") ? container.appendChild(banner) : container.prepend(banner);

    const timeout = typeof opts.timeout === "number" ? opts.timeout : DEFAULT_TIMEOUT;
    if (timeout > 0) setTimeout(() => fadeOut(banner), timeout);

    return banner;
  }

  const clear = () => { while (container.firstChild) container.firstChild.remove(); };

  const api = { show, clear, getContainer: () => container };
  ["debug", "info", "success", "warning", "error"].forEach(lvl => {
    api[lvl] = (msg, opts = {}) => show(msg, lvl, opts);
  });

  // Keep warn alias for backward compatibility
  api.warn = api.warning;

  if (DependencySystem?.modules?.has("notificationHandler")) {
    return DependencySystem.modules.get("notificationHandler");
  }
  return api;
}

export default { createNotificationHandler };

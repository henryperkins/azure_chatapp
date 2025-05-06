 /* ---------------------------------------------------------------------------
 *  notificationHandler.js  ★ refined v3.5  (2025-05-04, context/groupKey/metadata support)
 *  --------------------------------------------------------------------------
 *  CHANGES (v3.5)
 *  --------------------------------------------------------------------------
 *  • Deterministic composite grouping (groupKey) now preferred (for dedup/correlation)
 *  • Banner details accordion exposes full metadata (groupKey, transactionId, traceId, etc.)
 *  • 'Copy Group Metadata' button available in details for debug/correlation
 *  • Remains 100% backward compatible
 *  -------------------------------------------------------------------------- */
import { computeGroupKey } from './utils/notifications-helpers.js';

export function createNotificationHandler({
  DependencySystem,
  domAPI = {
    getElementById: id => document.getElementById(id),
    createElement : tag => document.createElement(tag),
    body          : document.body,
  },
  position = "top-right",        // "top-left" | "bottom-right" | "bottom-left"
  maxVisible = 5,
  groupWindowMs = 4000,
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

  /* ────────────────────── internal state ────────────────────────── */
  const groups = new Map(); // key → groupData

  /* ─────────────────────── utility fns ──────────────────────────── */
  const iconBtn = (label, glyph) => {
    const b = domAPI.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    Object.assign(b.style, {
      background    : "transparent",
      border        : 0,
      cursor        : "pointer",
      color         : "inherit",
      fontSize      : "1rem",
      lineHeight    : 1,
      display       : "flex",
      alignItems    : "center",
      justifyContent: "center",
      padding       : 0,
      userSelect    : "none",
    });
    b.textContent = glyph;
    return b;
  };
  const flashIcon = (btn, glyph, ms = 800) => {
    const old = btn.textContent;
    btn.textContent = glyph;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, ms);
  };
  const fadeIn = el => requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0) scale(1)";
  });
  const fadeOut = el => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px) scale(.96)";
    setTimeout(() => el.remove(), 250);
  };

  function buildBanner(type, key, opts = {}) {
    const root = domAPI.createElement("div");
    root.setAttribute("role", "alert");
    root.setAttribute("aria-live", "polite");
    root.tabIndex = 0;
    Object.assign(root.style, {
      pointerEvents : "auto",
      width         : "100%",
      display       : "flex",
      flexDirection : "column",
      gap           : "0.5rem",
      padding       : "0.75rem 1rem",
      borderRadius  : "0.5rem",
      boxShadow     : "0 2px 6px rgba(0,0,0,.15)",
      color         : "#fff",
      background    : theme[type] || theme.info,
      backdropFilter: "blur(4px)",
      transform     : "translateY(10px) scale(.97)",
      opacity       : "0",
      transition    : "opacity .25s ease-out, transform .25s cubic-bezier(.21,.55,.3,1)",
    });

    /* header row */
    const header = domAPI.createElement("div");
    Object.assign(header.style, { display: "flex", alignItems: "flex-start", gap: "0.5rem" });
    root.appendChild(header);

    const counterEl = domAPI.createElement("span");
    counterEl.textContent = "1";
    counterEl.title = "1× repeated";
    Object.assign(counterEl.style, { fontSize: "0.75rem", opacity: 0.85, alignSelf: "baseline" });
    header.appendChild(counterEl);

    const msgShort = domAPI.createElement("span");
    msgShort.style.flex = "1 1 auto";
    header.appendChild(msgShort);

    const copyBtn  = iconBtn("Copy message(s)", "📋");
    const closeBtn = iconBtn("Dismiss", "✕");
    header.appendChild(copyBtn);
    header.appendChild(closeBtn);

    /* accordion */
    const toggler = iconBtn("Show details", "▸");
    header.insertBefore(toggler, msgShort);
    const list = domAPI.createElement("ul");
    Object.assign(list.style, { display:"none", margin:0, paddingLeft:"1rem", listStyle:"disc", fontSize:"0.75rem" });
    root.appendChild(list);

    // ==== Expanded Group Metadata Pane ====
    const metaPanel = domAPI.createElement("div");
    Object.assign(metaPanel.style, {
      display: "none",
      fontSize: "0.75rem",
      marginTop: "0.5rem",
      wordBreak: "break-word",
      opacity: 0.9,
    });
    root.appendChild(metaPanel);

    // Only show metadata if at least one extra field (besides message/type etc) is present
    function updateMetaPanel(opts) {
      // Expose: groupKey, module, source, traceId, transactionId, context, id
      const meta = [];
      if (opts.groupKey) meta.push(`<b>groupKey:</b> <code>${opts.groupKey}</code>`);
      if (opts.module) meta.push(`<b>module:</b> <code>${opts.module}</code>`);
      if (opts.source) meta.push(`<b>source:</b> <code>${opts.source}</code>`);
      if (opts.context) meta.push(`<b>context:</b> <code>${opts.context}</code>`);
      if (opts.traceId) meta.push(`<b>traceId:</b> <code>${opts.traceId}</code>`);
      if (opts.transactionId) meta.push(`<b>transactionId:</b> <code>${opts.transactionId}</code>`);
      if (opts.id) meta.push(`<b>id:</b> <code>${opts.id}</code>`);
      if (meta.length) {
        metaPanel.innerHTML = meta.join("<br>");
        metaPanel.style.display = "block";
      }
    }
    updateMetaPanel(opts);

    // Copy all group metadata (not just messages) as JSON to clipboard
    const metaCopyBtn = iconBtn("Copy group metadata", "📝");
    metaCopyBtn.style.marginLeft = "0.25rem";
    header.appendChild(metaCopyBtn);
    metaCopyBtn.addEventListener("click", async e => {
      e.stopPropagation();
      try {
        // Grab all serializable keys in opts (and flatten duplicates)
        const { groupKey, module, source, context, traceId, transactionId, id } = opts || {};
        const meta = { groupKey, module, source, context, traceId, transactionId, id };
        await navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
        flashIcon(metaCopyBtn, "✅");
      } catch {
        flashIcon(metaCopyBtn, "⚠️");
      }
    });

    toggler.addEventListener("click", () => {
      const open = list.style.display !== "none";
      list.style.display = open ? "none" : "block";
      metaPanel.style.display = open ? "none" : "block";
      toggler.textContent = open ? "▸" : "▾";
      toggler.title = open ? "Show details" : "Hide details";
    });
    closeBtn.addEventListener("click", () => dismiss(key));
    copyBtn.addEventListener("click", async e => {
      e.stopPropagation();
      try {
        const text = Array.from(list.children).map(li => li.textContent).join("\n");
        await navigator.clipboard.writeText(text);
        flashIcon(copyBtn, "✅");
      } catch {
        flashIcon(copyBtn, "⚠️");
      }
    });

    fadeIn(root);
    return { root, counterEl, msgShort, list, ts: Date.now(), timer: null, type };
  }

  function scheduleAutoDismiss(group, key, timeout = DEFAULT_TIMEOUT) {
    if (group.timer) clearTimeout(group.timer);
    if (timeout > 0) group.timer = setTimeout(() => dismiss(key), timeout);
  }
  function dismiss(key) {
    const g = groups.get(key);
    if (!g) return;
    clearTimeout(g.timer);
    fadeOut(g.root);
    groups.delete(key);
  }

  /* ───────────────────────── show() core ────────────────────────── */
  function show(message, type = "info", opts = {}) {
    if (!message) return null;

    // Compose grouping key: use groupKey if provided, else composite fallback; use group:false for ungrouped
    const _type = ['info', 'success', 'warning', 'error', 'debug'].includes(type) ? type : 'info';
    let key;
    if (opts.group === false) {
      // Always display individually (unique key)
      key = `${_type}|${Date.now()}|${Math.random()}`;
    } else {
      key = opts.groupKey
        || computeGroupKey({ type: _type, context: opts.context, module: opts.module, source: opts.source });
    }
    const now = Date.now();
    let g = groups.get(key);

    if (g && (now - g.ts) < groupWindowMs) {
      g.ts = now;
      const newCount = Number(g.counterEl.textContent) + 1;
      g.counterEl.textContent = String(newCount);
      g.counterEl.title = `${newCount}× repeated`;
      if (!g.messages) g.messages = [];
      if (!g.messages.includes(message)) {
        g.messages.push(message);
        const li = domAPI.createElement("li");
        li.textContent = message;
        g.list.appendChild(li);
      }
      g.msgShort.textContent = message;
      scheduleAutoDismiss(g, key, opts.timeout ?? DEFAULT_TIMEOUT);
      return g.root;
    }

    g = buildBanner(_type, key, opts);
    g.messages = [message];
    g.msgShort.textContent = message;
    const li = domAPI.createElement("li");
    li.textContent = message;
    g.list.appendChild(li);
    groups.set(key, g);

    if (opts.style) Object.assign(g.root.style, opts.style);

    while (container.children.length >= maxVisible) {
      const victim = position.startsWith("bottom") ? container.children[container.children.length - 1]
                                                   : container.children[0];
      victim.remove();
    }
    position.startsWith("bottom") ? container.appendChild(g.root) : container.prepend(g.root);
    scheduleAutoDismiss(g, key, opts.timeout ?? DEFAULT_TIMEOUT);
    return g.root;
  }

  /* ───────────────────────────── API ───────────────────────────── */
  function clear(filter = {}) {
    for (const [key] of groups) {
      if (!filter.context || key.endsWith("|" + filter.context)) dismiss(key);
    }
  }

  const api = { show, clear, getContainer: () => container };
  ["debug", "info", "success", "warning", "error"].forEach(lvl => {
    api[lvl] = (msg, opts = {}) => show(msg, lvl, opts);
  });

  /* ─────────── Backward-compatibility aliases ────────────
   * Some legacy modules call `notificationHandler.warn` instead
   * of the v3.5 `warning` level.  Provide a thin alias so those
   * calls keep working without code-wide refactors.
   */
  api.warn = api.warning;

  if (DependencySystem?.modules?.has("notificationHandler")) {
    return DependencySystem.modules.get("notificationHandler");
  }
  return api;
}

export default { createNotificationHandler };

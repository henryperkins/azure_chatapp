/**
 * Notification Handler Module.
 * Provides a flexible, DOM-based notification system with grouping, cross-document messaging,
 * batched server logging, and robust cleanup. Follows the project's DI and coding guidelines.
 *
 * @param {Object} deps - Required dependencies.
 * @param {DependencySystem} deps.DependencySystem - Central orchestrator/service locator.
 * @param {EventHandlers} deps.eventHandlers - Safe event wiring abstraction (trackListener, cleanupListeners).
 * @param {Object} deps.domAPI - Safe DOM API (e.g. getElementById, createElement, body, etc.); no direct globals.
 * @param {Object} [deps.globalScope] - Optional global-like context (e.g. window). Provides setTimeout, addEventListener, etc.
 * @param {Function} [deps.fetchFn] - HTTP request function (defaulting to global fetch if not provided).
 * @param {Function} [deps.getCurrentUser] - Returns current user info for logging (default unknown).
 * @returns {NotificationHandler} An object exposing { show, hide, clear, cleanup, addMessageListener, removeMessageListener, ... }.
 *
 * @example
 * import createGroupedNotificationHelper from './handler-helper.js';
 * import { createNotificationHandler } from './notification-handler.js';
 *
 * const deps = {
 *   DependencySystem: mySystem,
 *   eventHandlers: myEventHandlers,
 *   domAPI: myDomAPI,     // getElementById, createElement, body, etc.
 *   globalScope: window,  // or a mock for testing
 *   fetchFn: fetch,       // or a custom HTTP function
 *   getCurrentUser: () => ({ username: 'alice' })
 * };
 *
 * const notificationHandler = createNotificationHandler(deps);
 * notificationHandler.show('Welcome!', 'info');
 * // ...
 * notificationHandler.cleanup(); // Removes listeners, sends pending logs, etc.
 */

import createGroupedNotificationHelper from './handler-helper.js';

export function createNotificationHandler({
  eventHandlers,
  DependencySystem,
  domAPI,
  globalScope,
  fetchFn,
  getCurrentUser,
  container,
  groupWindowMs = 5000,          // <-- NEW: bubble straight to helper
  classMap = {}                  // <-- optional style overrides
} = {}) {
  // -----------------------------
  // 1. Validate and set defaults
  // -----------------------------
  if (!DependencySystem) {
    throw new Error('[NotificationHandler] DependencySystem required');
  }
  if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
    throw new Error('[NotificationHandler] eventHandlers with trackListener required');
  }
  if (!domAPI || typeof domAPI.getElementById !== 'function' || typeof domAPI.createElement !== 'function') {
    throw new Error('[NotificationHandler] domAPI with getElementById, createElement required');
  }

  // Fallbacks for optional dependencies
  const _fetch = typeof fetchFn === 'function' ? fetchFn : (typeof fetch === 'function' ? fetch : null);
  const _globalScope = globalScope || (typeof window !== 'undefined' ? window : {});
  const _setTimeout = typeof _globalScope.setTimeout === 'function' ? _globalScope.setTimeout : setTimeout; // fallback
  const _addGlobalListener = typeof _globalScope.addEventListener === 'function'
    ? _globalScope.addEventListener.bind(_globalScope)
    : null;
  const currentUserFn = typeof getCurrentUser === 'function' ? getCurrentUser : () => ({ username: 'unknown' });

  // -----------------------------
  // 2. Internal state
  // -----------------------------
  let _ready = false;
  const _pendingQueue = [];
  const activeNotifications = new Map();
  let notificationCounter = 0;
  let _messageListenerAttached = false;

  const logBatch = [];
  let logSendTimeout = null;

  // -----------------------------
  // 3. Notification Container
  // -----------------------------
  // Expose so app.js can call it without duplicating container logic.
  function ensureNotificationContainer() {
    // Use provided container if passed
    if (container) return container;

    let resolved = domAPI.getElementById('notificationArea');
    if (!resolved) {
      resolved = domAPI.createElement('div');
      resolved.id = 'notificationArea';
      resolved.className =
        'notification-area fixed top-6 right-6 z-[1200] flex flex-col items-end max-h-[96vh] overflow-y-auto';
      resolved.setAttribute('role', 'status');
      resolved.setAttribute('aria-live', 'polite');

      if (domAPI.body && typeof domAPI.body.appendChild === 'function') {
        domAPI.body.appendChild(resolved);
      }
    } else {
      // Ensure styling is consistent
      if (!resolved.classList.contains('notification-area')) {
        resolved.classList.add('notification-area');
      }
      resolved.style.zIndex = '1200';
    }
    return resolved;
  }

  // Public getter (used by app.js now)
  const getContainer = ensureNotificationContainer;

  // -----------------------------
  // 4. Readiness & Queue Flush
  // -----------------------------
  function _checkReady() {
    // Force container creation to ensure we can render notifications
    const container = ensureNotificationContainer();

    // If we have all required dependencies, set ready
    if (eventHandlers && typeof eventHandlers.trackListener === 'function' && DependencySystem && container) {
      _ready = true;
      // Flush any pending notifications
      while (_pendingQueue.length > 0) {
        const args = _pendingQueue.shift();
        show(...args);
      }
    }
    return _ready;
  }

  // Optionally auto-check readiness using global scope events
  if (_addGlobalListener && _globalScope.document) {
    const rs = _globalScope.document.readyState;
    if (rs === 'complete' || rs === 'interactive') {
      _setTimeout(_checkReady, 0);
      _setTimeout(_checkReady, 500);
    } else {
      _addGlobalListener(
        'DOMContentLoaded',
        () => {
          _checkReady();
          _setTimeout(_checkReady, 500);
        },
        { once: true }
      );
    }
  } else {
    // If no global document or event listener, the user can manually call _checkReady
    _checkReady();
  }

  // -----------------------------
  // 5. Icon Generation
  // -----------------------------
  function getIconForType(type) {
    const icons = {
      success:
        '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>',
      warning:
        '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M5.062 19h13.856c1.54 0 2.502-1.667 1.732-3l-6.287-9.17c-.77-1.333-2.694-1.333-3.464 0L3.33 16c-.77 1.333.192 3 1.732 3z" /></svg>',
      error:
        '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>',
      info:
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path></svg>',
    };
    return icons[type] || icons.info;
  }

  // -----------------------------
  // 6. Batched Logging
  // -----------------------------
  function scheduleBatchLog() {
    if (logSendTimeout) return;
    logSendTimeout = _setTimeout(() => sendLogBatch(0), 2000);
  }

  async function sendLogBatch(retryCount = 0) {
    logSendTimeout = null;
    if (logBatch.length === 0) return;
    if (typeof _fetch !== 'function') {
      // Cannot send logs without a fetch function
      return;
    }

    const batchToSend = [...logBatch];
    logBatch.length = 0;

    try {
      const response = await _fetch('/api/log_notification_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: batchToSend }),
      });

      if (!response.ok && retryCount < 2) {
        // Put items back in batch and retry
        console.warn(`[NotificationHandler] Server returned ${response.status}, retrying...`);
        logBatch.push(...batchToSend);
        _setTimeout(() => sendLogBatch(retryCount + 1), 1000 * (retryCount + 1));
      }
    } catch (err) {
      console.warn('[NotificationHandler] Failed to send log batch:', err);
      // Retry on network errors
      if (retryCount < 2) {
        logBatch.push(...batchToSend);
        _setTimeout(() => sendLogBatch(retryCount + 1), 1000 * (retryCount + 1));
      }
    }
  }

  function logNotification(message, type, user) {
    let safeType = typeof type === 'string' ? type.trim().toLowerCase() : 'info';
    if (!/^(info|error|warning|success)$/i.test(safeType)) {
      safeType = 'info';
    }
    const logItem = {
      message: String(message),
      type: safeType,
      timestamp: Date.now() / 1000,
      user: user || currentUserFn().username || 'unknown',
    };

    logBatch.push(logItem);
    if (logBatch.length >= 10) {
      if (logSendTimeout) clearTimeout(logSendTimeout);
      sendLogBatch(0);
    } else {
      scheduleBatchLog();
    }
  }

  // -----------------------------
  // 7. Notification Template
  // -----------------------------
  // We'll build the template in memory the first time, or store as a string
  function getNotificationTemplateContent() {
    // Using minimal string template to create a container
    return `
      <div class="alert notification-item animate-fadeIn" role="alert" aria-live="polite" style="animation-duration:300ms;">
        <div class="flex items-center">
          <span class="notification-icon" aria-hidden="true"></span>
          <span class="notification-message ml-2"></span>
          <button type="button" class="notification-copy-btn btn btn-xs btn-ghost ml-1"
                  aria-label="Copy notification" title="Copy notification message" tabindex="0">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true"
                 class="inline-block align-text-bottom" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1
                       a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2
                       a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7
                       a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6
                       a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/>
            </svg>
          </button>
          <button type="button" class="btn btn-xs btn-ghost notification-close ml-auto"
                  aria-label="Dismiss notification" tabindex="0">×</button>
        </div>
      </div>
    `;
  }

  // -----------------------------
  // 8. Show Notifications
  // -----------------------------
  function show(message, type = 'info', options = {}) {
    const container = ensureNotificationContainer();
    if (!_ready && !_checkReady()) {
      // Queue notification
      _pendingQueue.push([message, type, options]);
      return null;
    }

    try {
      // Log first
      logNotification(message, type, options.user);

      // Group context
      const context = options.context || options.module || options.source || 'general';
      if (options.group) {
        return groupedHelper.showGroupedNotificationByTypeAndTime({
          message,
          type,
          context,
          container,
        });
      }

      // Create new notification
      const notificationId = `notification-${Date.now()}-${notificationCounter++}`;
      const notificationHTML = getNotificationTemplateContent();
      const wrapperEl = domAPI.createElement('div');
      wrapperEl.innerHTML = notificationHTML.trim();
      const notificationEl = wrapperEl.firstElementChild; // <div class="alert ...">

      // Assign ID
      notificationEl.id = notificationId;
      let safeType = typeof type === 'string' ? type.trim().toLowerCase() : 'info';
      if (!/^(info|error|warning|success)$/i.test(safeType)) {
        safeType = 'info';
      }
      notificationEl.classList.add(`notification-${safeType}`);

      // Set icon and text
      const iconSpan = notificationEl.querySelector('.notification-icon');
      const messageSpan = notificationEl.querySelector('.notification-message');
      if (iconSpan) iconSpan.innerHTML = getIconForType(safeType);
      if (messageSpan) {
        // textContent is safe for user messages
        messageSpan.textContent = message;
      }

      // Auto-dismiss
      const timeout = options.timeout ?? 5000;
      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = _setTimeout(() => hide(notificationId), timeout);
      }

      // Track
      activeNotifications.set(notificationId, {
        element: notificationEl,
        timeoutId,
      });

      // Close button
      const closeBtn = notificationEl.querySelector('.notification-close');
      if (closeBtn) {
        eventHandlers.trackListener(closeBtn, 'click', () => hide(notificationId), {
          description: `Notification close btn ${notificationId}`,
        });
      }

      // Copy button
      const copyBtn = notificationEl.querySelector('.notification-copy-btn');
      if (copyBtn) {
        const originalIcon = copyBtn.innerHTML;
        const checkIcon = `
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true"
               class="inline-block align-text-bottom text-success" viewBox="0 0 20 20" fill="currentColor">
            <path d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7 7a1 1 0 0 1-1.414 0l-3-3
                     a1 1 0 1 1 1.414-1.414L9 11.586l6.293-6.293
                     a1 1 0 0 1 1.414-.003z"/>
          </svg>
        `;
        eventHandlers.trackListener(copyBtn, 'click', () => {
          const textEl = notificationEl.querySelector('.notification-message');
          const copyText = textEl?.textContent || '';
          if (_globalScope.navigator && _globalScope.navigator.clipboard) {
            _globalScope.navigator.clipboard.writeText(copyText).then(() => {
              copyBtn.innerHTML = checkIcon;
              copyBtn.classList.add('text-success');
              _setTimeout(() => {
                copyBtn.innerHTML = originalIcon;
                copyBtn.classList.remove('text-success');
              }, 1200);
            }).catch(() => {
              notificationHandler.show('Copy failed', 'error', { timeout: 2000, context: 'notificationHelper' });
            });
          }
        }, {
          description: `Notification copy btn ${notificationId}`,
        });
      }

      // Append to container
      container.appendChild(notificationEl);

      return notificationId;
    } catch (err) {
      console.error('[NotificationHandler] Failed to show notification:', err);

      // Fallback
      try {
        const fallbackEl = domAPI.createElement('div');
        fallbackEl.className = `alert alert-${type || 'info'} mb-2`;
        fallbackEl.textContent = message || 'Notification error';
        if (container) container.appendChild(fallbackEl);
        _setTimeout(() => {
          if (fallbackEl.parentNode) {
            fallbackEl.parentNode.removeChild(fallbackEl);
          }
        }, 5000);
      } catch (e2) {
        console.error('[NotificationHandler] Critical fallback error:', e2);
      }
      return null;
    }
  }

  // -----------------------------
  // 9. Hide Notifications
  // -----------------------------
  function hide(notificationId) {
    const data = activeNotifications.get(notificationId);
    if (data) {
      const { element, timeoutId } = data;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // Animate out
      element.classList.remove('animate-fadeIn');
      element.classList.add('animate-fadeOut');
      element.style.animationDuration = '300ms';

      _setTimeout(() => {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
        activeNotifications.delete(notificationId);
      }, 300);

      return true;
    }
    // Possibly a grouped notification
    return groupedHelper.hideGroupedNotification(notificationId);
  }

  // -----------------------------
  // 10. Clear Notifications
  // -----------------------------
  function clear() {
    // Clear standard
    for (const [id, { element, timeoutId }] of activeNotifications.entries()) {
      if (timeoutId) clearTimeout(timeoutId);
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }
    activeNotifications.clear();
    // Clear grouped
    groupedHelper.clearAllGroupedNotifications();
  }

  // -----------------------------
  // 11. Cross-Frame Messaging
  // -----------------------------
  function handleNotificationMessages(event) {
    try {
      const msg = event.data;
      let handled = false;

      if (typeof msg === 'string' && msg.includes('<hide-notification>')) {
        const match = msg.match(/<hide-notification(?:\s+id="([^"]+)")?\s*>/);
        const id = match && match[1];
        if (id) hide(id);
        else clear();
        handled = true;
      } else if (msg && typeof msg === 'object') {
        if (msg.type === 'notification') {
          show(msg.text, msg.level || 'info', msg.options || {});
          handled = true;
        }
      }

      if (handled && event.source && event.origin && typeof event.source.postMessage === 'function') {
        event.source.postMessage({
          type: 'notification-handled',
          success: true,
          messageId: msg.id || null,
        }, event.origin);
      }
    } catch (err) {
      if (event.source && event.origin && typeof event.source.postMessage === 'function') {
        try {
          event.source.postMessage({
            type: 'notification-error',
            success: false,
            error: err.message,
            messageId: event.data?.id || null,
          }, event.origin);
        } catch (err2) {
          console.error('[NotificationHandler] postMessage notification-error:', err2);
        }
      }
    }
  }

  function addMessageListener(target = _globalScope, trackListener = null) {
    if (_messageListenerAttached) return;
    if (!target || !target.postMessage) return; // not a valid window-like

    const tracker = trackListener || eventHandlers.trackListener;
    tracker(target, 'message', handleNotificationMessages, { description: 'NotificationHandler: message' });
    _messageListenerAttached = true;
  }

  function removeMessageListener(target = _globalScope) {
    if (_messageListenerAttached) {
      eventHandlers.cleanupListeners(
        target,
        'message',
        null,
        'NotificationHandler: message'
      );
      _messageListenerAttached = false;
    }
  }

  // -----------------------------
  // 12. Grouped Notifications
  // -----------------------------
  const groupedHelper = createGroupedNotificationHelper({
    domAPI,
    eventHandlers,
    getIconForType,
    notificationHandler: null, // We'll set reference below
    globalScope: _globalScope,
    groupWindowMs,
    classMap
  });

  /* --- Clear-all caching (avoids querySelector each time) --- */
  let clearAllBtnEl = null;
  function ensureClearAllBtn() {
    const cont = getContainer();
    if (groupedHelper.groupedNotifications.size === 0) {
      clearAllBtnEl?.remove();
      clearAllBtnEl = null;
      return;
    }
    if (clearAllBtnEl && cont.contains(clearAllBtnEl)) return;
    clearAllBtnEl?.remove();

    clearAllBtnEl = domAPI.createElement('button');
    clearAllBtnEl.type = 'button';
    clearAllBtnEl.className = 'notification-clear-all btn btn-xs btn-outline';
    clearAllBtnEl.textContent = 'Clear All';
    clearAllBtnEl.setAttribute('aria-label', 'Clear all notifications');
    clearAllBtnEl.onclick = () => { clear(); clearAllBtnEl.remove(); clearAllBtnEl = null; };
    cont.insertBefore(clearAllBtnEl, cont.firstChild);
  }

  // Wrap grouped methods to inject the Clear All button logic
  const originalShowGrouped = groupedHelper.showGroupedNotificationByTypeAndTime;
  groupedHelper.showGroupedNotificationByTypeAndTime = function (opts) {
    // We do need to call and return id, but eslint warns 'id' is never used (outside this function).
    // This usage is intentional: downstream callers expect an id.
    // eslint-disable-next-line no-unused-vars
    const id = originalShowGrouped.call(groupedHelper, opts);
    ensureClearAllBtn();
    return id;
  };

  const originalClearAllGrouped = groupedHelper.clearAllGroupedNotifications;
  groupedHelper.clearAllGroupedNotifications = function () {
    originalClearAllGrouped.call(groupedHelper);
    ensureClearAllBtn();
  };

  // -----------------------------
  // 13. Final handler object
  // -----------------------------
  const notificationHandler = {
    show,
    hide,
    clear,

    // Cleanup everything: notifications, logs, message listeners
    cleanup() {
      clear();
      removeMessageListener();
      if (logBatch.length > 0) {
        sendLogBatch(0);
      }
    },
    addMessageListener,
    removeMessageListener,

    getIconForType,
    groupedNotifications: groupedHelper.groupedNotifications,
    groupedHelper,

    getContainer,                       // <-- NEW

    // Compatibility: methods that existed in older code
    log: (msg, opts) => show(msg, 'info', opts),
    warn: (msg, opts) => show(msg, 'warning', opts),
    error: (msg, opts) => show(msg, 'error', opts),
    debug: (msg, opts) => show(msg, 'info', { ...(opts || {}), timeout: 2000 }),
  };

  // Self-reference in groupedHelper
  if (groupedHelper._setNotificationHandler && typeof groupedHelper._setNotificationHandler === 'function') {
    groupedHelper._setNotificationHandler(notificationHandler);
  }

  // Try immediate readiness check
  _checkReady();

  return notificationHandler;
}

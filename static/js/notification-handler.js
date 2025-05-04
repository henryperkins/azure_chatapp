// notification-handler.js - Improved but backward compatible

import createGroupedNotificationHelper from './handler-helper.js';

export function createNotificationHandler({ eventHandlers, DependencySystem } = {}) {
  // --- Dependency/DOM readiness state ---
  let _ready = false;
  const _pendingQueue = [];

  if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
    console.error('[NotificationHandler] eventHandlers with trackListener is required.');
    // Fallback implementation that won't crash
    eventHandlers = {
      trackListener: (el, evt, fn) => {
        el.addEventListener(evt, fn);
        return fn;
      },
      cleanupListeners: () => {}
    };
  }

  // Active notifications tracking
  const activeNotifications = new Map();
  let notificationCounter = 0;
  let _messageListenerAttached = false;

  // Templates - defined as DOM element to maintain compatibility
  const notificationTemplate = document.createElement('template');
  notificationTemplate.innerHTML = `
    <div class="alert notification-item animate-fadeIn" role="alert">
      <div class="flex items-center">
        <span class="notification-icon"></span>
        <span class="notification-message ml-2"></span>
        <button type="button" class="notification-copy-btn ml-1" aria-label="Copy notification" title="Copy notification message">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/></svg>
        </button>
        <button type="button" class="btn btn-xs btn-ghost notification-close ml-auto" aria-label="Dismiss">×</button>
      </div>
    </div>
  `;

  function ensureNotificationContainer() {
    let container = document.getElementById('notificationArea');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notificationArea';
      container.className = 'fixed top-16 right-4 z-50 w-72 gap-2 flex flex-col';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  // --- Readiness check and queue flush ---
  function _checkReady() {
    // Check eventHandlers, DependencySystem, and notificationArea DOM
    const container = document.getElementById('notificationArea');
    if (eventHandlers && typeof eventHandlers.trackListener === 'function' &&
        DependencySystem && container) {
      _ready = true;
      // Flush pending queue
      while (_pendingQueue.length > 0) {
        const args = _pendingQueue.shift();
        show.apply(null, args);
      }
    }
    return _ready;
  }

  // Call _checkReady on DOMContentLoaded
  if (typeof window !== 'undefined' && window.document) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(_checkReady, 0);
    } else {
      window.addEventListener('DOMContentLoaded', _checkReady, { once: true });
    }
  }

  // Consistent icon generation
  function getIconForType(type) {
    const icons = {
      success: '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      warning: '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>',
      error: '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      info: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };
    return icons[type] || icons.info;
  }

  // Batched server logging - improved with retry mechanism
  const logBatch = [];
  let logSendTimeout = null;

  function scheduleBatchLog() {
    if (logSendTimeout) return;
    logSendTimeout = setTimeout(() => sendLogBatch(0), 2000);
  }

  async function sendLogBatch(retryCount = 0) {
    logSendTimeout = null;
    if (logBatch.length === 0) return;

    const batchToSend = [...logBatch];
    logBatch.length = 0;

    try {
      const response = await fetch('/api/log_notification_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: batchToSend })
      });

      if (!response.ok && retryCount < 2) {
        // Put items back in batch and retry with backoff
        console.warn(`[NotificationHandler] Server returned ${response.status}, retrying...`);
        logBatch.push(...batchToSend);
        setTimeout(() => sendLogBatch(retryCount + 1), 1000 * (retryCount + 1));
      }
    } catch (err) {
      console.warn('[NotificationHandler] Failed to send log batch:', err);

      // Retry on network errors with exponential backoff
      if (retryCount < 2) {
        logBatch.push(...batchToSend);
        setTimeout(() => sendLogBatch(retryCount + 1), 1000 * (retryCount + 1));
      }
    }
  }

  function logNotification(message, type, user) {
    // Ensure valid type for server API – only allow 'info', 'error', 'warning', 'success'
    let safeType = typeof type === "string" ? type.trim().toLowerCase() : "info";
    if (!/^(info|error|warning|success)$/i.test(safeType)) safeType = "info";
    const logItem = {
      message: String(message),
      type: safeType,
      timestamp: Date.now() / 1000,
      user: user || (window.currentUser?.username ?? 'unknown')
    };

    logBatch.push(logItem);
    if (logBatch.length >= 10) {
      clearTimeout(logSendTimeout);
      sendLogBatch(0);
    } else {
      scheduleBatchLog();
    }
  }

  // Improved primary notification method with better error handling
  function show(message, type = 'info', options = {}) {
    if (!_ready && !_checkReady()) {
      // Queue notification until ready
      _pendingQueue.push([message, type, options]);
      return null;
    }
    try {
      const container = ensureNotificationContainer();
      logNotification(message, type, options.user);

      // Use context for grouping if provided
      const context = options.context || options.module || options.source || 'general';

      // Determine if we should group this notification
      const shouldGroup = !!options.group;

      if (shouldGroup) {
        return groupedHelper.showGroupedNotificationByTypeAndTime({
          message,
          type,
          context,
          container
        });
      }

      // Create a new notification from the template
      const notificationId = `notification-${Date.now()}-${notificationCounter++}`;
      const notificationClone = notificationTemplate.content.cloneNode(true);
      const notification = notificationClone.querySelector('.alert');

      // Set properties
      notification.id = notificationId;
      // Only use safe type for class (fallback to 'info' if invalid)
      let safeType = typeof type === "string" ? type.trim().toLowerCase() : "info";
      if (!/^(info|error|warning|success)$/i.test(safeType)) safeType = "info";
      notification.classList.add(`notification-${safeType}`);
      notification.querySelector('.notification-icon').innerHTML = getIconForType(safeType);
      notification.querySelector('.notification-message').textContent = message;

      // Ensure animation is consistent
      notification.style.animationDuration = '300ms';

      // Set up auto-dismiss timeout if enabled
      const timeout = options.timeout ?? 5000;
      let timeoutId = null;
      if (timeout > 0) {
        timeoutId = setTimeout(() => hide(notificationId), timeout);
      }

      // Track the notification
      activeNotifications.set(notificationId, {
        element: notification,
        timeoutId
      });

      // Add close button handler with proper tracking
      const closeBtn = notification.querySelector('.notification-close');
      if (closeBtn) {
        eventHandlers.trackListener(
          closeBtn,
          'click',
          () => hide(notificationId),
          { description: `Notification close btn ${notificationId}` }
        );
      }

      // Add copy button handler
      const copyBtn = notification.querySelector('.notification-copy-btn');
      if (copyBtn) {
        const originalIcon = copyBtn.innerHTML;
        const checkIcon =
          '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom text-success" viewBox="0 0 20 20" fill="currentColor"><path d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7 7a1 1 0 0 1-1.414 0l-3-3a1 1 0 1 1 1.414-1.414L9 11.586l6.293-6.293a1 1 0 0 1 1.414-.003z"/></svg>';
        eventHandlers.trackListener(
          copyBtn,
          'click',
          () => {
            const messageText = notification.querySelector('.notification-message')?.textContent || '';
            navigator.clipboard.writeText(messageText).then(() => {
              copyBtn.innerHTML = checkIcon;
              copyBtn.classList.add('text-success');
              setTimeout(() => {
                copyBtn.innerHTML = originalIcon;
                copyBtn.classList.remove('text-success');
              }, 1200);
            }).catch(() => {
              notificationHandler.show('Copy failed', 'error', { timeout: 2000, context: 'notificationHelper' });
            });
          },
          { description: `Notification copy btn ${notificationId}` }
        );
      }

      // Add to container
      container.appendChild(notification);
      return notificationId;
    } catch (err) {
      // Single error boundary
      console.error('Failed to show notification:', err);

      // Create a simple fallback notification
      try {
        const container = document.getElementById('notificationArea') || document.body;
        const div = document.createElement('div');
        div.className = `alert alert-${type || 'info'} mb-2`;
        div.textContent = message || 'Notification error';
        div.style.margin = '10px';
        container.appendChild(div);
        setTimeout(() => div.remove(), 5000);
      } catch (e) {
        // Last resort
        console.error('Critical notification error:', message, e);
      }
      return null;
    }
  }

  function hide(notificationId) {
    // Handle both standard and grouped notifications
    const data = activeNotifications.get(notificationId);

    if (data) {
      // Standard notification
      const { element, timeoutId } = data;
      if (timeoutId) clearTimeout(timeoutId);

      // Use CSS animation for fade out
      element.classList.remove('animate-fadeIn');
      element.classList.add('animate-fadeOut');
      element.style.animationDuration = '300ms';

      // Remove after animation completes
      setTimeout(() => {
        if (element.parentNode) element.parentNode.removeChild(element);
        activeNotifications.delete(notificationId);
      }, 300);

      return true;
    }

    // Try grouped notification
    return groupedHelper.hideGroupedNotification(notificationId);
  }

  function clear() {
    // Clear standard notifications
    for (const [id, data] of activeNotifications.entries()) {
      if (data.timeoutId) clearTimeout(data.timeoutId);
      if (data.element && data.element.parentNode) {
        data.element.parentNode.removeChild(data.element);
      }
    }
    activeNotifications.clear();

    // Clear grouped notifications
    groupedHelper.clearAllGroupedNotifications();
  }

  // Message event handler for cross-frame communication
  function handleNotificationMessages(event) {
    try {
      const message = event.data;
      let handled = false;

      if (typeof message === 'string' && message.includes('<hide-notification>')) {
        const idMatch = message.match(/<hide-notification(?:\s+id="([^"]+)")?\s*>/);
        const id = idMatch && idMatch[1];
        if (id) {
          hide(id);
        } else {
          clear();
        }
        handled = true;
      } else if (message && typeof message === 'object') {
        if (message.type === 'notification') {
          show(message.text, message.level || 'info', message.options || {});
          handled = true;
        }
      }

      // Send response if we handled something
      if (handled && event.source && event.origin) {
        try {
          event.source.postMessage({
            type: 'notification-handled',
            success: true,
            messageId: message.id || null
          }, event.origin);
        } catch (err) {
          console.error('[NotificationHandler] postMessage notification-handled error:', err);
        }
      }
    } catch (err) {
      // If there's an error, attempt to post back a notification-error
      if (event.source && event.origin) {
        try {
          event.source.postMessage({
            type: 'notification-error',
            success: false,
            error: err.message,
            messageId: event.data?.id || null
          }, event.origin);
        } catch (err2) {
          console.error('[NotificationHandler] postMessage notification-error:', err2);
        }
      }
    }
  }

  function addMessageListener(target = window, trackListener = null) {
    if (_messageListenerAttached) return;
    const tracker = trackListener || eventHandlers.trackListener;
    tracker(target, 'message', handleNotificationMessages, { description: 'NotificationHandler: message' });
    _messageListenerAttached = true;
  }

  function removeMessageListener() {
    if (_messageListenerAttached) {
      // Use eventHandlers here instead of direct removeEventListener
      eventHandlers.cleanupListeners(window, 'message', null, 'NotificationHandler: message');
      _messageListenerAttached = false;
    }
  }

  // Set up the grouped notification helper
  const groupedHelper = createGroupedNotificationHelper({
    eventHandlers,
    getIconForType,
    notificationHandler: null // Self-reference will be added below
  });

  // Create the complete notification handler with all required methods
  const notificationHandler = {
    show,
    hide,
    clear,
    cleanup() {
      clear();
      removeMessageListener();
      // Send any pending logs
      if (logBatch.length > 0) {
        sendLogBatch(0);
      }
    },
    addMessageListener,
    removeMessageListener,
    getIconForType,
    groupedNotifications: groupedHelper.groupedNotifications,
    groupedHelper,

    // Compatibility methods
    log: (msg, opts) => show(msg, 'info', opts),
    warn: (msg, opts) => show(msg, 'warning', opts),
    error: (msg, opts) => show(msg, 'error', opts),
    debug: (msg, opts) => show(msg, 'info', { ...(opts || {}), timeout: 2000 })
  };

  // Set self-reference in groupedHelper if needed
  if (groupedHelper._setNotificationHandler && typeof groupedHelper._setNotificationHandler === 'function') {
    groupedHelper._setNotificationHandler(notificationHandler);
  }

  return notificationHandler;
}

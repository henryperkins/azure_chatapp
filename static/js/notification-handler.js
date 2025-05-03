// notification-handler.js - Simplified API and improved DOM handling

import createGroupedNotificationHelper from './handler-helper.js';

export function createNotificationHandler({ eventHandlers, DependencySystem } = {}) {
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

  // Use a template for consistent notification creation
  const notificationTemplate = document.createElement('template');
  notificationTemplate.innerHTML = `
    <div class="alert notification-item animate-fadeIn" role="alert">
      <div class="flex items-center">
        <span class="notification-icon"></span>
        <span class="notification-message ml-2"></span>
      </div>
      <button type="button" class="btn btn-xs btn-ghost notification-close ml-auto" aria-label="Dismiss">×</button>
    </div>
  `;

  function ensureNotificationContainer() {
    let container = document.getElementById('notificationArea');
    if (!container) {
      // Single fallback approach
      container = document.createElement('div');
      container.id = 'notificationArea';
      container.className = 'fixed top-16 right-4 z-50 w-72 gap-2 flex flex-col';
      document.body.appendChild(container);
    }
    return container;
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

  // Batched server logging - send logs every 2 seconds or when batch reaches 10
  const logBatch = [];
  let logSendTimeout = null;

  function scheduleBatchLog() {
    if (logSendTimeout) return;
    logSendTimeout = setTimeout(sendLogBatch, 2000);
  }

  async function sendLogBatch() {
    logSendTimeout = null;
    if (logBatch.length === 0) return;

    const batchToSend = [...logBatch];
    logBatch.length = 0;

    try {
      await fetch('/api/log_notification_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications: batchToSend })
      });
    } catch (err) {
      // Silent failure, but at least we know what happened
      console.warn('[NotificationHandler] Failed to send log batch:', err);
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
      sendLogBatch();
    } else {
      scheduleBatchLog();
    }
  }

  // Grouped notification helper setup
  const groupedHelper = createGroupedNotificationHelper({
    eventHandlers,
    getIconForType,
    notificationHandler: null
  });

  // Primary notification method
  function show(message, type = 'info', options = {}) {
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

    // Add close button handler
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
      eventHandlers.trackListener(
        closeBtn,
        'click',
        () => hide(notificationId),
        { description: 'Notification close button' }
      );
    }

    // Add to container
    container.appendChild(notification);
    return notificationId;
  }

  function hide(notificationId) {
    // Handle both standard and grouped notifications
    const data = activeNotifications.get(notificationId);

    if (data) {
      // Standard notification
      const { element, timeoutId } = data;
      if (timeoutId) clearTimeout(timeoutId);

      // Use CSS animation for fade out
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

  function cleanup() {
    clear();
    removeMessageListener();
    // Send any pending logs
    if (logBatch.length > 0) {
      sendLogBatch();
    }
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

  // Create a backwards compatible API that maps to the `show` method
  return {
    show,
    hide,
    clear,
    cleanup,
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
}

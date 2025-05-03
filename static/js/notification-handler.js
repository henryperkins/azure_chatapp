
import createGroupedNotificationHelper from './handler-helper.js';

/**
 * notification-handler.js
 * DependencySystem/DI-compliant, modular notification handler for robust UX toasts.
 * No implicit global assignment or self-registration. Factory pattern.
 *
 * Usage (in app.js or orchestrator):
 *   import { createNotificationHandler } from './notification-handler.js';
 *   const notificationHandler = createNotificationHandler({ eventHandlers, DependencySystem });
 *   DependencySystem.register('notificationHandler', notificationHandler);
 *   notificationHandler.addMessageListener(); // Optional: if cross-window message support is desired
 *
 * Exposes API: { show, hide, clear, cleanup, addMessageListener, removeMessageListener }
 */

export function createNotificationHandler({ eventHandlers, DependencySystem } = {}) {
  if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
    throw new Error('[NotificationHandler] eventHandlers with trackListener is required.');
  }

  // Keep track of active notifications and their timeouts
  // Map of notificationId -> { element, timeoutId }
  const activeNotifications = new Map();
  let notificationCounter = 0;
  let _messageListenerAttached = false;

  // Create notification container if it doesn't exist
  function ensureNotificationContainer() {
    let container = document.getElementById('notificationArea');
    if (!container) {
      // fallback: create and append notificationContainer if notificationArea is missing (legacy)
      container = document.getElementById('notificationContainer');
      if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'toast toast-top toast-end z-[100]';
        document.body.appendChild(container);
        console.debug('Notification container created');
      }
    }
    return container;
  }

  // Provide consistent icon logic for both solo and grouped notifications
  function getIconForType(type) {
    switch (type) {
      case 'success':
        return (
          '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
          'd="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>'
        );
      case 'warning':
        return (
          '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
          'd="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 ' +
          '1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 ' +
          '1.333.192 3 1.732 3z" /></svg>'
        );
      case 'error':
        return (
          '<svg xmlns="http://www.w3.org/2000/svg" ' +
          'class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" ' +
          'd="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 ' +
          '0 9 9 0 0118 0z" /></svg>'
        );
      case 'info':
      default:
        return (
          '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ' +
          'class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" ' +
          'stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 ' +
          '12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
        );
    }
  }

  function getHeadingForType(type) {
    switch (type) {
      case 'success': return 'Success';
      case 'warning': return 'Warning';
      case 'error': return 'Error';
      case 'info':
      default: return 'Info';
    }
  }

  // --- GROUPED NOTIFICATION SETUP ---
  const groupedHelper = createGroupedNotificationHelper({
    eventHandlers,
    getIconForType,
    notificationHandler: null // self-reference only if needed by advanced features
  });

  // Utility: Async log notification to backend (fire-and-forget)
  async function logNotificationToServer(message, type, user) {
    try {
      const logPayload = {
        message,
        type,
        timestamp: Date.now() / 1000,
        user: user || (window.currentUser?.username ?? 'unknown')
      };
      await fetch('/api/log_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload)
      });
    } catch (_) {
      // Fail silently. Do not block or throw; UI is always primary.
    }
  }

  // Show a notification (solo or grouped)
  function show(message, type = 'info', options = {}) {
    const container = ensureNotificationContainer();

    // Fire-and-forget backend log
    logNotificationToServer(message, type, options.user);

    // Pass context (if supplied), fallback to type if not present, else 'general'
    const context = options.context
      || (typeof options.module === 'string' && options.module)
      || (typeof options.source === 'string' && options.source)
      || 'general';

    return groupedHelper.showGroupedNotificationByTypeAndTime({
      message,
      type,
      context,
      container
    });
  }

  // Hide a notification—works for both standard and grouped
  function hide(notificationId) {
    // Try active notifications first
    const data = typeof notificationId === 'string'
      ? activeNotifications.get(notificationId)
      : null;

    // Hide standard notification logic
    if (data) {
      const notificationElement = data.element;
      if (!notificationElement) {
        activeNotifications.delete(String(notificationId));
        return false;
      }
      if (data.timeoutId) clearTimeout(data.timeoutId);
      notificationElement.style.transition = 'opacity 0.3s ease-out';
      notificationElement.style.opacity = '0';
      setTimeout(() => {
        try {
          if (notificationElement.parentNode) notificationElement.parentNode.removeChild(notificationElement);
          activeNotifications.delete(String(notificationId));
        } catch (err) {
          console.error('[NotificationHandler] hide/timeout removeChild error:', err);
        }
      }, 300);
      return true;
    }

    // Try grouped notification logic
    let success = false;
    // Allow passing groupKey or group notificationId
    if (typeof notificationId === 'string') {
      groupedHelper.hideGroupedNotification(notificationId);
      success = true;
    }
    return success;
  }

  // Clear all notifications of both types
  function clear() {
    // Standard
    const container = document.getElementById('notificationContainer');
    if (container) {
      Array.from(container.children).forEach((notification) => {
        hide(notification.id);
      });
      activeNotifications.clear();
    }
    // Grouped
    groupedHelper.clearAllGroupedNotifications();
  }

  function cleanup() {
    clear();
    removeMessageListener();
  }

  function getAlertClass(type) {
    switch (type) {
      case 'success': return 'alert-success';
      case 'warning': return 'alert-warning';
      case 'error': return 'alert-error';
      case 'info':
      default: return 'alert-info';
    }
  }

  // --- Optional: window message event integration (not global by default) ---
  function handleNotificationMessages(event) {
    try {
      const message = event.data;
      let handled = false;

      // String-based special command to hide a notification
      if (typeof message === 'string' && message.includes('<hide-notification>')) {
        // E.g., <hide-notification id="notification-XYZ"> or just <hide-notification>
        const idMatch = message.match(/<hide-notification(?:\s+id="([^"]+)")?\s*>/);
        const id = idMatch && idMatch[1];
        if (id) {
          hide(id);
        } else {
          clear();
        }
        handled = true;
      }

      // Object-based message, e.g., { type: 'notification', text: 'Hello', level: 'info' }
      else if (message && typeof message === 'object') {
        if (message.type === 'notification') {
          show(message.text, message.level || 'info', message.options || {});
          handled = true;
        }
      }

      // Send a response if we handled something
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
    if (!trackListener && !eventHandlers.trackListener) {
      throw new Error("[NotificationHandler] addMessageListener requires 'trackListener' to be provided (no direct addEventListener allowed)");
    }
    // Use DI if available
    const tracker = trackListener || eventHandlers.trackListener;
    tracker(target, 'message', handleNotificationMessages, { description: 'NotificationHandler: message' });
    _messageListenerAttached = true;
  }

  function removeMessageListener() {
    if (_messageListenerAttached) {
      window.removeEventListener('message', handleNotificationMessages);
      _messageListenerAttached = false;
    }
  }

  // DependencySystem registration is always handled in orchestrator/app.js.
  // No top-level registration or usage here.

  /**
   * Debug/trace method for app-wide diagnostic messages.
   * Only outputs if window.APP_CONFIG?.DEBUG is true.
   */
  function debug(...args) {
    if (window.APP_CONFIG && window.APP_CONFIG.DEBUG) {
      // Prefer console.debug, but messages traceable via notification infra as well if needed
      // You may choose to toast or store debug logs in DOM—here we just do console.debug;
      // or, to surface trace info in the UI, uncomment below:
      // show(args.join(' '), 'info', { timeout: 2000 });
      console.debug('[DEBUG]', ...args);
    }
  }

  return {
    show,
    hide,
    clear,
    cleanup,
    addMessageListener,
    removeMessageListener,
    getIconForType, // Expose if needed elsewhere
    groupedNotifications: groupedHelper.groupedNotifications, // Expose for diagnostics/testing
    groupedHelper, // Expose the full grouped API if needed
    debug
  };
}

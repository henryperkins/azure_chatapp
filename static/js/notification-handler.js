import { showGroupedNotificationByTypeAndTime } from './handler-helper.js';

/**
 * notification-handler.js
 * DependencySystem/DI-compliant, modular notification handler for robust UX toasts.
 * No implicit global assignment or self-registration. Factory pattern.
 *
 * Usage (in app.js or orchestrator):
 *   import { createNotificationHandler } from './notification-handler.js';
 *   const notificationHandler = createNotificationHandler({ DependencySystem });
 *   DependencySystem.register('notificationHandler', notificationHandler);
 *   notificationHandler.addMessageListener(); // Optional: if cross-window message support is desired
 *
 * Exposes API: { show, hide, clear, cleanup, addMessageListener, removeMessageListener }
 */

export function createNotificationHandler({ DependencySystem } = {}) {
  // Keep track of active notifications and their timeouts
  // Map of notificationId -> { element, timeoutId }
  const activeNotifications = new Map();
  let notificationCounter = 0;
  let _messageListenerAttached = false;

  // Create notification container if it doesn't exist
  function ensureNotificationContainer() {
    let container = document.getElementById('notificationContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notificationContainer';
      container.className = 'toast toast-top toast-end z-[100]';
      document.body.appendChild(container);
      console.debug('Notification container created');
    }
    return container;
  }

  // Show a notification
  function show(message, type = 'info', options = {}) {
    const container = ensureNotificationContainer();

    // Group by type and time window if options.groupByTypeAndTime is true
    if (options.groupByTypeAndTime) {
      return showGroupedNotificationByTypeAndTime({
        message,
        type,
        container
      });
    }

    // Generate a unique ID each time
    const notificationId = `notification-${Date.now()}-${notificationCounter++}`;

    // Build the notification DOM element
    const notification = document.createElement('div');
    const notificationClass = `alert ${getAlertClass(type)} shadow-md my-2 notification-item notification-${type} max-w-lg w-full`;
    notification.id = notificationId;
    notification.className = notificationClass;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.setAttribute('tabindex', '0');

    const iconSvg = getIconForType(type);
    const statusHeading = `<span class="notification-heading font-bold mr-2">${getHeadingForType(type)}</span>`;
    notification.innerHTML = `${iconSvg}${statusHeading}<span>${message}</span>`;

    // If there's an action button
    if (options.action && typeof options.onAction === 'function') {
      const actionButton = document.createElement('button');
      actionButton.className = 'btn btn-sm btn-ghost';
      actionButton.textContent = options.action;
      actionButton.onclick = (e) => {
        e.stopPropagation(); // Prevent click from also dismissing the notification
        options.onAction();
        hide(notificationId);
      };

      notification.innerHTML = `<div class="flex-1 flex items-center">${iconSvg}${statusHeading}<span>${message}</span></div>`;
      notification.appendChild(actionButton);
      notification.classList.add('flex', 'justify-between', 'items-center');
    }

    container.appendChild(notification);

    // Add extra visible class to help style "pop"
    notification.classList.add(`notification-${type}`);

    // Store this notification in the Map along with its timeout ID (if any)
    const timeoutDuration = options.timeout === 0 ? null : (options.timeout || 5000);
    let timeoutId = null;
    if (timeoutDuration) {
      timeoutId = setTimeout(() => hide(notificationId), timeoutDuration);
    }

    activeNotifications.set(notificationId, {
      element: notification,
      timeoutId
    });

    // Default click-to-dismiss behavior; remove if you want to rely on explicit buttons only
    // Use DI event handler if provided, else fallback to raw addEventListener
    (options.trackListener || notification.addEventListener.bind(notification))(
      'click', () => { hide(notificationId); }
    );

    // Focus the notification for screen readers
    setTimeout(() => {
      notification.focus();
    }, 100);

    return notificationId;
  }

  function hide(notificationId) {
    try {
      // Notification can be a string ID or the HTMLElement itself
      // Always try to look up by ID in our Map
      const data = typeof notificationId === 'string'
        ? activeNotifications.get(notificationId)
        : null;

      // If we didn't find a match in the Map, try using getElementById (fallback)
      // This might be a leftover call or partial usage
      const notificationElement = data?.element ||
        (typeof notificationId === 'string' ? document.getElementById(notificationId) : notificationId);

      if (!notificationElement) {
        activeNotifications.delete(String(notificationId));
        return false;
      }

      // Clear any pending timeout if it exists
      if (data?.timeoutId) {
        clearTimeout(data.timeoutId);
      }

      // Fade out
      notificationElement.style.transition = 'opacity 0.3s ease-out';
      notificationElement.style.opacity = '0';

      // Remove from DOM after animation
      setTimeout(() => {
        try {
          if (notificationElement.parentNode) {
            notificationElement.parentNode.removeChild(notificationElement);
          }
          activeNotifications.delete(String(notificationId));
        } catch (err) {
          console.error('[NotificationHandler] hide/timeout removeChild error:', err);
        }
      }, 300);

      return true;
    } catch (err) {
      console.error('[NotificationHandler] hide function error:', err);
      return false;
    }
  }

  function clear() {
    const container = document.getElementById('notificationContainer');
    if (container) {
      Array.from(container.children).forEach((notification) => {
        hide(notification);
      });
      activeNotifications.clear();
    }
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
    if (!trackListener) {
      throw new Error("[NotificationHandler] addMessageListener requires 'trackListener' to be provided (no direct addEventListener allowed)");
    }
    trackListener(target, 'message', handleNotificationMessages, { description: 'NotificationHandler: message' });
    _messageListenerAttached = true;
  }

  function removeMessageListener() {
    if (_messageListenerAttached) {
      window.removeEventListener('message', handleNotificationMessages);
      _messageListenerAttached = false;
    }
  }

  // DependencySystem registration is now always handled in orchestrator (app.js).
  // No top-level registration or usage here.

  return {
    show,
    hide,
    clear,
    cleanup,
    addMessageListener,
    removeMessageListener
  };
}

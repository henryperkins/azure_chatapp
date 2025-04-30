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
  // Keep track of active notifications
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
      console.log('Notification container created');
    }
    return container;
  }

  // Show a notification
  function show(message, type = 'info', options = {}) {
    const container = ensureNotificationContainer();

    const notificationId = `notification-${Date.now()}-${notificationCounter++}`;
    const notification = document.createElement('div');
    notification.id = notificationId;
    notification.className = `alert ${getAlertClass(type)} shadow-md my-2 notification-item`;
    notification.setAttribute('role', 'alert');

    const iconSvg = getIconForType(type);
    notification.innerHTML = `${iconSvg}<span>${message}</span>`;

    if (options.action && typeof options.onAction === 'function') {
      const actionButton = document.createElement('button');
      actionButton.className = 'btn btn-sm btn-ghost';
      actionButton.textContent = options.action;
      actionButton.onclick = (e) => {
        e.stopPropagation();
        options.onAction();
        hide(notificationId);
      };

      notification.innerHTML = `<div class="flex-1">${iconSvg}<span>${message}</span></div>`;
      notification.appendChild(actionButton);
      notification.classList.add('flex', 'justify-between', 'items-center');
    }

    container.appendChild(notification);

    activeNotifications.set(notificationId, notification);

    const timeout = options.timeout === 0 ? null : (options.timeout || 5000);
    if (timeout) {
      setTimeout(() => hide(notificationId), timeout);
    }

    notification.addEventListener('click', () => {
      hide(notificationId);
    });

    return notificationId;
  }

  function hide(notificationId) {
    try {
      const notification = typeof notificationId === 'string'
        ? document.getElementById(notificationId) || activeNotifications.get(notificationId)
        : notificationId;

      if (!notification) {
        // Maybe already cleaned up
        activeNotifications.delete(String(notificationId));
        return false;
      }

      notification.style.transition = 'opacity 0.3s ease-out';
      notification.style.opacity = '0';

      setTimeout(() => {
        try {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
          activeNotifications.delete(String(notificationId));
        } catch (err) {
          // Safe cleanup if already removed
        }
      }, 300);

      return true;
    } catch {
      return false;
    }
  }

  function clear() {
    const container = document.getElementById('notificationContainer');
    if (container) {
      Array.from(container.children).forEach(notification => {
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
        return '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
      case 'warning':
        return '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
      case 'error':
        return '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
      case 'info':
      default:
        return '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    }
  }

  // --- Optional: window message event integration (not global by default) ---
  function handleNotificationMessages(event) {
    try {
      const message = event.data;
      let handled = false;
      // Hide notification message
      if (typeof message === 'string' && message.includes('<hide-notification>')) {
        const idMatch = message.match(/<hide-notification(?:\s+id="([^"]+)")?\s*>/);
        const id = idMatch && idMatch[1];
        if (id) {
          hide(id);
        } else {
          clear();
        }
        handled = true;
      }
      // Notification
      else if (message && typeof message === 'object') {
        if (message.type === 'notification') {
          show(message.text, message.level || 'info', message.options || {});
          handled = true;
        }
      }
      if (handled && event.source && event.origin) {
        try {
          event.source.postMessage({
            type: 'notification-handled',
            success: true,
            messageId: message.id || null
          }, event.origin);
        } catch { /* ignored */ }
      }
    } catch (err) {
      if (event.source && event.origin) {
        try {
          event.source.postMessage({
            type: 'notification-error',
            success: false,
            error: err.message,
            messageId: event.data?.id || null
          }, event.origin);
        } catch {
          // ignore
        }
      }
    }
  }

  function addMessageListener() {
    if (_messageListenerAttached) return;
    window.addEventListener('message', handleNotificationMessages);
    _messageListenerAttached = true;
  }
  function removeMessageListener() {
    if (_messageListenerAttached) {
      window.removeEventListener('message', handleNotificationMessages);
      _messageListenerAttached = false;
    }
  }

  // DependencySystem registration, if provided
  if (DependencySystem && DependencySystem.register && typeof DependencySystem.register === "function") {
    DependencySystem.register('notificationHandler', {
      show, hide, clear, cleanup, addMessageListener, removeMessageListener
    });
  }

  return {
    show,
    hide,
    clear,
    cleanup,
    addMessageListener,
    removeMessageListener
  };
}

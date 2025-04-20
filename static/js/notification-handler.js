/**
 * notification-handler.js
 * -----------------------
 * A robust notification system that safely handles message events
 * including <hide-notification> messages that were previously causing errors.
 */

(function() {
  // Keep track of active notifications
  const activeNotifications = new Map();
  let notificationCounter = 0;

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
  function showNotification(message, type = 'info', options = {}) {
    const container = ensureNotificationContainer();

    // Create notification element
    const notificationId = `notification-${Date.now()}-${notificationCounter++}`;
    const notification = document.createElement('div');
    notification.id = notificationId;
    notification.className = `alert ${getAlertClass(type)} shadow-md my-2 notification-item`;
    notification.setAttribute('role', 'alert');

    // Add notification content
    const iconSvg = getIconForType(type);
    notification.innerHTML = `${iconSvg}<span>${message}</span>`;

    // Add action button if provided
    if (options.action && typeof options.onAction === 'function') {
      const actionButton = document.createElement('button');
      actionButton.className = 'btn btn-sm btn-ghost';
      actionButton.textContent = options.action;
      actionButton.onclick = (e) => {
        e.stopPropagation();
        options.onAction();
        hideNotification(notificationId);
      };

      // Restructure the notification for the button
      notification.innerHTML = `<div class="flex-1">${iconSvg}<span>${message}</span></div>`;
      notification.appendChild(actionButton);
      notification.classList.add('flex', 'justify-between', 'items-center');
    }

    // Add to container
    container.appendChild(notification);

    // Store reference
    activeNotifications.set(notificationId, notification);

    // Auto-hide after timeout
    const timeout = options.timeout === 0 ? null : (options.timeout || 5000);
    if (timeout) {
      setTimeout(() => hideNotification(notificationId), timeout);
    }

    // Click to dismiss
    notification.addEventListener('click', () => {
      hideNotification(notificationId);
    });

    return notificationId;
  }

  // Hide a notification safely
  function hideNotification(notificationId) {
    try {
      const notification = typeof notificationId === 'string'
        ? document.getElementById(notificationId) || activeNotifications.get(notificationId)
        : notificationId;

      if (!notification) {
        console.debug(`Notification ${notificationId} not found, may already be removed`);
        activeNotifications.delete(String(notificationId));
        return false;
      }

      // Fade out animation
      notification.style.transition = 'opacity 0.3s ease-out';
      notification.style.opacity = '0';

      // Remove after animation
      setTimeout(() => {
        try {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
          activeNotifications.delete(String(notificationId));
        } catch (err) {
          console.debug(`Safe cleanup error (already removed): ${err.message}`);
        }
      }, 300);

      return true;
    } catch (err) {
      console.warn(`Error hiding notification: ${err.message}`);
      return false;
    }
  }

  // Clear all notifications
  function clearAllNotifications() {
    const container = document.getElementById('notificationContainer');
    if (container) {
      // Fade out all notifications
      Array.from(container.children).forEach(notification => {
        hideNotification(notification);
      });

      // Clear the tracking map
      activeNotifications.clear();
    }
  }

  // Helper function to get the appropriate alert class
  function getAlertClass(type) {
    switch (type) {
      case 'success': return 'alert-success';
      case 'warning': return 'alert-warning';
      case 'error': return 'alert-error';
      case 'info':
      default: return 'alert-info';
    }
  }

  // Helper function to get the icon for the notification type
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

  // Message event handler for notifications
  async function handleNotificationMessages(event) {
    try {
      const message = event.data;
      let handled = false;

      // Handle hide-notification messages - these were causing the errors
      if (typeof message === 'string' && message.includes('<hide-notification>')) {
        console.debug('Processing <hide-notification> message');

        // Extract notification ID if present
        const idMatch = message.match(/<hide-notification(?:\s+id="([^"]+)")?\s*>/);
        const id = idMatch && idMatch[1];

        if (id) {
          // Hide specific notification
          await hideNotification(id);
        } else {
          // Hide all notifications if no ID specified
          await clearAllNotifications();
        }
        handled = true;
      }
      // Process other notification types
      else if (message && typeof message === 'object') {
        if (message.type === 'notification') {
          await showNotification(message.text, message.level || 'info', message.options || {});
          handled = true;
        }
      }

      // Send response if this is a MessageEvent from another window
      if (handled && event.source && event.origin) {
        event.source.postMessage({
          type: 'notification-handled',
          success: true,
          messageId: message.id || null
        }, event.origin);
      }
    } catch (err) {
      console.warn('Error handling notification message:', err);

      // Send error response if possible
      if (event.source && event.origin) {
        event.source.postMessage({
          type: 'notification-error',
          success: false,
          error: err.message,
          messageId: event.data.id || null
        }, event.origin);
      }
    }
  }

  // Track all event listeners
  const notificationListeners = new Set();

  // Register message event listener with tracking
  function addNotificationListener() {
    window.addEventListener('message', handleNotificationMessages);
    notificationListeners.add({
      element: window,
      type: 'message',
      handler: handleNotificationMessages
    });
  }

  // Cleanup all notification listeners
  function cleanupNotificationListeners() {
    notificationListeners.forEach(({element, type, handler}) => {
      element.removeEventListener(type, handler);
    });
    notificationListeners.clear();
  }

  // Register message event listener
  addNotificationListener();

  // Expose the API
  window.notificationHandler = {
    show: showNotification,
    hide: hideNotification,
    clear: clearAllNotifications,
    cleanup: cleanupNotificationListeners
  };

  // Provide backward compatibility with existing notification system
  if (!window.showNotification) {
    window.showNotification = showNotification;
  }

  console.log('Notification handler initialized');
})();

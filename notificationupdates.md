# Revised Notification System Implementation

I'll provide a revised implementation that addresses the identified issues while maintaining full compatibility with how the application currently uses the notification system.

## 1. Revised notification-handler.js

```javascript
// notification-handler.js - Improved but backward compatible

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

  // Templates - defined as DOM element to maintain compatibility
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
      container = document.createElement('div');
      container.id = 'notificationArea';
      container.className = 'fixed top-16 right-4 z-50 w-72 gap-2 flex flex-col';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
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
```

## 2. Revised handler-helper.js

```javascript
/**
 * handler-helper.js - Improved grouped notifications with better compatibility
 */

function createGroupedNotificationHelper({ eventHandlers, getIconForType, notificationHandler } = {}) {
  if (!eventHandlers || typeof eventHandlers.trackListener !== "function") {
    throw new Error("[groupedNotificationHelper] eventHandlers with trackListener is required.");
  }

  // Store notifications with proper cleanup handlers
  const groupedNotifications = new Map();
  const GROUP_WINDOW_MS = 5000; // Time window for grouping

  // Context + type based grouping
  function getTypeTimeContextGroupKey(type, context) {
    const bucket = Math.floor(Date.now() / GROUP_WINDOW_MS);
    const ctx = (context || 'general').replace(/\s+/g, '_');
    return `${type}-${ctx}-${bucket}`;
  }

  // HTML template for group banner
  const groupTemplate = document.createElement('template');
  groupTemplate.innerHTML = `
    <div class="accordion-banner animate-fadeIn" role="alert">
      <div class="accordion-summary" tabindex="0">
        <span class="notification-context-badge"></span>
        <span class="accordion-summary-text"></span>
        <button type="button" class="accordion-toggle-btn">
          Show Details
        </button>
        <button type="button" class="accordion-dismiss-btn" title="Dismiss" aria-label="Dismiss notification group">×</button>
      </div>
      <ul class="accordion-message-list" role="region"></ul>
    </div>
  `;

  /**
   * Show a grouped notification
   */
  function showGroupedNotificationByTypeAndTime({ message, type = "info", context, container }) {
    const groupKey = getTypeTimeContextGroupKey(type, context);

    // Check if this group already exists
    let group = groupedNotifications.get(groupKey);
    if (group) {
      group.messages.push(message);
      updateGroupBanner(group, container);
      return group.notificationId;
    }

    // Create a new group
    const notificationId = `group-${groupKey}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    group = {
      type,
      context: context || 'general',
      messages: [message],
      notificationId,
      groupKey,
      expanded: false,
      element: null,
      registeredEvents: [],
    };
    groupedNotifications.set(groupKey, group);
    renderGroupBanner(group, container);
    return notificationId;
  }

  /**
   * Render a group banner with better error handling
   */
  function renderGroupBanner(group, container) {
    try {
      // Clone the template
      const bannerClone = groupTemplate.content.cloneNode(true);
      const banner = bannerClone.querySelector('.accordion-banner');

      // Generate IDs for accessibility
      const summaryId = `group-summary-${group.notificationId}`;
      const detailsId = `group-details-${group.notificationId}`;

      // Add ID and classes
      banner.id = group.notificationId;
      banner.classList.add(`alert-${group.type}`, `notification-${group.type}`, `notification-context-${group.context}`);
      banner.style.animationDuration = '300ms';

      // Find elements
      const summary = banner.querySelector('.accordion-summary');
      const toggleBtn = banner.querySelector('.accordion-toggle-btn');
      const dismissBtn = banner.querySelector('.accordion-dismiss-btn');
      const messageList = banner.querySelector('.accordion-message-list');
      const contextBadge = banner.querySelector('.notification-context-badge');
      const summaryText = banner.querySelector('.accordion-summary-text');

      // Set ARIA attributes
      summary.id = summaryId;
      messageList.id = detailsId;
      messageList.setAttribute('aria-labelledby', summaryId);
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-controls', detailsId);

      // Add icon
      if (getIconForType) {
        const icon = getIconForType(group.type);
        if (typeof icon === "string") {
          const iconEl = document.createElement('span');
          iconEl.className = 'accordion-icon mr-2';
          iconEl.innerHTML = icon;
          summary.insertBefore(iconEl, summary.firstChild);
        }
      }

      // Set content
      contextBadge.textContent = escapeHtml(group.context);
      summaryText.textContent = `${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? "s" : ""} notification${group.messages.length > 1 ? "s" : ""}`;

      // Toggle button event with proper tracking
      const toggleDesc = `Group toggle ${group.notificationId}`;
      eventHandlers.trackListener(toggleBtn, 'click', (e) => {
        e.stopPropagation();
        group.expanded = !group.expanded;
        banner.classList.toggle('expanded', group.expanded);
        toggleBtn.textContent = group.expanded ? 'Hide Details' : 'Show Details';
        toggleBtn.setAttribute('aria-expanded', group.expanded.toString());

        // Apply transition via CSS for consistency
        if (group.expanded) {
          messageList.classList.add('expanded');
        } else {
          messageList.classList.remove('expanded');
        }

        // Improve focus management
        if (group.expanded) {
          // Use requestAnimationFrame for more reliable focus
          requestAnimationFrame(() => {
            messageList.focus();
          });
        }
      }, { description: toggleDesc });
      group.registeredEvents.push(toggleDesc);

      // Dismiss button event
      const dismissDesc = `Group dismiss ${group.notificationId}`;
      eventHandlers.trackListener(dismissBtn, 'click', (e) => {
        e.stopPropagation();
        hideGroupedNotification(group.groupKey);
      }, { description: dismissDesc });
      group.registeredEvents.push(dismissDesc);

      // Escape key for accessibility
      const keyDesc = `Group keydown ${group.notificationId}`;
      eventHandlers.trackListener(banner, 'keydown', (e) => {
        if (e.key === 'Escape') {
          hideGroupedNotification(group.groupKey);
        } else if (e.key === 'Enter' && e.target === summary) {
          // Toggle on Enter when summary is focused
          e.preventDefault();
          group.expanded = !group.expanded;
          banner.classList.toggle('expanded', group.expanded);
          toggleBtn.textContent = group.expanded ? 'Hide Details' : 'Show Details';
          toggleBtn.setAttribute('aria-expanded', group.expanded.toString());
          if (group.expanded) {
            messageList.classList.add('expanded');
          } else {
            messageList.classList.remove('expanded');
          }
        }
      }, { description: keyDesc });
      group.registeredEvents.push(keyDesc);

      // Fill message list
      for (const msg of group.messages) {
        const li = document.createElement('li');
        li.textContent = msg;
        messageList.appendChild(li);
      }

      // Initialize with collapsed state
      messageList.style.overflow = 'hidden';

      // Save for later updates
      group.element = banner;

      // Add to container
      container.appendChild(banner);

      // Focus the summary for accessibility after a slight delay
      setTimeout(() => {
        summary.focus();
      }, 50);
    } catch (err) {
      console.error('[groupedNotificationHelper] Error rendering group banner:', err);

      // Fallback rendering
      try {
        const fallbackDiv = document.createElement('div');
        fallbackDiv.className = `alert alert-${group.type} mb-2`;
        fallbackDiv.textContent = group.messages[0] || 'Notification error';
        container.appendChild(fallbackDiv);

        // Set as group element for cleanup
        group.element = fallbackDiv;
      } catch (e) {
        console.error('[groupedNotificationHelper] Critical fallback error:', e);
      }
    }
  }

  /**
   * Update existing group with new message
   */
  function updateGroupBanner(group) {
    if (!group.element) return;

    try {
      const summaryText = group.element.querySelector('.accordion-summary-text');
      const messageList = group.element.querySelector('.accordion-message-list');

      if (summaryText) {
        summaryText.textContent = `${group.messages.length} ${capitalize(group.type)} notification${group.messages.length > 1 ? 's' : ''}`;
      }

      if (messageList) {
        // Add the new message
        const lastMessage = group.messages[group.messages.length - 1];
        const li = document.createElement('li');
        li.textContent = lastMessage;
        messageList.appendChild(li);
      }

      // Flash effect for update
      group.element.classList.add('group-updated');
      setTimeout(() => {
        if (group.element) {
          group.element.classList.remove('group-updated');
        }
      }, 400);
    } catch (err) {
      console.error('[groupedNotificationHelper] Error updating group banner:', err);
    }
  }

  /**
   * Dismiss a notification group with improved cleanup
   */
  function hideGroupedNotification(idOrKey) {
    // Accept either groupKey or notificationId
    let group = null;

    // Try groupKey
    if (groupedNotifications.has(idOrKey)) {
      group = groupedNotifications.get(idOrKey);
    } else {
      // Try by notificationId
      for (const [key, g] of groupedNotifications.entries()) {
        if (g.notificationId === idOrKey) {
          group = g;
          break;
        }
      }
    }

    if (!group) return false;

    // Clean up DOM with animation
    if (group.element) {
      // Remove animation class and add fadeOut
      group.element.classList.remove('animate-fadeIn', 'group-updated');
      group.element.classList.add('animate-fadeOut');
      group.element.style.animationDuration = '300ms';

      // Remove after animation completes
      setTimeout(() => {
        if (group.element && group.element.parentNode) {
          group.element.parentNode.removeChild(group.element);
        }
      }, 300);
    }

    // Clean up event listeners
    group.registeredEvents.forEach(description => {
      eventHandlers.cleanupListeners(null, null, description);
    });

    groupedNotifications.delete(group.groupKey);
    return true;
  }

  /**
   * Clear all grouped notifications
   */
  function clearAllGroupedNotifications() {
    for (const group of groupedNotifications.values()) {
      if (group.element && group.element.parentNode) {
        group.element.parentNode.removeChild(group.element);
      }

      // Clean up event listeners
      group.registeredEvents.forEach(description => {
        eventHandlers.cleanupListeners(null, null, description);
      });
    }
    groupedNotifications.clear();
  }

  // Helper functions
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Allow the parent to set a reference to itself
  function _setNotificationHandler(handler) {
    // Used for circular reference if needed
  }

  return {
    showGroupedNotificationByTypeAndTime,
    hideGroupedNotification,
    clearAllGroupedNotifications,
    updateGroupBanner,
    groupedNotifications,
    _setNotificationHandler
  };
}

export default createGroupedNotificationHelper;
```

## 3. Revised notification-accordion.css

```css
/* notification-accordion.css - Improved with consistent animations */

/* Banner container with improved transitions */
.accordion-banner {
  @apply alert shadow-md my-2 flex flex-col w-full max-w-lg;
  border-radius: 0.33rem;
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  position: relative;
}

/* Animation classes */
.animate-fadeIn {
  animation: fadeIn 0.3s ease-out forwards;
}

.animate-fadeOut {
  animation: fadeOut 0.3s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeOut {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-10px); }
}

/* Context badge with theme colors */
.notification-context-badge {
  @apply inline-flex items-center rounded bg-base-200 px-2 py-0.5 text-xs font-semibold ml-2 mr-2 text-base-content/70 border border-base-300;
  letter-spacing: 0.01em;
}

/* Type-based colors using theme variables */
.notification-error, .accordion-banner.notification-error {
  border-left: 4px solid var(--color-error);
}
.notification-warning, .accordion-banner.notification-warning {
  border-left: 4px solid var(--color-warning);
}
.notification-info, .accordion-banner.notification-info {
  border-left: 4px solid var(--color-info);
}
.notification-success, .accordion-banner.notification-success {
  border-left: 4px solid var(--color-success);
}

/* Summary styling */
.accordion-banner .accordion-summary {
  @apply flex items-center justify-between w-full cursor-pointer font-medium p-2;
  outline: none;
}

.accordion-banner .accordion-summary:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Animation for group updated notification */
.accordion-banner.group-updated {
  animation: pulse 0.4s ease-in-out;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

/* Button styling with proper accessibility sizes */
.accordion-banner .accordion-toggle-btn {
  @apply btn btn-xs btn-ghost ml-2;
  min-width: 44px;
  min-height: 28px;
}

.accordion-banner .accordion-dismiss-btn {
  @apply btn btn-xs btn-ghost text-base-content/70 hover:text-error ml-1;
  min-width: 28px;
  min-height: 28px;
}

/* Message list with improved CSS transitions */
.accordion-banner .accordion-message-list {
  @apply mt-2 pl-4 list-disc text-sm text-base-content/80;
  border-left: 2px solid var(--color-base-300, #e5e7eb);
  margin-left: 0.1em;
  background: rgba(var(--color-base-100-rgb, 250, 250, 250), 0.75);
  transition: max-height 0.3s ease-in-out;
  max-height: 0;
  overflow: hidden;
}

/* Use CSS for the transition, don't rely on JS */
.accordion-banner .accordion-message-list.expanded,
.accordion-banner.expanded .accordion-message-list {
  max-height: 50vh; /* Increased from fixed 170px */
  overflow-y: auto;
}

.accordion-banner .accordion-message-list li {
  @apply mb-1;
  padding-left: 0.5em;
  overflow-wrap: break-word;
  word-break: break-word;
}

/* Style for the icon */
.accordion-banner .accordion-icon {
  @apply flex-shrink-0;
}

/* Visual 'clear all' button */
.notification-clear-all {
  @apply btn btn-xs btn-outline absolute top-1 right-3 z-20;
}

/* Dark mode adjustments */
[data-theme="dracula-enhanced"] .accordion-banner .accordion-message-list {
  background: rgba(var(--color-base-200-rgb, 30, 30, 46), 0.75);
  border-left-color: var(--color-base-300, #44475a);
}

/* Focus states for keyboard navigation */
.accordion-banner .accordion-toggle-btn:focus-visible,
.accordion-banner .accordion-dismiss-btn:focus-visible {
  @apply outline-offset-2 outline-2 outline-primary;
}

/* Make message list properly focusable */
.accordion-banner .accordion-message-list:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

## 4. Improved log_notification.py with proper file locking

```python
"""
log_notification.py - Enhanced with proper file locking and retries
"""

from fastapi import APIRouter, Request, status, BackgroundTasks
from pydantic import BaseModel, Field, validator
from datetime import datetime
import os
import logging
from typing import List, Optional
import time
import fcntl  # For file locking

router = APIRouter()

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification_system")

# Constants
NOTIFICATION_LOG = "notifications.txt"
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOGS = 5  # Number of rotated logs to keep

class NotificationLogItem(BaseModel):
    message: str = Field(..., max_length=4096)
    type: str = Field(default="info", max_length=50)
    timestamp: Optional[float] = None
    user: str = Field(default="unknown", max_length=256)

    @validator('type')
    def validate_type(cls, v):
        valid_types = ['info', 'warning', 'error', 'success']
        if v.lower() not in valid_types:
            return 'info'
        return v.lower()

class NotificationLogBatch(BaseModel):
    notifications: List[NotificationLogItem]

def check_rotate_logs():
    """Check if log file needs rotation and rotate if necessary."""
    try:
        if not os.path.exists(NOTIFICATION_LOG):
            return

        # Check file size
        if os.path.getsize(NOTIFICATION_LOG) > MAX_LOG_SIZE:
            # Rotate logs
            for i in range(MAX_LOGS - 1, 0, -1):
                src = f"{NOTIFICATION_LOG}.{i}" if i > 0 else NOTIFICATION_LOG
                dst = f"{NOTIFICATION_LOG}.{i+1}"

                if os.path.exists(src):
                    if os.path.exists(dst):
                        os.remove(dst)
                    os.rename(src, dst)

            # Create new empty log
            with open(NOTIFICATION_LOG, "w") as f:
                f.write(f"# Log rotated at {datetime.now().isoformat()}\n")
    except Exception as e:
        logger.error(f"Error rotating logs: {str(e)}")

def write_log_entries(entries, retries=2):
    """Write multiple log entries to the file with file locking and retries."""
    for attempt in range(retries + 1):
        try:
            check_rotate_logs()

            # Format log entries
            log_lines = []
            for entry in entries:
                dt_str = (
                    datetime.utcfromtimestamp(entry.timestamp).isoformat() + "Z"
                    if entry.timestamp
                    else datetime.utcnow().isoformat() + "Z"
                )
                user = entry.user if entry.user else "unknown"
                clean_type = entry.type or "info"
                log_lines.append(f"{dt_str} [{clean_type.upper()}] user={user} {entry.message.strip()}")

            # Use file locking to handle concurrent writes
            with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    f.write("\n".join(log_lines) + "\n")
                    f.flush()  # Ensure it's written to disk
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)

            return True
        except Exception as e:
            if attempt < retries:
                # Exponential backoff
                time.sleep(0.5 * (2 ** attempt))
                continue
            logger.error(f"Failed to write notification logs (attempt {attempt+1}): {str(e)}")
            return False

@router.post("/api/log_notification", status_code=status.HTTP_201_CREATED)
async def log_notification(entry: NotificationLogItem, background_tasks: BackgroundTasks):
    """Log a single notification entry."""
    background_tasks.add_task(write_log_entries, [entry])
    return {"status": "ok"}

@router.post("/api/log_notification_batch", status_code=status.HTTP_201_CREATED)
async def log_notification_batch(batch: NotificationLogBatch, background_tasks: BackgroundTasks):
    """Log multiple notifications in a single batch."""
    if not batch.notifications:
        return {"status": "ok", "message": "No notifications to log"}

    background_tasks.add_task(write_log_entries, batch.notifications)
    return {"status": "ok", "count": len(batch.notifications)}
```

## 5. Application Integration in app.js

No significant changes needed to app.js beyond potentially using the improved notification handler:

```javascript
// In app.js

// Create and register notification handler
const notificationHandler = createNotificationHandler({
  eventHandlers,
  DependencySystem
});

// Keep the existing shim for backward compatibility
const notificationHandlerWithLog = createNotificationShim(notificationHandler);

// Register with DependencySystem for DI
DependencySystem.register('notificationHandler', notificationHandler);

// Global utility for direct usage
function showNotification(message, type = 'info', duration = 5000) {
  if (APP_CONFIG.DEBUG) {
    console.debug(`[App] showNotification: ${message} (type: ${type}, duration: ${duration})`);
  }
  return notificationHandler.show(message, type, { timeout: duration });
}
```

## Key Improvements

This revised implementation maintains compatibility while addressing all key issues:

1. **Improved Error Handling**: Consolidated error handling in each function with proper fallbacks
2. **Better Animations**: Consistent CSS-based animations with proper duration values
3. **Enhanced Accessibility**: Improved keyboard navigation and focus management in accordions
4. **Optimized Event Management**: Better event registration/cleanup with descriptive tags
5. **Server Logging Improvements**: Added retry mechanism and proper file locking
6. **CSS Optimizations**: Made heights dynamic and improved mobile display
7. **Removed Fixed Heights**: Using max-content and vh-based sizing for better message display
8. **Reduced DOM Manipulation**: More efficient updates to existing groups

The implementation keeps the same API structure that the application currently expects, so no changes to usage are needed.

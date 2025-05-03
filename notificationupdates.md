# Complete Code Solutions for Notification System Issues

I'll provide targeted fixes for each component without creating additional modules, focusing on the most critical issues identified.

## 1. Fix for `notification-handler.js`

```javascript
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
    const logItem = {
      message,
      type,
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
    notification.classList.add(`notification-${type}`);
    notification.querySelector('.notification-icon').innerHTML = getIconForType(type);
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
```

## 2. Fix for `handler-helper.js`

```javascript
/**
 * Handler-helper.js - Improved grouping notifications implementation
 */

function createGroupedNotificationHelper({ eventHandlers, getIconForType, notificationHandler } = {}) {
  if (!eventHandlers || typeof eventHandlers.trackListener !== "function") {
    throw new Error("[groupedNotificationHelper] eventHandlers with trackListener is required.");
  }

  // Store notifications with proper cleanup handlers
  const groupedNotifications = new Map();
  const GROUP_WINDOW_MS = 10000; // Increased from 5s to 10s for better UX

  // Improved context + type based grouping
  function getTypeTimeContextGroupKey(type, context) {
    const bucket = Math.floor(Date.now() / GROUP_WINDOW_MS);
    const ctx = (context || 'general').replace(/\s+/g, '_');
    return `${type}-${ctx}-${bucket}`;
  }

  // HTML template for group banner
  const groupTemplate = document.createElement('template');
  groupTemplate.innerHTML = `
    <div class="accordion-banner" role="alert">
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

    let group = groupedNotifications.get(groupKey);
    if (group) {
      group.messages.push(message);
      updateGroupBanner(group, container);
      return group.notificationId;
    }

    // New group
    const notificationId = `group-${groupKey}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    group = {
      type,
      context: context || 'general',
      messages: [message],
      notificationId,
      groupKey,
      expanded: false,
      element: null,
      teardown: null,
      registeredEvents: [],
    };
    groupedNotifications.set(groupKey, group);
    renderGroupBanner(group, container);
    return notificationId;
  }

  /**
   * Dismiss a notification group
   */
  function hideGroupedNotification(idOrKey) {
    // Accept either groupKey or notificationId for convenience
    let group = null;

    // Try groupKey
    if (groupedNotifications.has(idOrKey)) {
      group = groupedNotifications.get(idOrKey);
    } else {
      // Try by notificationId
      group = Array.from(groupedNotifications.values()).find(
        g => g.notificationId === idOrKey
      );
    }

    if (!group) return false;

    // Clean up DOM element with animation
    if (group.element && group.element.parentNode) {
      group.element.classList.add('animate-fadeOut');
      group.element.style.animationDuration = '300ms';

      setTimeout(() => {
        if (group.element && group.element.parentNode) {
          group.element.parentNode.removeChild(group.element);
        }
      }, 300);
    }

    // Clean up event listeners
    if (Array.isArray(group.registeredEvents)) {
      group.registeredEvents.forEach(description => {
        eventHandlers.cleanupListeners(null, null, description);
      });
    }

    if (typeof group.teardown === "function") {
      group.teardown();
    }

    groupedNotifications.delete(group.groupKey);
    return true;
  }

  /**
   * Clear all grouped notifications
   */
  function clearAllGroupedNotifications() {
    for (let group of groupedNotifications.values()) {
      if (group.element && group.element.parentNode) {
        group.element.parentNode.removeChild(group.element);
      }

      // Clean up event listeners
      if (Array.isArray(group.registeredEvents)) {
        group.registeredEvents.forEach(description => {
          eventHandlers.cleanupListeners(null, null, description);
        });
      }

      if (typeof group.teardown === "function") {
        group.teardown();
      }
    }
    groupedNotifications.clear();
  }

  /**
   * Render a group banner using cloneNode for better performance
   */
  function renderGroupBanner(group, container) {
    // Generate IDs for accessibility connections
    const summaryId = `group-summary-${group.notificationId}`;
    const detailsId = `group-details-${group.notificationId}`;

    // Clone the template
    const bannerClone = groupTemplate.content.cloneNode(true);
    const banner = bannerClone.querySelector('.accordion-banner');

    // Add ID and classes
    banner.id = group.notificationId;
    banner.classList.add(`alert-${group.type}`, `notification-${group.type}`, `notification-context-${group.context}`);

    // Find elements to customize
    const summary = banner.querySelector('.accordion-summary');
    const toggleBtn = banner.querySelector('.accordion-toggle-btn');
    const dismissBtn = banner.querySelector('.accordion-dismiss-btn');
    const messageList = banner.querySelector('.accordion-message-list');
    const contextBadge = banner.querySelector('.notification-context-badge');
    const summaryText = banner.querySelector('.accordion-summary-text');

    // Set ARIA attributes for accessibility
    summary.id = summaryId;
    messageList.id = detailsId;
    messageList.setAttribute('aria-labelledby', summaryId);
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', detailsId);

    // Add icon if available
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
    summaryText.textContent = `${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? "s" : ""} occurred`;

    // Toggle button event
    const toggleDescription = `Group toggle ${group.notificationId}`;
    eventHandlers.trackListener(toggleBtn, 'click', (e) => {
      e.stopPropagation();
      group.expanded = !group.expanded;
      banner.classList.toggle('expanded', group.expanded);
      toggleBtn.textContent = group.expanded ? 'Hide Details' : 'Show Details';
      toggleBtn.setAttribute('aria-expanded', group.expanded.toString());

      // Use CSS transition instead of display:none
      if (group.expanded) {
        messageList.style.maxHeight = '170px';
      } else {
        messageList.style.maxHeight = '0';
      }

      if (group.expanded) {
        setTimeout(() => messageList.focus && messageList.focus(), 100);
      }
    }, { description: toggleDescription });
    group.registeredEvents.push(toggleDescription);

    // Dismiss button event
    const dismissDescription = `Group dismiss ${group.notificationId}`;
    eventHandlers.trackListener(dismissBtn, 'click', (e) => {
      e.stopPropagation();
      hideGroupedNotification(group.groupKey);
    }, { description: dismissDescription });
    group.registeredEvents.push(dismissDescription);

    // Keyboard shortcut for dismiss
    const keydownDescription = `Group keydown ${group.notificationId}`;
    eventHandlers.trackListener(banner, 'keydown', (e) => {
      if (e.key === 'Escape') hideGroupedNotification(group.groupKey);
    }, { description: keydownDescription });
    group.registeredEvents.push(keydownDescription);

    // Focus management
    setTimeout(() => {
      summary && summary.focus && summary.focus();
    }, 100);

    // Fill message list
    for (const msg of group.messages) {
      const li = document.createElement('li');
      li.textContent = msg;
      messageList.appendChild(li);
    }

    // Initialize with collapsed state
    messageList.style.maxHeight = '0';
    messageList.style.overflow = 'hidden';
    messageList.style.transition = 'max-height 0.3s ease-in-out';

    // Register teardown function
    group.element = banner;
    group.teardown = () => {
      group.registeredEvents.forEach(description => {
        eventHandlers.cleanupListeners(null, null, description);
      });
    };

    // Add to container
    container.appendChild(banner);
  }

  /**
   * Update an existing group banner with new messages
   */
  function updateGroupBanner(group, container, initial = false) {
    if (!group.element) return;

    const summaryText = group.element.querySelector('.accordion-summary-text');
    const messageList = group.element.querySelector('.accordion-message-list');

    if (summaryText) {
      summaryText.textContent = `${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? 's' : ''} occurred`;
    }

    if (messageList) {
      // Only add the new message instead of rebuilding the entire list
      const lastMessage = group.messages[group.messages.length - 1];
      const li = document.createElement('li');
      li.textContent = lastMessage;
      messageList.appendChild(li);
    }

    // Flash effect for update
    if (!initial && !group.expanded) {
      group.element.classList.add('group-updated');
      setTimeout(() => group.element.classList.remove('group-updated'), 400);
    }
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

  return {
    showGroupedNotificationByTypeAndTime,
    hideGroupedNotification,
    clearAllGroupedNotifications,
    updateGroupBanner,
    groupedNotifications,
  };
}

export default createGroupedNotificationHelper;
```

## 3. CSS Improvements in `notification-accordion.css`

```css
/* notification-accordion.css - Improved with theme variables and transitions */

/* Banner container */
.accordion-banner {
  @apply alert shadow-md my-2 flex flex-col w-full max-w-lg;
  border-radius: 0.33rem;
  transition: box-shadow 0.2s, border-color 0.2s;
  position: relative;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeOut {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-10px); }
}

.animate-fadeIn {
  animation: fadeIn 0.3s ease-out;
}

.animate-fadeOut {
  animation: fadeOut 0.3s ease-out;
}

/* Context badge with theme colors */
.notification-context-badge {
  @apply inline-flex items-center rounded bg-base-200 px-2 py-0.5 text-xs font-semibold ml-2 mr-2 text-base-content/70 border border-base-300;
  letter-spacing: 0.01em;
}

/* Context-based colors using theme variables */
.accordion-banner.notification-context-ProjectListComponent {
  border-left: 4px solid var(--color-primary);
}
.accordion-banner.notification-context-ProjectDetailsComponent {
  border-left: 4px solid var(--color-secondary);
}
.accordion-banner.notification-context-ModalManager {
  border-left: 4px solid var(--color-accent);
}
.accordion-banner.notification-context-App {
  border-left: 4px solid var(--color-success);
}

/* Priority/sticky styling */
.accordion-banner.sticky,
.accordion-banner.priority {
  border-left: 6px solid var(--color-error);
  background: linear-gradient(90deg, color-mix(in srgb, var(--color-error) 10%, transparent) 0 70%, transparent 100%);
  z-index: 120;
}

/* Using theme variables for alert types */
.accordion-banner.alert-error {
  border-left-color: var(--color-error);
}
.accordion-banner.alert-warning {
  border-left-color: var(--color-warning);
}
.accordion-banner.alert-info {
  border-left-color: var(--color-info);
}
.accordion-banner.alert-success {
  border-left-color: var(--color-success);
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
  0% { box-shadow: 0 0 0 0 var(--color-primary-focus, rgba(99, 102, 241, 0.4)); }
  70% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}

/* Button styling */
.accordion-banner .accordion-toggle-btn {
  @apply btn btn-xs btn-ghost ml-2;
}

.accordion-banner .accordion-dismiss-btn {
  @apply btn btn-xs btn-ghost text-base-content/70 hover:text-error ml-1;
  min-width: 1.5rem;
  min-height: 1.5rem;
}

/* Message list with smooth transitions */
.accordion-banner .accordion-message-list {
  @apply mt-2 pl-4 list-disc text-sm text-base-content/80;
  border-left: 2px solid var(--color-base-300, #e5e7eb);
  margin-left: 0.1em;
  background: rgba(var(--color-base-100-rgb, 250, 250, 250), 0.75);
  overflow: hidden;
  transition: max-height 0.3s ease-in-out;
  max-height: 0;
}

.accordion-banner.expanded .accordion-message-list {
  max-height: 170px;
  overflow-y: auto;
}

.accordion-banner .accordion-message-list li {
  @apply mb-1;
  padding-left: 0.5em;
  word-break: break-all;
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

## 4. Server-side Batch Logging Update in `routes/log_notification.py`

```python
"""
log_notification.py
-------------------
Route for recording frontend notifications to a server-side text file.
Improved with batching, log rotation, and better error handling.
"""

from fastapi import APIRouter, Request, status, BackgroundTasks
from pydantic import BaseModel, Field, validator
from datetime import datetime
import os
import logging
from typing import List, Optional
import time

router = APIRouter()

# Configure a proper logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notification_system")

# Constants
NOTIFICATION_LOG = "notifications.txt"
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB
MAX_LOGS = 5  # Number of rotated logs to keep

class NotificationLogItem(BaseModel):
    message: str = Field(..., max_length=4096)
    type: str = Field(default="info", max_length=50)
    timestamp: Optional[float] = None  # Unix timestamp (optional)
    user: str = Field(default="unknown", max_length=256)

    @validator('type')
    def validate_type(cls, v):
        valid_types = ['info', 'warning', 'error', 'success']
        if v.lower() not in valid_types:
            return 'info'  # Default to info if not valid
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

def write_log_entries(entries):
    """Write multiple log entries to the file."""
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

        # Write all entries in one operation
        with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
            f.write("\n".join(log_lines) + "\n")

    except Exception as e:
        logger.error(f"Failed to write notification logs: {str(e)}")

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

## 5. Enhanced Notification Integration for `app.js`

```javascript
// Add this to app.js where notificationHandler is created

// Initialize notification handler with proper error fallbacks
const notificationHandler = createNotificationHandler({
  eventHandlers,
  DependencySystem
});

// Add a global loading handler to hide notifications on page changes
document.addEventListener('locationchange', function() {
  // Only clear notifications if they're not important
  const container = document.getElementById('notificationArea');
  if (container) {
    const notificationsToKeep = Array.from(container.children).filter(
      el => el.classList.contains('priority') || el.classList.contains('sticky')
    );

    // Clear non-important notifications
    notificationHandler.clear();

    // Re-add important ones
    notificationsToKeep.forEach(el => container.appendChild(el));
  }
});

// Add notification error boundary
const originalShow = notificationHandler.show;
notificationHandler.show = function(message, type, options) {
  try {
    return originalShow.call(this, message, type, options);
  } catch (err) {
    console.error('Failed to show notification:', err);
    // Create a simple fallback notification without using any complex functions
    try {
      const container = document.getElementById('notificationArea') || document.body;
      const div = document.createElement('div');
      div.textContent = message || 'Notification error';
      div.className = 'alert alert-' + (type || 'error');
      div.style.margin = '10px';
      div.style.padding = '10px';
      container.appendChild(div);
      setTimeout(() => div.remove(), 5000);
    } catch (e) {
      // Last resort
      console.error('Critical notification error:', message, e);
    }
    return null;
  }
};

// Enhanced notification shim with error trapping
function createNotificationShim(h) {
  const safeFn = (fn, fallbackType) => (...args) => {
    try {
      return fn.apply(h, args);
    } catch (err) {
      console.error(`Error in notification ${fallbackType}:`, err);
      try {
        // Simple DOM-based fallback
        const msg = args[0] || `[${fallbackType}] Notification failed`;
        const div = document.createElement('div');
        div.textContent = msg;
        div.className = `alert alert-${fallbackType}`;
        div.style.margin = '10px';
        div.style.padding = '10px';
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 5000);
      } catch (e) {
        // Last resort: console
        console.error(`[${fallbackType}] ${args[0]}`, e);
      }
    }
  };

  return {
    ...h,
    log: safeFn(h.show || ((...args) => h(args[0], 'info')), 'info'),
    warn: safeFn(h.show || ((...args) => h(args[0], 'warning')), 'warning'),
    error: safeFn(h.show || ((...args) => h(args[0], 'error')), 'error'),
    confirm: safeFn(h.show || ((...args) => h(args[0], 'info')), 'info'),
    debug: safeFn(h.debug || ((...args) => console.debug(...args)), 'debug')
  };
}
```

These solutions address the major issues identified in the notification system while maintaining compatibility with the existing modules. The changes:

1. Improve DOM rendering through templates
2. Enhance event handling and cleanup
3. Fix the show/hide implementation with smooth transitions
4. Implement efficient batched server logging
5. Use theme variables for better dark mode support
6. Add error boundaries to prevent crashes
7. Better accessibility for keyboard navigation

All changes work within the existing architecture and don't create additional modules, focusing instead on making the current components more robust and maintainable.

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
        <button type="button" class="accordion-copy-btn" aria-label="Copy notifications" title="Copy notification messages to clipboard">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/></svg>
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
      const copyBtn = banner.querySelector('.accordion-copy-btn');
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
        // No longer needed: only .expanded on parent

        // Improve focus management
        if (group.expanded) {
          // Use requestAnimationFrame for more reliable focus
          requestAnimationFrame(() => {
            messageList.focus();
          });
        }
      }, { description: toggleDesc });
      group.registeredEvents.push(toggleDesc);

      // Copy button event
      if (copyBtn) {
        const copyDesc = `Group copy ${group.notificationId}`;
        const originalIcon = copyBtn.innerHTML;
        const checkIcon =
          '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom text-success" viewBox="0 0 20 20" fill="currentColor"><path d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7 7a1 1 0 0 1-1.414 0l-3-3a1 1 0 1 1 1.414-1.414L9 11.586l6.293-6.293a1 1 0 0 1 1.414-.003z"/></svg>';
        eventHandlers.trackListener(copyBtn, 'click', (e) => {
          e.stopPropagation();
          // Join all messages with newlines for copying
          const text = group.messages.join('\n');
          // Use modern clipboard API
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.innerHTML = checkIcon;
            copyBtn.classList.add('text-success');
            setTimeout(() => {
              copyBtn.innerHTML = originalIcon;
              copyBtn.classList.remove('text-success');
            }, 1200);
          }).catch(() => {
            if (notificationHandler && typeof notificationHandler.show === 'function') {
              notificationHandler.show('Copy failed', 'error', { timeout: 2000, context: 'notificationHelper' });
            }
          });
        }, { description: copyDesc });
        group.registeredEvents.push(copyDesc);
      }

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

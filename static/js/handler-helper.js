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
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, '\\"') // Replace " with \"
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

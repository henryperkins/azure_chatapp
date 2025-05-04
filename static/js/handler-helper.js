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

  // DaisyUI-compliant group accordion template
  const groupTemplate = document.createElement('template');
  groupTemplate.innerHTML = `
    <div class="collapse collapse-arrow bg-base-100 border border-base-300 animate-fadeIn" role="alert">
      <!-- Radio input drives expansion. The name is set dynamically to allow multiple groups, only one expanded per context/type group. -->
      <input type="radio" name="" class="group-radio" />
      <div class="collapse-title flex items-center gap-2 font-semibold">
        <span class="notification-context-badge"></span>
        <span class="accordion-icon"></span>
        <span class="accordion-summary-text"></span>
        <button type="button" class="accordion-copy-btn btn btn-xs btn-ghost ml-1" aria-label="Copy notifications" title="Copy notification messages to clipboard">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom" viewBox="0 0 20 20" fill="currentColor"><path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/></svg>
        </button>
        <button type="button" class="accordion-dismiss-btn btn btn-xs btn-ghost ml-1" title="Dismiss" aria-label="Dismiss notification group">×</button>
      </div>
      <div class="collapse-content pt-2">
        <ul class="accordion-message-list list-disc pl-4 text-sm"></ul>
      </div>
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
      // DaisyUI radio accordion pattern: name = notification-group-{type}-{context}, only one open per group
      const groupName = `notification-group-${group.type}-${group.context}`;
      const isChecked = true; // New groups start expanded
      const checkedAttr = isChecked ? 'checked' : '';

      // Clone the template
      const bannerClone = groupTemplate.content.cloneNode(true);
      const banner = bannerClone.querySelector('.collapse');

      // Set up/Name radio input and mark as checked for the first render
      const radio = banner.querySelector('.group-radio');
      radio.setAttribute('name', groupName);
      radio.checked = true;
      // Store key on element for later toggling if needed
      radio.dataset.groupKey = group.groupKey;

      // Add notification-specific state classes
      banner.id = group.notificationId;
      banner.classList.add(`alert-${group.type}`, `notification-${group.type}`, `notification-context-${group.context}`);
      banner.style.animationDuration = '300ms';

      // Find elements
      const contextBadge = banner.querySelector('.notification-context-badge');
      const iconContainer = banner.querySelector('.accordion-icon');
      const summaryText = banner.querySelector('.accordion-summary-text');
      const copyBtn = banner.querySelector('.accordion-copy-btn');
      const dismissBtn = banner.querySelector('.accordion-dismiss-btn');
      const messageList = banner.querySelector('.accordion-message-list');

      // ARIA for accessibility
      banner.setAttribute('aria-live', 'polite');

      // Add icon
      if (getIconForType) {
        const icon = getIconForType(group.type);
        if (typeof icon === "string") {
          iconContainer.innerHTML = icon;
        }
      }

      // Set content
      contextBadge.textContent = escapeHtml(group.context);
      summaryText.textContent = `${group.messages.length} ${capitalize(group.type)} notification${group.messages.length > 1 ? 's' : ''}`;

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

      // Add a "Copy All" button if there are multiple messages
      if (group.messages.length > 1 && summaryText && summaryText.parentNode) {
        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = 'btn btn-xs btn-ghost ml-1';
        copyAllBtn.setAttribute('aria-label', 'Copy all messages');
        copyAllBtn.setAttribute('title', 'Copy all messages to clipboard');
        copyAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" class="inline-block" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9 2a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H9z" />
          <path d="M3 8a2 2 0 012-2v10h8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
        </svg>`;
        const copyAllDesc = `Group copy-all ${group.notificationId}`;
        eventHandlers.trackListener(copyAllBtn, 'click', (e) => {
          e.stopPropagation();
          const allText = group.messages.join('\n');
          navigator.clipboard.writeText(allText).then(() => {
            const originalText = copyAllBtn.innerHTML;
            copyAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" class="inline-block text-success" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
            </svg> Copied!`;
            copyAllBtn.classList.add('text-success');
            setTimeout(() => {
              copyAllBtn.innerHTML = originalText;
              copyAllBtn.classList.remove('text-success');
            }, 1500);
          }).catch(() => {
            if (notificationHandler && typeof notificationHandler.show === 'function') {
              notificationHandler.show('Copy failed', 'error', { timeout: 2000, context: 'notificationHelper' });
            }
          });
        }, { description: copyAllDesc });
        group.registeredEvents.push(copyAllDesc);
        // Insert after summaryText in the collapse-title
        summaryText.parentNode.insertBefore(copyAllBtn, summaryText.nextSibling);
      }

      // Dismiss button event
      const dismissDesc = `Group dismiss ${group.notificationId}`;
      eventHandlers.trackListener(dismissBtn, 'click', (e) => {
        e.stopPropagation();
        hideGroupedNotification(group.groupKey);
      }, { description: dismissDesc });
      group.registeredEvents.push(dismissDesc);

      // Keyboard: Escape to dismiss the whole group
      const keyDesc = `Group keydown ${group.notificationId}`;
      eventHandlers.trackListener(banner, 'keydown', (e) => {
        if (e.key === 'Escape') {
          hideGroupedNotification(group.groupKey);
        }
      }, { description: keyDesc });
      group.registeredEvents.push(keyDesc);

      // Fill message list in collapse-content
      for (const msg of group.messages) {
        const li = document.createElement('li');
        li.textContent = msg;
        messageList.appendChild(li);
      }

      // Save for later updates
      group.element = banner;

      // Add to container (.toast) at the top
      container.insertBefore(banner, container.firstChild);

      // Focus the collapse-title for accessibility after slight delay
      setTimeout(() => {
        const summary = banner.querySelector('.collapse-title');
        if(summary) summary.focus();
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

      // DaisyUI doesn't animate group, but for compatibility flash effect is preserved if desired
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

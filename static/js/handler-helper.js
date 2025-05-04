/**
 * handler-helper.js - Improved grouped notifications with better compatibility.
 * Follows strict DI: no direct global references like document/navigator.
 *
 * @param {Object} deps - Required dependencies.
 * @param {EventHandlers} deps.eventHandlers - Must have trackListener(), cleanupListeners().
 * @param {Function} deps.getIconForType - A function(type) that returns an inline SVG string.
 * @param {NotificationHandler} [deps.notificationHandler] - Optional parent notification handler for fallback errors, etc.
 * @param {Object} [deps.domAPI] - DOM access abstraction { createElement, createTemplate, etc. }.
 *   - createElement(tagName) => HTMLElement
 *   - createTemplate(htmlString) => HTMLTemplateElement or a custom object
 * @param {Object} [deps.globalScope] - Safe references to "window" equivalents for setTimeout, clipboard, etc.
 *
 * @returns {GroupedNotificationHelper} - An object containing the API:
 *   {
 *     showGroupedNotificationByTypeAndTime,
 *     hideGroupedNotification,
 *     clearAllGroupedNotifications,
 *     updateGroupBanner,
 *     groupedNotifications,
 *     _setNotificationHandler
 *   }
 */

function createGroupedNotificationHelper({
  eventHandlers,
  getIconForType,
  notificationHandler,
  domAPI,
  globalScope
} = {}) {
  // 1. Validate minimal requirements
  if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
    throw new Error('[groupedNotificationHelper] eventHandlers with trackListener is required.');
  }
  if (!domAPI || typeof domAPI.createElement !== 'function') {
    throw new Error('[groupedNotificationHelper] domAPI with createElement is required.');
  }

  // Safe references to timer and clipboard
  const _setTimeout = (globalScope && globalScope.setTimeout) || setTimeout;
  const _clipboard = globalScope?.navigator?.clipboard;

  // 2. Internal storage for grouped notifications:
  // Key format: "type-context-(5-second-bucket)"
  const groupedNotifications = new Map();
  const GROUP_WINDOW_MS = 5000;

  function getTypeTimeContextGroupKey(type, context) {
    const bucket = Math.floor(Date.now() / GROUP_WINDOW_MS);
    const ctx = (context || 'general').replace(/\s+/g, '_');
    return `${type}-${ctx}-${bucket}`;
  }

  // 3. We create a reusable template, but do so via  domAPI if available
  //    For example, domAPI might have "createTemplate(htmlString)" or we fall back to a manual approach.
  let groupTemplate = null;
  if (typeof domAPI.createTemplate === 'function') {
    groupTemplate = domAPI.createTemplate(`
      <div class="accordion-banner collapse collapse-arrow bg-base-100 border border-base-300 animate-fadeIn" role="alert">
        <!-- Radio input for expansion. -->
        <input type="radio" name="" class="group-radio" />
        <div class="collapse-title flex items-center gap-2 font-semibold">
          <span class="notification-context-badge"></span>
          <span class="accordion-icon"></span>
          <span class="accordion-summary-text"></span>
          <button
            type="button"
            class="accordion-copy-btn btn btn-xs btn-ghost ml-1"
            aria-label="Copy notifications"
            title="Copy notification messages to clipboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true"
                 class="inline-block align-text-bottom"
                 viewBox="0 0 20 20"
                 fill="currentColor">
              <path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1
                       a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2
                       a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7
                       a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6
                       a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/>
            </svg>
          </button>
          <button
            type="button"
            class="accordion-dismiss-btn btn btn-xs btn-ghost ml-1"
            title="Dismiss"
            aria-label="Dismiss notification group"
          >×</button>
        </div>
        <div class="collapse-content pt-2">
          <ul class="accordion-message-list list-disc pl-4 text-sm"></ul>
        </div>
      </div>
    `);
  } else {
    // Fallback manual template creation
    const templateEl = (globalScope?.document?.createElement?.('template')) || domAPI.createElement('template');
    templateEl.innerHTML = `
      <div class="accordion-banner collapse collapse-arrow bg-base-100 border border-base-300 animate-fadeIn" role="alert">
        <input type="radio" name="" class="group-radio" />
        <div class="collapse-title flex items-center gap-2 font-semibold">
          <span class="notification-context-badge"></span>
          <span class="accordion-icon"></span>
          <span class="accordion-summary-text"></span>
          <button
            type="button"
            class="accordion-copy-btn btn btn-xs btn-ghost ml-1"
            aria-label="Copy notifications"
            title="Copy notification messages to clipboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true"
                 class="inline-block align-text-bottom"
                 viewBox="0 0 20 20"
                 fill="currentColor">
              <path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1h1
                       a2 2 0 0 0 2-2V7.83a2 2 0 0 0-.59-1.42l-2.83-2.83A2 2 0 0 0 14.17 3H14V2
                       a2 2 0 0 0-2-2H8zm2 1v1H8V3h2zm3.59 2 2.41 2.41V13a1 1 0 0 1-1 1h-1V7
                       a2 2 0 0 0-2-2h-6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6a2 2 0 0 0 2 2v8h-6
                       a1 1 0 0 1-1-1V7.83a1 1 0 0 1 .29-.71z"/>
            </svg>
          </button>
          <button
            type="button"
            class="accordion-dismiss-btn btn btn-xs btn-ghost ml-1"
            title="Dismiss"
            aria-label="Dismiss notification group"
          >×</button>
        </div>
        <div class="collapse-content pt-2">
          <ul class="accordion-message-list list-disc pl-4 text-sm"></ul>
        </div>
      </div>
    `;
    groupTemplate = templateEl;
  }

  // --------------------------
  // MAIN API METHODS
  // --------------------------

  /**
   * Show or update a grouped notification by type/context/time bucket
   */
  function showGroupedNotificationByTypeAndTime({ message, type = 'info', context, container }) {
    const groupKey = getTypeTimeContextGroupKey(type, context);

    // If existing group found, append message and update
    let group = groupedNotifications.get(groupKey);
    if (group) {
      group.messages.push(message);
      updateGroupBanner(group);
      return group.notificationId;
    }

    // Otherwise create new
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
   * Renders a new "group banner" element
   */
  function renderGroupBanner(group, container) {
    try {
      if (!container) {
        throw new Error('[groupedNotificationHelper] Container is required to render a group banner.');
      }

      // Derived DaisyUI group name pattern
      const groupName = `notification-group-${group.type}-${group.context}`;

      let banner = null;
      if (groupTemplate.content) {
        // Standard HTMLTemplateElement
        const clone = groupTemplate.content.cloneNode(true);
        banner = clone.querySelector('.accordion-banner');
      } else {
        // Fallback for environments where <template> is not standard
        const tempWrapper = domAPI.createElement('div');
        tempWrapper.innerHTML = groupTemplate.innerHTML;
        banner = tempWrapper.querySelector('.accordion-banner');
      }

      if (!banner) {
        throw new Error('[groupedNotificationHelper] Failed to clone group banner template.');
      }
      banner.id = group.notificationId;
      banner.classList.add(`alert-${group.type}`, `notification-${group.type}`, `notification-context-${group.context}`);
      banner.style.animationDuration = '300ms';

      // Insert radio name
      const radio = banner.querySelector('.group-radio');
      radio.setAttribute('name', groupName);
      radio.checked = true; // start expanded
      radio.dataset.groupKey = group.groupKey;

      // ARIA improvements
      banner.setAttribute('aria-live', 'polite');
      const ariaDescId = `group-desc-${group.notificationId}`;
      const ariaDesc = domAPI.createElement('span');
      ariaDesc.id = ariaDescId;
      ariaDesc.className = 'sr-only';
      ariaDesc.textContent = `${group.messages.length} ${group.type} notifications in group "${group.context}".`;
      banner.setAttribute('aria-describedby', ariaDescId);
      banner.appendChild(ariaDesc);

      // Expand/collapse announcement
      radio.addEventListener('change', () => {
        if (radio.checked) {
          ariaDesc.textContent = `Expanded grouped notifications for ${group.context}, showing ${group.messages.length}.`;
        } else {
          ariaDesc.textContent = `Collapsed grouped notifications for ${group.context}.`;
        }
      });

      // Hook sub-elements
      const contextBadge = banner.querySelector('.notification-context-badge');
      const iconContainer = banner.querySelector('.accordion-icon');
      const summaryText = banner.querySelector('.accordion-summary-text');
      const copyBtn = banner.querySelector('.accordion-copy-btn');
      const dismissBtn = banner.querySelector('.accordion-dismiss-btn');
      const messageList = banner.querySelector('.accordion-message-list');

      if (contextBadge) {
        contextBadge.textContent = escapeHtml(group.context);
      }

      if (typeof getIconForType === 'function' && iconContainer) {
        iconContainer.innerHTML = getIconForType(group.type);
      }

      if (summaryText) {
        summaryText.textContent = summaryTextForGroup(group);
      }

      // Fill message list
      for (const msg of group.messages) {
        const li = domAPI.createElement('li');
        li.textContent = msg;
        messageList.appendChild(li);
      }

      // Copy single group
      if (copyBtn) {
        const desc = `Group copy ${group.notificationId}`;
        const originalIcon = copyBtn.innerHTML;
        const successIcon = `
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false"
               aria-hidden="true" class="inline-block align-text-bottom text-success"
               viewBox="0 0 20 20" fill="currentColor">
            <path d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7 7
                     a1 1 0 0 1-1.414 0l-3-3
                     a1 1 0 1 1 1.414-1.414
                     L9 11.586l6.293-6.293
                     a1 1 0 0 1 1.414-.003z"/>
          </svg>
        `;
        eventHandlers.trackListener(copyBtn, 'click', (e) => {
          e.stopPropagation();
          const textAll = group.messages.join('\n');
          if (_clipboard && typeof _clipboard.writeText === 'function') {
            _clipboard.writeText(textAll).then(() => {
              copyBtn.innerHTML = successIcon;
              copyBtn.classList.add('text-success');
              _setTimeout(() => {
                copyBtn.innerHTML = originalIcon;
                copyBtn.classList.remove('text-success');
              }, 1500);
            }).catch(() => {
              if (notificationHandler?.show) {
                notificationHandler.show('Copy failed', 'error', { timeout: 2000, context: 'notificationHelper' });
              }
            });
          }
        }, { description: desc });
        group.registeredEvents.push(desc);
      }

      // Dismiss
      const dismissDesc = `Group dismiss ${group.notificationId}`;
      eventHandlers.trackListener(dismissBtn, 'click', (e) => {
        e.stopPropagation();
        hideGroupedNotification(group.groupKey);
      }, { description: dismissDesc });
      group.registeredEvents.push(dismissDesc);

      // Keyboard ESC
      const keyDesc = `Group keydown ${group.notificationId}`;
      eventHandlers.trackListener(banner, 'keydown', (e) => {
        if (e.key === 'Escape') hideGroupedNotification(group.groupKey);
      }, { description: keyDesc });
      group.registeredEvents.push(keyDesc);

      // Insert banner into container top
      container.insertBefore(banner, container.firstChild);

      // Save reference
      group.element = banner;

      // Focus for accessibility after short delay
      _setTimeout(() => {
        const titleEl = banner.querySelector('.collapse-title');
        if (titleEl?.focus) {
          titleEl.focus();
        }
      }, 50);
    } catch (err) {
      console.error('[groupedNotificationHelper] Error rendering group banner:', err);
      // Minimal fallback
      try {
        const fallbackDiv = domAPI.createElement('div');
        fallbackDiv.className = `alert alert-${group.type} mb-2`;
        fallbackDiv.textContent = group.messages[0] || 'Notification error';
        container.appendChild(fallbackDiv);
        group.element = fallbackDiv;
      } catch (e2) {
        console.error('[groupedNotificationHelper] Critical fallback error:', e2);
      }
    }
  }

  /**
   * Update an existing group with an additional message
   */
  function updateGroupBanner(group) {
    if (!group.element) return;

    try {
      const summaryText = group.element.querySelector('.accordion-summary-text');
      const messageList = group.element.querySelector('.accordion-message-list');
      if (summaryText) {
        summaryText.textContent = summaryTextForGroup(group);
      }
      if (messageList) {
        const lastMsg = group.messages[group.messages.length - 1];
        const li = domAPI.createElement('li');
        li.textContent = lastMsg;
        messageList.appendChild(li);
      }

      group.element.classList.add('group-updated');
      _setTimeout(() => {
        if (group.element) {
          group.element.classList.remove('group-updated');
        }
      }, 400);
    } catch (err) {
      console.error('[groupedNotificationHelper] Error updating group banner:', err);
    }
  }

  /**
   * Hide a specific group, either by groupKey or notificationId
   */
  function hideGroupedNotification(idOrKey) {
    let group = null;

    // Try key directly
    if (groupedNotifications.has(idOrKey)) {
      group = groupedNotifications.get(idOrKey);
    } else {
      // Else search by notificationId
      for (const [k, g] of groupedNotifications.entries()) {
        if (g.notificationId === idOrKey) {
          group = g;
          break;
        }
      }
    }
    if (!group) return false;

    // Animate removal
    if (group.element) {
      group.element.classList.remove('animate-fadeIn', 'group-updated');
      group.element.classList.add('animate-fadeOut');
      group.element.style.animationDuration = '300ms';
      _setTimeout(() => {
        if (group.element?.parentNode) {
          group.element.parentNode.removeChild(group.element);
        }
      }, 300);
    }
    // Cleanup event listeners
    group.registeredEvents.forEach((desc) => {
      eventHandlers.cleanupListeners(null, null, desc);
    });
    groupedNotifications.delete(group.groupKey);
    return true;
  }

  /**
   * Clear ALL grouped notifications
   */
  function clearAllGroupedNotifications() {
    for (const group of groupedNotifications.values()) {
      if (group.element?.parentNode) {
        group.element.parentNode.removeChild(group.element);
      }
      group.registeredEvents.forEach((desc) => {
        eventHandlers.cleanupListeners(null, null, desc);
      });
    }
    groupedNotifications.clear();
  }

  // --------------------------
  // Utility
  // --------------------------
  function summaryTextForGroup(group) {
    const count = group.messages.length;
    return `${count} ${capitalize(group.type)} notification${count > 1 ? 's' : ''}`;
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Optional setter for the main notification handler
   * (useful if we need a circular reference for fallback usage)
   */
  function _setNotificationHandler(handler) {
    // e.g. notificationHandler = handler;
  }

  // -----------
  // Return API
  // -----------
  return {
    showGroupedNotificationByTypeAndTime,
    hideGroupedNotification,
    clearAllGroupedNotifications,
    updateGroupBanner,
    groupedNotifications,
    _setNotificationHandler,
  };
}

export default createGroupedNotificationHelper;

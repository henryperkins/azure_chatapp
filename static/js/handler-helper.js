/**
 * Handler-helper.js
 * Accordion/grouped notification implementation (factory/DI style).
 * Accepts { eventHandlers, getIconForType, notificationHandler }.
 *
 * Harmonizes tracked event handling, styling, accessibility, and DOM safety.
 */

/**
 * Factory for grouped notification helpers.
 * @param {Object} deps
 * @param {Object} deps.eventHandlers - Required; must have trackListener, cleanupListeners.
 * @param {Function} deps.getIconForType - Optional; returns HTML string or Element.
 * @param {Object} deps.notificationHandler - Optional; for unified lifecycle.
 */
function createGroupedNotificationHelper({ eventHandlers, getIconForType, notificationHandler } = {}) {
  if (!eventHandlers || typeof eventHandlers.trackListener !== "function") {
    throw new Error("[groupedNotificationHelper] eventHandlers with trackListener is required.");
  }

  // Explicit storage keyed by groupKey
  const groupedNotifications = new Map();
  const GROUP_WINDOW_MS = 5000;

  function getTypeTimeContextGroupKey(type, context) {
    const bucket = Math.floor(Date.now() / GROUP_WINDOW_MS);
    const ctx = (context || 'general').replace(/\s+/g, '_');
    return `${type}-${ctx}-${bucket}`;
  }

  /**
   * Show a grouped notification, returns group notificationId (not groupKey!).
   * Accepts .context field (string).
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
      teardown: null, // for lifecycle
    };
    groupedNotifications.set(groupKey, group);
    renderGroupBanner(group, container);
    return notificationId;
  }

  /**
   * Programmatically dismiss a notification group by groupId or groupKey.
   */
  function hideGroupedNotification(idOrKey) {
    // Accept either groupKey or notificationId for convenience.
    let group = null;
    // Try groupKey
    if (groupedNotifications.has(idOrKey)) group = groupedNotifications.get(idOrKey);
    else group = Array.from(groupedNotifications.values()).find(
      g => g.notificationId === idOrKey
    );
    if (!group) return;
    if (group.element && group.element.parentNode) {
      group.element.parentNode.removeChild(group.element);
    }
    if (typeof group.teardown === "function") group.teardown();
    groupedNotifications.delete(group.groupKey);
  }

  /**
   * Remove all grouped notifications.
   */
  function clearAllGroupedNotifications() {
    for (let group of groupedNotifications.values()) {
      if (group.element && group.element.parentNode) {
        group.element.parentNode.removeChild(group.element);
      }
      if (typeof group.teardown === "function") group.teardown();
    }
    groupedNotifications.clear();
  }

  /**
   * Render one group banner (standalone DOM).
   */
  function renderGroupBanner(group, container) {
    // --- Accessibility IDs ---
    const summaryId = `group-summary-${group.notificationId}`;
    const detailsId = `group-details-${group.notificationId}`;

    // Banner root
    const banner = document.createElement("div");
    banner.className = `accordion-banner alert alert-${group.type} notification-item notification-${group.type}`;
    banner.id = group.notificationId;
    banner.setAttribute("role", "alert");

    // Icon (optional)
    let iconHtml = "";
    if (getIconForType) {
      const icon = getIconForType(group.type);
      if (typeof icon === "string") iconHtml = icon;
      else if (icon instanceof HTMLElement) iconHtml = icon.outerHTML;
    }

    // --- Compose inner structure ---
    banner.innerHTML = `
      <div class="accordion-summary" id="${summaryId}">
        ${iconHtml}
        <span class="notification-context-badge">${escapeHtml(group.context)}</span>
        <span class="accordion-summary-text">${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? "s" : ""} occurred</span>
        <button type="button" class="accordion-toggle-btn"
          aria-expanded="false" aria-controls="${detailsId}" id="toggle-${group.notificationId}">
          Show Details
        </button>
        <button type="button" class="accordion-dismiss-btn" title="Dismiss" aria-label="Dismiss notification group">&times;</button>
      </div>
      <ul class="accordion-message-list" id="${detailsId}" role="region" aria-labelledby="${summaryId}" style="display: none"></ul>
    `;

    // Dom nodes
    const toggleBtn = banner.querySelector(".accordion-toggle-btn");
    const dismissBtn = banner.querySelector(".accordion-dismiss-btn");
    const messageList = banner.querySelector(".accordion-message-list");
    const summaryDiv = banner.querySelector(".accordion-summary");

    // --- Tracked Event Handlers ---
    // Toggle details
    eventHandlers.trackListener(toggleBtn, "click", (e) => {
      e.stopPropagation();
      group.expanded = !group.expanded;
      banner.classList.toggle("expanded", group.expanded);
      toggleBtn.textContent = group.expanded ? "Hide Details" : "Show Details";
      toggleBtn.setAttribute("aria-expanded", group.expanded.toString());
      messageList.style.display = group.expanded ? "" : "none";
      if (group.expanded) {
        // Move focus to message list for a11y if desired, otherwise keep summary.
        setTimeout(() => messageList.focus && messageList.focus(), 50);
      }
    }, { description: "Accordion toggle group details" });

    // Dismiss button (explicit; never on banner itself)
    eventHandlers.trackListener(dismissBtn, "click", (e) => {
      e.stopPropagation();
      hideGroupedNotification(group.groupKey);
    }, { description: "Accordion dismiss group" });

    // Keyboard shortcut: dismiss on Escape within banner
    eventHandlers.trackListener(banner, "keydown", (e) => {
      if (e.key === "Escape") hideGroupedNotification(group.groupKey);
    }, { description: "Accordion dismiss via Escape" });

    // Focus management: focus summary when mounted
    setTimeout(() => {
      summaryDiv && summaryDiv.focus && summaryDiv.focus();
    }, 50);

    // Fill messages (safe)
    updateGroupBanner(group, container, true, messageList);

    // Attach
    group.element = banner;
    group.teardown = () => {
      // Detach any further resources if needed
      // eventHandlers.cleanupListeners is presumed called by owner on teardown
    };
    container.appendChild(banner);
  }

  /**
   * Update summary + message list for a given group.
   * Safe DOM, textContent only.
   */
  function updateGroupBanner(group, container, initial = false, listOverride = null) {
    if (!group.element) return;
    const summaryText = group.element.querySelector(".accordion-summary-text");
    const messageList = listOverride
      ? listOverride
      : group.element.querySelector(".accordion-message-list");
    if (summaryText) {
      summaryText.textContent =
        `${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? "s" : ""} occurred`;
    }
    if (messageList) {
      messageList.innerHTML = "";
      group.messages.forEach(msg => {
        const li = document.createElement("li");
        li.textContent = msg;
        messageList.appendChild(li);
      });
    }
    if (!initial && !group.expanded) {
      // Flash or highlight on update
      group.element.classList.add("ring", "ring-primary");
      setTimeout(() => group.element.classList.remove("ring", "ring-primary"), 300);
    }
  }

  // --- Helpers ---
  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Escape HTML for safe context label rendering
  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return '';
    return unsafe
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, '\\"')       // Replace " with \"
      .replace(/'/g, "&#039;");
  }

  // --- API ---
  return {
    showGroupedNotificationByTypeAndTime,
    hideGroupedNotification,
    clearAllGroupedNotifications,
    updateGroupBanner,
    groupedNotifications, // exposed if necessary for advanced usage
  };
}

export default createGroupedNotificationHelper;

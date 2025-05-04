/**
 * handler-helper.js – Grouped-notification helper (v2.0)
 * Fully DI, listener-safe, bucket window configurable.
 *
 * Factory signature:
 *   createGroupedNotificationHelper({
 *     eventHandlers,              // required – {trackListener, cleanupListeners}
 *     getIconForType,             // required – fn(type) → SVG string
 *     domAPI,                     // required – {createElement, createTemplate}
 *     globalScope,                // optional – window-like object
 *     notificationHandler,        // optional – back-reference
 *     groupWindowMs = 5000,       // optional – bucket width
 *     classMap = {}               // optional – override of CSS class names
 *   })
 *
 * Returns:
 *   {
 *     showGroupedNotificationByTypeAndTime,
 *     hideGroupedNotification,
 *     clearAllGroupedNotifications,
 *     groupedNotifications,          // Map
 *     getGroupKey,                   // exported for unit tests
 *     destroy                         // removes all banners+listeners
 *   }
 */

export function createGroupedNotificationHelper({
  eventHandlers,
  getIconForType,
  domAPI,
  globalScope = typeof window !== 'undefined' ? window : {},
  notificationHandler = null,
  groupWindowMs = 5000,
  classMap = {},
} = {}) {
  if (!eventHandlers?.trackListener || !domAPI?.createElement) {
    throw new Error('[GroupedHelper] eventHandlers.trackListener and domAPI.createElement are required');
  }

  /* ---------- 1. Utilities ---------- */
  const _setTimeout = globalScope.setTimeout || setTimeout;
  const _clipboard = globalScope.navigator?.clipboard;
  const classes = {
    banner: 'accordion-banner collapse collapse-arrow bg-base-100 border border-base-300',
    fadeIn: 'animate-fadeIn',
    fadeOut: 'animate-fadeOut',
    summaryText: 'accordion-summary-text',
    ...classMap,
  };
  const groupedNotifications = new Map();       // key → group object

  /* ---------- 2. Key helper (exported for tests) ---------- */
  function getGroupKey(type, context) {
    const bucket = Math.floor(Date.now() / groupWindowMs);
    const ctx = (context || 'general').replace(/\s+/g, '_');
    return `${type}-${ctx}-${bucket}`;
  }

  /* ---------- 3. Template ---------- */
  const templateHTML = `
    <div class="${classes.banner} ${classes.fadeIn}" role="alert" style="animation-duration:300ms;">
      <input type="radio" class="group-radio" name="">
      <div class="collapse-title flex items-center gap-2 font-semibold">
        <span class="notification-context-badge"></span>
        <span class="accordion-icon"></span>
        <span class="${classes.summaryText}"></span>
        <button type="button" class="accordion-copy-btn btn btn-xs btn-ghost ml-1" aria-label="Copy"></button>
        <button type="button" class="accordion-dismiss-btn btn btn-xs btn-ghost ml-auto" aria-label="Dismiss">×</button>
      </div>
      <div class="collapse-content accordion-message-list mt-1 space-y-1"></div>
    </div>`;
  const groupTemplate = domAPI.createTemplate?.(templateHTML) ?? (() => {
    const t = domAPI.createElement('template');
    t.innerHTML = templateHTML.trim();
    return t;
  })();

  /* ---------- 4. Render + update ---------- */
  function renderGroupBanner(group, container) {
    const clone = groupTemplate.content.cloneNode(true);
    const banner = clone.querySelector(`.${classes.banner.split(' ')[0]}`);

    banner.id = group.notificationId;
    banner.classList.add(`alert-${group.type}`, `notification-${group.type}`);

    container.appendChild(banner); // Append first to DOM

    // Now select elements from live DOM
    const radio = banner.querySelector('.group-radio');
    const ctxBadge = banner.querySelector('.notification-context-badge');
    const iconBox = banner.querySelector('.accordion-icon');
    const summary = banner.querySelector(`.${classes.summaryText}`);
    const copyBtn = banner.querySelector('.accordion-copy-btn');
    const dismiss = banner.querySelector('.accordion-dismiss-btn');
    const listBox = banner.querySelector('.accordion-message-list');

    radio.name = `notif-group-${group.type}-${group.context}`;
    const collapseTitle = banner.querySelector('.collapse-title');
    eventHandlers.trackListener(collapseTitle, 'click', () => {
      radio.checked = !radio.checked;
      banner.classList.toggle('collapse-open', radio.checked);
    }, {
      description: 'Accordion Title Toggle'
    });

    ctxBadge.textContent = group.context;
    iconBox.innerHTML = getIconForType(group.type);
    summary.textContent = `${group.messages.length} ${group.type}`;

    // messages
    listBox.innerHTML = group.messages.map(m => `<p>${m}</p>`).join('');

    /* listeners – all via trackListener so we can clean later */
    group.registeredEvents = [
      eventHandlers.trackListener(radio, 'change', () => banner.classList.toggle('collapse-open', radio.checked), { description: 'Grp radio' }),
      eventHandlers.trackListener(copyBtn, 'click', () => {
        if (!_clipboard) return;
        const originalIcon = copyBtn.innerHTML;
        const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" focusable="false" aria-hidden="true" class="inline-block align-text-bottom"><path d="M16.704 5.29a1 1 0 0 1 .007 1.414l-7 7a1 1 0 0 1-1.414 0l-3-3a1 1 0 1 1 1.414-1.414L9 11.586l6.293-6.293a1 1 0 0 1 1.414-.003z"/></svg>';
        _clipboard.writeText(group.messages.join('\n'))
          .then(() => {
            copyBtn.innerHTML = checkIcon;
            copyBtn.classList.add('text-success');
            setTimeout(() => {
              copyBtn.innerHTML = originalIcon;
              copyBtn.classList.remove('text-success');
            }, 1200);
          })
          .catch(err => console.error('[GroupedCopy] Clipboard failed:', err));
      }, { description: 'Grouped Notification Copy' }),
      eventHandlers.trackListener(dismiss, 'click', () => hideGroupedNotification(group.notificationId), { description: 'Grp dismiss' }),
    ];

    group.element = banner;
  }

  function updateGroupBanner(group) {
    const summary = group.element?.querySelector(`.${classes.summaryText}`);
    const listBox = group.element?.querySelector('.accordion-message-list');
    if (summary) summary.textContent = `${group.messages.length} ${group.type}`;
    if (listBox) listBox.innerHTML = group.messages.map(m => `<p>${m}</p>`).join('');
  }

  /* ---------- 5. Public API ---------- */
  function showGroupedNotificationByTypeAndTime({ message, type, context = 'general', container }) {
    const key = getGroupKey(type, context);
    let group = groupedNotifications.get(key);

    if (group) {                                  // existing bucket
      group.messages.push(message);
      updateGroupBanner(group);
      return group.notificationId;
    }

    // new bucket
    const notificationId = `group-${key}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    group = { type, context, messages: [message], notificationId, registeredEvents: [], element: null };
    groupedNotifications.set(key, group);
    renderGroupBanner(group, container);
    return notificationId;
  }

  function hideGroupedNotification(id) {
    for (const group of groupedNotifications.values()) {
      if (group.notificationId === id) {
        group.registeredEvents.forEach(e => eventHandlers.cleanupListeners(group.element, null, e.description));
        group.element?.remove();
        groupedNotifications.delete(getGroupKey(group.type, group.context));
        return true;
      }
    }
    return false;
  }

  function clearAllGroupedNotifications() {
    groupedNotifications.forEach(g => hideGroupedNotification(g.notificationId));
    groupedNotifications.clear();
  }

  function destroy() { clearAllGroupedNotifications(); }

  return {
    showGroupedNotificationByTypeAndTime,
    hideGroupedNotification,
    clearAllGroupedNotifications,
    groupedNotifications,
    getGroupKey,
    destroy,
    _setNotificationHandler: h => (notificationHandler = h),
  };
}

export default createGroupedNotificationHelper;

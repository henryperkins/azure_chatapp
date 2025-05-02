const groupedNotifications = new Map();
const GROUP_WINDOW_MS = 5000; // 5 seconds window

function getTypeTimeGroupKey(type) {
  const bucket = Math.floor(Date.now() / GROUP_WINDOW_MS);
  return `${type}-${bucket}`;
}

export function showGroupedNotificationByTypeAndTime({ message, type = 'info', container }) {
  const groupKey = getTypeTimeGroupKey(type);

  let group = groupedNotifications.get(groupKey);
  if (group) {
    group.messages.push(message);
    updateGroupBanner(group, container);
    return group.notificationId;
  }

  // Create new group
  const notificationId = `group-${groupKey}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  group = {
    type,
    messages: [message],
    notificationId,
    expanded: false,
    element: null
  };
  groupedNotifications.set(groupKey, group);
  renderGroupBanner(group, container);
  return notificationId;
}

function renderGroupBanner(group, container) {
  const banner = document.createElement('div');
  banner.className = `accordion-banner alert alert-${group.type}`;
  banner.id = group.notificationId;

  banner.innerHTML = `
    <div class="accordion-summary">
      <span class="accordion-summary-text">${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? 's' : ''} occurred</span>
      <button type="button" class="accordion-toggle-btn">Show Details</button>
    </div>
    <ul class="accordion-message-list"></ul>
  `;

  // Toggle logic
  const toggleBtn = banner.querySelector('.accordion-toggle-btn');
  const messageList = banner.querySelector('.accordion-message-list');
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    group.expanded = !group.expanded;
    banner.classList.toggle('expanded', group.expanded);
    toggleBtn.textContent = group.expanded ? 'Hide Details' : 'Show Details';
  };

  // Dismiss on click outside summary (optional: you can remove this if undesired)
  banner.addEventListener('click', (e) => {
    if (e.target === banner) {
      banner.remove();
      groupedNotifications.delete(group.notificationId);
    }
  });

  group.element = banner;
  updateGroupBanner(group, container, true);
  container.appendChild(banner);
}

function updateGroupBanner(group, container, initial = false) {
  if (!group.element) return;
  const summaryText = group.element.querySelector('.accordion-summary-text');
  const messageList = group.element.querySelector('.accordion-message-list');
  if (summaryText) {
    summaryText.textContent = `${group.messages.length} ${capitalize(group.type)}${group.messages.length > 1 ? 's' : ''} occurred`;
  }
  if (messageList) {
    messageList.innerHTML = group.messages.map(msg => `<li>${msg}</li>`).join('');
  }
  if (!initial && !group.expanded) {
    // Optionally, flash the banner or bring to front
    group.element.classList.add('ring', 'ring-primary');
    setTimeout(() => group.element.classList.remove('ring', 'ring-primary'), 300);
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

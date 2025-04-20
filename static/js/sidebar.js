/**
 * sidebar.js - Consolidated sidebar functionality
 * Handles all sidebar UI including:
 * - Toggle behavior (mobile/desktop)
 * - Tab management (Recent, Starred, Projects)
 * - Search functionality
 * - Starred conversations
 * - Authentication-dependent UI
 */

// Use eventHandler.js's trackListener for consistency
const trackListener = window.eventHandlers?.trackListener || ((element, eventType, handler, options) => {
  if (!element) return;
  element.addEventListener(eventType, handler, options);
});

// Core state variables
let sidebar = null;
let isOpen = false;
let toggleBtn = null;
let closeBtn = null;
let isAnimating = false;

// Tab configuration - centralized for use by other modules
const sidebarTabConfig = {
  recent: {
    buttonId: 'recentChatsTab',
    sectionId: 'recentChatsSection',
    loader: () => window.loadConversationList?.(),
  },
  starred: {
    buttonId: 'starredChatsTab',
    sectionId: 'starredChatsSection',
    loader: loadStarredConversations,
  },
  projects: {
    buttonId: 'projectsTab',
    sectionId: 'projectsSection',
    loader: () => window.projectManager?.loadProjects('all')
  },
};

/**
 * Initialize the sidebar core elements and state
 */
function initializeSidebar() {
  // Initialize core elements
  sidebar = document.getElementById('mainSidebar');
  toggleBtn = document.getElementById('navToggleBtn');
  closeBtn = document.getElementById('closeSidebarBtn');

  if (!sidebar) {
    console.warn('Sidebar element not found in DOM');
    return false;
  }

  // Set initial state based on viewport
  const isMobile = window.innerWidth < 768;
  isOpen = !isMobile; // Default: closed on mobile, open on desktop

  // Initialize tabs
  setupSidebarTabs();

  // Set up event listeners
  setupSidebarEventListeners();

  // Update UI state
  updateSidebarState();

  console.log('Sidebar initialized successfully');
  return true;
}

/**
 * Set up all sidebar event listeners
 */
function setupSidebarEventListeners() {
  // Toggle button
  if (toggleBtn) {
    trackListener(toggleBtn, 'click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });

    trackListener(toggleBtn, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
      }
    });
  }

  // Close button
  if (closeBtn) {
    trackListener(closeBtn, 'click', () => toggleSidebar(false));
  }

  // Touch gestures for mobile
  let touchStartX = 0;
  const threshold = 30;

  trackListener(document, 'touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  trackListener(document, 'touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    const isMobile = window.innerWidth < 768;
    if (!isMobile) return;

    if (touchStartX < 50 && deltaX > threshold) {
      toggleSidebar(true);
      e.preventDefault();
    } else if (isOpen && touchStartX > window.innerWidth - 50 && deltaX < -threshold) {
      toggleSidebar(false);
      e.preventDefault();
    }
  }, { passive: false });

  // Window resize handling
  trackListener(window, 'resize', () => {
    const isMobile = window.innerWidth < 768;
    if (isMobile && isOpen) {
      toggleSidebar(false);
    }
    if (!isMobile) {
      isOpen = true;
      updateSidebarState();
    }
  }, { passive: true });
}

/**
 * Toggle sidebar open/closed state
 * @param {boolean} [forceState] Optional state to force
 */
function toggleSidebar(forceState) {
  if (isAnimating) return;
  isAnimating = true;

  // Determine new state
  const newState = typeof forceState === 'boolean' ? forceState : !isOpen;
  isOpen = newState;

  // Update UI
  updateSidebarState();

  // Mark animation complete after transition
  trackListener(sidebar, 'transitionend', () => {
    isAnimating = false;
  }, { once: true });
}

/**
 * Update the sidebar visibility state and related UI
 */
function updateSidebarState() {
  const isMobile = window.innerWidth < 768;

  // Update sidebar transform
  if (isMobile) {
    sidebar.classList.toggle('-translate-x-full', !isOpen);
    sidebar.classList.toggle('translate-x-0', isOpen);
  } else {
    sidebar.classList.add('translate-x-0');
    sidebar.classList.remove('-translate-x-full');
  }

  // Manage body scroll on mobile
  document.body.classList.toggle('sidebar-open', isOpen && isMobile);

  // Update backdrop
  updateBackdrop(isOpen && isMobile);

  // Update accessibility attributes
  updateAccessibilityAttributes();
}

/**
 * Update accessibility attributes
 */
function updateAccessibilityAttributes() {
  if (!toggleBtn || !sidebar) return;

  toggleBtn.setAttribute('aria-expanded', isOpen);
  toggleBtn.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
  sidebar.setAttribute('aria-hidden', !isOpen);

  // Manage focus when closing
  if (closeBtn && !isOpen && document.activeElement === closeBtn) {
    toggleBtn.focus();
  }
}

/**
 * Create/update/remove backdrop element for mobile
 */
function updateBackdrop(show) {
  let backdrop = document.getElementById('sidebarBackdrop');

  if (show && !backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'fixed inset-0 bg-black/50 z-[99] md:hidden';
    backdrop.setAttribute('aria-hidden', 'true');

    trackListener(backdrop, 'click', () => toggleSidebar(false));
    document.body.appendChild(backdrop);
  } else if (!show && backdrop) {
    backdrop.remove();
  }
}

/**
 * Set up sidebar tabs and activate the default tab
 */
function setupSidebarTabs() {
  // Initialize tab elements
  Object.entries(sidebarTabConfig).forEach(([name, config]) => {
    const button = document.getElementById(config.buttonId);
    const content = document.getElementById(config.sectionId);

    if (!button || !content) {
      console.warn(`Tab elements missing for ${name}`);
      return;
    }

    // Set ARIA attributes
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', config.sectionId);
    content.setAttribute('role', 'tabpanel');
    content.setAttribute('aria-labelledby', config.buttonId);

    // Add click handler
    trackListener(button, 'click', () => activateTab(name));
  });

  // Determine active tab based on context
  const isProjectsPage = window.location.pathname.includes('/projects') ||
                        document.getElementById('projectManagerPanel');
  let activeTab = localStorage.getItem('sidebarActiveTab') ||
                 (isProjectsPage ? 'projects' : 'recent');

  activateTab(activeTab);
}

/**
 * Activate a specific sidebar tab
 */
function activateTab(tabName) {
  if (!sidebarTabConfig[tabName]) return;

  // Save preference
  localStorage.setItem('sidebarActiveTab', tabName);

  // Update UI for all tabs
  Object.entries(sidebarTabConfig).forEach(([name, config]) => {
    const isActive = name === tabName;
    const button = document.getElementById(config.buttonId);
    const content = document.getElementById(config.sectionId);

    if (button) {
      button.setAttribute('aria-selected', isActive);
      button.classList.toggle('project-tab-btn-active', isActive);
      button.classList.toggle('text-gray-500', !isActive);
    }

    if (content) {
      content.classList.toggle('hidden', !isActive);
    }
  });

  // Load data for active tab if authenticated
  if (window.auth?.isAuthenticated?.()) {
    setTimeout(() => sidebarTabConfig[tabName].loader(), 300);
  }
}

/**
 * Load starred conversations
 */
async function loadStarredConversations() {
  const container = document.getElementById('starredConversations');
  if (!container) return;

  try {
    // Check authentication
    const isAuthenticated = await window.auth.isAuthenticated();
    if (!isAuthenticated) {
      container.innerHTML = `
        <li class="text-center text-gray-500 py-4">
          Please log in to view starred conversations
        </li>
      `;
      return;
    }

    // Get starred conversations
    const response = await window.apiRequest('/api/preferences/starred');
    const starredIds = response.data || [];

    if (starredIds.length === 0) {
      container.innerHTML = `
        <li class="text-center text-gray-500 py-4">
          No starred conversations yet. Click the star icon on any conversation to add it here.
        </li>
      `;
      return;
    }

    // Try to load from chatConfig
    const allConversations = window.chatConfig?.conversations || [];
    const starredConversations = allConversations.filter(conv => starredIds.includes(conv.id));

    if (starredConversations.length === 0) {
      container.innerHTML = `
        <li class="text-center text-gray-500 py-4">
          No starred conversations available. Some conversations may have been deleted.
        </li>
      `;
      return;
    }

    container.innerHTML = '';
    starredConversations.forEach(conv => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center justify-between';

      const title = document.createElement('span');
      title.className = 'truncate';
      title.textContent = conv.title || `Conversation ${conv.id}`;

      const unstarBtn = document.createElement('button');
      unstarBtn.className = 'text-yellow-500 hover:text-yellow-600';
      unstarBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519
                   4.674a1 1 0 00.95.69h4.915c.969 0
                   1.371 1.24.588 1.81l-3.976 2.888a1
                   1 0 00-.363 1.118l1.518 4.674c.3.922-.755
                   1.688-1.538 1.118l-3.976-2.888a1 1 0
                   00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1
                   1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0
                   00.951-.69l1.519-4.674z" />
        </svg>
      `;

      unstarBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleStarConversation(conv.id);
        li.remove();

        if (container.children.length === 0) {
          container.innerHTML = `
            <li class="text-center text-gray-500 py-4">
              No starred conversations yet. Click the star icon on any conversation to add it here.
            </li>
          `;
        }
      });

      li.appendChild(title);
      li.appendChild(unstarBtn);

      li.addEventListener('click', () => {
        if (window.location.pathname.includes('/projects')) {
          window.location.href = `/?chatId=${conv.id}`;
        } else if (typeof window.loadConversation === 'function') {
          window.loadConversation(conv.id);
        }
      });

      container.appendChild(li);
    });

  } catch (error) {
    console.error('Failed to load starred conversations:', error);
    if (error.status === 401 && window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, 'Loading starred conversations');
    }
    container.innerHTML = `
      <li class="text-center text-red-500 py-4">
        Failed to load starred conversations. Please try again later.
      </li>
    `;
  }
}

/**
 * Toggle star status for a conversation
 */
async function toggleStarConversation(conversationId) {
  const isAuthenticated = await window.auth.isAuthenticated();
  if (!isAuthenticated) {
    console.error('[Auth] User is not authenticated');
    return false;
  }

  // Retrieve starred conversation list from local storage
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
  const index = starredIds.indexOf(conversationId);

  if (index === -1) {
    starredIds.push(conversationId);
  } else {
    starredIds.splice(index, 1);
  }
  localStorage.setItem('starredConversations', JSON.stringify(starredIds));

  // Update to server
  try {
    await window.apiRequest('/api/user/preferences', 'PATCH', {
      starred_conversations: starredIds,
    });
  } catch (error) {
    console.error('Failed to update starred conversations on server:', error);
    if (error.status === 401 && window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, 'Updating starred conversations');
    }
  }

  return index === -1;
}

/**
 * Check if a conversation is starred
 */
function isConversationStarred(conversationId) {
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
  return starredIds.includes(conversationId);
}

/**
 * Search conversation list in the sidebar
 */
function searchSidebarConversations(query) {
  const container = document.getElementById('sidebarConversations');
  if (!container) return;

  const items = container.querySelectorAll('li');
  const searchTerm = query.toLowerCase();
  let hasMatches = false;

  items.forEach(item => {
    if (item.classList.contains('text-center') && item.classList.contains('text-gray-500')) {
      return;
    }
    const title = item.querySelector('.truncate')?.textContent.toLowerCase() || '';
    const isMatch = title.includes(searchTerm);
    item.classList.toggle('hidden', !isMatch);
    if (isMatch) hasMatches = true;
  });

  const emptyState = container.querySelector('.text-center.text-gray-500.py-4');
  if (!hasMatches) {
    if (!emptyState) {
      const newEmptyState = document.createElement('li');
      newEmptyState.className = 'text-center text-gray-500 py-4';
      newEmptyState.textContent = 'No matching conversations found';
      container.appendChild(newEmptyState);
    }
  } else if (emptyState?.textContent === 'No matching conversations found') {
    emptyState.remove();
  }
}

/**
 * Search projects list in the sidebar
 */
function searchSidebarProjects(query) {
  const container = document.getElementById('sidebarProjects');
  if (!container) return;

  const items = container.querySelectorAll('li');
  const searchTerm = query.toLowerCase();
  let hasMatches = false;

  items.forEach(item => {
    if (item.classList.contains('text-center') && item.classList.contains('text-gray-500')) {
      return;
    }
    const title = item.querySelector('span')?.textContent.toLowerCase() || '';
    const isMatch = title.includes(searchTerm);
    item.classList.toggle('hidden', !isMatch);
    if (isMatch) hasMatches = true;
  });

  const emptyState = container.querySelector('.text-center.text-gray-500.py-4');
  if (!hasMatches) {
    if (!emptyState) {
      const newEmptyState = document.createElement('li');
      newEmptyState.className = 'text-center text-gray-500 py-4';
      newEmptyState.textContent = 'No matching projects found';
      container.appendChild(newEmptyState);
    }
  } else if (emptyState?.textContent === 'No matching projects found') {
    emptyState.remove();
  }
}

// Re-initialization function
function safeInitializeSidebar() {
  try {
    initializeSidebar();
  } catch (err) {
    console.error('Sidebar initialization failed:', err);
    setTimeout(safeInitializeSidebar, 1000);
  }
}

// Expose key functions
window.sidebar = {
  toggleStarConversation,
  isConversationStarred,
  loadStarredConversations,
  searchSidebarConversations,
  searchSidebarProjects,
  toggle: toggleSidebar,
  isOpen,
  isAnimating,
  activateTab,
  tabConfig: sidebarTabConfig,
  _lastAuthFailTimestamp: 0
};

document.addEventListener('DOMContentLoaded', safeInitializeSidebar);
document.addEventListener('authReady', () => {
  safeInitializeSidebar();
});

// Listen for authStateChanged to refresh UI
document.addEventListener('authStateChanged', (e) => {
  const { authenticated, username } = e.detail || {};
  if (authenticated) {
    // If user logs in, re-initialize the sidebar tab
    const activeTab = localStorage.getItem('sidebarActiveTab') || 'recent';
    if (!document.getElementById(sidebarTabConfig[activeTab]?.sectionId)?.classList.contains('hidden')) {
      setTimeout(() => sidebarTabConfig[activeTab].loader(), 500);
    }
  }
});

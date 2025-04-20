/**
 * sidebar.js - Sidebar UI Component
 * Handles sidebar visibility, tabs, and content rendering
 */

// Core state
const sidebarState = {
  isOpen: window.innerWidth >= 768, // Default: open on desktop, closed on mobile
  activeTab: localStorage.getItem('sidebarActiveTab') || 'recent',
  isAnimating: false
};

// TABS config
const TABS = {
  recent: {
    id: 'recentChatsTab',
    section: 'recentChatsSection',
    loader: () => window.chatManager.loadConversationList()
  },
  starred: {
    id: 'starredChatsTab',
    section: 'starredChatsSection',
    loader: loadStarredConversations
  },
  projects: {
    id: 'projectsTab',
    section: 'projectsSection',
    loader: () => window.app.loadProjects()
  }
};

/**
 * Initialize the sidebar
 */
function init() {
  const sidebar = document.getElementById('mainSidebar');
  if (!sidebar) {
    console.warn('[Sidebar] mainSidebar element not found');
    return false;
  }

  // Set up tab event listeners
  setupTabs();

  // Set up toggle button behavior
  setupToggleButton();

  // Set up search functionality
  setupSearch();

  // Listen for auth changes
  window.auth.AuthBus.addEventListener('authStateChanged', handleAuthChange);

  // Apply initial state
  updateSidebarState();

  return true;
}

/**
 * Set up sidebar tabs
 */
function setupTabs() {
  Object.entries(TABS).forEach(([name, config]) => {
    const tab = document.getElementById(config.id);
    if (tab) {
      window.eventHandlers.trackListener(tab, 'click', () => activateTab(name));
    }
  });

  // Activate initial tab
  activateTab(sidebarState.activeTab);
}

/**
 * Activate a specific tab
 */
function activateTab(tabName) {
  if (!TABS[tabName]) return;

  // Update state
  sidebarState.activeTab = tabName;
  localStorage.setItem('sidebarActiveTab', tabName);

  // Update UI for each tab
  Object.entries(TABS).forEach(([name, config]) => {
    const isActive = name === tabName;
    const tab = document.getElementById(config.id);
    const section = document.getElementById(config.section);

    if (tab) {
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.classList.toggle('tab-active', isActive);
    }

    if (section) {
      section.classList.toggle('hidden', !isActive);
    }
  });

  // If authenticated, load tab content
  window.auth.checkAuth().then(isAuthenticated => {
    if (isAuthenticated && TABS[tabName].loader) {
      TABS[tabName].loader();
    }
  });
}

/**
 * Set up sidebar toggle button
 */
function setupToggleButton() {
  const toggleBtn = document.getElementById('navToggleBtn');
  const closeBtn = document.getElementById('closeSidebarBtn');

  if (toggleBtn) {
    window.eventHandlers.trackListener(toggleBtn, 'click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
  }

  if (closeBtn) {
    window.eventHandlers.trackListener(closeBtn, 'click', () => {
      toggleSidebar(false);
    });
  }

  // Respond to window resize
  window.eventHandlers.trackListener(window, 'resize', () => {
    const isMobile = window.innerWidth < 768;
    if (isMobile && sidebarState.isOpen) {
      toggleSidebar(false);
    }
    if (!isMobile && !sidebarState.isOpen) {
      sidebarState.isOpen = true;
      updateSidebarState();
    }
  });
}

/**
 * Toggle sidebar visibility
 * @param {boolean} [forceState] - True to open, false to close, omit to toggle
 */
function toggleSidebar(forceState) {
  if (sidebarState.isAnimating) return;

  const newState = typeof forceState === 'boolean'
    ? forceState
    : !sidebarState.isOpen;

  sidebarState.isOpen = newState;
  sidebarState.isAnimating = true;
  updateSidebarState();

  // Track animation end
  const sidebar = document.getElementById('mainSidebar');
  if (sidebar) {
    window.eventHandlers.trackListener(sidebar, 'transitionend', () => {
      sidebarState.isAnimating = false;
    }, { once: true });
  }
}

/**
 * Apply sidebar state to the DOM
 */
function updateSidebarState() {
  const sidebar = document.getElementById('mainSidebar');
  const toggleBtn = document.getElementById('navToggleBtn');
  if (!sidebar) return;

  const isMobile = window.innerWidth < 768;

  // Slide in/out on mobile
  if (isMobile) {
    sidebar.classList.toggle('-translate-x-full', !sidebarState.isOpen);
    sidebar.classList.toggle('translate-x-0', sidebarState.isOpen);
  } else {
    sidebar.classList.add('translate-x-0');
    sidebar.classList.remove('-translate-x-full');
  }

  // Manage body scrolling on mobile
  document.body.classList.toggle('sidebar-open', sidebarState.isOpen && isMobile);

  // Handle backdrop
  updateBackdrop(sidebarState.isOpen && isMobile);

  // Accessibility
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', sidebarState.isOpen);
    toggleBtn.setAttribute('aria-label', sidebarState.isOpen ? 'Close sidebar' : 'Open sidebar');
  }
  sidebar.setAttribute('aria-hidden', !sidebarState.isOpen);
}

/**
 * Create or destroy backdrop element
 */
function updateBackdrop(show) {
  let backdrop = document.getElementById('sidebarBackdrop');
  if (show && !backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden';
    backdrop.setAttribute('aria-hidden', 'true');
    window.eventHandlers.trackListener(backdrop, 'click', () => toggleSidebar(false));
    document.body.appendChild(backdrop);
  } else if (!show && backdrop) {
    backdrop.remove();
  }
}

/**
 * Handle authentication state changes
 */
function handleAuthChange(event) {
  const { authenticated } = event.detail || {};

  if (authenticated) {
    // Reload content for the active tab
    const activeTab = TABS[sidebarState.activeTab];
    if (activeTab && typeof activeTab.loader === 'function') {
      activeTab.loader();
    }
  } else {
    // Clear content in each tab
    Object.values(TABS).forEach(config => {
      const section = document.getElementById(config.section);
      if (section) {
        section.innerHTML = `
          <div class="text-center p-4 text-gray-500">
            Please log in to view content
          </div>
        `;
      }
    });
  }
}

/**
 * Setup search functionality
 */
function setupSearch() {
  const searchInput = document.getElementById('sidebarSearch');
  if (searchInput) {
    const debouncedSearch = window.eventHandlers.debounce(searchSidebar, 300);
    window.eventHandlers.trackListener(searchInput, 'input', debouncedSearch);
  }
}

/**
 * Search logic based on active tab
 */
function searchSidebar(e) {
  const query = e.target.value.toLowerCase().trim();

  if (sidebarState.activeTab === 'recent' || sidebarState.activeTab === 'starred') {
    filterConversations(query);
  } else if (sidebarState.activeTab === 'projects') {
    filterProjects(query);
  }
}

/**
 * Filter conversations by text
 */
function filterConversations(query) {
  const containerId = sidebarState.activeTab === 'recent'
    ? 'sidebarConversations'
    : 'starredConversations';
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = container.querySelectorAll('li:not(.text-center)');
  let hasMatches = false;

  items.forEach(item => {
    const title = (item.querySelector('.truncate')?.textContent ?? '').toLowerCase();
    const isMatch = !query || title.includes(query);
    item.classList.toggle('hidden', !isMatch);
    if (isMatch) hasMatches = true;
  });

  // show/hide "no results"
  let noResultsMsg = container.querySelector('.no-results-message');
  if (!hasMatches && query) {
    if (!noResultsMsg) {
      noResultsMsg = document.createElement('li');
      noResultsMsg.className = 'text-center p-4 text-gray-500 no-results-message';
      noResultsMsg.textContent = 'No matching conversations';
      container.appendChild(noResultsMsg);
    }
  } else if (noResultsMsg) {
    noResultsMsg.remove();
  }
}

/**
 * Filter projects by text
 */
function filterProjects(query) {
  const container = document.getElementById('sidebarProjects');
  if (!container) return;

  const items = container.querySelectorAll('li:not(.text-center)');
  let hasMatches = false;

  items.forEach(item => {
    const title = item.textContent.toLowerCase();
    const isMatch = !query || title.includes(query);
    item.classList.toggle('hidden', !isMatch);
    if (isMatch) hasMatches = true;
  });

  let noResultsMsg = container.querySelector('.no-results-message');
  if (!hasMatches && query) {
    if (!noResultsMsg) {
      noResultsMsg = document.createElement('li');
      noResultsMsg.className = 'text-center p-4 text-gray-500 no-results-message';
      noResultsMsg.textContent = 'No matching projects';
      container.appendChild(noResultsMsg);
    }
  } else if (noResultsMsg) {
    noResultsMsg.remove();
  }
}

/**
 * Load starred conversations (simplified)
 */
async function loadStarredConversations() {
  const container = document.getElementById('starredConversations');
  if (!container) return [];

  try {
    const isAuthenticated = await window.auth.checkAuth();
    if (!isAuthenticated) {
      container.innerHTML = `
        <li class="text-center p-4 text-gray-500">
          Please log in to view starred conversations
        </li>
      `;
      return [];
    }

    // Fetch starred IDs
    const response = await window.app.apiRequest('/api/preferences/starred');
    const starredIds = response.data || [];

    if (starredIds.length === 0) {
      container.innerHTML = `
        <li class="text-center p-4 text-gray-500">
          No starred conversations yet
        </li>
      `;
      return [];
    }

    // If chatManager has a getAllConversations() or you keep them in memory:
    // let allConversations = window.chatManager.getAllConversations() || [];
    // Temporarily, if app still uses app.state:
    const allConversations = window.app.state?.conversations || [];

    const starredConversations = allConversations.filter(c => starredIds.includes(c.id));
    renderStarredConversations(container, starredConversations);

    return starredConversations;
  } catch (error) {
    console.error('[Sidebar] Failed to load starred conversations:', error);
    container.innerHTML = `
      <li class="text-center p-4 text-red-500">
        Failed to load starred conversations
      </li>
    `;
    return [];
  }
}

/**
 * Render starred conversation items
 */
function renderStarredConversations(container, conversations) {
  if (!container) return;

  if (conversations.length === 0) {
    container.innerHTML = `
      <li class="text-center p-4 text-gray-500">
        No starred conversations
      </li>
    `;
    return;
  }

  container.innerHTML = '';
  conversations.forEach((conv) => {
    const li = document.createElement('li');
    li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';

    li.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="truncate">${conv.title || `Conversation ${conv.id}`}</span>
        <button class="text-yellow-500 unstar-btn ml-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915
                 c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674
                 c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976
                 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0
                 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81
                 h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
          </svg>
        </button>
      </div>
    `;

    // Delegate conversation load via chatManager
    window.eventHandlers.trackListener(li, 'click', async (e) => {
      if (!e.target.closest('.unstar-btn')) {
        try {
          await window.chatManager.loadConversation(conv.id);
        } catch (err) {
          console.error('[Sidebar] Failed to load conversation:', err);
        }
      }
    });

    // Unstar button
    const unstarBtn = li.querySelector('.unstar-btn');
    window.eventHandlers.trackListener(unstarBtn, 'click', async (e) => {
      e.stopPropagation();
      try {
        await toggleStarConversation(conv.id);
        li.remove();
        if (container.children.length === 0) {
          container.innerHTML = `
            <li class="text-center p-4 text-gray-500">
              No starred conversations
            </li>
          `;
        }
      } catch (error) {
        console.error('[Sidebar] Failed to unstar conversation:', error);
      }
    });

    container.appendChild(li);
  });
}

/**
 * Toggle star for a conversation
 */
async function toggleStarConversation(conversationId) {
  try {
    const isAuthenticated = await window.auth.checkAuth();
    if (!isAuthenticated) throw new Error('Authentication required');

    // Get current starred list
    const resp = await window.app.apiRequest('/api/preferences/starred');
    const starredIds = resp.data || [];

    // Flip star
    const isStarred = starredIds.includes(conversationId);
    const updated = isStarred
      ? starredIds.filter(id => id !== conversationId)
      : [...starredIds, conversationId];
    // Save to server
    await window.app.apiRequest('/api/preferences/starred', 'PUT', {
      starred_conversations: updated
    });
    localStorage.setItem('starredConversations', JSON.stringify(updated));

    return !isStarred;
  } catch (error) {
    console.error('[Sidebar] Error toggling star:', error);
    throw error;
  }
}

/**
 * Check if a conversation is starred
 */
function isConversationStarred(conversationId) {
  try {
    const starredJson = localStorage.getItem('starredConversations');
    if (!starredJson) return false;
    const starredIds = JSON.parse(starredJson);
    return starredIds.includes(conversationId);
  } catch (err) {
    return false;
  }
}

// Export public sidebar API
window.sidebar = {
  init,
  toggleSidebar,
  activateTab,
  isConversationStarred,
  toggleStarConversation,
  state: sidebarState
};

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', init);

/**
 * sidebar.js
 * ---------
 * Handles core sidebar UI functionality:
 */

/**
 * Simple utility for consistent event binding.
 * @param {Element} element
 * @param {string} eventType
 * @param {Function} handler
 * @param {Object} [options={}]
 */
function trackListener(element, eventType, handler, options = {}) {
  if (!element) return;
  element.addEventListener(eventType, handler, options);
}

/**
 * - Tab switching between Recent, Starred, and Projects
 * - Starred conversations management
 * - Core sidebar state management
 *
 * Uses auth.js exclusively for authentication
 */

// Core state variables
let sidebar = null;
let isOpen = false;
let toggleBtn = null;
let closeBtn = null;
let isAnimating = false;

// Tab configuration - centralized here for use by other modules
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
    loader: () => {
      // Try to initialize projectListComponent if it doesn't exist yet
      if (!window.projectListComponent && typeof window.ProjectListComponent === 'function') {
        try {
          console.log('[Sidebar] Initializing missing projectListComponent');
          window.projectListComponent = new window.ProjectListComponent({
            elementId: "sidebarProjects",
            onViewProject: (projectId) => {
              if (window.ProjectDashboard?.showProjectDetails) {
                window.ProjectDashboard.showProjectDetails(projectId);
              }
            }
          });
        } catch (err) {
          console.warn('[Sidebar] Failed to initialize projectListComponent:', err);
        }
      }

      window.projectManager.loadProjects('all')
        .then(projects => {
          if (window.projectListComponent && typeof window.projectListComponent.renderProjects === 'function') {
            window.projectListComponent.renderProjects(projects);
          } else {
            console.error('Failed to render sidebar projects: projectListComponent is undefined or missing renderProjects function');
            // Create fallback message for user
            const projectsSection = document.getElementById('projectsSection');
            if (projectsSection) {
              projectsSection.innerHTML = '<div class="text-red-500 p-4">Unable to load projects. Component initialization failed.</div>';
            }

            // Attempt to create a basic fallback renderer
            const sidebarProjects = document.getElementById('sidebarProjects');
            if (sidebarProjects && projects && Array.isArray(projects)) {
              console.log('[Sidebar] Using fallback project renderer for', projects.length, 'projects');
              sidebarProjects.innerHTML = '';

              if (projects.length === 0) {
                sidebarProjects.innerHTML = '<li class="text-center text-gray-500 py-4">No projects available</li>';
              } else {
                const fragment = document.createDocumentFragment();
                projects.forEach(project => {
                  const li = document.createElement('li');
                  li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center justify-between';
                  li.dataset.projectId = project.id;

                  const title = document.createElement('span');
                  title.className = 'truncate';
                  title.textContent = project.name || `Project ${project.id}`;

                  li.appendChild(title);
                  li.addEventListener('click', () => {
                    if (window.ProjectDashboard?.showProjectDetails) {
                      window.ProjectDashboard.showProjectDetails(project.id);
                    }
                  });

                  fragment.appendChild(li);
                });
                sidebarProjects.appendChild(fragment);
              }
            }
          }
        })
        .catch(err => {
          console.error('Failed to load sidebar projects:', err);
          if (window.ChatUtils && window.ChatUtils.handleError) {
            window.ChatUtils.handleError('Sidebar project load', err);
          }

          // Display user-friendly error message
          const projectsSection = document.getElementById('projectsSection');
          if (projectsSection) {
            projectsSection.innerHTML = '<div class="text-red-500 p-4">Unable to connect to backend service. Please check if the server is running.</div>';
          }
        });
    },
  },
};

/**
 * Toggle sidebar open/closed state
 * @param {boolean} [forceState] Optional state to force
 * @returns {void}
 */
window.toggleSidebar = function (forceState) {
  if (isAnimating) return;
  isAnimating = true;

  // Determine the new state
  const isMobile = window.innerWidth < 768;
  let newState;

  if (typeof forceState === 'boolean') {
    newState = forceState;
  } else {
    newState = !isOpen;
  }

  isOpen = newState;

  // Update UI based on state
  updateSidebarState();

  // Mark animation as complete after transition
  trackListener(sidebar, 'transitionend', () => {
    isAnimating = false;
  }, { once: true });
};

/**
 * Update the sidebar visibility state and related UI elements
 * @returns {void}
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

  // Update backdrop state
  updateBackdrop(isOpen && isMobile);

  // Update accessibility attributes
  updateAccessibilityAttributes();
}

/**
 * Update accessibility attributes for sidebar
 * @returns {void}
 */
function updateAccessibilityAttributes() {
  if (!toggleBtn || !sidebar) return;

  toggleBtn.setAttribute('aria-expanded', isOpen);
  toggleBtn.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
  sidebar.setAttribute('aria-hidden', !isOpen);

  // Manage focus when closing if closeBtn exists
  if (closeBtn && !isOpen && document.activeElement === closeBtn) {
    toggleBtn.focus();
  }
}

/**
 * Create, update or remove backdrop element for mobile sidebar
 * @param {boolean} show Whether to show the backdrop
 * @returns {void}
 */
function updateBackdrop(show) {
  let backdrop = document.getElementById('sidebarBackdrop');

  if (show && !backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'fixed top-0 left-[16rem] bottom-0 right-0 bg-black/50 z-[99] md:hidden transition-opacity duration-300';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.touchAction = 'auto';
    backdrop.style.pointerEvents = 'auto';

    // Handle click on backdrop
    const clickHandler = (e) => {
      if (e.target === backdrop) {
        e.preventDefault();
        window.toggleSidebar(false);
        document.activeElement?.blur();
      }
    };

    backdrop.addEventListener('touchstart', clickHandler);
    backdrop.addEventListener('click', clickHandler);

    document.body.appendChild(backdrop);
  } else if (!show && backdrop) {
    // Animate before removing
    backdrop.classList.add('opacity-0');
    setTimeout(() => backdrop.remove(), 300);
  }
}

/**
 * Initialize the sidebar core elements and state
 * @returns {boolean} True if initialization is successful, false otherwise
 */
function initializeSidebarToggle() {
  sidebar = document.getElementById('mainSidebar');
  toggleBtn = document.getElementById('navToggleBtn');
  closeBtn = document.getElementById('closeSidebarBtn');

  if (!sidebar) {
    console.warn('Sidebar element not found in DOM');
    return false;
  }

  // Ensure closeBtn exists or create fallback
  if (!closeBtn && sidebar) {
    console.warn('Close button not found, creating fallback');
    closeBtn = document.createElement('button');
    closeBtn.id = 'closeSidebarBtn';
    closeBtn.className = 'md:hidden absolute top-2 right-2 p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300';
    closeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>`;
    sidebar.appendChild(closeBtn);
  }

  // Initialize reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion && sidebar) {
    sidebar.style.transition = 'none';
  }

  // Set initial state based on viewport
  const isMobile = window.innerWidth < 768;
  isOpen = !isMobile; // Default: closed on mobile, open on desktop

  updateSidebarState();
  updateAccessibilityAttributes();

  return true;
}

/**
 * Sets up tab navigation in the sidebar
 * @returns {void}
 */
function setupSidebarTabs() {
  const tabs = {};

  // Initialize tab elements with proper error handling
  Object.entries(sidebarTabConfig).forEach(([name, config]) => {
    try {
      const button = document.getElementById(config.buttonId);
      const content = document.getElementById(config.sectionId);

      if (!button || !content) {
        console.warn(`Tab elements missing for ${name}`);
        return;
      }

      tabs[name] = {
        button,
        content,
        loader: config.loader,
      };

      // Set ARIA attributes
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-controls', config.sectionId);
      content.setAttribute('role', 'tabpanel');
      content.setAttribute('aria-labelledby', config.buttonId);
    } catch (error) {
      console.error(`Error setting up ${name} tab:`, error);
    }
  });

  // Determine which tab to show based on context
  const isProjectsPage = window.location.pathname.includes('/projects') || document.getElementById('projectManagerPanel');

  // Load saved preference or use default based on page
  let activeTab = localStorage.getItem('sidebarActiveTab');

  // Default to projects tab on projects page
  if (!activeTab || (isProjectsPage && activeTab !== 'projects')) {
    activeTab = isProjectsPage ? 'projects' : 'recent';
    localStorage.setItem('sidebarActiveTab', activeTab);
  }

  // Activate the initial tab
  activateTab(activeTab);
}

/**
 * Activate a specific sidebar tab by name
 * @param {string} tabName - The name of the tab to activate
 * @returns {void}
 */
function activateTab(tabName) {
  if (!sidebarTabConfig[tabName]) return;

  // Save preference
  localStorage.setItem('sidebarActiveTab', tabName);

  // Update UI for all tabs
  Object.entries(sidebarTabConfig).forEach(([tab, config]) => {
    const isActive = tab === tabName;
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

  // Load data for the tab if authenticated
  const checkAuth = async () => {
    try {
      // Use sidebar's own throttling logic independently from auth.js
      const now = Date.now();
      const lastSidebarAuthFailTime = window.sidebar?._lastAuthFailTimestamp || 0;
      const AUTH_FAIL_COOLDOWN_MS = 30000; // 30 seconds cooldown

      if (now - lastSidebarAuthFailTime < AUTH_FAIL_COOLDOWN_MS) {
        console.warn('[Sidebar] Auth verification throttled due to recent failure');
        // Return cached auth state during cooldown period
        return window.auth.authState?.isAuthenticated || false;
      }

      // Use a local variable to track if we're in the middle of checking auth
      let isAuthCheckInProgress = window.auth.authCheckInProgress;

      if (isAuthCheckInProgress) {
        console.debug('[Sidebar] Auth check already in progress, waiting...');
        // Wait for existing check to complete using a timeout to prevent infinite loops
        let waitAttempts = 0;
        while (window.auth.authCheckInProgress && waitAttempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitAttempts++;
        }
        if (waitAttempts >= 50) {
          console.warn('[Sidebar] Timed out waiting for auth check to complete');
          return false;
        }
      }

      let isAuthenticated = false;
      try {
        // Explicitly check for token validity before verification
        const accessToken = getCookie('access_token');
        const refreshToken = getCookie('refresh_token');

        // If no tokens at all, clearly not authenticated
        if (!accessToken && !refreshToken) {
          return false;
        }

        // If we already had an authentication failure in this component, use cached state
        isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      } catch (err) {
        // Handle E401_THROTTLED error specifically
        if (err.code === 'E401_THROTTLED') {
          console.warn('[Sidebar] Auth verification throttled, using cached value.');
          isAuthenticated = window.auth.authState?.isAuthenticated || false;
        } else {
          console.warn('[Sidebar] Auth verification failed:', err);
          // Set the sidebar's own throttling timestamp on verification failure
          window.sidebar._lastAuthFailTimestamp = Date.now();
          return false;
        }
      }

      if (isAuthenticated && sidebarTabConfig[tabName].loader) {
        setTimeout(() => sidebarTabConfig[tabName].loader(), 300);
      } else if (!isAuthenticated) {
        // Handle unauthenticated state gracefully for each tab type
        const sectionElement = document.getElementById(sidebarTabConfig[tabName].sectionId);
        if (sectionElement) {
          // Show authentication required message based on tab
          if (tabName === 'projects') {
            sectionElement.innerHTML = '<div class="text-center p-4 text-gray-500">Please log in to view your projects</div>';
          } else if (tabName === 'starred') {
            sectionElement.innerHTML = '<div class="text-center p-4 text-gray-500">Please log in to view starred conversations</div>';
          } else if (tabName === 'recent') {
            sectionElement.innerHTML = '<div class="text-center p-4 text-gray-500">Please log in to view recent conversations</div>';
          }
        }
      }
    } catch (err) {
      console.warn('[Sidebar] Auth verification failed:', err);

      // Set the sidebar's own throttling timestamp on verification failure
      window.sidebar._lastAuthFailTimestamp = Date.now();

      // Handle authentication error gracefully
      const sectionElement = document.getElementById(sidebarTabConfig[tabName].sectionId);
      if (sectionElement) {
        sectionElement.innerHTML = '<div class="text-red-500 p-4">Unable to verify authentication. Backend service may be unavailable.</div>';
      }

      // Log the error for diagnostics
      if (window.ChatUtils && typeof window.ChatUtils.handleError === 'function') {
        window.ChatUtils.handleError('Sidebar auth verification', err);
      }
    }
  };

  checkAuth();
}

/**
 * Load starred conversations from local storage or server
 * @returns {Promise<void>}
 */
async function loadStarredConversations() {
  const container = document.getElementById('starredConversations');
  if (!container) return;

  // Check authentication using auth.js
  let isAuthenticated = false;
  try {
    isAuthenticated = await window.auth.isAuthenticated();
  } catch (e) {
    console.warn('[sidebar] Auth verification failed:', e);
  }

  if (!isAuthenticated) {
    // Show login message
    container.innerHTML = `
      <li class="text-center text-gray-500 py-4">
        Please log in to view starred conversations
      </li>
    `;
    return;
  }

  try {
    // Get starred conversations from backend
    const response = await window.apiRequest('/api/preferences/starred');
    const starredIds = response.data || [];

    if (starredIds.length === 0) {
      // Show empty state
      container.innerHTML = `
        <li class="text-center text-gray-500 py-4">
          No starred conversations yet. Click the star icon on any conversation to add it here.
        </li>
      `;
      return;
    }
  } catch (error) {
    console.error('Failed to load starred conversations:', error);

    // Use auth.js for auth errors if needed
    if (error.status === 401 && window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, 'Loading starred conversations');
    }

    // Handle 404 specifically
    if (error.status === 404 || error.isPermanent) {
      container.innerHTML = `
        <li class="text-center text-gray-500 py-4">
          Starred conversations feature is currently unavailable
        </li>
      `;
      return;
    }

    // Show generic error for other cases
    container.innerHTML = `
      <li class="text-center text-red-500 py-4">
        Failed to load starred conversations. Please try again later.
      </li>
    `;
    return;
  }

  if (starredIds.length === 0) {
    // Show empty state
    container.innerHTML = `
      <li class="text-center text-gray-500 py-4">
        No starred conversations yet. Click the star icon on any conversation to add it here.
      </li>
    `;
    return;
  }

  // Try to load conversations from recent conversations
  const allConversations = window.chatConfig?.conversations || [];
  const starredConversations = allConversations.filter(conv => starredIds.includes(conv.id));

  if (starredConversations.length === 0) {
    // No matches found, show empty state
    container.innerHTML = `
      <li class="text-center text-gray-500 py-4">
        No starred conversations available. Some conversations may have been deleted.
      </li>
    `;
    return;
  }

  // Render starred conversations
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
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    `;

    unstarBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent opening the conversation
      toggleStarConversation(conv.id);
      li.remove();

      // If no more starred conversations, show empty state
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

    // Add click handler to open conversation
    li.addEventListener('click', () => {
      if (window.location.pathname.includes('/projects')) {
        window.location.href = `/?chatId=${conv.id}`;
      } else if (typeof window.loadConversation === 'function') {
        window.loadConversation(conv.id);
      }
    });

    container.appendChild(li);
  });
}

/**
 * Toggle star status for a conversation
 * @param {string} conversationId - The ID of the conversation to toggle
 * @returns {Promise<boolean>} Whether the conversation is now starred
 */
async function toggleStarConversation(conversationId) {
  // Perform authentication check using the unified auth module
  const isAuthenticated = await window.auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error('[Auth] User is not authenticated');
    return false;
  }

  // Get current starred conversations
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');

  // Check if already starred
  const index = starredIds.indexOf(conversationId);

  if (index === -1) {
    // Not starred, add it
    starredIds.push(conversationId);
  } else {
    // Already starred, remove it
    starredIds.splice(index, 1);
  }

  // Save back to local storage and via API
  localStorage.setItem('starredConversations', JSON.stringify(starredIds));

  // Update server with new starred list
  try {
    await window.apiRequest('/api/user/preferences', 'PATCH', {
      starred_conversations: starredIds,
    });
  } catch (error) {
    console.error('Failed to update starred conversations on server:', error);

    // Use auth.js for auth errors if needed
    if (error.status === 401 && window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, 'Updating starred conversations');
    }
  }

  return index === -1; // Return true if now starred, false if now unstarred
}

/**
 * Checks if a conversation is starred
 * @param {string} conversationId - The ID of the conversation to check
 * @returns {boolean} Whether the conversation is starred
 */
function isConversationStarred(conversationId) {
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
  return starredIds.includes(conversationId);
}

/**
 * Search conversation list in the sidebar based on search query
 * @param {string} query - The search query to filter conversations
 * @returns {void}
 */
function searchSidebarConversations(query) {
  const sidebarConversations = document.getElementById('sidebarConversations');
  if (!sidebarConversations) return;

  const conversations = sidebarConversations.querySelectorAll('li');
  const searchTerm = query.toLowerCase();
  let hasVisibleConversations = false;

  conversations.forEach(conv => {
    // Skip if it's an empty state message
    if (conv.classList.contains('text-center') && conv.classList.contains('text-gray-500')) {
      return;
    }

    const title = conv.querySelector('.truncate')?.textContent.toLowerCase() || '';
    const isVisible = title.includes(searchTerm);
    conv.classList.toggle('hidden', !isVisible);

    if (isVisible) {
      hasVisibleConversations = true;
    }
  });

  // Show empty state if no matching conversations
  const existingEmptyState = sidebarConversations.querySelector('.text-center.text-gray-500.py-4');
  if (!hasVisibleConversations) {
    if (!existingEmptyState) {
      const emptyState = document.createElement('li');
      emptyState.className = 'text-center text-gray-500 py-4';
      emptyState.textContent = 'No matching conversations found';
      sidebarConversations.appendChild(emptyState);
    }
  } else if (existingEmptyState && existingEmptyState.textContent === 'No matching conversations found') {
    existingEmptyState.remove();
  }
}

/**
 * Search projects list in the sidebar based on search query
 * @param {string} query - The search query to filter projects
 * @returns {void}
 */
function searchSidebarProjects(query) {
  const sidebarProjects = document.getElementById('sidebarProjects');
  if (!sidebarProjects) return;

  const projects = sidebarProjects.querySelectorAll('li');
  const searchTerm = query.toLowerCase();
  let hasVisibleProjects = false;

  projects.forEach(project => {
    // Skip if it's an empty state message
    if (project.classList.contains('text-center') && project.classList.contains('text-gray-500')) {
      return;
    }

    const projectName = project.querySelector('span')?.textContent.toLowerCase() || '';
    const isVisible = projectName.includes(searchTerm);
    project.classList.toggle('hidden', !isVisible);

    if (isVisible) {
      hasVisibleProjects = true;
    }
  });

  // Show empty state if no matching projects
  const existingEmptyState = sidebarProjects.querySelector('.text-center.text-gray-500.py-4');
  if (!hasVisibleProjects) {
    if (!existingEmptyState) {
      const emptyState = document.createElement('li');
      emptyState.className = 'text-center text-gray-500 py-4';
      emptyState.textContent = 'No matching projects found';
      sidebarProjects.appendChild(emptyState);
    }
  } else if (existingEmptyState && existingEmptyState.textContent === 'No matching projects found') {
    existingEmptyState.remove();
  }
}

/**
 * Main initialization function for the sidebar
 * @returns {boolean} True if initialization is successful, false otherwise
 */
function initializeSidebar() {
  // Initialize core sidebar toggle
  const initSuccess = initializeSidebarToggle();
  if (!initSuccess) {
    console.warn('Sidebar toggle initialization failed');
    return false;
  }

  // Initialize sidebar features
  setupSidebarTabs();

  console.log('Sidebar initialized successfully');
  return true;
}

/**
 * Update UI elements based on auth state
 * @param {boolean} authenticated - Whether the user is authenticated
 * @param {string} [username] - Username if authenticated
 * @returns {void}
 */
function updateAuthDependentUI(authenticated, username = null) {
  const authDependentElements = [
    'sidebarNewChatBtn',
    'sidebarNewProjectBtn',
    'starredChatsTab',
    'projectsTab',
    'recentChatsTab',
  ];

  const isLoading = window.auth && window.auth.isAuthCheckInProgress;

  authDependentElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (isLoading) {
        // Add loading state
        el.classList.add('opacity-50', 'pointer-events-none');
        const spinner = document.createElement('div');
        spinner.className = 'inline-block ml-2 animate-spin';
        spinner.innerHTML = `
          <svg class="h-4 w-4" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>`;
        el.appendChild(spinner);
      } else {
        // Remove loading state and update visibility
        el.classList.remove('opacity-50', 'pointer-events-none');
        const spinner = el.querySelector('.animate-spin');
        if (spinner) spinner.remove();
        el.classList.toggle('hidden', !authenticated);
      }
    }
  });

  // Update username display if available
  if (authenticated && username) {
    const usernameEl = document.getElementById('sidebarUsername');
    if (usernameEl) {
      usernameEl.textContent = username;
      usernameEl.classList.remove('hidden');
    }
  }

  // Refresh content if authenticated
  if (authenticated) {
    console.debug('[Sidebar] User is authenticated, refreshing appropriate tab content');
    const activeTab = localStorage.getItem('sidebarActiveTab');
    if (activeTab === 'starred' && document.getElementById('starredChatsSection')?.classList.contains('hidden') === false) {
      setTimeout(() => loadStarredConversations(), 500);
    } else if (activeTab === 'projects' && document.getElementById('projectsSection')?.classList.contains('hidden') === false) {
      setTimeout(() => window.loadSidebarProjects?.(), 500);
    } else if (activeTab === 'recent' && document.getElementById('recentChatsSection')?.classList.contains('hidden') === false) {
      setTimeout(() => window.loadConversationList?.(), 500);
    }
  }
}

// Listen for conversation deletion events
document.addEventListener('conversationDeleted', (e) => {
  if (e.detail && e.detail.id) {
    const deletedId = e.detail.id;

    // Remove from starred conversations if needed
    const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
    const starredIndex = starredIds.indexOf(deletedId);
    if (starredIndex !== -1) {
      starredIds.splice(starredIndex, 1);
      localStorage.setItem('starredConversations', JSON.stringify(starredIds));

      // Reload starred view if it's currently visible
      const starredSection = document.getElementById('starredChatsSection');
      if (starredSection && !starredSection.classList.contains('hidden')) {
        loadStarredConversations();
      }
    }

    // Remove from recent conversations sidebar
    const conversationElement = document.querySelector(`#sidebarConversations [data-conversation-id="${deletedId}"]`);
    if (conversationElement) {
      conversationElement.remove();
    }
  }
});

// Expose re-initialization function
window.reinitializeSidebar = initializeSidebar;

// Export sidebar functionality for use by eventHandler.js
window.sidebar = {
  toggleStarConversation,
  isConversationStarred,
  loadStarredConversations,
  searchSidebarConversations,
  searchSidebarProjects,
  toggle: window.toggleSidebar,
  isOpen,
  isAnimating,
  activateTab, // Added for external use
  tabConfig: sidebarTabConfig, // Expose configuration
  updateSidebarState, // Added for external use
  _lastAuthFailTimestamp: 0 // Track auth failures for throttling
};

/**
 * Get a cookie value by name
 * @param {string} name - The name of the cookie to get
 * @returns {string|null} The cookie value or null if not found
 */
function getCookie(name) {
  const c = `; ${document.cookie}`.split(`; ${name}=`);
  if (c.length === 2) return c.pop().split(';').shift();
  return null;
}

// Initialize on DOMContentLoaded with proper state tracking
let sidebarInitialized = false;

function safeInitializeSidebar() {
  if (sidebarInitialized) return;
  try {
    sidebarInitialized = initializeSidebar();
  } catch (err) {
    console.error('Sidebar initialization failed:', err);
    // Retry initialization after delay
    setTimeout(safeInitializeSidebar, 1000);
  }
}

// Track initialization state to prevent duplicate handlers
document.addEventListener('DOMContentLoaded', safeInitializeSidebar);

// Also initialize when auth is ready if not already initialized
document.addEventListener('authReady', () => {
  if (!sidebarInitialized) safeInitializeSidebar();
});

// Listen for auth state changes from auth.js
document.addEventListener('authStateChanged', (e) => {
  updateAuthDependentUI(e.detail?.authenticated, e.detail?.username);
});

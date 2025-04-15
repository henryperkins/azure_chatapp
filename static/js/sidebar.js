/**
 * sidebar.js
 * ---------
 * Handles all sidebar UI functionality:
 * - Tab switching between Recent, Starred, and Projects
 * - Collapsible settings panels
 * - Pinning/unpinning sidebar
 * - Mobile sidebar toggle and backdrop
 * - Custom instructions saving
 * - Starred conversations management
 *
 * Uses auth.js exclusively for authentication
 */

// Core state variables
let sidebar = null;
let isOpen = false;
let toggleBtn = null;
let closeBtn = null;
let isAnimating = false;

// Track listeners centrally to prevent memory leaks
const trackedListeners = new Set();

/**
 * Toggle sidebar open/closed state
 * @param {boolean} [forceState] Optional state to force
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
  sidebar.addEventListener('transitionend', () => {
    isAnimating = false;
  }, { once: true });
};

/**
 * Update the sidebar visibility state and related UI elements
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
 * Update accessibility attributes
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
 * Handle window resize events
 */
function handleResize() {
  const isMobile = window.innerWidth < 768;

  // Auto-close on mobile resize
  if (isMobile && isOpen) {
    toggleSidebar(false);
  }

  // Always open on desktop
  if (!isMobile) {
    isOpen = true;
    updateSidebarState();
    updateBackdrop(false);
  }
}

/**
 * Create, update or remove backdrop element
 * @param {boolean} show Whether to show the backdrop
 */
function updateBackdrop(show) {
  let backdrop = document.getElementById('sidebarBackdrop');

  if (show && !backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'fixed top-0 left-[16rem] bottom-0 right-0 bg-black/50 z-[99] md:hidden transition-opacity duration-300';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.touchAction = 'auto'; // Changed from 'none' to 'auto'
    backdrop.style.pointerEvents = 'auto';

    // Handle click on backdrop
    const clickHandler = (e) => {
      if (e.target === backdrop) {
        e.preventDefault();
        toggleSidebar(false);
        document.activeElement?.blur();
      }
    };

    backdrop.addEventListener('touchstart', clickHandler); // Removed { passive: false }
    backdrop.addEventListener('click', clickHandler);

    document.body.appendChild(backdrop);
  } else if (!show && backdrop) {
    // Animate before removing
    backdrop.classList.add('opacity-0');
    setTimeout(() => backdrop.remove(), 300);
  }
}

/**
 * Initialize the sidebar toggle functionality
 */
function initializeSidebarToggle() {
  // Clear existing references to prevent memory leaks
  if (sidebar) {
    sidebar.removeEventListener('transitionend', handleTransitionEnd);
  }

  sidebar = document.getElementById('mainSidebar');
  toggleBtn = document.getElementById('navToggleBtn');
  closeBtn = document.getElementById('closeSidebarBtn');

  if (!sidebar) {
    console.warn('Sidebar element not found in DOM');
    return false;
  }

  // Add transition end handler
  function handleTransitionEnd() {
    isAnimating = false;
  }
  sidebar.addEventListener('transitionend', handleTransitionEnd);

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

  // Setup fresh listeners with proper event handling
  setupMobileToggle();

  // Track closeBtn click
  if (closeBtn) {
    trackListener(closeBtn, 'click', () => toggleSidebar(false));
  }

  // Track window resize
  trackListener(window, 'resize', handleResize);

  // Set initial state based on viewport
  const isMobile = window.innerWidth < 768;
  isOpen = !isMobile; // Default: closed on mobile, open on desktop

  updateSidebarState();
  updateAccessibilityAttributes();

  return true;
}

/**
 * Set up edge swipe and toggle button for mobile
 */
function setupMobileToggle() {
  // Clear existing touch handlers
  trackedListeners.forEach(({type}) => {
    if (type === 'touchstart' || type === 'touchend') {
      document.removeEventListener(type, handler);
    }
  });

  // Setup touch gestures for mobile
  let touchStartX = 0;
  const threshold = 30; // Minimum horizontal swipe distance

  // Track touch start position with proper passive handling
  const touchStartHandler = (e) => {
    touchStartX = e.touches[0].clientX;
  };
  trackListener(document, 'touchstart', touchStartHandler, { passive: true });

  // Handle edge swipe to open/close
  const touchEndHandler = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;

    // Edge swipe from left to right to open sidebar
    if (touchStartX < 50 && deltaX > threshold) {
      toggleSidebar(true);
      e.preventDefault();
    } else if (isOpen && touchStartX > window.innerWidth - 50 && deltaX < -threshold) {
      // Edge swipe from right to left to close sidebar when open
      toggleSidebar(false);
      e.preventDefault();
    }
  };
  trackListener(document, 'touchend', touchEndHandler, { passive: false });

  // Handle toggle button click
  if (toggleBtn) {
    trackListener(toggleBtn, 'click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });

    // Add keyboard accessibility
    trackListener(toggleBtn, 'keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
      }
    });
  }
}

/**
 * Clean up all tracked event listeners
 */
function cleanupListeners() {
  trackedListeners.forEach(({ element, type, handler, options }) => {
    element.removeEventListener(type, handler, options);
  });
  trackedListeners.clear();
}

/**
 * Track a listener for cleanup
 * @param {Element} element - Element to attach listener to
 * @param {string} type - Event type
 * @param {Function} handler - Event handler
 * @param {Object} [options] - Event listener options
 */
function trackListener(element, type, handler, options = {}) {
  if (!element) return;

  element.addEventListener(type, handler, options);
  trackedListeners.add({ element, type, handler, options });
}

/**
 * Sets up tab navigation in the sidebar
 */
function setupSidebarTabs() {
  const tabConfig = {
    recent: {
      buttonId: 'recentChatsTab',
      sectionId: 'recentChatsSection',
      loader: () => window.loadConversationList?.()
    },
    starred: {
      buttonId: 'starredChatsTab',
      sectionId: 'starredChatsSection',
      loader: loadStarredConversations
    },
    projects: {
      buttonId: 'projectsTab',
      sectionId: 'projectsSection',
      loader: () => window.loadSidebarProjects?.()
    }
  };

  const tabs = {};

  // Initialize tab elements with proper error handling
  Object.entries(tabConfig).forEach(([name, config]) => {
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
        loader: config.loader
      };

      // Set ARIA attributes
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-controls', config.sectionId);
      content.setAttribute('role', 'tabpanel');
      content.setAttribute('aria-labelledby', config.buttonId);

      // Add keyboard navigation
      trackListener(button, 'keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();

          const tabsList = Object.keys(tabs);
          const currentIndex = tabsList.indexOf(name);
          let newIndex;

          if (e.key === 'ArrowRight') {
            newIndex = (currentIndex + 1) % tabsList.length;
          } else {
            newIndex = (currentIndex - 1 + tabsList.length) % tabsList.length;
          }

          activateTab(tabsList[newIndex]);
          tabs[tabsList[newIndex]].button.focus();
        }
      });

      // Add click handler
      trackListener(button, 'click', () => activateTab(name));
    } catch (error) {
      console.error(`Error setting up ${name} tab:`, error);
    }
  });

  // Determine which tab to show based on context
  const isProjectsPage = window.location.pathname.includes('/projects') ||
    document.getElementById('projectManagerPanel');

  // Load saved preference or use default based on page
  let activeTab = localStorage.getItem('sidebarActiveTab');

  // Default to projects tab on projects page
  if (!activeTab || (isProjectsPage && activeTab !== 'projects')) {
    activeTab = isProjectsPage ? 'projects' : 'recent';
    localStorage.setItem('sidebarActiveTab', activeTab);
  }

  // Helper function to activate a tab
  function activateTab(tabName) {
    if (!tabs[tabName]) return;

    // Save preference
    localStorage.setItem('sidebarActiveTab', tabName);

    // Update UI for all tabs
    Object.entries(tabs).forEach(([tab, elements]) => {
      const isActive = tab === tabName;

      if (elements.button) {
        elements.button.setAttribute('aria-selected', isActive);
        elements.button.classList.toggle('project-tab-btn-active', isActive);
        elements.button.classList.toggle('text-gray-500', !isActive);
      }

      if (elements.content) {
        elements.content.classList.toggle('hidden', !isActive);
      }
    });

    // Check auth status before loading data
    // Use auth.js to check authentication - with retry
    const checkAuth = async () => {
      try {
        let isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });

        // Retry with force verify if needed
        if (!isAuthenticated) {
          console.debug(`[Sidebar] First auth check failed for tab ${tabName}, scheduling second attempt in 0.5s`);
          await new Promise(r => setTimeout(r, 500));
          isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
        }

        // If still not authenticated, schedule a final attempt 1s later
        if (!isAuthenticated) {
          console.debug(`[Sidebar] Second auth check still failed for tab ${tabName}, scheduling final attempt in 1s`);
          await new Promise(r => setTimeout(r, 1000));
          isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
        }

        // Only load data if authenticated and tab has a loader
        if (isAuthenticated && tabs[tabName].loader) {
          console.debug(`[Sidebar] Loading data for authenticated tab: ${tabName}`);
          setTimeout(() => tabs[tabName].loader(), 300);
        } else if (!isAuthenticated) {
          console.debug(`[Sidebar] User not logged in for tab: ${tabName}. Displaying login prompt.`);
          // Optionally show a "Please log in" message in the section
          const tabSection = document.getElementById(tabConfig[tabName]?.sectionId);
          if (tabSection) {
            tabSection.innerHTML = `
              <div class="p-4 text-gray-500 text-sm text-center">
                Please log in to view this content.
              </div>
            `;
          }
        }
      } catch (err) {
        console.warn("[Sidebar] Auth verification failed:", err);
      }
    };

    // Execute auth check
    checkAuth();
  }

  // Activate the initial tab
  activateTab(activeTab);
}

/**
 * Sets up collapsible sections in the sidebar
 */
function setupCollapsibleSections() {
  const sections = [
    {
      toggleId: 'toggleModelConfig',
      panelId: 'modelConfigPanel',
      chevronId: 'modelConfigChevron',
      onExpand: () => window.initializeModelDropdown?.()
    },
    {
      toggleId: 'toggleCustomInstructions',
      panelId: 'customInstructionsPanel',
      chevronId: 'customInstructionsChevron'
    }
  ];

  sections.forEach(section => {
    setupCollapsibleSection(
      section.toggleId,
      section.panelId,
      section.chevronId,
      section.onExpand
    );
  });
}

/**
 * Helper to set up a collapsible section
 * @param {string} toggleId - ID of the toggle button
 * @param {string} panelId - ID of the panel to toggle
 * @param {string} chevronId - ID of the chevron icon
 * @param {Function} onExpand - Optional callback when panel is expanded
 */
function setupCollapsibleSection(toggleId, panelId, chevronId, onExpand) {
  try {
    const toggleButton = document.getElementById(toggleId);
    const panel = document.getElementById(panelId);
    const chevron = document.getElementById(chevronId);

    if (!toggleButton || !panel || !chevron) {
      console.warn(`Collapsible section elements not found: ${toggleId}, ${panelId}, ${chevronId}`);
      return;
    }

    // Set up keyboard interaction
    toggleButton.setAttribute('role', 'button');
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.setAttribute('aria-controls', panelId);

    // Load saved state
    const isExpanded = localStorage.getItem(`${toggleId}_expanded`) === 'true';

    // Apply initial state
    panel.classList.add('collapsible-panel');

    if (isExpanded) {
      panel.classList.add('max-h-[500px]');
      panel.style.maxHeight = 'max-content';
      chevron.style.transform = 'rotate(180deg)';
      toggleButton.setAttribute('aria-expanded', 'true');

      // Call onExpand callback if provided
      if (typeof onExpand === 'function') {
        setTimeout(onExpand, 100);
      }
    } else {
      panel.classList.add('max-h-0');
      panel.style.maxHeight = '0px';
      chevron.style.transform = 'rotate(0deg)';
    }

    // Add click handler with proper tracking
    trackListener(toggleButton, 'click', () => {
      const isCurrentlyExpanded = panel.classList.contains('max-h-[500px]');

      if (isCurrentlyExpanded) {
        // Collapse
        panel.style.maxHeight = '0px';
        panel.classList.remove('max-h-[500px]');
        chevron.style.transform = 'rotate(0deg)';
        toggleButton.setAttribute('aria-expanded', 'false');
        localStorage.setItem(`${toggleId}_expanded`, 'false');
      } else {
        // Expand
        panel.style.maxHeight = 'max-content';
        panel.classList.add('max-h-[500px]');
        chevron.style.transform = 'rotate(180deg)';
        toggleButton.setAttribute('aria-expanded', 'true');
        localStorage.setItem(`${toggleId}_expanded`, 'true');

        // Call onExpand callback if provided
        if (typeof onExpand === 'function') {
          onExpand();
        }
      }
    });
  } catch (error) {
    console.error(`Error setting up collapsible section ${toggleId}:`, error);
  }
}

/**
 * Setup pinning/unpinning sidebar functionality
 */
function setupPinningSidebar() {
  try {
    const pinButton = document.getElementById('pinSidebarBtn');
    if (!pinButton) {
      console.debug('Pin button element not found in DOM - pinning functionality disabled');
      return;
    }

    if (!sidebar) {
      console.warn('Sidebar element not initialized - pinning functionality disabled');
      return;
    }

    // Check saved pinned state
    const isPinned = localStorage.getItem('sidebarPinned') === 'true';

    // Apply initial state
    if (isPinned) {
      pinButton.classList.add('text-yellow-500');
      const svg = pinButton.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', 'currentColor');
      }
      document.body.classList.add('pinned-sidebar');
    }

    // Add click handler
    trackListener(pinButton, 'click', () => {
      const isPinnedNow = document.body.classList.contains('pinned-sidebar');

      if (isPinnedNow) {
        // Unpin sidebar
        document.body.classList.remove('pinned-sidebar');
        pinButton.classList.remove('text-yellow-500');
        const svg = pinButton.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', 'none');
        }
        localStorage.setItem('sidebarPinned', 'false');
      } else {
        // Pin sidebar
        document.body.classList.add('pinned-sidebar');
        pinButton.classList.add('text-yellow-500');
        const svg = pinButton.querySelector('svg');
        if (svg) {
          svg.setAttribute('fill', 'currentColor');
        }
        localStorage.setItem('sidebarPinned', 'true');
      }
    });
  } catch (error) {
    console.error('Error initializing sidebar pinning:', error);
  }
}

/**
 * Set up custom instructions functionality
 */
function setupCustomInstructions() {
  const instructionsTextarea = document.getElementById('globalCustomInstructions');
  const saveButton = document.getElementById('saveGlobalInstructions');

  if (!instructionsTextarea || !saveButton) {
    console.warn('Custom instructions elements not found in the DOM');
    return;
  }

  // Load saved instructions
  instructionsTextarea.value = localStorage.getItem('globalCustomInstructions') || '';

  // Add click handler
  trackListener(saveButton, 'click', () => {
    const instructions = instructionsTextarea.value;
    localStorage.setItem('globalCustomInstructions', instructions);

    // Update MODEL_CONFIG
    if (window.MODEL_CONFIG) {
      window.MODEL_CONFIG.customInstructions = instructions;
    }

    // Dispatch event to notify other components
    document.dispatchEvent(new CustomEvent('modelConfigChanged', {
      detail: {
        customInstructions: instructions,
        timestamp: Date.now()
      }
    }));

    // Show success notification
    if (typeof window.showNotification === 'function') {
      window.showNotification('Custom instructions saved and applied to chat', 'success');
    } else {
      console.log('Custom instructions saved');
    }
  });
}

/**
 * Set up new chat button and conversation handlers
 */
function setupNewChatButton() {
  // New chat button
  const newChatBtn = document.getElementById('sidebarNewChatBtn');
  if (newChatBtn) {
    trackListener(newChatBtn, 'click', newChatClickHandler);
  }

  // New project button
  const newProjectBtn = document.getElementById('sidebarNewProjectBtn');
  if (newProjectBtn) {
    trackListener(newProjectBtn, 'click', () => {
      // Use the unified ModalManager for project modal
      if (window.modalManager) {
        window.modalManager.show('project');
      } else if (window.projectModal?.openModal) {
        window.projectModal.openModal();
      } else if (window.projectDashboard?.modalManager?.show) {
        window.projectDashboard.modalManager.show('project');
      } else {
        console.error('Modal system not available');
        if (typeof window.showNotification === 'function') {
          window.showNotification('Failed to open project form', 'error');
        }
      }
    });
  }
}

/**
 * New chat button click handler
 */
async function newChatClickHandler() {
  // Clear selected project
  localStorage.removeItem('selectedProjectId');

  // If on projects page, navigate to index.html
  if (window.location.pathname.includes('/projects')) {
    window.location.href = '/index.html';
    return;
  }

  // Check authentication using auth.js
  let isAuthenticated = false;
  try {
    isAuthenticated = await window.auth.isAuthenticated();
  } catch (e) {
    console.warn("[sidebar] Auth verification failed:", e);
  }

  if (!isAuthenticated) {
    if (window.showNotification) {
      window.showNotification("Please log in to create new chats", "error");
    }

    // Let auth.js handle this error
    if (window.auth?.handleAuthError) {
      window.auth.handleAuthError(
        { message: "Not authenticated" },
        "Creating new chat"
      );
    }
    return;
  }

  // Show loading notification
  if (window.showNotification) {
    window.showNotification("Creating new chat...", "info");
  }

  console.log("Sidebar New Chat button clicked");

  // Create new chat if function exists
  if (typeof window.createNewChat === 'function') {
    try {
      console.log("Calling createNewChat function");
      const storedModel = window.MODEL_CONFIG?.modelName || "claude-3-7-sonnet-20250219";

      const newChat = await window.createNewChat();
      console.log("New chat created:", newChat);

      if (window.showNotification) {
        window.showNotification("Chat created successfully", "success");
      }
    } catch (error) {
      console.error("Error creating new chat:", error);

      if (window.showNotification) {
        window.showNotification("Error creating new chat: " + error.message, "error");
      }
    }
  } else {
    console.error("createNewChat function not found");

    if (window.showNotification) {
      window.showNotification("Chat creation function not available", "error");
    }
  }
}

/**
 * Set up the search functionality for conversations and projects
 */
function setupSearchInput() {
  // Set up conversation search
  const chatSearchInput = document.getElementById('chatSearchInput');
  if (chatSearchInput) {
    trackListener(chatSearchInput, 'input', (e) => {
      searchSidebarConversations(e.target.value);
    });
  }

  // Set up project search
  const projectSearchInput = document.getElementById('sidebarProjectSearch');
  if (projectSearchInput) {
    trackListener(projectSearchInput, 'input', (e) => {
      searchSidebarProjects(e.target.value);
    });
  }
}

/**
 * Search conversation list in the sidebar based on search query
 * @param {string} query - The search query to filter conversations
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
 * Load starred conversations from local storage or server
 */
async function loadStarredConversations() {
  const container = document.getElementById('starredConversations');
  if (!container) return;

  // Check authentication using auth.js
  let isAuthenticated = false;
  try {
    isAuthenticated = await window.auth.isAuthenticated();
  } catch (e) {
    console.warn("[sidebar] Auth verification failed:", e);
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
 * @returns {boolean} Whether the conversation is now starred
 */
async function toggleStarConversation(conversationId) {
  // Perform authentication check using the unified auth module
  const isAuthenticated = await window.auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error('[Auth] User is not authenticated');
    return;
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
      starred_conversations: starredIds
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
 * Main initialization function for the sidebar
 */
function initializeSidebar() {
  // Clean up any existing listeners
  cleanupListeners();

  // Initialize core sidebar toggle
  const initSuccess = initializeSidebarToggle();
  if (!initSuccess) {
    console.warn('Sidebar toggle initialization failed');
    return false;
  }

  // Initialize sidebar features
  setupSidebarTabs();
  setupCollapsibleSections();
  setupPinningSidebar();
  setupCustomInstructions();
  setupNewChatButton();
  setupSearchInput();

  // Initialize model dropdown if possible
  if (typeof window.initializeModelDropdown === 'function') {
    window.initializeModelDropdown();
  } else {
    // Set up listener to initialize when available
    document.addEventListener('modelConfigInitialized', () => {
      if (typeof window.initializeModelDropdown === 'function') {
        window.initializeModelDropdown();
      }
    }, { once: true });
  }

  console.log('Sidebar initialized successfully');
  return true;
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

// Expose key functions globally
window.sidebar = {
  toggleStarConversation,
  isConversationStarred,
  loadStarredConversations,
  searchSidebarConversations,
  searchSidebarProjects,
  toggle: toggleSidebar
};

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

/**
 * Update UI elements based on auth state
 * @param {boolean} authenticated - Whether the user is authenticated
 * @param {string} username - Username if authenticated
 */
function updateAuthDependentUI(authenticated, username = null) {
  const authDependentElements = [
    'sidebarNewChatBtn',
    'sidebarNewProjectBtn',
    'starredChatsTab',
    'projectsTab',
    'recentChatsTab'
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

    // Force refresh of projects tab since that's what we're debugging
    if (typeof window.loadSidebarProjects === 'function') {
      console.debug('[Sidebar] Forcing refresh of sidebar projects');
      setTimeout(() => window.loadSidebarProjects(), 500);
    }

    // Also refresh active tab
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

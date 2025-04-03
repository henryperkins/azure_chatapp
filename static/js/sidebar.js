/**
 * sidebar.js
 * ---------
 * Handles all the new sidebar UI functionality:
 * - Tab switching between Recent, Starred, and Projects
 * - Collapsible settings panels
 * - Pinning/unpinning sidebar
 * - Custom instructions saving
 * - Starred conversations management
 */

let sidebar = null;
let isOpen = false;
let toggleBtn = null;
let closeBtn = null;
let savedTab = localStorage.getItem('sidebarActiveTab');

// Define toggleSidebar first since it's used in initializeSidebarToggle
isOpen = false;
let isAnimating = false;

window.toggleSidebar = function(forceState) {
  // Initialize newState properly
  let newState;
  const isMobile = window.innerWidth < 768;

  if (typeof forceState === 'boolean') {
    newState = forceState;
  } else if (isMobile) {
    newState = !isOpen;
  } else {
    newState = !isOpen;
  }

  if (isAnimating) return;
  isAnimating = true;

  isOpen = newState;
  
  // Add body class to prevent scroll when sidebar is open
  if (window.innerWidth < 768) {
    document.body.classList.toggle('sidebar-open', newState);
  }

  // Update accessibility attributes
  toggleBtn?.setAttribute('aria-expanded', newState);
  sidebar?.setAttribute('aria-hidden', !newState);

  // Use transitionsend event for animation completion
  sidebar.addEventListener('transitionend', () => {
    isAnimating = false;
  }, { once: true });

  updateSidebarState();
  updateBackdrop(isOpen);
  updateAccessibilityAttributes();
}

function initializeSidebarToggle() {
  try {
    sidebar = document.getElementById('mainSidebar');
    toggleBtn = document.getElementById('navToggleBtn');
    closeBtn = document.getElementById('closeSidebarBtn');

    if (!sidebar || !toggleBtn) {
      throw new Error(`Sidebar elements missing: 
        Sidebar - ${!!sidebar}, 
        ToggleBtn - ${!!toggleBtn}`);
    }

    // Set up MutationObserver for cleanup
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (!document.contains(sidebar)) {
          console.warn('Sidebar removed from DOM, cleaning up');
          cleanupSidebarListeners();
          observer.disconnect();
        }
      });
    });

    observer.observe(sidebar.parentElement, {
      childList: true,
      subtree: true
    });

    // Initialize reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      sidebar.style.transition = 'none';
    }

  // Set up MutationObserver
  const observer = new MutationObserver((mutations) => {
    if (!document.contains(sidebar)) {
      console.warn('Sidebar removed from DOM, cleaning up');
      cleanupSidebarListeners();
      observer.disconnect();
    }
  });

  if (sidebar) {
    observer.observe(sidebar.parentElement, {
      childList: true,
      subtree: true
    });
  }

  const isMobile = window.innerWidth < 768;
  isOpen = !isMobile; // Show on desktop by default
  
  // Add body class to prevent scroll when sidebar is open
  if (isMobile) {
    document.body.classList.toggle('sidebar-open', isOpen);
  }
  
  // Set up fresh listeners with proper event handling
  setupMobileToggle();
  
  closeBtn?.addEventListener('click', handleToggle);
  
  window.addEventListener('resize', handleResize);
  
  updateSidebarState();
  updateAccessibilityAttributes();
}

function updateSidebarState() {
  const isMobile = window.innerWidth < 768;
  sidebar.classList.toggle('translate-x-0', isOpen && !isMobile);
  sidebar.classList.toggle('-translate-x-full', !isOpen && isMobile);
  
  if (isMobile) {
    document.body.classList.toggle('overflow-hidden', isOpen);
  }
  
  updateBackdrop(isOpen);
}

function handleResize() {
  const isNowMobile = window.innerWidth < 768;
  
  if (isNowMobile && isOpen) {
    // Close sidebar when switching to mobile if it was open
    toggleSidebar(false);
  } else if (!isNowMobile) {
    // Reset state for desktop
    isOpen = true;
    updateSidebarState();
    updateBackdrop(false);
  }
}

function updateBackdrop(show) {
  const backdrop = document.getElementById('sidebarBackdrop');
  const isMobile = window.innerWidth < 768;
  
  if (show && !isMobile) return; // Only needed for mobile

  // Remove existing backdrop if not needed
  if (!show && backdrop) {
    backdrop.remove();
    return;
  }

  if (show && !backdrop) {
    const newBackdrop = document.createElement('div');
    newBackdrop.id = 'sidebarBackdrop';
    newBackdrop.className = 'fixed inset-0 bg-black/50 z-[99] md:hidden';
    newBackdrop.setAttribute('aria-hidden', 'true');
    newBackdrop.setAttribute('role', 'presentation');
    newBackdrop.style.touchAction = 'none';
    newBackdrop.style.pointerEvents = 'auto';
    
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === newBackdrop) {
        toggleSidebar();
        document.activeElement?.blur();
      }
    };

    newBackdrop.addEventListener('touchstart', handler, { passive: false });
    newBackdrop.addEventListener('click', handler);
    
    document.body.appendChild(newBackdrop);
  }
}

// Unified initialization
document.addEventListener('DOMContentLoaded', () => {
    if (document.readyState === 'loading') return;
    initializeSidebarToggle();
});

// Add keyboard accessibility only if toggleBtn exists
if (toggleBtn) toggleBtn.addEventListener('keydown', handleKeydown);

// Track active event listeners
let currentListeners = [];

function cleanupSidebarListeners() {
  currentListeners.forEach(({element, type, handler}) => {
    element.removeEventListener(type, handler);
  });
  currentListeners = [];
}

function trackListener(element, type, handler) {
  element.addEventListener(type, handler);
  currentListeners.push({element, type, handler});
}

function initializeSidebar() {
  cleanupSidebarListeners();
  
  // Initialize pinned state
  if (localStorage.getItem('sidebarPinned') === 'true') {
    document.body.classList.add('pinned-sidebar');
  }

  initializeSidebarToggle();
  setupSidebarTabs();
  setupCollapsibleSections();
  setupPinningSidebar();
  setupCustomInstructions();
  setupNewChatButton();
  initializeModelDropdownOnLoad();

  document.documentElement.style.overflow = '';
}

// Expose reinitialization function
window.reinitializeSidebar = function() {
  sidebar = null;
  isOpen = false;
  toggleBtn = null;
  closeBtn = null;
  initializeSidebar();
};

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

// Setup search functionality
function setupSearchInput() {
  // Set up conversation search
  const chatSearchInput = document.getElementById('chatSearchInput');
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', (e) => {
      searchSidebarConversations(e.target.value);
    });
  }
  
  // Set up project search
  const projectSearchInput = document.getElementById('sidebarProjectSearch');
  if (projectSearchInput) {
    projectSearchInput.addEventListener('input', (e) => {
      searchSidebarProjects(e.target.value);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeSidebar();
  setupSearchInput();
});

/**
 * Ensures the model dropdown is initialized on page load 
 */
function initializeModelDropdownOnLoad() {
  const modelDropdown = document.getElementById('modelSelect');
  if (modelDropdown && typeof window.initializeModelDropdown === 'function') {
    // Check if dropdown needs initialization
    if (modelDropdown.options.length === 0) {
      window.initializeModelDropdown();
    }
    
    // Load model from localStorage instead of hardcoding
    const storedModel = localStorage.getItem('modelName');
    if (!modelDropdown.value && storedModel) {
      modelDropdown.value = storedModel;
    } else if (!modelDropdown.value) {
      // Use default from modelConfig if available
      const defaultModel = window.MODEL_CONFIG?.modelName || 'claude-3-sonnet-20240229';
      modelDropdown.value = defaultModel;
    }
    
    // Apply settings if needed
    if (typeof window.persistSettings === 'function') {
      window.persistSettings();
    }
    
    // Only add listener if not already added
    modelDropdown.removeEventListener('change', window.persistSettings);
    modelDropdown.addEventListener('change', window.persistSettings);
    
    // Also add a listener for custom instructions changes
    const customInstructionsTextarea = document.getElementById('globalCustomInstructions');
    const saveInstructionsButton = document.getElementById('saveGlobalInstructions');
    
    if (customInstructionsTextarea && saveInstructionsButton) {
      saveInstructionsButton.addEventListener('click', function() {
        // Save custom instructions
        const instructions = customInstructionsTextarea.value;
        localStorage.setItem('globalCustomInstructions', instructions);
        
        // Update MODEL_CONFIG and notify components
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
        
        if (window.showNotification) {
          window.showNotification("Custom instructions saved and applied", "success");
        } else {
          console.log("Custom instructions saved and applied");
        }
      });
    }
  }
}

/**
 * Handles switching between tabs in the sidebar
 */
const TAB_CONFIG = {
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

function setupSidebarTabs() {
  const tabs = {};
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  
  // Initialize tab elements with error handling
  Object.entries(TAB_CONFIG).forEach(([name, config]) => {
    try {
      const button = document.getElementById(config.buttonId);
      const content = document.getElementById(config.sectionId);
      
      if (!button || !content) {
        throw new Error(`Tab elements missing for ${name}: 
          Button - ${config.buttonId}, 
          Content - ${config.sectionId}`);
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

    } catch (error) {
      console.error(error);
      return null;
    }
  });
  // Determine if we're on the projects page
  const isProjectsPage = window.location.pathname.includes('/projects') ||
                        document.getElementById('projectManagerPanel');
                        
  // Check required tab buttons based on page
  if (isProjectsPage) {
    // On projects page, we only need the projects tab
    if (!tabs.projects.button || !tabs.projects.content) {
      console.warn('Projects tab elements not found in the DOM');
      return;
    }
  } else {
    // On chat page, check if at least the recent tab is available
    if (!tabs.recent.button || !tabs.recent.content) {
      console.warn('Recent tab elements not found in the DOM');
      return;
    }
  }
  
  // Set current tab based on saved preference or page
  // (Note: isProjectsPage is already defined above)
  
  // Load user preference from localStorage or use default
  savedTab = localStorage.getItem('sidebarActiveTab');
  
  // Override with 'projects' if on projects page and not already set to projects
  if (isProjectsPage && savedTab !== 'projects') {
    localStorage.setItem('sidebarActiveTab', 'projects');
    savedTab = 'projects';
  }
  
  // Use default if no saved tab
  if (!savedTab) {
    savedTab = isProjectsPage ? 'projects' : 'recent';
  }
  
  // Function to activate a tab
  function activateTab(tabName) {
    // Save user preference
    localStorage.setItem('sidebarActiveTab', tabName);
    
    // Update UI for all tabs
    Object.keys(tabs).forEach(tab => {
      if (tabs[tab].button && tabs[tab].content) {
        const isActive = tab === tabName;
        
        // Update button styling
        tabs[tab].button.classList.toggle('border-b-2', isActive);
        tabs[tab].button.classList.toggle('border-blue-600', isActive);
        tabs[tab].button.classList.toggle('text-blue-600', isActive);
        tabs[tab].button.classList.toggle('text-gray-500', !isActive);
        
        // Show/hide content
        tabs[tab].content.classList.toggle('hidden', !isActive);
      }
    });
    
    // Check auth before loading data
    const isAuthenticated = window.API_CONFIG?.isAuthenticated || 
                          (sessionStorage.getItem('userInfo') !== null && 
                           sessionStorage.getItem('auth_state') !== null);
    
    // Check for ongoing auth verification
    const authCheckInProgress = window.API_CONFIG?.authCheckInProgress;
    
    // Only load data if authenticated and no auth check is in progress
    if (isAuthenticated && !authCheckInProgress) {
      // Special actions for specific tabs
      if (tabName === 'recent') {
        // Make sure conversations are loaded
        if (typeof window.loadConversationList === 'function') {
          console.log("Loading conversation list for recent tab");
          setTimeout(() => window.loadConversationList(), 300);
        } else {
          console.warn("loadConversationList function not available");
        }
      } else if (tabName === 'starred') {
        // Load starred conversations
        console.log("Loading starred conversations");
        setTimeout(() => loadStarredConversations(), 300);
      } else if (tabName === 'projects') {
        // Make sure projects are loaded
        if (typeof window.loadSidebarProjects === 'function') {
          console.log("Loading sidebar projects for projects tab");
          setTimeout(() => window.loadSidebarProjects(), 300);
        } else {
          console.warn("loadSidebarProjects function not available");
        }
      }
    } else {
      console.log("Not authenticated or auth check in progress, skipping data loading for tab:", tabName);
    }
  }
  
  // Load user preference or use default
  activateTab(savedTab);
  
  // Set up click handlers for tabs
  Object.keys(tabs).forEach(tab => {
    if (tabs[tab].button) {
      tabs[tab].button.addEventListener('click', () => activateTab(tab));
    }
  });
}

/**
 * Sets up collapsible sections in the sidebar
 */
const COLLAPSIBLE_SECTIONS = [
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

function setupCollapsibleSections() {
  COLLAPSIBLE_SECTIONS.forEach(section => {
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
      throw new Error(`Collapsible section elements not found: 
        Toggle - ${toggleId}, 
        Panel - ${panelId}, 
        Chevron - ${chevronId}`);
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
    chevron.classList.add('rotate-180');
        
    // Call onExpand callback if provided and panel is expanded
    if (typeof onExpand === 'function') {
      setTimeout(onExpand, 100); // Slightly longer timeout to ensure DOM is ready
    }
  } else {
    panel.classList.add('max-h-0');
  }
  
  toggleButton.addEventListener('click', () => {
    const isCurrentlyExpanded = panel.classList.contains('max-h-[999px]');
    
    if (isCurrentlyExpanded) {
      // Collapse
      panel.style.maxHeight = '0px';
      panel.classList.remove('max-h-[999px]');
      chevron.classList.remove('rotate-180');
      chevron.style.transform = 'rotate(0deg)';
      localStorage.setItem(`${toggleId}_expanded`, 'false');
    } else {
      // Expand
      panel.style.maxHeight = 'max-content';
      panel.classList.add('max-h-[999px]');
      chevron.classList.add('rotate-180');
      chevron.style.transform = 'rotate(180deg)';
      localStorage.setItem(`${toggleId}_expanded`, 'true');
      
      // Call onExpand callback if provided
      if (typeof onExpand === 'function') {
        onExpand();
      }
    }
  });
}

/**
 * Setup pinning/unpinning sidebar functionality
 */
function setupPinningSidebar() {
  const pinButton = document.getElementById('pinSidebarBtn');
  const sidebar = document.getElementById('mainSidebar');
  
  if (!pinButton || !sidebar) {
    console.warn('Pinning elements not found in the DOM');
    return;
  }
  
  // Check saved pinned state
  const isPinned = localStorage.getItem('sidebarPinned') === 'true';
  
  // Apply initial state
  if (isPinned) {
    pinButton.classList.add('text-yellow-500');
    pinButton.querySelector('svg').setAttribute('fill', 'currentColor');
    sidebar.classList.add('pinned-sidebar');
  }
  
  pinButton.addEventListener('click', () => {
    const isPinnedNow = sidebar.classList.contains('pinned-sidebar');
    
    if (isPinnedNow) {
      // Unpin sidebar
      sidebar.classList.remove('pinned-sidebar');
      pinButton.classList.remove('text-yellow-500');
      pinButton.querySelector('svg').setAttribute('fill', 'none');
      localStorage.setItem('sidebarPinned', 'false');
    } else {
      // Pin sidebar
      sidebar.classList.add('pinned-sidebar');
      pinButton.classList.add('text-yellow-500');
      pinButton.querySelector('svg').setAttribute('fill', 'currentColor');
      localStorage.setItem('sidebarPinned', 'true');
    }
  });
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
  
  saveButton.addEventListener('click', () => {
    const instructions = instructionsTextarea.value;
    localStorage.setItem('globalCustomInstructions', instructions);
    
    // Update MODEL_CONFIG with instructions
    if (window.MODEL_CONFIG) {
      window.MODEL_CONFIG.customInstructions = instructions;
    }
    
    // Notify message service and other components
    document.dispatchEvent(new CustomEvent('modelConfigChanged', {
      detail: {
        customInstructions: instructions,
        timestamp: Date.now()
      }
    }));
    
    // Show success notification
    if (typeof window.showNotification === 'function') {
      window.showNotification('Custom instructions saved and applied to chat', 'success');
    }
  });
}

/**
 * Set up new chat/project button functionality
 */
function setupNewChatButton() {
  // Handle new chat button
  const newChatBtn = document.getElementById('sidebarNewChatBtn');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', newChatClickHandler);
  }

  // Handle new project button separately
  const newProjectBtn = document.getElementById('sidebarNewProjectBtn');
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', () => {
      if (window.projectDashboard?.modalManager?.show) {
        window.projectDashboard.modalManager.show('project');
      } else if (window.ModalManager?.show) {
        window.ModalManager.show('project');
      } else {
        console.error('ModalManager not available');
        if (typeof window.showNotification === 'function') {
          window.showNotification('Failed to open project form', 'error');
        }
      }
    });
  }

  if (!newChatBtn && !newProjectBtn) {
    console.warn('New chat/project buttons not found in DOM');
  }
}

async function newChatClickHandler() {
    // Clear selected project
    localStorage.removeItem('selectedProjectId');

    // If on projects page, navigate to index.html (formerly projects.html)
    if (window.location.pathname.includes('/projects')) {
      window.location.href = '/index.html';
      return;
    }

    // Show loading notification
    if (window.showNotification) {
      window.showNotification("Creating new chat...", "info");
    }

    console.log("Sidebar New Chat button clicked");

    // Otherwise, create new chat if the function exists
    if (typeof window.createNewChat === 'function') {
      try {
        console.log("Calling createNewChat function");
        // Use stored model name instead of hardcoding
        const storedModel = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
        
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
 * Load starred conversations from local storage or server
 */
function loadStarredConversations() {
  const container = document.getElementById('starredConversations');
  if (!container) return;
  
  // Get starred conversations from local storage
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
  
  if (starredIds.length === 0) {
    // Show empty state
    container.innerHTML = `
      <li class="text-center text-gray-500 py-4">
        No starred conversations yet. Click the star icon on any conversation to add it here.
      </li>
    `;
    return;
  }
  
  // Try to load conversations from server or recent conversations
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
 */
function toggleStarConversation(conversationId) {
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
  
  // Save back to local storage
  localStorage.setItem('starredConversations', JSON.stringify(starredIds));
  
  return index === -1; // Return true if now starred, false if now unstarred
}

/**
 * Checks if a conversation is starred
 */
function isConversationStarred(conversationId) {
  const starredIds = JSON.parse(localStorage.getItem('starredConversations') || '[]');
  return starredIds.includes(conversationId);
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

// Expose key functions globally
window.sidebar = {
  toggleStarConversation,
  isConversationStarred,
  loadStarredConversations,
  searchSidebarConversations,
  searchSidebarProjects,
  toggle: toggleSidebar
};

function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
    }
}

function setupMobileToggle() {
  let touchStartX = 0;
  const threshold = 30; // Minimum horizontal swipe distance
  
  // Handle both click and touch events
  toggleBtn?.addEventListener('touchstart', handleToggle, { passive: true });
  toggleBtn?.addEventListener('click', handleToggle);

  // Add edge swipe detection
  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    
    if (touchStartX < 50 && deltaX > threshold) { // Right edge swipe
      const isMobile = window.innerWidth < 768;
      toggleSidebar(!isMobile); // Open on desktop, close on mobile
      e.preventDefault();
    }
  });
}

function handleToggle(e) {
  e.stopPropagation();
  toggleSidebar();
}

function updateAccessibilityAttributes() {
  if (!toggleBtn || !sidebar) return;
  
  toggleBtn.setAttribute('aria-expanded', isOpen);
  toggleBtn.setAttribute('aria-label', isOpen ? 'Close sidebar' : 'Open sidebar');
  sidebar.setAttribute('aria-hidden', !isOpen);
  
  // Manage focus when closing
  if (!isOpen && document.activeElement === closeBtn) {
    toggleBtn.focus();
  }
}

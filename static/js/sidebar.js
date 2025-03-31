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
let savedTab = null;

// Define toggleSidebar first since it's used in initializeSidebarToggle
window.toggleSidebar = function() {
  const isMobile = window.innerWidth < 768;
  
  // Only allow toggle on mobile view
  if (isMobile) {
    isOpen = !isOpen;
    updateSidebarState();
    updateBackdrop(isOpen);
    updateAccessibilityAttributes();
  }
  
  // Always show sidebar on desktop when toggled
  if (!isMobile) {
    isOpen = true;
    updateSidebarState();
  }
}

function initializeSidebarToggle() {
  sidebar = document.getElementById('mainSidebar');
  toggleBtn = document.getElementById('navToggleBtn');
  closeBtn = document.getElementById('closeSidebarBtn');

  if (!sidebar || !toggleBtn) {
    console.error("Sidebar elements missing");
    return;
  }

  const isMobile = window.innerWidth < 768;
  isOpen = !isMobile; // Show on desktop by default
  
  // Remove duplicate listeners
  toggleBtn?.replaceWith(toggleBtn.cloneNode(true));
  closeBtn?.replaceWith(closeBtn.cloneNode(true));

  // Set up fresh listeners
  toggleBtn?.addEventListener('click', toggleSidebar);
  closeBtn?.addEventListener('click', toggleSidebar);
  window.addEventListener('resize', handleResize);
  
  updateSidebarState();
  updateAccessibilityAttributes();
}

function updateSidebarState() {
    const isMobile = window.innerWidth < 768;
    sidebar.classList.toggle('translate-x-0', isOpen);
    sidebar.classList.toggle('-translate-x-full', !isOpen);
    
    if (isMobile) {
        document.body.classList.toggle('overflow-hidden', isOpen);
        updateBackdrop(isOpen);
    }
}

function handleResize() {
  const wasMobile = window.innerWidth < 768;
  const isNowMobile = window.innerWidth < 768;
  
  if (wasMobile !== isNowMobile) {
    isOpen = !isNowMobile; // Always show on desktop, hide on mobile by default
    updateSidebarState();
    updateBackdrop(isNowMobile && isOpen);
    updateAccessibilityAttributes();
  }
}

function updateBackdrop(show) {
  let backdrop = document.getElementById('sidebarBackdrop');
  
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'fixed inset-0 bg-black/50 z-[99] md:hidden transition-opacity duration-300';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('data-testid', 'sidebar-backdrop');
    
    // Accessible click handler
    backdrop.addEventListener('click', () => {
      toggleSidebar();
      document.getElementById('navToggleBtn')?.focus();
    });
    
    document.body.appendChild(backdrop);
  }

  if (show) {
    backdrop.style.display = 'block';
    backdrop.classList.add('opacity-100');
    backdrop.classList.remove('opacity-0');
    backdrop.setAttribute('aria-hidden', 'false');
  } else {
    backdrop.classList.add('opacity-0');
    backdrop.classList.remove('opacity-100');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('transitionend', () => {
      if (parseFloat(backdrop.style.opacity) === 0) {
        backdrop.style.display = 'none';
      }
    }, { once: true });
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

document.addEventListener('DOMContentLoaded', initializeSidebar);

/**
 * Ensures the model dropdown is initialized on page load 
 */
function initializeModelDropdownOnLoad() {
  const modelDropdown = document.getElementById('modelSelect');
  if (modelDropdown && typeof initializeModelDropdown === 'function') {
    // If the dropdown is empty, initialize it
    if (modelDropdown.options.length === 0) {
      initializeModelDropdown();
    }
    
    // Set default value to Claude 3.7 Sonnet if not already set
    if (!modelDropdown.value) {
      modelDropdown.value = 'claude-3-7-sonnet-20250219';
      if (typeof persistSettings === 'function') {
        persistSettings();
      }
    }
    
    // Listen for user changes to model selection
    modelDropdown.addEventListener('change', persistSettings);
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
  
  // Initialize tab elements
  Object.entries(TAB_CONFIG).forEach(([name, config]) => {
    tabs[name] = {
      button: document.getElementById(config.buttonId),
      content: document.getElementById(config.sectionId),
      loader: config.loader
    };
  });
  
  // Make sure all elements exist before setting up event handlers
  if (!tabs.recent.button || !tabs.starred.button || !tabs.projects.button) {
    console.warn('Sidebar tabs not found in the DOM');
    return;
  }
  
  // Set current tab based on page
  const isProjectsPage = window.location.pathname.includes('/projects') || 
                        document.getElementById('projectManagerPanel');
  const initialTab = isProjectsPage ? 'projects' : 'recent';

  // Redirect if trying to switch away from projects tab on projects page
  if (isProjectsPage && savedTab !== 'projects') {
    localStorage.setItem('sidebarActiveTab', 'projects');
    savedTab = 'projects';
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
          setTimeout(() => window.loadConversationList(), 300);
        }
      } else if (tabName === 'starred') {
        // Load starred conversations
        setTimeout(() => loadStarredConversations(), 300);
      } else if (tabName === 'projects') {
        // Make sure projects are loaded
        if (typeof window.loadSidebarProjects === 'function') {
          setTimeout(() => window.loadSidebarProjects(), 300);
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
  const toggleButton = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);
  const chevron = document.getElementById(chevronId);
  
  if (!toggleButton || !panel || !chevron) {
    console.warn(`Elements for collapsible section '${toggleId}' not found`);
    return;
  }
  
  // Load saved state
  const isExpanded = localStorage.getItem(`${toggleId}_expanded`) === 'true';
  
  // Set initial state
  if (isExpanded) {
    panel.classList.add('max-h-[999px]');
    chevron.classList.add('rotate-180');
    
    // Call onExpand callback if provided and panel is expanded
    if (typeof onExpand === 'function') {
      setTimeout(onExpand, 0); // Execute after current call stack
    }
  }
  
  toggleButton.addEventListener('click', () => {
    const isCurrentlyExpanded = panel.style.maxHeight !== '0px' && panel.style.maxHeight !== '';
    
    if (isCurrentlyExpanded) {
      // Collapse
      panel.style.maxHeight = '0px';
      chevron.style.transform = 'rotate(0deg)';
      localStorage.setItem(`${toggleId}_expanded`, 'false');
    } else {
      // Expand
      panel.style.maxHeight = panel.scrollHeight + 'px';
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
    
    // Show success notification
    if (typeof window.showNotification === 'function') {
      window.showNotification('Custom instructions saved successfully', 'success');
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

    // If on projects.html page, navigate to index.html
    if (window.location.pathname.includes('/projects')) {
      window.location.href = '/';
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
        localStorage.setItem("modelName", "claude-3-sonnet-20240229"); // Ensure Claude is the selected model
        const newChat = await window.createNewChat();
        console.log("New chat created:", newChat); // Add logging
        if (window.showNotification) {
          window.showNotification("Chat created successfully", "success");
        }
      } catch (error) {
        console.error("Error creating new chat:", error); // Add logging
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
  toggle: toggleSidebar
};

function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
    }
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

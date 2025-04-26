/** sidebar.js
 * Dependencies:
 * - localStorage (browser built-in)
 * - window.projectDashboard (external dependency, expected to be available in global scope)
 * - window.auth (external dependency, expected to be available in global scope)
 * - window.projectManager (external dependency, expected to be available in global scope)
 * - DependencySystem (external dependency, used for module registration)
 */

/**
 * Modular Sidebar Component
 * Dependencies:
 * - localStorage (browser built-in)
 * - DependencySystem (for registration)
 * - Requires global: window.projectDashboard, window.projectManager
 * - Uses auth state from DependencySystem.modules.get('app').state.isAuthenticated for all authentication checks.
 */

export function createSidebar() {
  let sidebarEl;
  let sidebarToggleBtn;
  let sidebarCloseBtn;
  let sidebarPinned = false;
  let backdropEl;

  /**
   * Initialization with retry mechanism for DOM elements.
   * Ensures the DOM is ready and elements exist before proceeding.
   */
  async function init() {
    const maxAttempts = 5;
    let attempts = 0;

    const attemptInitialization = async () => {
      attempts++;

      // Locate required elements
      sidebarEl = document.getElementById('mainSidebar');
      sidebarToggleBtn = document.getElementById('navToggleBtn');
      sidebarCloseBtn = document.getElementById('closeSidebarBtn');

      // Check for required elements
      if (!sidebarEl || !sidebarToggleBtn) {
        if (attempts < maxAttempts) {
          console.warn(
            `[sidebar.js] Required elements not found (attempt ${attempts}/${maxAttempts}), retrying in 300ms...`
          );
          await new Promise(r => setTimeout(r, 300));
          return attemptInitialization();
        } else {
          console.error(
            '[sidebar.js] Failed to find critical sidebar elements after multiple retries.'
          );
          return false;
        }
      }

      // Optional close button
      if (!sidebarCloseBtn) {
        console.warn('[sidebar.js] closeSidebarBtn not found; ignoring close event binding.');
      }

      // Activate default tab from localStorage or fallback to 'recent'
      const defaultTab = localStorage.getItem('sidebarActiveTab') || 'recent';
      await activateTab(defaultTab);

      // Event listener for toggle button
      if (window.eventHandlers && typeof window.eventHandlers.trackListener === 'function') {
        window.eventHandlers.trackListener(sidebarToggleBtn, 'click', (e) => {
          e.preventDefault();
          toggleSidebar();
        }, { description: 'Sidebar Toggle Button' });
      } else {
        sidebarToggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          toggleSidebar();
        });
      }

      // Event listener for close button (if present)
      if (sidebarCloseBtn) {
        if (window.eventHandlers && typeof window.eventHandlers.trackListener === 'function') {
          window.eventHandlers.trackListener(sidebarCloseBtn, 'click', (e) => {
            e.preventDefault();
            closeSidebar();
          }, { description: 'Sidebar Close Button' });
        } else {
          sidebarCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
          });
        }
      }

      // Initialize tab buttons
      setupTabListeners();

      // Optional: handle a pinned sidebar from localStorage
      const pinned = localStorage.getItem('sidebarPinned');
      if (pinned === 'true') {
        sidebarPinned = true;
        sidebarEl.classList.add('sidebar-pinned');
        // If pinned means it’s permanently visible, remove hidden class
        sidebarEl.classList.remove('-translate-x-full');
        removeBackdrop();
      }

      // On window resize, remove any leftover mobile overlay if the screen gets bigger
      if (window.eventHandlers && typeof window.eventHandlers.trackListener === 'function') {
        window.eventHandlers.trackListener(window, 'resize', handleResize, { description: 'Sidebar Window Resize' });
      } else {
        window.addEventListener('resize', handleResize);
      }

      console.log('[sidebar.js] Sidebar initialized successfully.');
      return true;
    };

    return attemptInitialization();
  }

  function setupTabListeners() {
    const tabButtons = [
      { id: 'recentChatsTab', name: 'recent' },
      { id: 'starredChatsTab', name: 'starred' },
      { id: 'projectsTab', name: 'projects' }
    ];

    tabButtons.forEach(tabInfo => {
      const button = document.getElementById(tabInfo.id);
      if (!button) {
        console.warn(`[sidebar.js] Tab button not found: ${tabInfo.id}`);
        return;
      }

      button.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = tabInfo.name;
        activateTab(tabName);
        // Store the active tab preference
        localStorage.setItem('sidebarActiveTab', tabName);
      });
    });
  }

  function toggleSidebar() {
    // If pinned, we unpin; if unpinned, we open
    const isHidden = sidebarEl.classList.contains('-translate-x-full');
    sidebarPinned = !sidebarPinned;
    localStorage.setItem('sidebarPinned', sidebarPinned ? 'true' : 'false');

    sidebarEl.classList.toggle('-translate-x-full', !sidebarPinned);
    sidebarEl.setAttribute('aria-hidden', sidebarPinned ? 'false' : 'true');

    if (isHidden) {
      // Sidebar was hidden, so show it
      sidebarEl.classList.remove('-translate-x-full');
      sidebarEl.classList.add('translate-x-0');
      sidebarEl.setAttribute('aria-hidden', 'false');
      createBackdrop();
    } else {
      // Sidebar was visible, so hide it
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
      sidebarEl.setAttribute('aria-hidden', 'true');
      removeBackdrop();
    }
  }

  function closeSidebar() {
    if (!sidebarPinned) {
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
      removeBackdrop();
    }
  }

  function handleResize() {
    if (window.innerWidth >= 1024) {
      // For large screens
      removeBackdrop();
      // Optionally keep the sidebar open if pinned
      if (!sidebarPinned) {
        sidebarEl.classList.remove('translate-x-0');
        sidebarEl.classList.add('-translate-x-full');
      }
    }
  }

  function createBackdrop() {
    if (backdropEl) return;

    backdropEl = document.createElement('div');
    backdropEl.classList.add('fixed', 'inset-0', 'bg-black', 'bg-opacity-50', 'z-40');
    backdropEl.style.cursor = 'pointer';
    document.body.appendChild(backdropEl);

    if (window.eventHandlers && typeof window.eventHandlers.trackListener === 'function') {
      window.eventHandlers.trackListener(backdropEl, 'click', closeSidebar, { description: 'Sidebar Backdrop Click' });
    } else {
      backdropEl.addEventListener('click', closeSidebar);
    }
  }

  function removeBackdrop() {
    if (backdropEl) {
      backdropEl.removeEventListener('click', closeSidebar);
      document.body.removeChild(backdropEl);
      backdropEl = null;
    }
  }

  async function activateTab(tabName) {
    try {
      const tabs = {
        'recent': {
          button: document.getElementById('recentChatsTab'),
          section: document.getElementById('recentChatsSection')
        },
        'starred': {
          button: document.getElementById('starredChatsTab'),
          section: document.getElementById('starredChatsSection')
        },
        'projects': {
          button: document.getElementById('projectsTab'),
          section: document.getElementById('projectsSection')
        }
      };

      // Validate tabName, fallback to 'recent' if invalid
      if (!tabs[tabName]) {
        console.warn(`[sidebar] Unknown tab requested: ${tabName}`);
        tabName = 'recent';
      }

      // Make sure all tab elements exist
      let foundMissingElements = false;
      for (const [tName, tab] of Object.entries(tabs)) {
        if (!tab.button || !tab.section) {
          console.warn(`[sidebar] Missing elements for tab: ${tName}`);
          foundMissingElements = true;
        }
      }
      if (foundMissingElements && (!tabs[tabName].button || !tabs[tabName].section)) {
        console.error(
          `[sidebar] Critical elements missing for target tab: ${tabName}. Aborting tab activation.`
        );
        return;
      }

      // Use centralized auth state from DependencySystem (window.app is also fine here)
      const isAuthenticated = (() => {
        if (window.DependencySystem?.modules?.has('app')) {
          return !!window.DependencySystem.modules.get('app').state.isAuthenticated;
        }
        // fallback if not available yet
        return window.app?.state?.isAuthenticated || false;
      })();

      // If user clicks "projects" tab, ensure projectDashboard is initialized
      if (tabName === 'projects') {
        try {
          // Wait for the global projectDashboard to be available
          const startTime = Date.now();
          const timeout = 5000;
          while (!window.projectDashboard) {
            if (Date.now() - startTime > timeout) {
              throw new Error('window.projectDashboard not available after 5s');
            }
            await new Promise(r => setTimeout(r, 100));
          }

          // Initialize if not already
          const projectSection = document.getElementById('projectsSection');
          if (projectSection && !projectSection.dataset.initialized) {
            const success = await window.projectDashboard.init();
            if (success) {
              projectSection.dataset.initialized = 'true';
              console.log('[sidebar] Project dashboard initialized via tab activation.');
              // Optionally reload projects
              if (isAuthenticated && window.projectManager?.loadProjects) {
                const projects = await window.projectManager.loadProjects('all');
                if (window.uiRenderer?.renderProjects) {
                  window.uiRenderer.renderProjects(projects);
                }
              }
            }
          }
          // Always (re-)render projects list
          if (window.projectManager?.projects && window.uiRenderer?.renderProjects) {
            window.uiRenderer.renderProjects(window.projectManager.projects);
          }
        } catch (err) {
          console.error('[sidebar] Error initializing project dashboard on tab activation:', err);
        }
      }

      // If 'recent' tab, render conversations
      if (tabName === 'recent' && window.chatConfig?.conversations && window.uiRenderer?.renderConversations) {
        window.uiRenderer.renderConversations(window.chatConfig);
      }

      // Update all tabs and ensure correct visibility as before
      Object.entries(tabs).forEach(([name, tab]) => {
        if (tab.button && tab.section) {
          if (name === tabName) {
            tab.button.classList.add('tab-active');
            tab.button.setAttribute('aria-selected', 'true');
            tab.button.tabIndex = 0;
            tab.section.classList.remove('hidden');
          } else {
            tab.button.classList.remove('tab-active');
            tab.button.setAttribute('aria-selected', 'false');
            tab.button.tabIndex = -1;
            tab.section.classList.add('hidden');
          }
        }
      });
    } catch (err) {
      console.error('[sidebar.js] Error in activateTab:', err);
    }
  }

  return {
    init,
    toggleSidebar,
    closeSidebar,
    activateTab
  };
}

// Updated sidebar.js to fix unresponsive sidebar initialization and ensure
// consistent toggle logic across all pages. This file consolidates all
// sidebar-related event listeners, removing duplicates, and properly manages
// the backdrop for mobile overlay. Tailwind classes are used to hide/show
// the sidebar.

(function () {
  // Attach this module to the global window object
  window.sidebar = {
    init,
    toggleSidebar,
    closeSidebar,
    activateTab
  };

  let sidebarEl;
  let sidebarToggleBtn;
  let sidebarCloseBtn;
  let sidebarPinned = false;
  let backdropEl;

  /**
   * Initialization with retry mechanism for DOM elements.
   * Ensures the DOM is ready and elements exist before proceeding.
   */
  function init() {
    return new Promise(async (resolve) => {
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
            return resolve(false);
          }
        }

        // Optional close button
        if (!sidebarCloseBtn) {
          console.warn('[sidebar.js] closeSidebarBtn not found; ignoring close event binding.');
        }

        // Activate default tab from localStorage or fallback to 'recent'
        const defaultTab = localStorage.getItem('sidebarActiveTab') || 'recent';
        activateTab(defaultTab);

        // Event listener for toggle button
        sidebarToggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          toggleSidebar();
        });

        // Event listener for close button (if present)
        if (sidebarCloseBtn) {
          sidebarCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeSidebar();
          });
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
        window.addEventListener('resize', handleResize);

        console.log('[sidebar.js] Sidebar initialized successfully.');
        return resolve(true);
      };

      await attemptInitialization();
    });
  }

  /**
   * Sets up click listeners for tab buttons in the sidebar:
   * - Recent
   * - Starred
   * - Projects
   */
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

  /**
   * Toggles the sidebar open/close, applying Tailwind classes and managing backdrop
   */
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

  /**
   * Closes the sidebar. Typically called by close button or backdrop click
   */
  function closeSidebar() {
    if (!sidebarPinned) {
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
      removeBackdrop();
    }
  }

  /**
   * Check window size and remove leftover mobile overlay if resized to desktop
   */
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

  /**
   * Create a backdrop element for mobile overlay
   */
  function createBackdrop() {
    if (backdropEl) return;

    backdropEl = document.createElement('div');
    backdropEl.classList.add('fixed', 'inset-0', 'bg-black', 'bg-opacity-50', 'z-40');
    backdropEl.style.cursor = 'pointer';
    document.body.appendChild(backdropEl);

    backdropEl.addEventListener('click', closeSidebar);
  }

  /**
   * Remove the backdrop element if it exists
   */
  function removeBackdrop() {
    if (backdropEl) {
      backdropEl.removeEventListener('click', closeSidebar);
      document.body.removeChild(backdropEl);
      backdropEl = null;
    }
  }

  /**
   * activateTab - handles tab switching in the sidebar.
   * Checks for projectDashboard dependency if the 'projects' tab is activated.
   */
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
              if (window.app?.state?.isAuthenticated && window.projectManager?.loadProjects) {
                await window.projectManager.loadProjects('all');
              }
            }
          }
        } catch (err) {
          console.error('[sidebar] Error initializing project dashboard on tab activation:', err);
        }
      }

      // Update all tabs
      Object.entries(tabs).forEach(([name, tab]) => {
        if (tab.button && tab.section) {
          if (name === tabName) {
            // Activate current tab
            tab.button.classList.add('border-b-2', 'border-primary', 'text-primary');
            tab.button.classList.remove('text-base-content/60');
            tab.button.setAttribute('aria-selected', 'true');
            tab.button.removeAttribute('tabindex');
            tab.section.classList.remove('hidden');
          } else {
            // Deactivate other tabs
            tab.button.classList.remove('border-b-2', 'border-primary', 'text-primary');
            tab.button.classList.add('text-base-content/60');
            tab.button.setAttribute('aria-selected', 'false');
            tab.button.setAttribute('tabindex', '-1');
            tab.section.classList.add('hidden');
          }
        }
      });
    } catch (err) {
      console.error('[sidebar.js] Error in activateTab:', err);
    }
  }
})();

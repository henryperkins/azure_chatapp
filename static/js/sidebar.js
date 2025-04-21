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

  // Called on DOMContentLoaded
  function init() {
    sidebarEl = document.getElementById('mainSidebar');
    sidebarToggleBtn = document.getElementById('navToggleBtn');
    sidebarCloseBtn = document.getElementById('closeSidebarBtn');

    // If elements don't exist, return safely
    if (!sidebarEl || !sidebarToggleBtn) {
      console.warn('[sidebar.js] Sidebar or toggle button not found in DOM.');
      return;
    }

    // Activate default tab from localStorage or fallback to 'recent'
    const defaultTab = localStorage.getItem('sidebarActiveTab') || 'recent';
    activateTab(defaultTab);

    // If close button doesn't exist, it's not critical, but log it
    if (!sidebarCloseBtn) {
      console.warn('[sidebar.js] closeSidebarBtn not found; ignoring close event binding.');
    }

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

    // --- START: Added Tab Click Listeners ---
    const tabButtons = [
      { id: 'recentChatsTab', name: 'recent' },
      { id: 'starredChatsTab', name: 'starred' },
      { id: 'projectsTab', name: 'projects' }
    ];

    tabButtons.forEach(tabInfo => {
      const button = document.getElementById(tabInfo.id);
      if (button) {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          activateTab(tabInfo.name);
          // Store the active tab preference
          localStorage.setItem('sidebarActiveTab', tabInfo.name);
        });
      } else {
        console.warn(`[sidebar.js] Tab button not found: ${tabInfo.id}`);
      }
    });
    // --- END: Added Tab Click Listeners ---

    // Optional: handle a pinned sidebar from localStorage
    const pinned = localStorage.getItem('sidebarPinned');
    if (pinned === 'true') {
      sidebarPinned = true;
      sidebarEl.classList.add('sidebar-pinned');
      // (Optional) if pinned means it’s permanently visible, remove hidden class
      sidebarEl.classList.remove('-translate-x-full');
      removeBackdrop();
    }

    // On window resize, remove any leftover mobile overlay if the screen gets bigger
    window.addEventListener('resize', handleResize);

    console.log('[sidebar.js] Sidebar initialized successfully.');
  }

  // Toggles the sidebar open/close, applying Tailwind classes and managing backdrop
  function toggleSidebar() {
    const isHidden = sidebarEl.classList.contains('-translate-x-full');
    const isPinned = sidebarPinned;

    sidebarPinned = !sidebarPinned;
    localStorage.setItem('sidebarPinned', sidebarPinned ? 'true' : 'false');
    sidebarEl.classList.toggle('-translate-x-full', !sidebarPinned);
    sidebarEl.setAttribute('aria-hidden', sidebarPinned ? 'false' : 'true');

    // If currently hidden, show it
    if (isHidden) {
      sidebarEl.classList.remove('-translate-x-full');
      sidebarEl.classList.add('translate-x-0');
      sidebarEl.setAttribute('aria-hidden', 'false');
      createBackdrop();
    } else {
      // Otherwise, hide it
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
      sidebarEl.setAttribute('aria-hidden', 'true');
      removeBackdrop();
    }
  }

  // Closes the sidebar. Called by close button or external backdrop click
  function closeSidebar() {
    if (!sidebarPinned) {
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
      removeBackdrop();
    }
  }

  // Check window size and remove leftover mobile overlay if resized to desktop
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
    // If a backdrop already exists, do nothing
    if (backdropEl) return;

    backdropEl = document.createElement('div');
    backdropEl.classList.add('fixed', 'inset-0', 'bg-black', 'bg-opacity-50', 'z-40');
    backdropEl.style.cursor = 'pointer';
    document.body.appendChild(backdropEl);

    // Attach the click listener directly to closeSidebar
    backdropEl.addEventListener('click', closeSidebar);
  }

  function removeBackdrop() {
    if (backdropEl) {
      backdropEl.removeEventListener('click', closeSidebar);
      document.body.removeChild(backdropEl);
      backdropEl = null;
    }
  }

  /**
   * activateTab - handles tab switching in the sidebar
   */
  function activateTab(tabName) {
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

      // Validate tab name and fallback to default if invalid
      if (!tabs[tabName]) {
        console.warn(`[sidebar] Unknown tab requested: ${tabName}`);
        tabName = 'recent';
      }

      let foundMissingElements = false;
      // Ensure all tab elements exist
      for (const [name, tab] of Object.entries(tabs)) {
        if (!tab.button || !tab.section) {
          console.warn(`[sidebar] Missing elements for tab: ${name}`);
          foundMissingElements = true;
        }
      }
      // If the target tab is missing elements, we can't proceed reliably
      if (
        foundMissingElements &&
        (!tabs[tabName].button || !tabs[tabName].section)
      ) {
        console.error(
          `[sidebar] Critical elements missing for target tab: ${tabName}. Aborting tab activation.`
        );
        return;
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

      // Special handling for projects tab
      if (tabName === 'projects') {
        // Initialize dashboard if not already done
        const projectSection = document.getElementById('projectsSection');
        if (projectSection && !projectSection.dataset.initialized) {
          window.projectDashboard?.init().then((success) => {
            if (success) {
              projectSection.dataset.initialized = 'true';
              console.log('[sidebar] Project dashboard initialized via tab activation.');
              // Optionally trigger project load if needed
              if (window.app?.state?.isAuthenticated && window.projectManager?.loadProjects) {
                window.projectManager.loadProjects('all');
              }
            } else {
              console.error('[sidebar] Failed to initialize project dashboard on tab activation');
            }
          }).catch(err => {
            console.error('[sidebar] Error initializing project dashboard on tab activation:', err);
          });
        } else if (projectSection?.dataset.initialized === 'true') {
          // Re-load projects if needed when switching back
          if (window.app?.state?.isAuthenticated && window.projectManager?.loadProjects) {
            window.projectManager.loadProjects('all');
          }
        }
      }
    } catch (err) {
      console.error('[sidebar.js] Error in activateTab:', err);
    }
  }
})();

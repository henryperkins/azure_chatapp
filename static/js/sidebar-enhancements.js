/**
 * sidebar-enhancements.js
 * Enhanced sidebar functionality for the Azure Chat Application
 */

document.addEventListener('DOMContentLoaded', function() {
  // Initialize sidebar enhancements
  initSidebarAccessibility();
  initSidebarTabSystem();
  initSidebarCollapseControls();
  initSidebarKeyboardShortcuts();

  // Register with DependencySystem if available
  if (window.DependencySystem) {
    window.DependencySystem.register('sidebarEnhancements', {
      toggleTab,
      togglePin,
      toggleSidebar
    });
  }
});

/**
 * Initialize accessibility enhancements for the sidebar
 */
function initSidebarAccessibility() {
  // Ensure proper ARIA attributes on tabs
  const tabs = document.querySelectorAll('[role="tab"]');
  tabs.forEach(tab => {
    // Make sure tabs have appropriate aria-controls
    const controlsId = tab.getAttribute('aria-controls');
    if (controlsId) {
      const controlledElement = document.getElementById(controlsId);
      if (controlledElement) {
        controlledElement.setAttribute('aria-labelledby', tab.id);
      }
    }

    // Add keyboard event listeners to tabs
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTab(tab.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        navigateTabs(e.key === 'ArrowRight' ? 'next' : 'prev');
      }
    });
  });

  // Ensure close button closes sidebar on mobile
  const closeBtn = document.getElementById('closeSidebarBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toggleSidebar(false);
    });
  }

  // Ensure toggle button toggles sidebar
  const toggleBtn = document.getElementById('navToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleSidebar();
    });
  }
}

/**
 * Initialize enhanced tab system functionality
 */
function initSidebarTabSystem() {
  // Set up tab buttons
  const tabButtons = {
    recent: document.getElementById('recentChatsTab'),
    starred: document.getElementById('starredChatsTab'),
    projects: document.getElementById('projectsTab')
  };

  // Set up tab panels
  const tabPanels = {
    recent: document.getElementById('recentChatsSection'),
    starred: document.getElementById('starredChatsSection'),
    projects: document.getElementById('projectsSection')
  };

  // Add click event listeners to tabs
  if (tabButtons.recent) {
    tabButtons.recent.addEventListener('click', () => toggleTab('recentChatsTab'));
  }
  if (tabButtons.starred) {
    tabButtons.starred.addEventListener('click', () => toggleTab('starredChatsTab'));
  }
  if (tabButtons.projects) {
    tabButtons.projects.addEventListener('click', () => toggleTab('projectsTab'));
  }

  // Setup pin sidebar button
  const pinBtn = document.getElementById('pinSidebarBtn');
  if (pinBtn) {
    pinBtn.addEventListener('click', () => togglePin());
  }

  // Setup manage projects button
  const manageBtn = document.getElementById('manageProjectsLink');
  if (manageBtn) {
    manageBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTab('projectsTab');

      if (!window.projectDashboard) {
        console.warn('[sidebar-enhancements] projectDashboard not found');
        return;
      }

      if (!window.projectDashboard.state?.initialized) {
        console.log('[sidebar-enhancements] projectDashboard not initialized, calling initialize()...');
        window.projectDashboard.initialize().then((initSuccess) => {
          if (initSuccess) {
            // Clear project param from URL to ensure list view
            const url = new URL(window.location);
            url.searchParams.delete('project');
            window.history.pushState({}, '', url.toString());
            
            // Force update the DOM
            const listView = document.getElementById('projectListView');
            const detailsView = document.getElementById('projectDetailsView');
            if (listView) {
              listView.classList.remove('hidden', 'opacity-0');
              listView.style.display = '';
            }
            if (detailsView) {
              detailsView.classList.add('hidden');
              detailsView.style.display = 'none';
            }
            
            window.projectDashboard.showProjectList();
          } else {
            console.error('[sidebar-enhancements] Failed to initialize projectDashboard');
          }
        }).catch(err => {
          console.error('[sidebar-enhancements] Error initializing projectDashboard:', err);
        });
      } else {
        // Clear project param from URL to ensure list view
        const url = new URL(window.location);
        url.searchParams.delete('project');
        window.history.pushState({}, '', url.toString());
        
        // Force update the DOM 
        const listView = document.getElementById('projectListView');
        const detailsView = document.getElementById('projectDetailsView');
        if (listView) {
          listView.classList.remove('hidden', 'opacity-0');
          listView.style.display = '';
        }
        if (detailsView) {
          detailsView.classList.add('hidden');
          detailsView.style.display = 'none';
        }
        
        window.projectDashboard.showProjectList();
      }
    });
  }

  // Initialize active tab from localStorage if available
  const savedTab = localStorage.getItem('activeTab');
  if (savedTab && tabButtons[savedTab]) {
    toggleTab(tabButtons[savedTab].id);
  }
}

/**
 * Initialize collapsible sections in the sidebar
 */
function initSidebarCollapseControls() {
  // Replace old toggle model config with new checkbox control
  const oldModelConfigToggle = document.getElementById('toggleModelConfig');
  const oldInstructionsToggle = document.getElementById('toggleCustomInstructions');
  const newModelConfigCheckbox = document.getElementById('modelConfigToggle');
  const newInstructionsCheckbox = document.getElementById('customInstructionsToggle');

  // Convert old collapsible-panel system to use checkbox system
  if (oldModelConfigToggle && newModelConfigCheckbox) {
    const oldModelConfigChevron = document.getElementById('modelConfigChevron');
    const oldModelConfigPanel = document.getElementById('modelConfigPanel');

    // Migrate click handlers
    oldModelConfigToggle.addEventListener('click', function() {
      newModelConfigCheckbox.checked = !newModelConfigCheckbox.checked;
      updateChevronRotation(oldModelConfigChevron, newModelConfigCheckbox.checked);
    });
  }

  if (oldInstructionsToggle && newInstructionsCheckbox) {
    const oldInstructionsChevron = document.getElementById('customInstructionsChevron');
    const oldInstructionsPanel = document.getElementById('customInstructionsPanel');

    // Migrate click handlers
    oldInstructionsToggle.addEventListener('click', function() {
      newInstructionsCheckbox.checked = !newInstructionsCheckbox.checked;
      updateChevronRotation(oldInstructionsChevron, newInstructionsCheckbox.checked);
    });
  }

  // Add listeners to checkboxes to manage chevron rotation
  if (newModelConfigCheckbox) {
    const modelConfigChevron = document.getElementById('modelConfigChevron');
    newModelConfigCheckbox.addEventListener('change', function() {
      updateChevronRotation(modelConfigChevron, this.checked);
    });
  }

  if (newInstructionsCheckbox) {
    const instructionsChevron = document.getElementById('customInstructionsChevron');
    newInstructionsCheckbox.addEventListener('change', function() {
      updateChevronRotation(instructionsChevron, this.checked);
    });
  }
}

/**
 * Initialize keyboard shortcuts for the sidebar
 */
function initSidebarKeyboardShortcuts() {
  // Add global keyboard shortcut listener
  document.addEventListener('keydown', function(e) {
    // Only process shortcuts if accessibilityUtils is loaded
    if (!window.accessibilityUtils || !window.accessibilityUtils.toggleKeyboardShortcuts) return;

    // Skip if event is from an input/textarea
    if (window.accessibilityUtils && window.accessibilityUtils.isInputElement && window.accessibilityUtils.isInputElement(e.target)) return;

    // / or ` to toggle sidebar
    if ((e.key === '/' || e.key === '`') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleSidebar();
    }

    // 1-3 to switch tabs
    if (e.key === '1' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleTab('recentChatsTab');
    } else if (e.key === '2' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleTab('starredChatsTab');
    } else if (e.key === '3' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleTab('projectsTab');
    }

    // ? to toggle keyboard help
    if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (window.accessibilityUtils && window.accessibilityUtils.toggleKeyboardHelp) {
        window.accessibilityUtils.toggleKeyboardHelp();
      }
    }
  });

  // Set up keyboard help button
  const keyboardHelpBtn = document.getElementById('keyboardHelpBtn');
  if (keyboardHelpBtn) {
    keyboardHelpBtn.addEventListener('click', function() {
      if (window.accessibilityUtils && typeof window.accessibilityUtils.toggleKeyboardHelp === 'function') {
        window.accessibilityUtils.toggleKeyboardHelp();
      } else {
        // Fallback for rare cases where global is undefined
        const helpDialog = document.getElementById('keyboardHelp');
        if (helpDialog) {
          const isOpen = !helpDialog.classList.contains('hidden');
          helpDialog.classList.toggle('hidden', isOpen);
          if (!isOpen) {
            // Focus first button in dialog
            const closeBtn = helpDialog.querySelector('button');
            if (closeBtn) setTimeout(() => closeBtn.focus(), 50);
          }
        }
      }
    });
  }
}

/**
 * Toggle a sidebar tab to be active
 * @param {string} tabId - ID of the tab to activate
 */
function toggleTab(tabId) {
  // Get all tabs and panels
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');

  // Get the target tab and panel
  const targetTab = document.getElementById(tabId);
  if (!targetTab) return;

  const targetPanelId = targetTab.getAttribute('aria-controls');
  const targetPanel = document.getElementById(targetPanelId);
  if (!targetPanel) return;

  // Deactivate all tabs and hide all panels
  tabs.forEach(tab => {
    tab.setAttribute('aria-selected', 'false');
    tab.classList.remove('tab-active');
    tab.tabIndex = -1;
  });

  panels.forEach(panel => {
    panel.classList.add('hidden');
    panel.classList.remove('flex');
  });

  // Activate target tab and show target panel
  targetTab.setAttribute('aria-selected', 'true');
  targetTab.classList.add('tab-active');
  targetTab.tabIndex = 0;
  targetTab.focus();

  targetPanel.classList.remove('hidden');
  targetPanel.classList.add('flex');

  // Store active tab in localStorage
  const tabMap = {
    'recentChatsTab': 'recent',
    'starredChatsTab': 'starred',
    'projectsTab': 'projects'
  };

  if (tabMap[tabId]) {
    localStorage.setItem('activeTab', tabMap[tabId]);
  }

  // Announce to screen readers
  if (window.accessibilityUtils && window.accessibilityUtils.announceScreenReaderText) {
    window.accessibilityUtils.announceScreenReaderText(`${targetTab.textContent.trim()} tab selected`);
  }

  // Trigger a custom event that other components can listen for
  const event = new CustomEvent('sidebarTabChanged', {
    detail: { tabId, panelId: targetPanelId }
  });
  document.dispatchEvent(event);
}

/**
 * Navigate between tabs using arrow keys
 * @param {string} direction - 'next' or 'prev'
 */
function navigateTabs(direction) {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  const currentIndex = tabs.indexOf(activeTab);
  let newIndex;

  if (direction === 'next') {
    newIndex = (currentIndex + 1) % tabs.length;
  } else {
    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  }

  toggleTab(tabs[newIndex].id);
}

/**
 * Toggle the sidebar pin state
 * @param {boolean} [pinned] - Force a specific pin state (optional)
 */
function togglePin(pinned) {
  const sidebar = document.getElementById('mainSidebar');
  if (!sidebar) return;

  const isPinned = pinned === undefined ? !sidebar.classList.contains('sidebar-pinned') : pinned;

  // Update class
  sidebar.classList.toggle('sidebar-pinned', isPinned);

  // Save state
  localStorage.setItem('sidebarPinned', isPinned ? 'true' : 'false');

  // Announce to screen readers
  if (window.accessibilityUtils && window.accessibilityUtils.announceScreenReaderText) {
    window.accessibilityUtils.announceScreenReaderText(
      isPinned ? 'Sidebar pinned. It will stay open.' : 'Sidebar unpinned. It will hide when collapsed.'
    );
  }

  // Trigger a custom event
  const event = new CustomEvent('sidebarPinChanged', {
    detail: { pinned: isPinned }
  });
  document.dispatchEvent(event);
}

/**
 * Toggle the sidebar visibility
 * @param {boolean} [visible] - Force a specific visibility state (optional)
 */
function toggleSidebar(visible) {
  const sidebar = document.getElementById('mainSidebar');
  if (!sidebar) return;

  // Toggle if no value is provided
  if (visible === undefined) {
    visible = sidebar.classList.contains('-translate-x-full');
  }

  // Set appropriate ARIA attributes
  sidebar.setAttribute('aria-hidden', (!visible).toString());

  // Toggle transform class to show/hide
  if (visible) {
    sidebar.classList.remove('-translate-x-full');

    // Focus first interactive element when opened
    if (window.accessibilityUtils && window.accessibilityUtils.focusElement) {
      window.accessibilityUtils.focusElement('#recentChatsTab, #starredChatsTab, #projectsTab', 100);
    }
  } else {
    sidebar.classList.add('-translate-x-full');

    // Focus toggle button when closed
    if (window.accessibilityUtils && window.accessibilityUtils.focusElement) {
      window.accessibilityUtils.focusElement('#navToggleBtn', 100);
    }
  }

  // Set the navToggleBtn aria-expanded to match
  const navToggleBtn = document.getElementById('navToggleBtn');
  if (navToggleBtn) {
    navToggleBtn.setAttribute('aria-expanded', visible.toString());
  }

  // Trigger a custom event
  const event = new CustomEvent('sidebarVisibilityChanged', {
    detail: { visible }
  });
  document.dispatchEvent(event);
}

/**
 * Update the rotation of a chevron icon based on expanded state
 * @param {HTMLElement} chevronElement - The chevron SVG element
 * @param {boolean} isExpanded - Whether the section is expanded
 */
function updateChevronRotation(chevronElement, isExpanded) {
  if (!chevronElement) return;

  if (isExpanded) {
    chevronElement.style.transform = 'rotate(180deg)';
  } else {
    chevronElement.style.transform = 'rotate(0)';
  }
}


// Export functionality for use in other modules
window.sidebarEnhancements = {
  toggleTab,
  togglePin,
  toggleSidebar,
  navigateTabs,
  initSidebarKeyboardShortcuts
};

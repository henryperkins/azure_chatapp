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

    if (isPinned) {
      // If pinned, unpin and hide
      sidebarPinned = false;
      localStorage.setItem('sidebarPinned', 'false');
      sidebarEl.classList.add('-translate-x-full');
      removeBackdrop();
      return;
    }

    // If currently hidden, show it
    if (isHidden) {
      sidebarEl.classList.remove('-translate-x-full');
      sidebarEl.classList.add('translate-x-0'); // ensure it’s visible
      createBackdrop();
    } else {
      // Otherwise, hide it
      sidebarEl.classList.remove('translate-x-0');
      sidebarEl.classList.add('-translate-x-full');
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

    backdropEl.addEventListener('click', () => {
      closeSidebar();
    });
  }

  function removeBackdrop() {
    if (backdropEl) {
      backdropEl.removeEventListener('click', closeSidebar);
      document.body.removeChild(backdropEl);
      backdropEl = null;
    }
  }

  // Optionally, you can add a pinSidebar function or other features
  // p.s. This would require a UI element that calls it
  /*
  function pinSidebar() {
    sidebarPinned = true;
    localStorage.setItem('sidebarPinned', 'true');
    sidebarEl.classList.remove('-translate-x-full');
    removeBackdrop();
    sidebarEl.classList.add('sidebar-pinned');
  }
  */

/**
 * activateTab - stub function to avoid errors if called by external code
 */
function activateTab(tabName) {
  console.log("[sidebar] activateTab() not implemented. Received:", tabName);
}

// Automatically initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);

})();

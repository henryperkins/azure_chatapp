/**
 * sidebar-enhancements.js
 * UI scaffolding for the sidebar:
 *  - migrate old chevron toggles to new checkbox-based collapse controls
 *  - wire “Manage Projects” link to the centralized sidebar controller
 *
 * This file is loaded as a plain <script>, so we attach only to window,
 * no ES module exports.
 */
(function() {
  // Helper for tracking events: use window.eventHandlers if available,
  // otherwise fall back to addEventListener.
  const EH = window.eventHandlers || {
    trackListener(el, type, handler, opts) {
      if (el && el.addEventListener) el.addEventListener(type, handler, opts && opts.capture);
    }
  };

  function initSidebarEnhancements() {
    initCollapseControls();
    initManageProjectsLink();
  }

  /**
   * Migrate legacy toggle elements to the new checkbox-based collapse panels,
   * updating chevron rotation accordingly.
   */
  function initCollapseControls() {
    const oldModelToggle   = document.getElementById('toggleModelConfig');
    const oldInstrToggle   = document.getElementById('toggleCustomInstructions');
    const newModelCheckbox = document.getElementById('modelConfigToggle');
    const newInstrCheckbox = document.getElementById('customInstructionsToggle');

    // Legacy → new toggle: Model Config
    if (oldModelToggle && newModelCheckbox) {
      const chevron = document.getElementById('modelConfigChevron');
      EH.trackListener(oldModelToggle, 'click', () => {
        newModelCheckbox.checked = !newModelCheckbox.checked;
        updateChevronRotation(chevron, newModelCheckbox.checked);
      });
    }

    // Legacy → new toggle: Custom Instructions
    if (oldInstrToggle && newInstrCheckbox) {
      const chevron = document.getElementById('customInstructionsChevron');
      EH.trackListener(oldInstrToggle, 'click', () => {
        newInstrCheckbox.checked = !newInstrCheckbox.checked;
        updateChevronRotation(chevron, newInstrCheckbox.checked);
      });
    }

    // Checkbox change → update chevron: Model Config
    if (newModelCheckbox) {
      const chevron = document.getElementById('modelConfigChevron');
      EH.trackListener(newModelCheckbox, 'change', () => {
        updateChevronRotation(chevron, newModelCheckbox.checked);
      });
    }

    // Checkbox change → update chevron: Custom Instructions
    if (newInstrCheckbox) {
      const chevron = document.getElementById('customInstructionsChevron');
      EH.trackListener(newInstrCheckbox, 'change', () => {
        updateChevronRotation(chevron, newInstrCheckbox.checked);
      });
    }
  }

  /**
   * Rotate a chevron element to indicate expanded/collapsed state.
   * @param {HTMLElement} el – the chevron SVG/icon
   * @param {boolean} expanded – true = rotated 180°, false = 0°
   */
  function updateChevronRotation(el, expanded) {
    if (!el) return;
    el.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0)';
  }

  /**
   * Wire the “Manage Projects” link to the sidebar controller’s tab logic.
   */
  function initManageProjectsLink() {
    const btn = document.getElementById('manageProjectsLink');
    if (!btn) return;

    EH.trackListener(btn, 'click', e => {
      e.preventDefault();
      const sidebar = window.DependencySystem?.modules?.get('sidebar');
      sidebar?.activateTab('projects');
    });
  }

  // Expose initializer for app.js
  window.initSidebarEnhancements = initSidebarEnhancements;
})();

/**
 * sidebar-enhancements.js
 *
 * Strict DI/Modularity checklist-compliant edition.
 *
 * Provides API for sidebar UI enhancements:
 *   - Migrates legacy chevron toggles to new checkbox-collapse panels.
 *   - Wires "Manage Projects" to the sidebar tab logic.
 *
 * **No use of window, document, or global scope.**
 * All dependencies (eventHandlers, DependencySystem, domAPI, notify) must be provided by DI/explicit parameter.
 *
 * Usage:
 *   import { createSidebarEnhancements } from './sidebar-enhancements.js';
 *   const se = createSidebarEnhancements({ eventHandlers, DependencySystem, domAPI, notify });
 *   se.initSidebarEnhancements();
 *
 * No globals are attached by this module.
 */

export function createSidebarEnhancements({ eventHandlers, DependencySystem, domAPI }) {
  if (!eventHandlers) throw new Error('eventHandlers required for sidebar-enhancements');
  if (!domAPI) throw new Error('domAPI required for sidebar-enhancements');
  const EH = eventHandlers;
  const MODULE_NAME = 'sidebar-enhancements'; // For consistent logging

  function migrateLegacyToggle({ oldToggleId, newCheckboxId, chevronId }) {
    try {
      const oldToggle = domAPI.getElementById(oldToggleId);
      const newCheckbox = domAPI.getElementById(newCheckboxId);
      const chevron = domAPI.getElementById(chevronId);
      if (oldToggle && newCheckbox) {
        EH.trackListener(oldToggle, 'click', () => {
          newCheckbox.checked = !newCheckbox.checked;
          updateChevronRotation(chevron, newCheckbox.checked);
        }, `sidebar-enhancements: migrate legacy toggle ${oldToggleId}`);
      }
      if (newCheckbox) {
        EH.trackListener(newCheckbox, 'change', () => {
          updateChevronRotation(chevron, newCheckbox.checked);
        }, `sidebar-enhancements: checkbox change ${newCheckboxId}`);
      }
    } catch (err) {
      // Notification removed per checklist; fail silently or log as needed.
    }
  }

  /**
   * Migrate all collapse controls from legacy toggles to checkbox+chevron.
   */
  function initCollapseControls() {
    migrateLegacyToggle({
      oldToggleId: 'toggleModelConfig',
      newCheckboxId: 'modelConfigToggle',
      chevronId: 'modelConfigChevron'
    });
    migrateLegacyToggle({
      oldToggleId: 'toggleCustomInstructions',
      newCheckboxId: 'customInstructionsToggle',
      chevronId: 'customInstructionsChevron'
    });
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
    try {
      const btn = domAPI.getElementById('manageProjectsLink');
      if (!btn) return;
      EH.trackListener(btn, 'click', e => {
        e.preventDefault();
        const sidebar = DependencySystem?.modules?.get('sidebar');
        sidebar?.activateTab('projects');
      }, 'sidebar-enhancements: manage projects link');
    } catch (err) {
      // Notification removed per checklist; fail silently or log as needed.
    }
  }

  function initSidebarEnhancements() {
    initCollapseControls();
    initManageProjectsLink();
  }

  // API exposed for composition/testing; never attached to global scope.
  return {
    initSidebarEnhancements
  };
}

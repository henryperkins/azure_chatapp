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

export function createSidebarEnhancements({
  eventHandlers,
  DependencySystem,
  domAPI,
  _modelConfig, // for injecting model config UI if needed (unused for now)
  logger,
  _safeHandler // unused for now, but kept for future use
}) {
  if (!eventHandlers) throw new Error('eventHandlers required for sidebar-enhancements');
  if (!domAPI) throw new Error('domAPI required for sidebar-enhancements');
  const EH = eventHandlers;
  const MODULE_NAME = 'sidebar-enhancements'; // For consistent logging

  // --- Settings Panel DOM and logic ---
  let settingsPanelEl = null;
  function attachSettingsPanel(sidebarEl) {
    if (!sidebarEl) throw new Error('Sidebar element required to attach settings panel');
    if (!settingsPanelEl) {
      settingsPanelEl = domAPI.getElementById('sidebarSettingsPanel');
      if (!settingsPanelEl) {
        settingsPanelEl = domAPI.createElement('div');
        settingsPanelEl.id = 'sidebarSettingsPanel';
        settingsPanelEl.className =
          'hidden flex flex-col gap-2 p-3 overflow-y-auto border-t border-base-300';
        // Insert at end of sidebar
        domAPI.appendChild(sidebarEl, settingsPanelEl);
      }
    }
    return settingsPanelEl;
  }

  function toggleSettingsPanel(force, modelConfigCb) {
    if (!settingsPanelEl) return;
    const show = force !== undefined ? !!force : settingsPanelEl.classList.contains('hidden');
    domAPI.toggleClass(settingsPanelEl, 'hidden', !show);
    if (show && modelConfigCb && typeof modelConfigCb === "function") {
      modelConfigCb(settingsPanelEl);
    }
  }

  // --- Legacy features ---

  function migrateLegacyToggle({ oldToggleId, newCheckboxId, chevronId }) {
    try {
      const oldToggle = domAPI.getElementById(oldToggleId);
      const newCheckbox = domAPI.getElementById(newCheckboxId);
      const chevron = domAPI.getElementById(chevronId);
      if (oldToggle && newCheckbox) {
        EH.trackListener(
          oldToggle,
          'click',
          () => {
            domAPI.setProperty(newCheckbox, 'checked', !newCheckbox.checked);
            updateChevronRotation(chevron, newCheckbox.checked);
          },
          {
            description: `Migrate legacy toggle ${oldToggleId}`,
            context: MODULE_NAME,
            source: 'migrateLegacyToggle'
          }
        );
      }
      if (newCheckbox) {
        EH.trackListener(
          newCheckbox,
          'change',
          () => {
            updateChevronRotation(chevron, newCheckbox.checked);
          },
          {
            description: `Checkbox change ${newCheckboxId}`,
            context: MODULE_NAME,
            source: 'migrateLegacyToggle'
          }
        );
      }
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[${MODULE_NAME}][migrateLegacyToggle] Failed to migrate legacy toggle`, err, {
          context: MODULE_NAME,
          oldToggleId,
          newCheckboxId,
          chevronId
        });
      }
    }
  }

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

  function updateChevronRotation(el, expanded) {
    if (!el) return;
    el.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0)';
  }

  function initManageProjectsLink() {
    try {
      const btn = domAPI.getElementById('manageProjectsLink');
      if (!btn) return;
      EH.trackListener(
        btn,
        'click',
        e => {
          e.preventDefault();
          const sidebar = DependencySystem?.modules?.get('sidebar');
          sidebar?.activateTab('projects');
        },
        {
          description: 'Manage projects link click',
          context: MODULE_NAME,
          source: 'initManageProjectsLink'
        }
      );
    } catch (err) {
      if (logger && typeof logger.error === 'function') {
        logger.error(`[${MODULE_NAME}][initManageProjectsLink] Failed to initialize manage projects link`, err, {
          context: MODULE_NAME
        });
      }
    }
  }

  function initSidebarEnhancements() {
    initCollapseControls();
    initManageProjectsLink();
  }

  // Public API
  return {
    initSidebarEnhancements,
    attachSettingsPanel,
    toggleSettingsPanel,
    cleanup() {
      eventHandlers.cleanupListeners({ context: 'sidebar-enhancements' });
    }
  };
}

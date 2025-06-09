/**
 * ProjectEventHandlers – extracted event handling logic (Phase-2)
 * -------------------------------------------------------------
 * Handles all event listener binding and management for ProjectDetailsComponent.
 * Extracted from oversized ProjectDetailsComponent to enforce module size limits.
 */

export function createProjectEventHandlers({
  domAPI,
  eventHandlers,
  logger,
  modalManager,
  projectManager,
  authenticationService: _authenticationService, // prefixed with _
  navigationService,
  eventService: _eventService, // prefixed with _
  uiStateService: _uiStateService, // prefixed with _
  projectContextService: _projectContextService, // prefixed with _
} = {}) {
  const MODULE = 'ProjectEventHandlers';

  if (!domAPI || !eventHandlers || !logger) {
    throw new Error(`[${MODULE}] Required dependencies missing: domAPI, eventHandlers, logger`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  /**
   * Bind back button navigation
   */
  function bindBackButton(backBtn, onBackCallback) {
    if (!backBtn) return;

    eventHandlers.trackListener(backBtn, 'click', (event) => {
      event.preventDefault();
      if (typeof onBackCallback === 'function') {
        onBackCallback();
      }
    }, { context: MODULE });
  }

  /**
   * Bind tab switching functionality
   */
  function bindTabButtons(tabButtons, onTabSwitchCallback) {
    if (!tabButtons?.length) return;

    tabButtons.forEach(tabBtn => {
      eventHandlers.trackListener(tabBtn, 'click', (event) => {
        event.preventDefault();
        const targetTab = tabBtn.getAttribute('data-target');
        if (targetTab && typeof onTabSwitchCallback === 'function') {
          onTabSwitchCallback(targetTab, tabBtn);
        }
      }, { context: MODULE });
    });
  }

  /**
   * Bind project action buttons (edit, archive, delete)
   */
  function bindProjectActionButtons(projectData, callbacks = {}) {
    const {
      onEditProject,
      onArchiveProject,
      onDeleteProject
    } = callbacks;

    // Edit project button
    const editBtn = domAPI.querySelector('[data-action="edit-project"]');
    if (editBtn && onEditProject) {
      eventHandlers.trackListener(editBtn, 'click', (event) => {
        event.preventDefault();
        onEditProject(projectData);
      }, { context: MODULE });
    }

    // Archive/Unarchive project button
    const archiveBtn = domAPI.querySelector('[data-action="archive-project"]');
    if (archiveBtn && onArchiveProject) {
      eventHandlers.trackListener(archiveBtn, 'click', (event) => {
        event.preventDefault();
        onArchiveProject(projectData);
      }, { context: MODULE });
    }

    // Delete project button
    const deleteBtn = domAPI.querySelector('[data-action="delete-project"]');
    if (deleteBtn && onDeleteProject) {
      eventHandlers.trackListener(deleteBtn, 'click', (event) => {
        event.preventDefault();
        onDeleteProject(projectData);
      }, { context: MODULE });
    }
  }

  /**
   * Bind document-level event listeners
   */
  function bindDocumentEvents(callbacks = {}) {
    const {
      onProjectDeleted,
      onProjectArchived,
      onProjectUpdated,
      onAuthStateChange
    } = callbacks;

    const document = domAPI.getDocument();
    if (!document) return;

    // Project deleted event
    if (onProjectDeleted) {
      eventHandlers.trackListener(document, 'projectDeleted', (event) => {
        onProjectDeleted(event.detail);
      }, { context: MODULE });
    }

    // Project archived event
    if (onProjectArchived) {
      eventHandlers.trackListener(document, 'projectArchived', (event) => {
        onProjectArchived(event.detail);
      }, { context: MODULE });
    }

    // Project updated event
    if (onProjectUpdated) {
      eventHandlers.trackListener(document, 'projectUpdated', (event) => {
        onProjectUpdated(event.detail);
      }, { context: MODULE });
    }

    // Auth state change event
    if (onAuthStateChange) {
      eventHandlers.trackListener(document, 'authStateChanged', (event) => {
        onAuthStateChange(event.detail);
      }, { context: MODULE });
    }
  }

  /**
   * Handle project modal actions (edit, archive, delete confirmations)
   */
  async function handleProjectModalAction(action, projectData) {
    if (!modalManager) {
      _logError('Modal manager not available for action:', action);
      return;
    }

    try {
      switch (action) {
        case 'edit':
          await modalManager.openModal('editProject', { project: projectData });
          break;

        case 'archive': {
          // Wrap lexical declarations in a block
          const confirmMsg = `Archive project "${projectData.name}"?`;
          modalManager.confirmAction({
            title: 'Archive Project',
            message: confirmMsg,
            confirmText: 'Archive',
            confirmClass: 'btn-warning',
            onConfirm: async () => {
              try {
                await projectManager.archiveProject(projectData.id);
                logger.info('[ProjectEventHandlers] Project archived', { projectId: projectData.id });
              } catch (err) {
                logger.error('[ProjectEventHandlers] Archive failed', err);
              }
            }
          });
          break;
        }
        case 'unarchive': {
          const confirmMsg = `Unarchive project "${projectData.name}"?`;
          modalManager.confirmAction({
            title: 'Unarchive Project',
            message: confirmMsg,
            confirmText: 'Unarchive',
            confirmClass: 'btn-success',
            onConfirm: async () => {
              try {
                await projectManager.unarchiveProject(projectData.id);
                logger.info('[ProjectEventHandlers] Project unarchived', { projectId: projectData.id });
              } catch (err) {
                logger.error('[ProjectEventHandlers] Unarchive failed', err);
              }
            }
          });
          break;
        }
        case 'pin': {
          const confirmMsg = `Pin project "${projectData.name}"?`;
          modalManager.confirmAction({
            title: 'Pin Project',
            message: confirmMsg,
            confirmText: 'Pin',
            confirmClass: 'btn-primary',
            onConfirm: async () => {
              try {
                await projectManager.pinProject(projectData.id);
                logger.info('[ProjectEventHandlers] Project pinned', { projectId: projectData.id });
              } catch (err) {
                logger.error('[ProjectEventHandlers] Pin failed', err);
              }
            }
          });
          break;
        }
        case 'delete': {
          // Wrap lexical declaration in a block
          {
            const confirmMsg = `Delete project "${projectData.name}"?`;
            modalManager.confirmAction({
              title: 'Delete Project',
              message: confirmMsg,
              confirmText: 'Delete',
              confirmClass: 'btn-error',
              onConfirm: async () => {
                try {
                  await projectManager.deleteProject(projectData.id);
                  logger.info('[ProjectEventHandlers] Project deleted', { projectId: projectData.id });
                } catch (err) {
                  logger.error('[ProjectEventHandlers] Delete failed', err);
                }
              }
            });
          }
          break;
        }

        default:
          _logError('Unknown modal action:', action);
      }
    } catch (error) {
      _logError(`Project ${action} action failed:`, error);
    }
  }

  /**
   * Bind all event listeners for project details
   */
  function bindAllEventListeners(config = {}) {
    const {
      projectData,
      backButton,
      tabButtons,
      callbacks = {}
    } = config;

    _log('Binding all event listeners', { projectId: projectData?.id });

    // Bind navigation
    bindBackButton(backButton, callbacks.onBack);
    bindTabButtons(tabButtons, callbacks.onTabSwitch);

    // Bind project actions
    bindProjectActionButtons(projectData, {
      onEditProject: (data) => handleProjectModalAction('edit', data),
      onArchiveProject: (data) => handleProjectModalAction('archive', data),
      onDeleteProject: (data) => handleProjectModalAction('delete', data)
    });

    // Bind document events
    bindDocumentEvents(callbacks);

    _log('Event listeners bound successfully');
  }

  return {
    bindBackButton,
    bindTabButtons,
    bindProjectActionButtons,
    bindDocumentEvents,
    handleProjectModalAction,
    bindAllEventListeners,
    cleanup: () => {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
  };
}

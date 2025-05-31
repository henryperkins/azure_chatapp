/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
/**
 * @module knowledgeBaseManager
 * @description Manages Knowledge Base settings, lifecycle, files, and GitHub integration.
 */
const MODULE = "KnowledgeBaseManager";

/**
 * Creates a manager for handling Knowledge Base (KB) lifecycle, settings, files, and GitHub integration within a project context.
 *
 * The returned manager provides methods for toggling KB activation, reprocessing files, handling KB settings forms, deleting KBs, managing KB modals, loading KB health and files, attaching/detaching GitHub repositories, validating model compatibility, updating model selection, and cleaning up event listeners.
 *
 * @param {Object} ctx - Context object containing dependencies, state, DOM elements, utilities, and callbacks required for KB management.
 * @returns {Object} An object exposing public methods for managing the Knowledge Base feature within a project.
 *
 * @throws {Error} If required dependencies (`apiRequest`, `eventHandlers`, `domAPI`, or logger) are missing from the context.
 */
export function createKnowledgeBaseManager(ctx) {
  /* ------------------------------------------------------------------
   * Guardrail #1 – Factory Function Export - Validate dependencies
   * ------------------------------------------------------------------ */
  const REQUIRED_DEPS = ["apiRequest", "eventHandlers", "domAPI"];
  for (const dep of REQUIRED_DEPS) {
    if (!ctx?.[dep]) {
      // ------------------------------------------------------------------
      // Special handling for apiRequest – allow lazy resolution
      // ------------------------------------------------------------------
      if (dep === "apiRequest") {
        const fallbackApiRequest =
          ctx.app?.apiRequest ||                // direct app reference
          ctx.getDep?.("app")?.apiRequest;      // via DependencySystem
        if (typeof fallbackApiRequest === "function") {
          ctx.apiRequest = fallbackApiRequest;
          continue; // dependency satisfied with fallback
        }

        /* ----------------------------------------------------------------
         * Lazy placeholder: defer hard-failure until apiRequest is used.
         * This allows the component to initialize during early bootstrap
         * phases (when only a proxy or no apiClient is registered yet).
         * ---------------------------------------------------------------- */
        ctx.apiRequest = async () => {
          throw new Error(
            `[${MODULE}] apiRequest dependency not ready – called before registration.`
          );
        };
        console.warn(
          `[${MODULE}] apiRequest dependency missing during initialization – using lazy placeholder.`
        );
        continue; // treat as satisfied for now
      }

      // For all other dependencies we must fail fast.
      throw new Error(`[${MODULE}] Missing required dependency '${dep}'`);
    }
  }

  const DependencySystem = ctx.getDep ? ctx.getDep("DependencySystem") : null;
  const logger = ctx.logger || ctx.getDep("logger"); // Ensure logger is available
  if (!logger) {
    throw new Error(`[${MODULE}] Logger dependency is missing from context.`);
  }

  const domReadinessService = ctx.domReadinessService
    || ctx.getDep?.('domReadinessService');
  const appReadyPromise = domReadinessService
    ? domReadinessService.dependenciesAndElements({ deps: ['app'] })
    : Promise.resolve();

  /**
   * Enables or disables the knowledge base for the current project.
   *
   * Updates the activation state both on the server and in the UI, synchronizes local storage, and refreshes project details or knowledge base info as needed.
   *
   * @param {boolean} enabled - Whether to activate (`true`) or deactivate (`false`) the knowledge base.
   * @returns {Promise<void>}
   *
   * @throws {Error} If the API request to toggle the knowledge base fails.
   */
  async function toggleKnowledgeBase(enabled) {
    logger.info(`[${MODULE}][toggleKnowledgeBase] Called with enabled: ${enabled}`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][toggleKnowledgeBase] App is ready. Proceeding.`, { context: MODULE });

    const pid = ctx._getCurrentProjectId();
    if (!pid) {
      logger.warn(`[${MODULE}][toggleKnowledgeBase] No project ID found. Aborting.`, { context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][toggleKnowledgeBase] Project ID: ${pid}`, { context: MODULE });

    try {
      const resp = await ctx.apiRequest(
        `/api/projects/${pid}/knowledge-bases/toggle`,
        { method: "POST", body: { enable: enabled } },
      );
      logger.debug(`[${MODULE}][toggleKnowledgeBase] API response:`, { response: resp, context: MODULE });

      if (resp.status === "success") {
        logger.info(`[${MODULE}][toggleKnowledgeBase] Successfully toggled KB to ${enabled} for project ${pid}.`, { context: MODULE });
        if (ctx.state.knowledgeBase) {
          ctx.state.knowledgeBase.is_active = enabled;
        }
        ctx._updateStatusIndicator(enabled); // UI update
        const storage = ctx.getDep("storage");
        if (storage && typeof storage.setItem === "function") {
          storage.setItem(`kb_enabled_${pid}`, String(enabled));
        }

        if (ctx.projectManager.loadProjectDetails) {
          logger.debug(`[${MODULE}][toggleKnowledgeBase] Reloading project details for ${pid}.`, { context: MODULE });
          const project = await ctx.projectManager.loadProjectDetails(pid);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, pid); // UI update
        } else {
          logger.debug(`[${MODULE}][toggleKnowledgeBase] projectManager.loadProjectDetails not available. Rendering with current KB state.`, { context: MODULE });
          ctx.renderKnowledgeBaseInfo(ctx.state.knowledgeBase, pid); // UI update
        }
      } else {
        logger.error(`[${MODULE}][toggleKnowledgeBase] API reported failure.`, { responseMessage: resp.message, context: MODULE });
        throw new Error(resp.message || "Failed to toggle knowledge base status.");
      }
    } catch (err) {
      logger.error(
        `[${MODULE}][toggleKnowledgeBase] Error toggling knowledge base for project ${pid}. Reverting UI.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      if (ctx.elements.kbToggle) ctx.elements.kbToggle.checked = !enabled; // Revert UI
      ctx._updateStatusIndicator(!enabled); // Revert UI
      // Optionally, show an error to the user via ctx._showStatusAlert or similar
    }
  }

  /**
   * Initiates reprocessing of all knowledge base files for the specified project.
   *
   * Triggers a server-side reindexing of all files in the project's knowledge base. Updates UI state and reloads project or knowledge base details upon completion.
   *
   * @param {string} projectId - The unique identifier of the project whose knowledge base files will be reprocessed.
   * @returns {Promise<void>}
   *
   * @throws {Error} If the API request to reprocess files fails.
   */
  async function reprocessFiles(projectId) {
    logger.info(`[${MODULE}][reprocessFiles] Called for project ID: ${projectId}`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][reprocessFiles] App is ready. Proceeding.`, { context: MODULE });

    if (!ctx.validateUUID(projectId)) {
      logger.warn(`[${MODULE}][reprocessFiles] Invalid project ID: ${projectId}. Aborting.`, { context: MODULE });
      return;
    }
    const btn = ctx.elements.reprocessButton;
    ctx._setButtonLoading(btn, true, "Processing...");
    logger.debug(`[${MODULE}][reprocessFiles] Reprocess button loading state set.`, { context: MODULE });

    try {
      const resp = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-base/reindex`,
        { method: "POST", body: { force: true } },
      );
      logger.debug(`[${MODULE}][reprocessFiles] API response:`, { response: resp, context: MODULE });

      if (resp.status === "success") {
        logger.info(`[${MODULE}][reprocessFiles] Successfully initiated reprocessing for project ${projectId}.`, { context: MODULE });
        if (ctx.projectManager.loadProjectDetails) {
          logger.debug(`[${MODULE}][reprocessFiles] Reloading project details and stats for ${projectId}.`, { context: MODULE });
          const [project] = await Promise.all([
            ctx.projectManager.loadProjectDetails(projectId),
            ctx.projectManager.loadProjectStats?.(projectId), // Optional chaining for loadProjectStats
          ]);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId); // UI update
        } else if (ctx.state.knowledgeBase?.id) {
          logger.debug(`[${MODULE}][reprocessFiles] projectManager.loadProjectDetails not available. Reloading KB health and files directly.`, { kbId: ctx.state.knowledgeBase.id, context: MODULE });
          await loadKnowledgeBaseHealth(ctx.state.knowledgeBase.id); // Refresh health
          await loadKnowledgeBaseFiles(projectId, ctx.state.knowledgeBase.id); // Refresh files
        }
      } else {
        logger.error(`[${MODULE}][reprocessFiles] API reported failure.`, { responseMessage: resp.message, context: MODULE });
        throw new Error(resp.message || "Reprocessing request failed.");
      }
    } catch (err) {
      logger.error(
        `[${MODULE}][reprocessFiles] Error during reprocessing for project ${projectId}.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      // Optionally, show an error to the user
    } finally {
      ctx._setButtonLoading(btn, false);
      logger.debug(`[${MODULE}][reprocessFiles] Reprocess button loading state reset.`, { context: MODULE });
    }
  }

  /**
   * Handles submission of the Knowledge Base settings form, validating input and initiating creation or update of the Knowledge Base.
   *
   * Prevents default form submission, validates required fields, constructs the payload, and triggers the submission process. If creating a new Knowledge Base, includes the option to process existing files.
   *
   * @param {Event} e - The form submit event.
   */
  function handleKnowledgeBaseFormSubmit(e) {
    e.preventDefault();
    logger.info(`[${MODULE}][handleKnowledgeBaseFormSubmit] Form submitted.`, { context: MODULE });
    const form = e.target;
    const projectId = form.dataset.projectId || ctx._getCurrentProjectId();

    if (!ctx.validateUUID(projectId)) {
      logger.warn(`[${MODULE}][handleKnowledgeBaseFormSubmit] Invalid project ID: ${projectId}. Aborting.`, { context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][handleKnowledgeBaseFormSubmit] Project ID: ${projectId}`, { context: MODULE });

    const data = new FormData(form);
    const payload = {
      name: data.get("name"),
      description: data.get("description") || null,
      embedding_model: data.get("embedding_model"),
    };
    logger.debug(`[${MODULE}][handleKnowledgeBaseFormSubmit] Payload created:`, { payload, context: MODULE });

    if (!ctx.state.knowledgeBase?.id) { // Creating new KB
      payload.process_existing_files = form.elements["process_all_files"]?.checked || false;
      logger.debug(`[${MODULE}][handleKnowledgeBaseFormSubmit] New KB. process_existing_files: ${payload.process_existing_files}`, { context: MODULE });
    }

    if (!payload.name?.trim()) {
      logger.warn(`[${MODULE}][handleKnowledgeBaseFormSubmit] Name is empty. Aborting.`, { context: MODULE });
      // TODO: Show validation error to user
      return;
    }
    if (!payload.embedding_model) {
      logger.warn(`[${MODULE}][handleKnowledgeBaseFormSubmit] Embedding model not selected. Aborting.`, { context: MODULE });
      // TODO: Show validation error to user
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    ctx._setButtonLoading(btn, true);
    logger.debug(`[${MODULE}][handleKnowledgeBaseFormSubmit] Submit button loading state set.`, { context: MODULE });

    _submitKnowledgeBaseForm(projectId, payload).finally(() => {
      ctx._setButtonLoading(btn, false);
      logger.debug(`[${MODULE}][handleKnowledgeBaseFormSubmit] Submit button loading state reset.`, { context: MODULE });
    });
  }

  /**
   * Submits knowledge base settings to the server for creation or update.
   *
   * Determines whether to create a new knowledge base or update an existing one based on the current state, sends the appropriate API request, and updates the UI accordingly. Handles conflict errors by attempting to refresh project details and update the UI.
   *
   * @param {string} projectId - The ID of the project to which the knowledge base belongs.
   * @param {Object} payload - The settings data to submit for the knowledge base.
   *
   * @returns {Promise<void>}
   *
   * @throws {Error} If the server response indicates failure or returns invalid data.
   */
  async function _submitKnowledgeBaseForm(projectId, payload) {
    logger.info(`[${MODULE}][_submitKnowledgeBaseForm] Submitting for project ID: ${projectId}`, { payload, context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] App is ready. Proceeding.`, { context: MODULE });

    try {
      const kbId = ctx.state.knowledgeBase?.id;
      const isUpdating = !!kbId;
      logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] KB ID: ${kbId}, Is updating: ${isUpdating}`, { context: MODULE });

      const method = isUpdating ? "PATCH" : "POST";
      const url = isUpdating
        ? `/api/projects/${projectId}/knowledge-bases/${kbId}`
        : `/api/projects/${projectId}/knowledge-bases`;
      logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] API URL: ${url}, Method: ${method}`, { context: MODULE });

      const resp = await ctx.apiRequest(url, { method, body: payload });
      logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] API response:`, { response: resp, context: MODULE });

      const responseData = isUpdating ? resp.data : (resp.data?.knowledge_base || resp.data);

      if (responseData?.id || resp.status === "success") {
        logger.info(`[${MODULE}][_submitKnowledgeBaseForm] Form submission successful for project ${projectId}. KB ID: ${responseData?.id}`, { context: MODULE });
        hideKnowledgeBaseModal();

        if (ctx.projectManager.loadProjectDetails) {
          logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] Reloading project details for ${projectId}.`, { context: MODULE });
          const project = await ctx.projectManager.loadProjectDetails(projectId);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId); // UI update
        } else {
          logger.debug(`[${MODULE}][_submitKnowledgeBaseForm] projectManager.loadProjectDetails not available. Rendering with combined KB state.`, { context: MODULE });
          ctx.renderKnowledgeBaseInfo({
            ...ctx.state.knowledgeBase,
            ...responseData,
          }, projectId); // UI update
        }
      } else {
        logger.error(`[${MODULE}][_submitKnowledgeBaseForm] API reported failure or invalid data.`, { responseMessage: resp.message, responseData, context: MODULE });
        throw new Error(resp.message || "Invalid response from server");
      }
    } catch (err) {
      logger.error(
        `[${MODULE}][_submitKnowledgeBaseForm] Error submitting form for project ${projectId}.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      if (err.status === 409) {
        logger.warn(
          `[${MODULE}][_submitKnowledgeBaseForm] Conflict (409) detected. Attempting to refresh project details.`,
          { status: err?.status ?? 400, data: err, message: err?.message ?? String(err) },
          { context: MODULE }
        );
        if (ctx.projectManager.loadProjectDetails) {
          try {
            const project = await ctx.projectManager.loadProjectDetails(projectId);
            ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId); // Refresh UI
            hideKnowledgeBaseModal();
          } catch (refreshError) {
            logger.error(
              `[${MODULE}][_submitKnowledgeBaseForm] Error refreshing project details after 409.`,
              { status: refreshError?.status ?? 500, data: refreshError, message: refreshError?.message ?? String(refreshError) },
              { context: MODULE }
            );
          }
        }
      } else {
        // Handle other errors, potentially show user message via ctx._showStatusAlert
        ctx._showStatusAlert(`Error saving settings: ${err.message || 'Unknown server error'}`, "error");
      }
    }
  }

  /**
   * Deletes the current knowledge base after user confirmation.
   *
   * Prompts the user to confirm deletion, then sends a request to remove the knowledge base for the current project. On success, closes the modal, updates the UI to reflect the inactive state, and reloads project details. If deletion fails, displays an error alert.
   *
   * @remark If the project ID or knowledge base ID is missing, the function aborts without performing any action.
   */
  async function handleDeleteKnowledgeBase() {
    logger.info(`[${MODULE}][handleDeleteKnowledgeBase] Initiating delete.`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] App is ready. Proceeding.`, { context: MODULE });

    const projectId = ctx._getCurrentProjectId();
    const kbId = ctx.state.knowledgeBase?.id;

    if (!projectId || !kbId) {
      logger.warn(`[${MODULE}][handleDeleteKnowledgeBase] Project ID or KB ID missing. Aborting.`, { projectId, kbId, context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] Project ID: ${projectId}, KB ID: ${kbId}`, { context: MODULE });

    const confirmed = await ctx.modalManager.confirmAction({ // Pass as object
      title: "Delete Knowledge Base?",
      message: "Are you sure you want to permanently delete this knowledge base? This action cannot be undone.",
      confirmText: "Delete",
      confirmClass: "btn-error"
    });


    if (!confirmed) {
      logger.info(`[${MODULE}][handleDeleteKnowledgeBase] Deletion cancelled by user.`, { context: MODULE });
      return;
    }

    const deleteButton = ctx.elements.deleteKnowledgeBaseBtn;
    ctx._setButtonLoading(deleteButton, true, "Deleting...");
    logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] Delete button loading state set.`, { context: MODULE });

    try {
      const resp = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/${kbId}`,
        { method: "DELETE" }
      );
      logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] API response:`, { response: resp, context: MODULE });

      if (resp.status === "success" || resp.data?.deleted_id) {
        logger.info(`[${MODULE}][handleDeleteKnowledgeBase] Successfully deleted KB ${kbId} for project ${projectId}.`, { context: MODULE });
        hideKnowledgeBaseModal();
        ctx._showInactiveState();
        if (ctx.projectManager.loadProjectDetails) {
          logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] Reloading project details for ${projectId}.`, { context: MODULE });
          await ctx.projectManager.loadProjectDetails(projectId);
        }
      } else {
        logger.error(`[${MODULE}][handleDeleteKnowledgeBase] API reported failure.`, { responseMessage: resp.message, context: MODULE });
        throw new Error(resp.message || "Failed to delete knowledge base.");
      }
    } catch (err) {
      logger.error(
        `[${MODULE}][handleDeleteKnowledgeBase] Error deleting KB ${kbId} for project ${projectId}.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      ctx._showStatusAlert(`Error deleting Knowledge Base: ${err.message || 'Unknown server error'}`, "error");
    } finally {
      ctx._setButtonLoading(deleteButton, false);
      logger.debug(`[${MODULE}][handleDeleteKnowledgeBase] Delete button loading state reset.`, { context: MODULE });
    }
  }

  /**
   * Displays the Knowledge Base settings modal dialog, populating the form with current or default KB data and updating related UI elements.
   *
   * If a Knowledge Base exists for the current project, its details are loaded and shown in the form; otherwise, the form is prepared for creating a new KB. The modal also manages the visibility and content of GitHub repository attachment fields based on KB state, and validates model selection compatibility.
   */
  async function showKnowledgeBaseModal() {
    logger.info(`[${MODULE}][showKnowledgeBaseModal] Showing KB settings modal.`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][showKnowledgeBaseModal] App is ready. Proceeding.`, { context: MODULE });

    const modal = ctx.elements.settingsModal;
    if (!modal || typeof modal.showModal !== "function") {
      logger.warn(`[${MODULE}][showKnowledgeBaseModal] Settings modal element not found or not a dialog. Aborting.`, { context: MODULE });
      return;
    }

    const projectId = ctx._getCurrentProjectId();
    if (!projectId) {
      logger.warn(`[${MODULE}][showKnowledgeBaseModal] No project ID found. Aborting modal show.`, { context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][showKnowledgeBaseModal] Project ID: ${projectId}`, { context: MODULE });

    // Refresh KB state before populating the form
    try {
      if (ctx.projectManager.loadProjectDetails) {
        logger.debug(`[${MODULE}][showKnowledgeBaseModal] Refreshing project details for ${projectId} to get latest KB state.`, { context: MODULE });
        const projectDetails = await ctx.projectManager.loadProjectDetails(projectId);
        if (projectDetails && typeof projectDetails.knowledge_base !== 'undefined') {
          ctx.state.knowledgeBase = projectDetails.knowledge_base;
          logger.debug(`[${MODULE}][showKnowledgeBaseModal] KB state updated from project details. KB ID: ${ctx.state.knowledgeBase?.id}`, { context: MODULE });
        } else if (projectDetails === null) {
          logger.warn(`[${MODULE}][showKnowledgeBaseModal] Project details load failed for ${projectId}. Modal might show stale KB data.`, { context: MODULE });
        } else {
          logger.debug(`[${MODULE}][showKnowledgeBaseModal] Project details loaded but no 'knowledge_base' field found.`, { projectDetails, context: MODULE });
        }
      }
    } catch (err) {
      logger.error(
        `[${MODULE}][showKnowledgeBaseModal] Error refreshing project details. Modal might show stale KB data.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
    }

    const form = ctx.elements.settingsForm;
    if (form) {
      form.reset();
      logger.debug(`[${MODULE}][showKnowledgeBaseModal] Settings form reset.`, { context: MODULE });
      const kbIdInput = form.elements["knowledge_base_id"];
      if (kbIdInput) {
        kbIdInput.value = ctx.state.knowledgeBase?.id || "";
      }
    }

    _updateModelSelection(ctx.state.knowledgeBase?.embedding_model || null);
    logger.debug(`[${MODULE}][showKnowledgeBaseModal] Model selection updated. Current model: ${ctx.state.knowledgeBase?.embedding_model}`, { context: MODULE });

    const deleteBtn = ctx.elements.deleteKnowledgeBaseBtn;
    const { kbGitHubAttachedRepoInfo, kbAttachedRepoUrlDisplay, kbAttachedRepoBranchDisplay, kbGitHubAttachForm, kbGitHubRepoUrlInput, kbGitHubBranchInput, kbGitHubFilePathsTextarea } = ctx.elements;

    if (ctx.state.knowledgeBase && ctx.state.knowledgeBase.id) {
      logger.debug(`[${MODULE}][showKnowledgeBaseModal] Populating form for existing KB. ID: ${ctx.state.knowledgeBase.id}`, { context: MODULE });
      const kb = ctx.state.knowledgeBase;
      if (form) {
        form.elements["name"].value = kb.name || "";
        form.elements["description"].value = kb.description || "";
        const processAllFilesCheckbox = form.elements["process_all_files"];
        if (processAllFilesCheckbox) processAllFilesCheckbox.checked = false;

        const autoEnableCheckbox = form.elements["auto_enable"];
        if (autoEnableCheckbox) autoEnableCheckbox.checked = kb.is_active !== false;
      }
      deleteBtn?.classList.remove("hidden");

      if (kb.repo_url) {
        kbGitHubAttachedRepoInfo?.classList.remove("hidden");
        if (kbAttachedRepoUrlDisplay) kbAttachedRepoUrlDisplay.textContent = kb.repo_url;
        if (kbAttachedRepoBranchDisplay) kbAttachedRepoBranchDisplay.textContent = kb.branch || 'main';
        kbGitHubAttachForm?.classList.add("hidden");
      } else {
        kbGitHubAttachedRepoInfo?.classList.add("hidden");
        kbGitHubAttachForm?.classList.remove("hidden");
        if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
        if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
        if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
      }
    } else {
      logger.debug(`[${MODULE}][showKnowledgeBaseModal] Populating form for new KB.`, { context: MODULE });
      if (form) {
        const processAllFilesCheckbox = form.elements["process_all_files"];
        if (processAllFilesCheckbox) processAllFilesCheckbox.checked = true;

        const autoEnableCheckbox = form.elements["auto_enable"];
        if (autoEnableCheckbox) autoEnableCheckbox.checked = true;
      }
      deleteBtn?.classList.add("hidden");
      kbGitHubAttachedRepoInfo?.classList.add("hidden");
      kbGitHubAttachForm?.classList.remove("hidden");
      if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
      if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
      if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
    }

    if (form) form.dataset.projectId = projectId; // Set projectId on form

    modal.showModal();
    validateSelectedModelDimensions();
    logger.debug(`[${MODULE}][showKnowledgeBaseModal] Modal shown.`, { context: MODULE });
  }

  /**
   * Closes the Knowledge Base settings modal dialog if it is present and supports closing.
   */
  function hideKnowledgeBaseModal() {
    logger.info(`[${MODULE}][hideKnowledgeBaseModal] Hiding KB settings modal.`, { context: MODULE });
    const modal = ctx.elements.settingsModal;
    if (modal && typeof modal.close === "function") {
      modal.close();
    } else {
      logger.warn(`[${MODULE}][hideKnowledgeBaseModal] Settings modal element not found or not a dialog.`, { context: MODULE });
    }
  }

  /**
   * Loads and updates health metrics for a specific Knowledge Base by ID.
   *
   * Retrieves detailed health information for the given Knowledge Base, updates relevant UI elements and internal state, and returns the health data object if found.
   *
   * @param {string} kbId - The Knowledge Base ID to load health metrics for.
   * @returns {Promise<Object|null>} The health data object for the Knowledge Base, or null if not found or on error.
   */
  async function loadKnowledgeBaseHealth(kbId) {
    logger.info(`[${MODULE}][loadKnowledgeBaseHealth] Called for KB ID: ${kbId}`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][loadKnowledgeBaseHealth] App is ready. Proceeding.`, { context: MODULE });

    if (!kbId || !ctx.validateUUID(kbId)) {
      logger.warn(`[${MODULE}][loadKnowledgeBaseHealth] Invalid KB ID: ${kbId}. Aborting.`, { context: MODULE });
      return null;
    }
    try {
      const projectId = ctx._getCurrentProjectId();
      if (!projectId) {
        logger.warn(`[${MODULE}][loadKnowledgeBaseHealth] No project ID found for KB ${kbId}. Aborting.`, { context: MODULE });
        return null;
      }
      logger.debug(`[${MODULE}][loadKnowledgeBaseHealth] Project ID: ${projectId}`, { context: MODULE });

      const healthResp = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/status?detailed=true`, // Assuming this endpoint provides health for a specific KB or all for project
        { method: "GET" }
      );
      logger.debug(`[${MODULE}][loadKnowledgeBaseHealth] API response for KB ${kbId}:`, { response: healthResp, context: MODULE });

      // Assuming healthResp.data contains an array of KBs or a single KB object for the project
      // And we need to find the specific KB by kbId if multiple are returned, or it's the main object.
      let kbHealthData = null;
      if (Array.isArray(healthResp?.data)) {
        kbHealthData = healthResp.data.find(kb => kb.id === kbId);
      } else if (healthResp?.data?.id === kbId || (healthResp?.data && !Array.isArray(healthResp?.data) && Object.keys(healthResp.data).length > 0 && !kbId)) {
        // If kbId was not initially passed, but we got a single KB object, assume it's the one.
        // Or if a single object is returned and its ID matches.
        kbHealthData = healthResp.data;
      }


      if (kbHealthData) {
        logger.info(`[${MODULE}][loadKnowledgeBaseHealth] Health data found for KB ${kbId}.`, { data: kbHealthData, context: MODULE });
        const { kbNameDisplay, kbModelDisplay, knowledgeFileCount, knowledgeChunkCount, knowledgeFileSize } = ctx.elements;

        if (kbNameDisplay && kbHealthData.name) kbNameDisplay.textContent = kbHealthData.name;
        if (kbModelDisplay && kbHealthData.embedding_model) kbModelDisplay.textContent = kbHealthData.embedding_model;

        if (knowledgeFileCount && kbHealthData.files?.total_files !== undefined) {
          knowledgeFileCount.textContent = kbHealthData.files.total_files;
        }
        if (knowledgeChunkCount && kbHealthData.vector_stats?.total_vectors !== undefined) {
          knowledgeChunkCount.textContent = kbHealthData.vector_stats.total_vectors;
        }

        let totalSize = 0;
        if (kbHealthData.files?.files_details) {
          kbHealthData.files.files_details.forEach(file => totalSize += (file.file_size || 0));
        } else if (ctx.state.knowledgeBase?.stats?.total_size_bytes && ctx.state.knowledgeBase.id === kbId) {
          // Fallback to potentially stale component state if API doesn't provide detailed sizes
          totalSize = ctx.state.knowledgeBase.stats.total_size_bytes;
        }
        if (knowledgeFileSize) {
          knowledgeFileSize.textContent = ctx.uiUtils.formatBytes(totalSize);
        }

        if (ctx.state.knowledgeBase && ctx.state.knowledgeBase.id === kbId) {
          logger.debug(`[${MODULE}][loadKnowledgeBaseHealth] Updating component state for KB ${kbId}.`, { context: MODULE });
          ctx.state.knowledgeBase.name = kbHealthData.name || ctx.state.knowledgeBase.name;
          ctx.state.knowledgeBase.embedding_model = kbHealthData.embedding_model || ctx.state.knowledgeBase.embedding_model;
          if (kbHealthData.files) {
            ctx.state.knowledgeBase.stats = {
              ...ctx.state.knowledgeBase.stats,
              file_count: kbHealthData.files.total_files || 0,
              unprocessed_files: kbHealthData.files.pending_files || 0,
            };
          }
          if (kbHealthData.vector_stats) {
            ctx.state.knowledgeBase.stats.chunk_count = kbHealthData.vector_stats.total_vectors || 0;
          }
          ctx._updateStatusAlerts(ctx.state.knowledgeBase);
        }
      } else {
        logger.warn(`[${MODULE}][loadKnowledgeBaseHealth] No specific health data found for KB ${kbId} in response.`, { response: healthResp, context: MODULE });
      }
      return kbHealthData;
    } catch (err) {
      logger.error(
        `[${MODULE}][loadKnowledgeBaseHealth] Error loading health for KB ${kbId}.`,
        { status: err?.status ?? 500, data: err, message: err?.message ?? String(err) },
        { context: MODULE }
      );
      ctx._showStatusAlert(`Could not load Knowledge Base status: ${err.message}`, "error");
      return null;
    }
  }

  /**
   * Loads and displays the list of files for a project's knowledge base.
   *
   * Retrieves the files associated with the specified project and knowledge base, updating the UI to show the files or a placeholder if none are found. If the project or KB ID is missing, or if an error occurs, the files list is cleared and the files section is hidden.
   *
   * @param {string} projectId - The project identifier.
   * @param {string} kbId - The knowledge base identifier.
   */
  async function loadKnowledgeBaseFiles(projectId, kbId) {
    logger.info(`[${MODULE}][loadKnowledgeBaseFiles] Called for project: ${projectId}, KB ID: ${kbId}`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][loadKnowledgeBaseFiles] App is ready. Proceeding.`, { context: MODULE });

    if (!projectId || !kbId) {
      logger.warn(`[${MODULE}][loadKnowledgeBaseFiles] Project ID or KB ID missing. Clearing files list.`, { projectId, kbId, context: MODULE });
      _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } }); // Clear UI
      ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
      return;
    }

    try {
      const response = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/files-list`, // Assuming this is the correct endpoint for a specific KB's files or all project files for KB context
        { method: "GET" }
      );
      logger.debug(`[${MODULE}][loadKnowledgeBaseFiles] API response for files list:`, { response: response, context: MODULE });

      if (response.status === "success" && response.data) {
        logger.info(`[${MODULE}][loadKnowledgeBaseFiles] Successfully loaded ${response.data.files?.length || 0} files for KB ${kbId}.`, { context: MODULE });
        _renderKnowledgeBaseFiles(response.data); // UI update
        ctx.elements.knowledgeBaseFilesSection?.classList.toggle("hidden", response.data.files.length === 0);
      } else {
        logger.warn(`[${MODULE}][loadKnowledgeBaseFiles] API reported no success or no data for KB ${kbId}. Clearing files list.`, { response, context: MODULE });
        _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } }); // Clear UI
        ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
      }
    } catch (error) {
      logger.error(
        `[${MODULE}][loadKnowledgeBaseFiles] Error loading files for KB ${kbId}.`,
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } }); // Clear UI on error
      ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
      ctx._showStatusAlert(`Could not load files for Knowledge Base: ${error.message}`, "error");
    }
  }

  /**
   * Render the list of knowledge base files in the UI.
   * @param {Object} filesData - Data containing the list of files and pagination info.
   */
  function _renderKnowledgeBaseFiles(filesData) {
    const container = ctx.elements.knowledgeBaseFilesListContainer;
    if (!container) return;

    ctx._safeSetInnerHTML(container, ""); // Clear previous content

    if (!filesData || !filesData.files || filesData.files.length === 0) {
      ctx._safeSetInnerHTML(container, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
      return;
    }

    const ul = ctx.domAPI.createElement("ul");
    ul.className = "space-y-2";

    filesData.files.forEach(file => {
      const li = ctx.domAPI.createElement("li");
      li.className = "flex items-center justify-between p-2 bg-base-200 rounded-md hover:bg-base-300 transition-colors";

      const processingStatus = file.config?.search_processing?.status || 'unknown';
      let statusBadgeClass = 'badge-ghost';
      if (processingStatus === 'success') statusBadgeClass = 'badge-success';
      else if (processingStatus === 'error') statusBadgeClass = 'badge-error';
      else if (processingStatus === 'pending') statusBadgeClass = 'badge-warning';

      ctx._safeSetInnerHTML(li, `
        <div class="flex items-center gap-3 truncate">
          <span class="text-xl">${ctx.uiUtils.fileIcon(file.file_type)}</span>
          <div class="truncate">
            <span class="font-medium text-sm block truncate" title="${file.filename}">${file.filename}</span>
            <span class="text-xs text-base-content/70">${ctx.uiUtils.formatBytes(file.file_size)}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge ${statusBadgeClass} badge-sm capitalize">${processingStatus}</span>
          <button data-file-id="${file.id}" class="btn btn-xs btn-error btn-outline kb-delete-file-btn" title="Delete file from KB">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      `);

      const deleteBtn = li.querySelector(".kb-delete-file-btn");
      if (deleteBtn) {
        ctx.eventHandlers.trackListener(deleteBtn, "click", (e) => {
          e.stopPropagation(); // Prevent li click if any
          const fileId = deleteBtn.dataset.fileId;
          const projectId = ctx._getCurrentProjectId();
          if (projectId && fileId) {
            _handleDeleteKnowledgeBaseFile(projectId, fileId, file.filename);
          }
        }, { context: "file-deletion" });
      }
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }

  /**
   * Deletes a file from the knowledge base after user confirmation.
   *
   * Prompts the user to confirm deletion of the specified file from the knowledge base. If confirmed, sends a request to remove the file and updates the file list, knowledge base health, and project statistics upon success. Displays an error alert if the deletion fails.
   *
   * @param {string} projectId - The ID of the project containing the knowledge base.
   * @param {string} fileId - The ID of the file to delete.
   * @param {string} filename - The name of the file to display in confirmation dialogs and alerts.
   *
   * @throws {Error} If the API request to delete the file fails.
   */
  async function _handleDeleteKnowledgeBaseFile(projectId, fileId, filename) {
    logger.info(`[${MODULE}][_handleDeleteKnowledgeBaseFile] Initiating delete for file: ${filename} (ID: ${fileId}) in project ${projectId}.`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][_handleDeleteKnowledgeBaseFile] App is ready. Proceeding.`, { context: MODULE });

    const confirmed = await ctx.modalManager.confirmAction({ // Pass as object
      title: `Delete "${filename}"?`,
      message: "Are you sure you want to remove this file from the Knowledge Base? This will delete its indexed data.",
      confirmText: "Delete",
      confirmClass: "btn-error"
    });

    if (!confirmed) {
      logger.info(`[${MODULE}][_handleDeleteKnowledgeBaseFile] Deletion of file ${fileId} cancelled by user.`, { context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][_handleDeleteKnowledgeBaseFile] User confirmed deletion for file ${fileId}.`, { context: MODULE });

    try {
      const response = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/files/${fileId}`,
        { method: "DELETE" }
      );
      logger.debug(`[${MODULE}][_handleDeleteKnowledgeBaseFile] API response for delete file ${fileId}:`, { response, context: MODULE });

      if (response.status === "success") {
        logger.info(`[${MODULE}][_handleDeleteKnowledgeBaseFile] Successfully deleted file ${fileId} from KB for project ${projectId}.`, { context: MODULE });
        const kbId = ctx.state.knowledgeBase?.id;
        if (kbId) {
          logger.debug(`[${MODULE}][_handleDeleteKnowledgeBaseFile] Refreshing file list and health for KB ${kbId}.`, { context: MODULE });
          loadKnowledgeBaseFiles(projectId, kbId);
          loadKnowledgeBaseHealth(kbId);
        }
        if (ctx.projectManager.loadProjectStats) {
          logger.debug(`[${MODULE}][_handleDeleteKnowledgeBaseFile] Refreshing project stats for ${projectId}.`, { context: MODULE });
          ctx.projectManager.loadProjectStats(projectId);
        }
      } else {
        logger.error(`[${MODULE}][_handleDeleteKnowledgeBaseFile] API reported failure for deleting file ${fileId}.`, { responseMessage: response.message, context: MODULE });
        throw new Error(response.message || "Failed to delete file from KB.");
      }
    } catch (error) {
      logger.error(
        `[${MODULE}][_handleDeleteKnowledgeBaseFile] Error deleting file ${fileId}.`,
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      ctx._showStatusAlert(`Error deleting file "${filename}": ${error.message || 'Unknown server error'}`, "error");
    }
  }

  /**
   * Attaches a GitHub repository to the current knowledge base using form input values.
   *
   * Validates the repository URL and gathers branch and file path information from the UI. On success, updates the knowledge base state with the attached repository details and refreshes the modal, files list, and health metrics.
   *
   * @remark If the repository URL is invalid or missing, the operation is aborted without user feedback. Errors during the API request are shown as status alerts.
   */
  async function handleAttachGitHubRepo() {
    logger.info(`[${MODULE}][handleAttachGitHubRepo] Attempting to attach GitHub repo.`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][handleAttachGitHubRepo] App is ready. Proceeding.`, { context: MODULE });

    const projectId = ctx._getCurrentProjectId();
    const kbId = ctx.state.knowledgeBase?.id;

    if (!projectId || !kbId) {
      logger.warn(`[${MODULE}][handleAttachGitHubRepo] Project ID or KB ID missing. Aborting.`, { projectId, kbId, context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][handleAttachGitHubRepo] Project ID: ${projectId}, KB ID: ${kbId}`, { context: MODULE });

    const repoUrl = ctx.elements.kbGitHubRepoUrlInput?.value.trim();
    const branch = ctx.elements.kbGitHubBranchInput?.value.trim() || "main";
    const filePathsRaw = ctx.elements.kbGitHubFilePathsTextarea?.value.trim();
    const filePaths = filePathsRaw ? filePathsRaw.split('\n').map(p => p.trim()).filter(p => p) : null;
    logger.debug(`[${MODULE}][handleAttachGitHubRepo] Form data:`, { repoUrl, branch, filePathsRaw, context: MODULE });

    if (!repoUrl) {
      logger.warn(`[${MODULE}][handleAttachGitHubRepo] Repository URL is empty. Aborting.`, { context: MODULE });
      // TODO: Show user validation error
      return;
    }
    try {
      new URL(repoUrl);
    } catch (_) {
      logger.warn(`[${MODULE}][handleAttachGitHubRepo] Invalid repository URL: ${repoUrl}. Aborting.`, { context: MODULE });
      // TODO: Show user validation error
      return;
    }

    const attachButton = ctx.elements.kbAttachRepoBtn;
    ctx._setButtonLoading(attachButton, true, "Attaching...");
    logger.debug(`[${MODULE}][handleAttachGitHubRepo] Attach button loading state set.`, { context: MODULE });

    try {
      const payload = { repo_url: repoUrl, branch };
      if (filePaths && filePaths.length > 0) {
        payload.file_paths = filePaths;
      }
      logger.debug(`[${MODULE}][handleAttachGitHubRepo] API payload:`, { payload, context: MODULE });

      const response = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/github/attach`,
        { method: "POST", body: payload }
      );
      logger.debug(`[${MODULE}][handleAttachGitHubRepo] API response:`, { response, context: MODULE });

      if (response.success && response.data) {
        logger.info(`[${MODULE}][handleAttachGitHubRepo] Successfully attached GitHub repo ${repoUrl} to KB ${kbId}.`, { context: MODULE });
        if (ctx.state.knowledgeBase) {
          ctx.state.knowledgeBase.repo_url = response.data.repo_url; // Assuming API returns the canonical URL
          ctx.state.knowledgeBase.branch = response.data.branch || branch; // Assuming API returns branch
          ctx.state.knowledgeBase.file_paths = response.data.file_paths || filePaths; // Assuming API returns paths
        }
        showKnowledgeBaseModal();
        loadKnowledgeBaseFiles(projectId, kbId);
        loadKnowledgeBaseHealth(kbId);
      } else {
        logger.error(`[${MODULE}][handleAttachGitHubRepo] API reported failure.`, { responseMessage: response.message, context: MODULE });
        throw new Error(response.message || "Failed to attach GitHub repository.");
      }
    } catch (error) {
      logger.error(
        `[${MODULE}][handleAttachGitHubRepo] Error attaching GitHub repo.`,
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      ctx._showStatusAlert(`Error attaching repository: ${error.message || 'Unknown server error'}`, "error");
    } finally {
      ctx._setButtonLoading(attachButton, false);
      logger.debug(`[${MODULE}][handleAttachGitHubRepo] Attach button loading state reset.`, { context: MODULE });
    }
  }

  /**
   * Detaches a GitHub repository from the current knowledge base after user confirmation.
   *
   * Prompts the user to confirm detachment, then sends a request to remove the repository and its files from the knowledge base. Updates the UI and internal state on success, or displays an error alert on failure.
   */
  async function handleDetachGitHubRepo() {
    logger.info(`[${MODULE}][handleDetachGitHubRepo] Attempting to detach GitHub repo.`, { context: MODULE });
    await appReadyPromise;
    logger.debug(`[${MODULE}][handleDetachGitHubRepo] App is ready. Proceeding.`, { context: MODULE });

    const projectId = ctx._getCurrentProjectId();
    const kbId = ctx.state.knowledgeBase?.id;
    const repoUrl = ctx.state.knowledgeBase?.repo_url;

    if (!projectId || !kbId || !repoUrl) {
      logger.warn(`[${MODULE}][handleDetachGitHubRepo] Project ID, KB ID, or Repo URL missing. Aborting.`, { projectId, kbId, repoUrl, context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][handleDetachGitHubRepo] Project ID: ${projectId}, KB ID: ${kbId}, Repo URL: ${repoUrl}`, { context: MODULE });

    const confirmed = await ctx.modalManager.confirmAction({ // Pass as object
      title: `Detach "${repoUrl}"?`,
      message: "Are you sure you want to detach this repository? Files from this repository will be removed from the Knowledge Base.",
      confirmText: "Detach",
      confirmClass: "btn-error"
    });

    if (!confirmed) {
      logger.info(`[${MODULE}][handleDetachGitHubRepo] Detachment of repo ${repoUrl} cancelled by user.`, { context: MODULE });
      return;
    }
    logger.debug(`[${MODULE}][handleDetachGitHubRepo] User confirmed detachment for repo ${repoUrl}.`, { context: MODULE });

    const detachButton = ctx.elements.kbDetachRepoBtn;
    ctx._setButtonLoading(detachButton, true, "Detaching...");
    logger.debug(`[${MODULE}][handleDetachGitHubRepo] Detach button loading state set.`, { context: MODULE });

    try {
      const response = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/github/detach`,
        { method: "POST", body: { repo_url: repoUrl } }
      );
      logger.debug(`[${MODULE}][handleDetachGitHubRepo] API response:`, { response, context: MODULE });

      if (response.status === "success" && response.data) { // Assuming response.data might contain status or confirmation
        logger.info(`[${MODULE}][handleDetachGitHubRepo] Successfully detached GitHub repo ${repoUrl} from KB ${kbId}.`, { context: MODULE });
        if (ctx.state.knowledgeBase) {
          delete ctx.state.knowledgeBase.repo_url;
          delete ctx.state.knowledgeBase.branch;
          delete ctx.state.knowledgeBase.file_paths;
        }
        showKnowledgeBaseModal();
        loadKnowledgeBaseFiles(projectId, kbId);
        loadKnowledgeBaseHealth(kbId);
      } else {
        logger.error(`[${MODULE}][handleDetachGitHubRepo] API reported failure.`, { responseMessage: response.message, context: MODULE });
        throw new Error(response.message || "Failed to detach GitHub repository.");
      }
    } catch (error) {
      logger.error(
        `[${MODULE}][handleDetachGitHubRepo] Error detaching GitHub repo.`,
        { status: error?.status ?? 500, data: error, message: error?.message ?? String(error) },
        { context: MODULE }
      );
      ctx._showStatusAlert(`Error detaching repository: ${error.message || 'Unknown server error'}`, "error");
    } finally {
      ctx._setButtonLoading(detachButton, false);
      logger.debug(`[${MODULE}][handleDetachGitHubRepo] Detach button loading state reset.`, { context: MODULE });
    }
  }

  /**
   * Validate dimension compatibility on model change
   */
  function validateSelectedModelDimensions() {
    const sel = ctx.elements.modelSelect;
    if (!sel) return;
    const parent = sel.closest(".form-control");
    if (!parent) return;
    let warning = parent.querySelector(".model-error");
    const opt = sel.options[sel.selectedIndex];
    if (opt.disabled) { // Assuming disabled options are due to dimension mismatch
      if (!warning) {
        const labelDiv = parent.querySelector(".label:last-of-type") || parent.querySelector("p.text-xs.text-base-content\\/70.mt-1")?.previousElementSibling;
        if (labelDiv) {
          warning = ctx.domAPI.createElement("span");
          warning.className = "label-text-alt text-error model-error";
          labelDiv.appendChild(warning);
        } else { // Fallback if specific label structure not found
          warning = ctx.domAPI.createElement("div");
          warning.className = "text-error text-xs mt-1 model-error";
          sel.insertAdjacentElement("afterend", warning);
        }
      }
      warning.textContent = "Changing dimensions requires reprocessing all files!";
      warning.classList.remove("hidden");
    } else if (warning) {
      warning.classList.add("hidden");
      warning.textContent = "";
    }
  }

  /**
   * Update model selection dropdown
   * @param {string|null} currentModel
   */
  function _updateModelSelection(currentModel) {
    const selectEl = ctx.elements.modelSelect || ctx.domAPI.getElementById("embeddingModelSelect"); // Fallback ID
    if (!selectEl) return;

    if (currentModel) {
      let modelFound = false;
      for (let i = 0; i < selectEl.options.length; i++) {
        if (selectEl.options[i].value === currentModel) {
          selectEl.selectedIndex = i;
          modelFound = true;
          break;
        }
      }
      // If the current model isn't in the list, add it (e.g., if it's custom or from an older config)
      if (!modelFound) {
        const newOption = new Option(`${currentModel} (Current)`, currentModel, false, true); // text, value, defaultSelected, selected
        selectEl.add(newOption);
        selectEl.value = currentModel; // Ensure it's selected
      }
    } else {
      selectEl.selectedIndex = 0; // Default to the first option if no current model
    }
    validateSelectedModelDimensions(); // Check for warnings after updating
  }

  // Module/component cleanup function
  function cleanup() {
    // Clean up any event listeners, intervals, etc.
    ctx.eventHandlers.cleanupListeners({ context: "file-deletion" });

  }

  return {
    toggleKnowledgeBase,
    reprocessFiles,
    handleKnowledgeBaseFormSubmit,
    handleDeleteKnowledgeBase,
    showKnowledgeBaseModal,
    hideKnowledgeBaseModal,
    loadKnowledgeBaseHealth,
    loadKnowledgeBaseFiles,
    handleAttachGitHubRepo,
    handleDetachGitHubRepo,
    validateSelectedModelDimensions,
    _updateModelSelection, // Expose for direct use if needed by main component
    cleanup, // Expose cleanup to allow proper resource release
  };
}

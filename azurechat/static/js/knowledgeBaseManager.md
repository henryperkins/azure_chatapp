```javascript
/**
 * @module knowledgeBaseManager
 * @description Manages Knowledge Base settings, lifecycle, files, and GitHub integration.
 */
const MODULE = "KnowledgeBaseManager";

/**
 * Factory function to create a manager for KnowledgeBaseComponent.
 * @param {Object} ctx - The KnowledgeBaseComponent instance (context).
 * @param {Object} ctx.elements - DOM element references.
 * @param {Object} ctx.state - Component's internal state.
 * @param {Function} ctx.notify - Notification object with context.
 * @param {Function} ctx.apiRequest - API request function.
 * @param {Object} ctx.modalManager - Modal management utility.
 * @param {Object} ctx.projectManager - Project management utility.
 * @param {Function} ctx.validateUUID - UUID validation function.
 * @param {Function} ctx._getCurrentProjectId - Function to get current project ID.
 * @param {Function} ctx._showInactiveState - Callback to show inactive UI state.
 * @param {Function} ctx._updateStatusIndicator - Callback to update status badge.
 * @param {Function} ctx._updateStatusAlerts - Callback to update status alerts.
 * @param {Function} ctx._updateUploadButtonsState - Callback to update button states.
 * @param {Function} ctx._setButtonLoading - Utility to set button loading state.
 * @param {Function} ctx._safeSetInnerHTML - Utility to safely set innerHTML.
 * @param {Function} ctx.renderKnowledgeBaseInfo - Callback to re-render main KB info.
 * @param {Object} ctx.uiUtils - UI utility functions (formatBytes, formatDate, fileIcon).
 * @param {Object} ctx.eventHandlers - Event handling utility.
 * @param {Function} ctx.getDep - Dependency getter.
 * @returns {Object} Manager instance with public methods.
 */
export function createKnowledgeBaseManager(ctx) {
  const notify = ctx.notify; // Use the already contextualized notifier from ctx

  /**
   * Toggle knowledge base activation
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async function toggleKnowledgeBase(enabled) {
    const pid = ctx._getCurrentProjectId();
    if (!pid) {
      notify.error("No valid project selected for Knowledge Base toggle", { source: "toggleKnowledgeBase" });
      return;
    }

    try {
      const resp = await ctx.apiRequest(
        `/api/projects/${pid}/knowledge-bases/toggle`,
        { method: "POST", body: { enable: enabled } },
      );
      if (resp.success) {
        if (ctx.state.knowledgeBase) {
          ctx.state.knowledgeBase.is_active = enabled;
        }
        ctx._updateStatusIndicator(enabled);
        const storage = ctx.getDep("storage");
        if (storage && typeof storage.setItem === "function") {
          storage.setItem(`kb_enabled_${pid}`, String(enabled));
        }

        if (ctx.projectManager.loadProjectDetails) {
          const project = await ctx.projectManager.loadProjectDetails(pid);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, pid); // Pass pid
        } else {
          ctx.renderKnowledgeBaseInfo(ctx.state.knowledgeBase, pid); // Pass pid
        }
      } else {
        throw new Error(resp.message || "Failed to toggle knowledge base status.");
      }
    } catch(err) {
      notify.error(`Failed to toggle knowledge base: ${err.message}`, { source: "toggleKnowledgeBase", originalError: err });
      // Revert UI if toggle failed
      if (ctx.elements.kbToggle) ctx.elements.kbToggle.checked = !enabled;
      ctx._updateStatusIndicator(!enabled);
    }
  }

  /**
   * Reprocess all files in the knowledge base
   * @param {string} projectId
   * @returns {Promise<void>}
   */
  async function reprocessFiles(projectId) {
    if (!ctx.validateUUID(projectId)) {
      notify.error("No valid project selected for reprocessing", { source: "reprocessFiles" });
      return;
    }
    const btn = ctx.elements.reprocessButton;
    ctx._setButtonLoading(btn, true, "Processing...");

    try {
      const resp = await ctx.apiRequest(
        `/api/projects/${projectId}/knowledge-base/reindex`,
        { method: "POST", body: { force: true } },
      );
      if (resp.success) {
        notify.success("Files queued for reprocessing", { source: "reprocessFiles" });
        if (ctx.projectManager.loadProjectDetails) {
          const [project] = await Promise.all([
            ctx.projectManager.loadProjectDetails(projectId),
            ctx.projectManager.loadProjectStats?.(projectId),
          ]);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId);
        } else if (ctx.state.knowledgeBase?.id) {
          await loadKnowledgeBaseHealth(ctx.state.knowledgeBase.id);
          await loadKnowledgeBaseFiles(projectId, ctx.state.knowledgeBase.id);
        }
      } else {
         throw new Error(resp.message || "Reprocessing request failed.");
      }
    } catch(err) {
      notify.error(`Failed to reprocess files: ${err.message}`, { source: "reprocessFiles", originalError: err });
    } finally {
      ctx._setButtonLoading(btn, false);
    }
  }

  /**
   * Handle settings form submission
   * @param {Event} e - Form submit event
   */
  function handleKnowledgeBaseFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const projectId = form.dataset.projectId || ctx._getCurrentProjectId();
    if (!ctx.validateUUID(projectId)) {
      notify.error("Cannot save settings: Project ID missing or invalid.", { source: "handleKnowledgeBaseFormSubmit" });
      return;
    }

    const data = new FormData(form);
    const payload = {
      name: data.get("name"),
      description: data.get("description") || null,
      embedding_model: data.get("embedding_model"),
    };

    if (!ctx.state.knowledgeBase?.id) { // Creating new KB
      payload.process_existing_files = form.elements["process_all_files"]?.checked || false;
    }

    if (!payload.name?.trim()) {
      notify.error("Knowledge Base name is required.", { source: "handleKnowledgeBaseFormSubmit" });
      return;
    }
    if (!payload.embedding_model) {
      notify.error("Embedding model must be selected.", { source: "handleKnowledgeBaseFormSubmit" });
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    ctx._setButtonLoading(btn, true);

    _submitKnowledgeBaseForm(projectId, payload).finally(() => {
      ctx._setButtonLoading(btn, false);
    });
  }

  /**
   * Submit settings to the server
   * @param {string} projectId
   * @param {Object} payload
   * @returns {Promise<void>}
   */
  async function _submitKnowledgeBaseForm(projectId, payload) {
    notify.info("Enter _submitKnowledgeBaseForm. Current KB state from ctx:", {
        source: "_submitKnowledgeBaseForm",
        extra: {
            kbIdFromState: ctx.state.knowledgeBase?.id,
            kbExists: !!ctx.state.knowledgeBase?.id,
            knowledgeBaseSummary: ctx.state.knowledgeBase ? { id: ctx.state.knowledgeBase.id, name: ctx.state.knowledgeBase.name, is_active: ctx.state.knowledgeBase.is_active } : null
        }
    });
    try {
      const kbId = ctx.state.knowledgeBase?.id;
      const isUpdating = !!kbId;
      notify.info(`_submitKnowledgeBaseForm: Determined action based on kbId='${kbId}'`, {
          source: "_submitKnowledgeBaseForm",
          extra: { projectId, isUpdatingAction: isUpdating ? 'UPDATE (PATCH)' : 'CREATE (POST)' }
      });
      const method = isUpdating ? "PATCH" : "POST";
      const url = isUpdating
        ? `/api/projects/${projectId}/knowledge-bases/${kbId}`
        : `/api/projects/${projectId}/knowledge-bases`;

      const resp = await ctx.apiRequest(url, { method, body: payload });

      const responseData = isUpdating ? resp.data : (resp.data?.knowledge_base || resp.data);

      if (responseData?.id || resp.success) {
        hideKnowledgeBaseModal();
        notify.success("Knowledge Base settings saved.", { source: "_submitKnowledgeBaseForm" });

        if (ctx.projectManager.loadProjectDetails) {
          const project = await ctx.projectManager.loadProjectDetails(projectId);
          ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId);
        } else {
          // Fallback if loadProjectDetails is not available
          ctx.renderKnowledgeBaseInfo({
            ...ctx.state.knowledgeBase, // Keep existing state
            ...responseData,          // Overlay with new data
          }, projectId);
        }
      } else {
        throw new Error(resp.message || "Invalid response from server");
      }
    } catch (err) {
      if (err.status === 409) { // HTTP 409 Conflict
        notify.warn(`Project already has a knowledge base. Refreshing settings.`, {
          source: '_submitKnowledgeBaseForm',
          originalError: err,
          extra: { projectId }
        });
        // Attempt to refresh the project details and re-render the KB info
        // This should ideally update the UI to show the existing KB and remove the "create" form.
        if (ctx.projectManager.loadProjectDetails) {
          try {
            const project = await ctx.projectManager.loadProjectDetails(projectId);
            ctx.renderKnowledgeBaseInfo(project?.knowledge_base, projectId);
            // If modal is still open, it might need to be re-initialized or closed/reopened
            // For now, just ensure state is updated. The modal might repopulate on next open.
            hideKnowledgeBaseModal(); // Close modal as the "create" action is invalid
          } catch (refreshError) {
            notify.error(`Failed to refresh project details after KB conflict: ${refreshError.message}`, {
              source: '_submitKnowledgeBaseForm',
              originalError: refreshError
            });
          }
        }
      } else {
        notify.error(`Failed to save settings: ${err.message || 'Unknown error'}`, {
          source: '_submitKnowledgeBaseForm',
          originalError: err,
          extra: { status: err.status }
        });
      }
    }
  }

  /**
   * Handle deleting the knowledge base
   */
  async function handleDeleteKnowledgeBase() {
      const projectId = ctx._getCurrentProjectId();
      const kbId = ctx.state.knowledgeBase?.id;

      if (!projectId || !kbId) {
          notify.error("Cannot delete: Project or Knowledge Base ID missing.", { source: "handleDeleteKnowledgeBase" });
          return;
      }

      const confirmed = await ctx.modalManager.confirmAction(
          "Delete Knowledge Base?",
          "Are you sure you want to permanently delete this knowledge base? This action cannot be undone."
      );

      if (!confirmed) {
          return;
      }

      const deleteButton = ctx.elements.deleteKnowledgeBaseBtn;
      ctx._setButtonLoading(deleteButton, true, "Deleting...");

      try {
          const resp = await ctx.apiRequest(
              `/api/projects/${projectId}/knowledge-bases/${kbId}`,
              { method: "DELETE" }
          );

          if (resp.success || resp.data?.deleted_id) {
              notify.success("Knowledge Base deleted successfully.", { source: "handleDeleteKnowledgeBase" });
              hideKnowledgeBaseModal();
              ctx._showInactiveState(); // This should also clear files and update buttons
              if (ctx.projectManager.loadProjectDetails) {
                  // Reload project details to reflect deleted KB
                  await ctx.projectManager.loadProjectDetails(projectId);
              }
          } else {
              throw new Error(resp.message || "Failed to delete knowledge base.");
          }
      } catch (err) {
          notify.error(`Failed to delete Knowledge Base: ${err.message || 'Unknown error'}`, { source: 'handleDeleteKnowledgeBase', originalError: err });
      } finally {
          ctx._setButtonLoading(deleteButton, false);
      }
  }

  /**
   * Show the settings modal
   */
  async function showKnowledgeBaseModal() { // Made async
    const modal = ctx.elements.settingsModal;
    if (!modal || typeof modal.showModal !== "function") {
      notify.error("Settings modal not found or invalid.", { source: "showKnowledgeBaseModal" });
      return;
    }

    const projectId = ctx._getCurrentProjectId(); // Get projectId early
    if (!projectId) {
        notify.error("Project ID not available. Cannot show KB settings.", { source: "showKnowledgeBaseModal" });
        return;
    }

    // Attempt to refresh KB state before populating the form
    try {
        if (ctx.projectManager.loadProjectDetails) {
            notify.info("Refreshing project details before showing KB modal...", { source: "showKnowledgeBaseModal" });
            const projectDetails = await ctx.projectManager.loadProjectDetails(projectId);
            // The projectDetailsLoaded event (and sub-events like projectKnowledgeBaseLoaded)
            // should trigger KnowledgeBaseComponent.renderKnowledgeBaseInfo, which updates ctx.state.knowledgeBase.
            // For robustness, we can also try a direct update if the event system is slow or has issues.
            if (projectDetails && typeof projectDetails.knowledge_base !== 'undefined') {
                 ctx.state.knowledgeBase = projectDetails.knowledge_base; // Direct update
                 notify.info("KB state directly updated from refreshed project details.", {
                    source: "showKnowledgeBaseModal",
                    extra: { kbExists: !!projectDetails.knowledge_base, kbId: projectDetails.knowledge_base?.id }
                });
            } else if (projectDetails === null) { // Project load failed
                 notify.warn("Project details failed to load; KB state might be inaccurate for modal.", { source: "showKnowledgeBaseModal" });
            }
            // Log the state of ctx.state.knowledgeBase AFTER the refresh attempt
            notify.debug("ctx.state.knowledgeBase after refresh in showKnowledgeBaseModal:", {
                source: "showKnowledgeBaseModal",
                extra: {
                    kbStateSummary: ctx.state.knowledgeBase ? {id: ctx.state.knowledgeBase.id, name: ctx.state.knowledgeBase.name, is_active: ctx.state.knowledgeBase.is_active} : null
                }
            });
        }
    } catch (err) {
        notify.error("Failed to refresh project details before showing KB modal. State may be stale.", { source: "showKnowledgeBaseModal", originalError: err });
        notify.debug("ctx.state.knowledgeBase (after failed refresh) in showKnowledgeBaseModal:", {
            source: "showKnowledgeBaseModal",
            extra: {
                kbStateSummary: ctx.state.knowledgeBase ? {id: ctx.state.knowledgeBase.id, name: ctx.state.knowledgeBase.name, is_active: ctx.state.knowledgeBase.is_active} : null
            }
        });
        // Continue with potentially stale state, or decide to block/warn user
    }

    const form = ctx.elements.settingsForm;
    if (form) {
      form.reset();
      const kbIdInput = form.elements["knowledge_base_id"];
      if (kbIdInput) {
          kbIdInput.value = ctx.state.knowledgeBase?.id || "";
      }
    }

    _updateModelSelection(
      ctx.state.knowledgeBase?.embedding_model || null,
    );

    const deleteBtn = ctx.elements.deleteKnowledgeBaseBtn;
    const { kbGitHubAttachedRepoInfo, kbAttachedRepoUrlDisplay, kbAttachedRepoBranchDisplay, kbGitHubAttachForm, kbGitHubRepoUrlInput, kbGitHubBranchInput, kbGitHubFilePathsTextarea } = ctx.elements;

    if (ctx.state.knowledgeBase && ctx.state.knowledgeBase.id) { // Existing KB
      const kb = ctx.state.knowledgeBase;
      if (form) {
          form.elements["name"].value = kb.name || "";
          form.elements["description"].value = kb.description || "";
          const processAllFilesCheckbox = form.elements["process_all_files"];
          if (processAllFilesCheckbox) processAllFilesCheckbox.checked = false; // Default for existing

          const autoEnableCheckbox = form.elements["auto_enable"]; // Assuming this exists
          if (autoEnableCheckbox) autoEnableCheckbox.checked = kb.is_active !== false;
      }
      if (deleteBtn) deleteBtn.classList.remove("hidden");

      // GitHub section update for existing KB
      if (kb.repo_url) {
          if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.remove("hidden");
          if (kbAttachedRepoUrlDisplay) kbAttachedRepoUrlDisplay.textContent = kb.repo_url;
          if (kbAttachedRepoBranchDisplay) kbAttachedRepoBranchDisplay.textContent = kb.branch || 'main';
          if (kbGitHubAttachForm) kbGitHubAttachForm.classList.add("hidden");
      } else {
          if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.add("hidden");
          if (kbGitHubAttachForm) kbGitHubAttachForm.classList.remove("hidden");
          if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
          if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
          if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
      }

    } else { // New KB
      if (form) {
          const processAllFilesCheckbox = form.elements["process_all_files"];
          if (processAllFilesCheckbox) processAllFilesCheckbox.checked = true; // Default for new

          const autoEnableCheckbox = form.elements["auto_enable"];
          if (autoEnableCheckbox) autoEnableCheckbox.checked = true; // Default for new
      }
      if (deleteBtn) deleteBtn.classList.add("hidden");
      // GitHub section for new KB
      if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.add("hidden");
      if (kbGitHubAttachForm) kbGitHubAttachForm.classList.remove("hidden");
      if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
      if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
      if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
    }

    const pid = ctx._getCurrentProjectId();
    if (pid && form) {
      form.dataset.projectId = pid;
    }

    modal.showModal();
    validateSelectedModelDimensions();
  }

  /**
   * Hide the settings modal
   */
  function hideKnowledgeBaseModal() {
    const modal = ctx.elements.settingsModal;
    if (modal && typeof modal.close === "function") {
      modal.close();
    }
  }

  /**
   * Load health metrics for the KB
   * @param {string} kbId
   * @returns {Promise<Object|null>}
   */
  async function loadKnowledgeBaseHealth(kbId) {
    if (!kbId || !ctx.validateUUID(kbId)) return null;
    try {
      const projectId = ctx._getCurrentProjectId();
      if (!projectId) {
          notify.warning("Project ID not found for KB health check.", { source: "loadKnowledgeBaseHealth" });
          return null;
      }
      const healthResp = await ctx.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/status?detailed=true`,
          { method: "GET"},
          false // Don't show default notifications for this background check
      );

      if (healthResp?.data) {
          const { kbNameDisplay, kbModelDisplay, knowledgeFileCount, knowledgeChunkCount, knowledgeFileSize } = ctx.elements;

          if (kbNameDisplay && healthResp.data.name) kbNameDisplay.textContent = healthResp.data.name;
          if (kbModelDisplay && healthResp.data.embedding_model) kbModelDisplay.textContent = healthResp.data.embedding_model;

          if (knowledgeFileCount && healthResp.data.files?.total_files !== undefined) {
              knowledgeFileCount.textContent = healthResp.data.files.total_files;
          }
          if (knowledgeChunkCount && healthResp.data.vector_stats?.total_vectors !== undefined) {
              knowledgeChunkCount.textContent = healthResp.data.vector_stats.total_vectors;
          }
           let totalSize = 0;
           if (healthResp.data.files?.files_details) {
               healthResp.data.files.files_details.forEach(file => totalSize += (file.file_size || 0));
           } else if (ctx.state.knowledgeBase?.stats?.total_size_bytes) {
               totalSize = ctx.state.knowledgeBase.stats.total_size_bytes;
           }

           if (knowledgeFileSize) {
              knowledgeFileSize.textContent = ctx.uiUtils.formatBytes(totalSize);
           }

          // Update component state if KB exists
          if (ctx.state.knowledgeBase) {
              ctx.state.knowledgeBase.name = healthResp.data.name || ctx.state.knowledgeBase.name;
              ctx.state.knowledgeBase.embedding_model = healthResp.data.embedding_model || ctx.state.knowledgeBase.embedding_model;
              if (healthResp.data.files) {
                  ctx.state.knowledgeBase.stats = {
                      ...ctx.state.knowledgeBase.stats,
                      file_count: healthResp.data.files.total_files || 0,
                      unprocessed_files: healthResp.data.files.pending_files || 0,
                  };
              }
              if (healthResp.data.vector_stats) {
                   ctx.state.knowledgeBase.stats.chunk_count = healthResp.data.vector_stats.total_vectors || 0;
              }
              ctx._updateStatusAlerts(ctx.state.knowledgeBase); // Refresh alerts based on new stats
          }
      }
      return healthResp?.data || null;
    } catch(err) {
      notify.error("Could not verify knowledge base health", { source: "loadKnowledgeBaseHealth", originalError: err });
      // Potentially show a more persistent error in UI if needed via _showStatusAlert
      return null;
    }
  }

  /**
   * Load and render files for the current project's knowledge base.
   * @param {string} projectId - The ID of the current project.
   * @param {string} kbId - The ID of the knowledge base.
   */
  async function loadKnowledgeBaseFiles(projectId, kbId) {
      if (!projectId || !kbId) {
          _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
          ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
          return;
      }

      try {
          const response = await ctx.apiRequest(
              `/api/projects/${projectId}/knowledge-bases/files-list`,
              { method: "GET" }
          );
          if (response.success && response.data) {
              _renderKnowledgeBaseFiles(response.data);
              ctx.elements.knowledgeBaseFilesSection?.classList.toggle("hidden", response.data.files.length === 0);
          } else {
              notify.error("Failed to load knowledge base files.", { source: "loadKnowledgeBaseFiles" });
              _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
              ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
          }
      } catch (error) {
          notify.error(`Error loading knowledge base files: ${error.message}`, { source: "loadKnowledgeBaseFiles", originalError: error });
          _renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
          ctx.elements.knowledgeBaseFilesSection?.classList.add("hidden");
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
              });
          }
          ul.appendChild(li);
      });
      container.appendChild(ul);
  }

  /**
   * Handle deletion of a single file from the knowledge base.
   * @param {string} projectId
   * @param {string} fileId
   * @param {string} filename
   */
  async function _handleDeleteKnowledgeBaseFile(projectId, fileId, filename) {
      const confirmed = await ctx.modalManager.confirmAction(
          `Delete "${filename}"?`,
          "Are you sure you want to remove this file from the Knowledge Base? This will delete its indexed data."
      );

      if (!confirmed) return;

      try {
          const response = await ctx.apiRequest(
              `/api/projects/${projectId}/knowledge-bases/files/${fileId}`,
              { method: "DELETE" }
          );

          if (response.success) {
              notify.success(`File "${filename}" removed from Knowledge Base.`, { source: "_handleDeleteKnowledgeBaseFile" });
              const kbId = ctx.state.knowledgeBase?.id;
              if (kbId) {
                  loadKnowledgeBaseFiles(projectId, kbId); // Refresh file list
              }
              loadKnowledgeBaseHealth(kbId); // Refresh stats
              if (ctx.projectManager.loadProjectStats) { // If stats loader exists
                  ctx.projectManager.loadProjectStats(projectId);
              }
          } else {
              throw new Error(response.message || "Failed to delete file from KB.");
          }
      } catch (error) {
          notify.error(`Error deleting file "${filename}" from KB: ${error.message}`, { source: "_handleDeleteKnowledgeBaseFile", originalError: error });
      }
  }

  /**
   * Handle attaching a GitHub repository to the knowledge base.
   */
  async function handleAttachGitHubRepo() {
      const projectId = ctx._getCurrentProjectId();
      const kbId = ctx.state.knowledgeBase?.id;

      if (!projectId || !kbId) {
          notify.error("Project or Knowledge Base not properly initialized for GitHub attachment.", { source: "handleAttachGitHubRepo" });
          return;
      }

      const repoUrl = ctx.elements.kbGitHubRepoUrlInput?.value.trim();
      const branch = ctx.elements.kbGitHubBranchInput?.value.trim() || "main";
      const filePathsRaw = ctx.elements.kbGitHubFilePathsTextarea?.value.trim();
      const filePaths = filePathsRaw ? filePathsRaw.split('\n').map(p => p.trim()).filter(p => p) : null;

      if (!repoUrl) {
          notify.error("Repository URL is required.", { source: "handleAttachGitHubRepo" });
          return;
      }
      try {
          new URL(repoUrl); // Basic URL validation
      } catch (_) {
          notify.error("Invalid Repository URL format.", { source: "handleAttachGitHubRepo" });
          return;
      }

      const attachButton = ctx.elements.kbAttachRepoBtn;
      ctx._setButtonLoading(attachButton, true, "Attaching...");

      try {
          const payload = { repo_url: repoUrl, branch };
          if (filePaths && filePaths.length > 0) {
              payload.file_paths = filePaths;
          }

          const response = await ctx.apiRequest(
              `/api/projects/${projectId}/knowledge-bases/github/attach`,
              { method: "POST", body: payload }
          );

          if (response.success && response.data) {
              notify.success(`GitHub repository "${response.data.repo_url}" attached. ${response.data.files_processed} files are being processed.`, { source: "handleAttachGitHubRepo" });
              if (ctx.state.knowledgeBase) {
                  ctx.state.knowledgeBase.repo_url = response.data.repo_url;
                  ctx.state.knowledgeBase.branch = branch;
                  ctx.state.knowledgeBase.file_paths = filePaths;
              }
              showKnowledgeBaseModal(); // Re-render modal to show attached info
              loadKnowledgeBaseFiles(projectId, kbId);
              loadKnowledgeBaseHealth(kbId);
          } else {
              throw new Error(response.message || "Failed to attach GitHub repository.");
          }
      } catch (error) {
          notify.error(`Error attaching GitHub repository: ${error.message}`, { source: "handleAttachGitHubRepo", originalError: error });
      } finally {
          ctx._setButtonLoading(attachButton, false);
      }
  }

  /**
   * Handle detaching a GitHub repository from the knowledge base.
   */
  async function handleDetachGitHubRepo() {
      const projectId = ctx._getCurrentProjectId();
      const kbId = ctx.state.knowledgeBase?.id;
      const repoUrl = ctx.state.knowledgeBase?.repo_url;

      if (!projectId || !kbId || !repoUrl) {
          notify.error("No repository attached or KB not initialized.", { source: "handleDetachGitHubRepo" });
          return;
      }

      const confirmed = await ctx.modalManager.confirmAction(
          `Detach "${repoUrl}"?`,
          "Are you sure you want to detach this repository? Files from this repository will be removed from the Knowledge Base."
      );

      if (!confirmed) return;

      const detachButton = ctx.elements.kbDetachRepoBtn;
      ctx._setButtonLoading(detachButton, true, "Detaching...");

      try {
          const response = await ctx.apiRequest(
              `/api/projects/${projectId}/knowledge-bases/github/detach`,
              { method: "POST", body: { repo_url: repoUrl } } // Send repo_url for backend to identify
          );

          if (response.success && response.data) {
              notify.success(`GitHub repository "${response.data.repo_url}" detached. ${response.data.files_removed} files are being removed.`, { source: "handleDetachGitHubRepo" });
               if (ctx.state.knowledgeBase) {
                  delete ctx.state.knowledgeBase.repo_url;
                  delete ctx.state.knowledgeBase.branch;
                  delete ctx.state.knowledgeBase.file_paths;
              }
              showKnowledgeBaseModal(); // Re-render modal
              loadKnowledgeBaseFiles(projectId, kbId);
              loadKnowledgeBaseHealth(kbId);
          } else {
              throw new Error(response.message || "Failed to detach GitHub repository.");
          }
      } catch (error) {
          notify.error(`Error detaching GitHub repository: ${error.message}`, { source: "handleDetachGitHubRepo", originalError: error });
      } finally {
          ctx._setButtonLoading(detachButton, false);
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
      warning.textContent =
        "Changing dimensions requires reprocessing all files!";
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
              notify.info(`Current embedding model "${currentModel}" was not in the default list. It has been added.`, { source: '_updateModelSelection' });
          }
      } else {
          selectEl.selectedIndex = 0; // Default to the first option if no current model
      }
      validateSelectedModelDimensions(); // Check for warnings after updating
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
  };
}

```
/**
 * @file knowledgeBaseRenderer.js
 * @description Pure, **render-only** helper for knowledgeBaseComponent.
 *              No state, no business logic – just DOM mutation utilities.
 *
 * Guard-rails compliance:
 *  • Accepts every dependency through the factory args – no direct imports.
 *  • Performs **no** event registration and returns a cleanup() helper so the
 *    caller can detach any listeners it created elsewhere.
 */

const MODULE_CONTEXT = 'KnowledgeBaseRenderer';

export function createKnowledgeBaseRenderer({
  domAPI,
  uiUtils,
  sanitizer,
  logger,
  elementSelectors,
  elRefs = {}
} = {}) {
  // ──────────────── DI validation ──────────────────────────────────────────
  const required = {
    domAPI,
    uiUtils,
    sanitizer,
    logger,
    elementSelectors
  };
  for (const [k, v] of Object.entries(required)) {
    if (!v) throw new Error(`[${MODULE_CONTEXT}] Missing dependency: ${k}`);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  function _safeSetInnerHTML(el, html) {
    if (!el) return;
    if (typeof html === 'string') {
      html = sanitizer.sanitize(html, { ALLOWED_TAGS: false, ALLOWED_ATTR: false });
    }
    domAPI.setInnerHTML(el, html);
  }

  /**
   * Build `elements` mapping identical to the structure previously produced in
   * knowledgeBaseComponent._initElements().  This renderer is the **single**
   * place that does direct DOM look-ups for the KB feature so we keep it local
   * and memoised.
   */
  function _initElements() {
    const OPTIONAL_KEYS = new Set([
      'activeSection', 'inactiveSection', 'statusBadge', 'modelSelect',
      'searchInput', 'searchButton', 'kbToggle', 'reprocessButton',
      'setupButton', 'settingsButton', 'kbNameDisplay', 'kbModelDisplay',
      'kbVersionDisplay', 'kbLastUsedDisplay', 'knowledgeBaseFilesSection',
      'knowledgeBaseFilesListContainer', 'kbGitHubAttachedRepoInfo',
      'kbAttachedRepoUrlDisplay', 'kbAttachedRepoBranchDisplay',
      'kbDetachRepoBtn', 'kbGitHubAttachForm', 'kbGitHubRepoUrlInput',
      'kbGitHubBranchInput', 'kbGitHubFilePathsTextarea', 'kbAttachRepoBtn',
      'knowledgeFileCount', 'knowledgeChunkCount', 'knowledgeFileSize',
      'noResultsSection', 'topKSelect', 'resultsContainer', 'resultsSection',
      'settingsModal', 'settingsForm', 'cancelSettingsBtn',
      'deleteKnowledgeBaseBtn', 'resultModal', 'resultTitle', 'resultSource',
      'resultScore', 'resultContent', 'useInChatBtn'
    ]);

    const elements = {};
    for (const [key, selector] of Object.entries(elementSelectors)) {
      const sel = typeof selector === 'string'
        ? (selector.startsWith('#') || selector.startsWith('.') ? selector : `#${selector}`)
        : selector;

      elements[key] = elRefs[key] || domAPI.querySelector(sel);

      if (!elements[key] && !OPTIONAL_KEYS.has(key)) {
        throw new Error(`[${MODULE_CONTEXT}] Required element missing: ${key} (${selector})`);
      }
    }

    return elements;
  }

  // Memoised element map
  const elements = _initElements();

  // -----------------------------------------------------------------------
  // Public render helpers (no business logic)
  // -----------------------------------------------------------------------

  function updateBasicInfo(kb) {
    const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = elements;
    if (!kb) return;

    if (kbNameDisplay)   kbNameDisplay.textContent   = kb.name || 'Project Knowledge Base';
    if (kbModelDisplay)  kbModelDisplay.textContent  = kb.embedding_model || 'Not Set';
    if (kbVersionDisplay)kbVersionDisplay.textContent= kb.version ? `v${kb.version}` : 'v1';
    if (kbLastUsedDisplay) kbLastUsedDisplay.textContent = kb.last_used
      ? uiUtils.formatDate(kb.last_used)
      : 'Never used';
  }

  function updateStatusIndicator(isActive) {
    const badge = elements.statusBadge;
    if (!badge) return;
    badge.className   = `badge ${isActive ? 'badge-success' : 'badge-warning'} badge-sm`;
    badge.textContent = isActive ? 'Active' : 'Inactive';
  }

  /**
   * Update disabled / tooltip state for any element that carries the
   * `data-requires-kb="true"` attribute.  This is called both when the KB is
   * toggled and when the auth state changes.
   */
  function updateUploadButtonsState({ hasKB, isActive, formatBytes }) {
    const container = elements.container;
    const els = domAPI.querySelectorAll('[data-requires-kb="true"]', container);
    els.forEach(el => {
      const disabled = !hasKB || !isActive;
      el.disabled = disabled;
      domAPI.toggleClass(el, 'opacity-50', disabled);
      domAPI.toggleClass(el, 'cursor-not-allowed', disabled);
      el.title = disabled
        ? (!hasKB ? 'Setup Knowledge Base first.' : 'Knowledge Base must be active.')
        : 'Ready to use Knowledge Base features.';
    });

    // Special-case reprocess button because it also depends on file count
    if (elements.reprocessButton) {
      const fileCountEl = elements.knowledgeFileCount || domAPI.getElementById('kbDocCount');
      const fileCount   = parseInt(fileCountEl?.textContent || '0', 10);
      const disabled    = !hasKB || !isActive || fileCount === 0;
      elements.reprocessButton.disabled = disabled;
      domAPI.toggleClass(elements.reprocessButton, 'opacity-50', disabled);
      domAPI.toggleClass(elements.reprocessButton, 'cursor-not-allowed', disabled);
      elements.reprocessButton.title = !hasKB ? 'Setup Knowledge Base first.'
        : !isActive ? 'Knowledge Base must be active.'
        : fileCount   === 0 ? 'No files to reprocess.'
        : 'Reprocess files.';
    }
  }

  /* --------------------------------------------------------------------
   * FILE LIST RENDERING (extracted from legacy knowledgeBaseManager)
   * ------------------------------------------------------------------ */

  function renderFileList({ files = [], pagination = {} } = {}, { uiUtils: u } = {}) {
    const utils = u || uiUtils;
    const container = elements.knowledgeBaseFilesListContainer;
    if (!container) return;

    _safeSetInnerHTML(container, '');

    if (!files.length) {
      _safeSetInnerHTML(container, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
      return;
    }

    const ul = domAPI.createElement('ul');
    ul.className = 'space-y-2';

    files.forEach(file => {
      const li = domAPI.createElement('li');
      li.className = 'flex items-center justify-between p-2 bg-base-200 rounded-md hover:bg-base-300 transition-colors';

      const status = file.config?.search_processing?.status || 'unknown';
      const statusClass = status === 'success' ? 'badge-success'
                       : status === 'error'   ? 'badge-error'
                       : status === 'pending' ? 'badge-warning'
                       : 'badge-ghost';

      _safeSetInnerHTML(li, `
        <div class="flex items-center gap-3 truncate">
          <span class="text-xl">${utils.fileIcon(file.file_type)}</span>
          <div class="truncate">
            <span class="font-medium text-sm block truncate" title="${file.filename}">${file.filename}</span>
            <span class="text-xs text-base-content/70">${utils.formatBytes(file.file_size)}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge ${statusClass} badge-sm capitalize">${status}</span>
          <button data-file-id="${file.id}" class="btn btn-xs btn-error btn-outline kb-delete-file-btn" title="Delete file from KB">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      `);

      ul.appendChild(li);
    });

    container.appendChild(ul);
  }

  /**
   * Clear UI and present inactive placeholder.  Pure UI concerns only – the
   * caller (component) is responsible for wiping its own state.
   */
  function showInactiveState({ formatBytes }) {
    elements.activeSection?.classList.add('hidden');
    elements.inactiveSection?.classList.remove('hidden');
    elements.knowledgeBaseFilesSection?.classList.add('hidden');

    if (elements.kbNameDisplay)   elements.kbNameDisplay.textContent   = 'N/A';
    if (elements.kbModelDisplay)  elements.kbModelDisplay.textContent  = 'N/A';
    if (elements.kbVersionDisplay)elements.kbVersionDisplay.textContent = 'N/A';
    if (elements.kbLastUsedDisplay)elements.kbLastUsedDisplay.textContent= 'N/A';
    if (elements.knowledgeFileCount)  elements.knowledgeFileCount.textContent  = '0';
    if (elements.knowledgeChunkCount) elements.knowledgeChunkCount.textContent = '0';
    if (elements.knowledgeFileSize)   elements.knowledgeFileSize.textContent   = formatBytes(0);

    // Clear file list container if present
    if (elements.knowledgeBaseFilesListContainer) {
      _safeSetInnerHTML(
        elements.knowledgeBaseFilesListContainer,
        '<p class="text-base-content/60 text-center py-4">No Knowledge Base active or selected.</p>'
      );
    }

    updateStatusIndicator(false);
  }

  /* ------------------------------------------------------------------
   *  Settings-modal helpers (migrated from legacy manager)
   * ----------------------------------------------------------------*/

  function populateSettingsForm(kb, { elements }) {
    const form = elements.settingsForm;
    if (!form) return;

    form.reset();

    const isExisting = Boolean(kb && kb.id);
    if (isExisting) {
      form.elements["name"].value = kb.name || "";
      form.elements["description"].value = kb.description || "";
      form.elements["auto_enable"].checked = kb.is_active !== false;
      if (form.elements["process_all_files"]) form.elements["process_all_files"].checked = false;
      form.elements["knowledge_base_id"].value = kb.id;
    } else {
      if (form.elements["process_all_files"]) form.elements["process_all_files"].checked = true;
      form.elements["auto_enable"].checked = true;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  function toggleRepoBlock(kb, { elements }) {
    const { kbGitHubAttachedRepoInfo, kbAttachedRepoUrlDisplay, kbAttachedRepoBranchDisplay, kbGitHubAttachForm, kbGitHubRepoUrlInput, kbGitHubBranchInput, kbGitHubFilePathsTextarea } = elements;

    if (kb && kb.repo_url) {
      kbGitHubAttachedRepoInfo?.classList.remove('hidden');
      if (kbAttachedRepoUrlDisplay) kbAttachedRepoUrlDisplay.textContent = kb.repo_url;
      if (kbAttachedRepoBranchDisplay) kbAttachedRepoBranchDisplay.textContent = kb.branch || 'main';
      kbGitHubAttachForm?.classList.add('hidden');
    } else {
      kbGitHubAttachedRepoInfo?.classList.add('hidden');
      kbGitHubAttachForm?.classList.remove('hidden');
      if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = '';
      if (kbGitHubBranchInput) kbGitHubBranchInput.value = 'main';
      if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = '';
    }
  }

  function showSettingsModal({ modalManager, elements }) {
    if (modalManager?.show) {
      modalManager.show('knowledge');
    } else if (typeof elements.settingsModal?.showModal === 'function') {
      elements.settingsModal.showModal();
    } else {
      domAPI.removeClass(elements.settingsModal, 'hidden');
    }
  }

  function hideSettingsModal({ modalManager, elements }) {
    if (modalManager?.hide) {
      modalManager.hide('knowledge');
    } else if (typeof elements.settingsModal?.close === 'function') {
      elements.settingsModal.close();
    } else {
      domAPI.addClass(elements.settingsModal, 'hidden');
    }
  }

  // ───── Model-select helpers ─────
  function validateModelDimensions(selectEl) {
    if (!selectEl) return;
    const parent = selectEl.closest('.form-control');
    if (!parent) return;
    let warning = parent.querySelector('.model-error');
    const opt = selectEl.options[selectEl.selectedIndex];
    const needsWarn = opt?.disabled;

    if (needsWarn) {
      if (!warning) {
        warning = domAPI.createElement('span');
        warning.className = 'label-text-alt text-error model-error';
        parent.appendChild(warning);
      }
      warning.textContent = 'Changing dimensions requires reprocessing all files!';
      warning.classList.remove('hidden');
    } else if (warning) {
      warning.classList.add('hidden');
      warning.textContent = '';
    }
  }

  function updateModelSelect(model, { elements }) {
    const sel = elements.modelSelect;
    if (!sel) return;

    if (model) {
      let found = false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === model) { sel.selectedIndex = i; found = true; break; }
      }
      if (!found) {
        const opt = new Option(`${model} (Current)`, model, false, true);
        sel.add(opt); sel.value = model;
      }
    } else {
      sel.selectedIndex = 0;
    }
    validateModelDimensions(sel);
  }

  return {
    elements,
    initialize: () => elements, // kept for API symmetry with other renderers
    updateBasicInfo,
    updateStatusIndicator,
    updateUploadButtonsState,
    renderFileList,
    populateSettingsForm,
    toggleRepoBlock,
    showSettingsModal,
    hideSettingsModal,
    validateModelDimensions,
    updateModelSelect,
    showInactiveState,
    cleanup() {/* nothing to cleanup – stateless renderer */}
  };
}

export default createKnowledgeBaseRenderer;

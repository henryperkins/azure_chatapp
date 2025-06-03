/**
 * @module knowledgeBaseSearchHandler
 * @description Handles search functionality for the KnowledgeBaseComponent.
 */
const MODULE = "KnowledgeBaseSearchHandler";

/**
 * Factory function to create a search handler for KnowledgeBaseComponent.
 * @param {Object} ctx - The KnowledgeBaseComponent instance (context).
 * @param {Object} ctx.elements - DOM element references.
 * @param {Object} ctx.state - Component's internal state.
 * @param {Object} ctx.config - Component's configuration.
 * @param {Function} ctx.apiRequest - API request function.
 * @param {Object} ctx.eventHandlers - Event handling utility.
 * @param {Object} ctx.uiUtils - UI utility functions.
 * @param {Object} ctx.scheduler - Scheduler for debounce (setTimeout, clearTimeout).
 * @param {Function} ctx._getCurrentProjectId - Function to get current project ID.
 * @param {Function} ctx.validateUUID - UUID validation function.
 * @param {Function} ctx._safeSetInnerHTML - Function to safely set innerHTML.
 * @returns {Object} Search handler instance with public methods.
 */
export function createKnowledgeBaseSearchHandler(ctx) {
  if (!ctx.domReadinessService)
    throw new Error(`[${MODULE}] domReadinessService missing for readiness check`);

  async function initialize() {
    await ctx.domReadinessService.dependenciesAndElements({
      deps     : ['app', 'projectManager', 'eventHandlers', 'domAPI'],
      context  : MODULE + ':init'
    });
  }


  /**
   * Perform a search against the knowledge base
   * @param {string} query - Search query
   * @returns {Promise<void>}
   */
  async function searchKnowledgeBase(query) {
    if (ctx.state.isSearching) return;
    const trimmed = (query || "").trim();
    if (
      !trimmed ||
      trimmed.length < ctx.config.minQueryLength ||
      trimmed.length > ctx.config.maxQueryLength
    ) {
      _showNoResults();
      return;
    }

    const pid = ctx._getCurrentProjectId();
    const kbId = ctx.state.knowledgeBase?.id;
    if (!pid) {
      return;
    }

    const cacheKey = `${pid}-${trimmed}-${_getSelectedTopKValue()}`;
    if (ctx.state.searchCache.has(cacheKey)) {
      _renderSearchResults(ctx.state.searchCache.get(cacheKey));
      return;
    }

    ctx.state.isSearching = true;
    _showSearchLoading();

    try {
      const endpoint = kbId
        ? `/api/projects/${pid}/knowledge-bases/${kbId}/search`
        : `/api/projects/${pid}/knowledge-bases/search`;
      const resp = await ctx.apiRequest(
        endpoint,
        {
          method: "POST",
          body: { query: trimmed, top_k: _getSelectedTopKValue() },
        },
        false,
      );
      const results = Array.isArray(resp?.data?.results)
        ? resp.data.results
        : [];
      if (results.length) {
        ctx.state.searchCache.set(cacheKey, results);
        _renderSearchResults(results);
      } else {
        _showNoResults();
      }
    } catch (err) {
      ctx.logger.error('[KnowledgeBaseSearchHandler] searchKnowledgeBase failed',
                       err,
                       { context: 'knowledgeBaseSearchHandler:search' });
    } finally {
      ctx.state.isSearching = false;
      _hideSearchLoading();
    }
  }

  const debouncedSearch = ctx._debounce(
    searchKnowledgeBase,
    ctx.config.searchDebounceTime,
  );

  /**
   * Trigger search from input field
   */
  function triggerSearch() {
    if (ctx.elements.searchInput) {
      searchKnowledgeBase(ctx.elements.searchInput.value);
    }
  }

  /**
   * Render search results in the UI
   * @param {Array<Object>} results
   */
  function _renderSearchResults(results) {
    _clearSearchResults();
    if (!results?.length) return _showNoResults();
    _appendSearchResults(results);
    _toggleResultSections(true);
  }

  function _clearSearchResults() {
    const { resultsContainer, resultsSection, noResultsSection } = ctx.elements;
    if (resultsContainer) resultsContainer.textContent = "";
    resultsSection?.classList.add("hidden");
    noResultsSection?.classList.add("hidden");
  }

  function _appendSearchResults(results) {
    const { resultsContainer } = ctx.elements;
    if (!resultsContainer) return;
    results.forEach((res) => {
      const item = _createResultItem(res);
      ctx.eventHandlers.trackListener(item, "click", () =>
        _showResultDetail(res),
      );
      ctx.eventHandlers.trackListener(item, "keydown", (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          _showResultDetail(res);
        }
      });
      resultsContainer.appendChild(item);
    });
  }

  function _toggleResultSections(show) {
    const { resultsSection, noResultsSection } = ctx.elements;
    if (resultsSection) resultsSection.classList.toggle("hidden", !show);
    if (noResultsSection) noResultsSection.classList.toggle("hidden", show);
  }

  /**
   * Create a single result card element
   * @param {Object} result
   * @returns {HTMLElement}
   */
  function _createResultItem(result) {
    const item = ctx.domAPI.createElement("div");
    item.className =
      "card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");

    const fileInfo = result.file_info || {};
    const filename =
      fileInfo.filename || result.metadata?.file_name || "Unknown source";
    const scorePct = Math.round((result.score || 0) * 100);

    const badgeClass = _getBadgeClass(scorePct);

    ctx._safeSetInnerHTML(item, `
      <div class="card-body p-3">
        <div class="card-title text-sm justify-between items-center mb-1">
          <div class="flex items-center gap-2 truncate">
            <span class="text-lg">${ctx.uiUtils.fileIcon(fileInfo.file_type)}</span>
            <span class="truncate" title="${filename}">${filename}</span>
          </div>
          <div class="badge ${badgeClass} badge-sm" title="Relevance: ${scorePct}%">
            ${scorePct}%
          </div>
        </div>
        <p class="text-xs text-base-content/80 kb-line-clamp-3 mb-2">
          ${result.text || "No content available."}
        </p>
      </div>
    `);
    return item;
  }

  function _getBadgeClass(scorePct) {
    if (scorePct >= 80) return "badge-success";
    if (scorePct >= 60) return "badge-warning";
    return "badge-ghost";
  }

  /**
   * Show detailed view of a search result
   * @param {Object} result
   */
  function _showResultDetail(result) {
    const modal = ctx.elements.resultModal;
    if (!modal || typeof modal.showModal !== "function") {
      return;
    }
    _populateResultDetail(result);
    modal.showModal();
  }

  function _populateResultDetail(result) {
    const {
      resultTitle,
      resultSource,
      resultScore,
      resultContent,
      useInChatBtn,
    } = ctx.elements;
    if (!resultTitle || !resultSource || !resultScore || !resultContent)
      return;

    const fileInfo = result.file_info || {};
    const filename =
      fileInfo.filename || result.metadata?.file_name || "Unknown Source";
    const scorePct = Math.round((result.score || 0) * 100);

    const badgeClass = _getBadgeClass(scorePct);

    resultTitle.textContent = `Detail: ${filename}`;
    resultSource.textContent = filename;
    resultScore.className = `badge ${badgeClass}`;
    resultScore.textContent = `${scorePct}%`;
    resultContent.textContent = result.text || "No content available.";
    resultContent.style.whiteSpace = "pre-wrap";

    if (useInChatBtn) {
      useInChatBtn.onclick = () => {
        _useInConversation(result);
        _hideResultDetailModal();
      };
    }
  }

  /**
   * Hide the result detail modal
   */
  function _hideResultDetailModal() {
    const modal = ctx.elements.resultModal;
    if (modal && typeof modal.close === "function") {
      modal.close();
    }
  }

  /**
   * Insert result reference into chat input
   * @param {Object} result
   */
  function _useInConversation(result) {
    const chatInput =
      ctx.domAPI.getElementById("chatUIInput") ||
      ctx.domAPI.getElementById("projectChatInput") ||
      ctx.domAPI.getElementById("chatInput") ||
      ctx.domAPI.querySelector('textarea[placeholder*="Send a message"]', undefined);

    if (!chatInput) return;
    const filename = result.metadata?.file_name || "the knowledge base";
    const refText = `Referring to content from "${filename}":\n\n> ${result.text.trim()}\n\nBased on this, `;
    const current = chatInput.value.trim();

    try {
      chatInput.value = current ? `${current}\n\n${refText}` : refText;
      chatInput.focus();
      const inputEvt = new Event('input', { bubbles: true });
      const doc = ctx.domAPI.getDocument();
      ctx.domAPI.dispatchEvent(doc, inputEvt);
    } catch (err) {
      ctx.logger.error('[KnowledgeBaseSearchHandler] _useInConversation failed',
                       err, { context: MODULE });
    }
  }

  /**
   * Show loading indicator for search
   */
  function _showSearchLoading() {
    const { resultsContainer, resultsSection, noResultsSection } =
      ctx.elements;
    resultsSection?.classList.remove("hidden");
    noResultsSection?.classList.add("hidden");
    if (resultsContainer) {
      ctx._safeSetInnerHTML(resultsContainer, `
        <div class="flex justify-center items-center p-4 text-base-content/70">
          <span class="loading loading-dots loading-md mr-2"></span>
          <span>Searching knowledge base...</span>
        </div>
      `);
    }
  }

  /**
   * Hide search loading indicator
   */
  function _hideSearchLoading() {
    if (!ctx.state.isSearching) {
      const loadingEl = ctx.elements.resultsContainer?.querySelector(
        ".flex.justify-center.items-center",
      );
      if (loadingEl && loadingEl.textContent.includes("Searching")) {
        loadingEl.remove();
      }
    }
  }

  /**
   * Show "no results" UI
   */
  function _showNoResults() {
    const { resultsSection, noResultsSection, resultsContainer } =
      ctx.elements;
    if (resultsContainer) resultsContainer.textContent = "";
    resultsSection?.classList.add("hidden");
    noResultsSection?.classList.remove("hidden");
  }

  /**
   * Get selected Top-K value
   * @returns {number}
   */
  function _getSelectedTopKValue() {
    const val = parseInt(ctx.elements.topKSelect?.value, 10);
    return isNaN(val) ? 5 : val;
  }

  function handleResultModalKeydown(e) {
    if (e.key === "Escape") _hideResultDetailModal();
  }

  return {
    searchKnowledgeBase,
    debouncedSearch,
    triggerSearch,
    hideResultDetailModal: _hideResultDetailModal, // expose for direct calls if needed
    handleResultModalKeydown,
    initialize,
    cleanup() {
      const EH = ctx.DependencySystem.modules.get('eventHandlers');
      if (EH && EH.cleanupListeners) EH.cleanupListeners({ context: 'KnowledgeBaseSearchHandler' });
    }
  };
}

export default createKnowledgeBaseSearchHandler;

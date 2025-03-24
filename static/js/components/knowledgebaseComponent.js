/**
 * knowledgeBaseComponent.js
 * Handles knowledge base functionality
 */

class KnowledgeBaseComponent {
  constructor() {
    this.elements = {
      container: document.getElementById("knowledgeTab"),
      searchInput: document.getElementById("knowledgeSearchInput"),
      searchButton: document.getElementById("runKnowledgeSearchBtn"),
      resultsContainer: document.getElementById("knowledgeResultsList"),
      resultsSection: document.getElementById("knowledgeSearchResults"),
      noResultsSection: document.getElementById("knowledgeNoResults"),
      processedFiles: document.getElementById("knowledgeProcessedFiles"),
      topK: document.getElementById("knowledgeTopK"),
      searchOptions: document.getElementById("knowledgeSearchOptions")
    };
    
    this.bindEvents();
  }
  
  bindEvents() {
    // Search button
    this.elements.searchButton?.addEventListener("click", () => {
      const query = this.elements.searchInput?.value?.trim();
      if (query) this.searchKnowledgeBase(query);
    });
    
    // Knowledge base toggle
    document.getElementById("knowledgeBaseEnabled")?.addEventListener("change", (e) => {
      this.toggleKnowledgeBase(e.target.checked);
    });
    
    // Search input - handle Enter key
    this.elements.searchInput?.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query) this.searchKnowledgeBase(query);
      }
    });
    
    // Close knowledge base modal button
    document.getElementById("closeKnowledgeSettingsBtn")?.addEventListener("click", () => {
      ModalManager.hide("knowledge");
    });
    
    // Reprocess files button - delegate event
    document.addEventListener("click", (e) => {
      if (e.target.id === "reprocessFilesBtn") {
        const projectId = window.projectManager?.currentProject?.id;
        if (projectId) {
          this.reprocessAllFiles(projectId);
        }
      }
    });
  }
  
  /**
   * Load knowledge base data for a project
   */
  loadData(projectId) {
    if (!projectId) return;
    
    // Load knowledge base status
    window.apiRequest(`/api/projects/${projectId}/knowledge-base`)
      .then(response => {
        this.renderKnowledgeBaseInfo(response.data);
      })
      .catch(err => {
        console.error("Error loading knowledge base data:", err);
        // Show appropriate UI for no knowledge base
        document.getElementById("knowledgeBaseActive")?.classList.add("hidden");
        document.getElementById("knowledgeBaseInactive")?.classList.remove("hidden");
      });
      
    // Load processed files stats
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/files`)
      .then(response => {
        this.renderProcessedFiles(response.data?.files || []);
      })
      .catch(err => {
        console.error("Error loading knowledge processed files:", err);
      });
  }
  
  /**
   * Search the knowledge base
   */
  searchKnowledgeBase(query) {
    const projectId = window.projectManager.currentProject?.id;
    if (!projectId) {
      window.UIUtils.showNotification("No project selected", "error");
      return;
    }
    
    const topK = this.elements.topK?.value || "5";
    
    // Show loading indicator
    this.showSearchLoading();
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/search`, "POST", {
      query,
      top_k: parseInt(topK, 10)
    })
      .then(response => {
        this.renderSearchResults(response.data?.results || []);
      })
      .catch(err => {
        console.error("Error searching knowledge base:", err);
        window.UIUtils.showNotification("Failed to search knowledge base", "error");
        this.showNoResults();
      });
  }
  
  /**
   * Toggle knowledge base status
   */
  toggleKnowledgeBase(enabled) {
    const projectId = window.projectManager.currentProject?.id;
    if (!projectId) return;
    
    window.UIUtils.showNotification(
      `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
      "info"
    );
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/toggle`, "POST", {
      enabled
    })
      .then(() => {
        window.UIUtils.showNotification(
          `Knowledge base ${enabled ? "enabled" : "disabled"}`,
          "success"
        );
        window.projectManager.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error(`Error ${enabled ? "enabling" : "disabling"} knowledge base:`, err);
        window.UIUtils.showNotification(
          `Failed to ${enabled ? "enable" : "disable"} knowledge base`,
          "error"
        );
        // Reset toggle to original state
        document.getElementById("knowledgeBaseEnabled").checked = !enabled;
      });
  }
  
  /**
   * Reprocess all files in the knowledge base
   */
  reprocessAllFiles(projectId) {
    if (!projectId) return;
    
    window.UIUtils.showNotification("Reprocessing files, this may take a moment...", "info");
    
    window.apiRequest(`/api/projects/${projectId}/files/reprocess`, "POST")
      .then(response => {
        const data = response.data || {};
        window.UIUtils.showNotification(
          `Reprocessed ${data.processed_success || 0} files successfully. ${data.processed_failed || 0} failed.`,
          data.processed_failed ? "warning" : "success"
        );
        window.projectManager.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error("Error reprocessing files:", err);
        window.UIUtils.showNotification("Failed to reprocess files", "error");
      });
  }
  
  /**
   * Show search loading state
   */
  showSearchLoading() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.add("hidden");
    
    if (this.elements.resultsContainer) {
      this.elements.resultsContainer.innerHTML = `
        <div class="flex justify-center items-center p-4">
          <div class="spinner mr-2 w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span>Searching knowledge base...</span>
        </div>
      `;
    }
    
    if (this.elements.resultsSection) this.elements.resultsSection.classList.remove("hidden");
  }
  
  /**
   * Show no results message
   */
  showNoResults() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.remove("hidden");
  }
  
  /**
   * Render search results
   */
  renderSearchResults(results) {
    if (!this.elements.resultsContainer) return;
    
    if (!results || results.length === 0) {
      this.showNoResults();
      return;
    }
    
    if (this.elements.resultsSection) this.elements.resultsSection.classList.remove("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.add("hidden");
    
    this.elements.resultsContainer.innerHTML = "";
    
    results.forEach((result, index) => {
      const item = window.UIUtils.createElement("div", {
        className: "bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow"
      });
      
      // Header with filename and score
      const header = window.UIUtils.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
      });
      
      const fileInfo = window.UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const fileIcon = window.UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: window.UIUtils.fileIcon(result.file_type || "txt")
      });
      
      const fileName = window.UIUtils.createElement("div", {
        className: "font-medium",
        textContent: result.filename || result.file_path || "Unknown source"
      });
      
      fileInfo.appendChild(fileIcon);
      fileInfo.appendChild(fileName);
      
      const score = window.UIUtils.createElement("div", {
        className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
        textContent: `${Math.round(result.score * 100)}% match`
      });
      
      header.appendChild(fileInfo);
      header.appendChild(score);
      item.appendChild(header);
      
      // Text snippet
      const snippet = window.UIUtils.createElement("div", {
        className: "text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3"
      });
      
      const textContent = result.text || result.content || "";
      const displayText = textContent.length > 200 
        ? textContent.substring(0, 200) + "..." 
        : textContent;
      
      snippet.textContent = displayText;
      item.appendChild(snippet);
      
      // Actions
      const actions = window.UIUtils.createElement("div", {
        className: "flex justify-end space-x-2 mt-2"
      });
      
      const viewBtn = window.UIUtils.createElement("button", {
        className: "text-xs px-2 py-1 text-blue-600 hover:text-blue-800",
        textContent: "View Full Context",
        onclick: () => this.viewKnowledgeResult(result)
      });
      
      const useBtn = window.UIUtils.createElement("button", {
        className: "text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700",
        textContent: "Use in Conversation",
        onclick: () => {
          window.location.href = `/?chatId=${window.CHAT_CONFIG?.chatId || ''}&kb=${result.id}`;
        }
      });
      
      actions.appendChild(viewBtn);
      actions.appendChild(useBtn);
      item.appendChild(actions);
      
      this.elements.resultsContainer.appendChild(item);
    });
  }
  
  /**
   * View a single knowledge base result
   */
  viewKnowledgeResult(result) {
    const title = result.filename || "Search Result";
    const content = `
      <div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg mb-4">
        <div class="flex justify-between mb-2">
          <span class="font-medium">Source:</span>
          <span>${result.filename || result.file_path || "Unknown"}</span>
        </div>
        <div class="flex justify-between mb-2">
          <span class="font-medium">Relevance:</span>
          <span>${Math.round(result.score * 100)}%</span>
        </div>
      </div>
      <pre class="whitespace-pre-wrap text-sm overflow-x-auto">${window.UIUtils.escapeHtml(result.text || result.content || "")}</pre>
    `;
    
    ModalManager.createViewModal(title, content);
  }
  
  /**
   * Render processed files
   */
  renderProcessedFiles(files) {
    const container = this.elements.processedFiles;
    if (!container) return;
    
    if (!files || files.length === 0) {
      container.innerHTML = `
        <div class="text-gray-500 text-center py-8">No files have been processed for knowledge search yet.</div>
      `;
      return;
    }
    
    container.innerHTML = "";
    
    files.forEach(file => {
      const item = window.UIUtils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2"
      });
      
      // File info
      const fileInfo = window.UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const fileIcon = window.UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: window.UIUtils.fileIcon(file.file_type || "txt")
      });
      
      const fileDetails = window.UIUtils.createElement("div", {
        className: "flex flex-col"
      });
      
      const fileName = window.UIUtils.createElement("div", {
        className: "font-medium",
        textContent: file.filename
      });
      
      const fileStatus = window.UIUtils.createElement("div", {
        className: "text-xs",
        textContent: `${file.processed ? 'Processed' : 'Pending'} · ${file.chunk_count || 0} chunks`
      });
      
      fileDetails.appendChild(fileName);
      fileDetails.appendChild(fileStatus);
      fileInfo.appendChild(fileIcon);
      fileInfo.appendChild(fileDetails);
      
      // Status badge
      const status = window.UIUtils.createElement("span", {
        className: `px-2 py-1 text-xs rounded ${file.processed ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`,
        textContent: file.processed ? 'Indexed' : 'Pending'
      });
      
      item.appendChild(fileInfo);
      item.appendChild(status);
      
      container.appendChild(item);
    });
  }
  
  /**
   * Render knowledge base info
   */
  renderKnowledgeBaseInfo(kb) {
    const activeContainer = document.getElementById("knowledgeBaseActive");
    const inactiveContainer = document.getElementById("knowledgeBaseInactive");
    
    if (!activeContainer || !inactiveContainer) return;
    
    if (kb) {
      // Display active knowledge base info
      document.getElementById("knowledgeBaseName").textContent = kb.name || "Project Knowledge Base";
      document.getElementById("knowledgeBaseModel").textContent = kb.embedding_model || "Default Embedding Model";
      document.getElementById("knowledgeBaseUpdated").textContent = `Last updated: ${window.UIUtils.formatDate(kb.last_updated || new Date())}`;
      
      // Set toggle state
      const toggleCheckbox = document.getElementById("knowledgeBaseEnabled");
      if (toggleCheckbox) {
        toggleCheckbox.checked = kb.is_active;
        document.getElementById("knowledgeBaseEnabledLabel").textContent = kb.is_active ? "Enabled" : "Disabled";
      }
      
      // Update stats
      document.getElementById("knowledgeFileCount").textContent = kb.indexed_files || 0;
      document.getElementById("knowledgeChunkCount").textContent = kb.total_chunks || 0;
      document.getElementById("knowledgeSearchCount").textContent = kb.search_count || 0;
      
      // Show the active view, hide inactive
      activeContainer.classList.remove("hidden");
      inactiveContainer.classList.add("hidden");
    } else {
      // Show the inactive view, hide active
      activeContainer.classList.add("hidden");
      inactiveContainer.classList.remove("hidden");
    }
  }
}

// Export the module
window.KnowledgeBaseComponent = KnowledgeBaseComponent;
// Import necessary utility classes directly using ES module syntax
import {
  UIUtils as UIUtilsClass,
  AnimationUtils as AnimationUtilsClass,
  ModalManager
} from './projectDashboardUtils.js';

// Create instances of utility classes for use within this module
const uiUtilsInstance = new UIUtilsClass();
const animationUtilsInstance = new AnimationUtilsClass();

// Ensure instances are available globally if other scripts rely on them (optional, but safer for now)
if (typeof window !== 'undefined') {
  if (!window.UIUtils) window.UIUtils = uiUtilsInstance;
  if (!window.AnimationUtils) window.AnimationUtils = animationUtilsInstance;
}

console.log('UIUtils instance created:', !!uiUtilsInstance?.createElement);
console.log('AnimationUtils instance created:', !!animationUtilsInstance?.animateProgress);

/**
 * Knowledge Base Component - Handles knowledge base functionality
 */
class KnowledgeBaseComponent {
  constructor() {
    this.elements = {
      container: document.getElementById("knowledgeTab"),
      searchInput: document.getElementById("knowledgeSearchInput"),
      searchButton: document.getElementById("runKnowledgeSearchBtn"),
      resultsContainer: document.getElementById("knowledgeResultsList"),
      resultsSection: document.getElementById("knowledgeSearchResults"),
      noResultsSection: document.getElementById("knowledgeNoResults")
    };
    
    this.bindEvents();
  }
  bindEvents() {
    this.elements.searchButton?.addEventListener("click", () => {
      const query = this.elements.searchInput?.value?.trim();
      if (query) this.searchKnowledgeBase(query);
    });

    document.getElementById("reprocessFilesBtn")?.addEventListener("click", () => {
      this.reprocessFiles();
    });
    
    document.getElementById("knowledgeBaseEnabled")?.addEventListener("change", (e) => {
      this.toggleKnowledgeBase(e.target.checked);
    });

    document.getElementById("setupKnowledgeBaseBtn")?.addEventListener("click", () => {
      window.modalManager?.show("knowledge");
    });

    document.getElementById("knowledgeBaseForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      const projectId = window.projectManager?.currentProject?.id;
      
      if (!projectId) {
        uiUtilsInstance.showNotification("No project selected", "error");
        return;
      }

      try {
        uiUtilsInstance.showNotification("Setting up knowledge base...", "info");
        
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base`,
          "POST",
          Object.fromEntries(formData)
        );

        uiUtilsInstance.showNotification("Knowledge base setup complete", "success");
        window.modalManager?.hide("knowledge");
        
        // Refresh knowledge base info
        await window.projectManager?.loadProjectStats(projectId);
      } catch (error) {
        console.error("Knowledge base setup failed:", error);
        uiUtilsInstance.showNotification("Failed to setup knowledge base", "error");
      }
    });
    
    this.elements.searchInput?.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query) this.searchKnowledgeBase(query);
      }
    });
  }
  
  // loadData method removed as KB info is now passed via renderKnowledgeBaseInfo
  // from the project stats payload in projectDashboard.js
  
  searchKnowledgeBase(query) {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) {
      uiUtilsInstance.showNotification("No project selected", "error");
      return;
    }
    
    this.showSearchLoading();
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/search`, "POST", {
      query,
      top_k: 5
    })
      .then(response => {
        this.renderSearchResults(response.data?.results || []);
      })
      .catch(err => {
        console.error("Error searching knowledge base:", err);
        uiUtilsInstance.showNotification("Search failed", "error");
        this.showNoResults();
      });
  }
  
  async toggleKnowledgeBase(enabled) {
    const project = window.projectManager?.currentProject;
    if (!project?.knowledge_base_id) return;
    
    const toggle = document.getElementById("knowledgeBaseEnabled");
    const originalState = toggle.checked;
    
    // Optimistic UI update
    toggle.checked = enabled;
    uiUtilsInstance.showNotification(
      `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
      "info"
    );
    
    try {
      const response = await window.apiRequest(
        `/api/knowledge-base/${project.knowledge_base_id}`, 
        "PATCH", 
        { is_active: enabled }
      );
      
      uiUtilsInstance.showNotification(
        `Knowledge base ${enabled ? "enabled" : "disabled"}`,
        "success"
      );
      
      // Refresh stats and KB info
      await Promise.all([
        window.projectManager?.loadProjectStats(project.id),
        this.loadKnowledgeBaseHealth(project.knowledge_base_id)
      ]);
    } catch (err) {
      console.error("Error toggling knowledge base:", err);
      // Revert UI on error
      toggle.checked = originalState;
      uiUtilsInstance.showNotification(
        `Failed to toggle knowledge base: ${err.message || "Unknown error"}`,
        "error"
      );
    }
  }

  async loadKnowledgeBaseHealth(kbId) {
    try {
      const health = await window.apiRequest(
        `/api/knowledge-base/${kbId}/health`,
        "GET"
      );
      this.renderHealthStatus(health);
    } catch (err) {
      console.error("Failed to load KB health:", err);
    }
  }
  
  showSearchLoading() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.add("hidden");
    
    if (this.elements.resultsContainer) {
      this.elements.resultsContainer.innerHTML = `
        <div class="flex justify-center items-center p-4">
          <div class="spinner mr-2 w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span>Searching...</span>
        </div>
      `;
      this.elements.resultsSection.classList.remove("hidden");
    }
  }
  
  showNoResults() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.remove("hidden");
  }

  async reprocessFiles() {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) return;

    try {
      uiUtilsInstance.showNotification("Reprocessing files for search...", "info");
      const response = await window.apiRequest(
        `/api/projects/${projectId}/files/reprocess`,
        "POST"
      );
      
      uiUtilsInstance.showNotification(
        `Reprocessed ${response.data.processed_success} files successfully`,
        "success"
      );
      
      // Refresh the file list and stats
      window.projectManager.loadProjectFiles(projectId);
      window.projectManager.loadProjectStats(projectId);
    } catch (error) {
      uiUtilsInstance.showNotification("Failed to reprocess files", "error");
      console.error("Reprocessing error:", error);
    }
  }
  
  renderSearchResults(results) {
    if (!this.elements.resultsContainer) return;
    
    if (!results || results.length === 0) {
      this.showNoResults();
      return;
    }
    
    this.elements.resultsContainer.innerHTML = "";
    this.elements.resultsSection.classList.remove("hidden");
    this.elements.noResultsSection.classList.add("hidden");
    
    results.forEach(result => {
      // Extract error details if present
      const errorDetails = result.metadata?.processing_error;
      const hasError = errorDetails && !result.success;
      
      const item = uiUtilsInstance.createElement("div", {
        className: `content-item bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow ${
          hasError ? "border-l-4 border-red-500" : ""
        }`
      });
      
      // Header with file info and match score
      const header = uiUtilsInstance.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
      });
      
      const fileInfo = uiUtilsInstance.createElement("div", { className: "flex items-center" });
      fileInfo.appendChild(uiUtilsInstance.createElement("span", {
        className: "text-lg mr-2",
        textContent: uiUtilsInstance.fileIcon(result.file_type || "txt")
      }));
      fileInfo.appendChild(uiUtilsInstance.createElement("div", {
        className: "font-medium",
        textContent: result.filename || result.file_path || "Unknown source"
      }));
      
      header.appendChild(fileInfo);
      header.appendChild(uiUtilsInstance.createElement("div", {
        className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
        textContent: `${Math.round(result.score * 100)}% match`
      }));
      
      item.appendChild(header);
      
      // Content snippet
      const snippet = uiUtilsInstance.createElement("div", {
        className: "text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3"
      });
      
      const textContent = result.text || result.content || "";
      snippet.textContent = textContent.length > 200 
        ? textContent.substring(0, 200) + "..." 
        : textContent;
      
      item.appendChild(snippet);
      this.elements.resultsContainer.appendChild(item);
    });
  }
  
  renderKnowledgeBaseInfo(kb) {
    const activeContainer = document.getElementById("knowledgeBaseActive");
    const inactiveContainer = document.getElementById("knowledgeBaseInactive");
    const modelSelect = document.getElementById("knowledgeBaseModelSelect");
    
    if (!activeContainer || !inactiveContainer) return;
    
    if (kb) {
      document.getElementById("knowledgeBaseName").textContent = kb.name || "Project Knowledge Base";
      document.getElementById("knowledgeBaseEnabled").checked = kb.is_active;
      
      if (modelSelect) {
        modelSelect.innerHTML = `
          <option value="all-MiniLM-L6-v2" ${kb.embedding_model === 'all-MiniLM-L6-v2' ? 'selected' : ''}>
            all-MiniLM-L6-v2 (Default)
          </option>
          <option value="text-embedding-3-small" ${kb.embedding_model === 'text-embedding-3-small' ? 'selected' : ''}>
            OpenAI text-embedding-3-small
          </option>
          <option value="embed-english-v3.0" ${kb.embedding_model === 'embed-english-v3.0' ? 'selected' : ''}>
            Cohere embed-english-v3.0
          </option>
        `;
      }
      
      // Update stats
      if (kb.stats) {
        const fileCountEl = document.getElementById("knowledgeFileCount");
        if (fileCountEl) fileCountEl.textContent = kb.stats.file_count || 0;
        const totalSizeEl = document.getElementById("knowledgeFileSize");
        if (totalSizeEl) totalSizeEl.textContent = uiUtilsInstance.formatBytes(kb.stats.total_size || 0);
      }
      
      activeContainer.classList.remove("hidden");
      inactiveContainer.classList.add("hidden");
    } else {
      activeContainer.classList.add("hidden");
      inactiveContainer.classList.remove("hidden");
    }
  }
}

// Export the KnowledgeBaseComponent class
export default KnowledgeBaseComponent;

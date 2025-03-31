/**
 * Project Dashboard - Main controller class
 * Manages the overall dashboard UI and interactions between components
 */
class ProjectDashboard {
  /**
   * Initialize the dashboard controller
   */
  constructor() {
    /* ===========================
       STATE MANAGEMENT
       =========================== */
    this.components = {};
    this.state = {
      currentView: null, // 'list' or 'details'
      currentProject: null
    };
    this.initAttempts = 0;
    this.MAX_INIT_RETRIES = 5;
    
    /* ===========================
       UTILITY DEPENDENCIES
       =========================== */
    this.modalManager = typeof window.ModalManager === 'function' 
      ? new window.ModalManager() 
      : window.modalManager;
    
    // Create a proper notification handler
    this.showNotification = (message, type = 'info') => {
      if (window.showNotification) {
        window.showNotification(message, type);
      } else if (window.UIUtils?.showNotification) {
        window.UIUtils.showNotification(message, type);
      } else if (window.Notifications) {
        if (type === 'error') window.Notifications.apiError(message);
        else if (type === 'success') window.Notifications.apiSuccess?.(message) || console.log(`[SUCCESS] ${message}`);
        else console.log(`[${type.toUpperCase()}] ${message}`);
      } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    };
  }

  /**
   * Initialize the dashboard with enhanced error handling and retry logic
   * @param {number} maxRetries - Maximum number of retry attempts
   * @param {number} retryDelay - Delay between retries in ms
   * @returns {Promise<boolean>} True if initialization succeeded
   */
  async init(maxRetries = 3, retryDelay = 300) {
    console.log('Initializing Project Dashboard...');
    this.showInitializationProgress("Starting initialization...");
    
    try {
      if (this.initAttempts >= this.MAX_INIT_RETRIES) {
        this.hideInitializationProgress();
        this._handleCriticalError(new Error(`Max initialization attempts (${this.MAX_INIT_RETRIES}) reached`));
        return false;
      }

      // Wait for dashboard utils to be ready
      if (!window.dashboardUtilsReady) {
        this.showInitializationProgress("Waiting for dashboard utilities...");
        console.log('Dashboard utilities not ready, waiting...');
        
        // Wait for dashboardUtilsReady event
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for dashboard utilities'));
          }, 2000);
          
          const readyHandler = () => {
            clearTimeout(timeout);
            resolve();
          };
          
          if (window.dashboardUtilsReady) {
            readyHandler();
          } else {
            document.addEventListener('dashboardUtilsReady', readyHandler, { once: true });
          }
        });
      }

      // Check for required global dependencies
      if (!window.projectManager) {
        this.showInitializationProgress("Waiting for ProjectManager...");
        console.log('ProjectManager not available, waiting...');
        
        // Create a timeout promise to implement a timeout function
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for ProjectManager')), 2000);
        });

        // Create a wait for ProjectManager promise
        const waitForManager = new Promise(resolve => {
          const checkInterval = setInterval(() => {
            if (window.projectManager) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });

        // Race the two promises
        try {
          await Promise.race([waitForManager, timeoutPromise]);
        } catch (timeoutError) {
          this.initAttempts++;
          console.warn(`ProjectManager not available after timeout (attempt ${this.initAttempts})`);
          
          if (this.initAttempts < this.MAX_INIT_RETRIES) {
            this.hideInitializationProgress();
            const delay = retryDelay * this.initAttempts;
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.init(maxRetries, retryDelay);
          }
          
          throw timeoutError;
        }
      }

      // Check if document is ready
      if (!this._isDocumentReady()) {
        this.showInitializationProgress("Waiting for document to be ready...");
        await new Promise(resolve => {
          if (document.readyState === 'complete' || document.readyState === 'interactive') {
            resolve();
          } else {
            document.addEventListener('DOMContentLoaded', resolve);
          }
        });
      }

      // Check for required UI components
      this.showInitializationProgress("Checking for UI components...");
      
      // Log component availability for debugging
      console.log('Component Availability Check:', {
        UIUtils: typeof window.UIUtils !== 'undefined',
        ProjectListComponent: typeof window.ProjectListComponent !== 'undefined',
        ProjectDetailsComponent: typeof window.ProjectDetailsComponent !== 'undefined',
        KnowledgeBaseComponent: typeof window.KnowledgeBaseComponent !== 'undefined'
      });
      
      // Try to complete initialization
      this.showInitializationProgress("Completing initialization...");
      await this._completeInitialization();
      
      console.log('✅ Project Dashboard initialized successfully');
      this.hideInitializationProgress();
      this.initAttempts = 0; // Reset on success
      return true;
    } catch (error) {
      this.hideInitializationProgress();
      console.error(`Initialization attempt ${this.initAttempts + 1} failed:`, error);
      
      // Attempt to load diagnostics
      console.log('Diagnostic info:', {
        projectManager: typeof window.projectManager,
        UIUtils: typeof window.UIUtils,
        ModalManager: typeof window.ModalManager,
        ProjectListComponent: typeof window.ProjectListComponent,
        ProjectDetailsComponent: typeof window.ProjectDetailsComponent,
        KnowledgeBaseComponent: typeof window.KnowledgeBaseComponent,
        document_ready: document.readyState,
        error_message: error.message
      });
      
      if (this.initAttempts < this.MAX_INIT_RETRIES) {
        this.initAttempts++;
        const delay = retryDelay * this.initAttempts;
        console.log(`Retrying in ${delay}ms (attempt ${this.initAttempts} of ${this.MAX_INIT_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.init(maxRetries, retryDelay);
      }

      this._handleCriticalError(error);
      return false;
    }
  }

  /* ===========================
     VIEW MANAGEMENT
     =========================== */
  
  /**
   * Show the project list view
   */
  showProjectList() {
    this.state.currentView = 'list';
    this.components.projectList.show();
    this.components.projectDetails.hide();
    window.history.pushState({}, "", window.location.pathname);
    this.loadProjects();
  }

  /**
   * Show project details view for a specific project
   * @param {string} projectId - Project ID to show
   */
  async showProjectDetails(projectId) {
    this.state.currentView = 'details';
    this.components.projectList.hide();
    this.components.projectDetails.show();
    window.history.pushState({}, "", `?project=${projectId}`);
    
    try {
      await window.projectManager.loadProjectDetails(projectId);
    } catch (error) {
      console.error("Failed to load project details:", error);
      this.showNotification("Failed to load project", "error");
      this.showProjectList();
    }
  }

  /**
   * Process URL parameters to determine initial view
   */
  processUrlParams() {
    // Only process project params if we're on the projects page
    if (!window.location.pathname.includes('/projects')) {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  /**
   * Load projects with optional filter
   * @param {string} filter - Filter type ('all', 'pinned', 'archived')
   * @returns {Promise} Promise that resolves with loaded projects
   */
  async loadProjects(filter = 'all') {
    try {
      if (!window.projectManager) {
        console.error('projectManager not available on window');
        throw new Error('projectManager not initialized');
      }
      
      console.log('[DEBUG] Loading projects with filter:', filter);
      const response = await window.projectManager.loadProjects(filter);
      console.log('[DEBUG] Projects loaded - response:', response);
      return response;
    } catch (error) {
      console.error("Failed to load projects:", error);
      document.dispatchEvent(new CustomEvent("projectsLoaded", {
        detail: {
          error: true,
          message: error.message
        }
      }));
      throw error;
    }
  }

  /* ===========================
     EVENT HANDLERS
     =========================== */
  
  /**
   * Handle a project being selected from the list
   * @param {string} projectId - Selected project ID
   */
  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  /**
   * Handle back button to return to project list
   */
  handleBackToList() {
    this.showProjectList();
  }
  
  /**
   * Handle project form submit event
   * @param {Event} e - Form submit event
   */
  async handleProjectFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const projectId = form.querySelector("#projectIdInput").value;
    const isEditing = !!projectId;
    
    const formData = {
      name: form.querySelector("#projectNameInput").value.trim(),
      description: form.querySelector("#projectDescInput").value.trim(),
      goals: form.querySelector("#projectGoalsInput").value.trim(),
      max_tokens: parseInt(form.querySelector("#projectMaxTokensInput").value, 10)
    };

    if (!formData.name) {
      this.showNotification("Project name is required", "error");
      return;
    }

    try {
      await window.projectManager.createOrUpdateProject(projectId, formData);
      
      // Use our consistent notification method
      this.showNotification(
        isEditing ? "Project updated" : "Project created",
        "success"
      );
      
      this.modalManager.hide("project");
      this.loadProjects();
    } catch (error) {
      console.error("Error saving project:", error);
      this.showNotification("Failed to save project", "error");
    }
  }

  /**
   * Handle projects loaded event
   * @param {CustomEvent} event - Projects loaded event
   */
  handleProjectsLoaded(event) {
    console.log('[DEBUG] Handling projectsLoaded event with detail:', event.detail);
    try {
      const { data } = event.detail;
      let projects = [];
      let originalCount = 0;
      let filter = 'all';
      let hasError = false;

      // Standard response format from backend
      if (data?.projects) {
        projects = data.projects;
        originalCount = data.count || projects.length;
        filter = data.filter?.type || 'all';
      } 
      // Fallback for direct array
      else if (Array.isArray(event.detail)) {
        projects = event.detail;
        originalCount = projects.length;
      }

      hasError = event.detail.error || false;
      console.log('[DEBUG] Calling renderProjects with:', projects.length, 'projects');
      this.components.projectList.renderProjects(projects);

      // Update empty state message
      const noProjectsMsg = document.getElementById('noProjectsMessage');
      if (noProjectsMsg) {
        noProjectsMsg.classList.toggle('hidden', projects.length > 0 || hasError);
        
        if (hasError) {
          noProjectsMsg.textContent = "Error loading projects";
          noProjectsMsg.classList.add('text-red-600');
        } else if (projects.length === 0 && originalCount > 0) {
          noProjectsMsg.textContent = `No ${filter} projects found`;
          noProjectsMsg.classList.remove('text-red-600');
        } else if (projects.length === 0) {
          noProjectsMsg.textContent = `No ${filter} projects found`;
          noProjectsMsg.classList.remove('text-red-600');
        }
      }
    } catch (error) {
      console.error("Error handling projects:", error);
    }
  }

  /**
   * Handle project loaded event
   * @param {CustomEvent} event - Project loaded event
   */
  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    this.components.projectDetails.renderProject(project);
    
    // Unified KB component handling
    if (project.knowledge_base_id && this.components.knowledgeBase) {
      // If project has KB info, pass it directly
      if (project.knowledge_base) {
        this.components.knowledgeBase.renderKnowledgeBaseInfo(project.knowledge_base);
      }
      // Otherwise, load it if needed
      else if (window.projectManager?.loadKnowledgeBaseDetails) {
        window.projectManager.loadKnowledgeBaseDetails(project.knowledge_base_id)
          .catch(err => console.error('Failed to load KB details:', err));
      }
    } else if (this.components.knowledgeBase) {
      // Explicitly indicate no KB is available
      this.components.knowledgeBase.renderKnowledgeBaseInfo(null);
    }
  }

  /**
   * Handle project stats loaded event
   * @param {CustomEvent} event - Project stats loaded event
   */
  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails.renderStats(stats);
    
    // Pass knowledge base info from stats to the KB component
    if (stats && stats.knowledge_base) {
      this.components.knowledgeBase.renderKnowledgeBaseInfo(stats.knowledge_base);
    } else {
      // Render KB as inactive if no info is present in stats
      this.components.knowledgeBase.renderKnowledgeBaseInfo(null);
    }
  }

  /**
   * Handle files loaded event
   * @param {CustomEvent} event - Files loaded event
   */
  handleFilesLoaded(event) {
    this.components.projectDetails.renderFiles(event.detail.files);
  }

  /**
   * Handle conversations loaded event
   * @param {CustomEvent} event - Conversations loaded event
   */
  handleConversationsLoaded(event) {
    let conversations = [];
    
    // Normalize different response formats
    if (Array.isArray(event.detail)) {
      conversations = event.detail;
    } else if (event.detail?.conversations) {
      conversations = event.detail.conversations;
    } else if (event.detail?.data?.conversations) {
      conversations = event.detail.data.conversations;
    }
    
    this.components.projectDetails.renderConversations(conversations);
    
    // Refresh stats when conversations are loaded
    if (this.state.currentProject?.id) {
      window.projectManager.loadProjectStats(this.state.currentProject.id);
    }
  }

  /**
   * Handle artifacts loaded event
   * @param {CustomEvent} event - Artifacts loaded event
   */
  handleArtifactsLoaded(event) {
    this.components.projectDetails.renderArtifacts?.(event.detail.artifacts);
  }

  /* ===========================
     PRIVATE HELPER METHODS
     =========================== */
  
  /**
   * Check if document is ready
   * @private
   * @returns {boolean} True if document is ready
   */
  _isDocumentReady() {
    return document.readyState === 'complete' ||
           document.readyState === 'interactive';
  }
  
  /**
   * Show initialization progress indicator
   * @private
   * @param {string} message - Progress message
   */
  showInitializationProgress(message) {
    // Create or update progress indicator
    let progressEl = document.getElementById('dashboardInitProgress');
    
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.id = 'dashboardInitProgress';
      progressEl.className = 'fixed top-4 right-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded shadow-md z-50 flex items-center';
      document.body.appendChild(progressEl);
    }
    
    progressEl.innerHTML = `
      <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>${message || 'Initializing dashboard...'}</span>
    `;
  }
  
  /**
   * Hide initialization progress indicator
   * @private
   */
  hideInitializationProgress() {
    const progressEl = document.getElementById('dashboardInitProgress');
    if (progressEl) {
      progressEl.remove();
    }
  }
  
  /**
   * Handle critical initialization error
   * @private
   * @param {Error} error - The error that occurred
   */
  _handleCriticalError(error) {
    console.error('💥 FATAL Init Failure:', error);
    if (this.showNotification) {
      this.showNotification('Application failed to initialize', 'error');
    }
    
    // Show user-facing error message
    const containerEl = document.querySelector('#projectListView');
    if (containerEl) {
      containerEl.innerHTML = `
        <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm leading-5 font-medium text-red-800">
                Dashboard initialization failed
              </h3>
              <div class="mt-1 text-sm leading-5 text-red-700">
                ${error.message || 'Unknown error occurred'}. Try refreshing the page.
              </div>
              <div class="mt-4">
                <button type="button" onclick="window.location.reload()"
                        class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:border-red-300 focus:shadow-outline-red active:bg-red-200 transition ease-in-out duration-150">
                  Refresh Page
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  }

  /**
   * Ensure fallback components are available if real ones aren't loaded
   * @private
   */
  ensureFallbackComponents() {
    // Create fallback components if needed
    if (typeof window.ProjectListComponent !== 'function') {
      console.warn('Creating fallback ProjectListComponent');
      window.ProjectListComponent = class ProjectListComponent {
        constructor(options = {}) {
          console.log('Using fallback ProjectListComponent');
          this.elementId = options.elementId;
          this.element = document.getElementById(this.elementId);
          this.onViewProject = options.onViewProject;
          
          if (!this.element) {
            this.element = document.createElement('div');
            this.element.id = this.elementId;
            document.querySelector('#projectListView')?.appendChild(this.element);
          }
        }
        show() {
          if (this.element) this.element.style.display = 'block';
          const listView = document.getElementById('projectListView');
          if (listView) listView.classList.remove('hidden');
        }
        hide() {
          if (this.element) this.element.style.display = 'none';
          const listView = document.getElementById('projectListView');
          if (listView) listView.classList.add('hidden');
        }
        renderProjects(projects = []) {
          if (!this.element) return;
          this.element.innerHTML = '<div class="text-center p-4">Projects will appear here.</div>';
        }
      };
    }
    
    if (typeof window.ProjectDetailsComponent !== 'function') {
      console.warn('Creating fallback ProjectDetailsComponent');
      window.ProjectDetailsComponent = class ProjectDetailsComponent {
        constructor(options = {}) {
          console.log('Using fallback ProjectDetailsComponent');
          this.element = document.getElementById('projectDetailsView');
          this.onBack = options.onBack;
        }
        show() {
          if (this.element) this.element.classList.remove('hidden');
        }
        hide() {
          if (this.element) this.element.classList.add('hidden');
        }
        renderProject() {}
        renderStats() {}
        renderFiles() {}
        renderConversations() {}
        renderArtifacts() {}
      };
    }
    
    if (typeof window.KnowledgeBaseComponent !== 'function') {
      console.warn('Creating fallback KnowledgeBaseComponent');
      window.KnowledgeBaseComponent = class KnowledgeBaseComponent {
        constructor() {
          console.log('Using fallback KnowledgeBaseComponent');
        }
        renderKnowledgeBaseInfo() {}
      };
    }
  }

  /**
   * Complete dashboard initialization
   * @private
   */
  async _completeInitialization() {
    // Verify required dependencies and route
    if (!window.projectManager) {
      throw new Error('ProjectManager not available - required dependency');
    }
    
    // Only initialize project UI if we're on the projects page
    if (!window.location.pathname.includes('/projects')) {
      return;
    }

    // Ensure DOM elements exist or create fallbacks
    const projectListEl = document.getElementById("projectList");
    if (!projectListEl) {
      console.warn("Project list element not found - creating fallback");
      const container = document.createElement("div");
      container.id = "projectList";
      document.querySelector("#projectListView")?.appendChild(container);
    }

    // Create a visual loading indicator
    this.showInitializationProgress("Loading components...");

    // Ensure modal manager is correctly initialized
    if (window.ModalManager && !window.modalManager) {
      console.log('[ProjectDashboard] Creating global modalManager instance');
      window.modalManager = new window.ModalManager();
    }

    // Register knowledge base modal immediately if available
    const kbModal = document.getElementById('knowledgeBaseSettingsModal');
    if (kbModal && window.modalManager) {
      console.log('[ProjectDashboard] Pre-registering KB modal with modalManager');
      window.modalManager.modals = window.modalManager.modals || {};
      window.modalManager.modals.knowledge = kbModal;
    }
    
    // Verify all required dependencies are available
    const requiredDeps = {
      UIUtils: typeof window.UIUtils !== 'undefined',
      ModalManager: typeof window.ModalManager !== 'undefined',
      ProjectListComponent: typeof window.ProjectListComponent !== 'undefined',
      ProjectDetailsComponent: typeof window.ProjectDetailsComponent !== 'undefined',
      KnowledgeBaseComponent: typeof window.KnowledgeBaseComponent !== 'undefined'
    };
    
    const missingDeps = Object.entries(requiredDeps)
      .filter(([_, available]) => !available)
      .map(([name]) => name);

    if (missingDeps.length > 0) {
      console.warn(`Missing dependencies detected: ${missingDeps.join(', ')}. Will use fallbacks.`);
      this.ensureFallbackComponents();
    }
    
    try {
      // Create component instances
      this.components = {};

      // ProjectListComponent
      if (typeof window.ProjectListComponent === 'function') {
        this.components.projectList = new window.ProjectListComponent({
          elementId: "projectList",
          onViewProject: this.handleViewProject.bind(this)
        });
      } else {
        throw new Error("ProjectListComponent is not properly defined");
      }

      // ProjectDetailsComponent
      if (typeof window.ProjectDetailsComponent === 'function') {
        this.components.projectDetails = new window.ProjectDetailsComponent({
          onBack: this.handleBackToList.bind(this)
        });
      } else {
        throw new Error("ProjectDetailsComponent is not properly defined");
      }

      // KnowledgeBaseComponent - treat as optional with fallback
      if (typeof window.KnowledgeBaseComponent === 'function') {
        this.components.knowledgeBase = new window.KnowledgeBaseComponent();
      } else {
        console.warn("Using mock KnowledgeBaseComponent");
        // Create a simple mock that implements the required interface
        this.components.knowledgeBase = {
          renderKnowledgeBaseInfo: function(kb) {
            console.log("Mock KnowledgeBaseComponent.renderKnowledgeBaseInfo called", kb);
          }
        };
      }

      // Verify components initialized properly
      if (!this.components.projectList?.element) {
        throw new Error("ProjectListComponent failed to initialize - missing element");
      }
      
      this.hideInitializationProgress();
    } catch (error) {
      this.hideInitializationProgress();
      console.error("Component initialization failed:", error);
      throw new Error(`Failed to initialize dashboard components: ${error.message}`);
    }

    // Set initialization flag first
    window.projectDashboardInitialized = true;
    document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));

    // Register listeners
    this.registerEventListeners();
    
    // Process initial state
    this.processUrlParams();
    
    // Check for selected project in localStorage to help websocket
    const storedProjectId = localStorage.getItem('selectedProjectId');
    if (storedProjectId) {
      console.log('[DEBUG] Found stored project ID:', storedProjectId);
      // Ensure this is accessible to the websocket connections
      document.dispatchEvent(new CustomEvent('projectSelected', {
        detail: { projectId: storedProjectId }
      }));
    }
    
    // Load data after brief timeout to ensure DOM is ready
    setTimeout(() => {
      console.log('[DEBUG] Loading projects after initialization...');
      this.loadProjects().catch(err => {
        console.error('Initial project load failed:', err);
      });
    }, 100);
  }

  /**
   * Register all event listeners
   */
  registerEventListeners() {
    // Data events
    console.log('[DEBUG] Registering event listeners');
    document.addEventListener("projectsLoaded", this.handleProjectsLoaded.bind(this));
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));

    // UI events
    document.getElementById("projectForm")?.addEventListener("submit", 
      this.handleProjectFormSubmit.bind(this));
    
    // Add a flag to prevent double triggering of file dialog
    let fileInputClicked = false;
    
    document.getElementById("uploadFileBtn")?.addEventListener("click", (event) => {
      // Prevent event bubbling that might cause double clicks
      event.preventDefault();
      event.stopPropagation();
      
      if (fileInputClicked) return;
      fileInputClicked = true;
      
      // Use setTimeout to reset the flag after a short delay
      setTimeout(() => { fileInputClicked = false; }, 500);
      
      const fileInput = document.getElementById("fileInput");
      if (fileInput) fileInput.click();
    });
    
    document.getElementById("fileInput")?.addEventListener("change", (e) => {
      if (!e.target.files?.length) return;
      const projectId = this.state.currentProject?.id;
      if (projectId) {
        this.components.projectDetails.uploadFiles(projectId, e.target.files)
          .then(() => {
            // Refresh stats after successful upload
            window.projectManager.loadProjectStats(projectId);
          })
          .catch(error => {
            // Handle knowledge base configuration error specifically
            if (error === "Knowledge base not configured") {
              // Provide a more helpful message to guide the user
              window.showNotification(
                "You need to set up a knowledge base before uploading files. Click 'Setup KB' in the project details.",
                "warning",
                {
                  action: "Setup KB",
                  onAction: () => {
                    if (window.modalManager && typeof window.modalManager.show === 'function') {
                      console.log('[DEBUG] Using modal manager to show knowledge base modal');
                      window.modalManager.show("knowledge");
                    } else {
                      console.log('[DEBUG] Modal manager not available, direct DOM manipulation');
                      const modal = document.getElementById('knowledgeBaseSettingsModal');
                      if (modal) {
                        modal.classList.remove('hidden');
                        modal.classList.add('confirm-modal');
                      } else {
                        console.error('[ERROR] Could not find knowledge base settings modal');
                      }
                    }
                  }
                }
              );
            } else {
              console.error("File upload failed:", error);
              window.showNotification("File upload failed: " + error, "error");
            }
          });
      }
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', () => {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get("project");
      
      if (projectId && this.state.currentView !== 'details') {
        this.showProjectDetails(projectId);
      } else if (!projectId && this.state.currentView !== 'list') {
        this.showProjectList();
      }
    });
  }
}

/**
 * Initialize the project dashboard
 * @returns {Promise<ProjectDashboard>} Initialized dashboard
 */
async function initProjectDashboard() {
  try {
    console.log('Initializing project dashboard...');
    const dashboard = new ProjectDashboard();
    await dashboard.init();
    
    // For debugging and development access
    window.projectDashboard = dashboard;
    
    return dashboard;
  } catch (error) {
    console.error("Failed to initialize project dashboard:", error);
    if (window.showNotification) {
      window.showNotification("Failed to initialize dashboard", "error");
    }
    throw error;
  }
}

// Automatic initialization in browser context
if (typeof window !== 'undefined') {
  window.initProjectDashboard = initProjectDashboard;
  window.ProjectDashboard = ProjectDashboard;
  
  // Wait for both DOM and dashboard utils to be ready before initializing
  const startInitialization = async () => {
    try {
      if (!window.projectManager) {
        throw new Error('projectManager not available');
      }

      if (!window.dashboardUtilsReady) {
        console.log('Waiting for dashboard utils to be ready');
        if (document.readyState === 'loading') {
          await new Promise(resolve => document.addEventListener('dashboardUtilsReady', resolve, { once: true }));
        } else if (!window.dashboardUtilsReady) {
          await new Promise(resolve => {
            const checkReady = () => {
              if (window.dashboardUtilsReady) {
                resolve();
              } else {
                setTimeout(checkReady, 50);
              }
            };
            checkReady();
          });
        }
      }

      // Wait briefly for DOM to settle
      await new Promise(resolve => setTimeout(resolve, 50));

      // Ensure required DOM elements exist (create if missing)
      const requiredElements = ['projectList', 'projectListView'];
      const missingElements = requiredElements.filter(id => !document.getElementById(id));
      
      // Create fallback containers for missing elements
      missingElements.forEach(id => {
        if (!document.getElementById(id)) {
          const container = document.createElement('div');
          container.id = id;
          document.body.appendChild(container);
        }
      });

      await initProjectDashboard();
    } catch (error) {
      console.error('Initialization failed:', error);
      // Retry after delay
      setTimeout(startInitialization, 300);
    }
  };

  // Start initialization when the document is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    startInitialization();
  } else {
    document.addEventListener('DOMContentLoaded', startInitialization);
  }
}

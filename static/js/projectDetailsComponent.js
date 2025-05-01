/**
 * projectDetailsComponent.js - DI Strict Version (No window.* for dependencies)
 *
 * Component for displaying project details, files, conversations, artifacts, and knowledge base content.
 * All dependencies are now injected via DI, never by global or window.DependencySystem.
 *
 * ## Dependencies (All passed as constructor/injection):
 * - app: Core app module (state, notifications, apiRequest, utilities, validation)
 * - projectManager: Project data operations and event emitting (files, conversations, artifacts, chat, stats)
 * - eventHandlers: Centralized event listener management (trackListener, delegate, cleanupListeners)
 * - FileUploadComponentClass: Class/factory for file uploading (needs relevant DOM nodes)
 * - modalManager: Manages modal dialogs, including confirmations
 * - knowledgeBaseComponent: (Optional) instance of knowledge base UI logic
 * - onBack: (Optional) callback for navigation “Back” button
 */

class ProjectDetailsComponent {
  /**
   * @param {Object} options
   * @param {Function} [options.onBack] - Callback for back navigation
   * @param {Object} options.app        - Core app module
   * @param {Object} options.projectManager - ProjectManager instance
   * @param {Object} options.eventHandlers   - Central event mgmt
   * @param {Object} options.modalManager    - Modal management
   * @param {Function} options.FileUploadComponentClass - File upload component factory/constructor
   * @param {Object} [options.knowledgeBaseComponent]    - Optional knowledge base UI logic
   * @param {Object} [options.modelConfig]               - Optional model config manager
   */
  constructor(options = {}) {
    this.onBack = options.onBack || (() => { console.warn("onBack callback not registered."); });
    this.app = options.app;
    this.projectManager = options.projectManager;
    this.eventHandlers = options.eventHandlers;
    this.modalManager = options.modalManager;
    this.FileUploadComponentClass = options.FileUploadComponentClass;
    this.knowledgeBaseComponent = options.knowledgeBaseComponent || null;

    if (!this.app || !this.projectManager || !this.eventHandlers ||
      !this.modalManager || !this.FileUploadComponentClass) {
      throw new Error("[ProjectDetailsComponent] Missing one or more required DI dependencies (app, projectManager, eventHandlers, modalManager, FileUploadComponentClass).");
    }

    // Internal component state
    this.state = {
      currentProject: null,
      activeTab: 'details',
      isLoading: {},
      initialized: false
    };

    // File constraints
    this.fileConstants = {
      allowedExtensions: [
        '.txt', '.md', '.csv', '.json',
        '.pdf', '.doc', '.docx', '.py',
        '.js', '.html', '.css', '.jpg',
        '.jpeg', '.png', '.gif', '.zip'
      ],
      maxSizeMB: 30
    };

    // Cached DOM elements for convenience
    this.elements = {
      container: null, title: null, description: null, backBtn: null,
      tabContainer: null, filesList: null, conversationsList: null,
      artifactsList: null, tabContents: {}, loadingIndicators: {},
      fileInput: null, uploadBtn: null, dragZone: null,
      uploadProgress: null, progressBar: null, uploadStatus: null
    };

    this.fileUploadComponent = null;

    // Optional injection or fallback for modelConfig
    this.modelConfig = options.modelConfig ||
      (typeof DependencySystem !== 'undefined' && DependencySystem?.modules?.get?.('modelConfig'));
    if (!this.modelConfig) {
      console.warn('[ProjectDetailsComponent] modelConfig dependency not found or not injected. Chat model config panel may be skipped.');
    }
  }

  /**
   * Initialize the component by finding DOM elements and binding events.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.state.initialized) {
      console.log('[ProjectDetailsComponent] Already initialized');
      return true;
    }
    try {
      if (!this._findElements()) {
        throw new Error("Required elements not found within #projectDetailsView container.");
      }
      this._bindCoreEvents();
      this._initializeSubComponents();
      this.state.initialized = true;
      console.log('[ProjectDetailsComponent] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[ProjectDetailsComponent] Initialization failed:', error);
      this.app.showNotification('Project Details component failed to initialize.', 'error');
      this.state.initialized = false;
      return false;
    }
  }

  /* --------------------------------------------------------------------------
   * DOM / Sub-Components
   * ------------------------------------------------------------------------- */

  /**
   * Locate necessary DOM elements under #projectDetailsView.
   * @private
   */
  _findElements() {
    this.elements.container = document.getElementById('projectDetailsView');
    if (!this.elements.container) {
      console.error("[ProjectDetailsComponent] Container #projectDetailsView not found!");
      return false;
    }
    this.elements.title = this.elements.container.querySelector('#projectTitle');
    this.elements.description = this.elements.container.querySelector('#projectDescription');
    this.elements.backBtn = this.elements.container.querySelector('#backToProjectsBtn');
    this.elements.tabContainer = this.elements.container.querySelector('.tabs[role="tablist"]');
    this.elements.filesList = this.elements.container.querySelector('#projectFilesList');
    this.elements.conversationsList = this.elements.container.querySelector('#projectConversationsList');
    this.elements.artifactsList = this.elements.container.querySelector('#projectArtifactsList');

    // Tab contents
    this.elements.tabContents = {
      details: this.elements.container.querySelector('#detailsTab'),
      files: this.elements.container.querySelector('#filesTab'),
      knowledge: this.elements.container.querySelector('#knowledgeTab'),
      conversations: this.elements.container.querySelector('#conversationsTab'),
      artifacts: this.elements.container.querySelector('#artifactsTab'),
      chat: this.elements.container.querySelector('#chatTab')
    };

    // Loading indicators
    this.elements.loadingIndicators = {
      files: this.elements.container.querySelector('#filesLoadingIndicator'),
      conversations: this.elements.container.querySelector('#conversationsLoadingIndicator'),
      artifacts: this.elements.container.querySelector('#artifactsLoadingIndicator')
    };

    // File upload
    this.elements.fileInput = this.elements.container.querySelector('#fileInput');
    this.elements.uploadBtn = this.elements.container.querySelector('#uploadFileBtn');
    this.elements.dragZone = this.elements.container.querySelector('#dragDropZone');
    this.elements.uploadProgress = this.elements.container.querySelector('#filesUploadProgress');
    this.elements.progressBar = this.elements.container.querySelector('#fileProgressBar');
    this.elements.uploadStatus = this.elements.container.querySelector('#uploadStatus');

    // Verify minimal required elements
    return !!(this.elements.title && this.elements.backBtn && this.elements.tabContainer);
  }

  /**
   * Bind core event listeners for tabs, new chat, back button.
   * Uses the injected eventHandlers for consistent tracking/cleanup.
   * @private
   */
  _bindCoreEvents() {
    if (!this.eventHandlers) {
      console.error("[ProjectDetailsComponent] eventHandlers missing, cannot bind events.");
      return;
    }

    // Back button
    if (this.elements.backBtn) {
      this.eventHandlers.cleanupListeners(this.elements.backBtn, 'click');
      this.eventHandlers.trackListener(
        this.elements.backBtn,
        'click',
        (e) => {
          console.log('[ProjectDetailsComponent] Back button clicked, invoking onBack callback');
          this.onBack(e);
        },
        { description: 'ProjectDetailsBack' }
      );
    }

    // Tab switching via delegation
    if (this.elements.tabContainer) {
      this.eventHandlers.cleanupListeners(this.elements.tabContainer, 'click');
      this.eventHandlers.delegate(
        this.elements.tabContainer,
        'click',
        '.project-tab-btn',
        (event, target) => {
          const tabName = target.dataset.tab;
          if (tabName) this.switchTab(tabName);
        },
        { description: 'ProjectTabSwitch' }
      );
    }

    // "New Conversation" button
    const newChatBtn = this.elements.container?.querySelector('#projectNewConversationBtn');
    if (newChatBtn) {
      this.eventHandlers.cleanupListeners(newChatBtn, 'click');
      // Initialize the button as disabled until the project is fully loaded
      newChatBtn.disabled = true;
      newChatBtn.classList.add('btn-disabled');
      
      this.eventHandlers.trackListener(
        newChatBtn,
        'click',
        () => {
          const projectManager = this.projectManager;
          if (this.state.currentProject?.id && !projectManager?.projectLoadingInProgress) {
            this.createNewConversation();
          } else {
            this.app.showNotification("Please wait for project details to load first.", "warning");
          }
        },
        { description: 'ProjectNewConversation' }
      );
    }

    // Listen for project data events
    this.eventHandlers.trackListener(
      document,
      'projectConversationsLoaded',
      (e) => {
        this.renderConversations(e.detail?.conversations || []);
        // Emit rendering completion event
        document.dispatchEvent(new CustomEvent('projectConversationsRendered', {
          detail: { projectId: e.detail?.projectId }
        }));
      },
      { description: 'ProjectDetails_HandleConversationsLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectFilesLoaded',
      (e) => {
        this.renderFiles(e.detail?.files || []);
        // Emit rendering completion event
        document.dispatchEvent(new CustomEvent('projectFilesRendered', {
          detail: { projectId: e.detail?.projectId }
        }));
      },
      { description: 'ProjectDetails_HandleFilesLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectArtifactsLoaded',
      (e) => {
        this.renderArtifacts(e.detail?.artifacts || []);
        // Emit rendering completion event
        document.dispatchEvent(new CustomEvent('projectArtifactsRendered', {
          detail: { projectId: e.detail?.projectId }
        }));
      },
      { description: 'ProjectDetails_HandleArtifactsLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectStatsLoaded',
      (e) => {
        this.renderStats(e.detail || {});
        // Emit rendering completion event
        document.dispatchEvent(new CustomEvent('projectStatsRendered', {
          detail: { projectId: e.detail?.projectId }
        }));
      },
      { description: 'ProjectDetails_HandleStatsLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectKnowledgeBaseLoaded',
      (e) => {
        if (this.knowledgeBaseComponent) {
          this.knowledgeBaseComponent.renderKnowledgeBaseInfo?.(e.detail?.knowledgeBase, e.detail?.projectId);
        }
        // Emit rendering completion event (even if component doesn't exist)
        document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
          detail: { projectId: e.detail?.projectId }
        }));
      },
      { description: 'ProjectDetails_HandleKnowledgeBaseLoaded' }
    );
    
    // Listen for the full project loading completion
    this.eventHandlers.trackListener(
      document,
      'projectDetailsFullyLoaded',
      (e) => {
        console.log(`[ProjectDetailsComponent] Project ${e.detail?.projectId} fully loaded, UI ready`);
        // Enable UI elements that were waiting for project load
        const newChatBtn = this.elements.container?.querySelector('#projectNewConversationBtn');
        if (newChatBtn) {
          newChatBtn.disabled = false;
          newChatBtn.classList.remove('btn-disabled');
        }
      },
      { description: 'ProjectDetails_FullyLoaded' }
    );
  }

  /**
   * Initialize sub-components like file uploading.
   * @private
   */
  _initializeSubComponents() {
    if (this.FileUploadComponentClass && !this.fileUploadComponent) {
      if (
        this.elements.fileInput && this.elements.uploadBtn &&
        this.elements.dragZone && this.elements.uploadProgress &&
        this.elements.progressBar && this.elements.uploadStatus
      ) {
        this.fileUploadComponent = new this.FileUploadComponentClass({
          fileInput: this.elements.fileInput,
          uploadBtn: this.elements.uploadBtn,
          dragZone: this.elements.dragZone,
          uploadProgress: this.elements.uploadProgress,
          progressBar: this.elements.progressBar,
          uploadStatus: this.elements.uploadStatus,
          projectManager: this.projectManager,
          app: this.app,
          eventHandlers: this.eventHandlers,
          onUploadComplete: () => {
            // Refresh files when upload completes
            if (this.state.currentProject?.id) {
              this.projectManager.loadProjectFiles(this.state.currentProject.id);
            }
          }
        });
        this.fileUploadComponent.initialize?.();
        console.log("[ProjectDetailsComponent] FileUploadComponent initialized.");
      } else {
        console.warn("[ProjectDetailsComponent] Could not init FileUploadComponent: Required DOM elements missing.");
      }
    } else if (!this.FileUploadComponentClass) {
      console.warn("[ProjectDetailsComponent] FileUploadComponentClass dependency not provided at all.");
    }
  }

  /* --------------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------------- */

  /**
   * Show the details container.
   */
  show() {
    if (!this.state.initialized || !this.elements.container) {
      console.error("[ProjectDetailsComponent] show() called but component not initialized or container missing.");
      return;
    }
    this.elements.container.classList.remove('hidden');
    this.elements.container.setAttribute('aria-hidden', 'false');
    console.log("[ProjectDetailsComponent] Shown.");
  }

  /**
   * Hide the details container.
   */
  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add('hidden');
      this.elements.container.setAttribute('aria-hidden', 'true');
      console.log("[ProjectDetailsComponent] Hidden.");
    }
  }

  /**
   * Update UI to reflect the currently loaded project details.
   * @param {Object} project - The project data object (must have .id).
   */
  renderProject(project) {
    if (!this.state.initialized) {
      console.error("[ProjectDetailsComponent] Cannot render project: Not initialized.");
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      console.error('[ProjectDetailsComponent] Invalid project data – cannot display details.');
      this.app.showNotification("Failed to load project details.", "error");
      this.onBack();
      return;
    }

    console.log(`[ProjectDetailsComponent] Rendering project ID: ${project.id}`);
    this.state.currentProject = project;

    // If file uploads exist, update them with the project ID
    if (this.fileUploadComponent) {
      this.fileUploadComponent.setProjectId?.(project.id);
    }

    this._updateProjectHeader(project);

    // Reset default tab or keep last state
    const defaultTab = 'details';
    this.switchTab(defaultTab);

    this.show();
  }

  /**
   * Switches to the chosen tab, e.g. "files", "conversations", "details", etc.
   * @param {string} tabName
   */
  switchTab(tabName) {
    if (!this.state.initialized) {
      console.warn("[ProjectDetailsComponent] switchTab called, but not initialized.");
      return;
    }

    const validTabs = ['details', 'files', 'knowledge', 'conversations', 'artifacts'];
    if (!validTabs.includes(tabName)) {
      console.warn(`[ProjectDetailsComponent] Invalid tab name: ${tabName}`);
      return;
    }

    const projectId = this.state.currentProject?.id || this.app.getProjectId?.();
    const requiresProject = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName);
    if (requiresProject && !this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot view this tab until a project is loaded.', 'warning');
      console.error(`[ProjectDetailsComponent] Invalid or missing projectId for tab: ${tabName}`);
      this.switchTab('details');
      return;
    }

    console.log(`[ProjectDetailsComponent] Switching tab to "${tabName}"`);
    this.state.activeTab = tabName;

    // Update tab button visual + ARIA
    const tabButtons = this.elements.tabContainer?.querySelectorAll('.project-tab-btn');
    tabButtons?.forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('tab-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Show/hide tab content
    Object.entries(this.elements.tabContents).forEach(([key, element]) => {
      if (!element) return;
      element.classList.toggle('hidden', key !== tabName);
    });

    // Possibly load data for the new tab
    this._loadTabContent(tabName);
  }

  /**
   * Render a project’s files in the UI.
   * @param {Array} files
   */
  renderFiles(files = []) {
    const container = this.elements.filesList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Files container not found.");
      return;
    }

    container.innerHTML = '';
    if (!files.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/60 max-w-full w-full">
          <p>No files uploaded yet.</p>
          <p class="text-sm mt-1">Drag & drop files or click "Upload".</p>
        </div>`;
      return;
    }

    files.forEach(file => {
      container.appendChild(this._createFileItemElement(file));
    });
  }

  /**
   * Render a project’s conversations.
   * @param {Array} conversations
   */
  renderConversations(conversations = []) {
    const container = this.elements.conversationsList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Conversations container not found.");
      return;
    }

    if (!this.state.currentProject) {
      container.innerHTML = `
        <div class="text-center py-8">
          <span class="loading loading-spinner loading-lg"></span>
        </div>`;
      return;
    }

    while (container.firstChild) container.removeChild(container.firstChild);
    if (!conversations.length) {
      container.innerHTML = `
        <div class="text-center py-8">
          <p>No conversations yet. Click "New Chat" to start one.</p>
        </div>`;
      return;
    }

    conversations.forEach(conv => container.appendChild(this._createConversationItemElement(conv)));
  }

  /**
   * Render a project’s artifacts.
   * @param {Array} artifacts
   */
  renderArtifacts(artifacts = []) {
    const container = this.elements.artifactsList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Artifacts container not found.");
      return;
    }

    container.innerHTML = '';
    if (!artifacts.length) {
      container.innerHTML = `<div class="py-8 text-center">No artifacts yet.</div>`;
      return;
    }

    artifacts.forEach(artifact => {
      container.appendChild(this._createArtifactItemElement(artifact));
    });
  }

  /**
   * Render project stats (simple example).
   * @param {Object} stats
   */
  renderStats(stats) {
    if (!this.state.initialized) return;
    const fileCountEl = this.elements.container.querySelector('[data-stat="fileCount"]');
    const convoCountEl = this.elements.container.querySelector('[data-stat="conversationCount"]');
    if (fileCountEl && stats.fileCount !== undefined) fileCountEl.textContent = stats.fileCount;
    if (convoCountEl && stats.conversationCount !== undefined) convoCountEl.textContent = stats.conversationCount;
    console.log("[ProjectDetailsComponent] Stats rendered:", stats);
  }

  /**
   * Create a new conversation for the current project.
   */
  async createNewConversation() {
    const projectId = this.state.currentProject?.id || this.app.getProjectId?.();
    if (!this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot create conversation: invalid project.', 'warning');
      return;
    }
    
    // Add timeout for projectLoadingInProgress check
    if (this.projectManager?.projectLoadingInProgress) {
      console.log('[ProjectDetailsComponent] Waiting for project loading to complete...');
      const startTime = Date.now();
      // Wait up to 5 seconds for loading to complete
      while (this.projectManager.projectLoadingInProgress && Date.now() - startTime < 5000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Force proceed after timeout
      if (this.projectManager.projectLoadingInProgress) {
        console.warn('[ProjectDetailsComponent] Force proceeding with conversation creation despite projectLoadingInProgress flag');
        // Force reset the flag to prevent deadlocks
        this.projectManager.projectLoadingInProgress = false;
      }
    }
    
    try {
      console.log(`[ProjectDetailsComponent] Creating new conversation for project ${projectId}`);
      const convo = await this.projectManager.createConversation(projectId);
      
      if (convo && convo.id) {
        console.log(`[ProjectDetailsComponent] New conversation created: ${convo.id}`);
        this.app.showNotification(`Conversation "${convo.title || 'Untitled'}" created.`, 'success');
        this.switchTab('conversations');
        this.projectManager.loadProjectConversations(projectId);
      } else {
        throw new Error("Received invalid response from createConversation.");
      }
    } catch (err) {
      console.error('[ProjectDetailsComponent] Failed to create conversation:', err);
      this.app.showNotification(`Failed to create conversation: ${err.message}`, 'error');
    }
  }

  /**
   * Cleanup event listeners and references.
   */
  destroy() {
    console.log("[ProjectDetailsComponent] Destroying...");
    if (this.eventHandlers?.cleanupListeners) {
      this.eventHandlers.cleanupListeners(this.elements.container, null, null);
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleConversationsLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleFilesLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleArtifactsLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleStatsLoaded');
    }
    this.elements = {};
    this.state = { initialized: false, currentProject: null, activeTab: 'details', isLoading: {} };
    this.fileUploadComponent = null;
    this.knowledgeBaseComponent = null;
    console.log("[ProjectDetailsComponent] Destroyed.");
  }

  /* --------------------------------------------------------------------------
   * Private Methods
   * ------------------------------------------------------------------------- */

  /** Update the project title and description displays. */
  _updateProjectHeader(project) {
    if (this.elements.title) {
      this.elements.title.textContent = project?.title || project?.name || 'Untitled Project';
    }
    if (this.elements.description) {
      this.elements.description.textContent = project?.description || '';
    }
  }

  /** Lazy-load content for a tab on activation. */
  _loadTabContent(tabName) {
    const projectId = this.state.currentProject?.id || this.app.getProjectId?.();
    // Some tabs require project data
    const needsProject = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName);

    if (needsProject && !this.app.validateUUID(projectId)) {
      // Possibly show spinner or fallback instead
      return;
    }

    // If knowledge base component is injected
    if (this.knowledgeBaseComponent) {
      if (tabName === 'knowledge') {
        const kbData = this.state.currentProject?.knowledge_base || null;
        // Don't await knowledge base initialization - it can happen asynchronously
        // This prevents it from blocking the rest of the tab loading
        this.knowledgeBaseComponent.initialize(true, kbData, projectId)
          .catch(e => console.error("[ProjectDetailsComponent] KB init failed:", e));
      } else {
        // Don't await hiding the knowledge base either
        this.knowledgeBaseComponent.initialize(false)
          .catch(e => console.error("[ProjectDetailsComponent] KB de-init failed:", e));
      }
    }

    switch (tabName) {
      case 'files':
        // Show spinner, call manager, hide spinner afterward
        this._withLoading('files', () => this.projectManager.loadProjectFiles(projectId));
        break;
      case 'conversations':
        // Handle model config rendering asynchronously
        if (this.modelConfig?.renderQuickConfig) {
          const panel = document.getElementById('modelConfigPanel');
          if (panel) {
            // Use setTimeout to prevent blocking the UI thread
            setTimeout(() => {
              try {
                console.log("[ProjectDetailsComponent] Rendering model config panel");
                this.modelConfig.renderQuickConfig(panel);
              } catch (error) {
                console.error("[ProjectDetailsComponent] Error rendering model config:", error);
              }
              
              // Emit rendering event for the model config panel, even if there was an error
              document.dispatchEvent(new CustomEvent('modelConfigRendered', {
                detail: { projectId }
              }));
            }, 0);
          }
        }
        this._withLoading('conversations', () => this.projectManager.loadProjectConversations(projectId));
        break;
      case 'artifacts':
        this._withLoading('artifacts', () => this.projectManager.loadProjectArtifacts(projectId));
        break;
      case 'knowledge':
        // already handled above
        break;
      case 'details':
        // Possibly load stats
        this._withLoading('stats', () => this.projectManager.loadProjectStats(projectId));
        break;
      default:
        // No further action
        break;
    }
  }

  /** Helper wrapper to show/hide a loading indicator while performing an async call. */
  async _withLoading(section, asyncFn) {
    if (this.state.isLoading[section]) return;
    this.state.isLoading[section] = true;
    this._toggleLoadingIndicator(section, true);

    try {
      await asyncFn();
    } catch (err) {
      console.error(`[ProjectDetailsComponent] Error loading ${section}:`, err);
      this.app.showNotification(`Failed to load ${section}: ${err.message}`, 'error');
    } finally {
      this.state.isLoading[section] = false;
      this._toggleLoadingIndicator(section, false);
    }
  }

  _toggleLoadingIndicator(section, show) {
    const indicator = this.elements.loadingIndicators[section];
    if (indicator) {
      indicator.classList.toggle('hidden', !show);
    }
  }

  /** Creates a file list item DOM element. */
  _createFileItemElement(file) {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-sm hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.fileId = file.id;

    const formatBytes = this.app?.formatBytes || (b => `${b} Bytes`);
    const formatDate = this.app?.formatDate || (d => new Date(d).toLocaleDateString());
    const fileIcon = this.app?.getFileTypeIcon?.(file.file_type) || '📄';

    item.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl text-primary">${fileIcon}</span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${file.filename}">${file.filename}</div>
          <div class="text-xs text-base-content/70">
            ${formatBytes(file.file_size)} · ${formatDate(file.created_at)}
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-xs btn-square text-info hover:bg-info/10 data-download-btn" title="Download file">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
               viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 16v1a3 3 0
                     003 3h10a3 3 0
                     003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
        </button>
        <button class="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10 data-delete-btn" title="Delete file">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
               viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0
                     0116.138 21H7.862a2 2 0
                     01-1.995-1.858L5 7m5 4v6m4-6v6"/>
          </svg>
        </button>
      </div>
    `;

    const downloadBtn = item.querySelector('.data-download-btn');
    const deleteBtn = item.querySelector('.data-delete-btn');
    if (downloadBtn) {
      this.eventHandlers.trackListener(downloadBtn, 'click', () => {
        this._downloadFile(file.id, file.filename);
      }, { description: `DownloadFile_${file.id}` });
    }
    if (deleteBtn) {
      this.eventHandlers.trackListener(deleteBtn, 'click', () => {
        this._confirmDeleteFile(file.id, file.filename);
      }, { description: `DeleteFile_${file.id}` });
    }
    return item;
  }

  /** Confirms and deletes a file belonging to the current project. */
  _confirmDeleteFile(fileId, fileName) {
    const projectId = this.state.currentProject?.id || this.app.getProjectId?.();
    if (!this.app.validateUUID(projectId) || !fileId) {
      console.error(`[ProjectDetailsComponent] Cannot delete file: invalid project or file ID.`, { projectId, fileId });
      return;
    }
    const displayName = fileName || `file id ${fileId}`;
    this.modalManager.confirmAction({
      title: 'Delete File',
      message: `Are you sure you want to delete "${displayName}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmClass: 'btn-error',
      onConfirm: async () => {
        try {
          console.log(`[ProjectDetailsComponent] Deleting file ${fileId} from project ${projectId}`);
          await this.projectManager.deleteFile?.(projectId, fileId);
          this.app.showNotification('File deleted successfully.', 'success');
          this.projectManager.loadProjectFiles(projectId);
        } catch (err) {
          console.error(`[ProjectDetailsComponent] Failed to delete file: ${fileId}`, err);
          this.app.showNotification(`Failed to delete file: ${err.message}`, 'error');
        }
      },
      onCancel: () => {
        console.log(`[ProjectDetailsComponent] Canceled deletion of file ${fileId}`);
      }
    });
  }

  /** Downloads a file. */
  _downloadFile(fileId, fileName) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId) || !fileId) {
      console.error("[ProjectDetailsComponent] Invalid project or file ID for download.", { projectId, fileId });
      return;
    }
    if (!this.projectManager.downloadFile) {
      console.error("[ProjectDetailsComponent] projectManager.downloadFile not implemented.");
      return;
    }
    this.projectManager.downloadFile(projectId, fileId)
      .catch(e => {
        console.error("[ProjectDetailsComponent] File download failed:", e);
        this.app.showNotification(`Download failed: ${e.message}`, 'error');
      });
  }

  /** Creates a DOM item for a conversation. */
  _createConversationItemElement(convo) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.conversationId = convo.id;

    const formatDate = this.app?.formatDate || (d => new Date(d).toLocaleDateString());

    item.innerHTML = `
      <h4 class="font-medium truncate mb-1">${convo.title || 'Untitled conversation'}</h4>
      <p class="text-sm text-base-content/70 truncate">${convo.last_message || 'No messages yet'}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${formatDate(convo.updated_at)}</span>
        <span class="badge badge-ghost badge-sm">${convo.message_count || 0} msgs</span>
      </div>
    `;

    this.eventHandlers.trackListener(item, 'click', () => {
      this._handleConversationClick(convo);
    }, { description: `OpenConversation_${convo.id}` });
    return item;
  }

  /** Fires when a conversation item is clicked, navigates to chat. */
  async _handleConversationClick(conversation) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId) || !conversation?.id) {
      console.error("[ProjectDetailsComponent] Conversation click while projectId invalid", {
        currentProject: this.state.currentProject,
        conversation
      });
      this.app.showNotification('Cannot load conversation: invalid project or conversation ID.', 'error');
      return;
    }

    // Check if project is fully loaded
    const projectManager = this.projectManager;
    if (projectManager?.projectLoadingInProgress) {
      this.app.showNotification("Please wait for project details to load first.", "warning");
      return;
    }

    // Update URL param for chatId
    const url = new URL(window.location.href);
    url.searchParams.set('chatId', conversation.id);
    window.history.pushState({ conversationId: conversation.id }, '', url.toString());

    // Could initialize or update your Chat UI here
    // e.g. chatManager.initializeIfNeeded({ projectId, conversationId: conversation.id });
    console.log(`[ProjectDetailsComponent] Conversation clicked. ID: ${conversation.id}`);
  }

  /** Creates a DOM item for an artifact. */
  _createArtifactItemElement(artifact) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.artifactId = artifact.id;

    const formatDate = this.app?.formatDate || (d => new Date(d).toLocaleDateString());

    item.innerHTML = `
      <div class="flex justify-between items-center">
        <h4 class="font-medium truncate">${artifact.name || 'Untitled Artifact'}</h4>
        <span class="text-xs text-base-content/60">${formatDate(artifact.created_at)}</span>
      </div>
      <p class="text-sm text-base-content/70 truncate mt-1">
        ${artifact.description || artifact.type || 'No description'}
      </p>
      <div class="mt-2 flex gap-2">
        <button
          class="btn btn-xs btn-outline min-w-[44px] min-h-[44px] data-download-artifact-btn"
          aria-label="Download artifact">
          Download
        </button>
      </div>
    `;

    const downloadBtn = item.querySelector('.data-download-artifact-btn');
    if (downloadBtn) {
      this.eventHandlers.trackListener(downloadBtn, 'click', () => {
        if (this.projectManager?.downloadArtifact) {
          this.projectManager.downloadArtifact(this.state.currentProject.id, artifact.id)
            .catch(e => {
              console.error("[ProjectDetailsComponent] Artifact download failed:", e);
              this.app.showNotification(`Download failed: ${e.message}`, 'error');
            });
        } else {
          console.error("[ProjectDetailsComponent] projectManager.downloadArtifact not provided.");
        }
      }, { description: `DownloadArtifact_${artifact.id}` });
    }
    return item;
  }
}

export function createProjectDetailsComponent(options) {
  return new ProjectDetailsComponent(options);
}

export default createProjectDetailsComponent;

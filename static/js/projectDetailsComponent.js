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
 * - FileUploadComponentClass: Class/factory for file upload (needs relevant DOM nodes)
 * - modalManager: Manages modal dialogs, including confirmation
 * - knowledgeBaseComponent: (Optional) Instance of the injected knowledge base UI logic
 * - onBack: (Optional) Back navigation callback
 */

class ProjectDetailsComponent {
  /**
   * ProjectDetailsComponent constructor.
   * All dependencies *must* be passed as options.
   * @param {Object} options - See above for required and optional fields.
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

    // --- Internal State ---
    this.state = {
      currentProject: null,
      activeTab: 'details', // Default tab
      isLoading: {},
      initialized: false
    };

    this.fileConstants = {
      allowedExtensions: [
        '.txt', '.md', '.csv', '.json',
        '.pdf', '.doc', '.docx', '.py',
        '.js', '.html', '.css', '.jpg',
        '.jpeg', '.png', '.gif', '.zip'
      ],
      maxSizeMB: 30
    };

    this.elements = {
      container: null, title: null, description: null, backBtn: null,
      tabContainer: null, filesList: null, conversationsList: null,
      artifactsList: null, tabContents: {}, loadingIndicators: {},
      fileInput: null, uploadBtn: null, dragZone: null,
      uploadProgress: null, progressBar: null, uploadStatus: null
    };

    this.fileUploadComponent = null;
    // Inject or resolve modelConfig for dynamic config panel
    this.modelConfig = options.modelConfig || (typeof DependencySystem !== 'undefined' && DependencySystem?.modules?.get?.('modelConfig'));
    if (!this.modelConfig) {
      console.warn('[ProjectDetailsComponent] modelConfig dependency not found or not injected. Chat model config panel will NOT render.');
    }
  }

  /**
   * Initialize the component. Finds elements and binds core event listeners.
   * @returns {Promise<boolean>} - True if successful, false otherwise.
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

  /**
   * Finds all necessary DOM elements under the #projectDetailsView container.
   * @private
   * @returns {boolean} True if required elements exist, false otherwise.
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

    // Tab content sections
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

    // File upload elements
    this.elements.fileInput = this.elements.container.querySelector('#fileInput');
    this.elements.uploadBtn = this.elements.container.querySelector('#uploadFileBtn');
    this.elements.dragZone = this.elements.container.querySelector('#dragDropZone');
    this.elements.uploadProgress = this.elements.container.querySelector('#filesUploadProgress');
    this.elements.progressBar = this.elements.container.querySelector('#fileProgressBar');
    this.elements.uploadStatus = this.elements.container.querySelector('#uploadStatus');

    return !!(this.elements.title && this.elements.backBtn && this.elements.tabContainer);
  }

  /**
   * Bind the core DOM/event listeners using the injected eventHandlers.
   * @private
   */
  _bindCoreEvents() {
    if (!this.eventHandlers) {
      console.error("[ProjectDetailsComponent] eventHandlers dependency missing, cannot bind events.");
      return;
    }

    // Back button click
    if (this.elements.backBtn) {
      this.eventHandlers.cleanupListeners(this.elements.backBtn, 'click');
      this.eventHandlers.trackListener(
        this.elements.backBtn,
        'click',
        (e) => {
          console.log('[ProjectDetailsComponent] Back button clicked, triggering onBack');
          this.onBack(e);
        },
        { description: 'ProjectDetailsBack' }
      );
    }

    // Tab switching
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

    // New conversation button
    const newChatBtn = this.elements.container?.querySelector('#projectNewConversationBtn');
    if (newChatBtn) {
      this.eventHandlers.cleanupListeners(newChatBtn, 'click');
      this.eventHandlers.trackListener(
        newChatBtn,
        'click',
        () => {
          if (this.state.currentProject?.id) {
            this.createNewConversation();
          } else {
            this.app.showNotification("Please wait for project details to load.", "warning");
          }
        },
        { description: 'ProjectNewConversation' }
      );
    }

    // Listen for global project data events and re-render
    this.eventHandlers.trackListener(
      document,
      'projectConversationsLoaded',
      (e) => this.renderConversations(e.detail?.conversations || []),
      { description: 'ProjectDetails_HandleConversationsLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectFilesLoaded',
      (e) => this.renderFiles(e.detail?.files || []),
      { description: 'ProjectDetails_HandleFilesLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectArtifactsLoaded',
      (e) => this.renderArtifacts(e.detail?.artifacts || []),
      { description: 'ProjectDetails_HandleArtifactsLoaded' }
    );
    this.eventHandlers.trackListener(
      document,
      'projectStatsLoaded',
      (e) => this.renderStats(e.detail || {}),
      { description: 'ProjectDetails_HandleStatsLoaded' }
    );
  }

  /**
   * Initialize sub-components such as the FileUploadComponent.
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
            if (this.state.currentProject?.id) {
              this.projectManager.loadProjectFiles(this.state.currentProject.id);
            }
          }
        });
        this.fileUploadComponent.initialize?.();
        console.log("[ProjectDetailsComponent] FileUploadComponent initialized.");
      } else {
        console.warn("[ProjectDetailsComponent] Could not initialize FileUploadComponent: Required DOM elements missing.");
      }
    } else if (!this.FileUploadComponentClass) {
      console.warn("[ProjectDetailsComponent] FileUploadComponentClass dependency not provided.");
    }
  }

  /* =========================================================================
   * PUBLIC METHODS (same as in previous fully-fleshed DI version)
   * ========================================================================= */

  /**
   * Makes the component visible. Assumes initialize() was called successfully.
   */
  show() {
    if (!this.state.initialized || !this.elements.container) {
      console.error("[ProjectDetailsComponent] Cannot show: Not initialized or container missing.");
      return;
    }
    this.elements.container.classList.remove('hidden');
    this.elements.container.setAttribute('aria-hidden', 'false');
    console.log("[ProjectDetailsComponent] Shown.");
  }

  /**
   * Hides the component.
   */
  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add('hidden');
      this.elements.container.setAttribute('aria-hidden', 'true');
      console.log("[ProjectDetailsComponent] Hidden.");
    }
  }

  /**
   * Renders the details for the given project.
   * @param {Object} project - Project data object from projectManager.
   */
  renderProject(project) {
    if (!this.state.initialized) {
      console.error("[ProjectDetailsComponent] Cannot render project: Component not initialized.");
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      console.error('[ProjectDetailsComponent] Invalid project data received for rendering.');
      this.app.showNotification("Failed to load project details.", "error");
      this.onBack();
      return;
    }

    console.log(`[ProjectDetailsComponent] Rendering project: ${project.id}`);
    this.state.currentProject = project;

    // Update file upload component with current project ID, if present
    if (this.fileUploadComponent) {
      this.fileUploadComponent.setProjectId?.(project.id);
    }

    this._updateProjectHeader(project);

    // Default tab can be changed as desired
    const defaultTab = 'details';
    this.switchTab(defaultTab);

    this.show();
  }

  /**
   * Switches the active tab in the details view.
   * @param {string} tabName - The name of the tab to switch to
   */
  switchTab(tabName) {
    if (!this.state.initialized) {
      console.warn("[ProjectDetailsComponent] Cannot switch tab: Not initialized.");
      return;
    }
    const validTabs = ['details', 'files', 'knowledge', 'conversations', 'artifacts'];
    if (!validTabs.includes(tabName)) {
      console.warn(`[ProjectDetailsComponent] Invalid tab name requested: ${tabName}`);
      return;
    }

    const projectId = this.state.currentProject?.id;
    const requiresProject = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName);

    if (requiresProject && !this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot view this tab until a project is fully loaded.', 'warning');
      console.error("[ProjectDetailsComponent] Refusing to show tab due to invalid projectId", { tabName, projectId });
      this.switchTab('details');
      return;
    }

    console.log(`[ProjectDetailsComponent] Switching tab to: ${tabName}`);
    this.state.activeTab = tabName;

    // Update tab button states (ARIA and visual)
    const tabButtons = this.elements.tabContainer?.querySelectorAll('.project-tab-btn');
    tabButtons?.forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('tab-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      // Additional styling
      btn.classList.add('min-w-[44px]', 'min-h-[44px]', 'px-3');
    });

    // Update visibility of tab content panels
    // Remove any chat-only content logic; just handle tabContents for validTabs
    Object.entries(this.elements.tabContents).forEach(([key, element]) => {
      if (element && validTabs.includes(key)) {
        element.classList.toggle('hidden', key !== tabName);
      }
    });

    // Load content for the activated tab
    this._loadTabContent(tabName);
  }

  /**
   * Renders the list of files for the current project.
   * @param {Array} files - Array of file objects
   */
  renderFiles(files = []) {
    const container = this.elements.filesList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Files list container not found.");
      return;
    }

    container.innerHTML = ''; // Clear previous content

    if (!files.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/60 max-w-full w-full">
          <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                   d="M9 13h6m-3-3v6m-9 1V7a2 2 0
                      012-2h6l2 2h6a2 2 0
                      012 2v8a2 2 0
                      01-2 2H5a2 2 0
                      01-2-2z"/>
          </svg>
          <p class="mt-2">No files uploaded yet.</p>
          <p class="text-sm mt-1">Drag & drop files or use the upload button.</p>
        </div>`;
      return;
    }

    files.forEach(file => {
      try {
        const fileItem = this._createFileItemElement(file);
        container.appendChild(fileItem);
      } catch (e) {
        console.error(`[ProjectDetailsComponent] Failed to create list item for file ${file.id || file.filename}:`, e);
      }
    });
  }

  /**
   * Renders the list of conversations for the current project.
   * @param {Array} conversations - Array of conversation objects.
   */
  renderConversations(conversations = []) {
    const container = this.elements.conversationsList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Conversations list container not found.");
      return;
    }

    // Fix: ONLY reset the list (children), never touch parentNode or other containers above it!
    while (container.firstChild) container.removeChild(container.firstChild);

    if (!conversations.length) {
      container.appendChild(Object.assign(document.createElement('div'), {
        className: "text-center py-8 text-base-content/60 max-w-full w-full",
        innerHTML: `<p>No conversations yet.</p><p class="text-sm mt-1">Click 'New Chat' to start.</p>`
      }));
      return;
    }

    conversations.forEach(conversation => {
      try {
        const item = this._createConversationItemElement(conversation);
        container.appendChild(item);
      } catch (e) {
        console.error(`[ProjectDetailsComponent] Failed to create list item for conversation ${conversation.id}:`, e);
      }
    });
  }

  /**
   * Renders the list of artifacts for the current project.
   * @param {Array} artifacts - Array of artifact objects.
   */
  renderArtifacts(artifacts = []) {
    const container = this.elements.artifactsList;
    if (!container) {
      console.warn("[ProjectDetailsComponent] Artifacts list container not found.");
      return;
    }

    container.innerHTML = ''; // Clear previous content

    if (!artifacts.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/60 max-w-full w-full">
          <p>No artifacts generated yet.</p>
        </div>`;
      return;
    }

    artifacts.forEach(artifact => {
      try {
        const artifactItem = this._createArtifactItemElement(artifact);
        container.appendChild(artifactItem);
      } catch (e) {
        console.error(`[ProjectDetailsComponent] Failed to create list item for artifact ${artifact.id}:`, e);
      }
    });
  }

  /**
   * Renders project statistics (example implementation).
   * @param {Object} stats - Stats object from projectManager.
   */
  renderStats(stats) {
    if (!this.state.initialized || !stats) return;
    const fileCountEl = this.elements.container.querySelector('[data-stat="fileCount"]');
    const convoCountEl = this.elements.container.querySelector('[data-stat="conversationCount"]');
    // Additional stat fields as needed
    if (fileCountEl && stats.fileCount !== undefined) fileCountEl.textContent = stats.fileCount;
    if (convoCountEl && stats.conversationCount !== undefined) convoCountEl.textContent = stats.conversationCount;
    console.log("[ProjectDetailsComponent] Stats rendered:", stats);
  }

  /**
   * Initiates creation of a new conversation.
   */
  async createNewConversation() {
    if (!this.state.initialized) return;
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot create conversation: Project not fully loaded.', 'warning');
      return;
    }

    console.log(`[ProjectDetailsComponent] Requesting new conversation for project ${projectId}`);
    try {
      const conversation = await this.projectManager.createConversation(projectId);
      if (conversation && conversation.id) {
        this.app.showNotification(`Conversation '${conversation.title || 'Default'}' created.`, 'success');
        this.switchTab('conversations');
        this.projectManager.loadProjectConversations(projectId);
      } else {
        throw new Error("Received invalid response from createConversation.");
      }
    } catch (error) {
      console.error('[ProjectDetailsComponent] Error creating new conversation:', error);
      this.app.showNotification(`Failed to create conversation: ${error.message}`, 'error');
    }
  }

  /**
   * Cleans up resources/listeners used by the component.
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

    // Nullify references
    this.elements = {};
    this.state = { initialized: false, currentProject: null, activeTab: 'details', isLoading: {} };
    this.fileUploadComponent = null;
    this.knowledgeBaseComponent = null;
    console.log("[ProjectDetailsComponent] Destroyed.");
  }

  /* =========================================================================
   * PRIVATE METHODS (same logic as previous version)
   * ========================================================================= */

  /** Updates the project title and description elements. */
  _updateProjectHeader(project) {
    if (this.elements.title) this.elements.title.textContent = project?.title || project?.name || 'Untitled Project';
    if (this.elements.description) this.elements.description.textContent = project?.description || '';
  }

  /** Loads tab-specific content. */
  _loadTabContent(tabName) {
    const projectId = this.state.currentProject?.id;
    const needsProject = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName);

    if (needsProject && !this.app.validateUUID(projectId)) {
      // If project is still loading, show spinner instead of error or fallback
      if (!this.state.currentProject) {
        this._toggleLoadingIndicator(tabName, true);
        setTimeout(() => this._toggleLoadingIndicator(tabName, false), 2000); // hide after fallback time
        return;
      }
      // If we have some currentProject object but ID is invalid, show error/fallback
      this.app.showNotification('Cannot view this tab until a project is fully loaded.', 'warning');
      console.error("[ProjectDetailsComponent] Refusing to show tab due to invalid projectId", { tabName, projectId });
      this.switchTab('details');
      return;
    }

    console.log(`[ProjectDetailsComponent] Loading content for tab: ${tabName}`);

    // If knowledge base provided
    if (this.knowledgeBaseComponent) {
      if (tabName === 'knowledge') {
        const kbData = this.state.currentProject?.knowledge_base || null;
        this.knowledgeBaseComponent.initialize(true, kbData, projectId)
          .catch(e => console.error("Failed to initialize KB component:", e));
      } else {
        this.knowledgeBaseComponent.initialize(false)
          .catch(e => console.error("Failed to de-initialize KB component:", e));
      }
    }

    switch (tabName) {
      case 'files':
        this._withLoading('files', () => this.projectManager.loadProjectFiles(projectId));
        break;
      case 'conversations': {
        // Render/refresh model config quick settings panel
        if (this.modelConfig && typeof this.modelConfig.renderQuickConfig === 'function') {
          const panel = document.getElementById('modelConfigPanel');
          this.modelConfig.renderQuickConfig(panel);
        }
        this._withLoading('conversations', () => this.projectManager.loadProjectConversations(projectId));
        break;
      }
      case 'artifacts':
        this._withLoading('artifacts', () => this.projectManager.loadProjectArtifacts(projectId));
        break;
      case 'knowledge':
        // KB content loading is handled above
        break;
      // No more 'chat' case, chat UI is managed with conversations tab.
      case 'details':
        // Possibly load stats or other details
        this._withLoading('stats', () => this.projectManager.loadProjectStats(projectId));
        break;
      default:
        /* No additional actions */
        break;
    }
  }

  /** Initializes or updates the main chat UI. */
  async _initializeOrUpdateChatUI(conversationId = null) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId)) {
      this.app.showNotification('Chat could not start because the project ID is invalid.', 'error');
      console.error('[ProjectDetailsComponent] Invalid project ID. Cannot proceed with chat initialization.');
      this._disableChatUI("No valid project selected");
      return;
    }

    try {
      const chatManager = this.projectManager?.chatManager || this.app?.chatManager;
      if (!chatManager) {
        console.error("[ProjectDetailsComponent] chatManager not found. Please ensure it is provided.");
        this.app.showNotification("Chat Manager missing. Please check your configuration.", "error");
        this._disableChatUI("Chat manager missing. Please check your configuration.");
        return;
      }

      console.log('[ProjectDetailsComponent] Preparing chat UI for project:', projectId);
      const chatInitOpts = {
        projectId,
        containerSelector: '#projectChatContainer',
        messageContainerSelector: '#projectChatMessages',
        inputSelector: '#projectChatInput',
        sendButtonSelector: '#projectChatSendBtn',
        titleSelector: '#chatTitle'
      };

      // Initialise only if not already, or project switched
      if (!chatManager.isInitialized || chatManager.projectId !== projectId) {
        await chatManager.initialize(chatInitOpts);
        chatManager.projectId = projectId; // keep DI in sync
      } else {
        // Already ready – ensure UI elements are visible/bound
        if (typeof chatManager.showUI === 'function') {
          chatManager.showUI({ projectId });
        }
      }

      // Determine which conversation to load
      let targetConversationId = conversationId;
      if (!targetConversationId) {
        const urlParams = new URLSearchParams(window.location.search);
        targetConversationId = urlParams.get('chatId');
      }

      if (targetConversationId && chatManager.currentConversationId !== targetConversationId) {
        console.log(`[ProjectDetailsComponent] Loading conversation ${targetConversationId} (from click or URL).`);
        await chatManager.loadConversation(targetConversationId);
      } else if (!chatManager.currentConversationId) {
        const conversations = await this.projectManager.loadProjectConversations(projectId);
        if (conversations && conversations.length > 0) {
          console.log(`[ProjectDetailsComponent] Loading first conversation: ${conversations[0].id}`);
          chatManager.projectId = projectId;
          await chatManager.loadConversation(conversations[0].id);
        } else {
          this.app.showNotification("No existing conversations. You can start a new one from the 'Conversations' tab.", "info");
        }
      } else {
        if (typeof chatManager.showUI === 'function') {
          chatManager.showUI({ projectId });
        } else {
          // Always force show the chat container in conversations tab
          const chatContainerEl = document.getElementById('projectChatContainer');
          if (chatContainerEl) {
            chatContainerEl.classList.remove('hidden');
            chatContainerEl.style.display = 'block';
          }
        }
      }
      this._enableChatUI();
    } catch (error) {
      this._disableChatUI(`Failed to initialize chat: ${error.message || error}`);
      console.error('[ProjectDetailsComponent] Failed to initialize/update chat UI:', error);
      this.app.showNotification('Failed to initialize chat', 'error');
    }
  }

  /** Disables chat input/send button with a reason. */
  _disableChatUI(reason = "") {
    const sendBtn = this.elements.container?.querySelector("#projectChatSendBtn");
    const input = this.elements.container?.querySelector("#projectChatInput");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.title = reason || "Chat is unavailable"; }
    if (input) { input.disabled = true; input.placeholder = reason || "Chat unavailable"; }
  }

  /** Enables chat input/send button. */
  _enableChatUI() {
    const sendBtn = this.elements.container?.querySelector("#projectChatSendBtn");
    const input = this.elements.container?.querySelector("#projectChatInput");
    if (sendBtn) sendBtn.disabled = false;
    if (input) { input.disabled = false; input.placeholder = "Type your message..."; }
  }

  /** Helper to load data with a loading indicator. */
  async _withLoading(section, asyncFn) {
    if (this.state.isLoading[section]) {
      console.warn(`[ProjectDetailsComponent] Loading already in progress for section: ${section}`);
      return;
    }

    this.state.isLoading[section] = true;
    this._toggleLoadingIndicator(section, true);

    try {
      return await asyncFn();
    } catch (error) {
      console.error(`[ProjectDetailsComponent] Error loading ${section}:`, error);
      this.app.showNotification(`Failed to load ${section}: ${error.message}`, 'error');
    } finally {
      this.state.isLoading[section] = false;
      this._toggleLoadingIndicator(section, false);
    }
  }

  /** Toggles visibility of a loading indicator for a specific section. */
  _toggleLoadingIndicator(section, show) {
    const indicator = this.elements.loadingIndicators[section];
    if (indicator) {
      indicator.classList.toggle('hidden', !show);
    }
  }

  /** Confirms and deletes a file. */
  _confirmDeleteFile(fileId, fileName) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId) || !fileId) {
      console.error("[ProjectDetailsComponent] Cannot delete file: Invalid project or file ID.");
      return;
    }

    const safeFileName = fileName || `file ID ${fileId}`;
    this.modalManager.confirmAction({
      title: 'Delete File',
      message: `Are you sure you want to delete "${safeFileName}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmClass: 'btn-error',
      onConfirm: async () => {
        console.log(`[ProjectDetailsComponent] Deleting file ${fileId} from project ${projectId}`);
        try {
          await this.projectManager.deleteFile(projectId, fileId);
          this.app.showNotification('File deleted successfully', 'success');
          this.projectManager.loadProjectFiles(projectId);
        } catch (error) {
          console.error(`[ProjectDetailsComponent] Failed to delete file ${fileId}:`, error);
          this.app.showNotification(`Failed to delete file: ${error.message}`, 'error');
        }
      },
      onCancel: () => {
        console.log(`[ProjectDetailsComponent] File deletion cancelled for ${fileId}.`);
      }
    });
  }

  /** Creates the DOM element for a single file item. */
  _createFileItemElement(file) {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-sm hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.fileId = file.id;

    const formatBytes = this.app?.formatBytes || ((b) => `${b} Bytes`);
    const formatDate = this.app?.formatDate || ((d) => new Date(d).toLocaleDateString());
    const getFileIcon = this.app?.getFileTypeIcon || (() => '📄');

    item.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}">
          ${getFileIcon(file.file_type)}
        </span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${file.filename}">${file.filename}</div>
          <div class="text-xs text-base-content/70">
            ${formatBytes(file.file_size)} · ${formatDate(file.created_at)}
          </div>
          ${file.metadata?.search_processing
        ? this._createProcessingBadge(file.metadata.search_processing.status)
        : ''
      }
        </div>
      </div>
      <div class="flex gap-1">
        <button
          class="btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] text-info hover:bg-info/10 data-download-btn"
          title="Download file" aria-label="Download file">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
               viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0
                     003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
        </button>
        <button
          class="btn btn-ghost btn-xs btn-square min-w-[44px] min-h-[44px] text-error hover:bg-error/10 data-delete-btn"
          title="Delete file" aria-label="Delete file">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
               viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0
                     0116.138 21H7.862a2 2 0
                     01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0
                     00-1-1h-4a1 1 0
                     00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    `;

    // File-level event bindings
    const downloadBtn = item.querySelector('.data-download-btn');
    const deleteBtn = item.querySelector('.data-delete-btn');

    if (downloadBtn) {
      this.eventHandlers.trackListener(downloadBtn, 'click', () => {
        if (this.projectManager?.downloadFile) {
          this.projectManager.downloadFile(this.state.currentProject.id, file.id)
            .catch(e => { this.app.showNotification(`Download failed: ${e.message}`, 'error'); });
        } else {
          console.error("projectManager.downloadFile not available.");
        }
      }, { description: `DownloadFile_${file.id}` });
    }

    if (deleteBtn) {
      this.eventHandlers.trackListener(deleteBtn, 'click', () => {
        this._confirmDeleteFile(file.id, file.filename);
      }, { description: `DeleteFile_${file.id}` });
    }

    return item;
  }

  /** Generates a small processing status badge for a file. */
  _createProcessingBadge(status) {
    const badgeClass =
      status === 'success' ? 'badge-success' :
        status === 'error' ? 'badge-error' :
          status === 'pending' ? 'badge-warning' : 'badge-ghost';
    const badgeText =
      status === 'success' ? 'Ready' :
        status === 'error' ? 'Failed' :
          status === 'pending' ? 'Processing...' : 'Not Processed';
    return `<span class="badge ${badgeClass} badge-sm mt-1">${badgeText}</span>`;
  }

  /** Creates the DOM element for a single conversation. */
  _createConversationItemElement(conversation) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.conversationId = conversation.id;

    const formatDate = this.app?.formatDate || ((d) => new Date(d).toLocaleDateString());

    item.innerHTML = `
      <h4 class="font-medium truncate mb-1">${conversation.title || 'Untitled conversation'}</h4>
      <p class="text-sm text-base-content/70 truncate">${conversation.last_message || 'No messages yet'}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${formatDate(conversation.updated_at)}</span>
        <span class="badge badge-ghost badge-sm">${conversation.message_count || 0} msgs</span>
      </div>
    `;

    // Click to load conversation
    this.eventHandlers.trackListener(item, 'click', () => this._handleConversationClick(conversation), {
      description: `ViewConversation_${conversation.id}`
    });

    return item;
  }

  /** Creates the DOM element for a single artifact. */
  _createArtifactItemElement(artifact) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto';
    item.dataset.artifactId = artifact.id;

    const formatDate = this.app?.formatDate || ((d) => new Date(d).toLocaleDateString());

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
            .catch(e => { this.app.showNotification(`Download failed: ${e.message}`, 'error'); });
        } else {
          console.error("projectManager.downloadArtifact not available.");
        }
      }, { description: `DownloadArtifact_${artifact.id}` });
    }

    return item;
  }

  /** Handles clicking on a conversation to switch to chat. */
  async _handleConversationClick(conversation) {
    // Always re-acquire active project ID/state
    let projectId = this.state.currentProject?.id || this.projectManager?.currentProject?.id;

    // Attempt to self-heal project state if possible:
    if (!this.state.currentProject && this.projectManager?.currentProject && this.app.validateUUID(this.projectManager.currentProject.id)) {
      this.state.currentProject = this.projectManager.currentProject;
      projectId = this.state.currentProject.id;
      console.warn('[ProjectDetailsComponent] self-healed missing state.currentProject from projectManager.currentProject');
    }

    if (!conversation?.id || !this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot load conversation: Project or conversation invalid.', 'error');
      console.error('[ProjectDetailsComponent] _handleConversationClick failed: Invalid IDs', {
        conversationId: conversation?.id,
        projectId,
        conversation,
        stateCurrent: this.state.currentProject,
        pmCurrent: this.projectManager?.currentProject
      });
      return;
    }

    console.log(`[ProjectDetailsComponent] Conversation clicked: ${conversation.id}`, { projectId, conversation, stateCurrent: this.state.currentProject, pmCurrent: this.projectManager?.currentProject });

    // Update URL param
    const url = new URL(window.location.href);
    url.searchParams.set('chatId', conversation.id);
    window.history.pushState({ conversationId: conversation.id }, '', url.toString());

    // Diagnostic logging before chat UI init
    console.log('[ProjectDetailsComponent] _handleConversationClick before chat UI init:', {
      projectId,
      conversationId: conversation.id,
      chatManager: this.projectManager?.chatManager || this.app?.chatManager
    });

    // Directly initialize or update Chat UI for this conversation
    await this._initializeOrUpdateChatUI(conversation.id);
  }
}

/**
 * Factory function for creating a ProjectDetailsComponent instance.
  * @param {Object} options - Dependencies for the component.
 * @returns {ProjectDetailsComponent} A new ProjectDetailsComponent instance.
 */
export function createProjectDetailsComponent(options) {
  return new ProjectDetailsComponent(options);
}

export default createProjectDetailsComponent;

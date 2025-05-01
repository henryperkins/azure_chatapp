/**
 * projectDetailsComponent.js - Refactored (Dependency Injection Version)
 *
 * Component for displaying project details, files, conversations, artifacts, and knowledge base content.
 * Uses Dependency Injection: all logic, API access, and UI events rely on injected dependencies.
 *
 * ## Dependencies (Injected via Constructor Options):
 * - app: Core app module (state, notifications, apiRequest, utilities, validation)
 * - projectManager: Project data operations and event emitting (files, conversations, artifacts, chat, stats).
 * - eventHandlers: Centralized event listener management (trackListener, delegate, cleanupListeners).
 * - FileUploadComponentClass: Class/factory for file upload (needs relevant DOM nodes).
 * - modalManager: Manages modal dialogs, including confirmation.
 * - knowledgeBaseComponent: (Optional) Instance of the injected knowledge base UI logic.
 *
 * ## Integration Contract:
 * - Orchestrator must inject all dependencies via the constructor.
 * - Orchestrator must inject the base DOM structure for #projectDetailsView and children before .initialize().
 * - Component manages its internal subcomponents, listeners, loading indicators, and tab navigation, but not container mounting.
 * - Component provides methods: initialize(), show()/hide(), destroy(),
 *   and content rendering (renderProject, renderFiles, renderConversations, renderArtifacts, renderStats).
 *
 * ## Validation:
 * - Project ID and similar critical values are always validated using injected app.validateUUID.
 *
 * Note: This component does not perform any root HTML injection or container population.
 */

/* Project ID validation uses injected this.app.validateUUID utility */

class ProjectDetailsComponent {
  /**
   * @param {Object} options - Component options & dependencies
   * @param {Function} options.onBack - Callback for back navigation (Required)
   * @param {Object} options.app - Core Application instance (Required)
   * @param {Object} options.projectManager - ProjectManager instance (Required)
   * @param {Object} options.eventHandlers - EventHandler instance (Required)
   * @param {Function|Object} options.FileUploadComponentClass - FileUploadComponent class/factory (Required)
   * @param {Object} options.modalManager - ModalManager instance (Required)
   * @param {Object} [options.knowledgeBaseComponent] - Optional KnowledgeBaseComponent instance
   */
  constructor(options = {}) {
    // Retrieve all required dependencies solely from the DependencySystem
    this.onBack = window.DependencySystem.modules.get('onBack')
                   || (() => { console.warn("onBack callback not registered."); });
    this.app = window.DependencySystem.modules.get('app');
    this.projectManager = window.DependencySystem.modules.get('projectManager');
    this.eventHandlers = window.DependencySystem.modules.get('eventHandlers');
    this.modalManager = window.DependencySystem.modules.get('modalManager');
    this.FileUploadComponentClass = window.DependencySystem.modules.get('FileUploadComponent');
    this.knowledgeBaseComponent = window.DependencySystem.modules.get('knowledgeBaseComponent') || null;

    if (!this.app || !this.projectManager || !this.eventHandlers ||
        !this.modalManager || !this.FileUploadComponentClass) {
      throw new Error("[ProjectDetailsComponent] Missing one or more required dependencies from the DependencySystem.");
    }

    // --- Internal State ---
    this.state = {
      currentProject: null,
      activeTab: 'details', // Default tab
      isLoading: {}, // Tracks loading state per section (e.g., files, conversations)
      initialized: false
    };

    // --- File Upload Configuration ---
    // Consider moving this to APP_CONFIG or passing via options if it varies
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css', '.jpg', '.jpeg', '.png', '.gif', '.zip'],
      maxSizeMB: 30
    };

    // --- Element References (Populated in initialize) ---
    this.elements = {
      container: null, title: null, description: null, backBtn: null,
      tabContainer: null, filesList: null, conversationsList: null,
      artifactsList: null, tabContents: {}, loadingIndicators: {},
      fileInput: null, uploadBtn: null, dragZone: null,
      uploadProgress: null, progressBar: null, uploadStatus: null
    };

    // --- Sub-component Instances (Populated in initialize) ---
    this.fileUploadComponent = null;
  }

  /**
   * Initialize the component. Finds elements and binds core event listeners.
   * Assumes the container and its base HTML structure exist in the DOM.
   * @returns {Promise<boolean>} - True if successful, false otherwise.
   */
  async initialize() {
    if (this.state.initialized) {
      console.log('[ProjectDetailsComponent] Already initialized');
      return true;
    }
    console.log('[ProjectDetailsComponent] Initializing...');

    try {
      // Find elements within the already-existing container
      if (!this._findElements()) {
        throw new Error("Required elements not found within #projectDetailsView container.");
      }

      // Bind core component event listeners
      this._bindCoreEvents();

      // Initialize sub-components like FileUpload
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
   * Finds and stores references to DOM elements within the component's container.
   * @returns {boolean} - True if all essential elements are found, false otherwise.
   * @private
   */
  _findElements() {
    this.elements.container = document.getElementById('projectDetailsView');
    if (!this.elements.container) {
      console.error("[ProjectDetailsComponent] Container #projectDetailsView not found!");
      return false;
    }

    // Find required elements within the container
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
    this.elements.fileInput = this.elements.container.querySelector('#file-upload-input');
    this.elements.uploadBtn = this.elements.container.querySelector('#uploadFileBtn');
    this.elements.dragZone = this.elements.container.querySelector('#dragDropZone');
    this.elements.uploadProgress = this.elements.container.querySelector('#filesUploadProgress');
    this.elements.progressBar = this.elements.container.querySelector('#fileProgressBar');
    this.elements.uploadStatus = this.elements.container.querySelector('#uploadStatus');

    // Check if essential elements were found
    return !!(this.elements.title && this.elements.backBtn && this.elements.tabContainer);
  }

  /**
   * Bind core event listeners for the component's functionality.
   * Uses the injected eventHandlers instance.
   * @private
   */
  _bindCoreEvents() {
    if (!this.eventHandlers) {
      console.error("[ProjectDetailsComponent] eventHandlers dependency missing, cannot bind events.");
      return;
    }

    // Back button
    if (this.elements.backBtn) {
      // Cleanup potential old listeners if re-initializing (though ideally init is only called once)
      this.eventHandlers.cleanupListeners(this.elements.backBtn, 'click');
      this.eventHandlers.trackListener(this.elements.backBtn, 'click', (e) => {
        console.log('[ProjectDetailsComponent] Back button clicked, triggering onBack');
        this.onBack(e);
      }, { description: 'ProjectDetailsBack' });
    }

    // Tab buttons (delegated listener on container)
    if (this.elements.tabContainer) {
      this.eventHandlers.cleanupListeners(this.elements.tabContainer, 'click'); // Cleanup previous delegate listener
      this.eventHandlers.delegate(this.elements.tabContainer, 'click', '.project-tab-btn', (event, target) => {
        const tabName = target.dataset.tab;
        if (tabName) {
          this.switchTab(tabName);
        }
      }, { description: 'ProjectTabSwitch' });
    }

    // New conversation button
    const newChatBtn = this.elements.container?.querySelector('#projectNewConversationBtn');
    if (newChatBtn) {
      this.eventHandlers.cleanupListeners(newChatBtn, 'click');
      this.eventHandlers.trackListener(newChatBtn, 'click', () => {
        // Check if project is loaded before allowing creation
        if (this.state.currentProject?.id) {
          this.createNewConversation();
        } else {
          this.app.showNotification("Please wait for project details to load.", "warning");
        }
      }, { description: 'ProjectNewConversation' });
    }

    // Listen for global project data events (dispatched by projectManager or app)
    // Use trackListener on 'document' for these global events to allow cleanup if needed
    this.eventHandlers.trackListener(document, 'projectConversationsLoaded', (e) => this.renderConversations(e.detail?.conversations || []), { description: 'ProjectDetails_HandleConversationsLoaded' });
    this.eventHandlers.trackListener(document, 'projectFilesLoaded', (e) => this.renderFiles(e.detail?.files || []), { description: 'ProjectDetails_HandleFilesLoaded' });
    this.eventHandlers.trackListener(document, 'projectArtifactsLoaded', (e) => this.renderArtifacts(e.detail?.artifacts || []), { description: 'ProjectDetails_HandleArtifactsLoaded' });
    this.eventHandlers.trackListener(document, 'projectStatsLoaded', (e) => this.renderStats(e.detail || {}), { description: 'ProjectDetails_HandleStatsLoaded' });

    // Note: projectLoaded event is handled by the calling component (ProjectDashboard)
    // which then calls this.renderProject(project)
  }

  /**
   * Initializes sub-components like FileUploadComponent.
   * @private
   */
  _initializeSubComponents() {
    if (this.FileUploadComponentClass && !this.fileUploadComponent) {
      // Check if all required DOM elements for file upload are present
      if (this.elements.fileInput && this.elements.uploadBtn && this.elements.dragZone &&
        this.elements.uploadProgress && this.elements.progressBar && this.elements.uploadStatus) {
        this.fileUploadComponent = new this.FileUploadComponentClass({
          // Pass projectId dynamically when needed, not at init
          fileInput: this.elements.fileInput,
          uploadBtn: this.elements.uploadBtn,
          dragZone: this.elements.dragZone,
          uploadProgress: this.elements.uploadProgress,
          progressBar: this.elements.progressBar,
          uploadStatus: this.elements.uploadStatus,
          // Inject dependencies needed by FileUploadComponent itself
          projectManager: this.projectManager,
          app: this.app,
          eventHandlers: this.eventHandlers,
          // Callback to refresh file list after upload
          onUploadComplete: () => {
            if (this.state.currentProject?.id) {
              console.log("[ProjectDetailsComponent] Upload complete, refreshing files list.");
              // Use injected projectManager
              this.projectManager.loadProjectFiles(this.state.currentProject.id);
            }
          }
        });
        // FileUploadComponent might have its own initialize method
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
   * PUBLIC METHODS
   * ========================================================================= */

  /** Makes the component visible. Assumes initialize() was called successfully. */
  show() {
    if (!this.state.initialized || !this.elements.container) {
      console.error("[ProjectDetailsComponent] Cannot show: Not initialized or container missing.");
      return;
    }
    // Re-ensure elements are found in case DOM was manipulated externally (though ideally not)
    // this._findElements(); // Optional: Could re-run findElements if dynamic DOM changes are expected
    this.elements.container.classList.remove('hidden');
    this.elements.container.setAttribute('aria-hidden', 'false');
    console.log("[ProjectDetailsComponent] Shown.");
  }

  /** Hides the component. */
  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add('hidden');
      this.elements.container.setAttribute('aria-hidden', 'true');
      console.log("[ProjectDetailsComponent] Hidden.");
    }
    // Optionally cleanup listeners specific to the details view if re-shown frequently
    // this.eventHandlers.cleanupListeners(this.elements.container); // Example cleanup scope
  }

  /**
   * Renders the details for a specific project. Called by the parent orchestrator.
   * @param {Object} project - Project data object from projectManager.
   */
  renderProject(project) {
    if (!this.state.initialized) {
      console.error("[ProjectDetailsComponent] Cannot render project: Component not initialized.");
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) { // Use injected validator
      console.error('[ProjectDetailsComponent] Invalid project data received for rendering.');
      // Optionally show an error state in the UI
      this.app.showNotification("Failed to load project details.", "error");
      this.onBack(); // Go back to list view
      return;
    }

    console.log(`[ProjectDetailsComponent] Rendering project: ${project.id}`);
    this.state.currentProject = project;

    // Update file upload component with current project ID
    if (this.fileUploadComponent) {
      this.fileUploadComponent.setProjectId(project.id); // Assuming FileUploadComponent has setProjectId method
    }

    // Update header display
    this._updateProjectHeader(project);

    // Decide default tab - e.g., conversations or details
    const defaultTab = 'details'; // Or 'conversations'
    this.switchTab(defaultTab);

    // Trigger loading of content for the default tab (switchTab already calls _loadTabContent)
    // Redundant call removed: this._loadTabContent(defaultTab);

    this.show(); // Ensure the component container is visible
  }

  /**
   * Switches the active tab in the details view.
   * @param {string} tabName - The name of the tab to switch to ('details', 'files', etc.)
   */
  switchTab(tabName) {
    if (!this.state.initialized) {
      console.warn("[ProjectDetailsComponent] Cannot switch tab: Not initialized.");
      return;
    }
    const validTabs = ['details', 'files', 'knowledge', 'conversations', 'artifacts', 'chat'];
    if (!validTabs.includes(tabName)) {
      console.warn(`[ProjectDetailsComponent] Invalid tab name requested: ${tabName}`);
      return;
    }

    const projectId = this.state.currentProject?.id;
    const requiresProject = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName);

    if (requiresProject && !this.app.validateUUID(projectId)) { // Use injected validator
      this.app.showNotification('Cannot view this tab until a project is fully loaded.', 'warning');
      console.error("[ProjectDetailsComponent] Refusing to show tab due to invalid projectId", { tabName, projectId });
      // Optionally switch back to 'details' tab or disable buttons
      this.switchTab('details'); // Switch to a safe tab
      return;
    }

    console.log(`[ProjectDetailsComponent] Switching tab to: ${tabName}`);
    this.state.activeTab = tabName;

    // Update tab button states (ARIA and visual)
    const tabButtons = this.elements.tabContainer?.querySelectorAll('.project-tab-btn');
    tabButtons?.forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('tab-active', isActive); // Use appropriate active class
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update visibility of tab content panels
    Object.entries(this.elements.tabContents).forEach(([key, element]) => {
      if (element) {
        element.classList.toggle('hidden', key !== tabName);
      }
    });

    // Load content specific to the activated tab
    this._loadTabContent(tabName);
  }

  /**
   * Renders the list of files for the current project.
   * @param {Array} files - Array of file objects.
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
        <div class="text-center py-8 text-base-content/70">
          <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          </svg>
          <p class="mt-2">No files uploaded yet.</p>
          <p class="text-sm mt-1">Drag & drop files or use the upload button.</p>
        </div>`;
      return;
    }

    files.forEach(file => {
      try {
        const fileItem = this._createFileItemElement(file); // Use internal creator function
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

    container.innerHTML = ''; // Clear previous content

    if (!conversations.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
           <p>No conversations yet.</p>
           <p class="text-sm mt-1">Click 'New Chat' to start.</p>
        </div>`;
      return;
    }

    conversations.forEach(conversation => {
      try {
        const item = this._createConversationItemElement(conversation); // Use internal creator function
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
        <div class="text-center py-8 text-base-content/70">
          <p>No artifacts generated yet.</p>
        </div>`;
      return;
    }

    artifacts.forEach(artifact => {
      try {
        const artifactItem = this._createArtifactItemElement(artifact); // Use internal creator function
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
    // Find stat elements within this.elements.container and update them
    const fileCountEl = this.elements.container.querySelector('[data-stat="fileCount"]');
    const convoCountEl = this.elements.container.querySelector('[data-stat="conversationCount"]');
    // etc...
    if (fileCountEl && stats.fileCount !== undefined) fileCountEl.textContent = stats.fileCount;
    if (convoCountEl && stats.conversationCount !== undefined) convoCountEl.textContent = stats.conversationCount;
    console.log("[ProjectDetailsComponent] Stats rendered:", stats);
  }

  /**
   * Initiates the creation of a new conversation via the projectManager.
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
      // Delegate creation to projectManager, which knows about chatManager
      const conversation = await this.projectManager.createConversation(projectId);
      if (conversation && conversation.id) {
        this.app.showNotification(`Conversation '${conversation.title || 'Default'}' created.`, 'success');
        // Switch to chat tab and potentially load it (ProjectDashboard handles nav?)
        // Or rely on projectConversationsLoaded event to refresh the list
        this.switchTab('conversations'); // Switch back to convos list after creation? Or Chat?
        // Trigger a reload of conversations to show the new one
        this.projectManager.loadProjectConversations(projectId);

        // Optional: Directly navigate to the new chat
        // this.switchTab('chat');
        // this._navigateToConversation(conversation.id);

      } else {
        throw new Error("Received invalid response from createConversation.");
      }
    } catch (error) {
      console.error('[ProjectDetailsComponent] Error creating new conversation:', error);
      this.app.showNotification(`Failed to create conversation: ${error.message}`, 'error');
    }
  }

  /**
   * Cleans up resources and listeners used by the component.
   * Should be called by the orchestrator when the component is no longer needed.
   */
  destroy() {
    console.log("[ProjectDetailsComponent] Destroying...");
    // Use eventHandlers to remove listeners associated with this component
    // Example: remove all listeners attached to the container or document with a specific description
    if (this.eventHandlers?.cleanupListeners) {
      this.eventHandlers.cleanupListeners(this.elements.container, null, null); // Clean listeners attached to the container
      // Clean global listeners registered by this component
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleConversationsLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleFilesLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleArtifactsLoaded');
      this.eventHandlers.cleanupListeners(document, null, 'ProjectDetails_HandleStatsLoaded');
    }

    // Nullify references
    this.elements = {};
    this.state = { initialized: false, currentProject: null, activeTab: 'details', isLoading: {} };
    this.fileUploadComponent = null; // Assume FileUploadComponent handles its own cleanup if needed
    this.knowledgeBaseComponent = null;
    console.log("[ProjectDetailsComponent] Destroyed.");
  }


  /* =========================================================================
   * PRIVATE METHODS
   * ========================================================================= */

  /** Updates the project title and description elements. @private */
  _updateProjectHeader(project) {
    if (this.elements.title) this.elements.title.textContent = project?.title || 'Untitled Project';
    if (this.elements.description) this.elements.description.textContent = project?.description || '';
  }

  /** Loads content for the currently active tab. @private */
  _loadTabContent(tabName) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId) && ['files', 'knowledge', 'conversations', 'artifacts', 'chat'].includes(tabName)) {
      console.warn(`[ProjectDetailsComponent] Cannot load tab ${tabName} without a valid project ID.`);
      return; // Do nothing if project isn't loaded for tabs that require it
    }

    console.log(`[ProjectDetailsComponent] Loading content for tab: ${tabName}`);

    // Handle KB component visibility/initialization
    if (this.knowledgeBaseComponent) {
      if (tabName === 'knowledge') {
        const kbData = this.state.currentProject?.knowledge_base || null;
        this.knowledgeBaseComponent.initialize(true, kbData, projectId)
          .catch(e => console.error("Failed to initialize KB component:", e));
      } else {
        // Ensure KB component is hidden/deactivated when its tab is not active
        this.knowledgeBaseComponent.initialize(false)
          .catch(e => console.error("Failed to de-initialize KB component:", e));
      }
    }

    // Trigger data loading via projectManager for relevant tabs
    switch (tabName) {
      case 'files':
        this._withLoading('files', () => this.projectManager.loadProjectFiles(projectId));
        break;
      case 'conversations':
        this._withLoading('conversations', () => this.projectManager.loadProjectConversations(projectId));
        break;
      case 'artifacts':
        this._withLoading('artifacts', () => this.projectManager.loadProjectArtifacts(projectId));
        break;
      case 'knowledge':
        // Content loading is handled by the KB component itself via its initialize method above
        break;
      case 'chat':
        // Chat initialization/loading is handled when switching to the tab or clicking a conversation
        // No specific data load here, but ensure UI state is correct.
        this._initializeOrUpdateChatUI();
        break;
      case 'details':
        // Details tab might need stats or other info
        this._withLoading('stats', () => this.projectManager.loadProjectStats(projectId));
        break;
      default:
        break; // No specific load action for unknown tabs
    }
  }

  /** Initializes or updates the main chat UI state based on current project. @private */
  async _initializeOrUpdateChatUI() {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId)) {
      this._disableChatUI("Cannot initialize chat: No valid project selected.");
      return;
    }

    try {
      // Use projectManager's reference to chatManager if available (preferred)
      // Or fallback to DependencySystem if needed
      const chatManager = this.projectManager?.chatManager || this.app?.DependencySystem?.modules?.get('chatManager');

      if (!chatManager) {
        throw new Error("Chat Manager dependency not available.");
      }

      // Check if chat manager is already initialized for this project
      if (!chatManager.isInitialized || chatManager.projectId !== projectId) {
        console.log(`[ProjectDetailsComponent] Initializing Chat Manager for project ${projectId}`);
        await chatManager.initialize({ projectId }); // Initialize if needed
      }

      // Determine which conversation to load
      const urlParams = new URLSearchParams(window.location.search);
      const chatIdFromUrl = urlParams.get('chatId');

      if (chatIdFromUrl && chatManager.currentConversationId !== chatIdFromUrl) {
        console.log(`[ProjectDetailsComponent] Loading conversation ${chatIdFromUrl} from URL.`);
        await chatManager.loadConversation(chatIdFromUrl);
      } else if (!chatManager.currentConversationId) {
        // If no conversation is loaded and none specified in URL, load the first one or prompt creation
        const conversations = await this.projectManager.loadProjectConversations(projectId);
        if (conversations && conversations.length > 0) {
          console.log(`[ProjectDetailsComponent] Loading first conversation: ${conversations[0].id}`);
          await chatManager.loadConversation(conversations[0].id);
        } else {
          console.log("[ProjectDetailsComponent] No conversations found, prompting creation (or handled by createNewConversation).");
          // Optionally call createNewConversation here if desired behavior
          // await this.createNewConversation();
        }
      } else {
        console.log(`[ProjectDetailsComponent] Chat UI updated, conversation ${chatManager.currentConversationId} already loaded.`);
      }
      this._enableChatUI(); // Ensure UI is enabled after successful init/load
    } catch (error) {
      this._disableChatUI(`Failed to initialize chat: ${error.message || error}`);
      console.error('[ProjectDetailsComponent] Failed to initialize/update chat UI:', error);
      this.app.showNotification('Failed to initialize chat', 'error');
    }
  }

  /** Disables chat input/send button with a reason. @private */
  _disableChatUI(reason = "") {
    const sendBtn = this.elements.container?.querySelector("#projectChatSendBtn"); // Scope query to component
    const input = this.elements.container?.querySelector("#projectChatInput");
    if (sendBtn) { sendBtn.disabled = true; sendBtn.title = reason || "Chat is unavailable"; }
    if (input) { input.disabled = true; input.placeholder = reason || "Chat unavailable"; }
  }

  /** Enables chat input/send button. @private */
  _enableChatUI() {
    const sendBtn = this.elements.container?.querySelector("#projectChatSendBtn");
    const input = this.elements.container?.querySelector("#projectChatInput");
    if (sendBtn) sendBtn.disabled = false;
    if (input) { input.disabled = false; input.placeholder = "Type your message..."; }
  }


  /** Helper to perform an async operation while showing/hiding a loading indicator. @private */
  async _withLoading(section, asyncFn) {
    if (this.state.isLoading[section]) {
      console.warn(`[ProjectDetailsComponent] Loading already in progress for section: ${section}`);
      return; // Prevent concurrent loading for the same section
    }

    this.state.isLoading[section] = true;
    this._toggleLoadingIndicator(section, true);

    try {
      return await asyncFn();
    } catch (error) {
      console.error(`[ProjectDetailsComponent] Error loading ${section}:`, error);
      this.app.showNotification(`Failed to load ${section}: ${error.message}`, 'error');
      // Re-throw maybe? Or return specific error indicator?
      // For now, just log and notify.
    } finally {
      this.state.isLoading[section] = false;
      this._toggleLoadingIndicator(section, false);
    }
  }

  /** Shows or hides the loading indicator for a specific section. @private */
  _toggleLoadingIndicator(section, show) {
    const indicator = this.elements.loadingIndicators[section];
    if (indicator) {
      indicator.classList.toggle('hidden', !show);
    } else {
      // console.warn(`[ProjectDetailsComponent] Loading indicator not found for section: ${section}`);
    }
  }

  /** Handles confirming and executing file deletion. @private */
  _confirmDeleteFile(fileId, fileName) {
    const projectId = this.state.currentProject?.id;
    if (!this.app.validateUUID(projectId) || !fileId) {
      console.error("[ProjectDetailsComponent] Cannot delete file: Invalid project or file ID.");
      return;
    }

    const safeFileName = fileName || `file ID ${fileId}`; // Use provided name or ID

    // Use injected modalManager
    this.modalManager.confirmAction({
      title: 'Delete File',
      message: `Are you sure you want to delete "${safeFileName}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmClass: 'btn-error', // Example styling class
      onConfirm: async () => {
        console.log(`[ProjectDetailsComponent] Deleting file ${fileId} from project ${projectId}`);
        try {
          // Use injected projectManager
          await this.projectManager.deleteFile(projectId, fileId); // Assume deleteFile exists
          this.app.showNotification('File deleted successfully', 'success');
          // Trigger refresh of files list
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

  /* =========================================================================
   * PRIVATE METHODS - ITEM ELEMENT CREATION
   * These methods create the HTML elements for list items. They use injected
   * utilities for formatting and event handling.
   * ========================================================================= */

  /** Creates the DOM element for a single file item. @private */
  _createFileItemElement(file) {
    const item = document.createElement('div');
    // Use CSS classes from your framework (e.g., Tailwind, Bootstrap)
    item.className = 'flex items-center justify-between gap-3 p-3 bg-base-100 rounded-md shadow-sm hover:bg-base-200 transition-colors';
    item.dataset.fileId = file.id;

    // Use injected app/formatting utilities if available
    const formatBytes = this.app?.formatBytes || ((b) => `${b} Bytes`); // Fallback
    const formatDate = this.app?.formatDate || ((d) => new Date(d).toLocaleDateString()); // Fallback
    const getFileIcon = this.app?.getFileTypeIcon || (() => '📄'); // Fallback

    item.innerHTML = `
        <div class="flex items-center gap-3 min-w-0 flex-1">
            <span class="text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}">${getFileIcon(file.file_type)}</span>
            <div class="flex flex-col min-w-0 flex-1">
                <div class="font-medium truncate" title="${file.filename}">${file.filename}</div>
                <div class="text-xs text-base-content/70">${formatBytes(file.file_size)} · ${formatDate(file.created_at)}</div>
                ${file.metadata?.search_processing ? this._createProcessingBadge(file.metadata.search_processing.status) : ''}
            </div>
        </div>
        <div class="flex gap-1">
            <button class="btn btn-ghost btn-sm btn-square text-info hover:bg-info/10 data-download-btn" title="Download file">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </button>
            <button class="btn btn-ghost btn-sm btn-square text-error hover:bg-error/10 data-delete-btn" title="Delete file">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
        </div>
    `;

    // Attach listeners using injected eventHandlers
    const downloadBtn = item.querySelector('.data-download-btn');
    const deleteBtn = item.querySelector('.data-delete-btn');

    if (downloadBtn) {
      this.eventHandlers.trackListener(downloadBtn, 'click', () => {
        if (this.projectManager?.downloadFile) { // Assume downloadFile exists
          this.projectManager.downloadFile(this.state.currentProject.id, file.id)
            .catch(e => { this.app.showNotification(`Download failed: ${e.message}`, 'error'); });
        } else { console.error("projectManager.downloadFile not available."); }
      }, { description: `DownloadFile_${file.id}` });
    }

    if (deleteBtn) {
      this.eventHandlers.trackListener(deleteBtn, 'click', () => {
        this._confirmDeleteFile(file.id, file.filename);
      }, { description: `DeleteFile_${file.id}` });
    }

    return item;
  }

  /** Creates the HTML string for a file processing status badge. @private */
  _createProcessingBadge(status) {
    const badgeClass = status === 'success' ? 'badge-success' :
      status === 'error' ? 'badge-error' :
        status === 'pending' ? 'badge-warning' : 'badge-ghost';
    const badgeText = status === 'success' ? 'Ready' :
      status === 'error' ? 'Failed' :
        status === 'pending' ? 'Processing...' : 'Not Processed';
    return `<span class="badge ${badgeClass} badge-sm mt-1">${badgeText}</span>`;
  }


  /** Creates the DOM element for a single conversation item. @private */
  _createConversationItemElement(conversation) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors';
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

    // Attach listener using injected eventHandlers
    this.eventHandlers.trackListener(item, 'click', () => this._handleConversationClick(conversation), { description: `ViewConversation_${conversation.id}` });

    return item;
  }

  /** Creates the DOM element for a single artifact item. @private */
  _createArtifactItemElement(artifact) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 transition-colors';
    item.dataset.artifactId = artifact.id;

    const formatDate = this.app?.formatDate || ((d) => new Date(d).toLocaleDateString());

    item.innerHTML = `
        <div class="flex justify-between items-center">
            <h4 class="font-medium truncate">${artifact.name || 'Untitled Artifact'}</h4>
            <span class="text-xs text-base-content/60">${formatDate(artifact.created_at)}</span>
        </div>
        <p class="text-sm text-base-content/70 truncate mt-1">${artifact.description || artifact.type || 'No description'}</p>
        <div class="mt-2 flex gap-2">
            <button class="btn btn-xs btn-outline data-download-artifact-btn">Download</button>
            </div>
    `;

    // Attach listeners using injected eventHandlers
    const downloadBtn = item.querySelector('.data-download-artifact-btn');
    if (downloadBtn) {
      this.eventHandlers.trackListener(downloadBtn, 'click', () => {
        if (this.projectManager?.downloadArtifact) { // Assume downloadArtifact exists
          this.projectManager.downloadArtifact(this.state.currentProject.id, artifact.id)
            .catch(e => { this.app.showNotification(`Download failed: ${e.message}`, 'error'); });
        } else { console.error("projectManager.downloadArtifact not available."); }
      }, { description: `DownloadArtifact_${artifact.id}` });
    }

    return item;
  }

  /** Handles clicking on a conversation item to switch view. @private */
  async _handleConversationClick(conversation) {
    const projectId = this.state.currentProject?.id;
    if (!conversation?.id || !this.app.validateUUID(projectId)) {
      this.app.showNotification('Cannot load conversation: Project or conversation invalid.', 'error');
      console.error('[ProjectDetailsComponent] _handleConversationClick failed: Invalid IDs', { conversationId: conversation?.id, projectId });
      return;
    }

    console.log(`[ProjectDetailsComponent] Conversation clicked: ${conversation.id}`);

    // Update URL without necessarily switching tab immediately
    const url = new URL(window.location.href);
    url.searchParams.set('chatId', conversation.id);
    // Use pushState here to allow back navigation within chats of the same project view
    window.history.pushState({ conversationId: conversation.id }, '', url.toString());

    // Switch to chat tab
    this.switchTab('chat'); // This will trigger _initializeOrUpdateChatUI

    // _initializeOrUpdateChatUI will handle loading the correct conversation based on the new URL
  }

} // End ProjectDetailsComponent Class

/**
 * Factory function for dependency-injected ProjectDetailsComponent construction.
 *
 * @returns {ProjectDetailsComponent} A new ProjectDetailsComponent instance.
 */
export function createProjectDetailsComponent() {
  return new ProjectDetailsComponent();
}

// Default export remains the factory
export default createProjectDetailsComponent;

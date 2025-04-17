/**
 * projectDetailsComponent.js
 *
 * A refined, deduplicated, and more maintainable version of the ProjectDetailsComponent.
 * Leverages helper methods to reduce repetitive code in file uploads, chat initialization,
 * error handling, and DOM manipulation.
 */

const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

export class ProjectDetailsComponent {
  constructor(options = {}) {
    // Store bound handlers for proper removal:
    this.boundHandleConversationsLoaded = this.handleConversationsLoaded.bind(this);
    this.boundHandleArtifactsLoaded = this.handleArtifactsLoaded.bind(this);
    this.boundOnTabClick = this.onTabClick.bind(this);

    // Validate required callbacks
    if (!options.onBack || typeof options.onBack !== 'function') {
      console.error('[ProjectDetailsComponent] Missing required onBack callback.');
      throw new Error('onBack callback function is required');
    }

    // Initialize injected dependencies (or fallback to globals)
    this.onBack = options.onBack;
    this.utils = options.utils || window.uiUtilsInstance;
    this.projectManager = options.projectManager || window.projectManager;
    this.auth = options.auth || window.auth;
    this.notification = options.notification || window.showNotification;

    // Internal state
    this.state = {
      currentProject: null,
      activeTab: 'files',
      searchCache: new Map() // for caching search results
    };

    // File upload stats & config
    this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
    this.fileConstants = {
      allowedExtensions: [
        '.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx',
        '.py', '.js', '.html', '.css'
      ],
      maxSizeMB: 30
    };

    // Additional bindings
    this.scrollHandler = this.handleScroll.bind(this);
    this.handleDragEvent = this.handleDragEvent.bind(this);

    // Tracks whether HTML templates are already in the DOM
    this.templatesReady = window.templatesLoadedInDOM || false;

    // Observe DOM changes in case elements are loaded dynamically
    this._setupElementObserver();

    // Basic setup
    this.initElements();
    this.bindEvents();
    this.setupDragDropHandlers();
  }

  initElements() {
    // Find required elements and store them
    this.elements = {
      container: document.getElementById('projectDetailsView'),
      title: document.getElementById('projectTitle'),
      description: document.getElementById('projectDescription'),
      backBtn: document.getElementById('backToProjectsBtn'),
      pinBtn: document.getElementById('pinProjectBtn'),
      archiveBtn: document.getElementById('archiveProjectBtn'),
      tabContainer: document.getElementById('projectDetailsTabs'),
      dragZone: document.getElementById('dragDropZone'),
      filesList: document.getElementById('projectFilesList'),
      fileInput: document.getElementById('projectFileInput'),
      uploadBtnTrigger: document.getElementById('uploadFileBtn'),
      uploadProgress: document.getElementById('uploadProgressContainer'),
      progressBar: document.getElementById('uploadProgressBar'),
      uploadStatus: document.getElementById('uploadStatusText'),
      chatContainer: document.getElementById('projectChatContainer'),
      chatMessages: document.getElementById('projectChatMessages'),

      // Tab content sections
      tabContents: {
        files: document.getElementById('filesTabContent'),
        knowledge: document.getElementById('knowledgeTabContent'),
        conversations: document.getElementById('conversationsTabContent'),
        artifacts: document.getElementById('artifactsTabContent'),
        chat: document.getElementById('chatTabContent')
      },

      // Loading states
      loadingStates: {
        files: document.getElementById('filesLoadingIndicator'),
        conversations: document.getElementById('conversationsLoadingIndicator'),
        artifacts: document.getElementById('artifactsLoadingIndicator')
      }
    };
  }

  /* ------------------------------------------------------------------
   * Public Lifecycle Methods
   * ------------------------------------------------------------------ */
  show() {
    if (!this.elements?.container) return;
    this.elements.container.classList.remove('hidden', 'opacity-0');
    this.elements.container.classList.add('block', 'opacity-100');
  }

  hide() {
    if (!this.elements?.container) return;
    this.elements.container.classList.add('opacity-0');
    setTimeout(() => {
      this.elements.container.classList.add('hidden');
      this.elements.container.classList.remove('block');
    }, 150);
  }

  destroy() {
    // Remove bound project-level listeners
    document.removeEventListener("projectConversationsLoaded", this.boundHandleConversationsLoaded);
    document.removeEventListener("projectArtifactsLoaded", this.boundHandleArtifactsLoaded);

    // Remove scroll listener if applied
    if (this.elements.filesList) {
      this._manageListeners(this.elements.filesList, 'scroll', this.scrollHandler, 'remove');
    }

    // Remove tab click if present
    if (this.elements.tabContainer && this.elements.tabContainer.dataset.listenerAttached) {
      this._manageListeners(this.elements.tabContainer, 'click', this.boundOnTabClick, 'remove');
      delete this.elements.tabContainer.dataset.listenerAttached;
    }

    // Remove drag events
    if (this.elements.dragZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        this._manageListeners(this.elements.dragZone, ev, this.handleDragEvent, 'remove');
      });
    }

    // Disconnect the MutationObserver
    if (this.elementObserver) {
      this.elementObserver.disconnect();
      this.elementObserver = null;
    }
  }

  /**
   * Initialize chat interface by ensuring the global interface is ready
   * and configured for the current project
   */

  /**
   * Centralized method to initialize the chat system and optionally load a conversation.
   */
  async _initializeChatSystem(conversationId = null) {
    const container = this.elements?.chatContainer || document.getElementById('projectChatContainer');
    if (!container) {
      debugLog('[ProjectDetailsView] No chat container found');
      return false;
    }

    this._showChatLoading(container);

    try {
      // 1. Ensure script loaded
      const loaded = await this._ensureChatInterfaceLoaded();
      if (!loaded) {
        throw new Error('Failed to load ChatInterface script');
      }

      // 2. Get or initialize global chat interface
      if (!window.globalChatInterface) {
        debugLog('[ProjectDetailsView] Creating new global ChatInterface');
        window.globalChatInterface = new window.ChatInterface({
          container: 'globalChatMessages',
          inputField: 'chatUIInput',
          sendButton: 'globalChatSendBtn'
        });
        await window.globalChatInterface.initialize();

        // For backwards compatibility
        window.chatInterface = window.globalChatInterface;
        window.projectChatInterface = window.globalChatInterface;
      }

      // 3. Configure for current project
      if (this.state.currentProject?.id) {
        await window.globalChatInterface.loadProject(this.state.currentProject.id);
      }

      // Store reference for component use
      this.chatInstance = window.globalChatInterface;

      // 4. Load conversation if specified
      if (conversationId) {
        await window.globalChatInterface.loadConversation(conversationId);
      }

      return true;
    } catch (error) {
      this._showChatError(error.message || 'Chat initialization failed');
      this._handleOperationError('_initializeChatSystem', error);
      return false;
    } finally {
      this._hideChatLoading(container);
    }
  }

  bindEvents() {
    // Back button
    if (this.elements.backBtn) {
      this._manageListeners(this.elements.backBtn, 'click', this.onBack);
    }

    // Project loading events
    document.addEventListener("projectConversationsLoaded", this.boundHandleConversationsLoaded);
    document.addEventListener("projectArtifactsLoaded", this.boundHandleArtifactsLoaded);

    // Tabs
    if (this.elements.tabContainer && !this.elements.tabContainer.dataset.listenerAttached) {
      this._manageListeners(this.elements.tabContainer, 'click', this.boundOnTabClick);
      this.elements.tabContainer.dataset.listenerAttached = 'true';
    }

    // File upload triggers
    if (this.elements.uploadBtnTrigger && this.elements.fileInput) {
      this._manageListeners(this.elements.uploadBtnTrigger, 'click', () => {
        this.elements.fileInput.click();
      });
      this._manageListeners(this.elements.fileInput, 'change', this.handleFileSelection.bind(this));
    }

    // New conversation button
    const newConversationBtn = document.getElementById('projectNewConversationBtn');
    if (newConversationBtn) {
      this._manageListeners(newConversationBtn, 'click', () => this.createNewChat());
    }

    // Listeners for chat interface events
    document.addEventListener('chatInterfaceInitialized', () => {
      console.log('[ProjectDetailsComponent] Received chatInterfaceInitialized event');
      if (this.state.activeTab === 'chat' && this.state.currentProject?.id) {
        this._initializeChatSystem();
      }
    });

    document.addEventListener('chatInterfaceLoaded', () => {
      console.log('[ProjectDetailsComponent] Received chatInterfaceLoaded event');
      // Potentially handle script loaded but not init.
    });
  }

  setupDragDropHandlers() {
    if (!this.elements.dragZone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
      this._manageListeners(this.elements.dragZone, ev, this.handleDragEvent);
    });

    // Clicking drag zone triggers file input
    this._manageListeners(this.elements.dragZone, 'click', () => {
      this.elements.fileInput?.click();
    });
  }

  /* ------------------------------------------------------------------
   * Core Rendering & Project-Specific
   * ------------------------------------------------------------------ */

  updateProjectHeader(project) {
    if (!project) return;

    if (this.elements.container) {
      this.elements.container.classList.add('opacity-0');
    }

    if (this.elements.title) {
      this.elements.title.textContent = project.name || '';
      this.elements.title.classList.add('text-gray-900', 'dark:text-gray-100');
    }
    if (this.elements.description) {
      this.elements.description.textContent = project.description || "No description provided.";
      this.elements.description.classList.add('text-gray-600', 'dark:text-gray-300');
    }

    // Fade in
    if (this.elements.container) {
      setTimeout(() => {
        this.elements.container.classList.remove('opacity-0');
        this.elements.container.classList.add('opacity-100');
      }, 50);
    }
  }

  updateProjectMetadata(project) {
    if (!project) return;

    // Render stats if present
    if (project.stats) {
      this.renderStats(project.stats);
    }

    // Pin/archive states
    this.updatePinButton(project.pinned);
    this.updateArchiveButton(project.archived);
  }

  async loadProjectFiles(projectId) {
    await this._withLoadingIndicator('files', async () => {
      if (this.projectManager?.loadProjectFiles) {
        const files = await this.projectManager.loadProjectFiles(projectId);
        this.renderFiles(files);
      }
    });
  }

  async loadProjectConversations(projectId) {
    await this._withLoadingIndicator('conversations', async () => {
      if (this.projectManager?.loadProjectConversations) {
        const conversations = await this.projectManager.loadProjectConversations(projectId);
        this.renderConversations(conversations);
      }
    });
  }

  renderStats(stats = {}) {
    if (typeof stats !== 'object') {
      console.error('Invalid stats data');
      return;
    }

    const formatNumber = this.utils?.formatNumber || (n => String(n || '0'));

    if (this.elements.tokenUsage) {
      this.elements.tokenUsage.textContent = formatNumber(stats.token_usage);
    }
    if (this.elements.maxTokens) {
      this.elements.maxTokens.textContent = formatNumber(stats.max_tokens);
    }

    const usage = stats.token_usage || 0;
    const maxT = stats.max_tokens || 1;
    const pct = Math.min(100, (usage / maxT) * 100).toFixed(0);

    if (this.elements.tokenPercentageDisplay) {
      this.elements.tokenPercentageDisplay.style.setProperty('--value', pct);
      this.elements.tokenPercentageDisplay.textContent = `${pct}%`;
    }
    if (this.elements.tokenProgressBar) {
      this.elements.tokenProgressBar.value = pct;
      this.elements.tokenProgressBar.classList.remove(
        'progress-success',
        'progress-warning',
        'progress-error',
        'progress-primary'
      );

      if (pct > 90) {
        this.elements.tokenProgressBar.classList.add('progress-error');
      } else if (pct > 75) {
        this.elements.tokenProgressBar.classList.add('progress-warning');
      } else {
        this.elements.tokenProgressBar.classList.add('progress-primary');
      }
    }

    // Conversation stats
    if (this.elements.conversationCount) {
      this.elements.conversationCount.textContent = formatNumber(stats.conversation_count || 0);
    }
    if (this.elements.totalMessages) {
      this.elements.totalMessages.textContent = `${formatNumber(stats.total_messages || 0)} messages`;
    }
  }

  /* ------------------------------------------------------------------
   * Files and Uploads
   * ------------------------------------------------------------------ */

  async handleFileSelection(e) {
    if (!this.state.currentProject?.id) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    await this._handleFileUpload(this.state.currentProject.id, files);
    // Reset input
    if (e.target) e.target.value = null;
  }

  async uploadFiles(projectId, files) {
    if (!projectId || !files?.length) return;
    await this._handleFileUpload(projectId, files);
  }

  /**
   * Centralized handler for file uploads, reducing duplication
   */
  async _handleFileUpload(projectId, files) {
    // Quick auth check
    if (!await this._verifyAuth('file upload')) return;

    // Show initial progress
    this._setupUploadProgress(files.length);

    // Validate file set
    let validFiles = [], invalidFiles = [];
    try {
      // Optional advanced verification if available
      if (typeof this.projectManager?.prepareFileUploads === 'function') {
        const result = await this.projectManager.prepareFileUploads(projectId, files);
        validFiles = result.validatedFiles || [];
        invalidFiles = result.invalidFiles || [];
      } else {
        // Basic local validation fallback
        ({ validFiles, invalidFiles } = this.validateFiles(files));
      }
    } catch (err) {
      this._handleOperationError('_handleFileUpload', err, {
        messageFormatter: () => `File preparation failed: ${err.message || 'Unknown error'}`
      });
      // Fallback to local validation if custom preparation failed
      ({ validFiles, invalidFiles } = this.validateFiles(files));
    }

    // Handle invalid files
    this.handleInvalidFiles(invalidFiles);
    if (validFiles.length === 0) return;

    // Batch upload
    const BATCH_SIZE = 3;
    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      // Process each file in the batch concurrently
      await Promise.all(batch.map(file => this._processFile(projectId, file)));
    }

    // Once done, refresh project data
    await this.refreshProjectData(projectId);
  }

  async _processFile(projectId, file) {
    try {
      if (!this.projectManager?.uploadFile) {
        throw new Error('ProjectManager uploadFile() is not available');
      }
      await this.projectManager.uploadFile(projectId, file);

      this.fileUploadStatus.completed++;
      this.updateUploadProgress();

      this._notifySuccess(`${file.name} uploaded successfully`);

      // Optionally reload knowledge base after first success
      if (this.fileUploadStatus.completed === 1) {
        this.refreshKnowledgeBase(projectId);
      }
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      this.fileUploadStatus.failed++;
      this.fileUploadStatus.completed++;
      this.updateUploadProgress();

      const errMsg = this.formatUploadErrorMessage(error, file.name);
      this._notifyError(`Failed to upload ${file.name}: ${errMsg}`);
    }
  }

  /**
   * Validate files locally based on extension and size.
   */
  validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = this.fileConstants;
    const validFiles = [], invalidFiles = [];

    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValidExt = allowedExtensions.includes(ext);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

      if (!isValidExt) {
        invalidFiles.push({
          file,
          error: `Invalid file type (${ext}). Allowed: ${allowedExtensions.join(', ')}`
        });
      } else if (!isValidSize) {
        invalidFiles.push({
          file,
          error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB)`
        });
      } else {
        validFiles.push(file);
      }
    }

    return { validFiles, invalidFiles };
  }

  handleInvalidFiles(invalidFiles = []) {
    for (const { file, error } of invalidFiles) {
      this._notifyError(`Skipped ${file.name}: ${error}`);
    }
  }

  async confirmDeleteFile(file) {
    if (!file?.id || !this.state.currentProject?.id) return;
    const doDelete = async () => {
      try {
        await this.projectManager?.deleteFile(this.state.currentProject.id, file.id);
        this._notifySuccess('File deleted successfully');
        await this.refreshProjectData(this.state.currentProject.id);
      } catch (err) {
        this._handleOperationError('confirmDeleteFile', err, {
          messageFormatter: () => 'Failed to delete file'
        });
      }
    };

    if (this.utils?.confirmAction) {
      this.utils.confirmAction({
        title: "Delete File",
        message: `Are you sure you want to delete "${file.filename}"? This cannot be undone.`,
        confirmText: "Delete",
        confirmClass: "btn-error",
        onConfirm: doDelete
      });
    } else {
      const confirmed = confirm(`Delete ${file.filename}? This cannot be undone.`);
      if (confirmed) doDelete();
    }
  }

  async downloadFile(file) {
    if (!file?.id || !this.state.currentProject?.id) return;
    await this._withLoadingIndicator('files', async () => {
      const success = await this.projectManager?.downloadFile(this.state.currentProject.id, file.id);
      if (!success) throw new Error('Download failed');
    });
  }

  renderFiles(files = []) {
    // Show a quick loading state in case of large data
    this.showLoading('files');

    const listContainer = this.elements.filesList;
    if (!listContainer) {
      this.hideLoading('files');
      return;
    }

    requestAnimationFrame(() => {
      if (!files.length) {
        this.renderEmptyFilesState(listContainer);
      } else {
        listContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        files.forEach(file => {
          fragment.appendChild(this._buildFileItem(file));
        });
        listContainer.appendChild(fragment);
      }
      this.hideLoading('files');
    });
  }

  renderEmptyFilesState(container) {
    container.innerHTML = `
      <div class="text-base-content/70 text-center py-8">
        <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        </svg>
        <p class="mt-2">No files uploaded yet.</p>
        <p class="text-sm mt-1">Drag & drop files or use the upload button.</p>
      </div>
    `;
  }

  _buildFileItem(file) {
    if (!this.utils) return document.createElement('div');

    const item = this.utils.createElement("div", {
      className: "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-md shadow-sm hover:bg-base-200 transition-colors",
      "data-file-id": file.id
    });

    const infoDiv = this.utils.createElement("div", {
      className: "flex items-center gap-3 min-w-0 flex-1"
    });

    // File icon
    const icon = this.utils.createElement("span", {
      className: `text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}`
    });
    icon.innerHTML = this.utils.fileIcon?.(file.file_type) || '📄';

    // File details
    const detailDiv = this.utils.createElement("div", {
      className: "flex flex-col min-w-0 flex-1"
    });
    detailDiv.appendChild(this.utils.createElement("div", {
      className: "font-medium truncate",
      textContent: file.filename
    }));
    detailDiv.appendChild(this.utils.createElement("div", {
      className: "text-xs text-base-content/70",
      textContent: `${this.utils.formatBytes?.(file.file_size) || file.file_size} · ${this.utils.formatDate?.(file.created_at) || file.created_at}`
    }));

    // Processing badge
    const statusBadge = this._createProcessingBadge(file.metadata?.search_processing || {});
    detailDiv.appendChild(statusBadge);

    infoDiv.appendChild(icon);
    infoDiv.appendChild(detailDiv);

    // Actions
    const actions = this.utils.createElement("div", { className: "flex gap-1" });
    actions.appendChild(this._createActionButton({
      icon: "trash",
      colorClass: "btn-error",
      action: () => this.confirmDeleteFile(file),
      tooltip: "Delete file"
    }));
    actions.appendChild(this._createActionButton({
      icon: "download",
      colorClass: "btn-info",
      action: () => this.downloadFile(file),
      tooltip: "Download file"
    }));

    item.appendChild(infoDiv);
    item.appendChild(actions);
    return item;
  }

  /* ------------------------------------------------------------------
   * Conversation / Artifacts
   * ------------------------------------------------------------------ */
  handleConversationsLoaded(event) {
    const detail = event?.detail;
    const conversations = detail?.conversations || detail?.data?.conversations
      || (Array.isArray(detail) ? detail : []);
    this.renderConversations(conversations);

    if (this.elements.conversationCount) {
      this.elements.conversationCount.textContent = conversations.length;
    }

    const totalMsgs = conversations.reduce((sum, c) => sum + (c.message_count || 0), 0);
    if (this.elements.totalMessages) {
      this.elements.totalMessages.textContent = `${totalMsgs} messages`;
    }
  }

  handleArtifactsLoaded(event) {
    const detail = event?.detail;
    const artifacts = detail?.artifacts || detail?.data?.artifacts
      || (Array.isArray(detail) ? detail : []);
    this.renderArtifacts(artifacts);
  }

  renderConversations(conversations = []) {
    const listEl = this.elements.conversationsList;
    if (!listEl) return;

    this.showLoading('conversations');

    if (!conversations.length) {
      listEl.innerHTML = `
        <div class="text-base-content/70 text-center py-8">
          <p>No conversations yet</p>
          <button class="btn btn-sm btn-primary mt-2" id="newChatFromEmptyState">Create New Chat</button>
        </div>
      `;
      const newChatBtn = document.getElementById('newChatFromEmptyState');
      if (newChatBtn) {
        this._manageListeners(newChatBtn, 'click', () => this.createNewChat());
      }
    } else {
      listEl.innerHTML = conversations.map(conv => this._createConversationItemHTML(conv)).join('');
    }

    this.hideLoading('conversations');
  }

  _createConversationItemHTML(conversation) {
    // We'll build and return an HTML string
    const dateStr = this.utils?.formatDate?.(conversation.updated_at) || conversation.updated_at;
    const handleClickAttr = `onclick="(${() => this.handleConversationClick(conversation)})()"`;
    const handleKeyAttr = `
      onkeydown="(function(e){
        if(e.key === 'Enter' || e.key === ' '){
          (${() => this.handleConversationClick(conversation)})();
        }
      })(event)"
    `;

    return `
      <div class="p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors"
        role="button" tabindex="0"
        ${handleClickAttr}
        ${handleKeyAttr}>
        <h4 class="font-medium truncate mb-1">${conversation.title || 'Untitled conversation'}</h4>
        <p class="text-sm text-base-content/70 truncate">
          ${conversation.last_message || 'No messages yet'}
        </p>
        <div class="flex justify-between mt-1 text-xs text-base-content/60">
          <span>${dateStr}</span>
          <span class="badge badge-ghost badge-sm">${conversation.message_count || 0} msgs</span>
        </div>
      </div>
    `;
  }

  async createNewChat() {
    if (!this.state.currentProject?.id) {
      this._notifyError('No project selected');
      return;
    }

    try {
      localStorage.setItem("selectedProjectId", this.state.currentProject.id);

      // Create conversation in manager
      const conversation = await this.projectManager.createConversation(this.state.currentProject.id);

      // Switch to chat tab
      this.switchTab('chat');

      // Load conversation in the chat interface
      await this._initializeChatSystem(conversation.id);

      // Update the URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      if (!newUrl.searchParams.has('project')) {
        newUrl.searchParams.set('project', this.state.currentProject.id);
      }
      window.history.pushState({}, "", newUrl);

      return conversation;
    } catch (error) {
      this._handleOperationError('createNewChat', error, {
        messageFormatter: () => `Failed to create chat: ${error.message}`
      });
      throw error;
    }
  }

  async handleConversationClick(conversation) {
    if (!conversation?.id || !this.state.currentProject?.id) {
      this._notifyError('Invalid conversation data');
      return;
    }

    try {
      localStorage.setItem("selectedProjectId", this.state.currentProject.id);
      this.switchTab('chat');

      // Attempt to initialize chat with conversation
      await this._withLoadingIndicator('conversations', async () => {
        await this._initializeChatSystem(conversation.id);
      });

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      if (!newUrl.searchParams.has('project')) {
        newUrl.searchParams.set('project', this.state.currentProject.id);
      }
      window.history.pushState({}, "", newUrl);
    } catch (err) {
      this._handleOperationError('handleConversationClick', err, {
        messageFormatter: () => `Error loading conversation: ${err.message}`
      });
    }
  }

  renderArtifacts(artifacts = []) {
    const listEl = this.elements.artifactsList;
    if (!listEl) return;

    this.showLoading('artifacts');

    if (!artifacts.length) {
      listEl.innerHTML = `
        <div class="text-base-content/70 text-center py-8">
          <p>No artifacts generated yet.</p>
        </div>
      `;
    } else {
      listEl.innerHTML = artifacts.map(a => this._createArtifactItem(a)).join('');
    }

    this.hideLoading('artifacts');
  }

  _createArtifactItem(artifact) {
    const date = this.utils?.formatDate(artifact.created_at) || artifact.created_at;
    const downloadAction = `onclick="(function(){
      const pd = window.projectDetails || window.globalProjectDetails;
      pd && pd.downloadArtifact('${artifact.id}');
    })()"`;

    return `
      <div class="p-3 border-b border-base-300 hover:bg-base-200 transition-colors">
        <div class="flex justify-between items-center">
          <h4 class="font-medium truncate">${artifact.name || 'Untitled Artifact'}</h4>
          <span class="text-xs text-base-content/60">${date}</span>
        </div>
        <p class="text-sm text-base-content/70 truncate mt-1">
          ${artifact.description || artifact.type || 'No description'}
        </p>
        <div class="mt-2 flex gap-2">
          <button class="btn btn-xs btn-outline" ${downloadAction}>Download</button>
        </div>
      </div>
    `;
  }

  async downloadArtifact(artifactId) {
    if (!artifactId || !this.state.currentProject?.id || !this.projectManager?.downloadArtifact) return;
    await this._withLoadingIndicator('artifacts', async () => {
      await this.projectManager.downloadArtifact(this.state.currentProject.id, artifactId);
    });
  }

  /* ------------------------------------------------------------------
   * Chat Interface
   * ------------------------------------------------------------------ */

  /**
   * Centralized method to initialize the chat system and optionally load a conversation.
   */
  async _initializeChatSystem(conversationId = null) {
    const container = this.elements?.chatContainer || document.getElementById('projectChatContainer');
    if (!container) {
      debugLog('[ProjectDetailsView] No chat container found');
      return false;
    }

    this._showChatLoading(container);

    try {
      // Ensure script loaded
      const loaded = await this._ensureChatInterfaceLoaded();
      if (!loaded) {
        throw new Error('Failed to load ChatInterface script');
      }

      // Attempt several strategies to get a chat instance
      const success = await this._tryChatInitMethods(conversationId);
      if (!success) {
        throw new Error('All chat initialization methods failed');
      }

      return true;
    } catch (error) {
      this._showChatError(error.message || 'Chat initialization failed');
      this._handleOperationError('_initializeChatSystem', error);
      return false;
    } finally {
      this._hideChatLoading(container);
    }
  }

  async _ensureChatInterfaceLoaded() {
    if (window.ChatInterface) {
      debugLog('[ProjectDetailsView] ChatInterface is already loaded');
      return true;
    }

    // Possible paths to attempt
    const possiblePaths = [
      '/static/js/chat-interface.js',
      '/static/js/chat/chat-interface.js',
      '/static/dist/chat-interface.js'
    ];

    for (let i = 0; i < possiblePaths.length; i++) {
      try {
        debugLog(`[ProjectDetailsView] Loading ChatInterface script from ${possiblePaths[i]}`);
        await this._loadScript(possiblePaths[i]);
        if (window.ChatInterface) {
          return true;
        }
      } catch (e) {
        console.warn(`[ProjectDetailsView] Failed to load from ${possiblePaths[i]}:`, e);
      }
    }

    // As a last attempt, see if ChatManager can load it
    if (window.ChatManager?.ensureChatInterface) {
      try {
        await window.ChatManager.ensureChatInterface();
        return Boolean(window.ChatInterface);
      } catch (err) {
        console.error('[ProjectDetailsView] ChatManager failed loading ChatInterface:', err);
      }
    }

    return false;
  }

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = (err) => {
        reject(new Error(`Failed to load script: ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  _showChatError(message) {
    const chatMessages = this.elements?.chatMessages || document.getElementById('projectChatMessages');
    if (!chatMessages) return;

    chatMessages.innerHTML = `
      <div class="flex flex-col items-center justify-center p-6 text-center">
        <div class="text-error mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 class="font-medium text-lg mb-2">Chat Initialization Failed</h3>
        <p class="text-base-content/70 mb-4">${message}</p>
        <div class="flex space-x-2">
          <button id="retryChatInitBtn" class="btn btn-sm btn-primary mr-2">Retry</button>
          <button id="refreshPageBtn" class="btn btn-sm btn-ghost">Refresh</button>
        </div>
      </div>
    `;

    // Handlers
    const retryBtn = document.getElementById('retryChatInitBtn');
    if (retryBtn) {
      this._manageListeners(retryBtn, 'click', () => this._initializeChatSystem());
    }

    const refreshBtn = document.getElementById('refreshPageBtn');
    if (refreshBtn) {
      this._manageListeners(refreshBtn, 'click', () => window.location.reload());
    }

    this._notifyError(message);
  }

  _showChatLoading(container) {
    if (!container) return;
    container.classList.add('initializing');
    const messagesEl = this.elements.chatMessages || document.getElementById('projectChatMessages');
    if (messagesEl) {
      messagesEl.innerHTML = `<div id="chatLoadingIndicator" class="flex justify-center p-4">
        <span class="loading loading-spinner loading-md"></span>
      </div>`;
    }
  }

  _hideChatLoading(container) {
    if (!container) return;
    container.classList.remove('initializing');
    const loadingEl = document.getElementById('chatLoadingIndicator');
    if (loadingEl) {
      loadingEl.remove();
    }
  }

  /* ------------------------------------------------------------------
   * Tab Navigation
   * ------------------------------------------------------------------ */
  onTabClick(event) {
    const tabBtn = event.target.closest('.tab[role="tab"]');
    if (!tabBtn || tabBtn.classList.contains('tab-disabled')) return;

    const tabName = tabBtn.dataset.tab;
    if (!tabName || this.state.activeTab === tabName) return;
    this.switchTab(tabName);
  }

  switchTab(tabName) {
    if (!tabName || this.state.activeTab === tabName) return;

    debugLog(`[ProjectDetailsComponent] Switching to tab: ${tabName}`);

    const tabContentIds = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'];
    for (const id of tabContentIds) {
      const contentEl = this.elements.tabContents[id];
      if (!contentEl) continue;
      if (id === tabName) {
        contentEl.classList.remove('hidden');
        contentEl.setAttribute('aria-hidden', 'false');
      } else {
        contentEl.classList.add('hidden');
        contentEl.setAttribute('aria-hidden', 'true');
      }
    }

    // Update tab button states
    const tabButtons = document.querySelectorAll('.tab[role="tab"]');
    tabButtons.forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('tab-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });

    this.state.activeTab = tabName;
    this._loadTabContent(tabName);
  }

  _loadTabContent(tabName) {
    const projectId = this.state.currentProject?.id;
    if (!projectId) return;

    switch (tabName) {
      case 'files':
        this.loadProjectFiles(projectId).catch(err => {
          this._handleOperationError('loadProjectFiles', err);
        });
        break;
      case 'conversations':
        this.loadProjectConversations(projectId).catch(err => {
          this._handleOperationError('loadProjectConversations', err);
        });
        break;
      case 'artifacts':
        if (this.projectManager?.loadProjectArtifacts) {
          this._withLoadingIndicator('artifacts', async () => {
            const artifacts = await this.projectManager.loadProjectArtifacts(projectId);
            this.renderArtifacts(artifacts);
          }).catch(err => {
            this._handleOperationError('loadProjectArtifacts', err);
          });
        }
        break;
      case 'knowledge':
        if (this.state.currentProject?.knowledge_base_id && this.projectManager?.loadKnowledgeBaseDetails) {
          this.projectManager.loadKnowledgeBaseDetails(this.state.currentProject.knowledge_base_id)
            .catch(err => debugLog('[ProjectDetailsComponent] KB load error:', err));
        }
        break;
      case 'chat':
        // Initialize chat if not yet
        this._initializeChatSystem().then(() => {
          // If there's a chatId in URL, load it
          const urlParams = new URLSearchParams(window.location.search);
          const chatId = urlParams.get('chatId');
          if (chatId && (this.chatInstance || window.projectChatInterface)) {
            (this.chatInstance || window.projectChatInterface).loadConversation(chatId)
              .catch(err => debugLog('[ProjectDetailsComponent] Chat load error:', err));
          } else if (this.chatInstance && !this.chatInstance.currentChatId) {
            this.createNewChat().catch(err => debugLog('[ProjectDetailsComponent] Chat creation error:', err));
          }
        });
        break;
    }
  }

  /* ------------------------------------------------------------------
   * Drag & Drop
   * ------------------------------------------------------------------ */
  handleDragEvent(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!this.elements.dragZone) return;
    switch (e.type) {
      case 'dragenter':
      case 'dragover':
        this.elements.dragZone.classList.add('drag-zone-active', 'border-primary');
        this.elements.dragZone.classList.remove('border-base-content/30');
        break;
      case 'dragleave':
      case 'drop':
        this.elements.dragZone.classList.remove('drag-zone-active', 'border-primary');
        this.elements.dragZone.classList.add('border-base-content/30');
        if (e.type === 'drop') this.handleDrop(e);
        break;
    }
  }

  async handleDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) {
      debugLog('[ProjectDetailsComponent] No files found in drop event.');
      return;
    }
    if (!this.state.currentProject?.id) {
      this._notifyError('Cannot upload: No project selected.');
      return;
    }

    try {
      await this.uploadFiles(this.state.currentProject.id, files);
    } catch (error) {
      this._handleOperationError('handleDrop', error, {
        messageFormatter: () => `File upload failed: ${error.message}`
      });
    }
  }

  /* ------------------------------------------------------------------
   * General Helpers / Utilities
   * ------------------------------------------------------------------ */

  /**
   * Reloads project data from the server
   */
  async refreshProjectData(projectId) {
    if (!projectId || !this.projectManager) return;
    debugLog(`[ProjectDetails] Refreshing data for project ${projectId}`);

    // Show loading states
    this.showLoading('files');
    this.showLoading('conversations');
    this.showLoading('artifacts');

    try {
      const promises = [
        this.projectManager.loadProjectFiles(projectId),
        this.projectManager.loadProjectStats(projectId),
        this.projectManager.loadProjectConversations(projectId),
        this.projectManager.loadProjectArtifacts(projectId)
      ];
      await Promise.allSettled(promises);
      debugLog(`[ProjectDetails] Finished refreshing data for project ${projectId}`);
    } catch (err) {
      this._handleOperationError('refreshProjectData', err, {
        messageFormatter: () => 'Failed to refresh project data'
      });
    } finally {
      this.hideLoading('files');
      this.hideLoading('conversations');
      this.hideLoading('artifacts');
    }
  }

  refreshKnowledgeBase(projectId) {
    if (this.state.currentProject?.knowledge_base_id && this.projectManager?.loadKnowledgeBaseDetails) {
      this.projectManager.loadKnowledgeBaseDetails(this.state.currentProject.knowledge_base_id)
        .catch(err => debugLog('[ProjectDetailsComponent] KB load error:', err));
    }
  }

  /**
   * Creates a small badge indicating file processing status.
   */
  _createProcessingBadge(processing = {}) {
    const statusMap = {
      success: { class: "badge-success", text: "Ready", icon: "✓" },
      error: { class: "badge-error", text: "Failed", icon: "⚠" },
      pending: { class: "badge-warning", text: "Processing...", icon: "⏳" },
      default: { class: "badge-ghost", text: "Not Processed", icon: "•" }
    };

    const status = processing.status || 'default';
    const mapping = statusMap[status] || statusMap.default;

    const badge = document.createElement('div');
    badge.className = `badge ${mapping.class} badge-sm gap-1 mt-1`;
    badge.innerHTML = `<span>${mapping.icon}</span> ${mapping.text}`;
    badge.title = processing.error || mapping.text;
    if (processing.error) {
      badge.classList.add('tooltip');
      badge.dataset.tip = processing.error;
    }
    return badge;
  }

  formatUploadErrorMessage(error, fileName) {
    if (error?.response?.status === 401 || error.message?.includes('auth')) {
      this.auth?.handleAuthError?.(error);
      return "Authentication error - please log in again";
    }

    const errorMessages = {
      "dangerous patterns": "File contains potentially unsafe content",
      "validation": "File format not supported",
      "too large": `File exceeds ${this.fileConstants.maxSizeMB}MB limit`,
      "token limit": "Project token limit exceeded",
      "422": "File validation failed",
      "default": error.message || "Upload failed"
    };

    const key = Object.keys(errorMessages).find(k =>
      error.message?.includes(k) ||
      error.response?.data?.message?.includes(k)
    );
    return errorMessages[key || "default"];
  }

  /* ------------------------------------------------------------------
   * Event Listeners & Observers
   * ------------------------------------------------------------------ */

  // Single helper to add/remove event listeners
  _manageListeners(element, type, handler, action = 'add') {
    if (!element) return;
    if (action === 'add') {
      element.addEventListener(type, handler);
    } else {
      element.removeEventListener(type, handler);
    }
  }

  /**
   * Monitors DOM for dynamic element insertions, re-initializing as needed.
   */
  _setupElementObserver() {
    if (this.templatesReady) return;

    this.elementObserver = new MutationObserver((mutations) => {
      let shouldRefreshElements = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const neededIds = [
            'projectFilesList',
            'backToProjectsBtn',
            'dragDropZone',
            'filesTab',
            'projectTitle',
            'projectDescription'
          ];

          const addedIds = Array.from(mutation.addedNodes)
            .filter(node => node.nodeType === Node.ELEMENT_NODE)
            .flatMap(el => [
              el.id ? el : null,
              ...Array.from(el.querySelectorAll?.('[id]') || [])
            ])
            .filter(Boolean)
            .map(el => el.id);

          if (addedIds.some(id => neededIds.includes(id))) {
            shouldRefreshElements = true;
            debugLog('[ProjectDetailsComponent] Detected important elements being added/changed in DOM');
          }
        }
      }

      if (shouldRefreshElements) {
        debugLog('[ProjectDetailsComponent] Re-initializing elements after DOM updates');
        this.initElements();
      }
    });

    const container = document.getElementById('projectDetailsView');
    if (container) {
      this.elementObserver.observe(container, {
        childList: true,
        subtree: true
      });
      debugLog('[ProjectDetailsComponent] Started DOM observer for #projectDetailsView');
    }
  }

  /* ------------------------------------------------------------------
   * Buttons & UI
   * ------------------------------------------------------------------ */

  updatePinButton(pinned) {
    if (!this.elements.pinBtn) return;
    const svg = this.elements.pinBtn.querySelector("svg");
    if (svg) {
      svg.setAttribute('fill', pinned ? 'currentColor' : 'none');
    }
    this.elements.pinBtn.classList.toggle('text-warning', pinned);
    this.elements.pinBtn.dataset.tip = pinned ? 'Unpin project' : 'Pin project';
    this.elements.pinBtn.classList.add('tooltip', 'tooltip-bottom');
  }

  updateArchiveButton(archived) {
    if (!this.elements.archiveBtn) return;
    this.elements.archiveBtn.classList.toggle('text-warning', archived);
    this.elements.archiveBtn.dataset.tip = archived ? 'Unarchive project' : 'Archive project';
    this.elements.archiveBtn.classList.add('tooltip', 'tooltip-bottom');
  }

  _createActionButton({ icon, colorClass, action, tooltip }) {
    if (!this.utils) return document.createElement('button');

    const button = this.utils.createElement("button", {
      className: `btn btn-ghost btn-square btn-sm ${colorClass} tooltip tooltip-left`,
      "data-tip": tooltip
    });
    button.addEventListener('click', action);

    const iconMap = {
      trash: '<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H7.862a2.25 2.25 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"/>',
      download: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />'
    };

    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24"
           stroke-width="1.5" stroke="currentColor">
        ${iconMap[icon] || ''}
      </svg>
    `;
    return button;
  }

  /* ------------------------------------------------------------------
   * Loading Indicators
   * ------------------------------------------------------------------ */

  showLoading(type) {
    if (this.elements.loadingStates?.[type]) {
      this.elements.loadingStates[type].classList.remove('hidden');
    }
  }

  hideLoading(type) {
    if (this.elements.loadingStates?.[type]) {
      this.elements.loadingStates[type].classList.add('hidden');
    }
  }

  hideAllLoadingStates() {
    Object.keys(this.elements.loadingStates || {}).forEach(key => {
      this.hideLoading(key);
    });
  }

  /**
   * Higher-order function to wrap operations with loading indicator
   */
  async _withLoadingIndicator(type, fn) {
    this.showLoading(type);
    try {
      return await fn();
    } finally {
      this.hideLoading(type);
    }
  }

  /* ------------------------------------------------------------------
   * File Upload Progress
   * ------------------------------------------------------------------ */
  _setupUploadProgress(total) {
    if (!this.elements.uploadProgress) return;
    this.elements.uploadProgress.classList.remove('hidden');
    this.showLoading('files');
    this.fileUploadStatus = { completed: 0, failed: 0, total };
    this.updateUploadProgress();
  }

  _completeUploadProcess() {
    // This can be invoked if we need final steps after upload,
    // but in this refactor we handle it inside _handleFileUpload.
  }

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    const progressContainer = this.elements.uploadProgress;
    const progressBar = this.elements.progressBar;
    const statusText = this.elements.uploadStatus;
    if (!progressContainer || !progressBar || !statusText || total === 0) return;

    const pct = Math.round((completed / total) * 100);
    progressBar.value = pct;
    progressBar.classList.remove('progress-success', 'progress-warning', 'progress-error', 'progress-info');

    if (failed > 0 && completed === total) {
      progressBar.classList.add('progress-error');
    } else if (failed > 0) {
      progressBar.classList.add('progress-warning');
    } else if (completed === total) {
      progressBar.classList.add('progress-success');
    } else {
      progressBar.classList.add('progress-info');
    }

    statusText.textContent = `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;

    if (completed < total) {
      progressContainer.classList.remove("hidden", "opacity-0");
    } else {
      // All uploads done
      setTimeout(() => {
        progressContainer.classList.add("opacity-0");
        setTimeout(() => {
          progressContainer.classList.add("hidden");
          progressContainer.classList.remove("opacity-0");
          progressBar.value = 0;
          progressBar.classList.remove('progress-success', 'progress-warning', 'progress-error');
          progressBar.classList.add('progress-info');
          statusText.textContent = '';
        }, 300);
      }, 1500);
    }
  }

  /* ------------------------------------------------------------------
   * Auth & Error Handling
   * ------------------------------------------------------------------ */

  async _verifyAuth(context) {
    let isAuthenticated = false;
    try {
      isAuthenticated = await this.auth?.isAuthenticated?.();
    } catch (err) {
      console.warn(`[ProjectDetailsComponent] Auth check failed for ${context}:`, err);
    }

    if (!isAuthenticated) {
      this._notifyWarning(`Please log in to continue (${context})`);
      if (this.auth?.handleAuthError) {
        this.auth.handleAuthError({ message: "Authentication required" }, context);
      }
    }
    return isAuthenticated;
  }

  _handleOperationError(context, error, meta = {}) {
    console.error(`[${context}]`, error);

    // 401 / auth handling
    if (error?.response?.status === 401) {
      this.auth?.handleAuthError?.(error, context);
      return;
    }

    // Format error message
    const msg = meta.messageFormatter
      ? meta.messageFormatter(error)
      : `${context} failed: ${error.message || 'Unknown error'}`;

    this._notifyError(msg);
  }

  _safeExecute(fn, operationName) {
    return (async () => {
      try {
        await fn();
        return true;
      } catch (err) {
        this._handleOperationError(operationName, err);
        return false;
      }
    })();
  }

  _clearErrorStates() {
    const errEls = document.querySelectorAll('.project-error-message');
    for (const el of errEls) {
      el.remove();
    }
  }

  _showErrorState(message) {
    const container = document.getElementById('projectDetailsView');
    if (!container) return;

    const errorEl = document.createElement('div');
    errorEl.className = 'alert alert-error project-error-message';
    errorEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2
                 m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>${message}</span>
      <button class="btn btn-sm" onclick="this.parentElement.remove()">Dismiss</button>
    `;

    if (container.firstChild) {
      container.insertBefore(errorEl, container.firstChild);
    } else {
      container.appendChild(errorEl);
    }
  }

  /* ------------------------------------------------------------------
   * Notifications
   * ------------------------------------------------------------------ */
  _notifySuccess(msg) {
    this.notification?.(msg, 'success');
  }

  _notifyError(msg) {
    this.notification?.(msg, 'error');
  }

  _notifyWarning(msg) {
    this.notification?.(msg, 'warning');
  }

  /* ------------------------------------------------------------------
   * Scrolling & Reserved Hooks
   * ------------------------------------------------------------------ */
  handleScroll() {
    // If implementing advanced virtual scrolling, do it here
  }
}

/**
 * Expose globally if needed.
 */
if (typeof window.ProjectDetailsComponent !== 'function') {
  window.ProjectDetailsComponent = ProjectDetailsComponent;
}

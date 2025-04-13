/**
 * ProjectDetailsComponent.js
 *
 * A comprehensive UI component for managing project details, files,
 * conversations, and artifacts with modern interactive features.
 *
 * Improvements Incorporated:
 * 1. Avoided event-listener memory leaks by storing bound handlers for removal.
 * 2. Reduced unnecessary debug logs and grouped them under a `DEBUG` flag.
 * 3. Applied consistent usage of `requestAnimationFrame` for smooth DOM updates.
 * 4. Minor structural cleanups for clarity and maintainability.
 */

const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

export class ProjectDetailsComponent {
  constructor(options = {}) {
    // Store bound event handlers to properly remove them in destroy():
    this.boundHandleConversationsLoaded = this.handleConversationsLoaded.bind(this);
    this.boundHandleArtifactsLoaded = this.handleArtifactsLoaded.bind(this);
    this.boundOnTabClick = this.onTabClick.bind(this);

    // Validate required callbacks
    if (!options.onBack || typeof options.onBack !== 'function') {
      console.error('[ProjectDetailsComponent] Missing required onBack callback.');
      throw new Error('onBack callback function is required');
    }

    // Initialize core properties and helpers
    this.onBack = options.onBack;
    this.utils = options.utils || window.uiUtilsInstance;
    this.projectManager = options.projectManager || window.projectManager;
    this.auth = options.auth || window.auth;
    this.notification = options.notification || window.showNotification;

    // Internal state
    this.state = {
      currentProject: null,
      activeTab: 'files',
      searchCache: new Map()
    };

    this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
    this.fileConstants = {
      allowedExtensions: [
        '.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx',
        '.py', '.js', '.html', '.css'
      ],
      maxSizeMB: 30
    };

    // Scroll and drag/drop bindings
    this.scrollHandler = this.handleScroll.bind(this);
    this.handleDragEvent = this.handleDragEvent.bind(this);

    // Basic setup
    this.initElements();
    this.bindEvents();
    this.setupDragDropHandlers();
    this.initChatInterface();
  }

  /* ------------------------------------------------------------------
   * DOM Initialization
   * ------------------------------------------------------------------ */
  initElements() {
    const getElement = (selector, required = false) => {
      const el = document.querySelector(selector);
      if (required && !el) {
        throw new Error(`Critical element not found: ${selector}`);
      }
      return el;
    };

    this.elements = {
      // Container & basic project info
      container: getElement("#projectDetailsView", true),
      title: getElement("#projectTitle"),
      description: getElement("#projectDescription"),

      // Stats
      tokenUsage: getElement("#tokenUsage"),
      maxTokens: getElement("#maxTokens"),
      tokenPercentageDisplay: getElement("#tokenPercentageDisplay"),
      tokenProgressBar: getElement("#tokenProgressBar"),
      conversationCount: getElement("#conversationCount"),
      totalMessages: getElement("#totalMessages"),

      // Files
      filesList: getElement("#projectFilesList", true),
      // File Upload
      uploadProgress: getElement("#filesUploadProgress"),
      progressBar: getElement("#fileProgressBar"),
      uploadStatus: getElement("#uploadStatus"),
      uploadBtnTrigger: getElement("#uploadFileBtnTrigger"),
      fileInput: getElement("#fileInput"),

      // Buttons
      pinBtn: getElement("#pinProjectBtn"),
      editBtn: getElement("#editProjectBtn"),
      archiveBtn: getElement("#archiveProjectBtn"),
      backBtn: getElement("#backToProjectsBtn", true),

      // Drag & Drop
      dragZone: getElement("#dragDropZone", true),

      // Loading Indicators
      loadingStates: {
        files: getElement("#filesLoading"),
        conversations: getElement("#conversationsLoading"),
        artifacts: getElement("#artifactsLoading")
      },

      // Tabs
      tabContainer: getElement('.tabs[role="tablist"]'),
      tabContents: {
        files: getElement('#filesTab'),
        knowledge: getElement('#knowledgeTab'),
        conversations: getElement('#conversationsTab'),
        artifacts: getElement('#artifactsTab'),
        chat: getElement('#chatTab')
      },

      // Conversations
      conversationsList: getElement("#projectConversationsList"),

      // Artifacts
      artifactsList: getElement("#projectArtifactsList"),

      // Chat
      chatContainer: getElement('#projectChatContainer'),
      chatMessages: getElement('#projectChatMessages'),
      chatInput: getElement('#projectChatInput'),
      chatSendBtn: getElement('#projectChatSendBtn'),
      chatTypingIndicator: getElement('#projectChatTyping')
    };
  }

  bindEvents() {
    // Back button
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener('click', this.onBack);
    }

    // Project loading events
    document.addEventListener("projectConversationsLoaded", this.boundHandleConversationsLoaded);
    document.addEventListener("projectArtifactsLoaded", this.boundHandleArtifactsLoaded);

    // Tabs (event delegation)
    if (this.elements.tabContainer) {
      // To avoid multiple attachments, check a data attribute
      if (!this.elements.tabContainer.dataset.listenerAttached) {
        this.elements.tabContainer.addEventListener('click', this.boundOnTabClick);
        this.elements.tabContainer.dataset.listenerAttached = 'true';
      }
    }

    // File upload triggers
    if (this.elements.uploadBtnTrigger && this.elements.fileInput) {
      this.elements.uploadBtnTrigger.addEventListener('click', () => {
        this.elements.fileInput.click();
      });
      this.elements.fileInput.addEventListener('change', this.handleFileSelection.bind(this));
    }
  }

  /* ------------------------------------------------------------------
   * Lifecycle Methods
   * ------------------------------------------------------------------ */
  show() {
    if (!this.elements.container) return;
    this.elements.container.classList.remove('hidden', 'opacity-0');
    this.elements.container.classList.add('block', 'opacity-100');
  }

  hide() {
    if (!this.elements.container) return;
    this.elements.container.classList.add('opacity-0');
    setTimeout(() => {
      this.elements.container.classList.add('hidden');
      this.elements.container.classList.remove('block');
    }, 150);
  }

  destroy() {
    document.removeEventListener("projectConversationsLoaded", this.boundHandleConversationsLoaded);
    document.removeEventListener("projectArtifactsLoaded", this.boundHandleArtifactsLoaded);

    if (this.elements.filesList) {
      this.elements.filesList.removeEventListener('scroll', this.scrollHandler);
    }

    if (this.elements.tabContainer && this.elements.tabContainer.dataset.listenerAttached) {
      this.elements.tabContainer.removeEventListener('click', this.boundOnTabClick);
      delete this.elements.tabContainer.dataset.listenerAttached;
    }

    if (this.elements.dragZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        this.elements.dragZone.removeEventListener(event, this.handleDragEvent);
      });
    }
  }

  /* ------------------------------------------------------------------
   * Core Rendering
   * ------------------------------------------------------------------ */
  renderProject(project) {
    if (!project || typeof project !== 'object') {
      console.error('Invalid project data');
      return;
    }

    this.state.currentProject = project;

    // Quick fade-out
    if (this.elements.container) {
      this.elements.container.classList.add('opacity-0');
    }

    // Update title & description
    if (this.elements.title) {
      this.elements.title.textContent = project.name || '';
      this.elements.title.classList.add('text-gray-900', 'dark:text-gray-100');
    }
    if (this.elements.description) {
      this.elements.description.textContent = project.description || "No description provided.";
      this.elements.description.classList.add('text-gray-600', 'dark:text-gray-300');
    }

    // Render stats, files, conversations, artifacts if present
    if (project.stats) this.renderStats(project.stats);
    if (project.conversations) this.renderConversations(project.conversations);
    if (project.files) this.renderFiles(project.files);
    if (project.artifacts) this.renderArtifacts(project.artifacts);

    this.updatePinButton(project.pinned);
    this.updateArchiveButton(project.archived);

    // Fade in
    if (this.elements.container) {
      setTimeout(() => {
        this.elements.container.classList.remove('opacity-0');
        this.elements.container.classList.add('opacity-100');
      }, 50);
    }

    // Load associated project data from server
    this.refreshProjectData(project.id);
  }

  renderStats(stats) {
    if (!stats || typeof stats !== 'object') {
      console.error('Invalid stats data');
      return;
    }

    const formatNumber = this.utils?.formatNumber || (n => n?.toString() || '0');

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
      this.elements.tokenProgressBar.classList.remove('progress-success', 'progress-warning', 'progress-error', 'progress-primary');

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
   * Files
   * ------------------------------------------------------------------ */
  renderFiles(files = []) {
    this.showLoading('files');

    const listContainer = this.elements.filesList;
    if (!listContainer) {
      this.hideLoading('files');
      return;
    }

    requestAnimationFrame(() => {
      if (!files || files.length === 0) {
        this.renderEmptyFilesState(listContainer);
      } else {
        listContainer.innerHTML = ''; // Clear
        const fragment = document.createDocumentFragment();
        files.forEach(file => {
          fragment.appendChild(this.createFileItem(file));
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

  createFileItem(file) {
    if (!file || !this.utils) return document.createElement('div');

    const item = this.utils.createElement("div", {
      className: "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-md shadow-sm hover:bg-base-200 transition-colors",
      "data-file-id": file.id
    });

    const infoDiv = this.utils.createElement("div", {
      className: "flex items-center gap-3 min-w-0 flex-1"
    });

    const icon = this.utils.createElement("span", {
      className: `text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}`
    });
    icon.innerHTML = this.utils.fileIcon(file.file_type);

    const detailDiv = this.utils.createElement("div", {
      className: "flex flex-col min-w-0 flex-1"
    });

    detailDiv.appendChild(this.utils.createElement("div", {
      className: "font-medium truncate",
      textContent: file.filename
    }));

    const sizeDate = this.utils.createElement("div", {
      className: "text-xs text-base-content/70",
      textContent: `${this.utils.formatBytes(file.file_size)} · ${this.utils.formatDate(file.created_at)}`
    });
    detailDiv.appendChild(sizeDate);

    const statusBadge = this.createProcessingBadge(file.metadata?.search_processing || {});
    detailDiv.appendChild(statusBadge);

    infoDiv.appendChild(icon);
    infoDiv.appendChild(detailDiv);

    const actions = this.utils.createElement("div", { className: "flex gap-1" });
    actions.appendChild(this.createActionButton({
      icon: "trash",
      colorClass: "btn-error",
      action: () => this.confirmDeleteFile(file),
      tooltip: "Delete file"
    }));
    actions.appendChild(this.createActionButton({
      icon: "download",
      colorClass: "btn-info",
      action: () => this.downloadFile(file),
      tooltip: "Download file"
    }));

    item.appendChild(infoDiv);
    item.appendChild(actions);
    return item;
  }

  handleFileSelection(e) {
    const files = e.target.files;
    if (files && files.length > 0 && this.state.currentProject?.id) {
      this.uploadFiles(this.state.currentProject.id, files);
    }
    e.target.value = null; // reset
  }

  async uploadFiles(projectId, files) {
    try {
      const isAuthenticated = await this.auth?.isAuthenticated();
      if (!isAuthenticated) {
        this.notification?.('Please log in to upload files', 'warning');
        return;
      }

      if (this.elements.uploadProgress) {
        this.elements.uploadProgress.classList.remove('hidden');
      }

      this.showLoading('files');
      this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
      this.updateUploadProgress();

      // Basic validation (the UI may do extra checks)
      const { validFiles, invalidFiles } = this.validateFiles(files);
      this.handleInvalidFiles(invalidFiles);
      if (validFiles.length === 0) return;

      const BATCH_SIZE = 3;
      for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
        const batch = validFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => this.processFile(projectId, file)));
      }
    } catch (error) {
      console.error('Upload failed:', error);
      this.notification?.('File upload failed', 'error');
    }
  }

  async processFile(projectId, file) {
    try {
      if (!this.projectManager?.uploadFile) {
        throw new Error('Project manager not available');
      }
      const response = await this.projectManager.uploadFile(projectId, file);
      this.fileUploadStatus.completed++;
      this.updateUploadProgress();

      this.notification?.(`${file.name} uploaded successfully`, 'success');
      // Optionally refresh knowledge base on first success
      if (this.fileUploadStatus.completed === 1) {
        this.refreshKnowledgeBase(projectId);
      }
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      this.fileUploadStatus.failed++;
      this.fileUploadStatus.completed++;
      this.updateUploadProgress();

      this.notification?.(`Failed to upload ${file.name}: ${this.formatUploadErrorMessage(error, file.name)}`, 'error');
    } finally {
      if (this.fileUploadStatus.completed === this.fileUploadStatus.total) {
        this.hideLoading('files');
        // Refresh data once at the end
        await this.refreshProjectData(projectId);
      }
    }
  }

  validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = this.fileConstants;
    const validFiles = [], invalidFiles = [];

    Array.from(files).forEach(file => {
      const fileExt = '.' + file.name.split('.').pop().toLowerCase();
      const isValidExt = allowedExtensions.includes(fileExt);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

      if (isValidExt && isValidSize) {
        validFiles.push(file);
      } else {
        const reason = !isValidExt
          ? `Invalid file type (${fileExt}). Allowed: ${allowedExtensions.join(', ')}`
          : `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB)`;
        invalidFiles.push({ file, error: reason });
      }
    });

    return { validFiles, invalidFiles };
  }

  handleInvalidFiles(invalidFiles) {
    invalidFiles.forEach(({ file, error }) => {
      this.notification?.(`Skipped ${file.name}: ${error}`, 'warning');
    });
  }

  confirmDeleteFile(file) {
    if (!file?.id || !this.state.currentProject?.id) return;

    if (this.utils?.confirmAction) {
      this.utils.confirmAction({
        title: "Delete File",
        message: `Are you sure you want to delete "${file.filename}"? This cannot be undone.`,
        confirmText: "Delete",
        confirmClass: "btn-error",
        onConfirm: () => {
          this.projectManager?.deleteFile(this.state.currentProject.id, file.id)
            .then(() => {
              this.notification?.('File deleted successfully', 'success');
              this.refreshProjectData(this.state.currentProject.id);
            })
            .catch(err => {
              console.error('Delete failed:', err);
              this.notification?.('Failed to delete file', 'error');
            });
        }
      });
    } else {
      const confirmed = confirm(`Delete ${file.filename}? This cannot be undone.`);
      if (confirmed) {
        this.projectManager?.deleteFile(this.state.currentProject.id, file.id)
          .then(() => this.refreshProjectData(this.state.currentProject.id))
          .catch(err => {
            console.error('Delete failed:', err);
            this.notification?.('Failed to delete file', 'error');
          });
      }
    }
  }

  async downloadFile(file) {
    if (!file?.id || !this.state.currentProject?.id || !this.projectManager?.downloadFile) return;
    try {
      this.showLoading('files');
      const success = await this.projectManager.downloadFile(this.state.currentProject.id, file.id);
      if (!success) throw new Error('Download failed');
    } catch (err) {
      console.error('Download error:', err);
      this.notification?.('File download failed', 'error');
    } finally {
      this.hideLoading('files');
    }
  }

  /* ------------------------------------------------------------------
   * Conversation/Artifacts
   * ------------------------------------------------------------------ */
  handleConversationsLoaded(event) {
    const conversations = event.detail?.conversations || event.detail?.data?.conversations
      || (Array.isArray(event.detail) ? event.detail : []);
    this.renderConversations(conversations);

    if (this.elements.conversationCount) {
      this.elements.conversationCount.textContent = conversations.length;
    }

    const totalMessages = conversations.reduce((sum, conv) => sum + (conv.message_count || 0), 0);
    if (this.elements.totalMessages) {
      this.elements.totalMessages.textContent = `${totalMessages} messages`;
    }
  }

  handleArtifactsLoaded(event) {
    const artifacts = event.detail?.artifacts || event.detail?.data?.artifacts
      || (Array.isArray(event.detail) ? event.detail : []);
    this.renderArtifacts(artifacts);
  }

  renderConversations(conversations = []) {
    if (!this.elements.conversationsList) return;
    this.showLoading('conversations');

    if (conversations.length === 0) {
      this.elements.conversationsList.innerHTML = `
        <div class="text-base-content/70 text-center py-8">
          <p>No conversations yet</p>
          <button class="btn btn-sm btn-outline mt-2" onclick="projectDetails.switchTab('chat')">Start Chatting</button>
        </div>
      `;
    } else {
      this.elements.conversationsList.innerHTML = conversations
        .map(conv => this.createConversationItem(conv))
        .join('');
    }
    this.hideLoading('conversations');
  }

  createConversationItem(conversation) {
    const item = document.createElement('div');
    item.className = "p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors";
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    item.onclick = () => this.handleConversationClick(conversation);
    item.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.handleConversationClick(conversation);
    };

    item.innerHTML = `
      <h4 class="font-medium truncate mb-1">${conversation.title || 'Untitled conversation'}</h4>
      <p class="text-sm text-base-content/70 truncate">
        ${conversation.last_message || 'No messages yet'}
      </p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${this.utils?.formatDate(conversation.updated_at) || conversation.updated_at}</span>
        <span class="badge badge-ghost badge-sm">${conversation.message_count || 0} msgs</span>
      </div>
    `;
    return item.outerHTML;
  }

  async handleConversationClick(conversation) {
    if (!conversation?.id || !this.state.currentProject?.id) {
      this.notification?.('Invalid conversation data', 'error');
      return;
    }

    try {
      localStorage.setItem("selectedProjectId", this.state.currentProject.id);

      this.switchTab('chat');
      const chatInstance = this.chatInstance
        || window.projectChatInterface
        || window.ChatManager?.getChatInstance?.('#projectChatContainer');

      if (!chatInstance) throw new Error('Chat system not ready');

      this.showLoading('conversations');
      const success = await chatInstance.loadConversation(conversation.id);
      if (!success) throw new Error('Failed to load conversation');

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      if (!newUrl.searchParams.has('project')) {
        newUrl.searchParams.set('project', this.state.currentProject.id);
      }
      window.history.pushState({}, "", newUrl);
    } catch (err) {
      console.error('Error loading conversation:', err);
      this.notification?.(`Error loading conversation: ${err.message}`, 'error');
    } finally {
      this.hideLoading('conversations');
    }
  }

  renderArtifacts(artifacts = []) {
    if (!this.elements.artifactsList) return;
    this.showLoading('artifacts');

    if (artifacts.length === 0) {
      this.elements.artifactsList.innerHTML = `
        <div class="text-base-content/70 text-center py-8">
          <p>No artifacts generated yet.</p>
        </div>
      `;
    } else {
      this.elements.artifactsList.innerHTML = artifacts.map(a => this.createArtifactItem(a)).join('');
    }
    this.hideLoading('artifacts');
  }

  createArtifactItem(artifact) {
    const date = this.utils?.formatDate(artifact.created_at) || '';
    return `
      <div class="p-3 border-b border-base-300 hover:bg-base-200 transition-colors">
        <div class="flex justify-between items-center">
          <h4 class="font-medium truncate">${artifact.name || 'Untitled Artifact'}</h4>
          <span class="text-xs text-base-content/60">${date}</span>
        </div>
        <p class="text-sm text-base-content/70 truncate mt-1">${artifact.description || artifact.type || 'No description'}</p>
        <div class="mt-2 flex gap-2">
          <button class="btn btn-xs btn-outline" onclick="projectDetails.downloadArtifact('${artifact.id}')">Download</button>
        </div>
      </div>
    `;
  }

  async downloadArtifact(artifactId) {
    if (!artifactId || !this.state.currentProject?.id || !this.projectManager?.downloadArtifact) return;
    try {
      this.showLoading('artifacts');
      await this.projectManager.downloadArtifact(this.state.currentProject.id, artifactId);
    } catch (err) {
      console.error("Artifact download error:", err);
      this.notification?.('Artifact download failed', 'error');
    } finally {
      this.hideLoading('artifacts');
    }
  }

  /* ------------------------------------------------------------------
   * Chat Interface
   * ------------------------------------------------------------------ */
  initChatInterface() {
    const chatOptions = {
      containerSelector: '#projectChatContainer',
      messageContainerSelector: '#projectChatMessages',
      inputSelector: '#projectChatInput',
      sendButtonSelector: '#projectChatSendBtn',
      typingIndicatorSelector: '#projectChatTyping',
      onMessageSent: this.handleMessageSent.bind(this),
      onError: this.handleChatError.bind(this),
      getProjectId: () => this.state.currentProject?.id
    };

    if (window.ChatManager?.initializeProjectChat) {
      try {
        debugLog('[ProjectDetailsView] Using ChatManager to init chat');
        window.ChatManager.initializeProjectChat('#projectChatContainer', chatOptions);
        return;
      } catch (err) {
        console.error('[ProjectDetailsView] Error initializing chat via ChatManager:', err);
      }
    } else if (window.chatInterface?.configureSelectors) {
      debugLog('[ProjectDetailsView] Using chatInterface.configureSelectors fallback');
      window.chatInterface.configureSelectors(chatOptions);
      return;
    }

    if (typeof window.ChatInterface === 'function') {
      if (!window.projectChatInterface) {
        try {
          debugLog('[ProjectDetailsView] Using direct ChatInterface');
          window.projectChatInterface = new window.ChatInterface(chatOptions);
          window.projectChatInterface.initialize();
          this.chatInstance = window.projectChatInterface;
        } catch (err) {
          console.error('[ProjectDetailsView] Failed to initialize ChatInterface:', err);
        }
      } else {
        this.chatInstance = window.projectChatInterface;
      }
    } else {
      console.debug('[ProjectDetailsView] ChatInterface/ChatManager not available - chat disabled.');
      const chatTabButton = this.elements.tabContainer?.querySelector('[data-tab="chat"]');
      if (chatTabButton) {
        chatTabButton.classList.add('hidden');
      }
    }
  }

  handleMessageSent(data) {
    debugLog('Message sent:', data);
    this.notification?.('Message sent successfully', 'success');
  }

  handleChatError(error) {
    console.error('Chat error:', error);
    this.notification?.(`Chat error: ${error.message || 'Unknown error'}`, 'error');
  }

  /* ------------------------------------------------------------------
   * Tab Switching
   * ------------------------------------------------------------------ */
  onTabClick(event) {
    const tabButton = event.target.closest('.project-tab-btn[role="tab"]');
    if (!tabButton) return;

    const tabName = tabButton.dataset.tab;
    if (tabName) {
      this.switchTab(tabName);
    }
  }

  switchTab(tabName) {
    if (!tabName || this.state.activeTab === tabName) return;

    // Hide all tab contents
    Object.values(this.elements.tabContents).forEach(content => {
      if (content) content.classList.add('hidden');
    });

    // Show the selected tab
    const newTabContent = this.elements.tabContents[tabName];
    if (newTabContent) {
      newTabContent.classList.remove('hidden');
    }

    // Update tab button states
    const tabButtons = this.elements.tabContainer?.querySelectorAll('.project-tab-btn[role="tab"]');
    if (tabButtons) {
      tabButtons.forEach(btn => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('tab-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    this.state.activeTab = tabName;
  }

  /* ------------------------------------------------------------------
   * Drag & Drop
   * ------------------------------------------------------------------ */
  setupDragDropHandlers() {
    if (!this.elements.dragZone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
      this.elements.dragZone.removeEventListener(ev, this.handleDragEvent);
      this.elements.dragZone.addEventListener(ev, this.handleDragEvent);
    });

    // Click on drag zone opens file input
    this.elements.dragZone.addEventListener('click', () => {
      if (this.elements.fileInput) {
        this.elements.fileInput.click();
      }
    });
  }

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

    const projectId = this.state.currentProject?.id;
    if (!projectId) {
      this.notification?.('Cannot upload: No project selected.', 'error');
      return;
    }

    try {
      await this.uploadFiles(projectId, files);
    } catch (error) {
      console.error('[ProjectDetailsComponent] Error uploading dropped files:', error);
      this.notification?.(`File upload failed: ${error.message}`, 'error');
    }
  }

  /* ------------------------------------------------------------------
   * Helpers & Misc
   * ------------------------------------------------------------------ */
  async refreshProjectData(projectId) {
    if (!projectId || !this.projectManager) return;

    debugLog(`[ProjectDetails] Refreshing data for project ${projectId}`);

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
      console.error("Error refreshing project data:", err);
      this.notification?.('Failed to refresh project data', 'error');
    } finally {
      // Hide spinners (some may be hidden earlier by events)
      this.hideLoading('files');
      this.hideLoading('conversations');
      this.hideLoading('artifacts');
    }
  }

  refreshKnowledgeBase(projectId) {
    if (this.state.currentProject?.knowledge_base_id && this.projectManager?.loadKnowledgeBaseDetails) {
      this.projectManager.loadKnowledgeBaseDetails(this.state.currentProject.knowledge_base_id);
    }
  }

  createProcessingBadge(processing = {}) {
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

  formatUploadErrorMessage(error) {
    if (error?.response?.status === 401 || error.message?.includes('auth')) {
      this.auth?.handleAuthError?.(error);
      return "Authentication error - please log in again";
    }

    // Basic error mapping
    const errorMessages = {
      "dangerous patterns": "File contains potentially unsafe content",
      "validation": "File format not supported",
      "too large": `File exceeds ${this.fileConstants.maxSizeMB}MB limit`,
      "token limit": "Project token limit exceeded",
      "422": "File validation failed",
      "default": error.message || "Upload failed"
    };

    const key = Object.keys(errorMessages).find(k =>
      error.message?.includes(k) || error.response?.data?.message?.includes(k)
    );
    return errorMessages[key || "default"];
  }

  createActionButton({ icon, colorClass, action, tooltip }) {
    if (!this.utils) return document.createElement('div');
    const button = this.utils.createElement("button", {
      className: `btn btn-ghost btn-square btn-sm ${colorClass} tooltip tooltip-left`,
      onclick: action,
      "data-tip": tooltip
    });

    const iconMap = {
      trash: '<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H7.862a2.25 2.25 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16"/>',
      download: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />'
    };

    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        ${iconMap[icon] || ''}
      </svg>
    `;
    return button;
  }

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

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    const progressContainer = this.elements.uploadProgress;
    const progressBar = this.elements.progressBar;
    const statusText = this.elements.uploadStatus;
    if (total === 0 || !progressContainer || !progressBar || !statusText) return;

    const percentage = Math.round((completed / total) * 100);
    progressBar.value = percentage;
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
      // Upload finished
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

  handleScroll() {
    // If implementing virtual scroll, handle it here
  }
}

// If you prefer attaching to the global window instead of an ES module:
// window.ProjectDetailsComponent = ProjectDetailsComponent;

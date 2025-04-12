/**
 * ProjectDetailsComponent - A comprehensive UI component for managing project details,
 * files, conversations, and artifacts with modern interactive features.
 */
export class ProjectDetailsComponent {
  constructor(options = {}) {
    console.log('[Debug][Constructor] ProjectDetailsComponent constructor started.'); // <-- Added log
    // Validate required options
    if (!options.onBack || typeof options.onBack !== 'function') {
      console.error('[Debug][Constructor] Missing required onBack callback.'); // <-- Added log
      throw new Error('onBack callback function is required');
    }

    // Initialize core properties
    this.onBack = options.onBack;
    this.utils = options.utils || window.uiUtilsInstance;
    this.projectManager = options.projectManager || window.projectManager;
    this.auth = options.auth || window.auth;
    this.notification = options.notification || window.showNotification;

    this.state = {
      currentProject: null,
      activeTab: 'files',
      searchCache: new Map()
    };

    this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
      maxSizeMB: 30
    };

    // Initialize scroll handler for virtual scrolling
    this.scrollHandler = this.handleScroll.bind(this);
    this.boundRenderConversations = this.renderConversations.bind(this);
    this.handleDragEvent = this.handleDragEvent.bind(this);
    this.handleDrop = this.handleDrop.bind(this);

    // Setup component
    console.log('[Debug][Constructor] Calling initElements...'); // <-- Added log
    this.initElements();
    console.log('[Debug][Constructor] Calling bindEvents...'); // <-- Added log
    this.bindEvents();
    console.log('[Debug][Constructor] Calling setupDragDropHandlers...'); // <-- Added log
    this.setupDragDropHandlers();
    console.log('[Debug][Constructor] Calling initChatInterface...'); // <-- Added log
    this.initChatInterface();
    console.log('[Debug][Constructor] ProjectDetailsComponent constructor finished.'); // <-- Added log
  }

  /* -------------------- DOM Initialization Methods -------------------- */

  initElements() {
    const getElement = (selector, required = false) => {
      const el = document.querySelector(selector);
      if (required && !el) {
        console.error(`Required element not found: ${selector}`);
      }
      return el;
    };

    this.elements = {
      container: getElement("#projectDetailsView", true),
      title: getElement("#projectTitle"),
      description: getElement("#projectDescription"),
      tokenUsage: getElement("#tokenUsage"),
      maxTokens: getElement("#maxTokens"),
      tokenPercentage: getElement("#tokenPercentage"),
      tokenProgressBar: getElement("#tokenProgressBar"),
      filesList: getElement("#projectFilesList", true),
      conversationsList: getElement("#projectConversationsList"),
      artifactsList: getElement("#projectArtifactsList"),
      uploadProgress: getElement("#filesUploadProgress"),
      progressBar: getElement("#fileProgressBar"),
      uploadStatus: getElement("#uploadStatus"),
      pinBtn: getElement("#pinProjectBtn"),
      backBtn: getElement("#backToProjectsBtn", true),
      dragZone: getElement("#dragDropZone", true),
      loadingStates: {
        files: getElement("#filesLoading"),
        search: getElement("#knowledgeSearchLoading"),
        conversations: getElement("#conversationsLoading")
      }
    };
  }

  bindEvents() {
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener('click', this.onBack);
    }

    // Listen for the custom event and bind the handler
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));

    // Hook up tab buttons to trigger switchTab whenever clicked
    console.log('[Debug][bindEvents] Starting...');

    const tabs = document.querySelectorAll('.project-tab-btn');
    console.log(`[Debug][bindEvents] Found ${tabs.length} elements with class '.project-tab-btn'.`);

    if (tabs.length === 0) {
        console.warn('[Debug][bindEvents] No tab buttons found! Event listeners cannot be attached.');
        // Optionally, try again after a short delay if elements might load late
        // setTimeout(() => this.bindEvents(), 500); // Be careful with recursive calls
        return; // Stop if no buttons found
    }

    tabs.forEach(btn => {
        console.log(`[Debug][bindEvents] Attaching handler to tab button:`, btn);
        // Check if listener already exists to prevent duplicates if bindEvents is called multiple times
        if (!btn.dataset.listenerAttached) {
            btn.addEventListener('click', () => {
                console.log(`[Debug] Tab clicked: ${btn.dataset.tab}`);
                const tabName = btn.dataset.tab;
                if (tabName) {
                  this.switchTab(tabName);
                } else {
                  console.warn('[Debug] Clicked tab button missing data-tab attribute:', btn);
                }
            });
            btn.dataset.listenerAttached = 'true'; // Mark as attached
            console.log(`[Debug][bindEvents] Listener attached to ${btn.dataset.tab}`);
        } else {
            console.log(`[Debug][bindEvents] Listener already attached to ${btn.dataset.tab}, skipping.`);
        }
    });
    console.log('[Debug][bindEvents] Finished attaching listeners.'); // <-- Added log
  }

  /* -------------------- Lifecycle Methods -------------------- */

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
    // Clean up event listeners
    document.removeEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    if (this.elements.filesList) {
      this.elements.filesList.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.elements.dragZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        this.elements.dragZone.removeEventListener(event, this.handleDragEvent);
      });
    }
  }

  // Handle the projectConversationsLoaded event
  handleConversationsLoaded(event) {
    console.log('[Debug][handleConversationsLoaded] Event received:', event);
    // Extract conversations array from event.detail
    const conversations = event.detail;
    this.renderConversations(conversations);
  }

  /* -------------------- Core Rendering Methods -------------------- */

  renderProject(project) {
    if (!project || typeof project !== 'object') {
      console.error('Invalid project data');
      return;
    }

    this.state.currentProject = project;

    if (!this.elements.container) return;
    this.elements.container.classList.add('opacity-0');

    // Update title and description
    if (this.elements.title) {
      this.elements.title.textContent = project.name || '';
      this.elements.title.classList.add('animate-fade-in');
      // Ensure proper dark mode text styling
      this.elements.title.classList.add('text-gray-900', 'dark:text-gray-100');
    }

    if (this.elements.description) {
      this.elements.description.textContent = project.description || "No description provided.";
      this.elements.description.classList.add('animate-fade-in');
      // Ensure proper dark mode text styling
      this.elements.description.classList.add('text-gray-600', 'dark:text-gray-300');
    }

    this.updatePinButton(project.pinned);

    setTimeout(() => {
      this.elements.container.classList.remove('opacity-0');
      this.elements.container.classList.add('opacity-100');
    }, 50);

    // Load associated project data
    this.refreshProjectData(project.id);
  }

  updatePinButton(pinned) {
    if (!this.elements.pinBtn) return;

    const svg = this.elements.pinBtn.querySelector("svg");
    if (svg) {
      svg.classList.toggle('[fill:none]', !pinned);
      svg.classList.toggle('[fill:currentColor]', pinned);
    }
    this.elements.pinBtn.classList.toggle('text-yellow-600', pinned);
  }

  renderStats(stats) {
    if (!stats || typeof stats !== 'object') {
      console.error('Invalid stats data');
      return;
    }

    const { tokenUsage, maxTokens, tokenPercentage, tokenProgressBar } = this.elements;
    const formatNumber = this.utils?.formatNumber || (n => n.toString());

    if (tokenUsage) {
      tokenUsage.textContent = formatNumber(stats.token_usage || 0);
      tokenUsage.classList.add('animate-count-up');
    }

    if (maxTokens) {
      maxTokens.textContent = formatNumber(stats.max_tokens || 0);
    }

    const usage = stats.token_usage || 0;
    const maxT = stats.max_tokens || 1;
    const pct = Math.min(100, (usage / maxT) * 100).toFixed(1);

    if (tokenPercentage) {
      tokenPercentage.textContent = `${pct}%`;
      tokenPercentage.classList.add('animate-count-up');
    }

    this.animateProgressBar(tokenProgressBar, pct);
  }

  /* -------------------- File Management Methods -------------------- */

  renderFiles(files = []) {
    if (!this.elements.filesList) return;

    this.showLoading('files');

    requestAnimationFrame(() => {
      if (!files || files.length === 0) {
        this.renderEmptyFilesState();
      } else {
        this.setupVirtualScroll(files);
      }
      this.hideLoading('files');
    });
  }

  renderEmptyFilesState() {
    if (!this.elements.filesList) return;

    this.elements.filesList.innerHTML = `
      <div class="text-base-content/70 text-center py-8 animate-fade-in">
        <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        </svg>
        <p class="mt-2">No files uploaded yet</p>
        <button id="uploadFileBtn" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 transition-colors">
          Upload Files
        </button>
      </div>
    `;
  }

  setupVirtualScroll(files) {
    if (!this.elements.filesList) return;

    this.elements.filesList.innerHTML = "";

    // Handle initial zero height case
    if (this.elements.filesList.clientHeight === 0) {
      setTimeout(() => this.setupVirtualScroll(files), 100);
      return;
    }

    const containerHeight = this.elements.filesList.clientHeight;
    const itemHeight = 72;
    const visibleCount = Math.ceil(containerHeight / itemHeight) + 2;

    this.virtualScroll = {
      startIndex: 0,
      endIndex: Math.min(visibleCount, files.length),
      itemHeight,
      files
    };

    this.updateVisibleFiles();
    this.elements.filesList.addEventListener('scroll', this.scrollHandler);
  }

  updateVisibleFiles() {
    if (!this.virtualScroll || !this.elements.filesList) return;

    const { startIndex, endIndex, files, itemHeight } = this.virtualScroll;
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      if (files[i]) {
        const fileItem = this.createFileItem(files[i]);
        fileItem.style.position = 'absolute';
        fileItem.style.top = `${i * itemHeight}px`;
        fragment.appendChild(fileItem);
      }
    }

    this.elements.filesList.innerHTML = '';
    this.elements.filesList.appendChild(fragment);
    this.elements.filesList.style.height = `${files.length * itemHeight}px`;
  }

  createFileItem(file) {
    if (!file || !this.utils) return document.createElement('div');

    const item = this.utils.createElement("div", {
      className: "content-item relative transition-all duration-200 hover:bg-base-200 rounded-sm",
      "data-file-id": file.id
    });

    const infoDiv = this.utils.createElement("div", {
      className: "flex items-center gap-3 p-3"
    });

    const icon = this.utils.createElement("span", {
      className: `text-xl ${file.file_type === 'pdf' ? 'text-red-500' : 'text-blue-500'}`
    });

    icon.innerHTML = this.getFileIcon(file.file_type);

    const detailDiv = this.utils.createElement("div", {
      className: "flex flex-col min-w-0 flex-1"
    });

    detailDiv.appendChild(this.utils.createElement("div", {
      className: "font-medium truncate text-gray-800 dark:text-gray-200",
      textContent: file.filename
    }));

    const sizeDate = this.utils.createElement("div", {
      className: "text-xs text-gray-500 dark:text-gray-400",
      textContent: `${this.utils.formatBytes(file.file_size)} · ${this.utils.formatDate(file.created_at)}`
    });
    detailDiv.appendChild(sizeDate);

    const statusBadge = this.createProcessingBadge(file.metadata?.search_processing || {});
    detailDiv.appendChild(statusBadge);

    infoDiv.appendChild(icon);
    infoDiv.appendChild(detailDiv);
    item.appendChild(infoDiv);

    const actions = this.utils.createElement("div", { className: "flex gap-1 pe-2" });
    actions.appendChild(this.createActionButton({
      icon: "trash",
      color: "red",
      action: () => this.confirmDeleteFile(file),
      tooltip: "Delete file"
    }));

    actions.appendChild(this.createActionButton({
      icon: "download",
      color: "blue",
      action: () => this.downloadFile(file),
      tooltip: "Download file"
    }));

    item.appendChild(actions);
    return item;
  }

  getFileIcon(fileType) {
    const iconMap = {
      pdf: `<path d="M10 8v8m4-8v4m0 4v-4m4 0h-4m-8-4h4m8 0h-4"/>`,
      txt: `<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>`,
      md: `<path d="M12 6v12m-3-3l3 3 3-3M3 6h18M3 12h18M3 18h18"/>`,
      default: `<path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>`
    };

    return `<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      ${iconMap[fileType] || iconMap.default}
    </svg>`;
  }

  /* -------------------- File Upload Methods -------------------- */

  async uploadFiles(projectId, files) {
    try {
      const isAuthenticated = await this.auth?.isAuthenticated();
      if (!isAuthenticated) {
        this.notification?.('Please log in to upload files', 'warning');
        return;
      }

      this.showLoading('files');
      this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
      this.updateUploadProgress();

      const { validFiles, invalidFiles } = this.validateFiles(files);
      this.handleInvalidFiles(invalidFiles);

      if (validFiles.length === 0) return;

      const BATCH_SIZE = 3;
      for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
        const batch = validFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => this.processFile(projectId, file)));
      }

      await this.refreshProjectData(projectId);
    } catch (error) {
      console.error('Upload failed:', error);
      this.notification?.('File upload failed', 'error');
    } finally {
      this.hideLoading('files');
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

      if (this.notification) {
        this.notification(`${file.name} uploaded successfully`, 'success');
      }

      if (this.fileUploadStatus.completed === 1) {
        this.refreshKnowledgeBase(projectId);
      }
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      this.fileUploadStatus.failed++;
      this.fileUploadStatus.completed++;
      this.updateUploadProgress();

      const errorMessage = this.formatUploadErrorMessage(error, file.name);
      this.notification?.(`Failed to upload ${file.name}: ${errorMessage}`, 'error');
    }
  }

  validateFiles(files) {
    const { allowedExtensions, maxSizeMB } = this.fileConstants;
    const validFiles = [], invalidFiles = [];

    Array.from(files).forEach(file => {
      const fileExt = `.${file.name.split('.').pop().toLowerCase()}`;
      const isValidExt = allowedExtensions.includes(fileExt);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

      if (isValidExt && isValidSize) {
        validFiles.push(file);
      } else {
        const errorMsg = !isValidExt
          ? `Invalid file type (${fileExt}). Allowed: ${allowedExtensions.join(', ')}`
          : `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB limit)`;

        invalidFiles.push({ file, error: errorMsg });
      }
    });

    return { validFiles, invalidFiles };
  }

  handleInvalidFiles(invalidFiles = []) {
    invalidFiles.forEach(({ file, error }) => {
      this.notification?.(`Skipped ${file.name}: ${error}`, 'warning');
    });
  }

  /* -------------------- UI Interaction Methods -------------------- */

  confirmDeleteFile(file) {
    if (!file?.id || !this.state.currentProject?.id) return;

    const confirmed = confirm(`Delete ${file.filename}? This cannot be undone.`);
    if (confirmed && this.projectManager?.deleteFile) {
      this.projectManager.deleteFile(this.state.currentProject.id, file.id)
        .then(() => this.refreshProjectData(this.state.currentProject.id))
        .catch(err => {
          console.error('Delete failed:', err);
          this.notification?.('Failed to delete file', 'error');
        });
    }
  }

  async downloadFile(file) {
    if (!file?.id || !this.state.currentProject?.id || !this.projectManager?.downloadFile) return;

    try {
      this.showLoading('files');
      const success = await this.projectManager.downloadFile(this.state.currentProject.id, file.id);
      if (!success) {
        throw new Error('Download failed');
      }
    } catch (err) {
      console.error('Download error:', err);
      this.notification?.('File download failed', 'error');
    } finally {
      this.hideLoading('files');
    }
  }

  switchTab(tabName) {
    console.log(`[Debug] Attempting to switch to tab: ${tabName}`);
    if (!tabName || this.state.activeTab === tabName) {
      console.log(`[Debug] Tab switch aborted: No tab name or already active (${this.state.activeTab})`);
      return;
    }

    // --- Simplified Hide/Show Logic ---

    // 1. Hide all content panels directly
    document.querySelectorAll('.project-tab-content').forEach(content => {
      if (!content.classList.contains('hidden')) {
        content.classList.add('hidden');
        console.log(`[Debug] Hid content panel: ${content.id}`);
      }
    });

    // 2. Show the target content panel directly
    const newTabContent = document.getElementById(`${tabName}Tab`);
    if (newTabContent) {
      newTabContent.classList.remove('hidden');
      console.log(`[Debug] Showed content panel: ${newTabContent.id}`);
    } else {
      console.error(`[Debug] Target tab content panel not found for ID: ${tabName}Tab`);
    }

    // --- Update Button States ---

    // 1. Deactivate all tab buttons
    document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
      tabBtn.classList.remove('active', 'text-blue-600', 'dark:text-blue-400', 'border-blue-600');
      // Add back default/inactive styles if they were removed by 'active'
      tabBtn.classList.add('text-gray-500', 'dark:text-gray-400', 'border-transparent', 'hover:text-gray-700', 'dark:hover:text-gray-300', 'hover:border-gray-300');
      tabBtn.setAttribute('aria-selected', 'false');
      tabBtn.setAttribute('tabindex', '-1'); // Make inactive tabs not focusable by default Tab key
    });

    // 2. Activate the clicked tab button
    const activeTabBtn = document.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
    if (activeTabBtn) {
      // Remove default/inactive styles before adding active ones
      activeTabBtn.classList.remove('text-gray-500', 'dark:text-gray-400', 'border-transparent', 'hover:text-gray-700', 'dark:hover:text-gray-300', 'hover:border-gray-300');
      // Add active styles
      activeTabBtn.classList.add('active', 'text-blue-600', 'dark:text-blue-400', 'border-blue-600');
      activeTabBtn.setAttribute('aria-selected', 'true');
      activeTabBtn.setAttribute('tabindex', '0'); // Make active tab focusable
      console.log(`[Debug] Activated tab button for: ${tabName}`);
    } else {
      console.warn(`[Debug] Could not find tab button for data-tab: ${tabName}`);
    }

    // Update component state
    this.state.activeTab = tabName;
    console.log(`[Debug] Updated state.activeTab to: ${tabName}`);
  }

  /* -------------------- Drag & Drop Methods -------------------- */

  setupDragDropHandlers() {
    console.log('[Debug] Setting up drag and drop handlers');
    if (!this.elements.dragZone) {
      console.warn('[Debug] Drag zone element not found');
      return;
    }

    ['dragenter', 'dragover', 'dragleave'].forEach(event => {
      this.elements.dragZone.addEventListener(event, this.handleDragEvent);
      console.log(`[Debug] Added ${event} listener to drag zone`);
    });

    // Add drop event with specific handler
    this.elements.dragZone.addEventListener('drop', this.handleDrop);
    console.log('[Debug] Added drop listener to drag zone');

    // Add click handler for file upload button if present
    const uploadBtn = document.getElementById('uploadFileBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = this.fileConstants.allowedExtensions.join(',');
        input.onchange = (e) => {
          if (e.target.files.length > 0 && this.state.currentProject?.id) {
            this.uploadFiles(this.state.currentProject.id, e.target.files);
          }
        };
        input.click();
      });
      console.log('[Debug] Added click listener to upload button');
    }
  }

  handleDragEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log(`[Debug] Drag event: ${e.type}`);
    if (this.elements.dragZone) {
      const isActive = ['dragenter', 'dragover'].includes(e.type);
      this.elements.dragZone.classList.toggle('drag-zone-active', isActive);
      console.log(`[Debug] Drag zone active: ${isActive}`);
    }
  }

  async handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Debug] Drop event triggered');

    // Remove active styling
    if (this.elements.dragZone) {
      this.elements.dragZone.classList.remove('drag-zone-active');
    }

    const files = e.dataTransfer.files;
    console.log(`[Debug] Files dropped: ${files.length}`);

    const projectId = this.state.currentProject?.id;
    if (!projectId) {
      console.error('[Debug] No current project ID available');
      return;
    }

    if (files.length > 0) {
      try {
        console.log(`[Debug] Attempting to upload ${files.length} files to project ${projectId}`);
        await this.uploadFiles(projectId, files);
      } catch (error) {
        console.error('[Debug] Error uploading files:', error);
      }
    }
  }

  /* -------------------- Chat Interface Methods -------------------- */

  initChatInterface() {
    // First attempt: Use ChatManager if available (preferred approach)
    if (window.ChatManager && typeof window.ChatManager.initializeProjectChat === 'function') {
      try {
        console.log('[ProjectDetailsView] Using ChatManager to initialize chat');
        window.ChatManager.initializeProjectChat('#projectChatUI', {
          messageContainer: '#projectChatMessages',
          inputField: '#projectChatInput',
          sendButton: '#projectChatSendBtn',
          onMessageSent: this.handleMessageSent.bind(this),
          onError: this.handleChatError.bind(this)
        });
        return;
      } catch (err) {
        console.error('[ProjectDetailsView] Could not find ChatManager.initializeProjectChat.', err);
      }
    }

    // Fallback: Use ChatInterface directly
    if (typeof window.ChatInterface !== 'function') {
      console.warn('[ProjectDetailsView] ChatInterface not available - chat functionality will be limited');
      return;
    }

    if (!window.projectChatInterface) {
      try {
        console.log('[ProjectDetailsView] Using direct ChatInterface');
        window.projectChatInterface = new window.ChatInterface({
          containerSelector: '#projectChatUI',
          messageContainerSelector: '#projectChatMessages',
          inputSelector: '#projectChatInput',
          sendButtonSelector: '#projectChatSendBtn',
          typingIndicator: true,
          readReceipts: true,
          messageStatus: true
        });

        window.projectChatInterface.on('messageSent', (data) => {
          this.handleMessageSent(data);
        });

        window.projectChatInterface.on('error', (err) => {
          this.handleChatError(err);
        });

        window.projectChatInterface.initialize();
      } catch (err) {
        console.error('[ProjectDetailsView] Failed to initialize chat interface:', err);
      }
    }
  }

  handleMessageSent(data) {
    // Handle chat message sent event
    console.log('Message sent:', data);
    if (this.notification) {
      this.notification('Message sent successfully', 'success');
    }
  }

  handleChatError(error) {
    console.error('Chat error:', error);
    if (this.notification) {
      this.notification(`Chat error: ${error.message || 'Unknown error'}`, 'error');
    }
  }

  async handleConversationClick(conversation) {
    if (!conversation?.id || !this.state.currentProject?.id) {
      this.notification?.('Invalid conversation data', 'error');
      return;
    }

    try {
      localStorage.setItem("selectedProjectId", this.state.currentProject.id);

      const chatContainer = document.getElementById('projectChatContainer');
      if (chatContainer) {
        chatContainer.classList.remove('hidden', 'opacity-0');
        chatContainer.classList.add('block', 'opacity-100');
        chatContainer.scrollIntoView({ behavior: 'smooth' });
      }

      if (!window.projectChatInterface) {
        this.notification?.('Chat system not ready', 'error');
        return;
      }

      this.showLoading('conversations');

      if (!window.projectChatInterface.initialized) {
        await window.projectChatInterface.initialize();
      }

      window.projectChatInterface.setTargetContainer('#projectChatMessages');
      const success = await window.projectChatInterface.loadConversation(conversation.id);

      if (!success) throw new Error('Failed to load conversation');

      // Update URL history
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      window.history.pushState({}, "", newUrl);
    } catch (err) {
      console.error('Error loading conversation:', err);
      this.notification?.(
        `Error loading conversation: ${err.message || 'Unknown error'}`,
        'error'
      );
    } finally {
      this.hideLoading('conversations');
    }
  }

  renderConversations(data = []) {
    if (!this.elements.conversationsList) return;

    this.showLoading('conversations');

    // Extract conversations array from different possible data formats
    let conversations = [];

    if (data && data.target && data.detail) {
      // This is an event object - extract conversations from detail
      if (Array.isArray(data.detail)) {
        conversations = data.detail;
        console.log(`[Debug][renderConversations] Extracted ${conversations.length} conversations from event.detail`);
      } else if (data.detail && Array.isArray(data.detail.conversations)) {
        conversations = data.detail.conversations;
        console.log(`[Debug][renderConversations] Extracted ${conversations.length} conversations from event.detail.conversations`);
      } else {
        console.warn('[Debug][renderConversations] Could not extract conversations from event:', data);
      }
    } else if (Array.isArray(data)) {
      // Direct array input
      conversations = data;
      console.log(`[Debug][renderConversations] Using direct array input with ${conversations.length} conversations`);
    } else if (data && Array.isArray(data.conversations)) {
      // Object with conversations property
      conversations = data.conversations;
      console.log(`[Debug][renderConversations] Extracted ${conversations.length} conversations from data.conversations`);
    }

    // Render based on extracted conversations
    if (!conversations || conversations.length === 0) {
      this.elements.conversationsList.innerHTML = `
        <div class="text-gray-500 text-center py-8">
          <p>No conversations yet</p>
        </div>
      `;
    } else {
      console.log(`[Debug][renderConversations] Rendering ${conversations.length} conversations`);
      this.elements.conversationsList.innerHTML = conversations
        .map(conv => this.createConversationItem(conv))
        .join('');
    }

    this.hideLoading('conversations');
  }

  createConversationItem(conversation) {
    return `
      <div class="conversation-item p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
           onclick="projectDetails.handleConversationClick(${JSON.stringify(conversation).replace(/"/g, '&quot;')})">
        <h4 class="font-medium truncate">${conversation.title || 'Untitled conversation'}</h4>
        <p class="text-sm text-gray-500 truncate">
          ${conversation.last_message || 'No messages yet'}
        </p>
        <div class="flex justify-between mt-1 text-xs text-gray-400">
          <span>${this.utils?.formatDate(conversation.updated_at) || conversation.updated_at}</span>
          <span>${conversation.message_count || 0} messages</span>
        </div>
      </div>
    `;
  }

  /* -------------------- Utility Methods -------------------- */

  createActionButton({ icon, color, action, tooltip }) {
    if (!this.utils) return document.createElement('div');

    const button = this.utils.createElement("button", {
      className: `p-1.5 rounded-sm text-${color}-600 hover:text-${color}-800 hover:bg-${color}-50 dark:hover:bg-${color}-900/20 transition-colors`,
      onclick: action,
      "aria-label": tooltip
    });

    const iconMap = {
      trash: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>',
      download: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>'
    };

    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        ${iconMap[icon] || ''}
      </svg>
    `;
    return button;
  }

  createProcessingBadge(processing = {}) {
    const statusMappings = {
      'success': {
        class: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300",
        text: "Ready for Search",
        icon: "✓"
      },
      'error': {
        class: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300",
        text: processing.error ? `Error: ${processing.error.substring(0, 25)}...` : 'Processing Failed',
        icon: "⚠"
      },
      'pending': {
        class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300",
        text: "Processing...",
        icon: "⏳"
      },
      'default': {
        class: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
        text: "Not Processed",
        icon: "•"
      }
    };

    const status = processing.status || 'default';
    const mapping = statusMappings[status] || statusMappings.default;

    const badge = document.createElement('div');
    badge.className = `processing-status text-xs px-2 py-1 rounded-full ${mapping.class} mt-1 flex items-center gap-1 w-fit`;
    badge.innerHTML = `<span>${mapping.icon}</span> ${mapping.text}`;
    badge.title = processing.error || mapping.text;

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

    const messageKey = Object.keys(errorMessages).find(key =>
      error.message?.includes(key) ||
      error.response?.data?.message?.includes(key)
    );

    return errorMessages[messageKey || "default"];
  }

  async refreshProjectData(projectId) {
    if (!projectId || !this.projectManager) {
      console.warn('Cannot refresh project data - no valid project ID');
      return;
    }

    try {
      await Promise.all([
        this.projectManager.loadProjectFiles(projectId),
        this.projectManager.loadProjectStats(projectId),
        this.projectManager.loadProjectConversations(projectId),
        this.projectManager.loadProjectArtifacts(projectId)
      ]);
    } catch (err) {
      console.error("Error refreshing project data:", err);
    }
  }

  refreshKnowledgeBase(projectId) {
    if (this.state.currentProject?.knowledge_base_id && this.projectManager?.loadKnowledgeBaseDetails) {
      this.projectManager.loadKnowledgeBaseDetails(
        this.state.currentProject.knowledge_base_id
      );
    }
  }

  /* -------------------- UI Helper Methods -------------------- */

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

  animateProgressBar(progressBar, percentage) {
    if (!progressBar || percentage === undefined) return;

    progressBar.style.width = "0%";
    progressBar.classList.add('transition-all', 'duration-500', 'ease-out');

    requestAnimationFrame(() => {
      progressBar.style.width = `${Math.min(100, percentage)}%`;
    });
  }

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    if (total === 0) return;

    const percentage = Math.round((completed / total) * 100);
    this.animateProgressBar(this.elements.progressBar, percentage);

    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent =
        `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;
    }

    if (completed === total) {
      setTimeout(() => {
        if (this.elements.uploadProgress) {
          this.elements.uploadProgress.classList.add("opacity-0");
          setTimeout(() => {
            this.elements.uploadProgress.classList.add("hidden");
            this.elements.uploadProgress.classList.remove("opacity-0");
          }, 300);
        }

        if (this.notification) {
          if (failed === 0) {
            this.notification("Files uploaded successfully", "success");
          } else {
            this.notification(
              `${failed} file(s) failed to upload`,
              "error",
              { timeout: 5000 }
            );
          }
        }
      }, 1000);
    }
  }

  handleScroll() {
    if (!this.virtualScroll || !this.elements.filesList) return;

    const scrollTop = this.elements.filesList.scrollTop;
    const { itemHeight, files } = this.virtualScroll;

    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(this.elements.filesList.clientHeight / itemHeight) + 2,
      files.length
    );

    if (startIndex !== this.virtualScroll.startIndex ||
      endIndex !== this.virtualScroll.endIndex) {
      this.virtualScroll.startIndex = startIndex;
      this.virtualScroll.endIndex = endIndex;
      this.updateVisibleFiles();
    }
  }
}

 // Global instantiation moved to index.html's DOMContentLoaded handler
 // to ensure DOM elements are ready.

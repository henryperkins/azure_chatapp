/**
 * projectDetailsComponent.js
 * Component for displaying project details, files, conversations and other content.
 *
 * Dependencies:
 * - window.app: Application core with state management and notifications.
 * - window.eventHandlers: Event management utilities.
 * - window.projectManager: Project operations.
 * - window.chatManager: Chat functionality.
 * - window.modalManager: Confirmation dialogs.
 * - window.FileUploadComponent: File uploads.
 */

class ProjectDetailsComponent {
  /**
   * @param {Object} options - Component options
   * @param {Function} options.onBack - Callback for back navigation
   */
  constructor(options = {}) {
    // Required options
    this.onBack = options.onBack || (() => {
      window.location.href = '/';
    });

    // State
    this.state = {
      currentProject: null,
      activeTab: 'details', // show Details by default
      isLoading: {},
      initialized: false
    };

    // File constants
    this.fileConstants = options.fileConstants || {
      allowedExtensions: ['.pdf', '.doc', '.docx', '.txt', '.csv', '.json', '.jpg', '.jpeg', '.png', '.gif', '.zip'],
      maxSizeMB: 10
    };

    // Element references
    this.elements = {
      container: null,
      title: null,
      description: null,
      backBtn: null,
      tabContainer: null,
      filesList: null,
      conversationsList: null,
      artifactsList: null,
      tabContents: {},
      loadingIndicators: {}
    };

    // Initialize file upload component
    this.fileUploadComponent = null;

    // Knowledge base component reference
    this.knowledgeBaseComponent = null;
  }

  /**
   * Initialize the component
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.state.initialized) {
      console.log('[ProjectDetailsComponent] Already initialized');
      return;
    }

    // Find DOM elements
    this._findElements();

    // Bind events
    this._bindEvents();

    this.state.initialized = true;
    console.log('[ProjectDetailsComponent] Initialized');
  }

  /**
   * Connect to the KnowledgeBaseComponent
   * @param {Object} knowledgeBaseComponent - Instance of KnowledgeBaseComponent
   */
  connectKnowledgeBase(knowledgeBaseComponent) {
    this.knowledgeBaseComponent = knowledgeBaseComponent;
    console.log('[ProjectDetailsComponent] Connected to KnowledgeBaseComponent');
  }

  /**
   * Find DOM elements
   * @private
   */
  _findElements() {
    this.elements.container = document.getElementById('projectDetailsView');
    this.elements.title = document.getElementById('projectTitle');
    this.elements.description = document.getElementById('projectDescription');
    this.elements.backBtn = document.getElementById('backToProjectsBtn');
    this.elements.tabContainer = document.querySelector('.tabs[role="tablist"]');
    this.elements.filesList = document.getElementById('projectFilesList');
    this.elements.conversationsList = document.getElementById('projectConversationsList');
    this.elements.artifactsList = document.getElementById('projectArtifactsList');

    // Tab content sections
    this.elements.tabContents = {
      details: document.getElementById('detailsTab'),
      files: document.getElementById('filesTab'),
      knowledge: document.getElementById('knowledgeTab'),
      conversations: document.getElementById('conversationsTab'),
      artifacts: document.getElementById('artifactsTab'),
      chat: document.getElementById('chatTab')
    };

    // Loading indicators
    this.elements.loadingIndicators = {
      files: document.getElementById('filesLoadingIndicator'),
      conversations: document.getElementById('conversationsLoadingIndicator'),
      artifacts: document.getElementById('artifactsLoadingIndicator')
    };

    // Initialize file upload component elements (updated to match HTML IDs for audit parity)
    this.elements.fileInput = document.getElementById('file-upload-input');
    this.elements.uploadBtn = document.getElementById('uploadFileBtn');
    this.elements.dragZone = document.getElementById('dragDropZone');
    this.elements.uploadProgress = document.getElementById('filesUploadProgress');
    this.elements.progressBar = document.getElementById('fileProgressBar');
    this.elements.uploadStatus = document.getElementById('uploadStatus');
  }

  /**
   * Bind event listeners
   * @private
   */
  _bindEvents() {
    // Back button
    if (this.elements.backBtn) {
      // Remove all previous event listeners and inline handlers from back button
      const oldBtn = this.elements.backBtn;
      const newBackBtn = oldBtn.cloneNode(true);
      // Remove any inline onclick
      newBackBtn.onclick = null;
      // Replace the button in the DOM
      oldBtn.parentNode.replaceChild(newBackBtn, oldBtn);
      this.elements.backBtn = newBackBtn;
      // Defensive: remove event listeners as well (if any)
      this.elements.backBtn.removeEventListener('click', this.onBack); // No harm if not present
      // Attach definitive event handler with a debug log
      window.eventHandlers.trackListener(this.elements.backBtn, 'click', (e) => {
        // Instrumentation for bug tracing
        console.log('[ProjectDetailsComponent] Back button clicked, triggering onBack');
        this.onBack(e);
      });
    }

    // Tab buttons
    const tabButtons = document.querySelectorAll('.project-tab-btn');
    tabButtons.forEach(button => {
      window.eventHandlers.trackListener(button, 'click', () => {
        const tabName = button.dataset.tab;
        if (tabName) {
          this.switchTab(tabName);
        }
      });
    });

    // Initialize file upload component
    if (window.FileUploadComponent) {
      this.fileUploadComponent = new window.FileUploadComponent({
        projectId: this.state.currentProject?.id,
        fileInput: this.elements.fileInput,
        uploadBtn: this.elements.uploadBtn,
        dragZone: this.elements.dragZone,
        uploadProgress: this.elements.uploadProgress,
        progressBar: this.elements.progressBar,
        uploadStatus: this.elements.uploadStatus,
        onUploadComplete: () => {
          if (this.state.currentProject?.id && window.projectManager?.loadProjectFiles) {
            window.projectManager.loadProjectFiles(this.state.currentProject.id);
          }
        }
      });
    }

    // New conversation button
    const newChatBtn = document.getElementById('projectNewConversationBtn');
    if (newChatBtn) {
      window.eventHandlers.trackListener(newChatBtn, 'click', () => {
        this.createNewChat();
      });
    }

    // Listen for events
    document.addEventListener('projectConversationsLoaded', (e) => this.renderConversations(e.detail?.conversations || []));
    document.addEventListener('projectFilesLoaded', (e) => this.renderFiles(e.detail?.files || []));
    document.addEventListener('projectArtifactsLoaded', (e) => this.renderArtifacts(e.detail?.artifacts || []));
    document.addEventListener('projectStatsLoaded', (e) => this.renderStats(e.detail || {}));
  }

  /* =========================================================================
   * PUBLIC METHODS
   * ========================================================================= */

  /**
   * Show the component
   * Simply unhides the container and re-binds events.
   * The HTML template must already be present in the DOM.
   */
  show() {
    if (!this.elements.container) return;
    this._findElements();
    this._bindEvents();
    this.elements.container.classList.remove('hidden');
  }

  /**
   * Hide the component
   */
  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add('hidden');
    }
  }

  /**
   * Render a project
   * @param {Object} project - Project data
   */
  renderProject(project) {
    if (!project || !project.id) {
      console.error('[ProjectDetailsComponent] Invalid project data');
      return;
    }

    this.state.currentProject = project;
    this._updateProjectHeader(project);

    // Automatically switch to the conversations tab
    this.switchTab('conversations');

    // Load conversations immediately
    window.projectManager?.loadProjectConversations(project.id);

    this.show();
  }

  /**
   * Switch to a different tab
   * @param {string} tabName - Tab name
   */
  switchTab(tabName) {
    const validTabs = ['details', 'files', 'knowledge', 'conversations', 'artifacts', 'chat'];
    if (!validTabs.includes(tabName)) {
      console.warn(`[ProjectDetailsComponent] Invalid tab name: ${tabName}`);
      return;
    }

    // Update tab buttons
    const tabButtons = document.querySelectorAll('.project-tab-btn');
    tabButtons.forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('tab-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Update tab content
    Object.entries(this.elements.tabContents).forEach(([tab, element]) => {
      if (element) {
        element.classList.toggle('hidden', tab !== tabName);
      }
    });

    // Store state
    this.state.activeTab = tabName;

    // Load content
    this._loadTabContent(tabName);
  }

  /**
   * Render files list
   * @param {Array} files - Files to render
   */
  renderFiles(files = []) {
    const container = this.elements.filesList;
    if (!container) return;

    if (!files.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
          <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          </svg>
          <p class="mt-2">No files uploaded yet.</p>
          <p class="text-sm mt-1">Drag & drop files or use the upload button.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    files.forEach(file => {
      const fileItem = this._createFileItem(file);
      container.appendChild(fileItem);
    });
  }

  /**
   * Render conversations list
   * @param {Array} conversations - Conversations to render
   */
  renderConversations(conversations = []) {
    const container = this.elements.conversationsList;
    if (!container) return;

    // Auto-create a chat if none exists and this is the first time for this project
    if (!conversations.length && this.state.currentProject && !this._autoCreatedConversation) {
      this._autoCreatedConversation = true;
      this.createNewChat();
      // Optionally show a "Creating your first chat..." placeholder
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
          <p>Creating your first chat...</p>
        </div>
      `;
      return;
    }

    // Reset the autocrate flag if project changes or chats are loaded
    if (conversations.length) {
      this._autoCreatedConversation = false;
    }

    if (!conversations.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
          <p>No conversations yet</p>
        </div>
      `;
      return;
    }

    // If we have conversations, clear the container first
    container.innerHTML = '';

    // Render each conversation
    conversations.forEach(conversation => {
      const item = this._createConversationItem(conversation);
      container.appendChild(item);
    });
  }

  /**
   * Render artifacts list
   * @param {Array} artifacts - Artifacts to render
   */
  renderArtifacts(artifacts = []) {
    const container = this.elements.artifactsList;
    if (!container) return;

    if (!artifacts.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
          <p>No artifacts to display</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    artifacts.forEach(artifact => {
      const artifactItem = this._createArtifactItem(artifact);
      container.appendChild(artifactItem);
    });
  }

  /**
   * Render stats
   * @param {Object} stats - Stats object
   */
  renderStats(stats) {
    // Example: update some displayed stats if needed
    if (!stats || typeof stats !== 'object') return;
    // Implement your logic here
  }

  /**
   * Create a new chat / conversation
   * This method might delegate to a chat manager
   */
  async createNewChat() {
    try {
      await window.chatManager.initialize({ projectId: this.state.currentProject?.id });
      const newConversation = await window.chatManager.createNewConversation();
      const newConversationId = newConversation.id;

      // Switch to the chat tab and load the new conversation
      localStorage.setItem('selectedProjectId', this.state.currentProject?.id);
      this.switchTab('chat');

      await window.chatManager.loadConversation(newConversationId);

      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('chatId', newConversationId);
      window.history.pushState({}, '', url.toString());
    } catch (error) {
      console.error('Error creating new chat:', error);
      window.app.showNotification('Failed to create new conversation', 'error');
    }
  }

  /* =========================================================================
   * PRIVATE METHODS
   * ========================================================================= */

  /**
   * Update project header sections
   * @param {Object} project - Project data
   * @private
   */
  _updateProjectHeader(project) {
    if (this.elements.title) {
      this.elements.title.textContent = project.title || 'Untitled Project';
    }
    if (this.elements.description) {
      this.elements.description.textContent = project.description || '';
    }
  }

  /**
   * Load content for a given tab
   * @param {string} tabName - Tab name
   * @private
   */
  async _loadTabContent(tabName) {
    if (!this.state.currentProject?.id) return;

    const projectId = this.state.currentProject.id;

    // Gracefully handle knowledge tab visibility/component
    if (this.knowledgeBaseComponent) {
      if (tabName === 'knowledge') {
        // Optionally fetch latest KB data (or rely on already-stored)
        // It expects kbData and projectId
        let kbData = null;
        // Try: use up-to-date currentProject data
        if (this.state.currentProject.knowledge_base) {
          kbData = this.state.currentProject.knowledge_base;
        }
        await this.knowledgeBaseComponent.initialize(true, kbData, projectId);
      } else {
        // Hide KB component when not active
        await this.knowledgeBaseComponent.initialize(false);
      }
    }

    switch (tabName) {
      case 'files':
        this._withLoading('files', () => {
          return window.projectManager?.loadProjectFiles?.(projectId);
        });
        break;

      case 'conversations':
        this._withLoading('conversations', () => {
          return window.projectManager?.loadProjectConversations?.(projectId);
        });
        break;

      case 'artifacts':
        this._withLoading('artifacts', () => {
          return window.projectManager?.loadProjectArtifacts?.(projectId);
        });
        break;

      case 'knowledge':
        // Previously just fetched data; now handled by KnowledgeBaseComponent.initialize
        break;

      case 'chat':
        this._initializeChat();
        break;

      default:
        break;
    }
  }

  /**
   * Initialize chat interface
   * @private
   */
  async _initializeChat() {
    try {
      await window.chatManager.initialize();
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatId');

      if (chatId) {
        await window.chatManager.loadConversation(chatId);
      } else {
        await this.createNewChat();
      }
    } catch (error) {
      console.error('[ProjectDetailsComponent] Failed to initialize chat:', error);
      window.app.showNotification('Failed to initialize chat', 'error');
    }
  }

  /**
   * Helper to perform an operation with a loading indicator
   * @param {string} section - Section name
   * @param {Function} fn - Async function to execute
   * @returns {Promise<any>}
   * @private
   */
  async _withLoading(section, fn) {
    if (this.state.isLoading[section]) return;

    this.state.isLoading[section] = true;
    this._showLoading(section);

    try {
      return await fn();
    } catch (error) {
      console.error(`[ProjectDetailsComponent] Error in ${section}:`, error);
      window.app.showNotification(`Failed to load ${section}`, 'error');
    } finally {
      this.state.isLoading[section] = false;
      this._hideLoading(section);
    }
  }

  /**
   * Show loading indicator for a section
   * @param {string} section - Section name
   * @private
   */
  _showLoading(section) {
    const indicator = this.elements.loadingIndicators[section];
    if (indicator) {
      indicator.classList.remove('hidden');
    }
  }

  /**
   * Hide loading indicator for a section
   * @param {string} section - Section name
   * @private
   */
  _hideLoading(section) {
    const indicator = this.elements.loadingIndicators[section];
    if (indicator) {
      indicator.classList.add('hidden');
    }
  }

  /**
   * Confirm and handle file deletion
   * @param {string} fileId - File ID
   * @private
   */
  _confirmDeleteFile(fileId) {
    if (!this.state.currentProject?.id) return;

    const projectId = this.state.currentProject.id;
    const files = document.querySelectorAll(`[data-file-id="${fileId}"]`);

    if (files.length === 0) return;

    const fileName = files[0].querySelector('.truncate')?.textContent || 'file';

    if (window.modalManager?.confirmAction) {
      window.modalManager.confirmAction({
        title: 'Delete File',
        message: `Are you sure you want to delete "${fileName}"? This cannot be undone.`,
        confirmText: 'Delete',
        confirmClass: 'btn-error',
        onConfirm: async () => {
          try {
            await window.projectManager.deleteFile(projectId, fileId);
            window.app.showNotification('File deleted successfully', 'success');
            await window.projectManager.loadProjectFiles(projectId);
          } catch (error) {
            console.error('Failed to delete file:', error);
            window.app.showNotification('Failed to delete file', 'error');
          }
        }
      });
    } else {
      // Fallback if no modal manager
      if (confirm(`Delete "${fileName}"? This cannot be undone.`)) {
        window.projectManager.deleteFile(projectId, fileId)
          .then(() => {
            window.app.showNotification('File deleted successfully', 'success');
            return window.projectManager.loadProjectFiles(projectId);
          })
          .catch(error => {
            console.error('Failed to delete file:', error);
            window.app.showNotification('Failed to delete file', 'error');
          });
      }
    }
  }

  /* =========================================================================
   * PRIVATE METHODS - ITEM CREATION
   * ========================================================================= */

  /**
   * Create file item
   * @param {Object} file - File data
   * @returns {HTMLElement} - File item element
   * @private
   */
  _createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between gap-3 p-3 bg-base-100 rounded-md shadow-sm hover:bg-base-200 transition-colors';
    item.dataset.fileId = file.id;

    // File icon and info
    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex items-center gap-3 min-w-0 flex-1';

    // Icon
    const icon = document.createElement('span');
    icon.className = `text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}`;
    icon.textContent = this._getFileIcon(file.file_type);

    // Details
    const detailDiv = document.createElement('div');
    detailDiv.className = 'flex flex-col min-w-0 flex-1';

    const fileName = document.createElement('div');
    fileName.className = 'font-medium truncate';
    fileName.textContent = file.filename;

    const fileInfo = document.createElement('div');
    fileInfo.className = 'text-xs text-base-content/70';
    fileInfo.textContent = `${this._formatBytes(file.file_size)} · ${this._formatDate(file.created_at)}`;

    detailDiv.appendChild(fileName);
    detailDiv.appendChild(fileInfo);

    // Add processing badge if relevant
    if (file.metadata?.search_processing) {
      const status = file.metadata.search_processing.status;
      const badgeClass = status === 'success'
        ? 'badge-success'
        : status === 'error'
          ? 'badge-error'
          : status === 'pending'
            ? 'badge-warning'
            : 'badge-ghost';

      const badgeText = status === 'success'
        ? 'Ready'
        : status === 'error'
          ? 'Failed'
          : status === 'pending'
            ? 'Processing...'
            : 'Not Processed';

      const badge = document.createElement('span');
      badge.className = `badge ${badgeClass} badge-sm`;
      badge.textContent = badgeText;
      detailDiv.appendChild(badge);
    }

    infoDiv.appendChild(icon);
    infoDiv.appendChild(detailDiv);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'flex gap-1';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-ghost btn-sm btn-square text-info hover:bg-info/10';
    downloadBtn.title = 'Download file';
    downloadBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
      </svg>
    `;
    window.eventHandlers.trackListener(downloadBtn, 'click', () => {
      if (window.projectManager?.downloadFile) {
        window.projectManager.downloadFile(this.state.currentProject.id, file.id);
      }
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost btn-sm btn-square text-error hover:bg-error/10';
    deleteBtn.title = 'Delete file';
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
      </svg>
    `;
    window.eventHandlers.trackListener(deleteBtn, 'click', () => this._confirmDeleteFile(file.id));

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(infoDiv);
    item.appendChild(actions);

    return item;
  }

  /**
   * Create conversation item
   * @param {Object} conversation - Conversation data
   * @returns {HTMLElement} - Conversation item element
   * @private
   */
  _createConversationItem(conversation) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors';

    // Title
    const title = document.createElement('h4');
    title.className = 'font-medium truncate mb-1';
    title.textContent = conversation.title || 'Untitled conversation';

    // Preview
    const preview = document.createElement('p');
    preview.className = 'text-sm text-base-content/70 truncate';
    preview.textContent = conversation.last_message || 'No messages yet';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'flex justify-between mt-1 text-xs text-base-content/60';

    const date = document.createElement('span');
    date.textContent = this._formatDate(conversation.updated_at);

    const messageCount = document.createElement('span');
    messageCount.className = 'badge badge-ghost badge-sm';
    messageCount.textContent = `${conversation.message_count || 0} msgs`;

    footer.appendChild(date);
    footer.appendChild(messageCount);

    item.appendChild(title);
    item.appendChild(preview);
    item.appendChild(footer);

    // Add click event
    window.eventHandlers.trackListener(item, 'click', () => this._handleConversationClick(conversation));

    return item;
  }

  /**
   * Create artifact item
   * @param {Object} artifact - Artifact data
   * @returns {HTMLElement} - Artifact item element
   * @private
   */
  _createArtifactItem(artifact) {
    const item = document.createElement('div');
    item.className = 'p-3 border-b border-base-300 hover:bg-base-200 transition-colors';

    // Header
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center';

    const title = document.createElement('h4');
    title.className = 'font-medium truncate';
    title.textContent = artifact.name || 'Untitled Artifact';

    const date = document.createElement('span');
    date.className = 'text-xs text-base-content/60';
    date.textContent = this._formatDate(artifact.created_at);

    header.appendChild(title);
    header.appendChild(date);

    // Description
    const description = document.createElement('p');
    description.className = 'text-sm text-base-content/70 truncate mt-1';
    description.textContent = artifact.description || artifact.type || 'No description';

    // Actions
    const actions = document.createElement('div');
    actions.className = 'mt-2 flex gap-2';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-xs btn-outline';
    downloadBtn.textContent = 'Download';
    window.eventHandlers.trackListener(downloadBtn, 'click', () => {
      if (window.projectManager?.downloadArtifact) {
        window.projectManager.downloadArtifact(this.state.currentProject.id, artifact.id);
      }
    });

    actions.appendChild(downloadBtn);

    item.appendChild(header);
    item.appendChild(description);
    item.appendChild(actions);

    return item;
  }

  /**
   * Handle conversation click
   * @param {Object} conversation - Conversation data
   * @private
   */
  async _handleConversationClick(conversation) {
    if (!conversation?.id || !this.state.currentProject?.id) {
      window.app.showNotification('Invalid conversation data', 'error');
      return;
    }

    try {
      localStorage.setItem('selectedProjectId', this.state.currentProject.id);
      this.switchTab('chat');

      await window.chatManager.initialize({ projectId: this.state.currentProject.id });
      await window.chatManager.loadConversation(conversation.id);

      const url = new URL(window.location.href);
      url.searchParams.set('chatId', conversation.id);
      window.history.pushState({}, '', url.toString());
    } catch (error) {
      console.error('Error loading conversation:', error);
      window.app.showNotification('Failed to load conversation', 'error');
    }
  }

  /* =========================================================================
   * PRIVATE METHODS - UTILITIES
   * ========================================================================= */

  /**
   * Format bytes to human-readable format
   * @param {number} bytes - Bytes to format
   * @returns {string} - Formatted size
   * @private
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Format date
   * @param {string} dateString - Date string
   * @returns {string} - Formatted date
   * @private
   */
  _formatDate(dateString) {
    if (!dateString) return '';

    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
  }

  /**
   * Get file icon based on type
   * @param {string} fileType - File type
   * @returns {string} - Icon
   * @private
   */
  _getFileIcon(fileType) {
    const icons = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      txt: '📄',
      csv: '📊',
      json: '📋',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      gif: '🖼️',
      zip: '📦'
    };

    return icons[fileType] || '📄';
  }
}

/**
 * Factory function to create a new ProjectDetailsComponent instance.
 * @param {Object} options - Component options
 * @returns {ProjectDetailsComponent} A new ProjectDetailsComponent instance.
 */
export function createProjectDetailsComponent(options = {}) {
  return new ProjectDetailsComponent(options);
}

export { ProjectDetailsComponent };

// The app.js will handle initialization and registration like:
/*
const projectDetailsComponent = createProjectDetailsComponent({
  onBack: () => {
    if (window.projectDashboard) {
      window.projectDashboard.showProjectList();
    } else {
      window.location.href = '/';
    }
  }
});
await projectDetailsComponent.initialize();
window.projectDetailsComponent = projectDetailsComponent;
DependencySystem.register('projectDetailsComponent', projectDetailsComponent);
*/

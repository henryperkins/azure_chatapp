/**
 * projectDetailsComponent.js
 * Component for displaying project details, files, conversations and other content.
 * Simplified version that delegates chat functionality to chatManager.
 */

class ProjectDetailsComponent {
  constructor(options = {}) {
    // Required options
    this.onBack = options.onBack || (() => {
      window.location.href = '/';
    });

    // State
    this.state = {
      currentProject: null,
      activeTab: 'files',
      isLoading: {}
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

    // File upload config
    this.fileConstants = {
      allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
      maxSizeMB: 30
    };

    // Find elements
    this._findElements();

    // Bind events
    this._bindEvents();

    console.log('[ProjectDetailsComponent] Initialized');
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
      files: document.getElementById('filesTabContent'),
      knowledge: document.getElementById('knowledgeTabContent'),
      conversations: document.getElementById('conversationsTabContent'),
      artifacts: document.getElementById('artifactsTabContent'),
      chat: document.getElementById('chatTabContent')
    };

    // Loading indicators
    this.elements.loadingIndicators = {
      files: document.getElementById('filesLoadingIndicator'),
      conversations: document.getElementById('conversationsLoadingIndicator'),
      artifacts: document.getElementById('artifactsLoadingIndicator')
    };

    // File upload elements
    this.elements.fileInput = document.getElementById('projectFileInput');
    this.elements.uploadBtn = document.getElementById('uploadFileBtn');
    this.elements.dragZone = document.getElementById('dragDropZone');
    this.elements.uploadProgress = document.getElementById('uploadProgressContainer');
    this.elements.progressBar = document.getElementById('uploadProgressBar');
    this.elements.uploadStatus = document.getElementById('uploadStatusText');
  }

  /**
   * Bind event listeners
   * @private
   */
  _bindEvents() {
    // Back button
    if (this.elements.backBtn) {
      window.eventHandlers.trackListener(this.elements.backBtn, 'click', this.onBack);
    }

    // Tab buttons
    const tabButtons = document.querySelectorAll('.project-tab-btn');
    tabButtons.forEach(button => {
      window.eventHandlers.trackListener(button, 'click', (e) => {
        const tabName = button.dataset.tab;
        if (tabName) {
          this.switchTab(tabName);
        }
      });
    });

    // File upload
    if (this.elements.uploadBtn && this.elements.fileInput) {
      window.eventHandlers.trackListener(this.elements.uploadBtn, 'click', () => {
        this.elements.fileInput.click();
      });

      window.eventHandlers.trackListener(this.elements.fileInput, 'change', (e) => {
        this._handleFileSelection(e);
      });
    }

    // Drag and drop
    if (this.elements.dragZone) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        window.eventHandlers.trackListener(this.elements.dragZone, eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (eventName === 'dragenter' || eventName === 'dragover') {
            this.elements.dragZone.classList.add('border-primary');
          } else {
            this.elements.dragZone.classList.remove('border-primary');

            if (eventName === 'drop') {
              this._handleFileDrop(e);
            }
          }
        });
      });

      // Click on drag zone
      window.eventHandlers.trackListener(this.elements.dragZone, 'click', () => {
        this.elements.fileInput.click();
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
   */
  show() {
    if (this.elements.container) {
      this.elements.container.classList.remove('hidden');
    }
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

    // Store reference
    this.state.currentProject = project;

    // Update UI
    this._updateProjectHeader(project);

    // Render stats if available
    if (project.stats) {
      this.renderStats(project.stats);
    }

    // Switch tab if needed
    if (!this.state.activeTab) {
      this.switchTab('files');
    }

    // Show component
    this.show();
  }

  /**
   * Switch to a different tab
   * @param {string} tabName - Tab to switch to
   */
  switchTab(tabName) {
    const validTabs = ['files', 'knowledge', 'conversations', 'artifacts', 'chat'];
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

    if (!conversations.length) {
      container.innerHTML = `
        <div class="text-center py-8 text-base-content/70">
          <p>No conversations yet</p>
          <button class="btn btn-sm btn-primary mt-2" id="newChatFromEmptyState">Create New Chat</button>
        </div>
      `;

      const newChatBtn = document.getElementById('newChatFromEmptyState');
      if (newChatBtn) {
        window.eventHandlers.trackListener(newChatBtn, 'click', () => this.createNewChat());
      }

      return;
    }

    container.innerHTML = '';

    conversations.forEach(conversation => {
      const conversationItem = this._createConversationItem(conversation);
      container.appendChild(conversationItem);
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
          <p>No artifacts generated yet.</p>
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
   * Render project stats
   * @param {Object} stats - Project stats
   */
  renderStats(stats = {}) {
    const tokenUsageEl = document.getElementById('tokenUsage');
    const maxTokensEl = document.getElementById('maxTokens');
    const tokenProgressBar = document.getElementById('tokenProgressBar');
    const conversationCountEl = document.getElementById('conversationCount');
    const totalMessagesEl = document.getElementById('totalMessages');

    // Utility for number formatting
    const formatNumber = (num) => {
      return new Intl.NumberFormat().format(num || 0);
    };

    // Update elements if they exist
    if (tokenUsageEl) {
      tokenUsageEl.textContent = formatNumber(stats.token_usage);
    }

    if (maxTokensEl) {
      maxTokensEl.textContent = formatNumber(stats.max_tokens);
    }

    if (tokenProgressBar) {
      const usage = stats.token_usage || 0;
      const maxTokens = stats.max_tokens || 1;
      const percentage = Math.min(100, Math.round((usage / maxTokens) * 100));

      tokenProgressBar.value = percentage;
      tokenProgressBar.classList.remove('progress-success', 'progress-warning', 'progress-error');

      if (percentage > 90) {
        tokenProgressBar.classList.add('progress-error');
      } else if (percentage > 75) {
        tokenProgressBar.classList.add('progress-warning');
      } else {
        tokenProgressBar.classList.add('progress-success');
      }
    }

    if (conversationCountEl) {
      conversationCountEl.textContent = formatNumber(stats.conversation_count);
    }

    if (totalMessagesEl) {
      totalMessagesEl.textContent = `${formatNumber(stats.total_messages)} messages`;
    }
  }

  /**
   * Create a new chat
   */
  async createNewChat() {
    if (!this.state.currentProject?.id) {
      window.showNotification('No project selected', 'error');
      return null;
    }

    try {
      // Set project ID in localStorage
      localStorage.setItem('selectedProjectId', this.state.currentProject.id);

      // Create conversation via project manager
      if (!window.projectManager?.createConversation) {
        throw new Error('Project manager not available');
      }

      const conversation = await window.projectManager.createConversation(this.state.currentProject.id);

      // Switch to chat tab
      this.switchTab('chat');

      // Initialize chat with the new conversation
      await window.chatManager.initialize();
      await window.chatManager.loadConversation(conversation.id);

      // Update URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      window.history.pushState({}, '', newUrl.toString());

      return conversation;
    } catch (error) {
      console.error('[ProjectDetailsComponent] Failed to create chat:', error);
      window.showNotification('Failed to create conversation', 'error');
      return null;
    }
  }

  /* =========================================================================
   * PRIVATE METHODS - UI HELPERS
   * ========================================================================= */

  /**
   * Update project header
   * @param {Object} project - Project data
   * @private
   */
  _updateProjectHeader(project) {
    if (this.elements.title) {
      this.elements.title.textContent = project.name || '';
    }

    if (this.elements.description) {
      this.elements.description.textContent = project.description || 'No description provided.';
    }

    // Update pin status
    const pinBtn = document.getElementById('pinProjectBtn');
    if (pinBtn) {
      const pinIcon = pinBtn.querySelector('svg');
      if (pinIcon) {
        pinIcon.setAttribute('fill', project.pinned ? 'currentColor' : 'none');
      }
      pinBtn.classList.toggle('text-warning', project.pinned);
    }

    // Update archive status
    const archiveBtn = document.getElementById('archiveProjectBtn');
    if (archiveBtn) {
      archiveBtn.classList.toggle('text-warning', project.archived);
    }
  }

  /**
   * Load content for active tab
   * @param {string} tabName - Tab name
   * @private
   */
  _loadTabContent(tabName) {
    if (!this.state.currentProject?.id) return;

    const projectId = this.state.currentProject.id;

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
        if (this.state.currentProject.knowledge_base_id) {
          window.projectManager?.loadKnowledgeBaseDetails?.(this.state.currentProject.knowledge_base_id);
        }
        break;

      case 'chat':
        this._initializeChat();
        break;
    }
  }

  /**
   * Initialize chat interface
   * @private
   */
  async _initializeChat() {
    try {
      // Initialize chat manager with current project
      await window.chatManager.initialize();

      // Check for chatId in URL
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatId');

      if (chatId) {
        await window.chatManager.loadConversation(chatId);
      } else {
        // Create new conversation if none exists
        await this.createNewChat();
      }
    } catch (error) {
      console.error('[ProjectDetailsComponent] Failed to initialize chat:', error);
      window.showNotification('Failed to initialize chat', 'error');
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
   * Helper to perform operation with loading indicator
   * @param {string} section - Section name
   * @param {Function} fn - Function to execute
   * @returns {Promise<any>} - Result of the function
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
      window.showNotification(`Failed to load ${section}`, 'error');
    } finally {
      this.state.isLoading[section] = false;
      this._hideLoading(section);
    }
  }

  /* =========================================================================
   * PRIVATE METHODS - FILE HANDLING
   * ========================================================================= */

  /**
   * Handle file selection from input
   * @param {Event} e - Change event
   * @private
   */
  _handleFileSelection(e) {
    if (!this.state.currentProject?.id) return;

    const files = e.target.files;
    if (!files || files.length === 0) return;

    this._uploadFiles(files);
    e.target.value = null; // Reset input
  }

  /**
   * Handle file drop
   * @param {Event} e - Drop event
   * @private
   */
  _handleFileDrop(e) {
    if (!this.state.currentProject?.id) return;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    this._uploadFiles(files);
  }

  /**
   * Upload files
   * @param {FileList} files - Files to upload
   * @private
   */
  async _uploadFiles(files) {
    if (!this.state.currentProject?.id) {
      window.showNotification('No project selected', 'error');
      return;
    }

    const { validFiles, invalidFiles } = this._validateFiles(files);

    // Handle invalid files
    invalidFiles.forEach(({ file, error }) => {
      window.showNotification(`Skipped ${file.name}: ${error}`, 'error');
    });

    if (validFiles.length === 0) return;

    // Show progress
    this._setupUploadProgress(validFiles.length);

    // Upload files in batches
    const BATCH_SIZE = 3;
    const projectId = this.state.currentProject.id;

    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(file => this._uploadFile(projectId, file)));
    }

    // Refresh project data
    if (window.projectManager?.loadProjectFiles) {
      await window.projectManager.loadProjectFiles(projectId);
    }
  }

  /**
   * Upload a single file
   * @param {string} projectId - Project ID
   * @param {File} file - File to upload
   * @returns {Promise<void>}
   * @private
   */
  async _uploadFile(projectId, file) {
    try {
      if (!window.projectManager?.uploadFile) {
        throw new Error('Upload function not available');
      }

      await window.projectManager.uploadFile(projectId, file);

      // Update progress
      this._updateUploadProgress(1, 0);

      window.showNotification(`${file.name} uploaded successfully`, 'success');
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);

      // Update progress
      this._updateUploadProgress(0, 1);

      const errorMsg = this._getUploadErrorMessage(error, file.name);
      window.showNotification(`Failed to upload ${file.name}: ${errorMsg}`, 'error');
    }
  }

  /**
   * Validate files
   * @param {FileList} files - Files to validate
   * @returns {Object} - Valid and invalid files
   * @private
   */
  _validateFiles(files) {
    const validFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      const isValidExt = this.fileConstants.allowedExtensions.includes(ext);
      const isValidSize = file.size <= this.fileConstants.maxSizeMB * 1024 * 1024;

      if (!isValidExt) {
        invalidFiles.push({
          file,
          error: `Invalid file type (${ext}). Allowed: ${this.fileConstants.allowedExtensions.join(', ')}`
        });
      } else if (!isValidSize) {
        invalidFiles.push({
          file,
          error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${this.fileConstants.maxSizeMB}MB)`
        });
      } else {
        validFiles.push(file);
      }
    }

    return { validFiles, invalidFiles };
  }

  /**
   * Set up upload progress
   * @param {number} total - Total files
   * @private
   */
  _setupUploadProgress(total) {
    this.uploadStatus = { total, completed: 0, failed: 0 };

    if (this.elements.uploadProgress) {
      this.elements.uploadProgress.classList.remove('hidden');
    }

    if (this.elements.progressBar) {
      this.elements.progressBar.value = 0;
      this.elements.progressBar.classList.remove('progress-success', 'progress-error');
      this.elements.progressBar.classList.add('progress-info');
    }

    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading 0/${total} files`;
    }
  }

  /**
   * Update upload progress
   * @param {number} success - Successful uploads
   * @param {number} failed - Failed uploads
   * @private
   */
  _updateUploadProgress(success, failed) {
    this.uploadStatus.completed += (success + failed);
    this.uploadStatus.failed += failed;

    const { total, completed, failed: totalFailed } = this.uploadStatus;

    if (this.elements.progressBar) {
      const percent = Math.round((completed / total) * 100);
      this.elements.progressBar.value = percent;

      this.elements.progressBar.classList.remove('progress-info', 'progress-success', 'progress-error');
      if (totalFailed > 0) {
        this.elements.progressBar.classList.add(totalFailed === completed ? 'progress-error' : 'progress-warning');
      } else {
        this.elements.progressBar.classList.add('progress-success');
      }
    }

    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading ${completed}/${total} files${totalFailed > 0 ? ` (${totalFailed} failed)` : ''}`;
    }

    // Hide when complete
    if (completed === total && this.elements.uploadProgress) {
      setTimeout(() => {
        this.elements.uploadProgress.classList.add('hidden');
      }, 2000);
    }
  }

  /**
   * Get error message for upload error
   * @param {Error} error - Error object
   * @param {string} fileName - File name
   * @returns {string} - Error message
   * @private
   */
  _getUploadErrorMessage(error, fileName) {
    const message = error.message || 'Unknown error';

    if (message.includes('auth') || error.status === 401) {
      return 'Authentication failed';
    }

    if (message.includes('too large') || message.includes('size')) {
      return `File exceeds ${this.fileConstants.maxSizeMB}MB limit`;
    }

    if (message.includes('token limit')) {
      return 'Project token limit exceeded';
    }

    if (message.includes('validation') || error.status === 422) {
      return 'File format not supported';
    }

    return message;
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
            window.showNotification('File deleted successfully', 'success');
            await window.projectManager.loadProjectFiles(projectId);
          } catch (error) {
            console.error('Failed to delete file:', error);
            window.showNotification('Failed to delete file', 'error');
          }
        }
      });
    } else {
      if (confirm(`Delete "${fileName}"? This cannot be undone.`)) {
        window.projectManager.deleteFile(projectId, fileId)
          .then(() => {
            window.showNotification('File deleted successfully', 'success');
            return window.projectManager.loadProjectFiles(projectId);
          })
          .catch(error => {
            console.error('Failed to delete file:', error);
            window.showNotification('Failed to delete file', 'error');
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
      const badgeClass = status === 'success' ? 'badge-success' :
        status === 'error' ? 'badge-error' :
          status === 'pending' ? 'badge-warning' : 'badge-ghost';

      const badgeText = status === 'success' ? 'Ready' :
        status === 'error' ? 'Failed' :
          status === 'pending' ? 'Processing...' : 'Not Processed';

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

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost btn-sm btn-square text-error hover:bg-error/10';
    deleteBtn.title = 'Delete file';
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    `;
    window.eventHandlers.trackListener(deleteBtn, 'click', () => this._confirmDeleteFile(file.id));

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-ghost btn-sm btn-square text-info hover:bg-info/10';
    downloadBtn.title = 'Download file';
    downloadBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    `;
    window.eventHandlers.trackListener(downloadBtn, 'click', () => {
      if (window.projectManager?.downloadFile) {
        window.projectManager.downloadFile(this.state.currentProject.id, file.id);
      }
    });

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
      window.showNotification('Invalid conversation data', 'error');
      return;
    }

    try {
      // Store project ID
      localStorage.setItem('selectedProjectId', this.state.currentProject.id);

      // Switch to chat tab
      this.switchTab('chat');

      // Load conversation in chat manager
      const chatManager = window.chatManager;
      if (chatManager) {
        await chatManager.initialize();
        await chatManager.loadConversation(conversation.id);
      } else {
        throw new Error('Chat manager not available');
      }

      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('chatId', conversation.id);
      window.history.pushState({}, '', url.toString());
    } catch (error) {
      console.error('Error loading conversation:', error);
      window.showNotification('Failed to load conversation', 'error');
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

// Export to window
window.ProjectDetailsComponent = ProjectDetailsComponent;

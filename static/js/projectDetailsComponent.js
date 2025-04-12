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
        // Optionally throw an error for critical elements
        // throw new Error(`Critical element missing: ${selector}`);
      }
      return el;
    };

    this.elements = {
      container: getElement("#projectDetailsView", true),
      title: getElement("#projectTitle"),
      description: getElement("#projectDescription"),
      // Stat elements
      tokenUsage: getElement("#tokenUsage"),
      maxTokens: getElement("#maxTokens"),
      // tokenPercentage: getElement("#tokenPercentage"), // Replaced by radial progress
      tokenPercentageDisplay: getElement("#tokenPercentageDisplay"), // DaisyUI radial progress
      tokenProgressBar: getElement("#tokenProgressBar"), // DaisyUI progress bar
      conversationCount: getElement("#conversationCount"),
      totalMessages: getElement("#totalMessages"),
      // Lists
      filesList: getElement("#projectFilesList", true), // Container for virtual scroll items
      conversationsList: getElement("#projectConversationsList"),
      artifactsList: getElement("#projectArtifactsList"),
      // File Upload
      uploadProgress: getElement("#filesUploadProgress"),
      progressBar: getElement("#fileProgressBar"), // DaisyUI progress bar
      uploadStatus: getElement("#uploadStatus"),
      uploadBtnTrigger: getElement("#uploadFileBtnTrigger"), // The visible button
      fileInput: getElement("#fileInput"), // The hidden file input
      // Buttons
      pinBtn: getElement("#pinProjectBtn"),
      editBtn: getElement("#editProjectBtn"), // Added
      archiveBtn: getElement("#archiveProjectBtn"), // Added
      backBtn: getElement("#backToProjectsBtn", true),
      // Drag & Drop
      dragZone: getElement("#dragDropZone", true),
      // Loading States (using DaisyUI loading component)
      loadingStates: {
        files: getElement("#filesLoading"),
        // search: getElement("#knowledgeSearchLoading"), // Handled by knowledgeBaseComponent
        conversations: getElement("#conversationsLoading"),
        artifacts: getElement("#artifactsLoading") // Added
      },
      // Tabs
      tabContainer: getElement('.tabs[role="tablist"]'), // Container for tabs
      tabContents: { // Map tab names to content divs
          files: getElement('#filesTab'),
          knowledge: getElement('#knowledgeTab'),
          conversations: getElement('#conversationsTab'),
          artifacts: getElement('#artifactsTab'),
          chat: getElement('#chatTab')
      },
      // Chat elements
      chatContainer: getElement('#projectChatContainer'),
      chatMessages: getElement('#projectChatMessages'),
      chatInput: getElement('#projectChatInput'),
      chatSendBtn: getElement('#projectChatSendBtn'),
      chatTypingIndicator: getElement('#projectChatTyping')
    };
  }

  bindEvents() {
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener('click', this.onBack);
    }

    // Listen for the custom event and bind the handler
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this)); // Added

    // Hook up tab buttons using event delegation on the container
    console.log('[Debug][bindEvents] Starting tab binding...');
    if (this.elements.tabContainer) {
        console.log('[Debug][bindEvents] Found tab container:', this.elements.tabContainer);
        // Check if listener already exists
        if (!this.elements.tabContainer.dataset.listenerAttached) {
            this.elements.tabContainer.addEventListener('click', (event) => {
                const tabButton = event.target.closest('.project-tab-btn[role="tab"]');
                if (tabButton) {
                    console.log(`[Debug] Tab clicked: ${tabButton.dataset.tab}`);
                    const tabName = tabButton.dataset.tab;
                    if (tabName) {
                        this.switchTab(tabName);
                    } else {
                        console.warn('[Debug] Clicked tab button missing data-tab attribute:', tabButton);
                    }
                } else {
                    // console.log('[Debug] Click was not on a tab button.');
                }
            });
            this.elements.tabContainer.dataset.listenerAttached = 'true'; // Mark as attached
            console.log('[Debug][bindEvents] Listener attached to tab container.');
        } else {
            console.log('[Debug][bindEvents] Listener already attached to tab container, skipping.');
        }
    } else {
        console.warn('[Debug][bindEvents] Tab container not found! Event listeners cannot be attached.');
    }
    console.log('[Debug][bindEvents] Finished tab binding.');

    // Bind file upload trigger
    if (this.elements.uploadBtnTrigger && this.elements.fileInput) {
       this.elements.uploadBtnTrigger.addEventListener('click', () => this.elements.fileInput.click());
       this.elements.fileInput.addEventListener('change', this.handleFileSelection.bind(this));
    }

    // Bind other buttons if needed (pin, edit, archive are handled in projectDashboardUtils.js)
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
    document.removeEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this)); // Added
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
    const conversations = event.detail?.conversations || event.detail?.data?.conversations || (Array.isArray(event.detail) ? event.detail : []);
    this.renderConversations(conversations);

    // Update conversation count in stats
    if (this.elements.conversationCount) {
       this.elements.conversationCount.textContent = conversations.length;
    }
    // Calculate total messages
    const totalMessages = conversations.reduce((sum, conv) => sum + (conv.message_count || 0), 0);
     if (this.elements.totalMessages) {
       this.elements.totalMessages.textContent = `${totalMessages} messages`;
     }
  }

   // Handle the projectArtifactsLoaded event
   handleArtifactsLoaded(event) {
     console.log('[Debug][handleArtifactsLoaded] Event received:', event);
     const artifacts = event.detail?.artifacts || event.detail?.data?.artifacts || (Array.isArray(event.detail) ? event.detail : []);
     this.renderArtifacts(artifacts);
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

    // Update stats immediately if available in project object
    if (project.stats) {
       this.renderStats(project.stats);
    }
    if (project.conversations) {
        this.renderConversations(project.conversations);
    }
    if (project.files) {
        this.renderFiles(project.files);
    }
    if (project.artifacts) {
        this.renderArtifacts(project.artifacts);
    }


    this.updatePinButton(project.pinned);
    this.updateArchiveButton(project.archived); // Added

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
      // Toggle fill based on DaisyUI theme colors potentially
      svg.setAttribute('fill', pinned ? 'currentColor' : 'none');
    }
    // Use DaisyUI tooltip
    this.elements.pinBtn.classList.toggle('text-warning', pinned); // Use warning color for pinned
    this.elements.pinBtn.dataset.tip = pinned ? 'Unpin project' : 'Pin project';
    this.elements.pinBtn.classList.add('tooltip', 'tooltip-bottom');
  }

  updateArchiveButton(archived) {
     if (!this.elements.archiveBtn) return;
     this.elements.archiveBtn.classList.toggle('text-warning', archived); // Use warning color for archived
     this.elements.archiveBtn.dataset.tip = archived ? 'Unarchive project' : 'Archive project';
     this.elements.archiveBtn.classList.add('tooltip', 'tooltip-bottom');
     // Update icon? (Optional)
  }


  renderStats(stats) {
    if (!stats || typeof stats !== 'object') {
      console.error('Invalid stats data');
      return;
    }

    // Use uiUtilsInstance for formatting if available
    const formatNumber = this.utils?.formatNumber || (n => n?.toString() || '0');

    if (this.elements.tokenUsage) {
      this.elements.tokenUsage.textContent = formatNumber(stats.token_usage);
      // Optional: Add animation class if defined in CSS
      // this.elements.tokenUsage.classList.add('animate-count-up');
    }

    if (this.elements.maxTokens) {
      this.elements.maxTokens.textContent = formatNumber(stats.max_tokens);
    }

    const usage = stats.token_usage || 0;
    const maxT = stats.max_tokens || 1; // Avoid division by zero
    const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(0) : 0; // Use integer for radial

    // Update DaisyUI radial progress
    if (this.elements.tokenPercentageDisplay) {
      this.elements.tokenPercentageDisplay.style.setProperty('--value', pct);
      this.elements.tokenPercentageDisplay.textContent = `${pct}%`;
      // Optional: Add animation class
      // this.elements.tokenPercentageDisplay.classList.add('animate-count-up');
    }

    // Update DaisyUI progress bar
    if (this.elements.tokenProgressBar) {
       this.elements.tokenProgressBar.value = pct;
       // Add color classes based on percentage
       this.elements.tokenProgressBar.classList.remove('progress-success', 'progress-warning', 'progress-error', 'progress-primary');
       if (pct > 90) {
          this.elements.tokenProgressBar.classList.add('progress-error');
       } else if (pct > 75) {
          this.elements.tokenProgressBar.classList.add('progress-warning');
       } else {
          this.elements.tokenProgressBar.classList.add('progress-primary'); // Default or success
       }
    }

     // Update file stats
     if (this.elements.fileCountDisplay) { // Renamed element ID in HTML
        this.elements.fileCountDisplay.textContent = formatNumber(stats.file_count);
     }
     if (this.elements.fileSizeDisplay) { // Renamed element ID in HTML
        this.elements.fileSizeDisplay.textContent = this.utils?.formatBytes(stats.total_size || 0) || `${stats.total_size || 0} Bytes`;
     }

     // Update conversation stats (might be updated in handleConversationsLoaded too)
     if (this.elements.conversationCount) {
        this.elements.conversationCount.textContent = formatNumber(stats.conversation_count);
     }
     if (this.elements.totalMessages) {
        this.elements.totalMessages.textContent = `${formatNumber(stats.total_messages)} messages`;
     }
  }

  /* -------------------- File Management Methods -------------------- */

  renderFiles(files = []) {
    // ... (showLoading) ...

    // Use the container meant for virtual scrolling items
    const listContainer = this.elements.filesList;
    if (!listContainer) {
       console.error("Files list container (#projectFilesList) not found.");
       this.hideLoading('files');
       return;
    }

    requestAnimationFrame(() => {
      if (!files || files.length === 0) {
        this.renderEmptyFilesState(listContainer); // Pass container
      } else {
        // For simplicity, let's render directly without virtual scroll first
        // this.setupVirtualScroll(files, listContainer);
        this.renderAllFilesDirectly(files, listContainer);
      }
      this.hideLoading('files');
    });
  }

  renderEmptyFilesState(container) { // Accept container element
    if (!container) return;
    container.innerHTML = `
      <div class="text-base-content/70 text-center py-8">
        <svg class="w-12 h-12 mx-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        </svg>
        <p class="mt-2">No files uploaded yet.</p>
        <p class="text-sm mt-1">Drag & drop files or use the upload button.</p>
        {/* Button is now outside the list */}
      </div>
    `;
  }

  // Simple rendering without virtual scroll
  renderAllFilesDirectly(files, container) {
     if (!container) return;
     container.innerHTML = ''; // Clear previous content
     const fragment = document.createDocumentFragment();
     files.forEach(file => {
        const fileItem = this.createFileItem(file);
        fragment.appendChild(fileItem);
     });
     container.appendChild(fragment);
  }


  // ... (setupVirtualScroll, updateVisibleFiles - keep if needed, but ensure container is passed) ...

  createFileItem(file) {
    if (!file || !this.utils) return document.createElement('div');

    // Use standard div, styled with Tailwind/DaisyUI
    const item = this.utils.createElement("div", {
      className: "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-md shadow-sm hover:bg-base-200 transition-colors",
      "data-file-id": file.id
    });

    const infoDiv = this.utils.createElement("div", {
      className: "flex items-center gap-3 min-w-0 flex-1" // Allow shrinking
    });

    // Use DaisyUI fileIcon util
    const icon = this.utils.createElement("span", {
      className: `text-xl ${file.file_type === 'pdf' ? 'text-error' : 'text-primary'}` // Example colors
    });
    icon.innerHTML = this.utils.fileIcon(file.file_type); // Use util

    const detailDiv = this.utils.createElement("div", {
      className: "flex flex-col min-w-0 flex-1" // Allow shrinking
    });

    detailDiv.appendChild(this.utils.createElement("div", {
      className: "font-medium truncate", // Rely on base text color
      textContent: file.filename
    }));

    const sizeDate = this.utils.createElement("div", {
      className: "text-xs text-base-content/70", // Use secondary text color
      textContent: `${this.utils.formatBytes(file.file_size)} · ${this.utils.formatDate(file.created_at)}`
    });
    detailDiv.appendChild(sizeDate);

    // Add processing badge using DaisyUI badge component
    const statusBadge = this.createProcessingBadge(file.metadata?.search_processing || {});
    detailDiv.appendChild(statusBadge);

    infoDiv.appendChild(icon);
    infoDiv.appendChild(detailDiv);

    // Action buttons using DaisyUI btn component
    const actions = this.utils.createElement("div", { className: "flex gap-1" });
    actions.appendChild(this.createActionButton({
      icon: "trash", // Keep icon name simple
      colorClass: "btn-error", // DaisyUI color class
      action: () => this.confirmDeleteFile(file),
      tooltip: "Delete file"
    }));

    actions.appendChild(this.createActionButton({
      icon: "download", // Keep icon name simple
      colorClass: "btn-info", // DaisyUI color class
      action: () => this.downloadFile(file),
      tooltip: "Download file"
    }));

    item.appendChild(infoDiv);
    item.appendChild(actions);
    return item;
  }

  /* -------------------- File Upload Methods -------------------- */

   // Handle file selection from the hidden input
   handleFileSelection(event) {
      const files = event.target.files;
      if (files && files.length > 0 && this.state.currentProject?.id) {
         this.uploadFiles(this.state.currentProject.id, files);
      }
      // Reset input value to allow selecting the same file again
      event.target.value = null;
   }


  async uploadFiles(projectId, files) {
    try {
      const isAuthenticated = await this.auth?.isAuthenticated();
      if (!isAuthenticated) {
        this.notification?.('Please log in to upload files', 'warning');
        return;
      }

      // Show progress bar section
      if (this.elements.uploadProgress) {
         this.elements.uploadProgress.classList.remove('hidden');
      }
      this.showLoading('files'); // Show spinner in list area
      this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
      this.updateUploadProgress(); // Initialize progress bar UI

      const { validFiles, invalidFiles } = this.validateFiles(files);
      this.handleInvalidFiles(invalidFiles);

      if (validFiles.length === 0) return;

      const BATCH_SIZE = 3;
      for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
        const batch = validFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => this.processFile(projectId, file)));
      }

      // No finally block needed here, hideLoading is called within processFile or error handling
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
      // Don't hide loading spinner here, wait for all files
      this.updateUploadProgress(); // Update progress bar

      if (this.notification) {
        this.notification(`${file.name} uploaded successfully`, 'success');
      }

      if (this.fileUploadStatus.completed === 1) {
        this.refreshKnowledgeBase(projectId);
      }
    } catch (error) {
      console.error(`Upload error for ${file.name}:`, error);
      this.fileUploadStatus.failed++;
      this.fileUploadStatus.completed++; // Count failed as completed for progress bar
      this.updateUploadProgress(); // Update progress bar

      const errorMessage = this.formatUploadErrorMessage(error, file.name);
      this.notification?.(`Failed to upload ${file.name}: ${errorMessage}`, 'error');
    } finally {
       // Check if all files (including failed) are processed
       if (this.fileUploadStatus.completed === this.fileUploadStatus.total) {
          this.hideLoading('files'); // Hide spinner only when all are done
          // Hide progress bar after a delay (handled in updateUploadProgress)
          await this.refreshProjectData(projectId); // Refresh data once at the end
       }
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

    // Use global modal manager
    if (this.utils?.confirmAction) { // Assuming confirmAction is moved to utils
       this.utils.confirmAction({
          title: "Delete File",
          message: `Are you sure you want to delete "${file.filename}"? This cannot be undone.`,
          confirmText: "Delete",
          confirmClass: "btn-error", // DaisyUI class
          onConfirm: () => {
             if (this.projectManager?.deleteFile) {
               this.projectManager.deleteFile(this.state.currentProject.id, file.id)
                 .then(() => {
                    this.notification?.('File deleted successfully', 'success');
                    this.refreshProjectData(this.state.currentProject.id);
                 })
                 .catch(err => {
                   console.error('Delete failed:', err);
                   this.notification?.('Failed to delete file', 'error');
                 });
             }
          }
       });
    } else { // Fallback
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

    // --- Hide/Show Content Panels ---
    Object.values(this.elements.tabContents).forEach(content => {
        if (content) content.classList.add('hidden');
    });

    const newTabContent = this.elements.tabContents[tabName];
    if (newTabContent) {
        newTabContent.classList.remove('hidden');
        console.log(`[Debug] Showed content panel for: ${tabName}`);
    } else {
        console.error(`[Debug] Target tab content panel not found for: ${tabName}`);
    }

    // --- Update Button States ---
    const tabButtons = this.elements.tabContainer?.querySelectorAll('.project-tab-btn[role="tab"]');
    if (tabButtons) {
        tabButtons.forEach(tabBtn => {
            const isTargetTab = tabBtn.dataset.tab === tabName;
            tabBtn.classList.toggle('tab-active', isTargetTab); // Use DaisyUI active class
            tabBtn.setAttribute('aria-selected', isTargetTab ? 'true' : 'false');
        });
        console.log(`[Debug] Updated tab button states for: ${tabName}`);
    } else {
        console.warn(`[Debug] Could not find tab buttons to update state.`);
    }

    // Update component state
    this.state.activeTab = tabName;
    console.log(`[Debug] Updated state.activeTab to: ${tabName}`);

    // Load data if switching to a tab that needs it (optional, depends on flow)
    // Example: if (tabName === 'conversations' && !this.conversationsLoaded) this.loadConversations();
  }


  /* -------------------- Drag & Drop Methods -------------------- */

  setupDragDropHandlers() {
    console.log('[Debug] Setting up drag and drop handlers');
    if (!this.elements.dragZone) {
      console.warn('[Debug] Drag zone element not found');
      return;
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
       // Use a single handler and check type inside
       this.elements.dragZone.removeEventListener(event, this.handleDragEvent); // Remove previous if any
       this.elements.dragZone.addEventListener(event, this.handleDragEvent);
       console.log(`[Debug] Added ${event} listener to drag zone`);
    });

    // Click handler for the zone itself to trigger file input
    this.elements.dragZone.addEventListener('click', () => {
       if (this.elements.fileInput) {
          this.elements.fileInput.click();
       }
    });
    console.log('[Debug] Added click listener to drag zone');
  }

  handleDragEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log(`[Debug] Drag event: ${e.type}`);

    if (!this.elements.dragZone) return;

    switch (e.type) {
      case 'dragenter':
      case 'dragover':
        this.elements.dragZone.classList.add('drag-zone-active', 'border-primary'); // Add DaisyUI color
        this.elements.dragZone.classList.remove('border-base-content/30');
        break;
      case 'dragleave':
      case 'drop':
        this.elements.dragZone.classList.remove('drag-zone-active', 'border-primary');
        this.elements.dragZone.classList.add('border-base-content/30');
        break;
    }

    // Handle drop separately
    if (e.type === 'drop') {
      this.handleDrop(e);
    }
  }

  async handleDrop(e) {
    // Prevention is already done in handleDragEvent
    console.log('[Debug] Drop event triggered');

    const files = e.dataTransfer?.files;
    console.log(`[Debug] Files dropped: ${files?.length || 0}`);

    const projectId = this.state.currentProject?.id;
    if (!projectId) {
      console.error('[Debug] No current project ID available');
      this.notification?.('Cannot upload: No project selected.', 'error');
      return;
    }

    if (files && files.length > 0) {
      try {
        console.log(`[Debug] Attempting to upload ${files.length} files to project ${projectId}`);
        await this.uploadFiles(projectId, files);
      } catch (error) {
        console.error('[Debug] Error uploading files:', error);
        this.notification?.(`File upload failed: ${error.message || 'Unknown error'}`, 'error');
      }
    } else {
       console.log('[Debug] No files found in drop event.');
    }
  }


  /* -------------------- Chat Interface Methods -------------------- */

  initChatInterface() {
    // Use selectors matching the updated HTML
    const chatOptions = {
        containerSelector: '#projectChatContainer', // Main container for chat UI
        messageContainerSelector: '#projectChatMessages',
        inputSelector: '#projectChatInput',
        sendButtonSelector: '#projectChatSendBtn',
        typingIndicatorSelector: '#projectChatTyping', // Optional typing indicator element
        onMessageSent: this.handleMessageSent.bind(this),
        onError: this.handleChatError.bind(this),
        // Add projectId or other context needed by ChatManager/ChatInterface
        getProjectId: () => this.state.currentProject?.id
    };

    // Prefer ChatManager if available
    if (window.ChatManager && typeof window.ChatManager.initializeProjectChat === 'function') {
        try {
            console.log('[ProjectDetailsView] Using ChatManager to initialize chat');
            // Assuming ChatManager handles the ChatInterface instance internally
            window.ChatManager.initializeProjectChat(chatOptions);
            // Store reference if needed, e.g., for loading conversations later
            // this.chatInstance = window.ChatManager.getChatInstance('#projectChatContainer');
            return;
        } catch (err) {
            console.error('[ProjectDetailsView] Error initializing chat via ChatManager:', err);
            // Fallback to direct ChatInterface if manager fails
        }
    }

    // Fallback: Use ChatInterface directly
    if (typeof window.ChatInterface === 'function') {
        if (!window.projectChatInterface) { // Avoid re-initializing
            try {
                console.log('[ProjectDetailsView] Using direct ChatInterface');
                window.projectChatInterface = new window.ChatInterface(chatOptions);
                // Assuming ChatInterface has an initialize method
                window.projectChatInterface.initialize();
                this.chatInstance = window.projectChatInterface; // Store reference
            } catch (err) {
                console.error('[ProjectDetailsView] Failed to initialize direct ChatInterface:', err);
            }
        } else {
             this.chatInstance = window.projectChatInterface; // Use existing instance
        }
    } else {
        console.warn('[ProjectDetailsView] ChatInterface or ChatManager not available - chat functionality disabled.');
        // Optionally hide the chat tab/button
        const chatTabButton = this.elements.tabContainer?.querySelector('[data-tab="chat"]');
        if (chatTabButton) chatTabButton.classList.add('hidden');
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

      // Switch to chat tab first
      this.switchTab('chat');

      // Ensure chat instance is available
      const chatInstance = this.chatInstance || window.projectChatInterface || window.ChatManager?.getChatInstance?.('#projectChatContainer');
      if (!chatInstance) {
         throw new Error('Chat system not ready');
      }

      this.showLoading('conversations'); // Or a dedicated chat loading state

      // Assuming chat instance has a loadConversation method
      const success = await chatInstance.loadConversation(conversation.id);

      if (!success) throw new Error('Failed to load conversation via chat instance');

      // Update URL history
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      // Ensure project ID is also in URL if switching tabs
      if (!newUrl.searchParams.has('project')) {
         newUrl.searchParams.set('project', this.state.currentProject.id);
      }
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

  renderConversations(conversations = []) { // Default to empty array
    if (!this.elements.conversationsList) return;

    this.showLoading('conversations');

    // No need to extract, assume input is already the array
    console.log(`[Debug][renderConversations] Rendering ${conversations.length} conversations`);

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
    // Use more semantic HTML and DaisyUI classes if applicable
    const item = document.createElement('div');
    item.className = "p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors";
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.onclick = () => this.handleConversationClick(conversation);
    item.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') this.handleConversationClick(conversation); };

    item.innerHTML = `
        <h4 class="font-medium truncate mb-1">${conversation.title || 'Untitled conversation'}</h4>
        <p class="text-sm text-base-content/70 truncate">
          ${conversation.last_message || 'No messages yet'}
        </p>
        <div class="flex justify-between mt-1 text-xs text-base-content/60">
          <span>${this.utils?.formatDate(conversation.updated_at) || conversation.updated_at}</span>
          <span class="badge badge-ghost badge-sm">${conversation.message_count || 0} messages</span>
        </div>
    `;
    return item.outerHTML; // Return as string for innerHTML joining
  }

   renderArtifacts(artifacts = []) {
      const container = this.elements.artifactsList;
      if (!container) return;

      this.showLoading('artifacts');

      if (artifacts.length === 0) {
         container.innerHTML = `
           <div class="text-base-content/70 text-center py-8">
             <p>No artifacts generated yet.</p>
           </div>
         `;
      } else {
         container.innerHTML = artifacts.map(artifact => this.createArtifactItem(artifact)).join('');
      }

      this.hideLoading('artifacts');
   }

   createArtifactItem(artifact) {
      // Example structure - adjust based on artifact properties
      return `
         <div class="p-3 border-b border-base-300 hover:bg-base-200 transition-colors">
           <div class="flex justify-between items-center">
              <h4 class="font-medium truncate">${artifact.name || 'Untitled Artifact'}</h4>
              <span class="text-xs text-base-content/60">${this.utils?.formatDate(artifact.created_at)}</span>
           </div>
           <p class="text-sm text-base-content/70 truncate mt-1">${artifact.description || artifact.type || 'No description'}</p>
           <div class="mt-2 flex gap-2">
              <button class="btn btn-xs btn-outline" onclick="projectDetails.downloadArtifact('${artifact.id}')">Download</button>
              {/* Add other actions as needed */}
           </div>
         </div>
      `;
   }

   async downloadArtifact(artifactId) {
      if (!artifactId || !this.state.currentProject?.id || !this.projectManager?.downloadArtifact) return;
      try {
         this.showLoading('artifacts');
         await this.projectManager.downloadArtifact(this.state.currentProject.id, artifactId);
         // Notification handled by download function potentially
      } catch (err) {
         console.error("Artifact download error:", err);
         this.notification?.('Artifact download failed', 'error');
      } finally {
         this.hideLoading('artifacts');
      }
   }


  /* -------------------- Utility Methods -------------------- */

  createActionButton({ icon, colorClass, action, tooltip }) {
    if (!this.utils) return document.createElement('div');

    // Use DaisyUI button classes
    const button = this.utils.createElement("button", {
      // Base classes + specific color + size
      className: `btn btn-ghost btn-square btn-sm ${colorClass || ''} tooltip tooltip-left`,
      onclick: action,
      "data-tip": tooltip // Use data-tip for DaisyUI tooltip
    });

    const iconMap = {
      trash: '<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H7.862a2.25 2.25 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>',
      download: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />'
      // Add other icons if needed
    };

    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        ${iconMap[icon] || ''}
      </svg>
    `;
    return button;
  }

  createProcessingBadge(processing = {}) {
    const statusMappings = {
      'success': { class: "badge-success", text: "Ready", icon: "✓" },
      'error': { class: "badge-error", text: processing.error ? `Error` : 'Failed', icon: "⚠" },
      'pending': { class: "badge-warning", text: "Processing...", icon: "⏳" },
      'default': { class: "badge-ghost", text: "Not Processed", icon: "•" }
    };

    const status = processing.status || 'default';
    const mapping = statusMappings[status] || statusMappings.default;

    // Use DaisyUI badge component
    const badge = document.createElement('div');
    // Add size modifier, e.g., badge-sm
    badge.className = `badge ${mapping.class} badge-sm gap-1 mt-1`;
    badge.innerHTML = `<span>${mapping.icon}</span> ${mapping.text}`;
    // Use tooltip for detailed error message
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

    const messageKey = Object.keys(errorMessages).find(key =>
      error.message?.includes(key) ||
      error.response?.data?.message?.includes(key)
    );

    return errorMessages[messageKey || "default"];
  }

  async refreshProjectData(projectId) {
    if (!projectId || !this.projectManager) {
      console.warn('Cannot refresh project data - no valid project ID or manager');
      return;
    }

    console.log(`[ProjectDetails] Refreshing data for project ${projectId}`);
    // Show loading states for relevant sections
    this.showLoading('files');
    this.showLoading('conversations');
    this.showLoading('artifacts');
    // KB loading is handled internally by its component

    try {
      // Fetch data concurrently
      const promises = [
        this.projectManager.loadProjectFiles(projectId),
        this.projectManager.loadProjectStats(projectId),
        this.projectManager.loadProjectConversations(projectId),
        this.projectManager.loadProjectArtifacts(projectId)
        // KB details are usually loaded via projectLoaded or statsLoaded events
      ];

      // Wait for all essential data to load
      await Promise.all(promises);
      console.log(`[ProjectDetails] Finished refreshing data for project ${projectId}`);

    } catch (err) {
      console.error("Error refreshing project data:", err);
      this.notification?.('Failed to refresh project data', 'error');
      // Optionally hide loading states on error, or show error messages in sections
    } finally {
       // Hide loading states - events might also hide them, but this is a fallback
       this.hideLoading('files');
       this.hideLoading('conversations');
       this.hideLoading('artifacts');
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
      // Ensure parent container doesn't hide the loading state
      const parent = this.elements.loadingStates[type].closest('.project-tab-content');
      // parent?.classList.remove('hidden'); // This might show wrong tab, handle visibility separately
    }
  }

  hideLoading(type) {
    if (this.elements.loadingStates?.[type]) {
      this.elements.loadingStates[type].classList.add('hidden');
    }
  }

  // animateProgressBar removed, using direct value setting for DaisyUI progress

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    const progressContainer = this.elements.uploadProgress;
    const progressBar = this.elements.progressBar;
    const statusText = this.elements.uploadStatus;

    if (total === 0 || !progressContainer || !progressBar || !statusText) return;

    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Update DaisyUI progress bar value
    progressBar.value = percentage;
    progressBar.classList.remove('progress-success', 'progress-warning', 'progress-error', 'progress-info');
    if (failed > 0 && completed === total) {
       progressBar.classList.add('progress-error');
    } else if (failed > 0) {
       progressBar.classList.add('progress-warning');
    } else if (completed === total) {
       progressBar.classList.add('progress-success');
    } else {
       progressBar.classList.add('progress-info'); // Default during upload
    }


    statusText.textContent =
      `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;

    // Show/Hide logic
    if (completed < total) {
       progressContainer.classList.remove("hidden", "opacity-0");
    } else { // Upload finished (success or fail)
      setTimeout(() => {
        progressContainer.classList.add("opacity-0");
        setTimeout(() => {
          progressContainer.classList.add("hidden");
          progressContainer.classList.remove("opacity-0"); // Reset opacity for next time
          // Reset progress bar value after hiding
          progressBar.value = 0;
          progressBar.classList.remove('progress-success', 'progress-warning', 'progress-error');
          progressBar.classList.add('progress-info');
          statusText.textContent = ''; // Clear status text
        }, 300); // Match transition duration

        // Final notification handled elsewhere (e.g., in processFile)
      }, 1500); // Keep visible for a bit longer after completion
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

// Export class if using modules
// export { ProjectDetailsComponent };

// Make it globally available if not using modules
window.ProjectDetailsComponent = ProjectDetailsComponent;

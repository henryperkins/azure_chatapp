/**
 * projectDetailsComponent.js
 * -----------------------
 * Component for handling project details view and operations
 */

(function() {
  /**
   * Project Details Component - Handles the project details view
   */
  class ProjectDetailsComponent {
    /**
     * Initialize the project details component
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
      // Add WebSocket connection for processing updates
      if (window.projectManager?.currentProject?.id) {
        this._setupProcessingWS(window.projectManager.currentProject.id);
      }
      /* ===========================
         STATE MANAGEMENT
         =========================== */
      this.onBack = options.onBack;
      this.state = {
        currentProject: null,
        activeTab: 'files'
      };
      this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };

      /* ===========================
         ELEMENT REFERENCES
         =========================== */
      this.elements = {
        container: document.getElementById("projectDetailsView"),
        title: document.getElementById("projectTitle"),
        description: document.getElementById("projectDescription"),
        tokenUsage: document.getElementById("tokenUsage"),
        maxTokens: document.getElementById("maxTokens"),
        tokenPercentage: document.getElementById("tokenPercentage"),
        tokenProgressBar: document.getElementById("tokenProgressBar"),
        filesList: document.getElementById("projectFilesList"),
        conversationsList: document.getElementById("projectConversationsList"),
        artifactsList: document.getElementById("projectArtifactsList"),
        uploadProgress: document.getElementById("filesUploadProgress"),
        progressBar: document.getElementById("fileProgressBar"),
        uploadStatus: document.getElementById("uploadStatus"),
        pinBtn: document.getElementById("pinProjectBtn"),
        backBtn: document.getElementById("backToProjectsBtn"),
        dragZone: document.getElementById("dragDropZone")
      };

      console.log('ProjectDetailsComponent elements initialized');
      
      this._bindEvents();
      this._setupDragDropHandlers();
      
      // Initialize chat interface only if available
      this._initializeChatInterface();
      
      // Listen for conversation loaded events
      document.addEventListener("projectConversationsLoaded", (e) => {
        this.renderConversations(e.detail);
      });
    }

    /* ===========================
       PUBLIC METHODS
       =========================== */
    
    /**
     * Show the project details view
     */
    show() {
      window.uiUtilsInstance.toggleVisibility(this.elements.container, true);
    }

    /**
     * Hide the project details view
     */
    hide() {
      if (window.uiUtilsInstance?.toggleVisibility) {
        window.uiUtilsInstance.toggleVisibility(this.elements.container, false);
      } else {
        // Fallback implementation
        if (this.elements.container) {
          this.elements.container.classList.add('hidden');
        }
      }
    }

    /**
     * Render project information
     * @param {Object} project - Project data to render
     */
    renderProject(project) {
      this.state.currentProject = project;
      
      if (this.elements.title) {
        this.elements.title.textContent = project.name;
      }
      if (this.elements.description) {
        this.elements.description.textContent = project.description || "No description provided.";
      }
      
      if (this.elements.pinBtn) {
        const svg = this.elements.pinBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", project.pinned ? "currentColor" : "none");
        this.elements.pinBtn.classList.toggle("text-yellow-600", project.pinned);
      }
    }

    /**
     * Render project stats
     * @param {Object} stats - Project stats data
     */
    renderStats(stats) {
      if (this.elements.tokenUsage) {
        this.elements.tokenUsage.textContent = window.uiUtilsInstance.formatNumber(stats.token_usage || 0);
      }
      if (this.elements.maxTokens) {
        this.elements.maxTokens.textContent = window.uiUtilsInstance.formatNumber(stats.max_tokens || 0);
      }
      
      const usage = stats.token_usage || 0;
      const maxT = stats.max_tokens || 0;
      const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;
      
      if (this.elements.tokenPercentage) {
        this.elements.tokenPercentage.textContent = `${pct}%`;
      }
      
      if (this.elements.tokenProgressBar) {
        this.elements.tokenProgressBar.style.width = "0%"; // Reset to ensure animation works
        
        // Add defensive check for animationUtilsInstance
        if (window.animationUtilsInstance) {
          window.animationUtilsInstance.animateProgress(
            this.elements.tokenProgressBar,
            0,
            pct
          );
        } else {
          // Fallback if animation utils not available
          this.elements.tokenProgressBar.style.width = `${pct}%`;
        }
      }

      // Update file, conversation and artifact counts
      this._updateCounters(stats);
    }

    /**
     * Render project files
     * @param {Array} files - Project files to render
     */
    renderFiles(files) {
      if (!this.elements.filesList) return;
      
      if (!files || files.length === 0) {
        this.elements.filesList.innerHTML = `
          <div class="text-gray-500 text-center py-8">No files uploaded yet.</div>
        `;
        return;
      }
      
      this.elements.filesList.innerHTML = "";
      
      files.forEach(file => {
        const item = window.uiUtilsInstance.createElement("div", {
          className: "content-item",
          "data-file-id": file.id
        });
        
        // Info section
        const infoDiv = window.uiUtilsInstance.createElement("div", { className: "flex items-center" });
        infoDiv.appendChild(window.uiUtilsInstance.createElement("span", {
          className: "text-lg mr-2",
          textContent: window.uiUtilsInstance.fileIcon(file.file_type)
        }));
        
        const detailDiv = window.uiUtilsInstance.createElement("div", { className: "flex flex-col" });
        detailDiv.appendChild(window.uiUtilsInstance.createElement("div", {
          className: "font-medium",
          textContent: file.filename
        }));
        detailDiv.appendChild(window.uiUtilsInstance.createElement("div", {
          className: "text-xs text-gray-500",
          textContent: `${window.uiUtilsInstance.formatBytes(file.file_size)} · ${window.uiUtilsInstance.formatDate(file.created_at)}`
        }));

        // Add processing status badge
        const processing = file.metadata?.search_processing || {};
        const statusBadge = this._createProcessingBadge(processing);
        detailDiv.appendChild(statusBadge);
        
        infoDiv.appendChild(detailDiv);
        item.appendChild(infoDiv);
        
        // Actions section
        const actions = window.uiUtilsInstance.createElement("div", { className: "flex space-x-2" });
        actions.appendChild(window.uiUtilsInstance.createElement("button", {
          className: "text-red-600 hover:text-red-800",
          innerHTML: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                       a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                       a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          `,
          onclick: () => this._confirmDeleteFile(file)
        }));
        
        item.appendChild(actions);
        this.elements.filesList.appendChild(item);
      });
    }

    /**
     * Render project conversations
     * @param {Array} conversations - Project conversations to render
     */
    renderConversations(conversations) {
      if (!this.elements.conversationsList) return;
      
      // Handle both raw array and event detail format
      const convos = Array.isArray(conversations) ? conversations : [];
      
      if (!convos || convos.length === 0) {
        this.elements.conversationsList.innerHTML = `
          <div class="text-gray-500 text-center py-8">No conversations yet.</div>
        `;
        return;
      }
      
      this.elements.conversationsList.innerHTML = "";
      
      conversations.forEach(conversation => {
        this._renderConversationItem(conversation);
      });
    }
    
    /**
     * Render project artifacts
     * @param {Array} artifacts - Project artifacts to render
     */
    renderArtifacts(artifacts) {
      if (!this.elements.artifactsList) return;
      
      if (!artifacts || artifacts.length === 0) {
        this.elements.artifactsList.innerHTML = `
          <div class="text-gray-500 text-center py-8">No artifacts created yet.</div>
        `;
        return;
      }
      
      this.elements.artifactsList.innerHTML = "";
      
      artifacts.forEach(artifact => {
        const item = window.uiUtilsInstance.createElement("div", {
          className: "content-item"
        });
        
        // Info section
        const infoDiv = window.uiUtilsInstance.createElement("div", { className: "flex items-center" });
        infoDiv.appendChild(window.uiUtilsInstance.createElement("span", {
          className: "text-lg mr-2",
          textContent: "📄"
        }));
        
        const detailDiv = window.uiUtilsInstance.createElement("div", { className: "flex flex-col" });
        detailDiv.appendChild(window.uiUtilsInstance.createElement("div", {
          className: "font-medium",
          textContent: artifact.title || "Untitled artifact"
        }));
        detailDiv.appendChild(window.uiUtilsInstance.createElement("div", {
          className: "text-xs text-gray-500",
          textContent: `${artifact.type || "Unknown type"} · ${window.uiUtilsInstance.formatDate(artifact.created_at)}`
        }));
        
        infoDiv.appendChild(detailDiv);
        item.appendChild(infoDiv);
        
        // Actions section
        const actions = window.uiUtilsInstance.createElement("div", { className: "flex space-x-2" });
        
        // View button
        actions.appendChild(window.uiUtilsInstance.createElement("button", {
          className: "text-blue-600 hover:text-blue-800",
          innerHTML: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                       -1.274 4.057-5.064 7-9.542 7
                       -4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          `,
          onclick: () => this._viewArtifact(artifact)
        }));
        
        // Delete button
        actions.appendChild(window.uiUtilsInstance.createElement("button", {
          className: "text-red-600 hover:text-red-800",
          innerHTML: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                       a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                       a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          `,
          onclick: () => this._confirmDeleteArtifact(artifact)
        }));
        
        item.appendChild(actions);
        this.elements.artifactsList.appendChild(item);
      });
    }
    
    /**
     * Upload files to a project with enhanced KB handling
     * @param {string} projectId - Project ID
     * @param {FileList} files - Files to upload
     * @returns {Promise} Promise that resolves when uploads complete
     */
    async uploadFiles(projectId, files) {
      try {
        // 1. Get current project and KB status
        const project = window.projectManager?.currentProject;
        if (!project) {
          throw new Error("No project selected");
        }

        // 2. Count tokens for each file before upload
        if (!window.textExtractor) {
          throw new Error("Text extraction service not available");
        }

        let totalTokens = 0;
        const tokenCounts = {};
        
        // Count tokens for each file
        for (const file of files) {
          try {
            // Create proper FormData for the API
            const formData = new FormData();
            formData.append('file', file);
            
            try {
              const response = await window.apiRequest(
                '/api/text-extractor/extract',
                'POST', 
                formData,
                {
                  'Content-Type': 'multipart/form-data'
                }
              );
              
              // Validate response structure
              if (!response || !response.metadata) {
                throw new Error('Invalid response from text extraction service');
              }
              
              // Get token count directly from metadata
              const tokenCount = response.metadata?.token_count;
              
              if (typeof tokenCount !== 'number' || tokenCount < 0) {
                throw new Error('Invalid or missing token count in response');
              }
              
              tokenCounts[file.name] = tokenCount;
              totalTokens += tokenCount;
            } catch (error) {
              console.error(`Error counting tokens for ${file.name}:`, error);
              let errorMsg = 'File analysis failed';
              if (error.response?.data?.code === 'TEXT_EXTRACTION_ERROR') {
                errorMsg = error.response.data.message || 'File processing error';
              } else if (error.message.includes('Text extraction failed')) {
                errorMsg = 'Unsupported file content';
              } else if (error.message.includes('object tuple')) {
                errorMsg = 'File processing error - please try a different file';
              }
              throw new Error(`Could not analyze ${file.name}: ${errorMsg}`);
            }
          } catch (error) {
            console.error(`Error counting tokens for ${file.name}:`, error);
            let errorMsg = error.message;
            if (error.response?.data?.code === 'TEXT_EXTRACTION_ERROR') {
              errorMsg = error.response.data.message || 'File processing error';
            }
            throw new Error(`Could not analyze ${file.name}: ${errorMsg}`);
          }
        }

        // Check against project limits
        const availableTokens = project.max_tokens - (project.token_usage || 0);
        if (totalTokens > availableTokens) {
          const errorMsg = `These files would exceed token limit by ${(totalTokens - availableTokens).toLocaleString()} tokens\n` +
            `Current usage: ${project.token_usage.toLocaleString()}/${project.max_tokens.toLocaleString()} tokens\n` +
            `Options:\n1. Increase project token limit\n2. Split large files\n3. Delete unused files`;
          throw new Error(errorMsg);
        } else if (totalTokens > availableTokens * 0.8) {
          window.showNotification(
            `Warning: Upload will use ${Math.round((totalTokens / availableTokens) * 100)}% of remaining tokens`,
            "warning",
            { timeout: 8000 }
          );
        }

        let knowledgeBaseId = project.knowledge_base_id;
        let isKbActive = project.knowledge_base?.is_active !== false;

        // 3. Attempt to auto-create KB if missing
        if (!knowledgeBaseId) {
          try {
            const newKb = await this._attemptAutoCreateKB(projectId);
            if (newKb) {
              knowledgeBaseId = newKb.id;
              isKbActive = true;
              window.showNotification("Created default knowledge base", "success");
            }
          } catch (kbErr) {
            console.warn('KB auto-creation failed:', kbErr);
          }
        }

        // 3. Safely verify KB state
        if (!window.knowledgeBaseState || typeof window.knowledgeBaseState.verifyKB !== 'function') {
          console.warn('knowledgeBaseState validation not available - proceeding with upload');
          return this._processFiles(projectId, files);
        }

            try {
              const response = await window.apiRequest(
                '/api/text-extractor/extract', 
                'POST',
                formData,
                {
                  'Content-Type': 'multipart/form-data'
                }
              );
              
              // Validate response structure
              if (!response || !response.metadata) {
                throw new Error('Invalid response from text extraction service');
              }
              // Get token count directly from metadata
              const tokenCount = response.metadata?.token_count;
              const fileName = file.name; // Store file name before try block
              
              if (typeof tokenCount !== 'number' || tokenCount < 0) {
                throw new Error('Invalid or missing token count in response');
              }
              
              tokenCounts[fileName] = tokenCount;
              totalTokens += tokenCount;
            } catch (error) {
              console.error(`Error counting tokens for ${fileName}:`, error);
              console.error(`Error counting tokens for ${file.name}:`, error);
              let errorMsg = error.message;
              if (error.response?.data?.message) {
                errorMsg = error.response.data.message;
              } else if (error.response?.data?.detail) {
                errorMsg = error.response.data.detail;
              }
              throw new Error(`Could not analyze ${file.name}: ${errorMsg}`);
            }

        // 4. Proceed with normal upload flow
        console.debug('Proceeding with normal file upload flow');
        this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
        return this._processFiles(projectId, files);
        
      } catch (error) {
        console.error('Upload failed:', error);
        throw error;
      }
    }
    /**
     * Attempt to auto-create a default KB
     * @private
     */
    async _attemptAutoCreateKB(projectId) {
      try {
        // Check if KB functionality is available
        if (!window.projectManager?.createKnowledgeBase) {
          console.debug('Knowledge Base creation not available - skipping');
          return null;
        }

        const defaultKb = {
          name: 'Default Knowledge Base',
          description: 'Automatically created for file uploads',
          is_active: true
        };
        
        try {
          return await window.projectManager.createKnowledgeBase(projectId, defaultKb);
        } catch (error) {
          console.error('KB auto-creation failed:', error);
          return null;
        }
      } catch (error) {
        console.error('KB auto-creation failed:', error);
        return null;
      }
    }

    /**
     * Handle missing KB scenario
     * @private 
     */
    async _handleMissingKB(projectId, files) {
      return new Promise((resolve, reject) => {
        window.showNotification(
          "Knowledge Base recommended for best results",
          "warning",
          {
            action: "Create KB & Upload",
            secondaryAction: "Upload Without KB",
            onAction: async () => {
              try {
                const kb = await this._attemptAutoCreateKB(projectId);
                if (kb) {
                  await this._processFiles(projectId, files);
                  resolve();
                } else {
                  reject(new Error("KB creation failed"));
                }
              } catch (error) {
                reject(error);
              }
            },
            onSecondaryAction: () => {
              this._processFiles(projectId, files, { skipKb: true })
                .then(resolve)
                .catch(reject);
            },
            timeout: 15000
          }
        );
      });
    }

    /**
     * Switch between project detail tabs
     * @param {string} tabName - Tab name to switch to
     */
    switchTab(tabName) {
      document.querySelectorAll('.project-tab-content').forEach(tabContent => {
        tabContent.classList.add('hidden');
      });

      const activeTab = document.getElementById(`${tabName}Tab`);
      if (activeTab) activeTab.classList.remove('hidden');

      document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
        tabBtn.classList.remove('active');
        tabBtn.setAttribute('aria-selected', 'false');
      });

      const activeTabBtn = document.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
      if (activeTabBtn) {
        activeTabBtn.classList.add('active');
        activeTabBtn.setAttribute('aria-selected', 'true');
      }
      
      this.state.activeTab = tabName;
    }

    /* ===========================
       PRIVATE METHODS
       =========================== */
    
    /**
     * Initialize chat interface if available
     * @private
     */
    _initializeChatInterface() {
      if (typeof window.ChatInterface === 'function') {
        if (!window.projectChatInterface) {
          console.log('Initializing project chat interface');
          try {
            window.projectChatInterface = new window.ChatInterface({
              containerSelector: '#projectChatUI',
              messageContainerSelector: '#projectChatMessages',
              inputSelector: '#projectChatInput',
              sendButtonSelector: '#projectChatSendBtn'
            });
            window.projectChatInterface.initialize();
          } catch (err) {
            console.error('Failed to initialize chat interface:', err);
          }
        } else {
          console.log('Project chat interface already exists');
        }
      } else {
        console.warn('ChatInterface not available - chat functionality will be limited');
      }
    }

    /**
     * Bind all event listeners
     * @private
     */
    _bindEvents() {
      if (this.elements.backBtn) {
        this.elements.backBtn.addEventListener("click", () => {
          if (this.onBack) this.onBack();
        });
      }
      
      if (this.elements.pinBtn) {
        this.elements.pinBtn.addEventListener("click", () => this._togglePin());
      }

      document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
          const tabName = tabBtn.dataset.tab;
          this.switchTab(tabName);
        });
      });
      
      // Minimize chat button
      const minimizeChatBtn = document.getElementById('minimizeChatBtn');
      if (minimizeChatBtn) {
        minimizeChatBtn.addEventListener('click', () => {
          const chatContainer = document.getElementById('projectChatContainer');
          if (chatContainer) chatContainer.classList.add('hidden');
        });
      }

      // New conversation button
      const newConvoBtn = document.getElementById('newConversationBtn');
      if (newConvoBtn) {
        newConvoBtn.addEventListener('click', async (e) => this._handleNewConversation(e));
      }
    }
    
    /**
     * Handle new conversation button click
     * @private
     * @param {Event} e - Click event
     */
    async _handleNewConversation(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const projectId = this.state.currentProject?.id;
      if (!projectId) {
        window.showNotification('No project selected', 'warning');
        return;
      }

      try {
        // Verify all required DOM elements are present
        const chatContainer = document.getElementById('projectChatContainer');
        const chatUI = document.getElementById('projectChatUI');
        const chatMessages = document.getElementById('projectChatMessages');
        const chatInput = document.getElementById('projectChatInput');
        const chatSendBtn = document.getElementById('projectChatSendBtn');
        
        if (!chatContainer || !chatUI || !chatMessages || !chatInput || !chatSendBtn) {
          throw new Error('Required chat UI elements not found in DOM');
        }
        
        // Show the chat container
        chatContainer.classList.remove('hidden');
        
        // Initialize or update chat interface with correct selectors
        if (!window.projectChatInterface) {
          window.projectChatInterface = new window.ChatInterface({
            containerSelector: '#projectChatUI',
            messageContainerSelector: '#projectChatMessages',
            inputSelector: '#projectChatInput',
            sendButtonSelector: '#projectChatSendBtn'
          });
          window.projectChatInterface.initialize();
        }

        // Create new conversation
        const conversation = await window.projectChatInterface.createNewConversation();
        
        // Set target container and load conversation
        if (window.projectChatInterface && typeof window.projectChatInterface.setTargetContainer === 'function') {
          window.projectChatInterface.setTargetContainer('#projectChatMessages');
          window.projectChatInterface.loadConversation(conversation.id);
        }

        // Update URL without reloading
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('chatId', conversation.id);
        window.history.pushState({}, '', newUrl);

        // Store project ID in localStorage for chat context
        localStorage.setItem('selectedProjectId', projectId);
      } catch (error) {
        console.error('Error creating conversation:', error);
        window.showNotification(
          `Failed to create conversation: ${error.message || 'Unknown error'}`,
          'error'
        );
      }
    }

    /**
     * Setup drag and drop file upload handlers
     * @private
     */
    _setupDragDropHandlers() {
      const dragZone = this.elements.dragZone;
      if (!dragZone) return;
      
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        dragZone.addEventListener(event, e => {
          e.preventDefault();
          e.stopPropagation();
        });
      });
      
      ['dragenter', 'dragover'].forEach(event => {
        dragZone.addEventListener(event, () => {
          dragZone.classList.add('drag-zone-active');
        });
      });
      
      ['dragleave', 'drop'].forEach(event => {
        dragZone.addEventListener(event, () => {
          dragZone.classList.remove('drag-zone-active');
        });
      });
      
      dragZone.addEventListener('drop', async (e) => {
        const files = e.dataTransfer.files;
        const projectId = this.state.currentProject?.id;
        
        if (projectId && files.length > 0) {
          try {
            await this.uploadFiles(projectId, files);
          } catch (error) {
            console.error('Error uploading files:', error);
          }
        }
      });
    }
    
    /**
     * Show warning about knowledge base setup requirement
     * @private
     */
    _showKnowledgeBaseWarning() {
      window.showNotification(
        "Knowledge Base required before uploading files",
        "warning",
        {
          action: "Setup Now",
          onAction: () => {
            try {
              if (window.modalManager && typeof window.modalManager.show === 'function') {
                console.log('[DEBUG] Using modal manager to show knowledge base modal');
                window.modalManager.show("knowledge");
              } else {
                console.warn('[DEBUG] Modal manager not available, attempting direct DOM manipulation');
                const modal = document.getElementById('knowledgeBaseSettingsModal');
                if (modal) {
                  modal.classList.remove('hidden');
                  modal.classList.add('confirm-modal');
                } else {
                  console.error('[DEBUG] Knowledge base modal not found in DOM');
                  window.showNotification(
                    'Failed to open knowledge base settings. Please refresh the page.',
                    'error'
                  );
                }
              }
            } catch (error) {
              console.error('[DEBUG] Error showing knowledge base modal:', error);
              window.showNotification(
                'Error opening knowledge base settings. Please try again.',
                'error'
              );
            }
          },
          timeout: 10000
        }
      );
      
      // Highlight KB setup button
      const kbSetupBtn = document.getElementById('setupKnowledgeBaseBtn');
      if (kbSetupBtn) {
        kbSetupBtn.classList.add('animate-pulse', 'ring-2', 'ring-blue-500');
        setTimeout(() => {
          kbSetupBtn.classList.remove('animate-pulse', 'ring-2', 'ring-blue-500');
        }, 5000);
      }
    }

    /**
     * Process and upload file list
     * @private
     * @param {string} projectId - Project ID
     * @param {FileList} files - Files to upload
     * @returns {Promise} Promise that resolves when uploads complete
     */
    _processFiles(projectId, files) {
      // Initialize fileUploadStatus if not already done
      this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
      
      const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'];
      const maxSizeMB = 30;
      
      // Show supported file types
      const fileTypesInfo = document.getElementById('supportedFileTypes');
      if (fileTypesInfo) {
        fileTypesInfo.innerHTML = `
          <div class="text-xs text-gray-500 mt-2">
            Supported: ${allowedExtensions.join(', ')} (Max ${maxSizeMB}MB)
            <span class="inline-block ml-2" title="Files will be indexed in Knowledge Base">
              ℹ️
            </span>
          </div>
        `;
      }

      if (this.elements.uploadProgress) {
        this.elements.uploadProgress.classList.remove("hidden");
        this.elements.progressBar.style.width = "0%";
        this.elements.uploadStatus.textContent = `Uploading 0/${files.length} files...`;
      }

      // Validate files first
      const validFiles = [];
      const invalidFiles = [];

      Array.from(files).forEach(file => {
        const fileExt = file.name.split('.').pop().toLowerCase();
        const isValidExt = allowedExtensions.includes(`.${fileExt}`);
        const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

        if (isValidExt && isValidSize) {
          validFiles.push(file);
        } else {
          let errorMsg = '';
          if (!isValidExt) {
            errorMsg = `Invalid file type (.${fileExt}). Allowed: ${allowedExtensions.join(', ')}`;
          } else {
            errorMsg = `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB limit)`;
          }
          invalidFiles.push({ file, error: errorMsg });
        }
      });

      // Show errors for invalid files
      if (invalidFiles.length > 0) {
        invalidFiles.forEach(({ file, error }) => {
          window.showNotification(`Skipped ${file.name}: ${error}`, 'error');
          this.fileUploadStatus.failed++;
          this.fileUploadStatus.completed++;
        });
        this._updateUploadProgress();
      }

      // Process valid files
      if (validFiles.length > 0) {
        // Store projectId for use in completion handler
        const currentProjectId = projectId;
        return Promise.all(
          validFiles.map(file => {
            return window.projectManager.uploadFile(currentProjectId, file)
              .then(response => {
                console.log(`Upload successful for ${file.name}:`, response);
                this.fileUploadStatus.completed++;
                
                if (response.processing?.status === "pending") {
                  window.showNotification(
                    `${file.name} uploaded - processing for knowledge base`,
                    "info",
                    { timeout: 5000 }
                  );
                } else {
                  window.showNotification(
                    `${file.name} uploaded successfully`,
                    "success",
                    { timeout: 3000 }
                  );
                }
                this._updateUploadProgress();
                
                // Refresh KB status if this was the first file
                if (this.fileUploadStatus.completed === 1) {
                  window.projectManager.loadKnowledgeBaseDetails(
                    this.state.currentProject.knowledge_base_id
                  );
                }
              })
              .catch(error => {
                console.error(`Upload error for ${file.name}:`, error);
                 
                // Determine the specific error message based on error type
                let errorMessage = "Upload failed";
                
                // Safely extract error message from various response formats
                if (error && error.message) {
                  errorMessage = error.message;
                } else if (error && error.response && error.response.data) {
                  // Try to get error from response data
                  if (typeof error.response.data === 'string') {
                    errorMessage = error.response.data;
                  } else if (error.response.data.detail) {
                    errorMessage = error.response.data.detail;
                  } else if (error.response.data.message) {
                    errorMessage = error.response.data.message;
                  } else if (error.response.data.error) {
                    errorMessage = error.response.data.error;
                  }
                }
                
                // Handle specific error types with more descriptive messages
                if (errorMessage.includes("dangerous patterns") || errorMessage.includes("<script")) {
                  errorMessage = "File contains potentially unsafe content (such as script tags). Please sanitize the file before uploading.";
                } else if (errorMessage.includes("validation") || errorMessage.includes("format")) {
                  errorMessage = "File format not supported or validation failed";
                } else if (errorMessage.includes("too large")) {
                  errorMessage = "File exceeds size limit";
                } else if (errorMessage.includes("token") || errorMessage.includes("exceeds the project's token limit")) {
                  // Extract token counts from error message if available
                  const tokenMatch = errorMessage.match(/(\d+) tokens.*limit \((\d+)/);
                  if (tokenMatch) {
                    const fileTokens = parseInt(tokenMatch[1]).toLocaleString();
                    const limitTokens = parseInt(tokenMatch[2]).toLocaleString();
                    errorMessage = `File too large (${fileTokens} tokens > project limit of ${limitTokens}).\nOptions:\n1. Increase project token limit\n2. Split file into smaller parts\n3. Delete unused files`;
                  } else {
                    errorMessage = "Project token limit exceeded";
                  }
                } else if (error.response?.status === 422) {
                  errorMessage = "File validation failed - unsupported format or content";
                } else if (error.response?.status === 400) {
                  if (errorMessage.includes("File upload failed")) {
                    errorMessage = "File upload failed - check format and content";
                  }
                }
                 
                window.showNotification(`Failed to upload ${file.name}: ${errorMessage}`, 'error', { timeout: 6000 });
                this.fileUploadStatus.failed++;
                this.fileUploadStatus.completed++;
                this._updateUploadProgress();
              });
          })
        ).finally(() => {
          // Use the stored project ID for refresh
          const pid = currentProjectId || (window.projectManager?.currentProject?.id);
          
          if (pid) {
            window.projectManager.loadProjectFiles(pid);
            window.projectManager.loadProjectStats(pid);
          } else {
            console.warn('Cannot refresh project data - no valid project ID available');
          }
        });
      }
      return Promise.resolve();
    }

    /**
     * Update upload progress indicators
     * @private
     */
    _updateUploadProgress() {
      const { completed, failed, total } = this.fileUploadStatus;
      const percentage = Math.round((completed / total) * 100);
        
      if (this.elements.progressBar) {
        this.elements.progressBar.classList.add('transition-all', 'duration-300');
        window.animationUtilsInstance.animateProgress(
          this.elements.progressBar,
          parseFloat(this.elements.progressBar.style.width || "0"),
          percentage
        );
      }
      
      if (this.elements.uploadStatus) {
        this.elements.uploadStatus.textContent =
          `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;
      }
      
      if (completed === total) {
        setTimeout(() => {
          if (this.elements.uploadProgress) {
            this.elements.uploadProgress.classList.add("hidden");
          }
          
          if (failed === 0) {
            window.showNotification("Files uploaded successfully", "success");
          } else {
            window.showNotification(`${failed} file(s) failed to upload`, "error");
          }
        }, 1000);
      }
    }

    /**
     * Update counter elements with stats
     * @private
     * @param {Object} stats - Project stats
     */
    _updateCounters(stats) {
      if (stats.file_count !== undefined) {
        const fileCountEl = document.getElementById('fileCount');
        if (fileCountEl) fileCountEl.textContent = window.uiUtilsInstance.formatNumber(stats.file_count);
      }
      
      if (stats.conversation_count !== undefined) {
        const convoCountEl = document.getElementById('conversationCount');
        if (convoCountEl) convoCountEl.textContent = window.uiUtilsInstance.formatNumber(stats.conversation_count);
      }
      
      if (stats.artifact_count !== undefined) {
        const artifactCountEl = document.getElementById('artifactCount');
        if (artifactCountEl) artifactCountEl.textContent = window.uiUtilsInstance.formatNumber(stats.artifact_count);
      }
    }

    /**
     * Render a single conversation item
     * @private
     * @param {Object} conversation - Conversation data
     */
    _renderConversationItem(conversation) {
      const convoEl = window.uiUtilsInstance.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer",
        onclick: async (e) => {
          try {
            console.log('Conversation clicked:', conversation.id, conversation);
            
            // Show chat container
            const chatContainer = document.getElementById('projectChatContainer');
            if (chatContainer) {
              chatContainer.classList.remove('hidden');
              chatContainer.scrollIntoView({ behavior: 'smooth' });
            }

            // Verify chat interface is available and initialized
            if (!window.projectChatInterface) {
              const errorMsg = 'Project chat interface not initialized';
              console.error(errorMsg);
              window.showNotification('Chat system not ready', 'error');
              return;
            }

            if (!window.projectChatInterface.initialized) {
              const errorMsg = 'Chat interface not initialized - trying to initialize';
              console.warn(errorMsg);
              try {
                await window.projectChatInterface.initialize();
              } catch (initErr) {
                console.error('Failed to initialize chat interface:', initErr);
                window.showNotification('Failed to initialize chat', 'error');
                return;
              }
            }

            // Set target container
            console.log('Setting target container to #projectChatMessages');
            window.projectChatInterface.setTargetContainer('#projectChatMessages');
            
            // Load the conversation with detailed logging
            console.log('Loading conversation:', conversation.id);
            const success = await window.projectChatInterface.loadConversation(conversation.id);
            
            if (!success) {
              throw new Error('loadConversation returned false');
            }

            console.log('Conversation loaded successfully, updating URL');
            
            // Update URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('chatId', conversation.id);
            window.history.pushState({}, '', newUrl);

            // Verify UI updated
            const messagesContainer = document.querySelector('#projectChatMessages');
            if (!messagesContainer || messagesContainer.children.length === 0) {
              console.warn('Messages container not updated after load');
            } else {
              console.log('Messages container updated successfully');
            }
          } catch (err) {
            console.error('Error in conversation click handler:', err);
            window.showNotification(
              `Error loading conversation: ${err.message || 'Unknown error'}`,
              'error'
            );
          }
        }
      });
      
      const infoDiv = window.uiUtilsInstance.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(window.uiUtilsInstance.createElement("span", {
        className: "text-lg mr-2",
        textContent: "💬"
      }));
      
      const textDiv = window.uiUtilsInstance.createElement("div");
      textDiv.appendChild(window.uiUtilsInstance.createElement("div", {
        className: "font-medium",
        textContent: conversation.title || "Untitled conversation"
      }));
      textDiv.appendChild(window.uiUtilsInstance.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: window.uiUtilsInstance.formatDate(conversation.created_at)
      }));
      
      infoDiv.appendChild(textDiv);
      
      // Create delete button
      const deleteBtn = window.uiUtilsInstance.createElement("button", {
        className: "text-red-600 hover:text-red-800 ml-4",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                     a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                     a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation(); // Prevent loading the conversation
          this._confirmDeleteConversation(conversation);
        }
      });

      convoEl.appendChild(infoDiv);
      convoEl.appendChild(deleteBtn); // Add the delete button
      
      // Add data attribute for easy selection later
      convoEl.dataset.conversationId = conversation.id;
      
      this.elements.conversationsList.appendChild(convoEl);
    }
    
    /**
     * Show confirmation dialog for deleting a file
     * @private
     * @param {Object} file - File to delete
     */
    _confirmDeleteFile(file) {
      if (!window.modalManager) {
        console.error('modalManager not available');
        return;
      }
      
      window.modalManager.show('delete', {
        title: "Delete File",
        message: `Delete "${file.filename}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
        confirmClass: "bg-red-600",
        onConfirm: () => {
          const projectId = this.state.currentProject?.id;
          if (!projectId) return;
          
          window.projectManager?.deleteFile(projectId, file.id)
            .then(() => {
              window.showNotification("File deleted", "success");
              // Refresh both files and stats
              return Promise.all([
                window.projectManager.loadProjectFiles(projectId),
                window.projectManager.loadProjectStats(projectId)
              ]);
            })
            .catch(err => {
              console.error("Error deleting file:", err);
              window.showNotification("Failed to delete file", "error");
            });
        }
      });
    }
    
    /**
     * Toggle pinned status of current project
     * @private
     */
    _togglePin() {
      const project = this.state.currentProject;
      if (!project) return;
      
      window.projectManager?.togglePinProject(project.id)
        .then(() => {
          window.showNotification(
            project.pinned ? "Project unpinned" : "Project pinned",
            "success"
          );
          window.projectManager.loadProjectDetails(project.id);
        })
        .catch(err => {
          console.error("Error toggling pin:", err);
          window.showNotification("Failed to update project", "error");
        });
    }
    
    /**
     * Show confirmation dialog for deleting a conversation
     * @private
     * @param {Object} conversation - Conversation to delete
     */
    async _confirmDeleteConversation(conversation) {
      try {
        if (!window.ModalManager) {
          throw new Error("Modal manager not available");
        }
        const confirmed = await window.ModalManager.confirmAction({
          title: "Delete Conversation",
          message: `Delete "${conversation.title || 'this conversation'}" and all its messages?`,
          confirmText: "Delete Forever",
          cancelText: "Cancel",
          confirmClass: "bg-red-600",
          destructive: true
        });

        if (!confirmed) return;

        const projectId = this.state.currentProject?.id;
        if (!projectId) {
          throw new Error("No active project selected");
        }

        // Show loading state
        const deleteBtn = document.activeElement;
        const originalText = deleteBtn.innerHTML;
        deleteBtn.innerHTML = `<span class="animate-spin">⏳</span> Deleting...`;
        deleteBtn.disabled = true;

        try {
          await window.projectManager.deleteProjectConversation(projectId, conversation.id);

          // Refresh data
          await Promise.all([
            window.projectManager.loadProjectStats(projectId),
            window.projectManager.loadProjectConversations(projectId)
          ]);

          // Close the modal using the modalManager instance
          try {
            if (window.modalManager?.hide) {
              window.modalManager.hide('delete');
            } else {
              // Fallback to direct DOM manipulation if modalManager not available
              const modal = document.getElementById('deleteConfirmModal');
              if (modal) modal.classList.add('hidden');
            }
          } catch (err) {
            console.warn("Error closing modal:", err);
          }

          // Then show the notification with undo
          window.showNotification("Conversation deleted", "success", {
            action: "Undo",
            onAction: async () => {
              try {
                await window.apiRequest(
                  `/api/projects/${projectId}/conversations/${conversation.id}/restore`,
                  "POST"
                );
                await Promise.all([
                  window.projectManager.loadProjectStats(projectId),
                  window.projectManager.loadProjectConversations(projectId)
                ]);
              } catch (err) {
                console.error("Restore failed:", err);
              }
            },
            timeout: 5000
          });

        } finally {
          // Reset button state
          deleteBtn.innerHTML = originalText;
          deleteBtn.disabled = false;
        }

      } catch (error) {
        console.error("Delete failed:", error);

        let errorMsg = "Failed to delete conversation";
        if (error?.response?.status === 403) {
          errorMsg = "You don't have permission to delete this";
        } else if (error?.response?.status === 404) {
          errorMsg = "Conversation not found - may already be deleted";
        } else if (error.message.includes("No active project")) {
          errorMsg = "No project selected";
        }

        window.showNotification(errorMsg, "error");
      }
    }
    
    /**
     * View an artifact (stub method - to be implemented)
     * @private
     * @param {Object} artifact - Artifact to view
     */
    _viewArtifact(artifact) {
      // Implementation depends on artifact viewing capabilities
      window.showNotification("Artifact viewing not yet implemented", "info");
    }
    
    /**
     * Show confirmation dialog for deleting an artifact
     * @private
     * @param {Object} artifact - Artifact to delete
     */
    _confirmDeleteArtifact(artifact) {
      if (!window.modalManager) {
        console.error('modalManager not available');
        return;
      }
      
      window.modalManager.show('delete', {
        title: "Delete Artifact",
        message: `Delete "${artifact.title || 'this artifact'}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
        confirmClass: "bg-red-600",
        onConfirm: () => {
          const projectId = this.state.currentProject?.id;
          if (!projectId) return;
          
          window.projectManager?.deleteArtifact(projectId, artifact.id)
            .then(() => {
              window.showNotification("Artifact deleted", "success");
              // Refresh data
              Promise.all([
                window.projectManager.loadProjectStats(projectId),
                window.projectManager.loadProjectArtifacts(projectId)
              ]).catch(err => {
                console.error("Error refreshing data:", err);
              });
            })
            .catch(err => {
              console.error("Error deleting artifact:", err);
              window.showNotification("Failed to delete artifact", "error");
            });
        }
      });
    }

    /**
     * Create processing status badge with better error handling
     * @param {Object} processing - Processing metadata
     * @returns {HTMLElement} Status badge element
     */
    _createProcessingBadge(processing) {
      // Define clear mapping between backend states and UI presentation
      const statusMappings = {
        'success': {
          class: "bg-green-100 text-green-800",
          text: "Ready for Search",
          icon: "✓"
        },
        'error': {
          class: "bg-red-100 text-red-800",
          text: processing.error ? `Error: ${processing.error.substring(0, 25)}...` : 'Processing Failed',
          icon: "⚠"
        },
        'pending': {
          class: "bg-yellow-100 text-yellow-800",
          text: "Processing...",
          icon: "⏳"
        },
        'default': {
          class: "bg-gray-100 text-gray-600",
          text: "Not Processed",
          icon: "•"
        }
      };

      // Get the appropriate status mapping or use default
      const status = processing.status || 'default';
      const mapping = statusMappings[status] || statusMappings.default;
      
      // Create badge with consistent structure
      const badge = document.createElement('div');
      badge.className = `processing-status text-xs px-2 py-1 rounded ${mapping.class} mt-1 flex items-center`;
      badge.innerHTML = `<span class="mr-1">${mapping.icon}</span> ${mapping.text}`;
      badge.title = processing.error || mapping.text;
      
      return badge;
    }

    /**
     * Set up WebSocket connection for processing updates
     * @param {string} projectId - Project ID to monitor
     */
    _setupProcessingWS(projectId) {
      if (!projectId) return;
      
      // Clean up any existing connection
      if (this.processingWS) {
        this.processingWS.close();
        this.processingWS = null;
      }

      // Create new connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/ws/processing/${projectId}`
      );

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'processing_update' && this.state.currentProject) {
            this._updateFileStatus(data.file_id, data.status, data.error);
          }
        } catch (e) {
          console.error('Error processing websocket message:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('Processing WebSocket error:', error);
        // Try to reconnect in 5 seconds
        setTimeout(() => this._setupProcessingWS(projectId), 5000);
      };

      ws.onclose = () => {
        console.log('Processing WebSocket closed');
        // Try to reconnect in 5 seconds if still on same project
        if (window.projectManager?.currentProject?.id === projectId) {
          setTimeout(() => this._setupProcessingWS(projectId), 5000);
        }
      };

      this.processingWS = ws;
    }

    _updateFileStatus(fileId, status, error) {
      const fileItem = this.elements.filesList.querySelector(
        `[data-file-id="${fileId}"]`
      );
      
      if (!fileItem) return;

      const statusDiv = fileItem.querySelector('.processing-status');
      if (statusDiv) {
        statusDiv.textContent = status === 'success' ? 'Search Ready' :
          status === 'error' ? `Error: ${error?.substring(0, 30)}...` :
            'Processing...';
        
        statusDiv.className = `processing-status text-xs px-2 py-1 rounded ${status === 'success' ? 'bg-green-100 text-green-800' :
            status === 'error' ? 'bg-red-100 text-red-800' :
              'bg-yellow-100 text-yellow-800'
          }`;
      }
    }
  }
   

  // Export to window
  window.ProjectDetailsComponent = ProjectDetailsComponent;
})();

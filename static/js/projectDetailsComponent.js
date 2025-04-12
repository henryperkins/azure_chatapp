(function () {
  class ProjectDetailsComponent {
    constructor(options = {}) {
      this.onBack = options.onBack;
      this.state = { currentProject: null, activeTab: 'files' };
      this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
      this.fileConstants = {
        allowedExtensions: ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'],
        maxSizeMB: 30
      };
      this.elements = this._initializeElements();
      this._bindEvents();
      this._setupDragDropHandlers();
      this._initializeChatInterface();
      document.addEventListener("projectConversationsLoaded", (e) => { this.renderConversations(e.detail); });
    }

    _initializeElements() {
      return {
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
    }

    show() {
      window.uiUtilsInstance.toggleVisibility(this.elements.container, true);
    }

    hide() {
      if (window.uiUtilsInstance?.toggleVisibility) {
        window.uiUtilsInstance.toggleVisibility(this.elements.container, false);
      } else if (this.elements.container) {
        this.elements.container.classList.add('hidden');
      }
    }

    renderProject(project) {
      this.state.currentProject = project;
      if (this.elements.title) this.elements.title.textContent = project.name;
      if (this.elements.description) {
        this.elements.description.textContent = project.description || "No description provided.";
      }
      if (this.elements.pinBtn) {
        const svg = this.elements.pinBtn.querySelector("svg");
        if (svg) svg.setAttribute("fill", project.pinned ? "currentColor" : "none");
        this.elements.pinBtn.classList.toggle("text-yellow-600", project.pinned);
      }
    }

    renderStats(stats) {
      const { tokenUsage, maxTokens, tokenPercentage, tokenProgressBar } = this.elements;
      const formatNumber = window.uiUtilsInstance?.formatNumber || (n => n.toString());
      if (tokenUsage) tokenUsage.textContent = formatNumber(stats.token_usage || 0);
      if (maxTokens) maxTokens.textContent = formatNumber(stats.max_tokens || 0);
      const usage = stats.token_usage || 0, maxT = stats.max_tokens || 0;
      const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;
      if (tokenPercentage) tokenPercentage.textContent = `${pct}%`;
      this._animateProgressBar(tokenProgressBar, pct);
      this._updateCounters(stats);
    }

    renderFiles(files) {
      if (!this.elements.filesList) return;
      if (!files || files.length === 0) {
        this.elements.filesList.innerHTML = `<div class="text-gray-500 text-center py-8">No files uploaded yet.</div>`;
        return;
      }
      this.elements.filesList.innerHTML = "";
      files.forEach(file => this._renderFileItem(file));
    }

    renderConversations(conversations) {
      if (!this.elements.conversationsList) return;
      const convos = Array.isArray(conversations) ? conversations : [];
      if (!convos || convos.length === 0) {
        this.elements.conversationsList.innerHTML = `<div class="text-gray-500 text-center py-8">No conversations yet.</div>`;
        return;
      }
      this.elements.conversationsList.innerHTML = "";
      conversations.forEach(conversation => { this._renderConversationItem(conversation); });
    }

    renderArtifacts(artifacts) {
      if (!this.elements.artifactsList) return;
      if (!artifacts || artifacts.length === 0) {
        this.elements.artifactsList.innerHTML = `<div class="text-gray-500 text-center py-8">No artifacts created yet.</div>`;
        return;
      }
      this.elements.artifactsList.innerHTML = "";
      artifacts.forEach(artifact => this._renderArtifactItem(artifact));
    }

    async uploadFiles(projectId, files) {
      try {
        const isAuthenticated = await window.auth.isAuthenticated();
        if (!isAuthenticated) {
          window.showNotification('Please log in to upload files', 'warning');
          return;
        }
        const project = window.projectManager?.currentProject;
        if (!project) throw new Error("No project selected");
        await this._verifyTextExtractionService();
        const { totalTokens } = await this._countFilesTokens(files);
        this._checkTokenLimits(project, totalTokens);
        await this._ensureKnowledgeBase(projectId, project);
        this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
        return this._processFiles(projectId, files);
      } catch (error) {
        console.error('Upload failed:', error);
        throw error;
      }
    }

    switchTab(tabName) {
      document.querySelectorAll('.project-tab-content').forEach(tabContent => { tabContent.classList.add('hidden'); });
      const activeTab = document.getElementById(`${tabName}Tab`); if (activeTab) activeTab.classList.remove('hidden');
      document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
        tabBtn.classList.remove('active'); tabBtn.setAttribute('aria-selected', 'false');
      });
      const activeTabBtn = document.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
      if (activeTabBtn) {
        activeTabBtn.classList.add('active');
        activeTabBtn.setAttribute('aria-selected', 'true');
      }
      this.state.activeTab = tabName;
    }

    async _verifyTextExtractionService() {
      try {
        const response = await window.apiRequest('/api/text-extractor/initialize', 'GET');
        if (response?.status !== 'ready') throw new Error('Text extraction service not ready');
      } catch (err) {
        const msg = "Text extraction service unavailable - please try again later";
        console.error(msg, err);
        if (window.Notifications?.apiError) window.Notifications.apiError(msg);
        throw new Error(msg);
      }
    }

    async _countFilesTokens(files) {
      let totalTokens = 0; const tokenCounts = {};
      for (const file of files) {
        try {
          const formData = new FormData(); formData.append('file', file);
          const response = await window.apiRequest('/api/text-extractor/extract', 'POST', formData);
          if (!response || !response.metadata) throw new Error('Invalid response from text extraction service');
          const tokenCount = response.metadata?.token_count;
          if (typeof tokenCount !== 'number' || tokenCount < 0) throw new Error('Invalid or missing token count in response');
          tokenCounts[file.name] = tokenCount; totalTokens += tokenCount;
        } catch (error) {
          console.error(`Error counting tokens for ${file.name}:`, error);
          const errorMsg = this._getFileAnalysisErrorMessage(error);
          throw new Error(`Could not analyze ${file.name}: ${errorMsg}`);
        }
      }
      return { totalTokens, tokenCounts };
    }

    _getFileAnalysisErrorMessage(error) {
      if (error.response?.data?.code === 'TEXT_EXTRACTION_ERROR') {
        return error.response.data.message || 'File processing error';
      } else if (error.message.includes('Text extraction failed')) {
        return 'Unsupported file content';
      } else if (error.message.includes('object tuple')) {
        return 'File processing error - please try a different file';
      }
      return error.message || 'Unknown error';
    }

    _checkTokenLimits(project, totalTokens) {
      const availableTokens = project.max_tokens - (project.token_usage || 0);
      if (totalTokens > availableTokens) {
        const errorMsg = `These files would exceed token limit by ${(totalTokens - availableTokens).toLocaleString()} tokens
Current usage: ${project.token_usage.toLocaleString()}/${project.max_tokens.toLocaleString()} tokens
Options:
1. Increase project token limit
2. Split large files
3. Delete unused files`;
        throw new Error(errorMsg);
      } else if (totalTokens > availableTokens * 0.8) {
        window.showNotification(
          `Warning: Upload will use ${Math.round((totalTokens / availableTokens) * 100)}% of remaining tokens`,
          "warning",
          { timeout: 8000 }
        );
      }
    }

    async _ensureKnowledgeBase(projectId, project) {
      if (!project.knowledge_base_id) {
        try {
          const newKb = await this._attemptAutoCreateKB(projectId);
          if (newKb) window.showNotification("Created default knowledge base", "success");
        } catch (kbErr) {
          console.warn('KB auto-creation failed:', kbErr);
        }
      }
    }

    async _attemptAutoCreateKB(projectId) {
      if (!window.projectManager?.createKnowledgeBase) {
        return null;
      }
      try {
        const defaultKb = { name: 'Default Knowledge Base', description: 'Automatically created for file uploads', is_active: true };
        return await window.projectManager.createKnowledgeBase(projectId, defaultKb);
      } catch (error) {
        console.error('KB auto-creation failed:', error);
        return null;
      }
    }

    _processFiles(projectId, files) {
      this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
      this._updateFileTypesInfo();
      this._showUploadProgressUI(files.length);
      const { validFiles, invalidFiles } = this._validateFiles(files);
      this._handleInvalidFiles(invalidFiles);
      if (validFiles.length > 0) {
        return this._uploadValidFiles(projectId, validFiles).finally(() => this._refreshProjectData(projectId));
      }
      return Promise.resolve();
    }

    _updateFileTypesInfo() {
      const { allowedExtensions, maxSizeMB } = this.fileConstants;
      const fileTypesInfo = document.getElementById('supportedFileTypes');
      if (fileTypesInfo) {
        fileTypesInfo.innerHTML = `
          <div class="text-xs text-gray-500 mt-2">
            Supported: ${allowedExtensions.join(', ')} (Max ${maxSizeMB}MB)
            <span class="inline-block ml-2" title="Files will be indexed in Knowledge Base">ℹ️</span>
          </div>
        `;
      }
    }

    _showUploadProgressUI(fileCount) {
      if (this.elements.uploadProgress) {
        this.elements.uploadProgress.classList.remove("hidden");
        this.elements.progressBar.style.width = "0%";
        this.elements.uploadStatus.textContent = `Uploading 0/${fileCount} files...`;
      }
    }

    _validateFiles(files) {
      const { allowedExtensions, maxSizeMB } = this.fileConstants;
      const validFiles = [], invalidFiles = [];
      Array.from(files).forEach(file => {
        const fileExt = file.name.split('.').pop().toLowerCase();
        const isValidExt = allowedExtensions.includes(`.${fileExt}`);
        const isValidSize = file.size <= maxSizeMB * 1024 * 1024;
        if (isValidExt && isValidSize) {
          validFiles.push(file);
        } else {
          let errorMsg = !isValidExt
            ? `Invalid file type (.${fileExt}). Allowed: ${allowedExtensions.join(', ')}`
            : `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB limit)`;
          invalidFiles.push({ file, error: errorMsg });
        }
      });
      return { validFiles, invalidFiles };
    }

    _handleInvalidFiles(invalidFiles) {
      if (invalidFiles.length > 0) {
        invalidFiles.forEach(({ file, error }) => {
          window.showNotification(`Skipped ${file.name}: ${error}`, 'error');
          this.fileUploadStatus.failed++; this.fileUploadStatus.completed++;
        });
        this._updateUploadProgress();
      }
    }

    _uploadValidFiles(projectId, validFiles) {
      const currentProjectId = projectId;
      return Promise.all(validFiles.map(file => {
        return window.projectManager.uploadFile(currentProjectId, file)
          .then(response => {
            this.fileUploadStatus.completed++;
            if (response.processing?.status === "pending") {
              window.showNotification(`${file.name} uploaded - processing for knowledge base`, "info", { timeout: 5000 });
            } else {
              window.showNotification(`${file.name} uploaded successfully`, "success", { timeout: 3000 });
            }
            this._updateUploadProgress();
            if (this.fileUploadStatus.completed === 1) {
              this._refreshKnowledgeBase(currentProjectId);
            }
          })
          .catch(error => {
            console.error(`Upload error for ${file.name}:`, error);
            const errorMessage = this._formatUploadErrorMessage(error, file.name);
            window.showNotification(`Failed to upload ${file.name}: ${errorMessage}`, 'error', { timeout: 6000 });
            this.fileUploadStatus.failed++; this.fileUploadStatus.completed++;
            this._updateUploadProgress();
          });
      }));
    }

    _showFileUploadSuccessNotification(fileName, response) {
      if (response.processing?.status === "pending") {
        window.showNotification(`${fileName} uploaded - processing for knowledge base`, "info", { timeout: 5000 });
      } else {
        window.showNotification(`${fileName} uploaded successfully`, "success", { timeout: 3000 });
      }
    }

    _formatUploadErrorMessage(error, fileName) {
      if (error?.status === 401 || error?.response?.status === 401 || error.message?.includes('auth') || error.message?.includes('token') || error.message?.includes('unauthorized')) {
        window.auth.handleAuthError(error, 'file upload');
        return "Authentication error - please log in again";
      }
      let errorMessage = "Upload failed";
      if (error?.message) {
        errorMessage = error.message;
      } else if (error?.response?.data) {
        const data = error.response.data;
        errorMessage = typeof data === 'string' ? data : (data.detail || data.message || data.error || "Unknown error");
      }
      if (errorMessage.includes("dangerous patterns") || errorMessage.includes("<script")) {
        return "File contains potentially unsafe content (such as script tags). Please sanitize the file before uploading.";
      } else if (errorMessage.includes("validation") || errorMessage.includes("format")) {
        return "File format not supported or validation failed";
      } else if (errorMessage.includes("too large")) {
        return "File exceeds size limit";
      } else if (errorMessage.includes("token") || errorMessage.includes("exceeds the project's token limit")) {
        const tokenMatch = errorMessage.match(/(\d+) tokens.*limit \((\d+)/);
        if (tokenMatch) {
          const fileTokens = parseInt(tokenMatch[1]).toLocaleString();
          const limitTokens = parseInt(tokenMatch[2]).toLocaleString();
          return `File too large (${fileTokens} tokens > project limit of ${limitTokens}).
Options:
1. Increase project token limit
2. Split file into smaller parts
3. Delete unused files`;
        }
        return "Project token limit exceeded";
      } else if (error.response?.status === 422) {
        return "File validation failed - unsupported format or content";
      } else if (error.response?.status === 400 && errorMessage.includes("File upload failed")) {
        return "File upload failed - check format and content";
      }
      return errorMessage;
    }

    _refreshProjectData(projectId) {
      const pid = projectId || (window.projectManager?.currentProject?.id);
      if (pid) {
        window.projectManager.loadProjectFiles(pid);
        window.projectManager.loadProjectStats(pid);
      } else {
        console.warn('Cannot refresh project data - no valid project ID available');
      }
    }

    _refreshKnowledgeBase(projectId) {
      if (this.state.currentProject?.knowledge_base_id) {
        window.projectManager.loadKnowledgeBaseDetails(this.state.currentProject.knowledge_base_id);
      }
    }

    _updateUploadProgress() {
      const { completed, failed, total } = this.fileUploadStatus;
      const percentage = Math.round((completed / total) * 100);
      if (this.elements.progressBar) {
        this.elements.progressBar.classList.add('transition-all', 'duration-300');
        this._animateProgressBar(this.elements.progressBar, percentage);
      }
      if (this.elements.uploadStatus) {
        this.elements.uploadStatus.textContent = `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;
      }
      if (completed === total) {
        setTimeout(() => {
          if (this.elements.uploadProgress) this.elements.uploadProgress.classList.add("hidden");
          if (failed === 0) {
            window.showNotification("Files uploaded successfully", "success");
          } else {
            window.showNotification(`${failed} file(s) failed to upload`, "error");
          }
        }, 1000);
      }
    }

    _animateProgressBar(progressBar, percentage) {
      if (!progressBar) return;
      progressBar.style.width = "0%";
      if (window.animationUtilsInstance) {
        window.animationUtilsInstance.animateProgress(progressBar, 0, percentage);
      } else {
        progressBar.style.width = `${percentage}%`;
      }
    }

    _updateCounters(stats) {
      const updateElement = (id, value) => {
        const el = document.getElementById(id);
        if (el && value !== undefined) {
          el.textContent = window.uiUtilsInstance?.formatNumber?.(value) || value;
        }
      };
      updateElement('fileCount', stats.file_count);
      updateElement('conversationCount', stats.conversation_count);
      updateElement('artifactCount', stats.artifact_count);
    }

    _renderFileItem(file) {
      const utils = window.uiUtilsInstance;
      const item = utils.createElement("div", { className: "content-item", "data-file-id": file.id });
      const infoDiv = utils.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(utils.createElement("span", { className: "text-lg mr-2", textContent: utils.fileIcon(file.file_type) }));
      const detailDiv = utils.createElement("div", { className: "flex flex-col" });
      detailDiv.appendChild(utils.createElement("div", { className: "font-medium", textContent: file.filename }));
      detailDiv.appendChild(utils.createElement("div", { className: "text-xs text-gray-500", textContent: `${utils.formatBytes(file.file_size)} · ${utils.formatDate(file.created_at)}` }));
      const processing = file.metadata?.search_processing || {};
      const statusBadge = this._createProcessingBadge(processing);
      detailDiv.appendChild(statusBadge);
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      const actions = utils.createElement("div", { className: "flex space-x-2" });
      actions.appendChild(utils.createElement("button", {
        className: "text-red-600 hover:text-red-800",
        innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
</svg>`,
        onclick: () => this._confirmDeleteFile(file)
      }));
      item.appendChild(actions);
      this.elements.filesList.appendChild(item);
    }

    _createProcessingBadge(processing) {
      const statusMappings = {
        'success': { class: "bg-green-100 text-green-800", text: "Ready for Search", icon: "✓" },
        'error': { class: "bg-red-100 text-red-800", text: processing.error ? `Error: ${processing.error.substring(0, 25)}...` : 'Processing Failed', icon: "⚠" },
        'pending': { class: "bg-yellow-100 text-yellow-800", text: "Processing...", icon: "⏳" },
        'default': { class: "bg-gray-100 text-gray-600", text: "Not Processed", icon: "•" }
      };
      const status = processing.status || 'default';
      const mapping = statusMappings[status] || statusMappings.default;
      const badge = document.createElement('div');
      badge.className = `processing-status text-xs px-2 py-1 rounded-sm ${mapping.class} mt-1 flex items-center`;
      badge.innerHTML = `<span class="mr-1">${mapping.icon}</span> ${mapping.text}`;
      badge.title = processing.error || mapping.text;
      return badge;
    }

    _renderConversationItem(conversation) {
      const utils = window.uiUtilsInstance;
      const convoEl = utils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-sm mb-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer",
        onclick: async (e) => this._handleConversationClick(e, conversation)
      });
      const infoDiv = utils.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(utils.createElement("span", { className: "text-lg mr-2", textContent: "💬" }));
      const textDiv = utils.createElement("div");
      textDiv.appendChild(utils.createElement("div", { className: "font-medium", textContent: conversation.title || "Untitled conversation" }));
      textDiv.appendChild(utils.createElement("div", { className: "text-xs text-gray-500", textContent: utils.formatDate(conversation.created_at) }));
      infoDiv.appendChild(textDiv);
      const deleteBtn = utils.createElement("button", {
        className: "text-red-600 hover:text-red-800 ml-4",
        innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
</svg>`,
        onclick: (e) => {
          e.stopPropagation();
          this._confirmDeleteConversation(conversation);
        }
      });
      convoEl.appendChild(infoDiv); convoEl.appendChild(deleteBtn);
      convoEl.dataset.conversationId = conversation.id;
      this.elements.conversationsList.appendChild(convoEl);
    }

    async _handleConversationClick(e, conversation) {
      try {
        const projectId = this.state.currentProject?.id;
        if (!projectId) {
          window.showNotification('Project context missing', 'error');
          return;
        }
        localStorage.setItem("selectedProjectId", projectId);
        const chatContainer = document.getElementById('projectChatContainer');
        if (chatContainer) {
          chatContainer.classList.remove('hidden');
          chatContainer.scrollIntoView({ behavior: 'smooth' });
        }
        if (!window.projectChatInterface) {
          window.showNotification('Chat system not ready', 'error');
          return;
        }
        if (!window.projectChatInterface.initialized) {
          try {
            await window.projectChatInterface.initialize();
          } catch (initErr) {
            console.error('Failed to initialize chat interface:', initErr);
            window.showNotification('Failed to initialize chat', 'error');
            return;
          }
        }
        window.projectChatInterface.setTargetContainer('#projectChatMessages');
        const success = await window.projectChatInterface.loadConversation(conversation.id);
        if (!success) throw new Error('loadConversation returned false');
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('chatId', conversation.id);
        window.history.pushState({}, "", newUrl);
      } catch (err) {
        console.error('Error in conversation click handler:', err);
        window.showNotification(`Error loading conversation: ${err.message || 'Unknown error'}`, 'error');
      }
    }

    _renderArtifactItem(artifact) {
      const utils = window.uiUtilsInstance;
      const item = utils.createElement("div", { className: "content-item" });
      const infoDiv = utils.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(utils.createElement("span", { className: "text-lg mr-2", textContent: "📄" }));
      const detailDiv = utils.createElement("div", { className: "flex flex-col" });
      detailDiv.appendChild(utils.createElement("div", { className: "font-medium", textContent: artifact.title || "Untitled artifact" }));
      detailDiv.appendChild(utils.createElement("div", { className: "text-xs text-gray-500", textContent: `${artifact.type || "Unknown type"} · ${utils.formatDate(artifact.created_at)}` }));
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      const actions = utils.createElement("div", { className: "flex space-x-2" });
      actions.appendChild(utils.createElement("button", {
        className: "text-blue-600 hover:text-blue-800",
        innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
-1.274 4.057-5.064 7-9.542 7
-4.477 0-8.268-2.943-9.542-7z" />
</svg>`,
        onclick: () => this._viewArtifact(artifact)
      }));
      actions.appendChild(utils.createElement("button", {
        className: "text-red-600 hover:text-red-800",
        innerHTML: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
</svg>`,
        onclick: () => this._confirmDeleteArtifact(artifact)
      }));
      item.appendChild(actions);
      this.elements.artifactsList.appendChild(item);
    }

    _initializeChatInterface() {
      if (typeof window.ChatInterface === 'function') {
        if (!window.projectChatInterface) {
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
        }
      } else {
        console.warn('ChatInterface not available - chat functionality will be limited');
      }
    }

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
          const tabName = tabBtn.dataset.tab; this.switchTab(tabName);
        });
      });
      const minimizeChatBtn = document.getElementById('minimizeChatBtn');
      if (minimizeChatBtn) {
        minimizeChatBtn.addEventListener('click', () => {
          const chatContainer = document.getElementById('projectChatContainer');
          if (chatContainer) chatContainer.classList.add('hidden');
        });
      }
      const newConvoBtn = document.getElementById('newConversationBtn');
      if (newConvoBtn) {
        newConvoBtn.addEventListener('click', async (e) => this._handleNewConversation(e));
      }
    }

    async _handleNewConversation(e) {
      e.preventDefault(); e.stopPropagation();
      try {
        const isAuthenticated = await window.auth.isAuthenticated();
        if (!isAuthenticated) {
          window.showNotification('Please log in to create a conversation', 'warning');
          return;
        }
        const projectId = this.state.currentProject?.id;
        if (!projectId) {
          window.showNotification('No project selected', 'warning');
          return;
        }
        try {
          this._verifyRequiredChatElements();
          const chatContainer = document.getElementById('projectChatContainer');
          chatContainer.classList.remove('hidden');
          if (!window.projectChatInterface) {
            await this._initializeProjectChatInterface();
          }
          const conversation = await window.projectChatInterface.createNewConversation();
          window.projectChatInterface.setTargetContainer('#projectChatMessages');
          window.projectChatInterface.loadConversation(conversation.id);
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('chatId', conversation.id);
          window.history.pushState({}, "", newUrl);
        } catch (error) {
          console.error('Error creating conversation:', error);
          if (error.status === 401 || error.status === 403 || error.message?.includes('auth') || error.message?.includes('token')) {
            window.auth.handleAuthError(error, 'conversation creation');
          } else {
            window.showNotification(`Failed to create conversation: ${error.message || 'Unknown error'}`, 'error');
          }
        }
      } catch (error) {
        console.error('Authentication check failed:', error);
        window.showNotification('Authentication error', 'error');
      }
    }

    _verifyRequiredChatElements() {
      const requiredElements = [
        'projectChatContainer', 'projectChatUI', 'projectChatMessages', 'projectChatInput', 'projectChatSendBtn'
      ];
      const missingElements = requiredElements.filter(id => !document.getElementById(id));
      if (missingElements.length > 0) throw new Error(`Required chat UI elements not found: ${missingElements.join(', ')}`);
    }

    async _initializeProjectChatInterface() {
      window.projectChatInterface = new window.ChatInterface({
        containerSelector: '#projectChatUI',
        messageContainerSelector: '#projectChatMessages',
        inputSelector: '#projectChatInput',
        sendButtonSelector: '#projectChatSendBtn'
      });
      await window.projectChatInterface.initialize();
    }

    _setupDragDropHandlers() {
      const dragZone = this.elements.dragZone;
      if (!dragZone) return;
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        dragZone.addEventListener(event, e => {
          e.preventDefault(); e.stopPropagation();
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

    _togglePin() {
      const project = this.state.currentProject;
      if (!project) return;
      window.projectManager?.togglePinProject(project.id)
        .then(() => {
          window.showNotification(project.pinned ? "Project unpinned" : "Project pinned", "success");
          window.projectManager.loadProjectDetails(project.id);
        })
        .catch(err => {
          console.error("Error toggling pin:", err);
          window.showNotification("Failed to update project", "error");
        });
    }

    _confirmDeleteFile(file) {
      window.ModalManager.confirmAction({
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

    async _confirmDeleteConversation(conversation) {
      try {
        const isAuthenticated = await window.auth.isAuthenticated();
        if (!isAuthenticated) {
          window.showNotification('Please log in to delete conversations', 'warning');
          return;
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
        if (!projectId) throw new Error("No active project selected");
        const deleteBtn = document.activeElement;
        const originalText = deleteBtn.innerHTML;
        deleteBtn.innerHTML = `<span class="animate-spin">⏳</span> Deleting...`;
        deleteBtn.disabled = true;
        try {
          await window.projectManager.deleteProjectConversation(projectId, conversation.id);
          await Promise.all([
            window.projectManager.loadProjectStats(projectId),
            window.projectManager.loadProjectConversations(projectId)
          ]);
          this._closeDeleteModal();
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
          deleteBtn.innerHTML = originalText; deleteBtn.disabled = false;
        }
      } catch (error) {
        console.error("Delete failed:", error);
        this._handleDeleteConversationError(error);
      }
    }

    _closeDeleteModal() {
      try {
        if (window.modalManager?.hide) {
          window.modalManager.hide('delete');
        } else if (window.ModalManager?.closeActiveModal) {
          window.ModalManager.closeActiveModal();
        } else {
          const modal = document.getElementById('deleteConfirmModal');
          if (modal) modal.classList.add('hidden');
        }
      } catch (err) {
        console.warn("Error closing modal:", err);
      }
    }

    _handleDeleteConversationError(error) {
      if (error?.response?.status === 401 ||
        error?.status === 401 ||
        error.message?.includes('auth') ||
        error.message?.includes('token') ||
        error.message?.includes('unauthorized')) {
        window.auth.handleAuthError(error, 'conversation deletion');
        return;
      }
      let errorMsg = "Failed to delete conversation";
      if (error?.response?.status === 403) errorMsg = "You don't have permission to delete this";
      else if (error?.response?.status === 404) errorMsg = "Conversation not found - may already be deleted";
      else if (error.message.includes("No active project")) errorMsg = "No project selected";
      window.showNotification(errorMsg, "error");
    }

    _viewArtifact(artifact) {
      window.showNotification("Artifact viewing not yet implemented", "info");
    }

    _confirmDeleteArtifact(artifact) {
      window.ModalManager.confirmAction({
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
              Promise.all([
                window.projectManager.loadProjectStats(projectId),
                window.projectManager.loadProjectArtifacts(projectId)
              ]).catch(err => { console.error("Error refreshing data:", err); });
            })
            .catch(err => {
              console.error("Error deleting artifact:", err);
              window.showNotification("Failed to delete artifact", "error");
            });
        }
      });
    }


  }
  window.ProjectDetailsComponent = ProjectDetailsComponent;
})();

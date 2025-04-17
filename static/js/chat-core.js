/**
 * improved-chat-core.js
 * Central orchestration for chat functionality.
 * Manages initialization, dependency loading, and global configuration for the chat system.
 * Acts as the entry point for setting up chat instances in global or project contexts.
 */
(function () {
  // ---------------------------
  // 1) CENTRAL SCRIPT SELECTORS
  // ---------------------------
  const SELECTORS = {
    scripts: [
      { name: 'ChatUtils', path: '/static/js/chat-utils.js' },
      { name: 'ConversationService', path: '/static/js/chat-conversations.js' },
      { name: 'MessageService', path: '/static/js/chat-messages.js' },
      { name: 'UIComponents', path: '/static/js/chat-ui.js' },
      { name: 'ChatInterface', path: '/static/js/chat-interface.js' }
    ]
  };

  // ---------------------------
  // 2) ChatManager Definition
  // ---------------------------
  const ChatManager = {
    chatInterface: null,
    projectChatInterface: null,
    MODEL_CONFIG: {},

    /**
     * Load required modules in parallel (unless there are strict dependencies).
     * @returns {Promise<void>}
     */
    ensureModulesLoaded: async function () {
      const loadPromises = SELECTORS.scripts.map(mod => {
        if (!window[mod.name]) {
          console.log(`Loading ${mod.name} from ${mod.path}`);
          return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = mod.path;
            script.onload = () => {
              console.log(`Loaded ${mod.name}`);
              resolve();
            };
            script.onerror = (err) => {
              console.error(`Failed to load ${mod.name}:`, err);
              reject(new Error(`Failed to load ${mod.path}`));
            };
            document.head.appendChild(script);
          });
        }
        // Already available
        return Promise.resolve();
      });

      await Promise.all(loadPromises);
    },

    /**
     * Primary initialization entry point for the chat system.
     * @returns {Promise<Object>} - The initialized chat interface
     */
    initializeChat: async function () {
      console.log('[ChatManager] initializeChat called.');

      // Wait for auth module readiness using centralized utility
      await window.ChatUtils.ensureAuthReady();

      console.log('Initializing chat system...');

      // Check for project context with explicit logging
      const projectId = window.ChatUtils.getProjectId();
      const isProjectContext = window.location.pathname.includes('/projects') || Boolean(projectId);
      console.log(`[ChatManager] Init with projectId: ${projectId}, isProjectContext: ${isProjectContext}`);
      if (!projectId) {
        console.warn('[ChatManager] No project selected, will initialize without creating conversation');
      } else {
        console.log(`[ChatManager] Found selected project: ${projectId}`);
      }

      try {
        // 1) Load dependencies (only once)
        await this.ensureModulesLoaded();

        // 2) Check or create the main chat interface if none exists
        if (!this.chatInterface) {
          // Initialize chat interface with dynamic selectors
          this.chatInterface = new window.ChatInterface({});
          await this.chatInterface.initialize();
          // For backward compatibility
          window.chatInterface = this.chatInterface;

          // Also set projectChatInterface to the same instance unless changed later
          if (!this.projectChatInterface) {
            this.projectChatInterface = this.chatInterface;
            window.projectChatInterface = this.projectChatInterface;
          }
        }

        // 3) Setup global keyboard shortcuts
        this.setupGlobalKeyboardShortcuts();
        console.log('Chat system initialized successfully');
        return this.chatInterface;
      } catch (error) {
        console.error('Failed to initialize chat system:', error);
        window.ChatUtils.handleError('Initializing chat', error);
        throw error;
      }
    },

    /**
     * Keyboard shortcuts for global chat actions (avoid capturing in input/textarea).
     */
    setupGlobalKeyboardShortcuts: function () {
      document.addEventListener('keydown', (e) => {
        // Avoid capturing key events in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
          // Ctrl+R: regeneration (overrides browser refresh!)
          if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('regenerateChat'));
          }
          // Ctrl+C: copy message
          if (e.key.toLowerCase() === 'c') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('copyMessage'));
          }
          // Ctrl+N: new chat
          if (e.key.toLowerCase() === 'n') {
            e.preventDefault();
            ChatManager.createNewChat();
          }
        }
      });
    },

    /**
     * Merge the new model config from events/localStorage into ChatManager.MODEL_CONFIG.
     * @param {Object} detail - Model configuration details from event or storage
     */
    handleModelConfigChange: function (detail) {
      try {
        console.log("Model config changed event received:", detail);
        const local = localStorage;

        // Merge event detail with localStorage fallback
        this.MODEL_CONFIG.modelName = detail?.modelName || local.getItem('modelName') || "claude-3-sonnet-20240229";
        this.MODEL_CONFIG.maxTokens = Number(detail?.maxTokens) ||
          Number(local.getItem('maxTokens')) || 500;
        this.MODEL_CONFIG.thinkingBudget = Number(detail?.thinkingBudget) ||
          Number(local.getItem('thinkingBudget')) || 16000;
        const storedExtendedThinking = local.getItem('extendedThinking') === "true";
        this.MODEL_CONFIG.extendedThinking = detail?.extendedThinking === "true" || storedExtendedThinking;

        const storedVisionEnabled = local.getItem('visionEnabled') === "true";
        this.MODEL_CONFIG.visionEnabled = detail?.visionEnabled === "true" || storedVisionEnabled;
        this.MODEL_CONFIG.visionDetail = detail?.visionDetail ||
          local.getItem('visionDetail') || "auto";

        const storedReasoning = local.getItem('reasoningEffort') || "medium";
        this.MODEL_CONFIG.reasoningEffort = detail?.reasoningEffort || storedReasoning;

        console.log("Updated MODEL_CONFIG:", this.MODEL_CONFIG);

        // Update messageService if available
        if (this.chatInterface?.messageService) {
          this.chatInterface.messageService.updateModelConfig(this.MODEL_CONFIG);
        }
        if (this.projectChatInterface &&
          this.projectChatInterface !== this.chatInterface &&
          this.projectChatInterface.messageService) {
          this.projectChatInterface.messageService.updateModelConfig(this.MODEL_CONFIG);
        }

        // Notify other components about the config change
        document.dispatchEvent(new CustomEvent('modelConfigUpdated', {
          detail: this.MODEL_CONFIG
        }));
      } catch (error) {
        console.error("Error handling model config change:", error);
        window.ChatUtils.handleError('Model config update', error);
      }
    },

    /**
     * Load an existing conversation by chatId, ensuring chat is initialized.
     * @param {string} chatId - Conversation ID to load
     * @returns {Promise<boolean>} - Success status
     */
    loadConversation: async function (chatId) {
      try {
        if (!this.chatInterface) {
          await this.initializeChat();
        }
        if (!this.chatInterface.loadConversation) {
          throw new Error('Chat interface not available');
        }
        return await this.chatInterface.loadConversation(chatId);
      } catch (error) {
        console.error('Failed to load conversation:', error);
        window.ChatUtils.handleError('Loading conversation', error);
        throw error;
      }
    },
    
    /**
     * Ensures a conversation exists for the specified project.
     * Will either load an existing conversation or create a new one.
     * @param {string} projectId - The project ID
     * @returns {Promise<Object>} The conversation object
     */
    ensureProjectConversation: async function(projectId) {
      try {
        if (!projectId) {
          throw new Error('Project ID is required');
        }
        
        if (!this.chatInterface) {
          await this.initializeChat();
        }
        
        if (typeof this.chatInterface.ensureProjectConversation !== 'function') {
          console.warn('ChatInterface.ensureProjectConversation not available, falling back');
          
          // Fallback implementation
          localStorage.setItem("selectedProjectId", projectId);
          const urlParams = new URLSearchParams(window.location.search);
          const chatId = urlParams.get('chatId');
          
          if (chatId) {
            await this.loadConversation(chatId);
            return this.chatInterface.conversationService?.currentConversation;
          } else {
            return await this.createNewConversation(projectId);
          }
        }
        
        return await this.chatInterface.ensureProjectConversation(projectId);
      } catch (error) {
        console.error('Failed to ensure project conversation:', error);
        window.ChatUtils.handleError('Ensuring project conversation', error);
        throw error;
      }
    },

    /**
     * Create a new conversation (chat).
     * @param {string} [projectId] - Optional project ID to use for creating the conversation
     * @returns {Promise<Object>} - Created conversation
     */
    createNewConversation: async function (projectId) {
      if (!this.chatInterface) {
        await this.initializeChat();
      }
      
      // If projectId is provided, store it in localStorage
      if (projectId) {
        localStorage.setItem("selectedProjectId", projectId);
      }
      
      return await this.chatInterface.createNewConversation();
    },

    /**
     * Send a message to a specific chatId or the current chat if none given.
     * @param {string} chatId - Conversation ID (optional)
     * @param {string} userMsg - Message content
     * @returns {Promise<Object>} - Response from server
     */
    sendMessage: async function (chatId, userMsg) {
      if (!this.chatInterface) {
        await this.initializeChat();
      }
      if (chatId) {
        this.chatInterface.currentChatId = chatId;
      }
      return await this.chatInterface.sendMessage(userMsg);
    },

    /**
     * Initialize a project chat component.
     * @param {string} containerSelector - The selector for the chat container
     * @param {Object} options - Configuration options
     * @returns {Object} - The chat interface instance
     */
    initializeProjectChat: function (containerSelector, options = {}) {
      console.log('[ChatManager] Initializing project chat with selector:', containerSelector);

      if (!window.ChatInterface) {
        console.error('[ChatManager] ChatInterface not available');
        throw new Error('ChatInterface not available - chat functionality will be limited');
      }

      // Configure selectors
      const chatConfig = {
        containerSelector: containerSelector,
        messageContainerSelector: options.messageContainer || '#projectChatMessages',
        inputSelector: options.inputField || '#projectChatInput',
        sendButtonSelector: options.sendButton || '#projectChatSendBtn',
        typingIndicator: options.typingIndicator !== false,
        readReceipts: options.readReceipts !== false,
        messageStatus: options.messageStatus !== false
      };

      // Create or reuse chat interface
      if (!window.projectChatInterface) {
        console.log('[ChatManager] Creating new ChatInterface instance');
        window.projectChatInterface = new window.ChatInterface(chatConfig);
      } else if (typeof window.projectChatInterface.configureSelectors === 'function') {
        console.log('[ChatManager] Reconfiguring existing ChatInterface instance');
        window.projectChatInterface.configureSelectors(chatConfig);
      } else {
        console.warn('[ChatManager] Existing chatInterface does not support reconfiguration');
      }

      // Set up event handlers if provided
      if (options.onMessageSent && typeof options.onMessageSent === 'function') {
        window.projectChatInterface.on('messageSent', options.onMessageSent);
      }
      if (options.onError && typeof options.onError === 'function') {
        window.projectChatInterface.on('error', options.onError);
      }

      // Initialize the chat interface (if not already)
      if (!window.projectChatInterface.initialized) {
        console.log('[ChatManager] Initializing ChatInterface');
        window.projectChatInterface.initialize().catch(err => {
          console.error('[ChatManager] Failed to initialize chat interface:', err);
          window.ChatUtils.handleError('Initializing project chat', err);
        });
      }

      return window.projectChatInterface;
    }
  };

  // ---------------------------
  // 3) Attach to window
  // ---------------------------
  // For direct backward compatibility with any code referencing window.initializeChat, etc.
  window.ChatManager = ChatManager;
  window.initializeChat = ChatManager.initializeChat.bind(ChatManager);
  window.loadConversation = ChatManager.loadConversation.bind(ChatManager);
  window.createNewChat = ChatManager.createNewConversation.bind(ChatManager);
  window.sendMessage = ChatManager.sendMessage.bind(ChatManager);

  // ---------------------------
  // 4) Dispatch chatManagerReady Event
  // ---------------------------
  // Signal that ChatManager is defined and available for use
  console.log('[ChatManager] Dispatching chatManagerReady event');
  document.dispatchEvent(new CustomEvent('chatManagerReady', {
    detail: { instance: ChatManager }
  }));

  // ---------------------------
  // 5) EVENT LISTENERS
  // ---------------------------
  // Listen for model config changes
  document.addEventListener('modelConfigChanged', (e) => {
    ChatManager.handleModelConfigChange(e.detail || {});
  });

  // Initialize chat when in a project context or on a certain event
  document.addEventListener('projectSelected', async (e) => {
    const projectId = e.detail?.projectId;
    if (!projectId) return;
    try {
      if (!ChatManager.chatInterface) {
        await ChatManager.initializeChat();
      }
      // Show project chat container if it exists
      const projectChatContainer = document.getElementById('globalChatContainer');
      if (projectChatContainer) {
        projectChatContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error("Failed to initialize project chat:", error);
      window.ChatUtils.handleError('Initializing project chat on selection', error);
    }
  });
})();

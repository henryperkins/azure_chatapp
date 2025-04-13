/**
 * improved-chat-core.js
 * A refactored version of your chat-core functionality.
 * Creates a single ChatManager object with streamlined code.
 * Uses auth.js exclusively for authentication.
 */
(function () {
  // ---------------------------
  // 1) CENTRAL DOM SELECTORS
  // ---------------------------
  const SELECTORS = {
    scripts: [
      { name: 'ChatUtils', path: '/static/js/chat-utils.js' },
      { name: 'ConversationService', path: '/static/js/chat-conversations.js' },
      { name: 'MessageService', path: '/static/js/chat-messages.js' },
      { name: 'UIComponents', path: '/static/js/chat-ui.js' },
      { name: 'ChatInterface', path: '/static/js/chat-interface.js' }
    ],
    markdownStyleId: 'markdown-styles',
    markdownStyles: `
      .markdown-table{width:100%;border-collapse:collapse;margin:1em 0}
      .markdown-table th,.markdown-table td{padding:.5em;border:1px solid #ddd}
      .markdown-code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}
      .markdown-pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
      .markdown-quote{border-left:3px solid #ddd;padding:0 1em;color:#666}
      .code-block-wrapper{position:relative}
      .copy-code-btn{position:absolute;right:.5em;top:.5em;padding:.25em .5em;background:#fff;border:1px solid #ddd;
        border-radius:3px;cursor:pointer;font-size:.8em}
      .copy-code-btn:hover{background:#f5f5f5}
    `,
    // Container IDs (these can be switched if the user is in "project" context)
    mainChatContainerId: 'chatContainer',
    mainChatUI: 'chatUI',
    mainMessages: 'conversationArea',
    mainInput: 'chatInput',
    mainSendBtn: 'sendBtn',

    projectChatContainerId: 'projectChatContainer',
    projectChatUI: 'projectChatUI',
    projectMessages: 'projectChatMessages',
    projectInput: 'projectChatInput',
    projectSendBtn: 'projectChatSendBtn'
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
     * Inject global markdown styles if not present.
     */
    addMarkdownStyles: function () {
      if (document.getElementById(SELECTORS.markdownStyleId)) return;
      const style = document.createElement('style');
      style.id = SELECTORS.markdownStyleId;
      style.textContent = SELECTORS.markdownStyles;
      document.head.appendChild(style);
    },

    /**
     * Create or locate the required chat container for project or main chat.
     * Return the container if found/created/visible, or null otherwise.
     */
    findOrCreateChatContainer: async function (isProjectContext = false) {
      const containerId = isProjectContext
        ? SELECTORS.projectChatContainerId
        : SELECTORS.mainChatContainerId;

      let container = document.querySelector(`#${containerId}`);
      if (!container) {
        console.log(`Chat container (#${containerId}) not found, creating...`);
        const mainContent = document.querySelector('main');
        if (mainContent) {
          container = document.createElement('div');
          container.id = containerId;
          container.className = 'mt-4 transition-all duration-300 ease-in-out';
          container.style.display = 'block'; // ensure visible

          // Create messages container
          const messagesContainer = document.createElement('div');
          messagesContainer.id = isProjectContext
            ? SELECTORS.projectMessages
            : SELECTORS.mainMessages;
          messagesContainer.className = 'chat-message-container';
          container.appendChild(messagesContainer);

          // Create input area
          const inputArea = document.createElement('div');
          inputArea.className = 'flex items-center border-t border-gray-200 dark:border-gray-700 p-2';

          const chatInput = document.createElement('input');
          chatInput.id = isProjectContext
            ? SELECTORS.projectInput
            : SELECTORS.mainInput;
          chatInput.type = 'text';
          chatInput.className = 'flex-1 border rounded-l px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white';
          chatInput.placeholder = 'Type your message...';

          const sendBtn = document.createElement('button');
          sendBtn.id = isProjectContext
            ? SELECTORS.projectSendBtn
            : SELECTORS.mainSendBtn;
          sendBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-r transition-colors';
          sendBtn.textContent = 'Send';

          inputArea.appendChild(chatInput);
          inputArea.appendChild(sendBtn);
          container.appendChild(inputArea);

          mainContent.appendChild(container);
          console.log(`Created chat container: #${container.id}`);
        }
      }
      if (container) {
        // ensure container is visible
        container.classList.remove('hidden');
        container.style.display = 'block';

        // ensure parent is visible too
        let parent = container.parentElement;
        while (parent && parent !== document.body) {
          if (parent.classList.contains('hidden')) {
            parent.classList.remove('hidden');
          }
          if (parent.style.display === 'none') {
            parent.style.display = 'block';
          }
          parent = parent.parentElement;
        }
      }
      return container;
    },

    /**
     * Ensure the chat container is visible, trying multiple times if needed.
     */
    ensureChatContainerVisible: async function (isProjectContext = false) {
      let attempts = 0;
      const maxAttempts = 15;
      const delay = 400;

      while (attempts < maxAttempts) {
        const container = await this.findOrCreateChatContainer(isProjectContext);
        if (container && container.offsetParent !== null) {
          // container is found and visible
          console.log(`Chat container #${container.id} found and visible.`);
          return container;
        }
        if (attempts % 3 === 0) {
          console.log(`Searching for chat container (attempt ${attempts + 1}/${maxAttempts})...`);
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      console.error("Could not find chat container after multiple attempts.");
      return null;
    },

    /**
     * Primary initialization entry point.
     */
    initializeChat: async function () {
      console.log('[ChatManager] initializeChat called.'); // Add log

      // --- NEW: Wait for auth module readiness ---
      if (!window.auth || !window.auth.isReady) {
        console.log('[ChatManager] Auth module not ready, waiting for authReady event...');
        await new Promise((resolve) => {
          // Check immediately in case it became ready while waiting
          if (window.auth?.isReady) {
            console.log('[ChatManager] Auth became ready while checking.');
            resolve();
          } else {
            const listener = () => {
               console.log('[ChatManager] Received authReady event.');
               resolve();
            };
            document.addEventListener('authReady', listener, { once: true });
            // Safety timeout in case event never fires
            setTimeout(() => {
               console.warn('[ChatManager] Timeout waiting for authReady event.');
               document.removeEventListener('authReady', listener); // Clean up listener
               resolve(); // Resolve anyway to avoid blocking indefinitely
            }, 5000); // 5-second timeout
          }
        });
        console.log('[ChatManager] Auth module is now ready.');
      } else {
         console.log('[ChatManager] Auth module was already ready.');
      }
      // --- END NEW ---

      console.log('Initializing chat system...'); // Moved log

      // --- NEW: Final Auth Check ---
      console.log('[ChatManager] Performing final authentication check before initializing ChatInterface...');
      try {
        const isFinallyAuthenticated = await window.auth.isAuthenticated({ forceVerify: true }); // Force server check
        if (!isFinallyAuthenticated) {
          console.error('[ChatManager] Final authentication check failed. Aborting chat initialization.');
          // Optionally, trigger UI update to show login required
          const loginMsg = document.getElementById("loginRequiredMessage");
          if (loginMsg) loginMsg.classList.remove("hidden");
          const chatUI = document.getElementById(SELECTORS.mainChatUI) || document.getElementById(SELECTORS.projectChatUI);
          if (chatUI) chatUI.classList.add('hidden');
          throw new Error('User not authenticated after final check.'); // Prevent further initialization
        }
        console.log('[ChatManager] Final authentication check successful.');
      } catch (authError) {
         console.error('[ChatManager] Error during final authentication check:', authError);
         // Handle error appropriately, maybe show login prompt
         throw authError; // Re-throw to stop initialization
      }
      // --- END FINAL AUTH CHECK ---

      try {
        // 1) Load dependencies (only once).
        await this.ensureModulesLoaded();

        // 2) Inject markdown styling.
        this.addMarkdownStyles();

        // 3) Check or create the main chat interface if none exists.
        if (!this.chatInterface) {
          // See if location or container indicates project context:
          const isProjectContext =
            window.location.pathname.includes('/projects') ||
            document.querySelector(`#${SELECTORS.projectChatContainerId}`);

          // Ensure the container is visible
          const container = await this.ensureChatContainerVisible(isProjectContext);
          if (!container) throw new Error('Chat container not found after multiple attempts');

          // Build dynamic selectors
          const containerSelector = isProjectContext
            ? `#${SELECTORS.projectChatUI}`
            : `#${SELECTORS.mainChatUI}`;
          const messageSelector = isProjectContext
            ? `#${SELECTORS.projectMessages}`
            : `#${SELECTORS.mainMessages}`;
          const inputSelector = isProjectContext
            ? `#${SELECTORS.projectInput}`
            : `#${SELECTORS.mainInput}`;
          const sendBtnSelector = isProjectContext
            ? `#${SELECTORS.projectSendBtn}`
            : `#${SELECTORS.mainSendBtn}`;

          console.log(`Initializing chat with selectors:`, {
            container: containerSelector,
            messages: messageSelector,
            input: inputSelector,
            sendBtn: sendBtnSelector
          });

          this.chatInterface = new window.ChatInterface({
            containerSelector,
            messageContainerSelector: messageSelector,
            inputSelector,
            sendButtonSelector: sendBtnSelector
          });

          await this.chatInterface.initialize();
          // For backward compatibility
          window.chatInterface = this.chatInterface;

          // Also set projectChatInterface to the same instance unless changed later
          if (!this.projectChatInterface) {
            this.projectChatInterface = this.chatInterface;
            window.projectChatInterface = this.projectChatInterface;
          }
        }

        // 4) Setup global keyboard shortcuts
        this.setupGlobalKeyboardShortcuts();
        console.log('Chat system initialized successfully');
        return this.chatInterface;
      } catch (error) {
        console.error('Failed to initialize chat system:', error);
        window.ChatUtils?.handleError?.('Initializing chat', error);
        throw error;
      }
    },

    /**
     * Keyboard shortcuts (avoid capturing in input/textarea).
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
      }
    },

    /**
     * Load an existing conversation by chatId, ensuring chat is initialized.
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
        throw error;
      }
    },

    /**
     * Create a new conversation (chat).
     */
    createNewConversation: async function () {
      if (!this.chatInterface) {
        await this.initializeChat();
      }
      return this.chatInterface.createNewConversation();
    },

    /**
     * Send a message to a specific chatId or the current chat if none given.
     */
    sendMessage: async function (chatId, userMsg) {
      if (!this.chatInterface) {
        await this.initializeChat();
      }
      this.chatInterface.currentChatId = chatId;
      return this.chatInterface._handleSendMessage(userMsg);
    },

    /**
     * Initialize a project chat component
     * @param {string} containerSelector - The selector for the chat container
     * @param {Object} options - Configuration options
     * @returns {Object} The chat interface instance
     */
    initializeProjectChat: function(containerSelector, options = {}) {
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
  // WebSocket references removed

  // ---------------------------
  // 4) EVENT LISTENERS
  // ---------------------------
  // Listen for model config changes
  document.addEventListener('modelConfigChanged', (e) => {
    ChatManager.handleModelConfigChange(e.detail || {});
  });

  // Only initialize chat when in a project context or on a certain event
  // If needed, or you can choose to always initialize on page load:
  document.addEventListener('projectSelected', async (e) => {
    const projectId = e.detail?.projectId;
    if (!projectId) return;
    try {
      if (!ChatManager.chatInterface) {
        await ChatManager.initializeChat();
      }
      // Show project chat container if it exists
      const projectChatContainer = document.getElementById(SELECTORS.projectChatContainerId);
      if (projectChatContainer) {
        projectChatContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error("Failed to initialize project chat:", error);
    }
  });

})();

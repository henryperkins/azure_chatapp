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
      { name: 'WebSocketService', path: '/static/js/chat-websocket.js' },
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
      console.log('Initializing chat system...');
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
     * Setup WebSocket for the given chat, or fallback to currentChatId.
     */
    setupWebSocket: async function (chatId) {
      if (!this.chatInterface) {
        await this.initializeChat();
      }
      if (!chatId && this.chatInterface.currentChatId) {
        chatId = this.chatInterface.currentChatId;
      }
      if (chatId && this.chatInterface.wsService) {
        try {
          const connected = await this.chatInterface.wsService.connect(chatId);
          if (connected) {
            this.chatInterface.messageService.initialize(chatId, this.chatInterface.wsService);
            return true;
          }
        } catch (error) {
          console.warn("Failed to set up WebSocket:", error);
        }
      }
      return false;
    },

    /**
     * Test WebSocket connection prerequisites.
     */
    testWebSocketConnection: async function () {
      try {
        await this.ensureModulesLoaded();

        // Check authentication using auth.js
        let isAuthenticated = false;
        try {
          isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
        } catch (e) {
          console.warn("Auth verification failed:", e);
          window.auth.handleAuthError(e, "WebSocket connection test");
        }

        if (!isAuthenticated) {
          return { success: false, authenticated: false, message: "Authentication required" };
        }

        // Construct WS URL
        const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const host = window.location.host;
        if (!host) throw new Error('Cannot determine host for WebSocket connection');

        const chatId = window.CHAT_CONFIG?.chatId;
        if (!chatId) throw new Error('No chatId available for WebSocket connection');

        const wsUrl = `${wsProtocol}${host}/ws?chatId=${chatId}`;

        return {
          success: true,
          authenticated: true,
          wsUrl,
          message: "WebSocket prerequisites passed"
        };
      } catch (error) {
        window.ChatUtils?.handleError?.('WebSocket test', error);
        return {
          success: false,
          error: error.message,
          message: "WebSocket test failed"
        };
      }
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
  // WebSocket setup removed - using HTTP only
  window.testWebSocketConnection = ChatManager.testWebSocketConnection.bind(ChatManager);

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

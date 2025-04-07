/**
 * chat-interface.js
 * Chat interface that coordinates all components,
 * now with no localStorage usage or cross-origin references.
 */

// Converted from ES modules to global references
const ConversationService = window.ConversationService;
const WebSocketService = window.WebSocketService;
const MessageService = window.MessageService;
const UIComponents = window.UIComponents;

// Initialize the interface
window.ChatInterface = function (options = {}) {
  // Removed localStorage usage: now simply stores projectId in memory
  this._setupProjectContext = function () {
    this.isProjectsPage = window.location.pathname.includes('/projects');
    if (this.isProjectsPage) {
      const pathSegments = window.location.pathname.split('/');
      // Attempt to retrieve the projectId from URL segments
      const projIndex = pathSegments.indexOf('projects');
      if (projIndex >= 0 && pathSegments[projIndex + 1]) {
        this.projectId = pathSegments[projIndex + 1];
      }
    }
  };

  this.notificationFunction = (message, type) => {
    if (window.Notifications) {
      switch (type) {
        case 'error': return window.Notifications.apiError(message);
        case 'success': return window.Notifications.apiSuccess?.(message);
        default: return console.log(`[${type.toUpperCase()}] ${message}`);
      }
    }
    return (options.showNotification || window.showNotification || console.log)(message, type);
  };

  this.container = document.querySelector(options.containerSelector || '#chatUI');
  this.titleEl = document.querySelector(options.titleSelector || '#chatTitle');

  // Set up container selectors
  this._setupProjectContext();

  // Determine correct selectors based on context
  this.containerSelector = options.containerSelector || (this.isProjectsPage ? '#projectChatUI' : '#chatUI');
  this.messageContainerSelector = options.messageContainerSelector || (this.isProjectsPage ? '#projectChatMessages' : '#conversationArea');
  this.inputSelector = options.inputSelector || (this.isProjectsPage ? '#projectChatInput' : '#chatInput');
  this.sendButtonSelector = options.sendButtonSelector || (this.isProjectsPage ? '#projectChatSendBtn' : '#sendBtn');

  console.log('ChatInterface selectors:', {
    container: this.containerSelector,
    messages: this.messageContainerSelector,
    input: this.inputSelector,
    sendButton: this.sendButtonSelector
  });

  this.wsService = null;
  this.messageService = null;
  this.conversationService = null;
  this.ui = null;

  this.currentChatId = null;
  this.currentImage = null;

  // Track if we're initialized
  this.initialized = false;
};

  // Handle sending messages from UI
window.ChatInterface.prototype._handleSendMessage = function (messageText) {
  // Ensure auth is initialized before sending
  if (!window.auth?.isInitialized) {
    console.log('[chat-interface] Initializing auth before sending message');
    window.auth.init().catch(err => {
      console.error('[chat-interface] Auth initialization failed:', err);
    });
  }

  // Wait for auth initialization to complete
  return new Promise((resolve, reject) => {
    const checkInitialized = () => {
      if (window.auth?.isInitialized) {
        console.log('[chat-interface] Auth initialized, sending message');
        // Implement message sending logic
        console.log("Sending message:", messageText);
        resolve();
      } else {
        setTimeout(checkInitialized, 50);
      }
    };
    checkInitialized();
  });
};

window.ChatInterface.prototype.initialize = async function () {
  // Check dependencies
  if (!window.WebSocketService) {
    console.warn('WebSocketService dependency not loaded - attempting dynamic load');
    await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = '/static/js/chat-websocket.js';
      script.onload = resolve;
      document.head.appendChild(script);
    });

    if (!window.WebSocketService) {
      throw new Error('WebSocketService dependency not loaded after dynamic load');
    }
  }

  // Prevent double initialization
  if (this.initialized) {
    console.warn("Chat interface already initialized");
    return;
  }

  // Initialize project context
  this._setupProjectContext();

  // Update selectors based on page context
  if (this.isProjectsPage) {
    this.containerSelector = '#projectChatUI';
    this.messageContainerSelector = '#projectChatMessages';
    this.inputSelector = '#projectChatInput';
    this.sendButtonSelector = '#projectChatSendBtn';
  } else {
    this.containerSelector = '#chatUI';
    this.messageContainerSelector = '#conversationArea';
    this.inputSelector = '#chatInput';
    this.sendButtonSelector = '#sendBtn';
  }

  // Extract chat ID from URL or config
  const urlParams = new URLSearchParams(window.location.search);
  this.currentChatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');

  // Create services with standardized error handling
  this.wsService = new window.WebSocketService({
    onConnect: () => {
      console.log("WebSocket connected");
      document.dispatchEvent(new CustomEvent('webSocketConnected'));
    },
    onError: (err) => window.ChatUtils?.handleError?.('WebSocket', err, this.notificationFunction)
  });

  try {
    if (!window.MessageService) {
      throw new Error('MessageService not available');
    }
    this.messageService = new window.MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: () => this.ui.messageList.addThinking(),
      onError: (context, err) => window.ChatUtils?.handleError?.(context, err, this.notificationFunction)
    });
  } catch (error) {
    console.error('Failed to initialize MessageService:', error);
    throw new Error(`MessageService initialization failed: ${error.message}`);
  }

  // Initialize with current model config if available
  if (window.MODEL_CONFIG) {
    this.messageService.updateModelConfig(window.MODEL_CONFIG);
  }

  // Create UI components
  this.ui = new window.UIComponents({
    messageContainerSelector: this.messageContainerSelector,
    inputSelector: this.inputSelector,
    sendButtonSelector: this.sendButtonSelector,
    onSend: this._handleSendMessage.bind(this),
    onImageChange: (imageData) => this.currentImage = imageData,
    showNotification: this.notificationFunction
  }).init();

  // Set up auth listeners
  document.addEventListener('authStateChanged', (e) => {
    if (e.detail?.authenticated && this.currentChatId) {
      this.wsService.connect(this.currentChatId)
        .then(() => {
          this.messageService.initialize(this.currentChatId, this.wsService);
        })
        .catch((err) => {
          console.warn("WebSocket connection failed, using HTTP fallback:", err);
        });
    } else if (!e.detail?.authenticated) {
      this.wsService.disconnect();
    }
  });

  // Set up custom event handlers
  this._setupEventListeners();

  // Set up delete conversation button
  const deleteBtn = document.getElementById('deleteConversationBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!this.currentChatId) {
        this.notificationFunction("No conversation selected", "error");
        return;
      }
      if (confirm("Are you sure you want to delete this conversation? This cannot be undone.")) {
        this.deleteConversation(this.currentChatId)
          .then(success => {
            if (success) {
              this.notificationFunction("Conversation deleted successfully", "success");
            }
          })
          .catch(error => {
            window.ChatUtils?.handleError?.('Deleting conversation', error, this.notificationFunction);
          });
      }
    });
  }

  // Check dependencies
  const requiredServices = ['ConversationService', 'MessageService', 'WebSocketService', 'UIComponents'];
  const missingServices = requiredServices.filter(service => !window[service]);

  if (missingServices.length > 0) {
    const errorMsg = `Required services not loaded: ${missingServices.join(', ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Create new instance of ConversationService
  this.conversationService = new window.ConversationService({
    onConversationLoaded: (conversation) => {
      this.currentConversation = conversation;
      this._handleConversationLoaded(conversation);
    },
    onError: (context, error) => {
      window.ChatUtils?.handleError?.(context, error, this.notificationFunction);
    },
    showNotification: this.notificationFunction
  });

  // Initial load or creation
  this._handleInitialConversation();

  this.initialized = true;
  document.dispatchEvent(new CustomEvent('chatInterfaceInitialized'));
};

// Handle initial conversation loading or creation
window.ChatInterface.prototype._handleInitialConversation = function () {
  if (this.currentChatId) {
    // Load existing conversation if ID is in URL
    this.loadConversation(this.currentChatId);
  } else {
    // Verify auth state
    window.auth?.verify?.().then(isAuthenticated => {
      if (!isAuthenticated) {
        const loginMsg = document.getElementById("loginRequiredMessage");
        if (loginMsg) loginMsg.classList.remove("hidden");
        return;
      }

      // Wait for auth to fully initialize
      // Wait for auth to be ready
      return window.auth.init().then(() => resolve());
    }).then(() => {
      // Create conversation if still no chatId
      if (!this.currentChatId) {
        this.createNewConversation().catch((error) => {
          window.ChatUtils?.handleError?.('Creating new conversation', error, this.notificationFunction);
        });
      }
    }).catch(error => {
      window.ChatUtils?.handleError?.('Authentication check', error, this.notificationFunction);
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) loginMsg.classList.remove("hidden");
    });
  }
};

// Set up event listeners for custom events
window.ChatInterface.prototype._setupEventListeners = function () {
  document.addEventListener('regenerateChat', () => {
    if (!this.currentChatId) return;
    const lastUserMessage = this._findLastUserMessage();
    if (lastUserMessage) {
      this.ui.messageList.removeLastAssistantMessage();
      this.messageService.sendMessage(lastUserMessage);
    } else {
      this.notificationFunction('No message to regenerate', 'warning');
    }
  });

  document.addEventListener('copyMessage', () => {
    const lastAssistantMessage = this._findLastAssistantMessage();
    if (lastAssistantMessage) {
      navigator.clipboard.writeText(lastAssistantMessage)
        .then(() => this.notificationFunction('Message copied to clipboard', 'success'))
        .catch(err => window.ChatUtils?.handleError?.('Copying message', err, this.notificationFunction));
    }
  });

  // Listen for URL changes (browser nav)
  window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');

    if (chatId && chatId !== this.currentChatId) {
      this.loadConversation(chatId);
    }
  });

  // Listen for model config changes
  document.addEventListener('modelConfigChanged', (e) => {
    if (this.messageService && e.detail) {
      console.log("ChatInterface: Updating message service with new model config");
      this.messageService.updateModelConfig(e.detail);
    }
  });
};

// Helper: find the last user message for regeneration
window.ChatInterface.prototype._findLastUserMessage = function () {
  const conv = this.conversationService.currentConversation;
  if (!conv?.messages) return null;

  const msgs = conv.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      return msgs[i].content;
    }
  }
  return null;
};

// Helper: find the last assistant message for copying
window.ChatInterface.prototype._findLastAssistantMessage = function () {
  const conv = this.conversationService.currentConversation;
  if (!conv?.messages) return null;

  const msgs = conv.messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') {
      return msgs[i].content;
    }
  }
  return null;
};

// Load a conversation
window.ChatInterface.prototype.loadConversation = function (chatId) {
  if (!chatId || !window.ChatUtils?.isValidUUID(chatId)) {
    return Promise.reject(new Error('No conversation ID provided'));
  }

  // Skip if already loading
  if (this.currentChatId === chatId && this._isLoadingConversation) {
    return Promise.resolve(false);
  }

  console.log(`Loading conversation with ID: ${chatId}`);
  this._isLoadingConversation = true;

  const previousChatId = this.currentChatId;
  this.currentChatId = chatId;

  // Disconnect from previous WebSocket
  if (this.wsService && this.wsService.chatId !== chatId && this.wsService.isConnected()) {
    console.log('Disconnecting from previous WebSocket before connecting to new conversation');
    this.wsService.disconnect();
  }

  // Clear message service state
  if (this.messageService) {
    this.messageService.clear();
  }

  // Clear UI if available
  if (this.ui?.messageList) {
    this.ui.messageList.clear();
  }

  return this.conversationService.loadConversation(chatId)
    .then(success => {
      this._isLoadingConversation = false;
      if (success) {
        console.log(`Successfully loaded conversation: ${chatId}`, this.conversationService.currentConversation);

        // Initialize message service w/ HTTP initially
        this.messageService.initialize(chatId, null);

        // Use our improved WebSocket connection function
        this.establishWebSocketConnection(chatId)
          .catch(error => {
            console.warn("WebSocket connection failed completely:", error);
          });

        // Update URL if mismatch
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('chatId') !== chatId) {
          window.history.pushState({}, '', `/?chatId=${chatId}`);
        }

        // Show chat UI
        if (this.container) {
          this.container.classList.remove('hidden');
        }
        const noChatMsg = document.getElementById("noChatSelectedMessage");
        if (noChatMsg) {
          noChatMsg.classList.add('hidden');
        }
      } else {
        console.warn(`Failed to load conversation: ${chatId}`);
      }
      return success;
    })
    .catch(error => {
      this._isLoadingConversation = false;
      console.error(`Error loading conversation ${chatId}:`, error);
      throw error;
    });
};

// Create a new conversation
window.ChatInterface.prototype.createNewConversation = async function () {
  if (!this.conversationService) {
    console.error("Conversation service not initialized");
    if (this.notificationFunction) {
      this.notificationFunction("Chat service not initialized. Please refresh the page.", "error");
    }
    throw new Error("Conversation service not initialized");
  }

  try {
    console.log('Creating new conversation...');

    // Initialize and verify auth in one consolidated block
    try {
      if (!window.auth?.isInitialized) {
        await window.auth.init();
      }
      await window.auth.getAuthToken();
    } catch (authError) {
      console.warn("[chat-interface] Authentication failed:", authError);
      
      // Notify UI and fail immediately for auth errors
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated: false,
          requiresLogin: true,
          error: authError.message.includes('no valid tokens')
            ? 'Session expired - please log in again'
            : 'Authentication failed'
        }
      }));
      throw new Error('Authentication required - please log in');
    }

    // Only proceed with chat operations if auth succeeded
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 300;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Chat operation logic
        let conversation;
        if (this.projectId && window.projectManager?.createConversation) {
          conversation = await window.projectManager.createConversation(this.projectId);
        } else {
          conversation = await this.conversationService.createNewConversation();
        }

        if (!conversation?.id) {
          throw new Error('Invalid conversation response from server');
        }

        console.log(`New conversation created successfully with ID: ${conversation.id}`);
        this.currentChatId = conversation.id;
        window.history.pushState({}, '', `/?chatId=${conversation.id}`);

        // Initialize message service
        if (this.messageService) {
          if (window.MODEL_CONFIG) {
            this.messageService.updateModelConfig(window.MODEL_CONFIG);
          }
          this.messageService.initialize(conversation.id, null);
          await this.establishWebSocketConnection(conversation.id);
        }

        // Update UI
        if (this.container) this.container.classList.remove('hidden');
        document.getElementById("noChatSelectedMessage")?.classList.add('hidden');
        
        return conversation;
      } catch (error) {
        console.warn(`[chat-interface] Conversation creation attempt ${attempt} failed:`, error);
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, attempt - 1)));
      }
    }

    if (!authVerified) {
      let errorMsg = "Authentication failed";
      let redirectToLogin = true;

      if (lastError?.message?.includes('timeout')) {
        errorMsg = "Authentication check timed out - please try again";
      } else if (lastError?.message?.includes('refresh') || lastError?.message?.includes('token')) {
        errorMsg = "Session expired - please log in again";
      } else if (lastError?.status === 401) {
        errorMsg = "Session expired - please log in again";
      } else if (lastError?.message) {
        errorMsg = lastError.message;
      }

      if (lastError?.message?.includes('NetworkError') ||
        lastError?.message?.includes('Failed to fetch')) {
        redirectToLogin = false;
        errorMsg = "Network error - please check your connection";
      }

      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated: false,
          redirectToLogin: true,
          error: errorMsg
        }
      }));

      if (this.notificationFunction) {
        this.notificationFunction(errorMsg, 'error');
      }
      throw new Error(`Auth verification failed: ${errorMsg}`);
    }

    // Dispatch auth success
    window.dispatchEvent(new CustomEvent('authStateChanged', {
      detail: {
        authenticated: true,
        username: window.auth?.username || null
      }
    }));

    // We removed localStorage usage for modelName, so:
    const currentModel = window.MODEL_CONFIG?.modelName || "claude-3-sonnet-20240229";
    console.log(`Using model: ${currentModel} for new conversation`);

    // Attempt conversation creation
    let conversation;
    try {
      // We no longer store selectedProjectId in localStorage, so rely on this.projectId if present
      if (this.projectId && window.projectManager && typeof window.projectManager.createConversation === 'function') {
        conversation = await window.projectManager.createConversation(this.projectId);
      } else {
        // Ensure conversation service is available
        if (!this.conversationService || typeof this.conversationService.createNewConversation !== 'function') {
          throw new Error('Conversation service not properly initialized');
        }
        conversation = await this.conversationService.createNewConversation();
      }

      if (!conversation?.id) {
        throw new Error('Invalid conversation response from server');
      }
      console.log(`New conversation created successfully with ID: ${conversation.id}`);
      this.currentChatId = conversation.id;

      window.history.pushState({}, '', `/?chatId=${conversation.id}`);

      if (this.messageService) {
        if (window.MODEL_CONFIG) {
          this.messageService.updateModelConfig(window.MODEL_CONFIG);
        }
        this.messageService.initialize(conversation.id, null);
        console.log('Message service initialized with HTTP mode');

        // Use the improved WebSocket connection function
        await this.establishWebSocketConnection(conversation.id);
      } else {
        console.error('Message service not available');
        window.ChatUtils?.handleError?.('Message service not initialized', new Error('Message service not available'), this.notificationFunction);
        return;
      }

      if (this.container) {
        this.container.classList.remove('hidden');
      }
      const noChatMsg = document.getElementById("noChatSelectedMessage");
      if (noChatMsg) {
        noChatMsg.classList.add('hidden');
      }
      return conversation;
    } catch (error) {
      console.error('Conversation creation failed:', error);
      let message = 'Failed to create conversation';
      let showLogin = false;

      // Null check before accessing error properties
      if (error && typeof error === 'object') {
        if (error.message) {
          if (error.message.includes('Not authenticated')) {
            message = 'Session expired - please log in again';
            showLogin = true;
          } else if (error.message.includes('knowledge base')) {
            message = 'Created chat but knowledge integration failed';
          } else if (error.message.includes('timeout')) {
            message = 'Request timed out - please try again';
          } else if (error.message.includes('NetworkError') || error.message.includes('network')) {
            message = 'Network error - please check your connection';
          } else {
            // Use the actual error message when available
            message = `Failed to create conversation: ${error.message}`;
          }
        }

        if (error.status === 401 || error.code === 401) {
          message = 'Session expired - please log in again';
          showLogin = true;
        }
      }

      if (showLogin) {
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: {
            authenticated: false,
            redirectToLogin: true,
            error: message
          }
        }));
      }
      if (this.notificationFunction) {
        this.notificationFunction(message, 'error');
      }
      throw error;
    }
  } catch (error) {
    console.error('Failed to create conversation:', error);
    let userMessage = 'Failed to create conversation';
    let isAuthError = false;

    if (error && typeof error === 'object' && error.message) {
      if (error.message.includes('Not authenticated') ||
        error.message.includes('401') ||
        error.message.includes('token')) {
        userMessage = 'Session expired - please log in again';
        isAuthError = true;
      } else if (error.message.includes('timeout')) {
        userMessage = 'Request timed out - please try again';
      } else if (error.message.includes('NetworkError') || error.message.includes('network')) {
        userMessage = 'Network error - please check your connection';
      } else {
        userMessage = `Error: ${error.message}`;
      }
    }

    if (isAuthError) {
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated: false,
          redirectToLogin: true,
          error: userMessage
        }
      }));
    }
    if (this.notificationFunction) {
      this.notificationFunction(userMessage, 'error');
    }

    this.currentChatId = null;
    if (this.wsService?.isConnected()) {
      this.wsService.disconnect();
    }
    throw error;
  }
};

// Change the target container for message rendering
window.ChatInterface.prototype.setTargetContainer = function (selector) {
  if (!this.ui || !this.ui.messageList) {
    console.error("UI components not initialized yet.");
    return;
  }
  const newContainer = document.querySelector(selector);
  if (newContainer) {
    this.ui.messageList.container = newContainer;
    console.log(`Chat message container set to: ${selector}`);
    return true;
  } else {
    console.error(`Failed to find container with selector: ${selector}`);
    return false;
  }
};

// Handle conversation loaded event
window.ChatInterface.prototype._handleConversationLoaded = function (conversation) {
  console.log('Handling conversation loaded:', conversation);

  if (!conversation) {
    console.error('No conversation data received');
    return;
  }

  if (this.titleEl) {
    this.titleEl.textContent = conversation.title || "New Chat";
  }

  if (conversation.messages) {
    console.log('Rendering messages:', conversation.messages.length);
    this.ui.messageList.renderMessages(conversation.messages);
  } else {
    console.warn('No messages in conversation');
    this.ui.messageList.renderMessages([]);
  }

  document.dispatchEvent(new CustomEvent('conversationLoaded', {
    detail: { conversation }
  }));
};

// Handle message received event
window.ChatInterface.prototype._handleMessageReceived = function (message) {
  this.ui.messageList.removeThinking();
  this.ui.messageList.appendMessage(
    message.role,
    message.content,
    null,
    message.thinking,
    message.redacted_thinking,
    message.metadata
  );

  document.dispatchEvent(new CustomEvent('messageReceived', {
    detail: { message }
  }));

  if (this.conversationService.currentConversation) {
    const msgs = this.conversationService.currentConversation.messages || [];
    msgs.push(message);
    this.conversationService.currentConversation.messages = msgs;
  }
};

// UUID validation helper
window.ChatInterface.prototype.isValidUUID = function (uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// Delete the current conversation
window.ChatInterface.prototype.deleteConversation = async function (chatId) {
  if (!chatId && this.currentChatId) {
    chatId = this.currentChatId;
  }

  if (!this.isValidUUID(chatId)) {
    this.notificationFunction("Invalid conversation ID", "error");
    return false;
  }

  try {
    // Rely on in-memory projectId if needed
    const projectId = this.projectId;
    const success = await this.conversationService.deleteConversation(chatId, projectId);

    if (success) {
      // If we deleted the current conversation, clear out UI and reset state
      if (chatId === this.currentChatId) {
        this.currentChatId = null;
        this.ui.messageList.clear();

        if (this.titleEl) {
          this.titleEl.textContent = "No conversation selected";
        }

        if (this.conversationService) {
          this.conversationService.currentConversation = null;
        }

        // Remove chatId from the URL so reloading won't reload a deleted chat
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.delete("chatId");
        window.history.pushState({}, "", `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`);
      }
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("[deleteConversation] Error deleting conversation:", error);
    this.notificationFunction("Failed to delete conversation", "error");
    throw error;
  }
};

/**
 * Establish WebSocket connection with proper retry logic
 * @param {string} conversationId - The ID of the conversation to connect to
 * @returns {Promise<boolean>} Whether connection was successful
 */
window.ChatInterface.prototype.establishWebSocketConnection = async function (conversationId) {
  if (!this.wsService) {
    console.error('WebSocket service not initialized');
    return false;
  }

  const MAX_WS_RETRIES = 2;
  let wsConnected = false;

  for (let attempt = 1; attempt <= MAX_WS_RETRIES; attempt++) {
    try {
      console.log(`[ChatInterface] Attempting WebSocket connection (attempt ${attempt})...`);
      await this.wsService.connect(conversationId);
      wsConnected = true;
      console.log('[ChatInterface] WebSocket connected successfully');
      this.notificationFunction('Real-time connection established', 'success');

      // Initialize message service with WebSocket
      this.messageService.initialize(conversationId, this.wsService);
      return true;
    } catch (error) {
      console.warn(`[ChatInterface] WebSocket connection attempt ${attempt} failed:`, error);

      // Provide feedback on final attempt
      if (attempt === MAX_WS_RETRIES) {
        const msg = error.message?.includes('auth')
          ? 'WebSocket authentication failed - using HTTP mode'
          : 'WebSocket connection failed - using HTTP mode';
        this.notificationFunction(msg, 'warning');
      }

      // Exponential backoff between attempts
      if (attempt < MAX_WS_RETRIES) {
        const backoffMs = 500 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  // If WebSocket connection failed, initialize with HTTP
  console.log('[ChatInterface] Using HTTP fallback for messaging');  
  this.messageService.initialize(conversationId, null);
  return false;
};

/**
 * chat-interface.js
 * Chat interface that coordinates all components,
 * now with no localStorage usage or cross-origin references.
 */

// Debug flag for verbose auth logging
const AUTH_DEBUG = true;  // Toggle as needed

// Converted from ES modules to global references
const ConversationService = window.ConversationService;
const MessageService = window.MessageService;
const UIComponents = window.UIComponents;

// Initialize the interface
window.ChatInterface = function (options = {}) {
  // Event system
  this._eventHandlers = {};

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

  // Set up container selectors by unifying logic into a single function
  this._setupProjectContext();

  const getSelector = (optKey, fallbackProjects, fallbackCenter) => {
    // If user passed an explicit option, use it
    if (options[optKey]) return options[optKey];
    // Otherwise, pick fallback based on isProjectsPage
    return this.isProjectsPage ? fallbackProjects : fallbackCenter;
  };

  this.containerSelector = getSelector('containerSelector', '#projectChatUI', '#chatUI');
  this.messageContainerSelector = getSelector('messageContainerSelector', '#projectChatMessages', '#conversationArea');
  this.inputSelector = getSelector('inputSelector', '#projectChatInput', '#chatInput');
  this.sendButtonSelector = getSelector('sendButtonSelector', '#projectChatSendBtn', '#sendBtn');

  if (AUTH_DEBUG) {
    console.log('[ChatInterface] Determined selectors:', {
      container: this.containerSelector,
      messages: this.messageContainerSelector,
      input: this.inputSelector,
      sendButton: this.sendButtonSelector
    });
  }

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
        this.messageService.sendMessage({ role: "user", content: messageText });
        resolve();
      } else {
        setTimeout(checkInitialized, 50);
      }
    };
    checkInitialized();
  });
};

window.ChatInterface.prototype.initialize = async function () {
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

  try {
    if (!window.MessageService) {
      throw new Error('MessageService not available');
    }
    this.messageService = new window.MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: () => this.ui.messageList.addThinking(),
      onError: (context, err) => {
        // Emit error event to any registered handlers
        this.emit('error', { context, error: err });
        // Also use the default error handler
        window.ChatUtils?.handleError?.(context, err, this.notificationFunction)
      }
    });
    // WebSocket service removed
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

  // No WebSocket auth listeners needed

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
  const requiredServices = ['ConversationService', 'MessageService', 'UIComponents'];
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
    // Check if auth is still initializing
    if (window.__authInitializing) {
      console.log('[ChatInterface] Auth is initializing, waiting before creating conversation');
      setTimeout(() => {
        this._handleInitialConversation();
      }, 300);
      return;
    }

    // Safe auth check with proper error handling
    const checkAuth = async () => {
      try {
        // First make sure auth is initialized
        if (!window.auth?.isInitialized) {
          await window.auth.init();
        }

        // Wait a small amount to let auth state settle
        await new Promise(resolve => setTimeout(resolve, 100));

        let isAuthenticated = false;
        try {
          // Try to verify auth state with error handling
          isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        } catch (verifyError) {
          console.warn('Auth verification error:', verifyError);
          if (window.auth.authState?.isAuthenticated) {
            isAuthenticated = true;
          }
        }

        if (!isAuthenticated) {
          // Show login required message
          const loginMsg = document.getElementById("loginRequiredMessage");
          if (loginMsg) loginMsg.classList.remove("hidden");
          return Promise.reject(new Error('Not authenticated'));
        }

        // If we got here, we should be authenticated, create new conversation
        if (!this.currentChatId) {
          return this.createNewConversation()
            .catch(error => {
              // Use ChatUtils error handler if available
              if (window.ChatUtils?.handleError) {
                window.ChatUtils.handleError('Creating new conversation', error, this.notificationFunction);
              } else {
                console.error('Error creating conversation:', error);
                this.notificationFunction?.('Failed to create conversation: ' + error.message, 'error');
              }
              throw error;
            });
        }
      } catch (error) {
        console.warn('[ChatInterface] Error in initial conversation setup:', error);
        // Show login required message for auth errors
        if (error.message?.includes('auth') || error.message?.includes('Not authenticated')) {
          const loginMsg = document.getElementById("loginRequiredMessage");
          if (loginMsg) loginMsg.classList.remove("hidden");
        }
      }
    };

    // Start auth check process
    checkAuth();
  }
};

// Set up event listeners for custom events
window.ChatInterface.prototype._setupEventListeners = function () {
  // Tab visibility handling for WebSocket reconnection
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Page is now visible again, check connections
      // WebSocket reconnection removed
    }
  });

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

        // Initialize message service
        this.messageService.initialize(chatId);

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

      // Wait a moment for auth state to stabilize after login/init
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if the auth module thinks we're authenticated
      if (window.auth.isInitialized && window.auth.authState?.isAuthenticated === false) {
        throw new Error('Not authenticated - please login first');
      }

      // Check for direct token first to avoid premature verification/refresh
      let isAuthenticatedViaDirectToken = false;
      if (window.__directAccessToken && window.__recentLoginTimestamp) {
        const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
        if (timeSinceLogin < 5000) {
          if (AUTH_DEBUG) {
            console.debug(`[ChatInterface] Using direct token for initial auth check (${timeSinceLogin}ms since login)`);
          }
          isAuthenticatedViaDirectToken = true;
        } else {
           // Clear the cached token after the grace period
           if (AUTH_DEBUG) {
             console.debug(`[ChatInterface] Direct token grace period expired (${timeSinceLogin}ms since login)`);
           }
           window.__directAccessToken = null; // Clear expired direct token
        }
      }

      // If not authenticated via direct token, proceed with standard check
      if (!isAuthenticatedViaDirectToken) {
        if (AUTH_DEBUG) {
           console.debug('[ChatInterface] Direct token not available or expired, proceeding with getAuthToken check.');
        }
        // Get token with less aggressive checking
        try {
          await window.auth.getAuthToken();
        } catch (tokenError) {
          console.warn("[chat-interface] Token retrieval failed:", tokenError);
          // Only throw if this isn't just a verification error
          if (!tokenError.message?.includes('verification')) {
            throw tokenError;
          }
          // If it's just a verification error, we might still be okay if authState says so
          if (!window.auth.authState?.isAuthenticated) {
             throw new Error('Authentication failed after token check');
          }
        }
      }
    } catch (authError) {
      console.warn("[chat-interface] Authentication failed during createNewConversation:", authError);

      // Let auth.js handle the error if available
      if (window.auth && typeof window.auth.handleAuthError === 'function') {
        window.auth.handleAuthError(authError, "creating conversation");
      }

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
          // If we have a direct token from login, pass it explicitly to avoid refresh issues
          if (window.__directAccessToken && window.__recentLoginTimestamp) {
            const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
            if (timeSinceLogin < 5000) {
              console.debug('[ChatInterface] Explicitly using direct access token for conversation creation');
              // Check if user is authenticated before attempting to create conversation
              let isAuthed = await window.auth.isAuthenticated();
              if (!isAuthed) {
                console.warn("[ChatInterface] User not authenticated, skipping conversation creation.");
                return null;
              }
              conversation = await this.conversationService.createNewConversationWithToken(window.__directAccessToken);
            } else {
              // Check if user is authenticated before attempting to create conversation
              let isAuthed = await window.auth.isAuthenticated();
              if (!isAuthed) {
                console.warn("[ChatInterface] User not authenticated, skipping conversation creation.");
                return null;
              }
              conversation = await this.conversationService.createNewConversation();
            }
          } else {
            // Check if user is authenticated before attempting to create conversation
            let isAuthed = await window.auth.isAuthenticated();
            if (!isAuthed) {
              console.warn("[ChatInterface] User not authenticated, skipping conversation creation.");
              return null;
            }
            conversation = await this.conversationService.createNewConversation();
          }
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
          console.log("[ChatInterface] Message service initialized for new conversation");
          console.log("[ChatInterface] New conversation initialized with HTTP transport");
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
    // WebSocket disconnection removed
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

  // Emit event to any registered handlers (for ProjectDetailsComponent)
  this.emit('messageSent', message);

  // Also dispatch a DOM event (for backwards compatibility)
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

// Event system methods
window.ChatInterface.prototype.on = function(eventName, handler) {
  if (!this._eventHandlers) {
    this._eventHandlers = {};
  }

  if (!this._eventHandlers[eventName]) {
    this._eventHandlers[eventName] = [];
  }

  this._eventHandlers[eventName].push(handler);
  console.log(`[ChatInterface] Registered handler for event: ${eventName}`);
  return this; // For chaining
};

window.ChatInterface.prototype.emit = function(eventName, data) {
  if (!this._eventHandlers || !this._eventHandlers[eventName]) {
    return false; // No handlers for this event
  }

  console.log(`[ChatInterface] Emitting event: ${eventName}`, data);
  this._eventHandlers[eventName].forEach(handler => {
    try {
      handler(data);
    } catch (err) {
      console.error(`[ChatInterface] Error in event handler for ${eventName}:`, err);
    }
  });

  return true;
};

window.ChatInterface.prototype.configureSelectors = function(customOpts = {}) {
  if (!customOpts) return;

  // Example logic that sets new container/input selectors if provided:
  if (customOpts.containerSelector) {
    this.containerSelector = customOpts.containerSelector;
  }
  if (customOpts.messageContainerSelector) {
    this.messageContainerSelector = customOpts.messageContainerSelector;
  }
  if (customOpts.inputSelector) {
    this.inputSelector = customOpts.inputSelector;
  }
  if (customOpts.sendButtonSelector) {
    this.sendButtonSelector = customOpts.sendButtonSelector;
  }

  // For debugging
  console.log('[ChatInterface.configureSelectors] Updated selectors:', {
    container: this.containerSelector,
    messages: this.messageContainerSelector,
    input: this.inputSelector,
    sendButton: this.sendButtonSelector
  });
};

/**
 * chat-interface.js
 * Chat interface that coordinates all components,
 * now with no localStorage usage or cross-origin references.
 */

// Configuration for logging levels
const CONFIG = {
  LOG_LEVEL: 'error', // 'debug', 'info', 'warn', 'error', or 'none'
  AUTH_DEBUG: false,   // Explicitly disabled by default
  MAX_AUTH_RETRIES: 3,
  AUTH_RETRY_DELAY: 300
};

// Logger utility to standardize logging
const Logger = {
  debug: (...args) => CONFIG.LOG_LEVEL === 'debug' ? console.debug('[ChatInterface]', ...args) : null,
  info: (...args) => ['debug', 'info'].includes(CONFIG.LOG_LEVEL) ? console.info('[ChatInterface]', ...args) : null,
  warn: (...args) => ['debug', 'info', 'warn'].includes(CONFIG.LOG_LEVEL) ? console.warn('[ChatInterface]', ...args) : null,
  error: (...args) => CONFIG.LOG_LEVEL !== 'none' ? console.error('[ChatInterface]', ...args) : null
};

// Converted from ES modules to global references
const ConversationService = window.ConversationService;
const MessageService = window.MessageService;
const UIComponents = window.UIComponents;

/**
 * ChatInterface - Main class for chat functionality
 * @param {Object} options - Configuration options
 * @param {string} [options.containerSelector] - Selector for the chat container
 * @param {string} [options.titleSelector] - Selector for the chat title element
 * @param {string} [options.messageContainerSelector] - Selector for the message container
 * @param {string} [options.inputSelector] - Selector for the input field
 * @param {string} [options.sendButtonSelector] - Selector for the send button
 * @param {Function} [options.showNotification] - Custom notification function
 */
window.ChatInterface = function (options = {}) {
  // Event system
  this._eventHandlers = {};

  // Initialize services and components to null
  this.messageService = null;
  this.conversationService = null;
  this.ui = null;

  // State tracking
  this.currentChatId = null;
  this.currentImage = null;
  this.initialized = false;
  this._isLoadingConversation = false;
  this.projectId = null;
  this.isProjectsPage = false;

  // Set up container and project context
  this._setupProjectContext();
  this._setupSelectors(options);

  // Set up notification handler
  this.notificationFunction = this._createNotificationFunction(options);

  // Get container and title elements
  this.container = document.querySelector(this.containerSelector);
  this.titleEl = document.querySelector(options.titleSelector || '#chatTitle');
};

/**
 * Sets up the project context based on URL
 * @private
 */
window.ChatInterface.prototype._setupProjectContext = function () {
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

/**
 * Creates notification function that handles different notification methods
 * @private
 * @param {Object} options - Options that may contain showNotification
 * @returns {Function} Notification function
 */
window.ChatInterface.prototype._createNotificationFunction = function (options) {
  return (message, type) => {
    if (window.Notifications) {
      switch (type) {
        case 'error': return window.Notifications.apiError(message);
        case 'success': return window.Notifications.apiSuccess?.(message);
        default: return Logger.info(`[${type.toUpperCase()}] ${message}`);
      }
    }
    return (options.showNotification || window.showNotification || console.log)(message, type);
  };
};

/**
 * Sets up selectors based on page context and options
 * @private
 * @param {Object} options - Configuration options
 */
window.ChatInterface.prototype._setupSelectors = function (options) {
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

  if (CONFIG.AUTH_DEBUG) {
    Logger.debug('Determined selectors:', {
      container: this.containerSelector,
      messages: this.messageContainerSelector,
      input: this.inputSelector,
      sendButton: this.sendButtonSelector
    });
  }
};

/**
 * Handles sending messages from UI
 * @private
 * @param {string} messageText - The text of the message to send
 * @returns {Promise} Promise that resolves when message is sent
 */
window.ChatInterface.prototype._handleSendMessage = function (messageText) {
  // Ensure auth is initialized before sending
  if (!window.auth?.isInitialized) {
    Logger.info('Initializing auth before sending message');
    window.auth.init().catch(err => {
      Logger.error('Auth initialization failed:', err);
    });
  }

  // Wait for auth initialization to complete
  return new Promise((resolve, reject) => {
    const checkInitialized = () => {
      if (window.auth?.isInitialized) {
        Logger.info('Auth initialized, sending message');
        // Implement message sending logic
        Logger.info("Sending message:", messageText);
        this.messageService.sendMessage({ role: "user", content: messageText });
        resolve();
      } else {
        setTimeout(checkInitialized, 50);
      }
    };
    checkInitialized();
  });
};

/**
 * Initializes the chat interface
 * @returns {Promise} Promise that resolves when initialization is complete
 */
window.ChatInterface.prototype.initialize = async function () {
  // Prevent double initialization
  if (this.initialized) {
    Logger.warn("Chat interface already initialized");
    return;
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
  } catch (error) {
    Logger.error('Failed to initialize MessageService:', error);
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

  // Set up custom event handlers
  this._setupEventListeners();

  // Set up delete conversation button
  this._setupDeleteButton();

  // Check dependencies
  this._checkDependencies();

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
  await this._handleInitialConversation();

  this.initialized = true;
  document.dispatchEvent(new CustomEvent('chatInterfaceInitialized'));
};

/**
 * Sets up the delete conversation button
 * @private
 */
window.ChatInterface.prototype._setupDeleteButton = function () {
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
};

/**
 * Checks for required dependencies
 * @private
 * @throws {Error} If required services are missing
 */
window.ChatInterface.prototype._checkDependencies = function () {
  const requiredServices = ['ConversationService', 'MessageService', 'UIComponents'];
  const missingServices = requiredServices.filter(service => !window[service]);

  if (missingServices.length > 0) {
    const errorMsg = `Required services not loaded: ${missingServices.join(', ')}`;
    Logger.error(errorMsg);
    throw new Error(errorMsg);
  }
};

/**
 * Handle initial conversation loading or creation
 * @private
 * @returns {Promise} Promise that resolves when initial conversation is ready
 */
window.ChatInterface.prototype._handleInitialConversation = async function () {
  if (this.currentChatId) {
    // Load existing conversation if ID is in URL
    return this.loadConversation(this.currentChatId);
  }

  // Check if auth is still initializing
  if (window.__authInitializing) {
    Logger.info('Auth is initializing, waiting before creating conversation');
    await new Promise(resolve => setTimeout(resolve, 300));
    return this._handleInitialConversation();
  }

  try {
    const isAuthenticated = await this._verifyAuthentication();

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
            Logger.error('Error creating conversation:', error);
            this.notificationFunction?.('Failed to create conversation: ' + error.message, 'error');
          }
          throw error;
        });
    }
  } catch (error) {
    Logger.warn('Error in initial conversation setup:', error);
    // Show login required message for auth errors
    if (error.message?.includes('auth') || error.message?.includes('Not authenticated')) {
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) loginMsg.classList.remove("hidden");
    }
    return Promise.reject(error);
  }
};

/**
 * Verifies the current authentication state
 * @private
 * @param {Object} [options] - Options for verification
 * @param {boolean} [options.forceVerify=false] - Force verification with server
 * @returns {Promise<boolean>} Promise resolving to authentication state
 */
window.ChatInterface.prototype._verifyAuthentication = async function (options = {}) {
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
      Logger.warn('Auth verification error:', verifyError);
      if (window.auth.authState?.isAuthenticated) {
        isAuthenticated = true;
      }
    }

    return isAuthenticated;
  } catch (error) {
    Logger.error('Authentication verification failed:', error);
    return false;
  }
};

/**
 * Set up event listeners for custom events
 * @private
 */
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
      Logger.info("Updating message service with new model config");
      this.messageService.updateModelConfig(e.detail);
    }
  });
};

/**
 * Find the last user message for regeneration
 * @private
 * @returns {string|null} Last user message or null if none found
 */
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

/**
 * Find the last assistant message for copying
 * @private
 * @returns {string|null} Last assistant message or null if none found
 */
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

/**
 * Load a conversation
 * @param {string} chatId - The conversation ID to load
 * @returns {Promise<boolean>} Promise resolving to success state
 */
window.ChatInterface.prototype.loadConversation = function (chatId) {
  if (!chatId || !this._isValidUUID(chatId)) {
    return Promise.reject(new Error('No conversation ID provided'));
  }

  // Skip if already loading
  if (this.currentChatId === chatId && this._isLoadingConversation) {
    return Promise.resolve(false);
  }

  Logger.info(`Loading conversation with ID: ${chatId}`);
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
        Logger.info(`Successfully loaded conversation: ${chatId}`, this.conversationService.currentConversation);

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
        Logger.warn(`Failed to load conversation: ${chatId}`);
      }
      return success;
    })
    .catch(error => {
      this._isLoadingConversation = false;
      Logger.error(`Error loading conversation ${chatId}:`, error);
      throw error;
    });
};

/**
 * Create a new conversation
 * @returns {Promise<Object>} Promise resolving to the new conversation
 */
window.ChatInterface.prototype.createNewConversation = async function () {
  if (!this.conversationService) {
    Logger.error("Conversation service not initialized");
    this.notificationFunction("Chat service not initialized. Please refresh the page.", "error");
    throw new Error("Conversation service not initialized");
  }

  try {
    Logger.info('Creating new conversation...');

    // Perform authentication check
    const authResult = await this._performAuthCheck();
    if (!authResult.isAuthenticated) {
      throw new Error(authResult.errorMessage || 'Authentication required');
    }

    const conversation = await this._createConversationWithRetry();

    if (!conversation?.id) {
      throw new Error('Invalid conversation response from server');
    }

    Logger.info(`New conversation created successfully with ID: ${conversation.id}`);
    this.currentChatId = conversation.id;
    window.history.pushState({}, '', `/?chatId=${conversation.id}`);

    // Initialize message service
    if (this.messageService) {
      if (window.MODEL_CONFIG) {
        this.messageService.updateModelConfig(window.MODEL_CONFIG);
      }
      this.messageService.initialize(conversation.id, null);
      Logger.info("Message service initialized for new conversation");
    }

    // Update UI
    if (this.container) this.container.classList.remove('hidden');
    document.getElementById("noChatSelectedMessage")?.classList.add('hidden');

    return conversation;
  } catch (error) {
    Logger.error('Failed to create conversation:', error);
    this._handleConversationCreationError(error);
    throw error;
  }
};

/**
 * Performs authentication check with proper error handling
 * @private
 * @returns {Promise<Object>} Authentication result object
 */
window.ChatInterface.prototype._performAuthCheck = async function () {
  try {
    // Initialize auth if needed
    if (!window.auth?.isInitialized) {
      await window.auth.init();
    }

    // Wait for auth state to stabilize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check auth state
    if (window.auth.isInitialized && window.auth.authState?.isAuthenticated === false) {
      return {
        isAuthenticated: false,
        errorMessage: 'Not authenticated - please login first'
      };
    }

    // Check for direct token first
    let isAuthenticatedViaDirectToken = false;
    if (window.__directAccessToken && window.__recentLoginTimestamp) {
      const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
      if (timeSinceLogin < 5000) {
        if (CONFIG.AUTH_DEBUG) {
          Logger.debug(`Using direct token for initial auth check (${timeSinceLogin}ms since login)`);
        }
        isAuthenticatedViaDirectToken = true;
      } else {
        // Clear the cached token after the grace period
        if (CONFIG.AUTH_DEBUG) {
          Logger.debug(`Direct token grace period expired (${timeSinceLogin}ms since login)`);
        }
        window.__directAccessToken = null; // Clear expired direct token
      }
    }

    // If not authenticated via direct token, proceed with standard check
    if (!isAuthenticatedViaDirectToken) {
      if (CONFIG.AUTH_DEBUG) {
        Logger.debug('Direct token not available or expired, proceeding with getAuthToken check.');
      }

      try {
        await window.auth.getAuthToken();
      } catch (tokenError) {
        Logger.warn("Token retrieval failed:", tokenError);
        // Only return error if this isn't just a verification error
        if (!tokenError.message?.includes('verification')) {
          return { isAuthenticated: false, errorMessage: tokenError.message };
        }
        // If it's just a verification error, check authState
        if (!window.auth.authState?.isAuthenticated) {
          return { isAuthenticated: false, errorMessage: 'Authentication failed after token check' };
        }
      }
    }

    return { isAuthenticated: true };
  } catch (error) {
    Logger.warn("Authentication check failed:", error);
    return {
      isAuthenticated: false,
      errorMessage: error.message || 'Authentication check failed',
      error
    };
  }
};

/**
 * Creates a conversation with retry logic
 * @private
 * @returns {Promise<Object>} The created conversation
 */
window.ChatInterface.prototype._createConversationWithRetry = async function () {
  for (let attempt = 1; attempt <= CONFIG.MAX_AUTH_RETRIES; attempt++) {
    try {
      let conversation;

      // Handle project-specific creation
      if (this.projectId && window.projectManager?.createConversation) {
        conversation = await window.projectManager.createConversation(this.projectId);
      } else {
        // Handle direct token if available
        if (this._canUseDirectToken()) {
          Logger.debug('Explicitly using direct access token for conversation creation');
          const isAuthed = await window.auth.isAuthenticated();
          if (!isAuthed) {
            Logger.warn("User not authenticated, skipping conversation creation.");
            return null;
          }
          conversation = await this.conversationService.createNewConversationWithToken(window.__directAccessToken);
        } else {
          // Standard conversation creation
          const isAuthed = await window.auth.isAuthenticated();
          if (!isAuthed) {
            Logger.warn("User not authenticated, skipping conversation creation.");
            return null;
          }
          conversation = await this.conversationService.createNewConversation();
        }
      }

      return conversation;
    } catch (error) {
      Logger.warn(`Conversation creation attempt ${attempt} failed:`, error);
      if (attempt === CONFIG.MAX_AUTH_RETRIES) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, CONFIG.AUTH_RETRY_DELAY * Math.pow(2, attempt - 1)));
    }
  }
};

/**
 * Checks if direct token can be used
 * @private
 * @returns {boolean} Whether direct token can be used
 */
window.ChatInterface.prototype._canUseDirectToken = function () {
  if (window.__directAccessToken && window.__recentLoginTimestamp) {
    const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
    return timeSinceLogin < 5000;
  }
  return false;
};

/**
 * Handles errors during conversation creation
 * @private
 * @param {Error} error - The error that occurred
 */
window.ChatInterface.prototype._handleConversationCreationError = function (error) {
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

  this.notificationFunction(userMessage, 'error');
  this.currentChatId = null;
};

/**
 * Change the target container for message rendering
 * @param {string} selector - CSS selector for the new container
 * @returns {boolean} Success state
 */
window.ChatInterface.prototype.setTargetContainer = function (selector) {
  if (!this.ui || !this.ui.messageList) {
    Logger.error("UI components not initialized yet.");
    return false;
  }
  const newContainer = document.querySelector(selector);
  if (newContainer) {
    this.ui.messageList.container = newContainer;
    Logger.info(`Chat message container set to: ${selector}`);
    return true;
  } else {
    Logger.error(`Failed to find container with selector: ${selector}`);
    return false;
  }
};

/**
 * Handle conversation loaded event
 * @private
 * @param {Object} conversation - The loaded conversation
 */
window.ChatInterface.prototype._handleConversationLoaded = function (conversation) {
  Logger.info('Handling conversation loaded:', conversation);

  if (!conversation) {
    Logger.error('No conversation data received');
    return;
  }

  if (this.titleEl) {
    this.titleEl.textContent = conversation.title || "New Chat";
  }

  if (conversation.messages) {
    Logger.info('Rendering messages:', conversation.messages.length);
    this.ui.messageList.renderMessages(conversation.messages);
  } else {
    Logger.warn('No messages in conversation');
    this.ui.messageList.renderMessages([]);
  }

  document.dispatchEvent(new CustomEvent('conversationLoaded', {
    detail: { conversation }
  }));
};

/**
 * Handle message received event
 * @private
 * @param {Object} message - The received message
 */
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

  // Emit event to any registered handlers
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

/**
 * UUID validation helper
 * @param {string} uuid - UUID to validate
 * @returns {boolean} Whether the UUID is valid
 */
window.ChatInterface.prototype._isValidUUID = function (uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

/**
 * Delete the current conversation
 * @param {string} [chatId] - The conversation ID to delete
 * @returns {Promise<boolean>} Promise resolving to success state
 */
window.ChatInterface.prototype.deleteConversation = async function (chatId) {
  if (!chatId && this.currentChatId) {
    chatId = this.currentChatId;
  }

  if (!this._isValidUUID(chatId)) {
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
        this._resetStateAfterDeletion();
      }
      return true;
    } else {
      return false;
    }
  } catch (error) {
    Logger.error("Error deleting conversation:", error);
    this.notificationFunction("Failed to delete conversation", "error");
    throw error;
  }
};

/**
 * Reset state after conversation deletion
 * @private
 */
window.ChatInterface.prototype._resetStateAfterDeletion = function () {
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
};

/**
 * Register event handler
 * @param {string} eventName - Name of the event
 * @param {Function} handler - Event handler function
 * @returns {ChatInterface} this instance for chaining
 */
window.ChatInterface.prototype.on = function (eventName, handler) {
  if (!this._eventHandlers) {
    this._eventHandlers = {};
  }

  if (!this._eventHandlers[eventName]) {
    this._eventHandlers[eventName] = [];
  }

  this._eventHandlers[eventName].push(handler);
  Logger.info(`Registered handler for event: ${eventName}`);
  return this; // For chaining
};

/**
 * Emit event to registered handlers
 * @param {string} eventName - Name of the event
 * @param {*} data - Event data
 * @returns {boolean} Whether any handlers were called
 */
window.ChatInterface.prototype.emit = function (eventName, data) {
  if (!this._eventHandlers || !this._eventHandlers[eventName]) {
    return false; // No handlers for this event
  }

  Logger.info(`Emitting event: ${eventName}`, data);
  this._eventHandlers[eventName].forEach(handler => {
    try {
      handler(data);
    } catch (err) {
      Logger.error(`Error in event handler for ${eventName}:`, err);
    }
  });

  return true;
};

/**
 * Configure selectors for the interface
 * @param {Object} customOpts - Custom selector options
 */
window.ChatInterface.prototype.configureSelectors = function (customOpts = {}) {
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
  Logger.info('Updated selectors:', {
    container: this.containerSelector,
    messages: this.messageContainerSelector,
    input: this.inputSelector,
    sendButton: this.sendButtonSelector
  });
};

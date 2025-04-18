/**
 * chat-interface.js
 * Chat interface that coordinates all components.
 * Manages chat state and orchestrates interactions between UI, messaging, and conversation services.
 * Acts as the primary business logic layer (controller) tying user actions to backend operations.
 */

// Configuration for logging levels
// Use window.CONFIG to prevent redeclaration errors when script is loaded multiple times
if (typeof window.CONFIG === 'undefined') {
  window.CONFIG = {
    LOG_LEVEL: 'error', // 'debug', 'info', 'warn', 'error', or 'none'
    AUTH_DEBUG: true,    // Enable auth debugging for detailed logs
    MAX_AUTH_RETRIES: 3,
    AUTH_RETRY_DELAY: 300
  };
}
const CONFIG = window.CONFIG;

// Logger utility to standardize logging
const Logger = {
  debug: (...args) => CONFIG.LOG_LEVEL === 'debug' ? console.debug('[ChatInterface]', ...args) : null,
  info: (...args) => ['debug', 'info'].includes(CONFIG.LOG_LEVEL) ? console.info('[ChatInterface]', ...args) : null,
  warn: (...args) => ['debug', 'info', 'warn'].includes(CONFIG.LOG_LEVEL) ? console.warn('[ChatInterface]', ...args) : null,
  error: (...args) => CONFIG.LOG_LEVEL !== 'none' ? console.error('[ChatInterface]', ...args) : null
};

// Service references (assumed to be available on window)
const ConversationService = window.ConversationService;
const MessageService = window.MessageService;
const UIComponents = window.UIComponents;

/**
 * ChatInterface - Main class for chat functionality coordination
 * @param {Object} options - Configuration options
 * @param {string} [options.containerSelector] - Selector for the chat container
 * @param {string} [options.titleSelector] - Selector for the chat title element
 * @param {string} [options.messageContainerSelector] - Selector for the message container
 * @param {string} [options.inputSelector] - Selector for the input field
 * @param {string} [options.sendButtonSelector] - Selector for the send button
 */
window.ChatInterface = function (options = {}) {
  // Event system for custom handlers
  this._eventHandlers = {};

  // Event listeners tracking for cleanup
  this._eventListeners = [];

  // Initialize services and components to null (set during initialization)
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
  this.containerSelector = options.containerSelector || (window.location.pathname.includes('/projects') ? '#projectChatUI' : '#chatUI');
  this.messageContainerSelector = options.messageContainerSelector || (window.location.pathname.includes('/projects') ? '#projectChatMessages' : '#conversationArea');
  this.inputSelector = options.inputSelector || (window.location.pathname.includes('/projects') ? '#projectChatInput' : '#chatInput');
  this.sendButtonSelector = options.sendButtonSelector || (window.location.pathname.includes('/projects') ? '#projectChatSendBtn' : '#sendBtn');
  this.titleEl = document.querySelector(options.titleSelector || '#chatTitle');
  this.container = document.querySelector(this.containerSelector);

  // Determine project context based on URL
  this._setupProjectContext();

  // Log determined selectors if debugging is enabled
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
 * Sets up the project context based on URL.
 * @private
 */
window.ChatInterface.prototype._setupProjectContext = function () {
  this.isProjectsPage = window.location.pathname.includes('/projects');
  if (this.isProjectsPage) {
    const pathSegments = window.location.pathname.split('/');
    const projIndex = pathSegments.indexOf('projects');
    if (projIndex >= 0 && pathSegments[projIndex + 1]) {
      this.projectId = pathSegments[projIndex + 1];
    }
  }
  // Fallback to ChatUtils.getProjectId if not found in URL
  if (!this.projectId) {
    this.projectId = window.ChatUtils.getProjectId();
  }
};

/**
 * Initializes the chat interface, setting up UI and services.
 * @returns {Promise<void>} Promise that resolves when initialization is complete
 */
window.ChatInterface.prototype.initialize = async function () {
  // Prevent double initialization
  if (this.initialized) {
    Logger.warn("Chat interface already initialized");
    return;
  }

  // Wait for auth readiness using centralized utility
  await window.ChatUtils.ensureAuthReady();

  // Register with central app initializer if available
  if (window.appInitializer && window.appInitializer.register) {
    window.appInitializer.register({
      init: async () => {
        await this._setupDependencies();
        this.initialized = true;
        Logger.info("Chat interface initialized through app initializer");
      }
    });
  } else {
    // Fallback for direct initialization
    await this._setupDependencies();
    this.initialized = true;
    Logger.info("Chat interface initialized directly");
  }

  // Signal completion with event
  document.dispatchEvent(new CustomEvent('chatInterfaceInitialized', {
    detail: { instance: this }
  }));
};

/**
 * Sets up dependencies (UI, services, and event listeners).
 * @private
 * @returns {Promise<void>}
 */
window.ChatInterface.prototype._setupDependencies = async function () {
  // Initialize UI components with configured selectors
  this.ui = new UIComponents({
    messageContainerSelector: this.messageContainerSelector,
    inputSelector: this.inputSelector,
    sendButtonSelector: this.sendButtonSelector,
    onSend: (messageText) => this.sendMessage(messageText),
    onImageChange: (base64Data) => {
      this.currentImage = base64Data;
      if (base64Data) {
        this.ui.messageList.addImageIndicator(base64Data);
      }
    }
  });
  this.ui.init();

  // Ensure the chat container is visible for the current context
  const isProjectContext = this.isProjectsPage || this.projectId;
  await this.ui.ensureChatContainerVisible(isProjectContext);

  // Set up services
  this.conversationService = new ConversationService({
    onConversationLoaded: (conversation) => this._handleConversationLoaded(conversation),
    onLoadingStart: () => Logger.info('Loading conversation started...'),
    onLoadingEnd: () => Logger.info('Loading conversation ended.')
  });

  this.messageService = new MessageService({
    onMessageReceived: (message) => this._handleMessageReceived(message),
    onSending: () => this.ui.messageList.addThinking(),
    onError: (context, error) => window.ChatUtils.handleError(context, error)
  });

  // Set up event listeners for UI and global events
  this._setupEventListeners();

  // Handle initial conversation setup
  await this._handleInitialConversation();
};

/**
 * Ensures a project conversation exists - either loads existing or creates new
 * @param {string} projectId - The project ID to ensure a conversation for
 * @returns {Promise<Object>} The conversation object
 */
window.ChatInterface.prototype.ensureProjectConversation = async function (projectId) {
  if (!projectId) {
    throw new Error('Project ID is required');
  }

  // Store the project ID for the chat system
  localStorage.setItem("selectedProjectId", projectId);
  this.projectId = projectId;

  // Try to load the most recent conversation for this project
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  if (chatId) {
    try {
      // Try to load the specified conversation
      const success = await this.loadConversation(chatId);
      if (success) {
        return this.conversationService.currentConversation;
      }
    } catch (err) {
      Logger.warn(`Could not load conversation ${chatId}, will create new:`, err);
    }
  }

  // Otherwise create a new conversation for this project
  return await this.createNewConversation();
};

/**
 * Set up event listeners for custom events and UI interactions.
 * @private
 */
window.ChatInterface.prototype._setupEventListeners = function () {
  // Tab visibility handling (WebSocket logic removed as per consolidation)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Placeholder for future reconnection logic if needed
      Logger.info('Page visible, checking state...');
    }
  });

  // Handle regenerate chat request
  document.addEventListener('regenerateChat', () => {
    if (!this.currentChatId) return;
    const lastUserMessage = this._findLastUserMessage();
    if (lastUserMessage) {
      this.ui.messageList.removeLastAssistantMessage();
      this.messageService.sendMessage(lastUserMessage);
    } else {
      window.ChatUtils.showNotification('No message to regenerate', 'warning');
    }
  });

  // Handle copy last assistant message
  document.addEventListener('copyMessage', () => {
    const lastAssistantMessage = this._findLastAssistantMessage();
    if (lastAssistantMessage) {
      navigator.clipboard.writeText(lastAssistantMessage)
        .then(() => window.ChatUtils.showNotification('Message copied to clipboard', 'success'))
        .catch(err => window.ChatUtils.handleError('Copying message', err));
    }
  });

  // Listen for URL changes (browser navigation)
  window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');

    if (chatId && chatId !== this.currentChatId) {
      this.loadConversation(chatId);
    }
  });

  // Listen for model config changes to update message service
  document.addEventListener('modelConfigChanged', (e) => {
    if (this.messageService && e.detail) {
      Logger.info("Updating message service with new model config");
      this.messageService.updateModelConfig(e.detail);
    }
  });
};

/**
 * Find the last user message content for regeneration.
 * @private
 * @returns {string|null} Last user message content or null if none found
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
 * Find the last assistant message content for copying.
 * @private
 * @returns {string|null} Last assistant message content or null if none found
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
 * Handle initial conversation loading or creation.
 * @private
 * @returns {Promise<boolean>} Promise that resolves to success state of initial conversation setup
 */
window.ChatInterface.prototype._handleInitialConversation = async function () {
  // First check if we have a conversation ID to load from URL
  const urlParams = new URLSearchParams(window.location.search);
  const initialChatId = urlParams.get('chatId');
  if (initialChatId) {
    Logger.info(`Initial conversation: Loading existing chat ID: ${initialChatId}`);
    this.currentChatId = initialChatId;
    return await this.loadConversation(initialChatId);
  }

  // Check if a project is selected using centralized utility
  const projectId = window.ChatUtils.getProjectId();
  if (!projectId) {
    Logger.warn('No project is currently selected, skipping conversation creation');

    // Handle for when project isn't selected yet - check if we're on the project detail page
    const projectDetailsView = document.getElementById("projectDetailsView");
    const isProjectDetailsPage = projectDetailsView && !projectDetailsView.classList.contains('hidden');

    if (isProjectDetailsPage) {
      // On project details page but no project ID - might be loading, just log warning
      Logger.warn('On project details page but no project ID selected yet');
      return Promise.resolve(false);
    }

    // Standard handling for when not on project details page
    const noChatMsg = document.getElementById("noChatSelectedMessage");
    if (noChatMsg) {
      noChatMsg.classList.remove("hidden");
      // Update message to indicate a project selection is needed
      const msgContent = noChatMsg.querySelector('.content-message');
      if (msgContent) {
        msgContent.textContent = 'Please select a project before creating a conversation.';
      }
    }
    const projectsBtn = document.querySelector('.sidebar-action-btn[data-action="projects"]');
    if (projectsBtn) {
      Logger.info('Highlighting the projects button to guide the user');
      projectsBtn.classList.add('animate-pulse', 'bg-blue-50', 'dark:bg-blue-900/20');
      setTimeout(() => {
        projectsBtn.classList.remove('animate-pulse', 'bg-blue-50', 'dark:bg-blue-900/20');
      }, 5000);
    }
    window.ChatUtils.showNotification("Please select a project to start a conversation", "warning");
    return Promise.resolve(false);
  }

  try {
    // Check authentication status using centralized utility
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) {
        loginMsg.classList.remove("hidden");
        // Make sure the auth button is visible for easy login
        const authButton = document.getElementById('authButton');
        if (authButton) {
          authButton.classList.add('animate-pulse');
          setTimeout(() => authButton.classList.remove('animate-pulse'), 2000);
        }
      }
      Logger.info('User is not authenticated, showing login message');
      return Promise.reject(new Error('Not authenticated'));
    }

    Logger.info('User is authenticated, creating new conversation');
    // If no conversation ID, create a new one
    if (!this.currentChatId) {
      return await this.createNewConversation();
    }
    return true;
  } catch (error) {
    Logger.warn('Error in initial conversation setup:', error);
    window.ChatUtils.handleError('Initial conversation setup', error);
    // Show login required message for auth errors
    if (error.message?.includes('auth') || error.message?.includes('Not authenticated')) {
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) {
        loginMsg.classList.remove("hidden");
        // Hide the chat UI if it exists
        document.getElementById("chatUI")?.classList.add("hidden");
      }
    }
    return Promise.reject(error);
  }
};


/**
 * Load a conversation by ID.
 * @param {string} chatId - The conversation ID to load
 * @returns {Promise<boolean>} Promise resolving to success state
 */
window.ChatInterface.prototype.loadConversation = async function (chatId) {
  if (!chatId || !window.ChatUtils.isValidUUID(chatId)) {
    Logger.error('No valid conversation ID provided for loading');
    return Promise.reject(new Error('No conversation ID provided'));
  }

  // Skip if already loading the same chat
  if (this.currentChatId === chatId && this._isLoadingConversation) {
    Logger.info(`Already loading conversation ${chatId}, skipping...`);
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

  try {
    const success = await this.conversationService.loadConversation(chatId);
    this._isLoadingConversation = false;
    if (success) {
      Logger.info(`Successfully loaded conversation: ${chatId}`, this.conversationService.currentConversation);

      // Initialize message service with the loaded chat ID
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
  } catch (error) {
    this._isLoadingConversation = false;
    Logger.error(`Error loading conversation ${chatId}:`, error);
    window.ChatUtils.handleError(`Loading conversation ${chatId}`, error);
    throw error;
  }
};

/**
 * Create a new conversation.
 * @returns {Promise<Object>} Promise resolving to the new conversation object
 */
window.ChatInterface.prototype.createNewConversation = async function () {
  if (!this.conversationService) {
    Logger.error("Conversation service not initialized");
    window.ChatUtils.showNotification("Chat service not initialized. Please refresh the page.", "error");
    throw new Error("Conversation service not initialized");
  }

  try {
    Logger.info('Creating new conversation...');
    const isAuthenticated = await window.ChatUtils.isAuthenticated();
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }

    // Get project ID for context (required for creating conversations)
    const projectId = window.ChatUtils.getProjectId();
    if (!projectId) {
      Logger.warn('No project selected, cannot create conversation');
      window.ChatUtils.showNotification("Please select a project first", "warning");
      return null;
    }

    const conversation = await this.conversationService.createNewConversation();
    if (!conversation?.id) {
      throw new Error('Invalid conversation response from server');
    }

    Logger.info(`New conversation created successfully with ID: ${conversation.id}`);
    this.currentChatId = conversation.id;

    // Update URL with both project and chat ID
    const url = new URL(window.location.href);
    url.searchParams.set('chatId', conversation.id);
    // Only add project param if not already there
    if (!url.searchParams.has('project')) {
      url.searchParams.set('project', projectId);
    }
    window.history.pushState({}, '', url.toString());

    // Initialize message service
    if (this.messageService) {
      if (window.MODEL_CONFIG) {
        this.messageService.updateModelConfig(window.MODEL_CONFIG);
      }
      this.messageService.initialize(conversation.id);
      Logger.info("Message service initialized for new conversation");
    }

    // Update UI
    if (this.container) this.container.classList.remove('hidden');
    document.getElementById("noChatSelectedMessage")?.classList.add('hidden');

    return conversation;
  } catch (error) {
    Logger.error('Failed to create conversation:', error);
    window.ChatUtils.handleError('Creating new conversation', error);
    throw error;
  }
};

/**
 * Send a message to the current conversation.
 * @param {string} userMsg - The message content to send
 * @returns {Promise<Object>} Promise resolving to the response from the message service
 */
window.ChatInterface.prototype.sendMessage = async function (userMsg) {
  if (!this.initialized) {
    await this.initialize();
  }
  if (!this.messageService) {
    throw new Error('Message service not initialized');
  }

  // First create the message object with timestamp for UI
  const messageObj = {
    role: 'user',
    content: userMsg,
    timestamp: new Date().toISOString(),
    sender: window.auth?.getCurrentUser()?.id || 'unknown'
  };

  // Immediately render the sent message in UI
  this.ui.messageList.appendMessage(
    messageObj.role,
    messageObj.content,
    messageObj.timestamp
  );

  // Delegate actual sending to message service
  return await this.messageService.sendMessage(userMsg);
};

/**
 * Delete a conversation.
 * @param {string} [chatId] - The conversation ID to delete; defaults to currentChatId
 * @returns {Promise<boolean>} Promise resolving to success state
 */
window.ChatInterface.prototype.deleteConversation = async function (chatId) {
  if (!chatId && this.currentChatId) {
    chatId = this.currentChatId;
  }

  if (!window.ChatUtils.isValidUUID(chatId)) {
    window.ChatUtils.showNotification("Invalid conversation ID", "error");
    return false;
  }

  try {
    const projectId = window.ChatUtils.getProjectId() || this.projectId;
    const success = await this.conversationService.deleteConversation(chatId, projectId);

    if (success) {
      // If we deleted the current conversation, clear out UI and reset state
      if (chatId === this.currentChatId) {
        this._resetStateAfterDeletion();
      }
      window.ChatUtils.showNotification("Conversation deleted successfully", "success");
      return true;
    } else {
      return false;
    }
  } catch (error) {
    Logger.error("Error deleting conversation:", error);
    window.ChatUtils.handleError("Deleting conversation", error);
    throw error;
  }
};

/**
 * Reset state after conversation deletion.
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
 * Handle conversation loaded event, updating UI.
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
 * Handle message received event, updating UI.
 * @private
 * @param {Object} message - The received message
 */
window.ChatInterface.prototype._handleMessageReceived = function (message) {
  // Skip if this is our own sent message (already shown in UI)
  if (message.role === 'user' && message.sender === window.auth?.getCurrentUser()?.id) {
    return;
  }

  this.ui.messageList.removeThinking();
  this.ui.messageList.appendMessage(
    message.role,
    message.content,
    message.timestamp,
    message.thinking,
    message.redacted_thinking,
    message.metadata
  );

  // Emit event to any registered handlers
  this.emit('messageSent', message);

  // Also dispatch a DOM event for backwards compatibility
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
 * Register event handler for custom events.
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
 * Emit event to registered handlers.
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
 * Configure selectors for the interface.
 * @param {Object} customOpts - Custom selector options
 */
window.ChatInterface.prototype.configureSelectors = function (customOpts = {}) {
  if (!customOpts) return;

  // Update selectors if provided
  if (customOpts.containerSelector) {
    this.containerSelector = customOpts.containerSelector;
    this.container = document.querySelector(this.containerSelector);
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

  // Log updated selectors for debugging
  Logger.info('Updated selectors:', {
    container: this.containerSelector,
    messages: this.messageContainerSelector,
    input: this.inputSelector,
    sendButton: this.sendButtonSelector
  });
};

/**
 * Updates the interface to work with a different project
 * @param {string} projectId - The project to load
 */
window.ChatInterface.prototype.loadProject = async function(projectId) {
  if (!projectId) return false;

  console.log(`[ChatInterface] Loading project: ${projectId}`);

  // Store project context
  this.projectId = projectId;

  // Update services with project context
  if (this.conversationService) {
    this.conversationService.setProjectContext(projectId);
  }

  if (this.messageService) {
    this.messageService.setProjectContext(projectId);
  }

  // Update storage/localStorage
  localStorage.setItem("selectedProjectId", projectId);

  // Notify system about project change
  document.dispatchEvent(new CustomEvent('chatProjectChanged', {
    detail: { projectId }
  }));

  return true;
};

/**
 * Clean up all event listeners
 */
window.ChatInterface.prototype.cleanup = function() {
  console.log('[ChatInterface] Cleaning up event listeners');
  if (this._eventListeners) {
    this._eventListeners.forEach(({ target, type, handler, options }) => {
      target.removeEventListener(type, handler, options);
    });
    this._eventListeners = [];
  }
};

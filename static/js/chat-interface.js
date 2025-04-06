/**
 * chat-interface.js
 * Chat interface that coordinates all components
 */

// Converted from ES modules to global references
const ConversationService = window.ConversationService;
const WebSocketService = window.WebSocketService;
const MessageService = window.MessageService;
const UIComponents = window.UIComponents;

// Initialize the interface
window.ChatInterface = function(options = {}) {
  this._setupProjectContext = function() {
    this.isProjectsPage = window.location.pathname.includes('/projects');
    if (this.isProjectsPage) {
      const pathSegments = window.location.pathname.split('/');
      this.projectId = pathSegments[pathSegments.indexOf('projects') + 1];
      if (this.projectId) {
        localStorage.setItem('selectedProjectId', this.projectId);
      }
    }
  };
  this.notificationFunction = (message, type) => {
    if (window.Notifications) {
      switch(type) {
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

// Initialize the interface
window.ChatInterface.prototype.initialize = async function() {
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
    // Default selectors for index.html/main chat
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

  // Create UI components, passing the message container selector
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
      
      // Confirm before deleting
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

  // Create new instance of ConversationService with required callbacks
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
  
  // Mark as initialized
  this.initialized = true;
  
  // Optional: broadcast initialization complete
  document.dispatchEvent(new CustomEvent('chatInterfaceInitialized'));
};

// Handle initial conversation loading or creation
window.ChatInterface.prototype._handleInitialConversation = function() {
  if (this.currentChatId) {
    // Load existing conversation if ID is in URL
    this.loadConversation(this.currentChatId);
  } else {
    // Verify auth state before proceeding
    window.auth?.verify?.().then(isAuthenticated => {
      if (!isAuthenticated) {
        // Show login required message
        const loginMsg = document.getElementById("loginRequiredMessage");
        if (loginMsg) loginMsg.classList.remove("hidden");
        return;
      }

      // Wait for auth to fully initialize
      return new Promise(resolve => {
        const checkAuthReady = () => {
          if (window.TokenManager?.isInitialized) {
            resolve();
          } else {
            setTimeout(checkAuthReady, 50);
          }
        };
        checkAuthReady();
      });
    }).then(() => {
      // Only create conversation if still no chatId
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
window.ChatInterface.prototype._setupEventListeners = function() {
  // Handle regenerateChat event
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
  
  // Handle copyMessage event
  document.addEventListener('copyMessage', () => {
    const lastAssistantMessage = this._findLastAssistantMessage();
    if (lastAssistantMessage) {
      navigator.clipboard.writeText(lastAssistantMessage)
        .then(() => this.notificationFunction('Message copied to clipboard', 'success'))
        .catch(err => window.ChatUtils?.handleError?.('Copying message', err, this.notificationFunction));
    }
  });
  
  // Listen for URL changes
  window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    
    if (chatId && chatId !== this.currentChatId) {
      this.loadConversation(chatId);
    }
  });

  // Set up model config change listener
  document.addEventListener('modelConfigChanged', (e) => {
    if (this.messageService && e.detail) {
      console.log("ChatInterface: Updating message service with new model config");
      this.messageService.updateModelConfig(e.detail);
    }
  });
};

// Find the last user message for regeneration
window.ChatInterface.prototype._findLastUserMessage = function() {
  if (!this.conversationService.currentConversation?.messages) return null;
  
  const messages = this.conversationService.currentConversation.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return null;
};

// Find the last assistant message for copying
window.ChatInterface.prototype._findLastAssistantMessage = function() {
  if (!this.conversationService.currentConversation?.messages) return null;
  
  const messages = this.conversationService.currentConversation.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return messages[i].content;
    }
  }
  return null;
};

// Load a conversation
window.ChatInterface.prototype.loadConversation = function(chatId) {
  if (!chatId || !window.ChatUtils?.isValidUUID(chatId)) {
    return Promise.reject(new Error('No conversation ID provided'));
  }

  // Skip if already loading this conversation
  if (this.currentChatId === chatId && this._isLoadingConversation) {
    return Promise.resolve(false);
  }

  console.log(`Loading conversation with ID: ${chatId}`);
  this._isLoadingConversation = true;
  
  // Store previous chat ID for proper cleanup
  const previousChatId = this.currentChatId;
  
  // Update current ID first to avoid race conditions
  this.currentChatId = chatId;
  
  // Gracefully disconnect from previous WebSocket and clear messageService
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
        
        // Initialize message service with HTTP initially
        // This ensures we have a working message service even if WebSocket fails
        this.messageService.initialize(chatId, null);
        
        // Then attempt to connect the websocket
        // Attempt WebSocket connection with better error handling
        this.wsService.connect(chatId)
          .then(() => {
            console.log('WebSocket connected successfully, switching from HTTP to WebSocket mode');
            // Re-initialize with WebSocket if connection succeeds
            this.messageService.initialize(chatId, this.wsService);
          })
          .catch((error) => {
            // Only show error if it's not the expected HTTP fallback error
            if (error && error.message === 'Using HTTP fallback') {
              console.log("Using HTTP fallback for messaging as expected");
            } else {
              console.warn("WebSocket connection failed, continuing with HTTP fallback:", error);
            }
            // Either way, ensure we're using HTTP mode
            this.messageService.initialize(chatId, null);
          });
          
        // Update URL if it doesn't match
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
    }).catch(error => {
      this._isLoadingConversation = false;
      console.error(`Error loading conversation ${chatId}:`, error);
      // Ensure the error is propagated
      throw error;
    });
};

// Create a new conversation
window.ChatInterface.prototype.createNewConversation = async function() {
  if (!this.conversationService) {
    throw new Error("Conversation service not initialized");
  }
  
  try {
    console.log('Creating new conversation...');
    
    // Enhanced auth verification with proper timeouts and retries
    const MAX_RETRIES = 3;
    const INIT_TIMEOUT = 2000; // 2s timeout for TokenManager init
    const VERIFY_TIMEOUT = 5000; // 5s timeout for auth verification
    
    let authVerified = false;
    let lastError = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // First ensure TokenManager is initialized with timeout
        await Promise.race([
          new Promise((resolve) => {
            const checkInitialized = () => {
              if (window.TokenManager?.isInitialized) {
                resolve(true);
              } else {
                setTimeout(checkInitialized, 50);
              }
            };
            checkInitialized();
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TokenManager initialization timeout')), INIT_TIMEOUT)
          )
        ]);

        // Initialize auth if needed
        if (!window.auth?.isInitialized) {
          await window.auth.init();
        }

        // Verify auth state with timeout
        authVerified = await Promise.race([
          window.auth.isAuthenticated({ forceVerify: true }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Auth verification timeout')), VERIFY_TIMEOUT)
          )
        ]);
        
        // If we have tokens but verification failed, try refresh
        if (!authVerified && window.TokenManager?.hasTokens?.()) {
          try {
            await window.TokenManager.refreshTokens();
            authVerified = await window.auth.isAuthenticated({ forceVerify: true });
          } catch (refreshError) {
            console.warn("[chat-interface] Token refresh failed:", refreshError);
            lastError = refreshError;
          }
        }
        
        if (authVerified) break;
        
        // Exponential backoff between retries
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt-1)));
        }
      } catch (error) {
        console.warn(`[chat-interface] Auth verification attempt ${attempt} failed:`, error);
        lastError = error;
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 300 * Math.pow(2, attempt-1)));
        }
      }
    }

    if (!authVerified) {
      let errorMsg = "Authentication failed";
      let redirectToLogin = true;
      
      // More specific error messages
      if (lastError?.message?.includes('timeout')) {
        errorMsg = "Authentication check timed out - please try again";
      } else if (lastError?.message?.includes('TokenManager')) {
        errorMsg = "Session initialization failed - please refresh the page";
      } else if (lastError?.status === 401) {
        errorMsg = "Session expired - please log in again";
      } else if (lastError?.message) {
        errorMsg = lastError.message;
      }

      // Don't redirect for network errors
      if (lastError?.message?.includes('NetworkError') ||
          lastError?.message?.includes('Failed to fetch')) {
        redirectToLogin = false;
        errorMsg = "Network error - please check your connection";
      }

      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated: false,
          redirectToLogin,
          error: errorMsg
        }
      }));
      
      // Show notification if UI is available
      if (this.notificationFunction) {
        this.notificationFunction(errorMsg, 'error');
      }
      
      throw new Error(`Auth verification failed: ${errorMsg}`);
    }
    
    // Dispatch auth success event
    window.dispatchEvent(new CustomEvent('authStateChanged', {
      detail: {
        authenticated: true,
        username: window.TokenManager?.username || null
      }
    }));

    // Get current model from localStorage or MODEL_CONFIG
    const currentModel = window.MODEL_CONFIG?.modelName ||
                         localStorage.getItem("modelName") ||
                         "claude-3-sonnet-20240229";
                         
    console.log(`Using model: ${currentModel} for new conversation`);
    
    // Pass the model to createNewConversation in conversationService
    let conversation;
    try {
      const projectId = localStorage.getItem('selectedProjectId');
      let conversation;
      
      if (projectId && window.projectManager?.createConversation) {
        // Use project-specific creation if in project context
        conversation = await window.projectManager.createConversation(projectId);
      } else {
        // Fall back to standard conversation creation
        conversation = await this.conversationService.createNewConversation();
      }

      // Verify the conversation was properly created
      if (!conversation?.id) {
        throw new Error('Invalid conversation response from server');
      }

      return conversation;
    } catch (error) {
      console.error('Conversation creation failed:', error);
      
      let message = 'Failed to create conversation';
      let showLogin = false;
      
      // More specific error handling
      if (error.message.includes('Not authenticated')) {
        message = 'Session expired - please log in again';
        showLogin = true;
      } else if (error.message.includes('knowledge base')) {
        message = 'Created chat but knowledge integration failed';
      } else if (error.message.includes('timeout')) {
        message = 'Request timed out - please try again';
      } else if (error.message.includes('NetworkError')) {
        message = 'Network error - please check your connection';
      }

      // Update auth state if needed
      if (showLogin) {
        window.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: {
            authenticated: false,
            redirectToLogin: true,
            error: message
          }
        }));
      }

      // Show notification
      if (this.notificationFunction) {
        this.notificationFunction(message, 'error');
      }

      throw error;
    }
    console.log(`New conversation created successfully with ID: ${conversation.id}`);
    this.currentChatId = conversation.id;
    
    // Update URL
    window.history.pushState({}, '', `/?chatId=${conversation.id}`);
    
    // Initialize message service with latest config
    if (this.messageService) {
      // Ensure the message service has the latest config
      if (window.MODEL_CONFIG) {
        this.messageService.updateModelConfig(window.MODEL_CONFIG);
      }
      
      this.messageService.initialize(conversation.id, null);
      console.log('Message service initialized with HTTP mode');
      
      // Enhanced WebSocket connection with retries and better error handling
      const MAX_WS_RETRIES = 2;
      let wsConnected = false;
      
      for (let attempt = 1; attempt <= MAX_WS_RETRIES; attempt++) {
        try {
          console.log(`Attempting WebSocket connection (attempt ${attempt})...`);
          await this.wsService.connect(conversation.id);
          wsConnected = true;
          console.log('WebSocket connected successfully, switching from HTTP to WebSocket mode');
          
          // Re-initialize with WebSocket
          this.messageService.initialize(conversation.id, this.wsService);
          break;
        } catch (error) {
          console.warn(`WebSocket connection attempt ${attempt} failed:`, error);
          
          // Only show error notification on final attempt
          if (attempt === MAX_WS_RETRIES) {
            const msg = error.message.includes('auth')
              ? 'WebSocket authentication failed - using HTTP mode'
              : 'WebSocket connection failed - using HTTP mode';
            this.notificationFunction(msg, 'warning');
          }
          
          // Exponential backoff between retries (500ms, 1000ms)
          if (attempt < MAX_WS_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          }
        }
      }
      
      // Fall back to HTTP if WebSocket failed
      if (!wsConnected) {
        console.log("Using HTTP fallback for messaging");
        this.messageService.initialize(conversation.id, null);
      }
    } else {
      console.error('Message service not available');
      window.ChatUtils?.handleError?.('Message service not initialized', new Error('Message service not available'), this.notificationFunction);
      return;
    }
    
    // Show chat UI
    if (this.container) {
      this.container.classList.remove('hidden');
    }
    
    const noChatMsg = document.getElementById("noChatSelectedMessage");
    if (noChatMsg) {
      noChatMsg.classList.add('hidden');
    }
    
    return conversation;
  } catch (error) {
    console.error('Failed to create conversation:', error);
    
    // Categorize errors and provide appropriate feedback
    let userMessage = 'Failed to create conversation';
    let isAuthError = false;
    
    if (error.message.includes('Not authenticated') ||
        error.message.includes('401') ||
        error.message.includes('token')) {
      userMessage = 'Session expired - please log in again';
      isAuthError = true;
    } else if (error.message.includes('timeout')) {
      userMessage = 'Request timed out - please try again';
    } else if (error.message.includes('NetworkError')) {
      userMessage = 'Network error - please check your connection';
    }

    // Update auth state if needed
    if (isAuthError) {
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated: false,
          redirectToLogin: true,
          error: userMessage
        }
      }));
    }

    // Show notification to user
    if (this.notificationFunction) {
      this.notificationFunction(userMessage, 'error');
    }

    // Clean up any partial state
    this.currentChatId = null;
    if (this.wsService?.isConnected()) {
      this.wsService.disconnect();
    }

    // Re-throw the error for upstream handling
    throw error;
  }
};

// Change the target container for message rendering
window.ChatInterface.prototype.setTargetContainer = function(selector) {
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
window.ChatInterface.prototype._handleConversationLoaded = function(conversation) {
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
  
  // Dispatch event for other components
  document.dispatchEvent(new CustomEvent('conversationLoaded', {
    detail: { conversation }
  }));
};

// Handle message received event
window.ChatInterface.prototype._handleMessageReceived = function(message) {
  this.ui.messageList.removeThinking();
  this.ui.messageList.appendMessage(
    message.role,
    message.content,
    null,
    message.thinking,
    message.redacted_thinking,
    message.metadata
  );
  
  // Dispatch event for other components
  document.dispatchEvent(new CustomEvent('messageReceived', {
    detail: { message }
  }));
  
  // Add to conversation message history
  if (this.conversationService.currentConversation) {
    this.conversationService.currentConversation.messages =
      this.conversationService.currentConversation.messages || [];
    this.conversationService.currentConversation.messages.push(message);
  }
};

// UUID validation
window.ChatInterface.prototype.isValidUUID = function(uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// Delete the current conversation
window.ChatInterface.prototype.deleteConversation = async function(chatId) {
  if (!chatId && this.currentChatId) {
    chatId = this.currentChatId;
  }
  
  if (!this.isValidUUID(chatId)) {
    this.notificationFunction("Invalid conversation ID", "error");
    return false;
  }
  
  try {
    const projectId = localStorage.getItem("selectedProjectId");
    const success = await this.conversationService.deleteConversation(chatId, projectId);
    
    if (success) {
      // If we deleted the current conversation, clear the UI
      if (chatId === this.currentChatId) {
        this.currentChatId = null;
        this.ui.messageList.clear();
        if (this.titleEl) this.titleEl.textContent = "";
        
        // Update URL to remove chatId
        window.history.pushState({}, '', '/');
        
        // Show "no chat selected" message if it exists
        const noChatMsg = document.getElementById("noChatSelectedMessage");
        if (noChatMsg) {
          noChatMsg.classList.remove('hidden');
        }
        
        // Hide chat UI if applicable
        if (this.container) {
          this.container.classList.add('hidden');
        }
      }
      
      // Trigger event so sidebar can update
      document.dispatchEvent(new CustomEvent('conversationDeleted', {
        detail: { id: chatId }
      }));
      
      return true;
    }
    return false;
  } catch (error) {
    window.ChatUtils?.handleError?.('Deleting conversation', error, this.notificationFunction);
    return false;
  }
};

// Send a message
window.ChatInterface.prototype._handleSendMessage = async function(userMsg) {
  console.log('Preparing to send message');
  
  if (!userMsg && !this.currentImage) {
    this.notificationFunction("Cannot send empty message", "error");
    return;
  }

  // Ensure we have a valid chat ID
  if (!this.isValidUUID(this.currentChatId)) {
    console.log('No valid conversation ID, creating new conversation');
    try {
      const conversation = await this.createNewConversation();
      this.currentChatId = conversation.id;
      console.log(`Using new conversation ID: ${this.currentChatId}`);

      // Always initialize with HTTP first for reliability
      if (this.messageService) {
        console.log('Initializing message service with HTTP fallback');
        this.messageService.initialize(this.currentChatId, null);
        
        // Try WebSocket in background
        try {
          const wsConnected = await this.wsService.connect(this.currentChatId);
          if (wsConnected) {
            console.log('WebSocket connected successfully, switching from HTTP to WebSocket mode');
            this.messageService.initialize(this.currentChatId, this.wsService);
          }
        } catch (wsError) {
          console.warn('WebSocket connection attempted but failed, using HTTP fallback:', wsError);
          // Already initialized with HTTP fallback, so we can continue
        }
      } else {
        console.error('Message service not available');
        window.ChatUtils?.handleError?.('Message service not initialized', new Error('Message service not available'), this.notificationFunction);
        return;
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
      window.ChatUtils?.handleError?.('Creating conversation', err, this.notificationFunction);
      return;
    }
  }

  // Double-check that we have a valid conversation ID
  if (!this.isValidUUID(this.currentChatId)) {
    console.error('Still no valid conversation ID after creation attempt');
    this.notificationFunction("Failed to create conversation", "error");
    return;
  }

  // Verify UI is initialized before proceeding
  if (!this.ui || !this.ui.messageList) {
    console.error('UI components not initialized');
    this.notificationFunction("UI not properly initialized", "error");
    return;
  }

  // Ensure message service is initialized with at least HTTP fallback
  if (!this.messageService.chatId) {
    console.log('Message service not initialized with current conversation, initializing with HTTP');
    this.messageService.initialize(this.currentChatId, null);
  }

  // Append user's message to UI
  try {
    const displayMsg = userMsg || "Analyze this image";
    console.log(`Appending user message: "${displayMsg.substring(0, 30)}${displayMsg.length > 30 ? '...' : ''}"`);
    
    const msgEl = this.ui.messageList.appendMessage("user", displayMsg);
    
    // Add user message to conversation history
    if (this.conversationService.currentConversation) {
      this.conversationService.currentConversation.messages = 
        this.conversationService.currentConversation.messages || [];
      this.conversationService.currentConversation.messages.push({
        role: 'user',
        content: displayMsg
      });
    }
  } catch (error) {
    console.error('Error displaying message:', error);
    window.ChatUtils?.handleError?.('Displaying message', error, this.notificationFunction);
    // Continue anyway to try sending message
  }

  // Verify message service is initialized
  if (!this.messageService) {
    console.error('Message service still not available');
    this.notificationFunction("Message service not properly initialized", "error");
    return;
  }

  // Send message
  try {
    console.log('Sending message to backend...');
    await this.messageService.sendMessage(userMsg || "Analyze this image");
    console.log('Message sent successfully');
  } catch (sendError) {
    console.error('Error sending message:', sendError);
    
    // Check for AI-specific errors
    if (sendError.code?.startsWith('AI_') || 
        sendError.message?.includes('AI') || 
        sendError.message?.includes('generate')) {
      
      // Show a more helpful error in the chat UI
      this.ui.messageList.showAIErrorMessage(
        sendError.message,
        sendError.userAction || "Try rephrasing your message"
      );
      
      // Only show notification for non-AI errors
      return;
    }
    
    window.ChatUtils?.handleError?.('Sending message', sendError, this.notificationFunction);
    
    // If the error is specifically about invalid conversation ID despite our checks
    if (sendError.message?.includes('Invalid conversation ID')) {
      this.notificationFunction("There was a problem with the conversation. Please try again.", "error");
    }
  }

  // If there's an image, show indicator
  if (this.currentImage) {
    this.ui.messageList.addImageIndicator(this.currentImage);
    this.currentImage = null;
  }
};

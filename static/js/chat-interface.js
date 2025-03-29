/**
 * chat-interface.js
 * Chat interface that coordinates all components
 */

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
  this.messageContainerSelector = options.messageContainerSelector || '#conversationArea';

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
window.ChatInterface.prototype.initialize = function() {
  // Check dependencies
  if (!window.WebSocketService) {
    throw new Error('WebSocketService dependency not loaded');
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

  this.messageService = new window.MessageService({
    onMessageReceived: this._handleMessageReceived.bind(this),
    onSending: () => this.ui.messageList.addThinking(),
    onError: (context, err) => window.ChatUtils?.handleError?.(context, err, this.notificationFunction)
  });

  this.conversationService = new window.ConversationService({
    onConversationLoaded: this._handleConversationLoaded.bind(this),
    onLoadingStart: () => this.ui.messageList.setLoading(),
    onLoadingEnd: () => {},
    onError: (context, err) => window.ChatUtils?.handleError?.(context, err, this.notificationFunction),
    showNotification: this.notificationFunction
  });

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
    // Check if user is authenticated
    window.ChatUtils?.isAuthenticated?.().then(isAuthenticated => {
      if (isAuthenticated) {
        // Create new conversation automatically if user is logged in but no chatId present
        setTimeout(() => {
          this.createNewConversation().catch((error) => {
            window.ChatUtils?.handleError?.('Creating new conversation', error, this.notificationFunction);
          });
        }, 100);
      } else {
        // Show login required message
        const loginMsg = document.getElementById("loginRequiredMessage");
        if (loginMsg) loginMsg.classList.remove("hidden");
      }
    }).catch(error => {
      window.ChatUtils?.handleError?.('Authentication check', error, this.notificationFunction);
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
  if (!chatId) {
    return Promise.reject(new Error('No conversation ID provided'));
  }
  
  console.log(`Loading conversation with ID: ${chatId}`);
  this.currentChatId = chatId;

  return this.conversationService.loadConversation(chatId)
    .then(success => {
      if (success) {
        console.log(`Successfully loaded conversation: ${chatId}`);
        
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
    const conversation = await this.conversationService.createNewConversation();
    console.log(`New conversation created successfully with ID: ${conversation.id}`);
    this.currentChatId = conversation.id;
    
    // Update URL
    window.history.pushState({}, '', `/?chatId=${conversation.id}`);
    
    // Initialize message service with HTTP first (reliable fallback)
    this.messageService.initialize(conversation.id, null);
    console.log('Message service initialized with HTTP mode');
    
    // Try to connect WebSocket in the background
        console.log('Attempting WebSocket connection...');
        this.wsService.connect(conversation.id)
          .then(() => {
            console.log('WebSocket connected successfully, switching from HTTP to WebSocket mode');
            // Re-initialize with WebSocket if connection succeeds
            this.messageService.initialize(conversation.id, this.wsService);
          })
          .catch((error) => {
            // Only show error if it's not the expected HTTP fallback error
            if (error && error.message === 'Using HTTP fallback') {
              console.log("Using HTTP fallback for messaging as expected");
            } else {
              console.warn("WebSocket connection failed, continuing with HTTP fallback:", error);
            }
            // Either way, ensure we're using HTTP mode
            this.messageService.initialize(conversation.id, null);
          });
      
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
    window.ChatUtils?.handleError?.('Creating conversation', error, this.notificationFunction);
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
  if (this.titleEl) {
    this.titleEl.textContent = conversation.title || "New Chat";
  }
  this.ui.messageList.renderMessages(conversation.messages);
  
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
    const success = await this.conversationService.deleteConversation(chatId);
    
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

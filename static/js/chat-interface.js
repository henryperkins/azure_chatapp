/**
 * chat-interface.js
 * Chat interface that coordinates all components
 */

// Initialize the interface
window.ChatInterface.prototype.initialize = function() {
  // Determine page context and set selectors
  const isProjectsPage = window.location.pathname.includes('/projects');
  
  // Update selectors based on page context
  if (isProjectsPage) {
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

  // Create services
  this.wsService = new window.WebSocketService({
    onConnect: () => console.log("WebSocket connected"),
    onError: (err) => {
      if (window.handleAPIError) {
        window.handleAPIError('WebSocketService', err);
      } else {
        console.error('WebSocket error:', err);
        this.notificationFunction('WebSocket error: ' + err.message, 'error');
      }
    }
  });

  this.messageService = new window.MessageService({
    onMessageReceived: this._handleMessageReceived.bind(this),
    onSending: () => this.ui.messageList.addThinking(),
    onError: (msg, err) => {
      if (window.handleAPIError) {
        window.handleAPIError(msg, err);
      } else {
        console.error(`${msg}:`, err);
        this.notificationFunction(`${msg}: ${err.message}`, 'error');
      }
    }
  });

  this.conversationService = new window.ConversationService({
    onConversationLoaded: this._handleConversationLoaded.bind(this),
    onLoadingStart: () => this.ui.messageList.setLoading(),
    onLoadingEnd: () => {},
    onError: (msg, err) => {
      if (window.handleAPIError) {
        window.handleAPIError(msg, err);
      } else {
        console.error(`${msg}:`, err);
        this.notificationFunction(`${msg}: ${err.message}`, 'error');
      }
    },
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
        .catch(() => {});
    } else if (!e.detail?.authenticated) {
      this.wsService.disconnect();
    }
  });

  // Initial load
  if (this.currentChatId) {
    this.loadConversation(this.currentChatId);
  } else if (sessionStorage.getItem('userInfo')) {
    // Create new conversation automatically if user is logged in but no chatId present
    setTimeout(() => {
      this.createNewConversation().catch(() => {});
    }, 100);
  } else {
    const loginMsg = document.getElementById("loginRequiredMessage");
    if (loginMsg) loginMsg.classList.remove("hidden");
  }
};

// Load a conversation
window.ChatInterface.prototype.loadConversation = function(chatId) {
  if (!chatId) {
    return Promise.reject(new Error('No conversation ID'));
  }
  this.currentChatId = chatId;

  return this.conversationService.loadConversation(chatId)
    .then(success => {
      if (success) {
        // Attempt to connect the websocket
        this.wsService.connect(chatId)
          .then(() => {
            this.messageService.initialize(chatId, this.wsService);
          })
          .catch(() => {
            // Fall back to HTTP if WebSocket fails
            this.messageService.initialize(chatId, null);
          });
      }
      return success;
    });
};

// Create a new conversation
window.ChatInterface.prototype.createNewConversation = async function() {
  try {
    if (!this.conversationService) {
      throw new Error("Conversation service not initialized");
    }
    const conversation = await this.conversationService.createNewConversation();
    this.currentChatId = conversation.id;
    return conversation;
  } catch (error) {
    if (window.handleAPIError) {
      window.handleAPIError('Creating conversation', error);
    } else {
      console.error('Error creating conversation:', error);
      this.notificationFunction('Failed to create conversation: ' + error.message, 'error');
    }
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
  } else {
    console.error(`Failed to find container with selector: ${selector}`);
  }
};

// Handle conversation loaded event
window.ChatInterface.prototype._handleConversationLoaded = function(conversation) {
  if (this.titleEl) {
    this.titleEl.textContent = conversation.title || "New Chat";
  }
  this.ui.messageList.renderMessages(conversation.messages);
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
};

// UUID validation
window.ChatInterface.prototype.isValidUUID = function(uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// Send a message
window.ChatInterface.prototype._handleSendMessage = async function(userMsg) {
  if (!userMsg && !this.currentImage) {
    this.notificationFunction("Cannot send empty message", "error");
    return;
  }

  // Ensure we have a valid chat ID
  if (!this.isValidUUID(this.currentChatId)) {
    try {
      const conversation = await this.createNewConversation();
      this.currentChatId = conversation.id;
      // Update URL to reflect new conversation
      window.history.pushState({}, '', `/?chatId=${conversation.id}`);
    } catch (err) {
      if (window.handleAPIError) {
        window.handleAPIError('Creating conversation', err);
      } else {
        console.error('Error creating conversation:', err);
        this.notificationFunction('Failed to create conversation: ' + err.message, 'error');
      }
      return;
    }
  }

  // Verify UI is initialized before proceeding
  if (!this.ui || !this.ui.messageList) {
    this.notificationFunction("UI not properly initialized", "error");
    return;
  }

  // Append user's message to UI
  try {
    this.ui.messageList.appendMessage("user", userMsg || "Analyze this image");
  } catch (error) {
    console.error("Error displaying message:", error);
    // Continue anyway to try sending message
  }

  // Verify message service is initialized
  if (!this.messageService) {
    this.notificationFunction("Message service not properly initialized", "error");
    return;
  }

  // Send message
  await this.messageService.sendMessage(userMsg || "Analyze this image");

  // If there's an image, show indicator
  if (this.currentImage) {
    this.ui.messageList.addImageIndicator(this.currentImage);
    this.currentImage = null;
  }
};

// Test WebSocket connection
window.testWebSocketConnection = async function() {
  const chatInterface = window.chatInterface || (window.initializeChat(), window.chatInterface);

  if (chatInterface.wsService) {
    const authState = await window.auth?.verify?.() || 
      !!(sessionStorage.getItem('auth_state') && sessionStorage.getItem('userInfo'));
      
    if (!authState) {
      return { success: false, authenticated: false, message: "Authentication required" };
    }
    
    try {
      const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/ws?chatId=test`;
      return { success: true, authenticated: true, wsUrl, message: "WebSocket prerequisites passed" };
    } catch (error) {
      return { success: false, error: error.message, message: "WebSocket test failed" };
    }
  }
  
  return { success: false, message: "WebSocket service not initialized" };
};

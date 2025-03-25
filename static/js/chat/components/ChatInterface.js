/**
 * ChatInterface.js
 * Coordinates the chat UI components and services
 */

import WebSocketService from '../services/WebSocketService.js';
import MessageService from '../services/MessageService.js';
import ConversationService from '../services/ConversationService.js';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import ImageUpload from './ImageUpload.js';

export default class ChatInterface {
  constructor(options = {}) {
    this.containerSelector = options.containerSelector || '#chatUI';
    this.conversationAreaSelector = options.conversationAreaSelector || '#conversationArea';
    this.chatTitleSelector = options.chatTitleSelector || '#chatTitle';
    this.notificationFunction = options.showNotification || window.showNotification || console.log;
    
    this.currentModelConfig = {
      modelName: localStorage.getItem('modelName') || 'claude-3-sonnet-20240229',
      maxTokens: parseInt(localStorage.getItem('maxTokens')) || 500,
      visionEnabled: localStorage.getItem('visionEnabled') === 'true',
      visionDetail: localStorage.getItem('visionDetail') || 'auto',
      extendedThinking: localStorage.getItem('extendedThinking') === 'true',
      thinkingBudget: parseInt(localStorage.getItem('thinkingBudget')) || 16000
    };
    
    this.container = document.querySelector(this.containerSelector);
    this.conversationArea = document.querySelector(this.conversationAreaSelector);
    this.chatTitle = document.querySelector(this.chatTitleSelector);
    
    this.wsService = null;
    this.messageService = null;
    this.conversationService = null;
    this.messageList = null;
    this.messageInput = null;
    this.imageUpload = null;
    
    this.currentChatId = null;
    this.currentImage = null;
  }

  /**
   * Initialize the chat interface and all its components
   */
  initialize() {
    // Extract chat ID from URL or global config
    this._extractChatId();
    
    // Check authentication status before WebSocket connections
    const isAuthenticated = sessionStorage.getItem('auth_state') && 
                           sessionStorage.getItem('userInfo');
    
    // Initialize WebSocketService first
    this.wsService = new WebSocketService({
      onConnect: () => {
        console.log("WebSocket connected successfully");
        // Update UI to show connection status if needed
      },
      onDisconnect: (event) => console.log("WebSocket disconnected", event),
      onError: this._handleError.bind(this)
    });
    
    // Initialize MessageService
    this.messageService = new MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: this._handleMessageSending.bind(this),
      onError: this._handleError.bind(this),
      wsService: isAuthenticated ? this.wsService : null,
      apiRequest: window.apiRequest
    });
    
    // Initialize ConversationService
    this.conversationService = new ConversationService({
      onConversationLoaded: this._handleConversationLoaded.bind(this),
      onLoadingStart: () => this._setLoadingState(),
      onLoadingEnd: () => {},
      onError: this._handleError.bind(this),
      apiRequest: window.apiRequest,
      showNotification: this.notificationFunction
    });
    
    // Initialize UI components
    this.messageList = new MessageList(this.conversationAreaSelector);
    
    this.messageInput = new MessageInput({
      onSend: this._handleSendMessage.bind(this)
    });
    
    this.imageUpload = new ImageUpload({
      onChange: this._handleImageSelected.bind(this),
      onError: this._handleError.bind(this),
      showNotification: this.notificationFunction
    });
    
    // Set up auth state change listeners
    this._setupAuthListeners();
    
    // Handle existing chat or auto-create a new one
    this._initialLoadConversation();
  }

  /**
   * Load a specific conversation by ID
   */
  loadConversation(chatId) {
    if (!chatId) {
      this._handleError('No conversation ID provided');
      return Promise.reject(new Error('No conversation ID provided'));
    }
    
    this.currentChatId = chatId;
    return this.conversationService.loadConversation(chatId)
      .then(success => {
        if (success) {
          // Only try to connect if the conversation loaded successfully
          this.wsService.connect(chatId)
            .then(() => {
              console.log("WebSocket connected for conversation:", chatId);
              // Then initialize message service with the connected websocket
              this.messageService.initialize(chatId, this.wsService);
            })
            .catch(err => {
              console.warn("Using HTTP fallback for messaging:", err.message);
              // Initialize message service without websocket (HTTP fallback)
              this.messageService.initialize(chatId, null);
            });
        }
        return success;
      });
  }

  /**
   * Create a new conversation
   */
  async createNewConversation() {
    try {
      const conversation = await this.conversationService.createNewConversation();
      this.currentChatId = conversation.id;
      
      // Update UI
      this._updateChatTitle(conversation.title || "New Chat");
      
      // Setup WebSocket for real-time updates
      this.wsService.connect(conversation.id);
      this.messageService.initialize(conversation.id, this.wsService);
      
      // Update URL and show UI
      this._updateUrl(conversation.id);
      this._showChatUI();
      
      // Clear message area
      this.messageList.clear();
      
      // Force a reload of the conversation list
      if (typeof window.loadConversationList === 'function') {
        setTimeout(() => window.loadConversationList(), 500);
      }
      
      return conversation;
    } catch (error) {
      this._handleError("Failed to create new conversation", error);
      throw error;
    }
  }

  // Private methods
  _extractChatId() {
    const urlParams = new URLSearchParams(window.location.search);
    this.currentChatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');
  }

  _initialLoadConversation() {
    if (this.currentChatId) {
      this.loadConversation(this.currentChatId);
    } else {
      // Only auto-create a conversation if authenticated
      const isAuthenticated = window.API_CONFIG?.isAuthenticated || 
                            sessionStorage.getItem('userInfo') !== null;
      
      if (isAuthenticated) {
        // Auto-create new chat if authenticated
        setTimeout(() => {
          this.createNewConversation()
            .catch(err => {
              console.error("Error auto-creating conversation:", err);
              this.notificationFunction("Could not create a new conversation. Please try again.", "error");
            });
        }, 100);
      } else {
        console.log("Not authenticated, skipping auto-conversation creation");
        // Show the no-chat message or login required message
        const loginMsg = document.getElementById("loginRequiredMessage");
        if (loginMsg) loginMsg.classList.remove("hidden");
      }
    }
  }

  _setLoadingState() {
    this.messageList.setLoading();
  }

  _updateChatTitle(title) {
    if (this.chatTitle) {
      this.chatTitle.textContent = title;
    }
  }

  _updateUrl(chatId) {
    window.history.pushState({}, "", `/?chatId=${chatId}`);
    window.CHAT_CONFIG = window.CHAT_CONFIG || {};
    window.CHAT_CONFIG.chatId = chatId;
  }

  _showChatUI() {
    const chatUI = document.getElementById("chatUI");
    const noChatMsg = document.getElementById("noChatSelectedMessage");
    if (chatUI) chatUI.classList.remove("hidden");
    if (noChatMsg) noChatMsg.classList.add("hidden");
  }

  _handleConversationLoaded(conversation) {
    // Update chat title
    this._updateChatTitle(conversation.title || "New Chat");
    
    // Render messages
    this.messageList.renderMessages(conversation.messages);
  }

  _handleMessageSending() {
    // Add thinking indicator when message is being sent
    this.messageList.addThinkingIndicator();
  }

  _handleMessageReceived(message) {
    // Remove thinking indicator
    this.messageList.removeThinkingIndicator();
    
    // Append the new message
    this.messageList.appendMessage(
      message.role,
      message.content,
      message.thinking,
      message.redacted_thinking,
      message.metadata
    );
  }

  async _handleSendMessage(userMsg) {
    if (!userMsg && !this.currentImage) {
      this.notificationFunction("Cannot send empty message", "error");
      return;
    }
    
    // Ensure we have a chat
    if (!this.currentChatId) {
      try {
        // Create a new conversation first
        const conversation = await this.createNewConversation();
        this.currentChatId = conversation.id;
      } catch (err) {
        this._handleError("Failed to create conversation", err);
        return;
      }
    }
    
    // Send message with image if available
    await this.messageService.sendMessage(userMsg || "Analyze this image");
    
    // If we had an image, add visual indicator
    if (this.currentImage) {
      this.messageList.addImageIndicator(this.currentImage);
      this.currentImage = null;
    }
  }

  _handleImageSelected(imageData) {
    this.currentImage = imageData;
  }

  _handleError(message, error) {
    console.error(message, error);
    this.notificationFunction(message, 'error');
  }

  /**
   * Set up listeners for authentication state changes
   */
  _setupAuthListeners() {
    document.addEventListener('authStateChanged', (event) => {
      const isAuthenticated = event.detail?.authenticated;
      
      if (isAuthenticated && this.currentChatId && 
          this.wsService && !this.wsService.isConnected()) {
        // Try to reconnect when auth state becomes valid
        this.wsService.connect(this.currentChatId)
          .then(() => {
            console.log("WebSocket reconnected after authentication");
            this.messageService.initialize(this.currentChatId, this.wsService);
          })
          .catch(err => console.warn("WebSocket reconnect failed:", err.message));
      } else if (!isAuthenticated && this.wsService) {
        // Disconnect when auth is lost
        this.wsService.disconnect();
      }
    });
  }
}

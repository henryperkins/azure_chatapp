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
    
    // Initialize WebSocketService first
    this.wsService = new WebSocketService({
      onConnect: () => console.log("WebSocket connected"),
      onDisconnect: (event) => console.log("WebSocket disconnected", event),
      onError: this._handleError.bind(this)
    });
    
    // Initialize MessageService
    this.messageService = new MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: this._handleMessageSending.bind(this),
      onError: this._handleError.bind(this),
      wsService: this.wsService,
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
          // Setup WebSocket for real-time updates
          this.wsService.connect(chatId);
          this.messageService.initialize(chatId, this.wsService);
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
      // Auto-create new chat if no ID is present
      setTimeout(() => {
        this.createNewConversation()
          .catch(err => {
            console.error("Error auto-creating conversation:", err);
            this.notificationFunction("Could not create a new conversation. Please try again.", "error");
          });
      }, 100);
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
}

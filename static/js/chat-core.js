/**
 * chat-core.js
 * Main entry point for chat functionality
 */

// Main entry point - this replaces the original chat.js
// Load dependent modules first if not using <script> tags
(function() {
  // Helper to add markdown styles
  function addMarkdownStyles() {
    if (document.getElementById('markdown-styles')) return;
    const style = document.createElement('style');
    style.id = 'markdown-styles';
    style.textContent = `
      .markdown-table{width:100%;border-collapse:collapse;margin:1em 0}
      .markdown-table th,.markdown-table td{padding:.5em;border:1px solid #ddd}
      .markdown-code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}
      .markdown-pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
      .markdown-quote{border-left:3px solid #ddd;padding:0 1em;color:#666}
      .code-block-wrapper{position:relative}
      .copy-code-btn{position:absolute;right:.5em;top:.5em;padding:.25em .5em;background:#fff;border:1px solid #ddd;
        border-radius:3px;cursor:pointer;font-size:.8em}
      .copy-code-btn:hover{background:#f5f5f5}
    `;
    document.head.appendChild(style);
  }

  // Main chat interface
  window.ChatInterface = function(options = {}) {
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
  };

  // Add ChatInterface methods imported from chat-interface.js
  // Include initialize(), loadConversation(), createNewConversation(), etc.
  // Those are implemented in other modules and attached to the ChatInterface prototype
})();

// Maintain same public API for backward compatibility
// These are global functions exposed on the window object
let chatInterface = null;

// Initialize the chat functionality
window.initializeChat = function() {
  addMarkdownStyles();
  chatInterface = new window.ChatInterface();
  chatInterface.initialize();
  window.projectChatInterface = chatInterface; // Expose the instance globally

  // Listen for model configuration changes
  document.addEventListener('modelConfigChanged', (e) => {
    if (chatInterface && chatInterface.messageService) {
      const modelName = e.detail?.modelName || localStorage.getItem('modelName');
      if (modelName) {
        window.MODEL_CONFIG = window.MODEL_CONFIG || {};
        window.MODEL_CONFIG.modelName = modelName;
        window.MODEL_CONFIG.maxTokens = Number(e.detail?.maxTokens) || 200000;
        window.MODEL_CONFIG.thinkingBudget = Number(e.detail?.thinkingBudget) || 10000;
      }
    }
  });
};

// Load an existing conversation
window.loadConversation = function(chatId) {
  if (!chatInterface) window.initializeChat();
  return chatInterface.loadConversation(chatId);
};

// Create a new chat conversation
window.createNewChat = async function() {
  if (!chatInterface) window.initializeChat();
  return chatInterface.createNewConversation();
};

// Send a message to a specific chat
window.sendMessage = async function(chatId, userMsg) {
  if (!chatInterface) window.initializeChat();
  chatInterface.currentChatId = chatId;
  return chatInterface._handleSendMessage(userMsg);
};

// Set up WebSocket connection for a chat
window.setupWebSocket = async function(chatId) {
  if (!chatInterface) window.initializeChat();
  if (!chatId && chatInterface.currentChatId) {
    chatId = chatInterface.currentChatId;
  }
  if (chatId && chatInterface.wsService) {
    try {
      const connected = await chatInterface.wsService.connect(chatId);
      if (connected) {
        chatInterface.messageService.initialize(chatId, chatInterface.wsService);
        return true;
      }
    } catch (error) {}
  }
  return false;
};

// Auto-initialize chat if #chatUI is present in DOM
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('chatUI')) {
    window.initializeChat();
  }
  
  // Always set up the nav toggle button handler regardless of page
  const navToggleBtn = document.getElementById('navToggleBtn');
  if (navToggleBtn) {
    console.log("Setting up additional nav toggle button handler");
    navToggleBtn.addEventListener('click', function() {
      console.log("Nav toggle button clicked (direct handler)");
      window.toggleSidebar();
    });
  }
});

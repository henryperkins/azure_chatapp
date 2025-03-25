/**
 * index.js
 * Entry point for the chat module
 */

import ChatInterface from './components/ChatInterface.js';

// This ensures we maintain compatibility with the existing window.* functions
// that might be called from other parts of the application

// Main chat interface instance
let chatInterface = null;

// Initialize the chat module
function initializeChat() {
  console.log("Initializing chat module");
  
  // First ensure we have loaded style needed for markdown content
  _addMarkdownStyles();
  
  // Now create the chat interface
  chatInterface = new ChatInterface({
    showNotification: window.showNotification
  });
  
  chatInterface.initialize();
}

// Load a specific conversation
function loadConversation(chatId) {
  console.log("Loading conversation:", chatId);
  
  if (!chatInterface) {
    initializeChat();
  }
  
  return chatInterface.loadConversation(chatId);
}

// Create a new chat
async function createNewChat() {
  console.log("Creating new chat");
  
  if (!chatInterface) {
    initializeChat();
  }
  
  return chatInterface.createNewConversation();
}

// Send a message to the current chat
function sendMessage(chatId, userMsg) {
  console.log("Sending message to chat:", chatId);
  
  if (!chatInterface) {
    initializeChat();
  }
  
  chatInterface.currentChatId = chatId;
  return chatInterface._handleSendMessage(userMsg);
}

// Set up WebSocket connection
async function setupWebSocket(chatId) {
  console.log("Setting up WebSocket for chat:", chatId);
  
  if (!chatInterface) {
    initializeChat();
  }
  
  // If a chatId is provided, attempt to connect
  if (chatId) {
    try {
      // Try to establish a websocket connection for this chat
      if (chatInterface.wsService) {
        const connected = await chatInterface.wsService.connect(chatId);
        if (connected) {
          chatInterface.messageService.initialize(chatId, chatInterface.wsService);
          return true;
        }
      }
    } catch (error) {
      console.warn("WebSocket setup failed:", error.message);
      console.log("Using HTTP fallback for communications");
      return false;
    }
  } else if (chatInterface.currentChatId) {
    // Use the current chatId if available
    return setupWebSocket(chatInterface.currentChatId);
  }
  
  return false;
}

// Test WebSocket connectivity and authentication
async function testWebSocketConnection() {
  if (!chatInterface) {
    initializeChat();
  }
  
  if (chatInterface.wsService) {
    return await chatInterface.wsService.testConnection();
  }
  
  return {
    success: false,
    message: "Chat interface not initialized"
  };
}

// Add markdown styles to the document if not already present
function _addMarkdownStyles() {
  // Check if styles already exist
  if (document.getElementById('markdown-styles')) {
    return;
  }
  
  const style = document.createElement('style');
  style.id = 'markdown-styles';
  style.textContent = `
    .markdown-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
    }
    .markdown-table th, .markdown-table td {
      padding: 0.5em;
      border: 1px solid #ddd;
    }
    .markdown-code {
      background: #f5f5f5;
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
    .markdown-pre {
      background: #f5f5f5;
      padding: 1em;
      border-radius: 4px;
      overflow-x: auto;
    }
    .markdown-quote {
      border-left: 3px solid #ddd;
      padding: 0 1em;
      color: #666;
    }
    .code-block-wrapper {
      position: relative;
    }
    .copy-code-btn {
      position: absolute;
      right: 0.5em;
      top: 0.5em;
      padding: 0.25em 0.5em;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.8em;
    }
    .copy-code-btn:hover {
      background: #f5f5f5;
    }
  `;
  document.head.appendChild(style);
}

// Clean up resources when needed
function cleanup() {
  if (chatInterface) {
    if (chatInterface.wsService) {
      chatInterface.wsService.disconnect();
    }
    chatInterface = null;
  }
}

// Expose global functions to maintain compatibility
window.loadConversation = loadConversation;
window.createNewChat = createNewChat;
window.sendMessage = sendMessage;
window.setupWebSocket = setupWebSocket;
window.testWebSocketConnection = testWebSocketConnection;
window.initializeChat = initializeChat;
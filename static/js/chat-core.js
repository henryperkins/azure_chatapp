/**
 * chat-core.js
 * Main entry point for chat functionality
 */

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

// Check if modules are loaded, load if not
function ensureModulesLoaded() {
  const requiredModules = [
    { name: 'ChatUtils', path: '/static/js/chat-utils.js' },
    { name: 'WebSocketService', path: '/static/js/chat-websocket.js' },
    { name: 'MessageService', path: '/static/js/chat-messages.js' },
    { name: 'ConversationService', path: '/static/js/chat-conversations.js' },
    { name: 'UIComponents', path: '/static/js/chat-ui.js' },
    { name: 'ChatInterface', path: '/static/js/chat-interface.js' }
  ];
  
  const missingModules = requiredModules.filter(mod => !window[mod.name]);
  
  if (missingModules.length === 0) return Promise.resolve();
  
  // Function to load a script
  const loadScript = (path) => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };
  
  // Load missing modules sequentially
  return missingModules.reduce((promise, module) => {
    return promise.then(() => loadScript(module.path));
  }, Promise.resolve());
}

// Initialize the chat functionality
window.initializeChat = async function() {
  try {
    console.log("Initializing chat system...");
    
    // Ensure required modules are loaded
    await ensureModulesLoaded();
    
    // Add markdown styles
    addMarkdownStyles();
    
    // Create the chat interface only if not already created
    if (!window.chatInterface) {
      window.chatInterface = new window.ChatInterface();
      window.chatInterface.initialize();
    }
    
    // Ensure projectChatInterface is available for project page
    if (!window.projectChatInterface) {
      window.projectChatInterface = window.chatInterface;
    }

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
    
    // Set up global keyboard shortcuts
    setupGlobalKeyboardShortcuts();
    
    console.log("Chat system initialized successfully");
    return chatInterface;
  } catch (error) {
    console.error("Failed to initialize chat system:", error);
    window.ChatUtils?.handleError?.('Initializing chat', error);
    throw error;
  }
};

// Set up keyboard shortcuts
function setupGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Avoid capturing key events in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      // NOTE: This hijacks Ctrl+R - only use if needed
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('regenerateChat'));
      }
      // Ctrl+C for copying current message
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('copyMessage'));
      }
      // Ctrl+N for new chat
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        window.createNewChat();
      }
    }
  });
}

// Public API for backward compatibility
window.loadConversation = function(chatId) {
  if (!chatInterface) {
    // Create a promise that resolves when chat is initialized
    return window.initializeChat().then(() => chatInterface.loadConversation(chatId));
  }
  return chatInterface.loadConversation(chatId);
};

window.createNewChat = async function() {
  if (!chatInterface) {
    // Create a promise that resolves when chat is initialized
    return window.initializeChat().then(() => chatInterface.createNewConversation());
  }
  return chatInterface.createNewConversation();
};

window.sendMessage = async function(chatId, userMsg) {
  if (!chatInterface) {
    // Create a promise that resolves when chat is initialized
    return window.initializeChat().then(() => {
      chatInterface.currentChatId = chatId;
      return chatInterface._handleSendMessage(userMsg);
    });
  }
  chatInterface.currentChatId = chatId;
  return chatInterface._handleSendMessage(userMsg);
};

window.setupWebSocket = async function(chatId) {
  if (!chatInterface) {
    // Create a promise that resolves when chat is initialized
    return window.initializeChat().then(() => {
      if (!chatId && chatInterface.currentChatId) {
        chatId = chatInterface.currentChatId;
      }
      if (chatId && chatInterface.wsService) {
        return chatInterface.wsService.connect(chatId).then(connected => {
          if (connected) {
            chatInterface.messageService.initialize(chatId, chatInterface.wsService);
            return true;
          }
          return false;
        }).catch(() => false);
      }
      return false;
    });
  }
  
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
    } catch (error) {
      console.warn("Failed to set up WebSocket:", error);
    }
  }
  return false;
};

window.testWebSocketConnection = async function() {
  await ensureModulesLoaded();
  
  const isAuthenticated = await window.ChatUtils?.isAuthenticated?.() || 
                          (window.auth?.verify ? await window.auth.verify() : false);
                          
  if (!isAuthenticated) {
    return { success: false, authenticated: false, message: "Authentication required" };
  }
  
  try {
    // Check if we can construct a valid WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.host;
    if (!host) {
      throw new Error('Cannot determine host for WebSocket connection');
    }
    const chatId = window.CHAT_CONFIG?.chatId;
    if (!chatId) {
      throw new Error('No chatId available for WebSocket connection');
    }
    const wsUrl = `${wsProtocol}${host}/ws?chatId=${chatId}`;
    
    return {
      success: true,
      authenticated: true,
      wsUrl,
      message: "WebSocket prerequisites passed"
    };
  } catch (error) {
    window.ChatUtils?.handleError?.('WebSocket test', error);
    return { 
      success: false, 
      error: error.message, 
      message: "WebSocket test failed" 
    };
  }
};

// Auto-initialize chat if #chatUI is present in DOM
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('chatUI')) {
    window.initializeChat().catch(error => {
      console.error("Failed to auto-initialize chat:", error);
    });
  }
  
});

/**
 * chat-core.js
 * Main entry point for chat functionality
 */

if (typeof window.chatInterface === 'undefined') {
  window.chatInterface = null;
}
if (typeof window.projectChatInterface === 'undefined') {
  window.projectChatInterface = null;
}

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
window.initializeChat = async function () {
  try {
    console.log("Initializing chat system...");

    // Ensure required modules are loaded
    await ensureModulesLoaded();

    // Add markdown styles
    addMarkdownStyles();

    // Create the chat interface only if not already created
    if (!window.chatInterface) {
      // Ensure chat container exists and is visible
      const chatContainer = await ensureChatContainerVisible();
      if (!chatContainer) {
        throw new Error('Chat container not found after multiple attempts');
      }

      // Use the same selector lookup logic as in ensureChatContainerVisible
      const container = document.querySelector('#projectChatContainer') || 
                       document.querySelector('#chatContainer');
                      
      // Determine if we're in project context
      const isProjectContext = window.location.pathname.includes('/projects') || 
                               container?.id === 'projectChatContainer';
                               
      // Adjust the containerSelector based on what was found and context
      const containerSelector = isProjectContext ? 
                               '#projectChatUI' : 
                               '#chatUI';
                               
      // Also adjust message container and input selectors similarly
      const messageSelector = isProjectContext ? 
                             '#projectChatMessages' : 
                             '#conversationArea';
                             
      const inputSelector = isProjectContext ?
                           '#projectChatInput' :
                           '#chatInput';
                           
      const sendBtnSelector = isProjectContext ?
                            '#projectChatSendBtn' :
                            '#sendBtn';
                            
      console.log(`Initializing chat with selectors:`, {
        container: containerSelector,
        messages: messageSelector,
        input: inputSelector,
        sendBtn: sendBtnSelector
      });
      
      window.chatInterface = new window.ChatInterface({
        containerSelector: containerSelector,
        messageContainerSelector: messageSelector,
        inputSelector: inputSelector,
        sendButtonSelector: sendBtnSelector
      });
      
      try {
        await window.chatInterface.initialize();
      } catch (err) {
        console.error('Chat initialization failed:', err);
        showChatError('Chat initialization failed. Please refresh the page.');
        throw err;
      }
    }

    // Helper function to ensure chat container is visible
  async function ensureChatContainerVisible() {
    let attempts = 0;
    const maxAttempts = 15;
    const delay = 400;
    
    while (attempts < maxAttempts) {
      // Use the existing project chat container
      let container = document.querySelector('#projectChatContainer');
        
        // Check for containers that might be nested or within the project view
        if (!container) {
          container = document.querySelector('#projectChatUI') || 
                      document.querySelector('#projectDetailsView #projectChatContainer');
        }
                          
        // If container doesn't exist, create it in main content
        if (!container) {
          console.log("Chat container not found, creating one...");
          const mainContent = document.querySelector('main');
          
          if (mainContent) {
            container = document.createElement('div');
            container.id = 'projectChatContainer';
            container.className = 'mt-4 transition-all duration-300 ease-in-out';
            container.style.display = 'block'; // Ensure it's explicitly visible
            
            // Create messages container
            const messagesContainer = document.createElement('div');
            messagesContainer.id = 'projectChatMessages';
            messagesContainer.className = 'chat-message-container';
            container.appendChild(messagesContainer);
            
            // Create input area
            const inputArea = document.createElement('div');
            inputArea.className = 'flex items-center border-t border-gray-200 dark:border-gray-700 p-2';
            
            const chatInput = document.createElement('input');
            chatInput.id = 'projectChatInput';
            chatInput.type = 'text';
            chatInput.className = 'flex-1 border rounded-l px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white';
            chatInput.placeholder = 'Type your message...';
            
            const sendBtn = document.createElement('button');
            sendBtn.id = 'projectChatSendBtn';
            sendBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-r transition-colors';
            sendBtn.textContent = 'Send';
            
            inputArea.appendChild(chatInput);
            inputArea.appendChild(sendBtn);
            container.appendChild(inputArea);
            
            // Add to DOM
            mainContent.appendChild(container);
            console.log("Created chat container:", container.id);
          }
        }
                          
        if (container) {
          // Ensure the container is actually visible
          container.classList.remove('hidden');
          container.style.display = 'block';
          
          // Handle possible parent visibility
          let parent = container.parentElement;
          while (parent && parent !== document.body) {
            if (parent.classList.contains('hidden')) {
              parent.classList.remove('hidden');
            }
            if (parent.style.display === 'none') {
              parent.style.display = 'block';
            }
            parent = parent.parentElement;
          }
          
          // Double check it's actually visible now - may need interval for DOM to update
          if (container.offsetParent !== null) {
            console.log("Chat container found and visible:", container.id);
            return container;
          }
          
          console.log("Container found but not yet visible, waiting...");
        }
        
        // If not found, log for debugging
        if (attempts % 3 === 0) {
          console.log(`Searching for chat container (attempt ${attempts+1}/${maxAttempts})...`);
        }
        
        attempts++;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      console.error("Could not find chat container with selectors: #projectChatContainer or #chatContainer");
      return null;
    }

    function showChatError(message) {
      const errorEl = document.createElement('div');
      errorEl.className = 'p-4 bg-red-50 text-red-700 rounded mb-4';
      errorEl.textContent = message;
      document.querySelector('main')?.prepend(errorEl);
    }
    // Ensure projectChatInterface is available for project page
    if (!window.projectChatInterface) {
      window.projectChatInterface = window.chatInterface;
    }

    // Listen for model configuration changes with improved handling
    document.addEventListener('modelConfigChanged', (e) => {
      try {
        console.log("Model config changed event received:", e.detail);
        
        // Ensure MODEL_CONFIG exists
        window.MODEL_CONFIG = window.MODEL_CONFIG || {};
        
        // Update model name from event or localStorage
        const modelName = e.detail?.modelName || localStorage.getItem('modelName') || "claude-3-sonnet-20240229";
        window.MODEL_CONFIG.modelName = modelName;
        
        // Update max tokens with proper fallback
        const storedMaxTokens = localStorage.getItem('maxTokens') || "500";
        window.MODEL_CONFIG.maxTokens = Number(e.detail?.maxTokens) || Number(storedMaxTokens) || 500;
        
        // Update thinking budget with proper fallback
        const storedThinkingBudget = localStorage.getItem('thinkingBudget') || "16000";
        window.MODEL_CONFIG.thinkingBudget = Number(e.detail?.thinkingBudget) || Number(storedThinkingBudget) || 16000;
        
        // Update extended thinking settings
        const storedExtendedThinking = localStorage.getItem('extendedThinking') === "true";
        window.MODEL_CONFIG.extendedThinking = e.detail?.extendedThinking === "true" || storedExtendedThinking;
        
        // Update vision settings
        const storedVisionEnabled = localStorage.getItem('visionEnabled') === "true";
        window.MODEL_CONFIG.visionEnabled = e.detail?.visionEnabled === "true" || storedVisionEnabled;
        window.MODEL_CONFIG.visionDetail = e.detail?.visionDetail || localStorage.getItem('visionDetail') || "auto";
        
        // Update reasoning effort setting
        const storedReasoning = localStorage.getItem('reasoningEffort') || "medium";
        window.MODEL_CONFIG.reasoningEffort = e.detail?.reasoningEffort || storedReasoning;
        
        console.log("Updated MODEL_CONFIG:", window.MODEL_CONFIG);
        
        // Update message service if available
        if (window.chatInterface && window.chatInterface.messageService) {
          // Pass the updated config to message service
          window.chatInterface.messageService.updateModelConfig(window.MODEL_CONFIG);
        }
        
        // Update project chat interface if it exists and is different from the main chat interface
        if (window.projectChatInterface && 
            window.projectChatInterface !== window.chatInterface && 
            window.projectChatInterface.messageService) {
          window.projectChatInterface.messageService.updateModelConfig(window.MODEL_CONFIG);
        }
        
        // Notify other components about the config change
        document.dispatchEvent(new CustomEvent('modelConfigUpdated', {
          detail: window.MODEL_CONFIG
        }));
      } catch (error) {
        console.error("Error handling model config change:", error);
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
window.loadConversation = async function (chatId) {
  try {
    if (!chatInterface) {
      if (!window.initializeChat) {
        throw new Error('Chat system not properly initialized');
      }
      await window.initializeChat();
    }
    
    if (!chatInterface?.loadConversation) {
      throw new Error('Chat interface not available');
    }
    
    return await chatInterface.loadConversation(chatId);
  } catch (error) {
    console.error('Failed to load conversation:', error);
    throw error;
  }
};

window.createNewChat = async function () {
  if (!chatInterface) {
    // Create a promise that resolves when chat is initialized
    return window.initializeChat().then(() => chatInterface.createNewConversation());
  }
  return chatInterface.createNewConversation();
};

window.sendMessage = async function (chatId, userMsg) {
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

window.setupWebSocket = async function (chatId) {
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

window.testWebSocketConnection = async function () {
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

// Only initialize chat interface when explicitly in a project context
document.addEventListener('projectSelected', async (e) => {
  const projectId = e.detail?.projectId;
  if (!projectId) return;

  try {
    // Ensure chat containers exist
    if (typeof window.ensureChatContainers === 'function') {
      await window.ensureChatContainers();
    }

    // Initialize chat interface
    if (!window.chatInterface) {
      await window.initializeChat();
    }

    // Show project chat interface
    const projectChatContainer = document.getElementById('projectChatContainer');
    if (projectChatContainer) {
      projectChatContainer.classList.remove('hidden');
    }
  } catch (error) {
    console.error("Failed to initialize project chat:", error);
  }
});

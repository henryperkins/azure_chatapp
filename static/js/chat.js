/**
 * chat.js
 * ------------------------
 * Production-ready chat functionality for the Azure Chat Application.
 * - Single initialization method: initializeChat()
 * - Loading/sending messages
 * - Optional WebSocket integration
 * - Manages assistant responses, custom model selection, and vision images
 */

// ---------------------------------------------------------------------
  // HELPER & UTILITY-LIKE FUNCTIONS
// ---------------------------------------------------------------------
console.log("chat.js loaded"); // Move to the very top

function loadConversation(chatId) {
  if (!chatId || !isValidUUID(chatId)) {
    window.showNotification?.('Invalid conversation ID', 'error');
    return;
  }

  const conversationArea = document.getElementById("conversationArea");
  if (conversationArea) conversationArea.innerHTML = "";

  window.CHAT_CONFIG = { chatId };

  // Show loading state
  conversationArea.innerHTML = '<div class="text-center text-gray-500">Loading conversation...</div>';

  const projectId = localStorage.getItem("selectedProjectId");
  // First get conversation details to update model selection
  let conversationEndpoint = projectId
    ? `/api/projects/${projectId}/conversations/${chatId}`
    : `/api/chat/conversations/${chatId}`;
    
  let messagesEndpoint = projectId
    ? `/api/projects/${projectId}/conversations/${chatId}/messages`
    : `/api/chat/conversations/${chatId}/messages`;

  // First, get the conversation details to sync model selection
  window.apiRequest(conversationEndpoint)
    .then((convData) => {
      // Update UI to reflect this conversation's model
      if (convData.data?.model_id) {
        const modelSelect = document.getElementById("modelSelect");
        if (modelSelect) {
          // Update the model dropdown to match conversation model
          modelSelect.value = convData.data.model_id;
          // Also update localStorage to keep everything in sync
          localStorage.setItem("modelName", convData.data.model_id);
          console.log("Updated model selection to match conversation:", convData.data.model_id);
          
          // Update MODEL_CONFIG object
          window.MODEL_CONFIG = window.MODEL_CONFIG || {};
          window.MODEL_CONFIG.modelName = convData.data.model_id;
        }
      }
      
      // Now load messages
      return window.apiRequest(messagesEndpoint);
    })
    .then((data) => {
      conversationArea.innerHTML = "";
      if (data.data?.messages?.length > 0) {
        data.data.messages.forEach((msg) => {
          // Extract message metadata
          const metadata = msg.metadata || {};
          const thinking = metadata.thinking;
          const redacted_thinking = metadata.redacted_thinking;
          
          // Pass all relevant data to appendMessage including knowledge base info
          appendMessage(
            msg.role, 
            msg.content, 
            thinking, 
            redacted_thinking, 
            metadata // Pass the full metadata for knowledge base info
          );
        });
      } else {
        appendMessage("system", "No messages in this conversation yet");
      }

      // Update chat title if metadata is present
      const chatTitleEl = document.getElementById("chatTitle");
      if (chatTitleEl && data.data?.metadata) {
        chatTitleEl.textContent = data.data.metadata?.title || "New Chat";
      }
    })
    .catch((err) => {
      if (err.message === 'Resource not found') {
        console.warn("Conversation not found:", chatId);
        window.showNotification?.("This conversation could not be found or is inaccessible. Try creating a new one.", "error");
        conversationArea.innerHTML = '<div class="text-center text-gray-500">Conversation not found.</div>';
        return;
      }
    
      console.error("Error loading conversation:", err);
      conversationArea.innerHTML = '<div class="text-center text-red-500">Error loading conversation</div>';
      window.showNotification?.("Error loading conversation", "error");
    });
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function appendMessage(role, content, thinking = null, redacted_thinking = null, metadata = null) {
  const conversationArea = document.getElementById("conversationArea");
  if (!conversationArea) return;

  // If content includes '[Conversation summarized]', show an indicator
  if (content.includes('[Conversation summarized]') && typeof window.showSummaryIndicator === 'function') {
    const summaryEl = document.createElement('div');
    summaryEl.innerHTML = window.showSummaryIndicator();
    conversationArea.appendChild(summaryEl);
  }

  // Create message div
  const msgDiv = window.createDomElement("div", {
    className: `mb-2 p-2 rounded ${getMessageClass(role)}`
  });

  // Format content with markdown support
  const formattedContent = formatText(content);
  msgDiv.innerHTML = formattedContent;
  
  // Add copy button to code blocks
  msgDiv.querySelectorAll('pre code').forEach(codeBlock => {
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-code-btn';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(codeBlock.textContent)
        .then(() => {
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = 'Copy';
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy:', err);
        });
    });
    
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.appendChild(codeBlock.cloneNode(true));
    wrapper.appendChild(copyButton);
    codeBlock.replaceWith(wrapper);
  });
  
  // Knowledge Base Indicator - when AI used project files to answer
  const usedKnowledgeBase = metadata?.used_knowledge_context || false;
  if (role === 'assistant' && usedKnowledgeBase) {
    const kbContainer = document.createElement('div');
    kbContainer.className = 'mt-2 bg-blue-50 text-blue-800 rounded p-2 text-xs flex items-center';
    kbContainer.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <span>Response includes information from project files</span>
    `;
    msgDiv.appendChild(kbContainer);
  }
  
  // Add thinking blocks if available (for assistant messages)
  if (role === 'assistant' && (thinking || redacted_thinking)) {
    // Create a collapsible thinking section
    const thinkingContainer = document.createElement('div');
    thinkingContainer.className = 'mt-3 border-t border-gray-200 pt-2';
    
    // Create a toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'text-gray-600 text-xs flex items-center mb-1';
    toggleButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 thinking-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
      Show thinking process
    `;
    
    // Create the content area (hidden by default)
    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'bg-gray-50 p-2 rounded text-gray-800 text-sm hidden thinking-content';
    
    if (thinking) {
      thinkingContent.innerHTML = window.formatText ? window.formatText(thinking) : thinking;
    } else if (redacted_thinking) {
      thinkingContent.innerHTML = '<em>Claude\'s full reasoning is available but has been automatically encrypted for safety reasons.</em>';
    }
    
    // Add toggle functionality
    toggleButton.addEventListener('click', () => {
      thinkingContent.classList.toggle('hidden');
      const chevron = toggleButton.querySelector('.thinking-chevron');
      if (thinkingContent.classList.contains('hidden')) {
        toggleButton.innerHTML = toggleButton.innerHTML.replace('Hide', 'Show');
        chevron.style.transform = '';
      } else {
        toggleButton.innerHTML = toggleButton.innerHTML.replace('Show', 'Hide');
        chevron.style.transform = 'rotate(180deg)';
      }
    });
    
    thinkingContainer.appendChild(toggleButton);
    thinkingContainer.appendChild(thinkingContent);
    msgDiv.appendChild(thinkingContainer);
  }
  
  conversationArea.appendChild(msgDiv);
  conversationArea.scrollTop = conversationArea.scrollHeight;
  return msgDiv;
}

function getMessageClass(role) {
  switch (role) {
    case "user":
      return "bg-blue-50 text-blue-900";
    case "assistant":
      return "bg-green-50 text-green-900";
    case "system":
      return "bg-gray-50 text-gray-600 text-sm";
    default:
      return "bg-white";
  }
}

// ---------------------------------------------------------------------
// MODEL SELECTION
// ---------------------------------------------------------------------
function handleModelSelection() {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) return;

  modelSelect.addEventListener("change", async function() {
    const selectedModel = this.value;
    const currentChatId = window.CHAT_CONFIG?.chatId;
    if (!currentChatId) {
      window.showNotification?.("Please start a conversation first", "error");
      return;
    }

    try {
      const projectId = localStorage.getItem("selectedProjectId");
      let endpoint = projectId
        ? `/api/projects/${projectId}/conversations/${currentChatId}/model`
        : `/api/chat/conversations/${currentChatId}/model`;

      await window.apiRequest(endpoint, "PATCH", { model_id: selectedModel });
      window.showNotification?.(`Switched to ${this.options[this.selectedIndex].text}`, "success");
    } catch (error) {
      console.error("Model change error:", error);
      window.showNotification?.("Failed to change model", "error");
    }
  });
}

// ---------------------------------------------------------------------
// WEBSOCKET LOGIC
// ---------------------------------------------------------------------
let socket = null;
let wsUrl = null;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function setupWebSocket() {
  const chatId = window.CHAT_CONFIG?.chatId;
  if (!chatId) {
    console.warn('No chat ID available for WebSocket setup');
    return;
  }

  try {
    // Verify auth
    const authResponse = await fetch('/api/auth/verify', { credentials: 'include' });
    if (!authResponse.ok) {
      console.warn('Authentication check failed for WebSocket');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    const projectId = localStorage.getItem("selectedProjectId");

    console.log(`Setting up WebSocket for chat ID: ${chatId}, project ID: ${projectId || 'none'}`);

    // Verify conversation
    const checkEndpoint = projectId
      ? `/api/projects/${projectId}/conversations/${chatId}`
      : `/api/chat/conversations/${chatId}`;

    const response = await fetch(`${window.location.origin}${checkEndpoint}`, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      console.warn(`Conversation ${chatId} not accessible:`, response.status);
      return;
    }

    // Build final wsUrl
    wsUrl = projectId
      ? `${protocol}${host}${port}/api/projects/${projectId}/conversations/${chatId}/ws`
      : `${protocol}${host}${port}/api/chat/conversations/${chatId}/ws`;

    console.log('Setting up WebSocket connection to:', wsUrl);
    initializeWebSocket();
  } catch (error) {
    console.error('Error checking conversation access:', error);
  }
}

function initializeWebSocket() {
  if (!wsUrl) {
    console.warn("No WebSocket URL available");
    return;
  }

  if (wsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("Max WebSocket reconnection attempts reached");
    window.showNotification?.("Unable to establish real-time connection.", "warning");
    return;
  }

  // Get auth token
  const authToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('access_token='))
    ?.split('=')[1];

  if (!authToken) {
    console.warn("No auth token for WebSocket");
    window.showNotification?.("Please log in to enable real-time updates", "warning");
    return;
  }

  try {
    console.log("Initializing WebSocket:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket connected");
      wsReconnectAttempts = 0;

      socket.send(JSON.stringify({
        type: 'auth',
        token: authToken,
        chatId: window.CHAT_CONFIG?.chatId,
        projectId: localStorage.getItem("selectedProjectId")
      }));

      setTimeout(() => {
        try {
          socket.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.warn('Connection verification failed:', error);
        }
      }, 1000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
          console.error("WebSocket server error:", data.message);
          window.showNotification?.(data.message, "error");
          return;
        }
        if (data.role && data.content) {
          // Create metadata object if not exists
          const metadata = {};
          
          // Add knowledge context flag if present
          if (data.used_knowledge_context) {
            metadata.used_knowledge_context = true;
          }
          
          appendMessage(
            data.role, 
            data.content, 
            data.thinking, 
            data.redacted_thinking, 
            metadata
          );
        }
      } catch (error) {
        console.error("WebSocket message parse error:", error);
      }
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
      if (wsReconnectAttempts === 0) {
        window.showNotification?.("Connection error occurred. Retrying...", "error");
      }

      // Try refresh
      fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        .catch(err => console.error('Auth refresh failed:', err));
    };

    socket.onclose = async (event) => {
      console.warn("WebSocket closed. Code:", event.code, "Reason:", event.reason);

      switch (event.code) {
        case 1000:
          console.log("WebSocket closed normally");
          break;
        case 1001:
          console.log("Page is being unloaded");
          break;
        case 1006:
          console.warn("Connection closed abnormally");
          break;
        case 1008:
          console.error("Authentication failure on WebSocket");
          try {
            await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
          } catch (error) {
            console.error("Failed to refresh auth:", error);
            window.showNotification?.("Authentication failed. Please log in again.", "error");
            return;
          }
          break;
        default:
          console.warn(`WebSocket closed with code ${event.code}`);
      }

      if (event.code === 1008) {
        try {
          await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        } catch (error) {
          console.error("Failed to refresh auth:", error);
          return;
        }
      }

      // Exponential backoff for reconnection
      const backoffDelay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 10000);
      wsReconnectAttempts++;
      console.log(`Reconnecting in ${backoffDelay/1000}s... (Attempt ${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          setupWebSocket();
        }
      }, backoffDelay);
    };

  } catch (error) {
    console.error("Error initializing WebSocket:", error);
    window.showNotification?.("Failed to initialize connection. Will retry...", "error");
    const backoffDelay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 10000);
    wsReconnectAttempts++;
    setTimeout(() => setupWebSocket(), backoffDelay);
  }
}

// ---------------------------------------------------------------------
// MESSAGE SENDING
// ---------------------------------------------------------------------
function sendMessage(chatId, userMsg) {
    console.log("sendMessage called with chatId:", chatId, "userMsg:", userMsg); // Detailed logging

    if (!chatId) {
        window.showNotification?.("Please start a new conversation first.", "error");
        return;
    }

    // Store the chat ID in the global config
    window.CHAT_CONFIG = window.CHAT_CONFIG || {};
    window.CHAT_CONFIG.chatId = chatId;

    // Immediately display user message
    appendMessage("user", userMsg);
    const chatInput = document.getElementById("chatInput");
    if (chatInput) chatInput.value = "";

    // Thinking placeholder
    const thinkingIndicator = appendMessage("assistant", "<em>Thinking...</em>");
    thinkingIndicator.setAttribute("id", "thinkingIndicator");

    const visionImage = window.MODEL_CONFIG?.visionImage;
    const modelName = localStorage.getItem("modelName") || "o3-mini";
    console.log("sendMessage - modelName:", modelName); // Log model name

    const payload = {
        role: "user",
        content: userMsg,
        model_id: modelName,
        image_data: visionImage || null,
        vision_detail: window.MODEL_CONFIG?.visionDetail || "auto",
        max_completion_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
        max_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
        reasoning_effort: window.MODEL_CONFIG?.reasoningEffort || "low"
    };

    console.log("sendMessage - payload:", payload); // Log the payload

    // Clear vision data
    if (visionImage) {
        window.MODEL_CONFIG.visionImage = null;
        const visionFileInput = document.getElementById('visionFileInput');
        if (visionFileInput) visionFileInput.value = '';
        const chatImageInput = document.getElementById('chatImageInput');
        if (chatImageInput) chatImageInput.value = ''; // Clear the file input
        if (window.showNotification) window.showNotification('Image removed', 'info');
        const chatImagePreview = document.getElementById('chatImagePreview');
        if (chatImagePreview) chatImagePreview.classList.add('hidden');
        const visionPreview = document.getElementById('visionPreview');
        if (visionPreview) visionPreview.innerHTML = '';
    }

    // Try sending via WebSocket
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("sendMessage - sending via WebSocket");
        socket.send(JSON.stringify(payload));
    } else {
        // Fallback to HTTP
        console.log("sendMessage - sending via HTTP");
        const projectId = localStorage.getItem("selectedProjectId");
        let apiEndpoint = projectId
            ? `/api/projects/${projectId}/conversations/${chatId}/messages`
            : `/api/chat/conversations/${chatId}/messages`;

        console.log("sendMessage - using API endpoint:", apiEndpoint);

        window.apiRequest(apiEndpoint, "POST", payload)
            .then(respData => {
                console.log("sendMessage response body:", respData);
                const indicator = document.getElementById("thinkingIndicator");
                if (indicator) {
                    indicator.remove();
                }
                
                // Extract assistant message based on different response formats
                let assistantMessage = null;
                
                if (respData.data && respData.data.assistant_message) {
                    // Direct access
                    assistantMessage = respData.data.assistant_message;
                } else if (respData.data && respData.data.response && respData.data.response.assistant_message) {
                    // Response wrapper
                    assistantMessage = respData.data.response.assistant_message;
                } else if (respData.data && typeof respData.data.assistant_message === 'string') {
                    // String JSON format
                    try {
                        assistantMessage = JSON.parse(respData.data.assistant_message);
                    } catch (e) {
                        console.error("Failed to parse assistant_message string:", e);
                    }
                }
                
                if (assistantMessage) {
                    console.log("Rendering assistant message:", assistantMessage);
                    // Get the full metadata from the message
                    const metadata = assistantMessage.metadata || {};
                    const thinking = metadata.thinking;
                    const redactedThinking = metadata.redacted_thinking;

                    // Pass the complete metadata to appendMessage to handle knowledge base info
                    appendMessage(
                        assistantMessage.role,
                        assistantMessage.content,
                        thinking,
                        redactedThinking,
                        metadata
                    );
                } else if (respData.data?.assistant_error) {
                    console.error("Assistant error:", respData.data.assistant_error);
                    window.showNotification?.("Error generating response", "error");
                } else {
                    console.error("No assistant message found in response:", respData);
                    window.showNotification?.("Unexpected response format", "error");
                }
            })
            .catch((err) => {
                console.error("Error sending message via fetch:", err);
                const indicator = document.getElementById("thinkingIndicator");
                if (indicator) {
                    indicator.remove();
                }
                window.showNotification?.("Error sending message", "error");
            });
    }

    // Enhanced visual indicator in user message if image attached (this part seems correct)
    if (visionImage) {
      const conversationArea = document.getElementById("conversationArea");
      const msgDivs = conversationArea?.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs?.[msgDivs.length - 1]; // Corrected selector
      if (lastUserDiv) {
        const imgContainer = window.createDomElement("div", {
          className: "flex items-center bg-gray-50 rounded p-1 mt-2"
        });

        const imgElement = document.createElement("img");
        imgElement.className = "h-10 w-10 object-cover rounded mr-2";
        imgElement.src = document.getElementById('chatPreviewImg')?.src || visionImage;

        imgElement.alt = "Attached Image";
        imgContainer.appendChild(imgElement);

        const imgLabel = window.createDomElement("div", {
          className: "text-xs text-gray-500"
        }, "📷 Image attached");
        imgContainer.appendChild(imgLabel);

        lastUserDiv.appendChild(imgContainer);
      }
    }
}

// ---------------------------------------------------------------------
// IMAGE UPLOAD
// ---------------------------------------------------------------------
async function convertToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

// ---------------------------------------------------------------------
// CREATE NEW CHAT
// ---------------------------------------------------------------------
window.createNewChat = async function() {
  try {
    const selectedProjectId = localStorage.getItem("selectedProjectId");
    // Use the selected model from localStorage instead of hardcoding
    const selectedModel = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
    console.log("Creating new chat with model:", selectedModel);
    
    const payload = {
      title: "New Chat",
      model_id: selectedModel
    };

    let url = selectedProjectId
      ? `/api/projects/${selectedProjectId}/conversations`
      : `/api/chat/conversations`;

    console.log("Creating new conversation with URL:", url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`API error response (${response.status}): ${response.statusText}`);
    }

    // Parse the response and extract the conversation ID
    const responseData = await response.json();
    console.log("API create conversation response:", responseData);
    
    // Handle different response formats
    let conversation = null;
    
    if (responseData.data && responseData.data.id) {
      // Format: {data: {id: "uuid", ...}}
      conversation = responseData.data;
    } else if (responseData.data && responseData.data.data && responseData.data.data.id) {
      // Format: {data: {data: {id: "uuid", ...}}}
      conversation = responseData.data.data;
    } else if (responseData.id) {
      // Format: {id: "uuid", ...}
      conversation = responseData;
    } else {
      console.error("Unable to parse conversation from response:", responseData);
      throw new Error("Invalid response format from server. Missing conversation ID.");
    }
    
    if (!conversation.id) {
      throw new Error("Invalid response format from server. Missing conversation ID.");
    }

    // Update UI
    window.CHAT_CONFIG = window.CHAT_CONFIG || {};
    window.CHAT_CONFIG.chatId = conversation.id;
    localStorage.setItem("selectedConversationId", conversation.id);
    
    const chatTitleEl = document.getElementById("chatTitle");
    if (chatTitleEl) {
      chatTitleEl.textContent = conversation.title || "New Chat";
    }

    window.history.pushState({}, "", `/?chatId=${conversation.id}`);
    const chatUI = document.getElementById("chatUI");
    const noChatMsg = document.getElementById("noChatSelectedMessage");
    if (chatUI) chatUI.classList.remove("hidden");
    if (noChatMsg) noChatMsg.classList.add("hidden");

    const conversationArea = document.getElementById("conversationArea");
    if (conversationArea) conversationArea.innerHTML = "";

    // Load the conversation
    window.loadConversation(conversation.id);
    
    // Force a reload of the conversation list to show the new conversation
    if (typeof window.loadConversationList === 'function') {
      setTimeout(() => window.loadConversationList(), 500);
    }
    
    return conversation;
  } catch (error) {
    console.error("Error creating new chat:", error);
    window.showNotification?.(`Failed to create new chat: ${error.message}`, "error");
    throw error;
  }
};

// ---------------------------------------------------------------------
// INITIALIZE CHAT (CALLED FROM app.js)
// ---------------------------------------------------------------------
function initializeChat() {
  console.log("initializeChat called"); // Changed to console.log
  // 1. Model selection handler
  handleModelSelection();

  // 2. Configure WebSocket if needed
  setupWebSocket();

  // 3. UI references
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const chatImageInput = document.getElementById("chatImageInput");
  const chatImagePreview = document.getElementById("chatImagePreview");
  const chatPreviewImg = document.getElementById("chatPreviewImg");
  const chatImageName = document.getElementById("chatImageName");
  const chatImageStatus = document.getElementById("chatImageStatus");
  const chatRemoveImageBtn = document.getElementById("chatRemoveImageBtn");
  const chatAttachImageBtn = document.getElementById("chatAttachImageBtn");

  // 4. Auto-create a new chat if no chatId is present
  setTimeout(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');
    if (!chatId) {
      console.log("No chat ID found, auto-creating new chat");
      window.createNewChat?.();
    }
  }, 100);

  // 5. Setup event listeners with error handling and auto-creation
  const setupSendButton = () => {
    const sendBtn = document.getElementById("sendBtn");
    if (!sendBtn) {
      console.error("Send button not found in DOM. Will retry in 500ms.");
      setTimeout(setupSendButton, 500);
      return;
    }
    
    console.log("Setting up send button event listener");
    
    sendBtn.addEventListener("click", async () => {
      try {
        console.log("Send button clicked");
        const chatInput = document.getElementById("chatInput");
        const chatImagePreview = document.getElementById("chatImagePreview");
        const userMsg = chatInput?.value.trim();
        let chatId = window.CHAT_CONFIG?.chatId;
        
        console.log("Initial state:", { chatId, userMsg });

        // If no chat ID, create a new conversation
        if (!chatId) {
          try {
            const projectId = localStorage.getItem("selectedProjectId");
            console.log("No chat ID, project ID:", projectId);
            
            // Create a new chat (works for both project and standalone)
            const newConversation = await window.createNewChat();
            console.log("Created new conversation:", newConversation);
            
            if (newConversation && (newConversation.id || (newConversation.data && newConversation.data.id))) {
              chatId = newConversation.id || newConversation.data.id;
              window.CHAT_CONFIG = window.CHAT_CONFIG || {};
              window.CHAT_CONFIG.chatId = chatId;
              console.log("Created new conversation with ID:", chatId);
            } else {
              console.error("Failed to extract conversation ID from:", newConversation);
              window.showNotification?.("Failed to create new conversation", "error");
              return;
            }
          } catch (err) {
            console.error("Failed to create conversation:", err);
            window.showNotification?.("Failed to create new conversation", "error");
            return;
          }
        }

        // Now we should have a chatId
        if (userMsg && chatId) {
          console.log("Sending message to chat ID:", chatId);
          sendMessage(chatId, userMsg);
          chatImagePreview?.classList.add("hidden");
        } else if (!userMsg && window.MODEL_CONFIG?.visionImage && chatId) {
          console.log("Sending image to chat ID:", chatId);
          sendMessage(chatId, "Analyze this image");
          chatImagePreview?.classList.add("hidden");
        } else {
          console.log("Send failed - final state:", { chatId, userMsg });
          if (!userMsg) {
            window.showNotification?.("Cannot send empty message", "error");
          } else if (!chatId) {
            window.showNotification?.("No active conversation", "error");
          }
        }
      } catch (err) {
        console.error("Error in send handler:", err);
        window.showNotification?.("Error sending message", "error");
      }
    });
  };
  
  // Start the setup process
  setupSendButton();

  // Setup keyboard handler with retry mechanism
  const setupKeyboardHandler = () => {
    const chatInput = document.getElementById("chatInput");
    const chatImagePreview = document.getElementById("chatImagePreview");
    
    if (!chatInput) {
      console.error("Chat input not found in DOM. Will retry in 500ms.");
      setTimeout(setupKeyboardHandler, 500);
      return;
    }
    
    console.log("Setting up keyboard event listener");
    
    chatInput.addEventListener("keyup", async (e) => {
      if (e.key === "Enter") {
        try {
          console.log("Enter key pressed");
          const userMsg = chatInput.value.trim();
          let chatId = window.CHAT_CONFIG?.chatId;
          
          console.log("Initial state:", { chatId, userMsg });

          // If no chat ID, create a new conversation
          if (!chatId) {
            try {
              const projectId = localStorage.getItem("selectedProjectId");
              console.log("No chat ID, project ID:", projectId);
              
              // Create a new chat (works for both project and standalone)
              const newConversation = await window.createNewChat();
              console.log("Created new conversation:", newConversation);
              
              if (newConversation && (newConversation.id || (newConversation.data && newConversation.data.id))) {
                chatId = newConversation.id || newConversation.data.id;
                window.CHAT_CONFIG = window.CHAT_CONFIG || {};
                window.CHAT_CONFIG.chatId = chatId;
                console.log("Created new conversation with ID:", chatId);
              } else {
                console.error("Failed to extract conversation ID from:", newConversation);
                window.showNotification?.("Failed to create new conversation", "error");
                return;
              }
            } catch (err) {
              console.error("Failed to create conversation:", err);
              window.showNotification?.("Failed to create new conversation", "error");
              return;
            }
          }

          // Now we should have a chatId
          if (userMsg && chatId) {
            console.log("Sending message to chat ID:", chatId);
            sendMessage(chatId, userMsg);
            chatImagePreview?.classList.add("hidden");
          } else if (!userMsg && window.MODEL_CONFIG?.visionImage && chatId) {
            console.log("Sending image to chat ID:", chatId);
            sendMessage(chatId, "Analyze this image");
            chatImagePreview?.classList.add("hidden");
          } else {
            console.log("Send failed - final state:", { chatId, userMsg });
            if (!userMsg) {
              window.showNotification?.("Cannot send empty message", "error");
            } else if (!chatId) {
              window.showNotification?.("No active conversation", "error");
            }
          }
        } catch (err) {
          console.error("Error in keyup handler:", err);
          window.showNotification?.("Error sending message", "error");
        }
      }
    });
  };
  
  // Start the keyboard handler setup
  setupKeyboardHandler();

  // Image upload handling with retry mechanism
  const setupImageUploadHandlers = () => {
    const chatAttachImageBtn = document.getElementById("chatAttachImageBtn");
    const chatImageInput = document.getElementById("chatImageInput");
    const chatPreviewImg = document.getElementById("chatPreviewImg");
    const chatImageName = document.getElementById("chatImageName");
    const chatImageStatus = document.getElementById("chatImageStatus");
    const chatImagePreview = document.getElementById("chatImagePreview");
    const chatRemoveImageBtn = document.getElementById("chatRemoveImageBtn");
    
    // If any of the critical elements are missing, retry setup
    if (!chatAttachImageBtn || !chatImageInput || !chatImagePreview || !chatRemoveImageBtn) {
      console.error("Image upload elements not found in DOM. Will retry in 500ms.");
      setTimeout(setupImageUploadHandlers, 500);
      return;
    }
    
    console.log("Setting up image upload handlers");
    
    // Image attach button
    chatAttachImageBtn.addEventListener("click", () => {
      const modelName = localStorage.getItem("modelName") || "o3-mini";
      if (modelName !== "o1") {
        window.showNotification?.("Vision features only work with the o1 model.", "warning");
        return;
      }
      chatImageInput.click();
    });

    // Image input change handler
    chatImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        window.showNotification?.("Only JPEG and PNG images are supported", "error");
        chatImageInput.value = '';
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.showNotification?.("Image must be smaller than 5MB", "error");
        chatImageInput.value = '';
        return;
      }
      try {
        if (chatPreviewImg) chatPreviewImg.src = URL.createObjectURL(file);
        if (chatImageName) chatImageName.textContent = file.name;
        if (chatImageStatus) chatImageStatus.textContent = "Ready to send";
        chatImagePreview.classList.remove("hidden");

        const base64 = await convertToBase64(file);
        window.MODEL_CONFIG = window.MODEL_CONFIG || {};
        window.MODEL_CONFIG.visionImage = base64;
        window.MODEL_CONFIG.visionDetail = "auto";
      } catch (err) {
        console.error("Error processing image:", err);
        window.showNotification?.("Failed to process the image", "error");
        chatImagePreview.classList.add("hidden");
      }
    });

    // Remove image button
    chatRemoveImageBtn.addEventListener("click", () => {
      chatImageInput.value = '';
      chatImagePreview.classList.add("hidden");
      if (window.MODEL_CONFIG) window.MODEL_CONFIG.visionImage = null;
    });
  };
  
  // Start the image upload setup
  setupImageUploadHandlers();
  
  // Setup project files button
  const setupProjectFilesButton = () => {
    const showProjectFilesBtn = document.getElementById("showProjectFilesBtn");
    const closeProjectFilesBtn = document.getElementById("closeProjectFilesBtn");
    const projectFilesModal = document.getElementById("projectFilesModal");
    const uploadFileFromModalBtn = document.getElementById("uploadFileFromModalBtn");
    
    if (!showProjectFilesBtn || !projectFilesModal) {
      console.error("Project files button or modal not found in DOM. Will retry in 500ms.");
      setTimeout(setupProjectFilesButton, 500);
      return;
    }
    
    console.log("Setting up project files button");
    
    // Show modal when button is clicked
    showProjectFilesBtn.addEventListener("click", () => {
      const projectId = localStorage.getItem("selectedProjectId");
      if (!projectId) {
        window.showNotification?.("Please select a project first", "error");
        return;
      }
      
      // Show modal and load files
      projectFilesModal.classList.remove("hidden");
      loadProjectFilesForModal(projectId);
    });
    
    // Close modal
    if (closeProjectFilesBtn) {
      closeProjectFilesBtn.addEventListener("click", () => {
        projectFilesModal.classList.add("hidden");
      });
    }
    
    // Upload button in modal
    if (uploadFileFromModalBtn) {
      uploadFileFromModalBtn.addEventListener("click", () => {
        // Trigger the main upload file button in the project UI
        document.getElementById("uploadFileBtn")?.click();
        // Hide the modal after triggering upload
        projectFilesModal.classList.add("hidden");
      });
    }
  };
  
  // Function to load project files into modal
  function loadProjectFilesForModal(projectId) {
    const filesContainer = document.getElementById("projectFilesList");
    const loadingIndicator = document.getElementById("filesLoadingIndicator");
    
    if (!filesContainer || !loadingIndicator) return;
    
    // Show loading indicator
    loadingIndicator.classList.remove("hidden");
    filesContainer.innerHTML = "";
    
    // Fetch files
    window.apiRequest(`/api/projects/${projectId}/files`)
      .then(response => {
        // Hide loading indicator
        loadingIndicator.classList.add("hidden");
        
        const files = response.data?.files || [];
        if (files.length === 0) {
          filesContainer.innerHTML = `
            <li class="py-4 text-center text-gray-500">
              No files uploaded yet. Click "Upload New File" to add files that can be used as context.
            </li>
          `;
          return;
        }
        
        // Render each file
        files.forEach(file => {
          const fileItem = document.createElement("li");
          fileItem.className = "py-3";
          fileItem.innerHTML = `
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <span class="text-lg mr-2">${getFileIcon(file.file_type)}</span>
                <div>
                  <p class="font-medium">${file.filename}</p>
                  <p class="text-xs text-gray-500">
                    ${formatFileSize(file.file_size)} • 
                    ${file.file_type} • 
                    Uploaded ${formatDate(file.created_at)}
                  </p>
                </div>
              </div>
              <div>
                <span class="text-xs px-2 py-1 bg-green-100 text-green-800 rounded">
                  Searchable
                </span>
              </div>
            </div>
          `;
          filesContainer.appendChild(fileItem);
        });
      })
      .catch(err => {
        console.error("Error loading project files for modal:", err);
        loadingIndicator.classList.add("hidden");
        filesContainer.innerHTML = `
          <li class="py-4 text-center text-red-500">
            Error loading files. Please try again.
          </li>
        `;
      });
  }
  
  // Helper function to get appropriate icon for file type
  function getFileIcon(fileType) {
    const iconMap = {
      'pdf': '📄',
      'txt': '📝',
      'doc': '📝',
      'docx': '📝',
      'csv': '📊',
      'xlsx': '📊',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'json': '📋',
      'md': '📋'
    };
    
    return iconMap[fileType] || '📄';
  }
  
  // Helper function to format file size
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  // Helper function to format date
  function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  }
  
  // Start the project files button setup
  setupProjectFilesButton();

  // If there's an existing chatId, load conversation immediately
  const urlParams = new URLSearchParams(window.location.search);
  const existingChatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');
  if (existingChatId) {
    loadConversation(existingChatId);
  }
}

// Add markdown styles
const style = document.createElement('style');
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

// ---------------------------------------------------------------------
// EXPOSE GLOBALS
// ---------------------------------------------------------------------
window.loadConversation = loadConversation;
window.sendMessage = sendMessage;
window.setupWebSocket = setupWebSocket;
window.initializeChat = initializeChat;

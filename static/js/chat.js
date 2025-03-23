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
  let apiEndpoint = projectId
    ? `/api/projects/${projectId}/conversations/${chatId}/messages`
    : `/api/chat/conversations/${chatId}/messages`;

  window.apiRequest(apiEndpoint)
    .then((data) => {
      conversationArea.innerHTML = "";
      if (data.data?.messages?.length > 0) {
        data.data.messages.forEach((msg) => {
          appendMessage(msg.role, msg.content);
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

function appendMessage(role, content, thinking = null, redacted_thinking = null) {
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
  if (!chatId) return;

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
          appendMessage(data.role, data.content, data.thinking, data.redacted_thinking);
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

        window.apiRequest(apiEndpoint, "POST", payload)
            .then(respData => {
                console.log("sendMessage response body:", respData);
                const indicator = document.getElementById("thinkingIndicator");
                if (indicator) {
                    indicator.remove();
                }
                if (respData.data?.assistant_message) {
                    // Check for thinking blocks in the metadata
                    const metadata = respData.data.assistant_message.metadata || {};
                    const thinking = metadata.thinking;
                    const redactedThinking = metadata.redacted_thinking;

                    appendMessage(
                        respData.data.assistant_message.role,
                        respData.data.assistant_message.content,
                        thinking,
                        redactedThinking
                    );
                }
                if (respData.data?.assistant_error) {
                    console.error("Assistant error:", respData.data.assistant_error);
                    window.showNotification?.("Error generating response", "error");
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
    const payload = {
      title: "New Chat",
      model_id: "claude-3-sonnet-20240229"
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

    const responseData = await response.json();
    let conversation = responseData.data || responseData;

    // If nested structure
    if (conversation.data && !conversation.id) {
      conversation = conversation.data;
    }
    if (!conversation || !conversation.id) {
      throw new Error("Invalid response format from server. Missing conversation ID.");
    }

    // Update UI
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
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      try {
        console.log("Send button clicked");
        const userMsg = chatInput?.value.trim();
        let chatId = window.CHAT_CONFIG?.chatId;
        
        console.log("Initial state:", { chatId, userMsg });

        // If no chat ID but we have a project, try to create a new conversation
        if (!chatId) {
          const projectId = localStorage.getItem("selectedProjectId");
          if (projectId && userMsg) {
            try {
              const newConversation = await window.createNewChat();
              if (newConversation?.id) {
                chatId = newConversation.id;
                window.CHAT_CONFIG.chatId = chatId;
                console.log("Created new conversation:", chatId);
              }
            } catch (err) {
              console.error("Failed to create conversation:", err);
              window.showNotification?.("Failed to create new conversation", "error");
              return;
            }
          } else {
            window.showNotification?.("Please select a project first", "error");
            return;
          }
        }

        // Now we should have a chatId
        if (userMsg && chatId) {
          sendMessage(chatId, userMsg);
          chatImagePreview?.classList.add("hidden");
        } else if (!userMsg && window.MODEL_CONFIG?.visionImage && chatId) {
          sendMessage(chatId, "Analyze this image");
          chatImagePreview?.classList.add("hidden");
        } else {
          console.log("Send failed - final state:", { chatId, userMsg });
          window.showNotification?.("Cannot send empty message", "error");
        }
      } catch (err) {
        console.error("Error in send handler:", err);
        window.showNotification?.("Error sending message", "error");
      }
    });
  } else {
    console.error("Send button not found in DOM");
  }

  if (chatInput) {
    chatInput.addEventListener("keyup", async (e) => {
      if (e.key === "Enter") {
        try {
          console.log("Enter key pressed");
          const userMsg = chatInput.value.trim();
          let chatId = window.CHAT_CONFIG?.chatId;
          
          console.log("Initial state:", { chatId, userMsg });

          // If no chat ID but we have a project, try to create a new conversation
          if (!chatId) {
            const projectId = localStorage.getItem("selectedProjectId");
            if (projectId && userMsg) {
              try {
                const newConversation = await window.createNewChat();
                if (newConversation?.id) {
                  chatId = newConversation.id;
                  window.CHAT_CONFIG.chatId = chatId;
                  console.log("Created new conversation:", chatId);
                }
              } catch (err) {
                console.error("Failed to create conversation:", err);
                window.showNotification?.("Failed to create new conversation", "error");
                return;
              }
            } else {
              window.showNotification?.("Please select a project first", "error");
              return;
            }
          }

          // Now we should have a chatId
          if (userMsg && chatId) {
            sendMessage(chatId, userMsg);
            chatImagePreview?.classList.add("hidden");
          } else {
            console.log("Send failed - final state:", { chatId, userMsg });
            window.showNotification?.("Cannot send empty message", "error");
          }
        } catch (err) {
          console.error("Error in keyup handler:", err);
          window.showNotification?.("Error sending message", "error");
        }
      }
    });
  } else {
    console.error("Chat input not found in DOM");
  }

  // Image upload handling
  if (chatAttachImageBtn) {
    chatAttachImageBtn.addEventListener("click", () => {
      const modelName = localStorage.getItem("modelName") || "o3-mini";
      if (modelName !== "o1") {
        window.showNotification?.("Vision features only work with the o1 model.", "warning");
        return;
      }
      chatImageInput?.click();
    });
  }

  if (chatImageInput) {
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
        chatPreviewImg.src = URL.createObjectURL(file);
        chatImageName.textContent = file.name;
        chatImageStatus.textContent = "Ready to send";
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
  }

  if (chatRemoveImageBtn) {
    chatRemoveImageBtn.addEventListener("click", () => {
      if (chatImageInput) chatImageInput.value = '';
      if (chatImagePreview) chatImagePreview.classList.add("hidden");
      if (window.MODEL_CONFIG) window.MODEL_CONFIG.visionImage = null;
    });
  }

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

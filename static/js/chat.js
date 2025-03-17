/**
 * chat.js
 * ------------------------
 * Production-ready chat functionality for the Azure Chat Application.
 * - Displays conversation messages, sends new user messages.
 * - Optionally uses WebSocket for real-time chat updates.
 * - Handles assistant responses from the backend if triggered.
 * - Integrates user JWT for authentication in all fetch calls.
 */

// ---------------------------------------------------------------------
// New (Global) loadConversation function and its helpers
// ---------------------------------------------------------------------

/**
 * Loads an existing conversation, clears the UI, and fetches messages.
 * Updates the chat title from metadata if present.
 */
function loadConversation(chatId) {
  // Clear previous messages
  const conversationArea = document.getElementById("conversationArea");
  if (conversationArea) conversationArea.innerHTML = "";

  // Update the global chat ID
  window.CHAT_CONFIG = { chatId };

  // Show loading state
  conversationArea.innerHTML = '<div class="text-center text-gray-500">Loading conversation...</div>';

  fetch(`/api/chat/conversations/${chatId}/messages`, {
    method: "GET",
    headers: getHeaders(),
    credentials: "include"
  })
  .then(checkResponse)
  .then((data) => {
    conversationArea.innerHTML = "";
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg) => {
        appendMessage(msg.role, msg.content);
      });
    } else {
      appendMessage("system", "No messages in this conversation yet");
    }

    // Update chat title if metadata is present
    const chatTitleEl = document.getElementById("chatTitle");
    if (chatTitleEl) {
      chatTitleEl.textContent = data.metadata?.title || "New Chat";
    }
  })
  .catch((err) => {
    console.error("Error loading conversation:", err);
    conversationArea.innerHTML = '<div class="text-center text-red-500">Error loading conversation</div>';
  });
}

/**
 * Helper function that provides default headers for fetch calls.
 */
function getHeaders() {
  const cookie = document.cookie
    .split('; ')
    .find(row => row.startsWith('access_token='))
    ?.split('=')[1] || '';
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + cookie
  };
}

/**
 * Checks if the response is OK; otherwise, throws an error with text.
 */
function checkResponse(resp) {
  if (!resp.ok) {
    return resp.text().then((text) => {
      throw new Error(`${resp.status}: ${text}`);
    });
  }
  return resp.json();
}

// Expose loadConversation globally
window.loadConversation = loadConversation;
function appendMessage(role, content) {
 const conversationArea = document.getElementById("conversationArea");
 if(!conversationArea) return;

 // Optional: If content includes '[Conversation summarized]', show an indicator
 if (content.includes('[Conversation summarized]') && typeof window.showSummaryIndicator === 'function') {
   const summaryEl = document.createElement('div');
   summaryEl.innerHTML = window.showSummaryIndicator();
   conversationArea.appendChild(summaryEl);
 }

 const msgDiv = document.createElement("div");
 msgDiv.classList.add("mb-2", "p-2", "rounded");

 switch (role) {
   case "user":
     msgDiv.classList.add("bg-blue-50", "text-blue-900");
     break;
   case "assistant":
     msgDiv.classList.add("bg-green-50", "text-green-900");
     break;
   case "system":
     msgDiv.classList.add("bg-gray-50", "text-gray-600", "text-sm");
     break;
   default:
     msgDiv.classList.add("bg-white");
 }

 // Safely format text (if window.formatText is defined)
 const safeContent = typeof window.formatText === 'function'
   ? window.formatText(content)
   : content;
 msgDiv.innerHTML = safeContent;
 conversationArea.appendChild(msgDiv);
 conversationArea.scrollTop = conversationArea.scrollHeight;
}
// ---------------------------------------------------------------------
// Main DOMContentLoaded Logic
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Retrieve the chat ID if it exists in global config
  const chatId = window.CHAT_CONFIG?.chatId || "";
  
  // Basic UI references
  const noChatSelectedMessage = document.getElementById("noChatSelectedMessage");
  const conversationArea = document.getElementById("conversationArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const chatTitleEl = document.getElementById("chatTitle");
  const chatTitleEditBtn = document.getElementById("chatTitleEditBtn");

  // WebSocket URL (only if chatId is defined)
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = chatId ? `${protocol}${window.location.host}/api/chat/ws/${chatId}` : null;
  let socket = null;

  // Toggle display of "no chat selected" message
  if (noChatSelectedMessage) {
    noChatSelectedMessage.classList.toggle("hidden", chatId !== "");
  }

  // Initialize the conversation and WebSocket if a chatId exists
  if (chatId) {
    loadConversation(chatId);
    initializeWebSocket();
  }

  // Append a message to the conversation area
  // [appendMessage moved to global scope]

  // ---------------------------------------------------------------------
  // WebSocket Initialization
  // ---------------------------------------------------------------------
  function initializeWebSocket() {
    if (!wsUrl) return;
    
    // If you store an auth token in a cookie, retrieve it here
    const cookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('access_token='))
      ?.split('=')[1];

    socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(cookie || '')}`);

    socket.onopen = () => {
      console.log("WebSocket connected.");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.role && data.content) {
          appendMessage(data.role, data.content);
        }
      } catch (error) {
        console.error("WebSocket message parse error:", error);
      }
    };

    socket.onclose = () => {
      console.warn("WebSocket closed. Reconnecting...");
      setTimeout(() => initializeWebSocket(), 1000);
    };
  }

  // ---------------------------------------------------------------------
  // Send Messages
  // ---------------------------------------------------------------------
  function sendMessage(chatId, userMsg) {
    console.log("Sending message to chatId=", chatId, "with message=", userMsg);
    if (!chatId) {
      console.error("Cannot send message: No active conversation");
      if (window.showNotification) {
        window.showNotification("Please start a new conversation first.", "error");
      }
      return;
    }

    // Immediately display user message
    appendMessage("user", userMsg);
    chatInput.value = "";

    // Prepare optional vision data from MODEL_CONFIG
    const visionImage = window.MODEL_CONFIG?.visionImage;
    const modelName = localStorage.getItem("modelName") || "o3-mini";
    const payload = {
      role: "user",
      content: userMsg,
      model_id: modelName,
      image_data: visionImage || null,
      vision_detail: window.MODEL_CONFIG?.visionDetail || "auto",
      max_completion_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
      reasoning_effort: window.MODEL_CONFIG?.reasoningEffort || "low"
    };

    // Show some detail text if an image is attached
    if (visionImage) {
      const detailText = `Detail: ${window.MODEL_CONFIG?.visionDetail || "auto"}`;
      const msgDivs = conversationArea.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs[msgDivs.length - 1];
      if (lastUserDiv) {
        const detailEl = document.createElement('div');
        detailEl.className = 'text-xs text-gray-500 mt-1';
        detailEl.textContent = detailText;
        lastUserDiv.appendChild(detailEl);
      }
    }

    // Clear vision data after sending
    if (visionImage) {
      window.MODEL_CONFIG.visionImage = null;
      const inputEl = document.getElementById('visionFileInput');
      if (inputEl) inputEl.value = '';
      const statusEl = document.getElementById('visionStatus');
      if (statusEl) statusEl.textContent = '';
    }

    // If WebSocket is connected, send via socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    } else {
      // Fallback to a standard POST fetch
      fetch(`/api/chat/conversations/${chatId}/messages`, {
        method: "POST",
        headers: {
          ...getHeaders(),
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify(payload)
      })
      .then(resp => {
        console.log("sendMessage response:", resp);
        return checkResponse(resp);
      })
      .then(respData => {
        console.log("sendMessage response body:", respData);
        if (respData.assistant_message) {
          appendMessage(respData.assistant_message.role, respData.assistant_message.content);
        }
        if (respData.assistant_error) {
          console.error("Assistant error:", respData.assistant_error);
        }
      })
      .catch((err) => console.error("Error sending message via fetch:", err));
    }

    // Optional visual indicator in the user’s message if there was an image
    if (visionImage) {
      const msgDivs = conversationArea.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs[msgDivs.length - 1];
      if (lastUserDiv) {
        const imgIndicator = document.createElement('div');
        imgIndicator.className = 'text-sm text-gray-500 mt-1';
        imgIndicator.textContent = '📷 Image attached';
        lastUserDiv.appendChild(imgIndicator);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Event Listeners for Sending Messages
  // ---------------------------------------------------------------------
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const userMsg = chatInput.value.trim();
      if (userMsg) {
        if (chatId) {
          sendMessage(chatId, userMsg);
        } else {
          if (window.showNotification) {
            window.showNotification("Please start a new conversation first.", "error");
          } else {
            console.error("Please start a new conversation first.");
          }
        }
      }
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const userMsg = chatInput.value.trim();
        if (userMsg) {
          if (chatId) {
            sendMessage(chatId, userMsg);
          } else {
            if (window.showNotification) {
              window.showNotification("Please start a new conversation first.", "error");
            } else {
              console.error("Please start a new conversation first.");
            }
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------
  // Chat Title Editing
  // ---------------------------------------------------------------------
  if (chatTitleEditBtn) {
    chatTitleEditBtn.addEventListener("click", editChatTitle);
  }

  function editChatTitle() {
    if (!chatId || !chatTitleEl) return;
    const newTitle = prompt("Enter a new chat title:", chatTitleEl.textContent.trim());
    if (!newTitle) return;

    fetch(`/api/chat/conversations/${chatId}`, {
      method: "PATCH",
      headers: {
        ...getHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title: newTitle })
    })
    .then(checkResponse)
    .then((data) => {
      chatTitleEl.textContent = data.title || newTitle;
    })
    .catch((err) => console.error("Error updating chat title:", err));
  }

  // ---------------------------------------------------------------------
  // Create New Chat
  // ---------------------------------------------------------------------
  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) {
    newChatBtn.addEventListener("click", createNewChat);
  }

  function createNewChat() {
    fetch("/api/chat/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ title: "New Chat" })
    })
    .then(response => {
      if (!response.ok) {
        return response.text().then(text => { throw new Error(text); });
      }
      return response.json();
    })
    .then(data => {
      window.history.pushState({}, '', `/?chatId=${data.conversation_id}`);
      // Refresh the conversation list (defined in app.js if available)
      if (typeof window.loadConversationList === 'function') {
        window.loadConversationList();
      }
      // Load the new conversation
      loadConversation(data.conversation_id);

      // Show chat UI, hide "no chat selected" message
      const chatUI = document.getElementById("chatUI");
      const noChatMsg = document.getElementById("noChatSelectedMessage");
      if (chatUI) chatUI.classList.remove("hidden");
      if (noChatMsg) noChatMsg.classList.add("hidden");
    })
    .catch(err => {
      console.error("Error creating new chat:", err);
      if (typeof window.showNotification === "function") {
        window.showNotification("Failed to create conversation", "error");
      }
    });
  }

  // Any additional code you may have...
  // (Focus trapping, custom events, etc.)

});
// No need to redefine window.loadConversation here (already done above).

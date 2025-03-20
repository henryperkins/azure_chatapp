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

  // Use the apiRequest utility function with the right endpoint path
  window.apiRequest(`/api/chat/conversations/${chatId}/messages`)
    .then((data) => {
      conversationArea.innerHTML = "";
      if (data.data && data.data.messages && data.data.messages.length > 0) {
        data.data.messages.forEach((msg) => {
          appendMessage(msg.role, msg.content);
        });
      } else {
        appendMessage("system", "No messages in this conversation yet");
      }

      // Update chat title if metadata is present
      const chatTitleEl = document.getElementById("chatTitle");
      if (chatTitleEl && data.data && data.data.metadata) {
        chatTitleEl.textContent = data.data.metadata?.title || "New Chat";
      }
    })
    .catch((err) => {
      console.error("Error loading conversation:", err);
      conversationArea.innerHTML = '<div class="text-center text-red-500">Error loading conversation</div>';
      
      // Use the standard notification system
      if (window.showNotification) {
        window.showNotification("Error loading conversation", "error");
      }
    });
}

function appendMessage(role, content) {
 const conversationArea = document.getElementById("conversationArea");
 if(!conversationArea) return;

 // Optional: If content includes '[Conversation summarized]', show an indicator
 if (content.includes('[Conversation summarized]') && typeof window.showSummaryIndicator === 'function') {
   const summaryEl = document.createElement('div');
   summaryEl.innerHTML = window.showSummaryIndicator();
   conversationArea.appendChild(summaryEl);
 }

 // Use createDomElement utility function
 const msgDiv = window.createDomElement("div", {
   className: `mb-2 p-2 rounded ${getMessageClass(role)}`
 });

 // Safely format text (if window.formatText is defined)
 const safeContent = typeof window.formatText === 'function'
   ? window.formatText(content)
   : content;
 msgDiv.innerHTML = safeContent;
 conversationArea.appendChild(msgDiv);
 conversationArea.scrollTop = conversationArea.scrollHeight;
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

// Expose loadConversation globally
window.loadConversation = loadConversation;

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
  // Determine if this is a project-specific or standalone chat
  const selectedProjectId = localStorage.getItem("selectedProjectId");
  // Get JWT token from cookies
  const cookie = document.cookie
    .split('; ')
    .find(row => row.startsWith('access_token='))
    ?.split('=')[1];
    
  if (!cookie) {
    window.showNotification?.("Please login first", "error");
    return;
  }

  const wsUrl = chatId ? 
    (selectedProjectId && selectedProjectId !== "" && selectedProjectId !== "null") ?
      `${protocol}${window.location.host}/api/projects/${selectedProjectId}/chat/conversations/${chatId}/ws` :
      `${protocol}${window.location.host}/api/chat/${chatId}/ws`
    : null;
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
      
    if (!cookie) {
      window.showNotification?.("Please login first", "error");
      return;
    }

    socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(cookie)}`);

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
        const detailEl = window.createDomElement("div", {
          className: "text-xs text-gray-500 mt-1"
        }, detailText);
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
      // Fallback to a standard POST fetch using apiRequest
      window.apiRequest(`/api/chat/conversations/${chatId}/messages`, "POST", payload)
        .then(respData => {
          console.log("sendMessage response body:", respData);
          if (respData.data && respData.data.assistant_message) {
            appendMessage(respData.data.assistant_message.role, respData.data.assistant_message.content);
          }
          if (respData.data && respData.data.assistant_error) {
            console.error("Assistant error:", respData.data.assistant_error);
            
            // Use the standard notification system
            if (window.showNotification) {
              window.showNotification("Error generating response", "error");
            }
          }
        })
        .catch((err) => {
          console.error("Error sending message via fetch:", err);
          
          // Use the standard notification system
          if (window.showNotification) {
            window.showNotification("Error sending message", "error");
          }
        });
    }

    // Optional visual indicator in the user's message if there was an image
    if (visionImage) {
      const msgDivs = conversationArea.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs[msgDivs.length - 1];
      if (lastUserDiv) {
        const imgIndicator = window.createDomElement("div", {
          className: "text-sm text-gray-500 mt-1"
        }, "📷 Image attached");
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

    // Use apiRequest utility (standalone endpoint, doesn't require project)
    window.apiRequest(`/api/chat/conversations/${chatId}`, "PATCH", { title: newTitle })
      .then((data) => {
        chatTitleEl.textContent = data.data?.title || newTitle;
        
        // Show notification
        if (window.showNotification) {
          window.showNotification("Chat title updated", "success");
        }
      })
      .catch((err) => {
        console.error("Error updating chat title:", err);
        
        // Show error notification
        if (window.showNotification) {
          window.showNotification("Error updating chat title", "error");
        }
      });
  }

  // ---------------------------------------------------------------------
  // Create New Chat
  // ---------------------------------------------------------------------
  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) {
    // Define the function first
    window.createNewChat = async function() {
      try {
        // Show project selection modal
        const projectId = await window.showProjectSelection();
        
        // Create payload with optional project_id
        const payload = {
          title: "New Chat",
          project_id: projectId || null
        };

        // Create conversation through API
        const { data: conversation } = await window.apiRequest(
          "/api/chat/conversations",
          "POST",
          payload
        );

        // Update UI state
        localStorage.setItem("selectedConversationId", conversation.id);
        document.getElementById("chatTitle").textContent = conversation.title;
        window.history.pushState({}, "", `/?chatId=${conversation.id}`);

        // Clear previous messages and load new conversation
        const conversationArea = document.getElementById("conversationArea");
        if (conversationArea) conversationArea.innerHTML = "";
        window.loadConversation(conversation.id);
      } catch (error) {
        console.error("Error creating new chat:", error);
        if (window.showNotification) {
          window.showNotification(`Failed to create new chat: ${error.message}`, "error");
        }
      }
    };
    
    // Now add the event listener
    newChatBtn.addEventListener("click", window.createNewChat);
  }
});

/**
 * chat.js
 * ------------------------
 * Production-ready chat functionality for the Azure Chat Application.
 * - Displays conversation messages, sends new user messages.
 * - Optionally uses WebSocket for real-time chat updates.
 * - Handles assistant responses from the backend if triggered.
 * - Integrates user JWT for authentication in all fetch calls.
 */

document.addEventListener("DOMContentLoaded", () => {
  const chatId = window.CHAT_CONFIG?.chatId || "";
  const conversationArea = document.getElementById("conversationArea");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const chatTitleEl = document.getElementById("chatTitle");
  const chatTitleEditBtn = document.getElementById("chatTitleEditBtn");
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = chatId ? `${protocol}${window.location.host}/api/chat/ws/${chatId}` : null;

  let socket = null;

  // -----------------------------
  // Initialization
  // -----------------------------
  if (chatId) {
    loadConversation(chatId);  // load existing messages
    initializeWebSocket();
  }

  // -----------------------------
  // Event Listeners
  // -----------------------------
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const userMsg = chatInput.value.trim();
      if (userMsg) {
        sendMessage(chatId, userMsg);
      }
    });
  }
  if (chatInput) {
    chatInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const userMsg = chatInput.value.trim();
        if (userMsg) {
          sendMessage(chatId, userMsg);
        }
      }
    });
  }
  if (chatTitleEditBtn) {
    chatTitleEditBtn.addEventListener("click", editChatTitle);
  }

  // -----------------------------
  // Functions
  // -----------------------------

  function initializeWebSocket() {
    if (!wsUrl) return;
    socket = new WebSocket(wsUrl);

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
      console.warn("WebSocket closed. You could auto-reconnect here if needed.");
    };
  }

  function loadConversation(chatId) {
    fetch(`/api/chat/conversations/${chatId}/messages`, {
      method: "GET",
      headers: getAuthHeaders(),
    })
      .then(checkResponse)
      .then((data) => {
        if (!data.messages) return;
        data.messages.forEach((msg) => {
          appendMessage(msg.role, msg.content);
        });
      })
      .catch((err) => console.error("Error loading conversation:", err));
  }

  function sendMessage(chatId, userMsg) {
    const visionImage = window.MODEL_CONFIG?.visionImage;

    // Immediately display user message
    appendMessage("user", userMsg);
    chatInput.value = "";

    // Create payload with optional image data
    const payload = {
      role: "user",
      content: userMsg,
      model_id: parseInt(localStorage.getItem("modelId") || "3"),
      image_data: visionImage || null,
      vision_detail: window.MODEL_CONFIG?.visionDetail || "auto"
    };

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
      // Fallback to a standard fetch
      fetch(`/api/chat/conversations/${chatId}/messages`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
        .then(checkResponse)
        .then((resp) => {
          if (resp.assistant_message) {
            appendMessage(resp.assistant_message.role, resp.assistant_message.content);
          }
          if (resp.assistant_error) {
            console.error("Assistant error:", resp.assistant_error);
          }
        })
        .catch((err) => console.error("Error sending message via fetch:", err));
    }

    // Add visual indicator for image attachments
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

  function appendMessage(role, content) {
    if (content.includes('[Conversation summarized]')) {
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
    const safeContent = window.formatText(content);
    msgDiv.innerHTML = safeContent;
    conversationArea.appendChild(msgDiv);
    conversationArea.scrollTop = conversationArea.scrollHeight;
  }

  function editChatTitle() {
    if (!chatId || !chatTitleEl) return;
    const newTitle = prompt("Enter a new chat title:", chatTitleEl.textContent.trim());
    if (!newTitle) return;

    fetch(`/api/chat/conversations/${chatId}`, {
      method: "PATCH",
      headers: {
        ...getAuthHeaders(),
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

  function getAuthHeaders() {
    const token = localStorage.getItem("access_token") || "";
    return {
      Authorization: `Bearer ${token}`
    };
  }

  function checkResponse(resp) {
    if (!resp.ok) {
      return resp.text().then((text) => {
        throw new Error(`${resp.status}: ${text}`);
      });
    }
    return resp.json();
  }
});

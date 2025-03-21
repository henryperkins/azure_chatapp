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
  // Validate chat ID
  if (!chatId || !isValidUUID(chatId)) {
    if (window.showNotification) {
      window.showNotification('Invalid conversation ID', 'error');
    }
    return;
  }

  // Clear previous messages
  const conversationArea = document.getElementById("conversationArea");
  if (conversationArea) conversationArea.innerHTML = "";

  // Update the global chat ID
  window.CHAT_CONFIG = { chatId };

  function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  }

  // Show loading state
  conversationArea.innerHTML = '<div class="text-center text-gray-500">Loading conversation...</div>';

  // Use the apiRequest utility function with the right endpoint path
  const projectId = localStorage.getItem("selectedProjectId");
  let apiEndpoint;
  
  if (projectId) {
      apiEndpoint = `/api/projects/${projectId}/conversations/${chatId}/messages`;
  } else {
      apiEndpoint = `/api/chat/conversations/${chatId}/messages`;
  }
  
  window.apiRequest(apiEndpoint)
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
  
  // File upload references
  const chatAttachImageBtn = document.getElementById("chatAttachImageBtn");
  const chatImageInput = document.getElementById("chatImageInput");
  const chatImagePreview = document.getElementById("chatImagePreview");
  const chatPreviewImg = document.getElementById("chatPreviewImg");
  const chatImageName = document.getElementById("chatImageName");
  const chatImageStatus = document.getElementById("chatImageStatus");
  const chatRemoveImageBtn = document.getElementById("chatRemoveImageBtn");

  // WebSocket URL (only if chatId is defined)
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  // Determine if this is a project-specific or standalone chat
  const selectedProjectId = localStorage.getItem("selectedProjectId");
  // Get JWT token from cookies
  const cookie = document.cookie
    .split('; ')
    .find(row => row.startsWith('access_token='))
    ?.split('=')[1];
    
  /* Temporarily disable strict cookie check to avoid blocking chat usage */
  //
  // if (!cookie) {
  //   window.showNotification?.("Please login first", "error");
  //   return;
  // }
  //

  let wsUrl = null;
  if (chatId) {
    if (selectedProjectId) {
      wsUrl = `${protocol}${window.location.host}/api/projects/${selectedProjectId}/conversations/${chatId}/ws`;
    } else {
      wsUrl = `${protocol}${window.location.host}/api/chat/conversations/${chatId}/ws`;
    }
  }
  let socket = null;

  // Toggle display of "no chat selected" message
  if (noChatSelectedMessage) {
    noChatSelectedMessage.classList.toggle("hidden", chatId !== "");
  }

  // Initialize the conversation and WebSocket if a chatId exists
  if (chatId) {
    loadConversation(chatId);
    if (wsUrl) {
      initializeWebSocket();
    }
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
      
    // if (!cookie) {
    //   window.showNotification?.("Please login first", "error");
    //   return;
    // }

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket connected.");
      const cookies = document.cookie;
      socket.send(JSON.stringify({ type: 'auth', cookies }));
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

    // Show a "thinking" placeholder to give immediate feedback
    const thinkingIndicator = appendMessage("assistant", "<em>Thinking...</em>");
    thinkingIndicator.setAttribute("id", "thinkingIndicator");

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
      // Ensure max_tokens is included in the payload
      max_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
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
      
      // Clear both the old visionFileInput and the new chatImageInput
      const visionFileInput = document.getElementById('visionFileInput');
      if (visionFileInput) visionFileInput.value = '';
      
      const chatImageInput = document.getElementById('chatImageInput');
      if (chatImageInput) chatImageInput.value = '';
      
      // Clear vision status indicators for both interfaces
      const visionStatus = document.getElementById('visionStatus');
      if (visionStatus) visionStatus.textContent = '';
      
      const chatImagePreview = document.getElementById('chatImagePreview');
      if (chatImagePreview) chatImagePreview.classList.add('hidden');
      
      // Clear the vision preview
      const visionPreview = document.getElementById('visionPreview');
      if (visionPreview) visionPreview.innerHTML = '';
    }

    // If WebSocket is connected, send via socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    } else {
      // Fallback to a standard POST fetch using apiRequest
      const projectId = localStorage.getItem("selectedProjectId");
      let apiEndpoint;
      
      if (projectId) {
        apiEndpoint = `/api/projects/${projectId}/conversations/${chatId}/messages`;
      } else {
        apiEndpoint = `/api/chat/conversations/${chatId}/messages`;
      }
      
      window.apiRequest(apiEndpoint, "POST", payload)
        .then(respData => {
            console.log("sendMessage response body:", respData);
            const indicator = document.getElementById("thinkingIndicator");
            if (indicator) {
                indicator.remove();
            }
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
            const indicator = document.getElementById("thinkingIndicator");
            if (indicator) {
                indicator.remove();
            }
            
            // Use the standard notification system
            if (window.showNotification) {
                window.showNotification("Error sending message", "error");
            }
        });
    }

    // Enhanced visual indicator in the user's message if there was an image
    if (visionImage) {
      const msgDivs = conversationArea.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs[msgDivs.length - 1];
      if (lastUserDiv) {
        // Create an image thumbnail if possible by cloning the chat preview image
        const imgContainer = window.createDomElement("div", {
          className: "flex items-center bg-gray-50 rounded p-1 mt-2"
        });
        
        // Add the image thumbnail
        const imgElement = document.createElement("img");
        imgElement.className = "h-10 w-10 object-cover rounded mr-2";
        imgElement.src = document.getElementById('chatPreviewImg')?.src || visionImage;
        imgElement.alt = "Attached Image";
        imgContainer.appendChild(imgElement);
        
        // Add a label
        const imgLabel = window.createDomElement("div", {
          className: "text-xs text-gray-500"
        }, "📷 Image attached");
        imgContainer.appendChild(imgLabel);
        
        lastUserDiv.appendChild(imgContainer);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Image Upload Functionality
  // ---------------------------------------------------------------------
  
  // Function to convert an image file to base64
  async function convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  }
  
  // Handle clicking the attach image button
  if (chatAttachImageBtn) {
    chatAttachImageBtn.addEventListener("click", () => {
      // Check if this is a vision-capable model
      const modelName = localStorage.getItem("modelName") || "o3-mini";
      if (modelName !== "o1") {
        window.showNotification?.("Vision features only work with the o1 model. Please change your model in the settings.", "warning");
        return;
      }
      chatImageInput.click();
    });
  }
  
  // Handle file selection
  if (chatImageInput) {
    chatImageInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        window.showNotification?.("Only JPEG and PNG images are supported", "error");
        chatImageInput.value = '';
        return;
      }
      
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        window.showNotification?.("Image must be smaller than 5MB", "error");
        chatImageInput.value = '';
        return;
      }
      
      try {
        // Show preview
        chatPreviewImg.src = URL.createObjectURL(file);
        chatImageName.textContent = file.name;
        chatImageStatus.textContent = "Ready to send";
        chatImagePreview.classList.remove("hidden");
        
        // Convert to base64 and store in MODEL_CONFIG
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
  
  // Handle removing the image
  if (chatRemoveImageBtn) {
    chatRemoveImageBtn.addEventListener("click", () => {
      chatImageInput.value = '';
      chatImagePreview.classList.add("hidden");
      if (window.MODEL_CONFIG) {
        window.MODEL_CONFIG.visionImage = null;
      }
    });
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
          // Hide the image preview after sending
          chatImagePreview.classList.add("hidden");
        } else {
          if (window.showNotification) {
            window.showNotification("Please start a new conversation first.", "error");
          } else {
            console.error("Please start a new conversation first.");
          }
        }
      } else if (window.MODEL_CONFIG?.visionImage) {
        // Allow sending just an image with no text
        sendMessage(chatId, "Analyze this image");
        chatImagePreview.classList.add("hidden");
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
            // Hide the image preview after sending
            chatImagePreview.classList.add("hidden");
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

    // Use apiRequest utility with the correct endpoint
    const projectId = localStorage.getItem("selectedProjectId");
    let apiEndpoint;
    
    if (projectId) {
      apiEndpoint = `/api/projects/${projectId}/conversations/${chatId}`;
    } else {
      apiEndpoint = `/api/chat/conversations/${chatId}`;
    }
    
    window.apiRequest(apiEndpoint, "PATCH", { title: newTitle })
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
        // Get the selected project ID if available
        const selectedProjectId = localStorage.getItem("selectedProjectId");
        let projectId = selectedProjectId;
        
        // Create payload for the API request
        const payload = {
          title: "New Chat"
        };

        // Create conversation through API
        let url;
        
        if (projectId) {
          // Project-specific conversation
          url = `/api/projects/${projectId}/conversations`;
        } else {
          // Standalone conversation
          url = `/api/chat/conversations`;
        }

        const { data: conversation } = await window.apiRequest(
          url,
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

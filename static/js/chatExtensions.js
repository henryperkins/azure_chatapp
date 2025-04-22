// chatExtensions.js
// ----------------------------
// Additional chat functionality that extends the core chat.js file
// - Chat title editing
// - Potential for future conversation actions
//
// Refactored to:
//  1. Use eventHandler.js for standardized event tracking
//  2. Delegate authentication checks via window.app.state.isAuthenticated
//  3. Use window.app.apiRequest for server requests
//  4. Cleanup direct references to window.CHAT_CONFIG

/**
 * Initializes the chat extensions module
 */
function initChatExtensions() {
  try {
    setupChatTitleEditing();
    console.log("[ChatExtensions] Initialized");
  } catch (error) {
    console.error("[ChatExtensions] Initialization failed:", error);
  }
}

// Export initialization function
window.initChatExtensions = initChatExtensions;

/**
 * Sets up the chat title editing functionality,
 * using standardized event handling and central auth checks
 */
function setupChatTitleEditing() {
  const editTitleBtn = document.getElementById("chatTitleEditBtn");
  const chatTitleEl = document.getElementById("chatTitle");

  if (!editTitleBtn || !chatTitleEl) {
    console.warn("[ChatExtensions] Chat title edit elements not found in DOM");
    return;
  }

  // Use centralized eventHandler.js to track event
  window.eventHandlers.trackListener(
    editTitleBtn,
    "click",
    () => handleTitleEditClick(editTitleBtn, chatTitleEl),
    { description: "Chat title editing" }
  );
}

/**
 * Handles the process of clicking "Edit" on the chat title
 * @param {HTMLElement} editTitleBtn - The button that toggles edit mode
 * @param {HTMLElement} chatTitleEl - The title element to edit
 */
async function handleTitleEditClick(editTitleBtn, chatTitleEl) {
  // Already in edit mode?
  if (chatTitleEl.getAttribute("contenteditable") === "true") {
    return;
  }

  // Store original
  const originalTitle = chatTitleEl.textContent;

  // Enable contenteditable
  chatTitleEl.setAttribute("contenteditable", "true");
  chatTitleEl.classList.add(
    "border",
    "border-blue-400",
    "px-2",
    "focus:outline-none",
    "focus:ring-1",
    "focus:ring-blue-500"
  );
  chatTitleEl.focus();

  // Select all text
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(chatTitleEl);
  selection.removeAllRanges();
  selection.addRange(range);

  // Change the edit button text to "Save"
  const oldBtnText = editTitleBtn.textContent;
  editTitleBtn.textContent = "Save";

  // Completion logic for editing
  const completeEditing = async (shouldSave) => {
    // Remove editable state
    chatTitleEl.setAttribute("contenteditable", "false");
    chatTitleEl.classList.remove(
      "border",
      "border-blue-400",
      "px-2",
      "focus:outline-none",
      "focus:ring-1",
      "focus:ring-blue-500"
    );

    // Restore button text
    editTitleBtn.textContent = oldBtnText;

    if (!shouldSave) {
      // Revert
      chatTitleEl.textContent = originalTitle;
      return;
    }

    // Trim new title
    const newTitle = chatTitleEl.textContent.trim();

    if (!newTitle) {
      chatTitleEl.textContent = originalTitle;
      window.showNotification?.("Title cannot be empty", "error");
      return;
    }

    if (newTitle === originalTitle) {
      // No changes
      return;
    }

    // Attempt to save updated title
    try {
      // Check if the user is authenticated
      if (!window.auth?.isAuthenticated()) {
        window.showNotification?.("Authentication required", "error");
        chatTitleEl.textContent = originalTitle;
        return;
      }

      // Ensure chatManager is ready
      const conversationId = window.chatManager?.currentConversationId;
      const projectId = window.chatManager?.projectId;
      if (!conversationId || !projectId) {
        window.showNotification?.("No active conversation", "error");
        chatTitleEl.textContent = originalTitle;
        return;
      }

      // Call API to update conversation title
      const endpoint = `/api/projects/${projectId}/conversations/${conversationId}`;
      await window.app.apiRequest(endpoint, "PATCH", { title: newTitle });

      // Notify user
      window.showNotification?.("Conversation title updated", "success");

      // Refresh conversation list if available
      if (typeof window.loadConversationList === "function") {
        setTimeout(() => window.loadConversationList(), 500);
      }
    } catch (err) {
      console.error("[ChatExtensions] Failed to update conversation title:", err);
      chatTitleEl.textContent = originalTitle; // revert
      window.showNotification?.(
        err?.message || "Error updating conversation title",
        "error"
      );
    }
  };

  // Temporarily override the button's onclick
  const originalClickHandler = editTitleBtn.onclick;
  editTitleBtn.onclick = () => {
    completeEditing(true);
    // Restore original click handler
    editTitleBtn.onclick = originalClickHandler;
  };

  // Handle Enter/Escape within the editable title
  const keyHandler = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      completeEditing(true);
      chatTitleEl.removeEventListener("keydown", keyHandler);
    } else if (e.key === "Escape") {
      e.preventDefault();
      completeEditing(false);
      chatTitleEl.removeEventListener("keydown", keyHandler);
    }
  };

  chatTitleEl.addEventListener("keydown", keyHandler);

  // Handle clicking outside
  const clickOutsideHandler = (e) => {
    if (e.target !== chatTitleEl && e.target !== editTitleBtn) {
      completeEditing(true);
      document.removeEventListener("click", clickOutsideHandler);
    }
  };

  // Slight delay so it doesn't immediately trigger
  setTimeout(() => {
    document.addEventListener("click", clickOutsideHandler);
  }, 100);
}

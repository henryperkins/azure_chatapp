// chatExtensions.js
/**
 * chatExtensions.js
 * ----------------------------
 * Additional chat functionality that extends the core chat.js file:
 *  - Chat title editing
 *  - Future conversation actions
 *
 * Uses window.DependencySystem modules for core services.
 */

export function initChatExtensions() {
  try {
    setupChatTitleEditing();
    console.log("[ChatExtensions] Initialized");
  } catch (error) {
    console.error("[ChatExtensions] Initialization failed:", error);
  }
}

function setupChatTitleEditing() {
  const ds = window.DependencySystem; // Always reference via window for module safety
  if (!ds) {
    console.warn("[ChatExtensions] DependencySystem not found, skipping initialization");
    return;
  }

  const eventHandlers = ds.get('eventHandlers') || {};
  const auth = ds.get('auth') || {};
  const chatManager = ds.get('chatManager') || {};
  const app = ds.get('app') || {};
  const notificationHandler = ds.get('notificationHandler') || {};

  const trackListener = eventHandlers.trackListener
    ? eventHandlers.trackListener.bind(eventHandlers)
    : (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);

  const showNotification = notificationHandler.show
    ? notificationHandler.show.bind(notificationHandler)
    : (msg, type = 'info') => console.log(`[${type}] ${msg}`);

  const editTitleBtn = document.getElementById("chatTitleEditBtn");
  const chatTitleEl = document.getElementById("chatTitle");

  if (!editTitleBtn || !chatTitleEl) {
    console.warn("[ChatExtensions] Chat title edit elements not found in DOM");
    return;
  }
  if (editTitleBtn.hasAttribute("data-chat-title-handler-bound")) return;

  trackListener(editTitleBtn, "click", () => {
    handleTitleEditClick(editTitleBtn, chatTitleEl, auth, chatManager, app, showNotification, trackListener);
  }, { description: "Chat title editing" });
  editTitleBtn.setAttribute("data-chat-title-handler-bound", "true");
}

async function handleTitleEditClick(
  editTitleBtn,
  chatTitleEl,
  auth,
  chatManager,
  app,
  showNotification,
  trackListener
) {
  if (chatTitleEl.getAttribute("contenteditable") === "true") {
    return;
  }

  const originalTitle = chatTitleEl.textContent;
  const originalBtnText = editTitleBtn.textContent;

  // Enter edit mode
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

  // Update button
  editTitleBtn.textContent = "Save";

  // Cleanup and save/cancel logic
  const completeEditing = async (shouldSave) => {
    // Remove temporary listeners
    chatTitleEl.removeEventListener('keydown', keyHandler);
    document.removeEventListener('click', clickOutsideHandler);

    // Exit edit mode
    chatTitleEl.setAttribute("contenteditable", "false");
    chatTitleEl.classList.remove(
      "border",
      "border-blue-400",
      "px-2",
      "focus:outline-none",
      "focus:ring-1",
      "focus:ring-blue-500"
    );
    editTitleBtn.textContent = originalBtnText;

    if (!shouldSave) {
      chatTitleEl.textContent = originalTitle;
      return;
    }

    // Validate new title
    const newTitle = chatTitleEl.textContent.trim();
    if (!newTitle) {
      chatTitleEl.textContent = originalTitle;
      showNotification("Title cannot be empty", "error");
      return;
    }
    if (newTitle.length > 100) {
      chatTitleEl.textContent = originalTitle;
      showNotification("Title must be under 100 characters", "error");
      return;
    }
    if (newTitle === originalTitle) {
      return;
    }

    try {
      if (!auth.isAuthenticated?.()) {
        showNotification("Authentication required", "error");
        chatTitleEl.textContent = originalTitle;
        return;
      }

      const conversationId = chatManager.currentConversationId;
      const projectId = chatManager.projectId;
      if (!conversationId || !projectId) {
        showNotification("No active conversation", "error");
        chatTitleEl.textContent = originalTitle;
        return;
      }

      // Update via API
      const endpoint = `/api/projects/${projectId}/conversations/${conversationId}`;
      await app.apiRequest(endpoint, "PATCH", { title: newTitle });

      showNotification("Conversation title updated", "success");
      if (typeof window.loadConversationList === "function") {
        setTimeout(() => window.loadConversationList(), 500);
      }
    } catch (err) {
      console.error("[ChatExtensions] Failed to update conversation title:", err);
      chatTitleEl.textContent = originalTitle;
      showNotification(err.message || "Error updating conversation title", "error");
    }
  };

  // Key handler for Enter/Escape
  const keyHandler = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      completeEditing(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      completeEditing(false);
    }
  };

  // Click outside to save
  const clickOutsideHandler = (e) => {
    if (!chatTitleEl.contains(e.target) && e.target !== editTitleBtn) {
      completeEditing(true);
    }
  };

  // Attach temp listeners
  trackListener(chatTitleEl, "keydown", keyHandler, {
    description: "Chat title editing keydown"
  });
  trackListener(document, "click", clickOutsideHandler, {
    description: "Chat title outside click", once: true
  });
  trackListener(editTitleBtn, "click", () => completeEditing(true), {
    description: "Chat title save", once: true
  });
}

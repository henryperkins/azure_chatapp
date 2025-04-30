// chatExtensions.js
/**
 * chatExtensions.js
 * DependencySystem/DI refactored modular extension for chat UI enhancements:
 *   - Chat title editing
 *   - Future conversation actions
 *
 * Usage:
 *   import { createChatExtensions } from './chatExtensions.js';
 *   const chatExtensions = createChatExtensions({ DependencySystem });
 *   chatExtensions.init(); // call after DOM is ready
 */

export function createChatExtensions({ DependencySystem, eventHandlers, chatManager, auth, app, notificationHandler } = {}) {
  // Dependency resolution fallback if not provided
  DependencySystem = DependencySystem || (typeof window !== 'undefined' ? window.DependencySystem : undefined);

  eventHandlers = eventHandlers || (DependencySystem?.get?.('eventHandlers') || DependencySystem?.modules?.get?.('eventHandlers') || undefined);
  chatManager = chatManager || (DependencySystem?.get?.('chatManager') || DependencySystem?.modules?.get?.('chatManager') || undefined);
  auth = auth || (DependencySystem?.get?.('auth') || DependencySystem?.modules?.get?.('auth') || undefined);
  app = app || (DependencySystem?.get?.('app') || DependencySystem?.modules?.get?.('app') || undefined);
  notificationHandler = notificationHandler || (DependencySystem?.get?.('notificationHandler') || DependencySystem?.modules?.get?.('notificationHandler') || undefined);

  // Helper - consistent trackListener fallback
  const trackListener = eventHandlers && eventHandlers.trackListener
    ? eventHandlers.trackListener.bind(eventHandlers)
    : (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);

  // Helper - consistent showNotification fallback
  const showNotification = notificationHandler && notificationHandler.show
    ? notificationHandler.show.bind(notificationHandler)
    : (msg, type = 'info') => console.log(`[${type}] ${msg}`);

  function init() {
    try {
      setupChatTitleEditing();
      if (app?.config?.debug) console.log('[ChatExtensions] Initialized');
    } catch (error) {
      console.error("[ChatExtensions] Initialization failed:", error);
    }
  }

  function setupChatTitleEditing() {
    const editTitleBtn = document.getElementById("chatTitleEditBtn");
    const chatTitleEl = document.getElementById("chatTitle");

    if (!editTitleBtn || !chatTitleEl) {
      if (app?.config?.debug) console.warn("[ChatExtensions] Chat title edit elements not found in DOM");
      return;
    }
    if (editTitleBtn.hasAttribute("data-chat-title-handler-bound")) return;

    trackListener(editTitleBtn, "click", () => {
      handleTitleEditClick(editTitleBtn, chatTitleEl);
    }, { description: "Chat title editing" });

    editTitleBtn.setAttribute("data-chat-title-handler-bound", "true");
  }

  async function handleTitleEditClick(editTitleBtn, chatTitleEl) {
    if (chatTitleEl.getAttribute("contenteditable") === "true") return;

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

    editTitleBtn.textContent = "Save";

    // Save/cancel logic
    const completeEditing = async (shouldSave) => {
      chatTitleEl.removeEventListener('keydown', keyHandler);
      document.removeEventListener('click', clickOutsideHandler);

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
      if (newTitle === originalTitle) return;

      try {
        if (!auth?.isAuthenticated?.()) {
          showNotification("Authentication required", "error");
          chatTitleEl.textContent = originalTitle;
          return;
        }

        const conversationId = chatManager?.currentConversationId;
        const projectId = chatManager?.projectId;
        if (!conversationId || !projectId) {
          showNotification("No active conversation", "error");
          chatTitleEl.textContent = originalTitle;
          return;
        }

        const endpoint = `/api/projects/${projectId}/conversations/${conversationId}`;
        await app.apiRequest(endpoint, "PATCH", { title: newTitle });
        showNotification("Conversation title updated", "success");
        if (typeof window.loadConversationList === "function") {
          setTimeout(() => window.loadConversationList(), 500);
        }
      } catch (err) {
        if (app?.config?.debug) console.error("[ChatExtensions] Failed to update conversation title:", err);
        chatTitleEl.textContent = originalTitle;
        showNotification(err.message || "Error updating conversation title", "error");
      }
    };

    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        completeEditing(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        completeEditing(false);
      }
    };

    const clickOutsideHandler = (e) => {
      if (!chatTitleEl.contains(e.target) && e.target !== editTitleBtn) {
        completeEditing(true);
      }
    };

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

  return { init };
}

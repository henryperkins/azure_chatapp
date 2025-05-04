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

export function createChatExtensions({
  DependencySystem,
  eventHandlers,
  chatManager,
  auth,
  app,
  notify,
  domAPI
} = {}) {
  // Dependency resolution fallback if not provided
  DependencySystem = DependencySystem || (typeof window !== 'undefined' ? window.DependencySystem : undefined);

  eventHandlers = eventHandlers ||
    (DependencySystem?.get?.('eventHandlers') ||
      DependencySystem?.modules?.get?.('eventHandlers') ||
      undefined);

  chatManager = chatManager ||
    (DependencySystem?.get?.('chatManager') ||
      DependencySystem?.modules?.get?.('chatManager') ||
      undefined);

  auth = auth ||
    (DependencySystem?.get?.('auth') ||
      DependencySystem?.modules?.get?.('auth') ||
      undefined);

  app = app ||
    (DependencySystem?.get?.('app') ||
      DependencySystem?.modules?.get?.('app') ||
      undefined);

  notify = notify ||
    (DependencySystem?.get?.('notify') ||
      DependencySystem?.modules?.get?.('notify') ||
      undefined);

  domAPI = domAPI ||
    (DependencySystem?.get?.('domAPI') ||
      DependencySystem?.modules?.get?.('domAPI') ||
      (typeof document !== "undefined"
        ? {
          getElementById: (id) => document.getElementById(id),
          querySelector: (sel) => document.querySelector(sel),
        }
        : undefined)
    );

  // Helper - require trackListener, no fallback to direct .addEventListener allowed
  if (!eventHandlers || !eventHandlers.trackListener) {
    throw new Error("[chatExtensions] eventHandlers.trackListener is required (no direct addEventListener fallback permitted)");
  }
  const trackListener = eventHandlers.trackListener.bind(eventHandlers);

  // Helper - consistent showNotification: uses DI notified util, strict grouping.
  if (!notify) throw new Error('[chatExtensions] notify util required for notification');
  const showNotification = (msg, type = 'info') => {
    if (type === 'error') {
      notify.error(msg, { group: true, context: "chatExtensions" });
    } else if (type === 'success') {
      notify.success(msg, { group: true, context: "chatExtensions" });
    } else if (type === 'warning' || type === 'warn') {
      notify.warn(msg, { group: true, context: "chatExtensions" });
    } else if (type === 'debug') {
      notify.info(msg, { group: true, context: "chatExtensions" }); // Optionally: customize if you want true debug level
    } else {
      notify.info(msg, { group: true, context: "chatExtensions" });
    }
  };

  function init() {
    try {
      setupChatTitleEditing();

      // Ensure the edit button is only visible when chat UI is visible
      const chatUI = domAPI?.getElementById?.("projectChatUI");
      const editTitleBtn = domAPI?.getElementById?.("chatTitleEditBtn");
      if (editTitleBtn) {
        if (chatUI && !chatUI.classList.contains("hidden")) {
          editTitleBtn.classList.remove("hidden");
        } else {
          editTitleBtn.classList.add("hidden");
        }
      }

      showNotification('[ChatExtensions] Initialized', 'debug');
    } catch (error) {
      showNotification("[ChatExtensions] Initialization failed: " + (error && error.message ? error.message : error), "error");
    }
  }

  function setupChatTitleEditing() {
    const editTitleBtn = domAPI && domAPI.getElementById
      ? domAPI.getElementById("chatTitleEditBtn")
      : null;
    const chatTitleEl = domAPI && domAPI.getElementById
      ? domAPI.getElementById("chatTitle")
      : null;

    if (!editTitleBtn || !chatTitleEl) {
      showNotification("[ChatExtensions] Chat title edit elements not found in DOM", "warn");
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

    // Select all text (DI-pure fallback)
    if (typeof window !== "undefined" && window.getSelection && document.createRange) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(chatTitleEl);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    editTitleBtn.textContent = "Save";

    // Save/cancel logic
    const completeEditing = async (shouldSave) => {
      chatTitleEl.removeEventListener('keydown', keyHandler);
      if (typeof document !== "undefined") {
        document.removeEventListener('click', clickOutsideHandler);
      }

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
        if (!app?.apiRequest) throw new Error("No apiRequest available");
        await app.apiRequest(endpoint, "PATCH", { title: newTitle });
        showNotification("Conversation title updated", "success");
        if (typeof window !== "undefined" && typeof window.loadConversationList === "function") {
          setTimeout(() => window.loadConversationList(), 500);
        }
      } catch (err) {
        chatTitleEl.textContent = originalTitle;
        showNotification((err && err.message) || "Error updating conversation title", "error");
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
    if (typeof document !== "undefined") {
      trackListener(document, "click", clickOutsideHandler, {
        description: "Chat title outside click", once: true
      });
    }
    trackListener(editTitleBtn, "click", () => completeEditing(true), {
      description: "Chat title save", once: true
    });
  }

  return { init };
}

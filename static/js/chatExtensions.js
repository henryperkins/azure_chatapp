// chatExtensions.js
/**
 * chatExtensions.js
 * DependencySystem/DI refactored modular extension for chat UI enhancements:
 *  - Chat title editing
 *  - Future conversation actions
 *
 * Usage:
 *   import { createChatExtensions } from './chatExtensions.js';
 *   const chatExtensions = createChatExtensions({ DependencySystem });
 *   chatExtensions.init(); // call after DOM is ready
 */

export function createChatExtensions(options) {
  if (!options) {
    throw new Error("[chatExtensions] Missing options object.");
  }

  // Strict Dependency Injection — all dependencies must be passed in via options
  const {
    DependencySystem,
    eventHandlers,
    chatManager,
    auth,
    app,
    domAPI,
    domReadinessService,   // NEW
    logger                 // NEW
  } = options;

  if (!DependencySystem) {
    throw new Error("[chatExtensions] DependencySystem is required as a dependency.");
  }
  if (!eventHandlers || typeof eventHandlers.trackListener !== "function") {
    throw new Error("[chatExtensions] eventHandlers.trackListener is required (DI only).");
  }
  if (!chatManager) {
    throw new Error("[chatExtensions] chatManager dependency is required (DI only).");
  }
  if (!auth) {
    throw new Error("[chatExtensions] auth dependency is required (DI only).");
  }
  if (!app) {
    throw new Error("[chatExtensions] app dependency is required (DI only).");
  }
  if (!domAPI) {
    throw new Error("[chatExtensions] domAPI dependency is required (DI only).");
  }
  if (!domReadinessService)
    throw new Error('[chatExtensions] domReadinessService dependency is required (DI only).');
  if (!logger)
    throw new Error('[chatExtensions] logger dependency is required (DI only).');

  var trackListener = eventHandlers.trackListener.bind(eventHandlers);
  var MODULE_CONTEXT = "chatExtensions";

  function init() {
    return domReadinessService.elementsReady(
      ['#chatTitleEditBtn', '#chatTitle'],
      { timeout: 8000, context: 'chatExtensions.init' }
    ).then(() => {
      setupChatTitleEditing();

      const doc = domAPI.getDocument?.();
      doc?.dispatchEvent(
        new CustomEvent('chatextensions:initialized', { detail: { success: true } })
      );
    });
  }

  function setupChatTitleEditing() {
    if (!domAPI) return;

    var editTitleBtn = domAPI.getElementById ? domAPI.getElementById("chatTitleEditBtn") : null;
    var chatTitleEl = domAPI.getElementById ? domAPI.getElementById("chatTitle") : null;

    if (!editTitleBtn || !chatTitleEl) {
      return;
    }
    if (editTitleBtn.hasAttribute("data-chat-title-handler-bound")) {
      return;
    }

    trackListener(editTitleBtn, "click", function() {
      handleTitleEditClick(editTitleBtn, chatTitleEl);
    }, { description: "Chat title editing", context: MODULE_CONTEXT });

    editTitleBtn.setAttribute("data-chat-title-handler-bound", "true");
  }

  function handleTitleEditClick(editTitleBtn, chatTitleEl) {
    if (chatTitleEl.getAttribute("contenteditable") === "true") {
      return;
    }

    var originalTitle = chatTitleEl.textContent;
    var originalBtnText = editTitleBtn.textContent;

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

    editTitleBtn.textContent = "Save";

    function completeEditing(shouldSave) {
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

      var newTitle = chatTitleEl.textContent.trim();
      if (!newTitle || newTitle.length > 100 || newTitle === originalTitle) {
        chatTitleEl.textContent = originalTitle;
        return;
      }

      if (!auth || typeof auth.isAuthenticated !== "function" || !auth.isAuthenticated()) {
        chatTitleEl.textContent = originalTitle;
        return;
      }

      var conversationId = chatManager ? chatManager.currentConversationId : null;
      var projectId = chatManager ? chatManager.projectId : null;
      if (!conversationId || !projectId) {
        chatTitleEl.textContent = originalTitle;
        return;
      }

      if (!app || typeof app.apiRequest !== "function") {
        chatTitleEl.textContent = originalTitle;
        return;
      }

      var endpoint = "/api/projects/" + projectId + "/conversations/" + conversationId;
      app.apiRequest(endpoint, "PATCH", { title: newTitle })
        .catch(function() {
          chatTitleEl.textContent = originalTitle;
        });
    }

    function keyHandler(e) {
      if (!e) return;
      if (e.key === "Enter") {
        domAPI.preventDefault(e);
        completeEditing(true);
      } else if (e.key === "Escape") {
        domAPI.preventDefault(e);
        completeEditing(false);
      }
    }

    function clickOutsideHandler(e) {
      if (!chatTitleEl.contains(e.target) && e.target !== editTitleBtn) {
        completeEditing(true);
      }
    }

    trackListener(chatTitleEl, "keydown", keyHandler, {
      description: "Chat title editing keydown", context: MODULE_CONTEXT
    });

    const doc = domAPI.getDocument?.();
    if (doc) {
      trackListener(doc, "click", clickOutsideHandler, {
        description: "Chat title outside click", once: true, context: MODULE_CONTEXT
      });
    }

    trackListener(editTitleBtn, "click", function() {
      completeEditing(true);
    }, {
      description: "Chat title save", once: true, context: MODULE_CONTEXT
    });
  }

  function destroy() {
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === "function") {
      DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === "function") {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  }

  return {
    init: init,
    destroy: destroy
  };
}

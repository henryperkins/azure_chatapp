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

  var DependencySystem = options.DependencySystem;
  var eventHandlers = options.eventHandlers;
  var chatManager = options.chatManager;
  var auth = options.auth;
  var app = options.app;
  var domAPI = options.domAPI;

  // Ensure no optional chaining for older environments
  if (!DependencySystem) {
    throw new Error("[chatExtensions] DependencySystem is required as a dependency (no window global fallback).");
  }

  // Fallback for eventHandlers
  if (!eventHandlers) {
    if (DependencySystem.get && typeof DependencySystem.get === "function") {
      eventHandlers = DependencySystem.get("eventHandlers");
    }
    if (!eventHandlers && DependencySystem.modules && DependencySystem.modules.get) {
      eventHandlers = DependencySystem.modules.get("eventHandlers");
    }
  }

  // Fallback for chatManager
  if (!chatManager) {
    if (DependencySystem.get && typeof DependencySystem.get === "function") {
      chatManager = DependencySystem.get("chatManager");
    }
    if (!chatManager && DependencySystem.modules && DependencySystem.modules.get) {
      chatManager = DependencySystem.modules.get("chatManager");
    }
  }

  // Fallback for auth
  if (!auth) {
    if (DependencySystem.get && typeof DependencySystem.get === "function") {
      auth = DependencySystem.get("auth");
    }
    if (!auth && DependencySystem.modules && DependencySystem.modules.get) {
      auth = DependencySystem.modules.get("auth");
    }
  }

  // Fallback for app
  if (!app) {
    if (DependencySystem.get && typeof DependencySystem.get === "function") {
      app = DependencySystem.get("app");
    }
    if (!app && DependencySystem.modules && DependencySystem.modules.get) {
      app = DependencySystem.modules.get("app");
    }
  }

  // Fallback for domAPI
  if (!domAPI) {
    if (DependencySystem.get && typeof DependencySystem.get === "function") {
      domAPI = DependencySystem.get("domAPI");
    }
    if (!domAPI && DependencySystem.modules && DependencySystem.modules.get) {
      domAPI = DependencySystem.modules.get("domAPI");
    }
    if (!domAPI && typeof document !== "undefined") {
      domAPI = {
        getElementById: function(id) { return document.getElementById(id); },
        querySelector: function(sel) { return document.querySelector(sel); },
        createElement: function(tag) { return document.createElement(tag); },
        setTextContent: function(el, text) { el.textContent = text; },
        preventDefault: function(e) { if (e && e.preventDefault) e.preventDefault(); },
        appendChild: function(parent, child) { parent.appendChild(child); },
        setInnerHTML: function(el, html) { el.innerHTML = html; }
      };
    }
  }

  // Validate required methods
  if (!eventHandlers || typeof eventHandlers.trackListener !== "function") {
    throw new Error("[chatExtensions] eventHandlers.trackListener is required.");
  }

  var trackListener = eventHandlers.trackListener.bind(eventHandlers);
  var MODULE_CONTEXT = "chatExtensions";

  function init() {
    // Removed wrapping try/catch for logs
    setupChatTitleEditing();

    // The visibility of chatTitleEditBtn is primarily controlled by the main application logic;
    // no extra toggling here.

    var doc = (typeof document !== "undefined") ? document : null;
    if (doc) {
      doc.dispatchEvent(new CustomEvent("chatextensions:initialized", {
        detail: { success: true }
      }));
    }
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

    if (typeof document !== "undefined") {
      trackListener(document, "click", clickOutsideHandler, {
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

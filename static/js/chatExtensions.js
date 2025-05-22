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
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION (No fallback, throw immediately, BEFORE destructuring) ===
  if (!options) throw new Error('Missing options');
  if (!options.DependencySystem) throw new Error('Missing DependencySystem');
  if (!options.eventHandlers) throw new Error('Missing eventHandlers');
  if (!options.chatManager) throw new Error('Missing chatManager');
  if (!options.auth) throw new Error('Missing auth');
  if (!options.app) throw new Error('Missing app');
  if (!options.domAPI) throw new Error('Missing domAPI');
  if (!options.domReadinessService) throw new Error('Missing domReadinessService');
  if (!options.logger) throw new Error('Missing logger');

  // Strict Dependency Injection — all dependencies must be passed in via options
  const {
    DependencySystem,
    eventHandlers,
    chatManager,
    auth,
    app,
    domAPI,
    domReadinessService,
    logger
  } = options;

  var trackListener = eventHandlers.trackListener.bind(eventHandlers);
  var MODULE_CONTEXT = "chatExtensions";

  async function init() {
    await domReadinessService.documentReady();
    await domReadinessService.elementsReady(
      ['#projectChatTitleEditBtn', '#projectChatTitle'],
      { timeout: 8000, observeMutations: true, context: 'chatExtensions.init' }
    );
    await domReadinessService.dependenciesAndElements({
      deps: ['chatManager', 'auth', 'app'],
      domSelectors: ['#projectChatTitleEditBtn', '#projectChatTitle'],
      timeout: 8000,
      context: 'chatExtensions.init'
    });

    setupChatTitleEditing();

    const doc = domAPI.getDocument?.();
    doc?.dispatchEvent(
      new CustomEvent('chatextensions:initialized', { detail: { success: true } })
    );
  }

  function setupChatTitleEditing() {
    if (!domAPI) return;

    const editBtns = Array.from(
      domAPI.querySelectorAll?.("#projectChatTitleEditBtn") || []
    );
    if (!editBtns.length) return;

    editBtns.forEach((btn) => {
      if (btn.hasAttribute("data-chat-title-handler-bound")) return;

      const container    = btn.closest(".chat-title-row") || btn.parentElement;
      const chatTitleEl  = container?.querySelector("#projectChatTitle");
      if (!chatTitleEl) return;

      trackListener(btn, "click",
        () => handleTitleEditClick(btn, chatTitleEl),
        { description: "Chat title editing", context: MODULE_CONTEXT }
      );
      btn.setAttribute("data-chat-title-handler-bound", "true");
    });
// (logic now exclusively targets the project chat title.)
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
      app.apiRequest(endpoint, {
        method : 'PATCH',
        body   : { title: newTitle }
      })
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

  function cleanup() {
    destroy();
  }

  return {
    init: init,
    destroy: destroy,
    cleanup: cleanup
  };
}

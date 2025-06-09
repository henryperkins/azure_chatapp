/**
 * @module chatUIUtils
 * @description Canonical DI-only factory for chat UI utilities (strict .clinerules compliance)
 * Provides a single createChatUIUtils({ ...deps }) export. No top-level code, no side effects.
 *
 * @param {Object} deps - Dependency Injection options.
 * @param {Object} deps.DependencySystem - Required DI orchestrator.
 * @param {Object} deps.logger - Required DI logger.
 * @param {Object} deps.domAPI - Required DOM abstraction.
 * @param {Object} deps.DOMPurify - Required HTML sanitizer (DI-injected).
 * @param {Object} deps.eventHandlers - Required DI event manager.
 * @param {Object} deps.domReadinessService - Required DOM readiness service.
 * @returns {Object} { attachChatUI, cleanup } - Canonical interface for chat UI management.
 */

const MODULE = 'chatUIUtils';

export function createChatUIUtils(deps) {
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION (No fallback, throw immediately, BEFORE destructuring) ===
  if (!deps) throw new Error(`[${MODULE}] Missing deps`);
  if (!deps.logger) throw new Error(`[${MODULE}] Missing logger`);
  if (!deps.domAPI) throw new Error(`[${MODULE}] Missing domAPI`);
  if (!deps.DOMPurify) throw new Error(`[${MODULE}] Missing DOMPurify`);
  if (!deps.eventHandlers) throw new Error(`[${MODULE}] Missing eventHandlers`);
  if (!deps.domReadinessService) throw new Error(`[${MODULE}] Missing domReadinessService`);
  if (!deps.DependencySystem) throw new Error(`[${MODULE}] Missing DependencySystem`);

  if (!deps.safeHandler) throw new Error(`[${MODULE}] Missing safeHandler`);

  const { logger, domAPI, DOMPurify, eventHandlers, domReadinessService, safeHandler } = deps;

  function attachChatUI(chatMgr) {
    async function _setupUIElements() {
      if (!domAPI) {
        logger.error(`[${MODULE}][_setupUIElements] domAPI is required for UI setup.`, null, { context: MODULE });
        chatMgr._handleError('_setupUIElements', new Error('domAPI is required for UI setup.'));
        throw new Error('domAPI is required for UI setup.');
      }

      if (domReadinessService?.elementsReady) {
        await domReadinessService.elementsReady(
          [
            chatMgr.containerSelector,
            chatMgr.messageContainerSelector,
            chatMgr.inputSelector,
            chatMgr.sendButtonSelector
          ],
          {
            timeout: chatMgr?.APP_CONFIG?.TIMEOUTS?.CHAT_UI_READY ?? 8000,
            context: 'chatManager::UI::setup',
            observeMutations: true
          }
        );
      }

      chatMgr.container = domAPI.querySelector(chatMgr.containerSelector);
      if (!chatMgr.container) {
        logger.error(`[${MODULE}][_setupUIElements] Chat container not found`, null, { context: MODULE });
        throw new Error(`Chat container not found: ${chatMgr.containerSelector}`);
      }

      chatMgr.messageContainer = domAPI.querySelector(chatMgr.messageContainerSelector);
      if (!chatMgr.messageContainer) {
        chatMgr.messageContainer = domAPI.createElement('div');
        chatMgr.messageContainer.id = chatMgr.messageContainerSelector.startsWith('#') ? chatMgr.messageContainerSelector.substring(1) : 'chatMessages';
        domAPI.appendChild(chatMgr.container, chatMgr.messageContainer);
      }

      chatMgr.inputField = domAPI.querySelector(chatMgr.inputSelector);
      if (!chatMgr.inputField) {
        const inputArea = domAPI.createElement("div");
        inputArea.className = "chat-input-area flex p-2 border-t border-base-300";

        chatMgr.inputField = domAPI.createElement("textarea");
        chatMgr.inputField.id = chatMgr.inputSelector.startsWith('#') ? chatMgr.inputSelector.substring(1) : 'chatInput';
        chatMgr.inputField.className = "flex-grow p-2 border rounded-l-md resize-none";
        chatMgr.inputField.placeholder = "Type your message...";
        chatMgr.inputField.setAttribute("aria-label", "Chat input");

        chatMgr.sendButton = domAPI.createElement("button");
        chatMgr.sendButton.id = chatMgr.sendButtonSelector.startsWith('#') ? chatMgr.sendButtonSelector.substring(1) : 'sendBtn';
        chatMgr.sendButton.className = "p-2 bg-primary text-primary-content rounded-r-md";
        chatMgr.sendButton.textContent = "Send";
        chatMgr.sendButton.setAttribute("aria-label", "Send message");

        domAPI.appendChild(inputArea, chatMgr.inputField);
        domAPI.appendChild(inputArea, chatMgr.sendButton);
        domAPI.appendChild(chatMgr.container, inputArea);
      } else {
        chatMgr.sendButton = domAPI.querySelector(chatMgr.sendButtonSelector);
      }

      chatMgr.titleElement = domAPI.querySelector(chatMgr.titleSelector);

      if (chatMgr.minimizeButtonSelector) {
        chatMgr.minimizeButton = domAPI.querySelector(chatMgr.minimizeButtonSelector);
      }

      if (chatMgr.container) domAPI.removeClass(chatMgr.container, 'hidden');
    }

    Object.assign(chatMgr, {
      _setupUIElements
    });
  }

  function cleanup() {
    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
  }

  return { attachChatUI, cleanup };
}

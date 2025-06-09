/**
 * chat.js (≤400 LOC) – Phase-2 slim coordinator that glues together
 * ConversationManager, MessageHandler and ChatUIController.
 *
 * All heavy lifting has been extracted into dedicated modules; this file now
 * performs orchestration only, keeping under the 1 000-line limit.
 *
 * Guard-rails summary:
 *   • Factory export only – no side-effects at module scope.
 *   • All dependencies injected via DI object.
 *   • No runtime DependencySystem look-ups; use injected deps.
 *   • Exposes cleanup() which delegates to sub-modules.
 */

export function createChatManager({
  // Core injected services
  DependencySystem,
  logger,
  eventHandlers,
  domReadinessService,
  domAPI,

  conversationManager,
  messageHandler,
  chatUIController,

  // Cross-app single event service (Phase-3 consolidation)
  eventService,

  // Optional legacy module (until fully removed)
  chatUIEnhancements = null,
} = {}) {
  /* ------------------------------------------------------------------ */
  /* Dependency validation                                               */
  /* ------------------------------------------------------------------ */
  const MODULE_CONTEXT = 'ChatManager';

  const REQUIRED = {
    DependencySystem,
    logger,
    eventHandlers,
    domReadinessService,
    domAPI,
    conversationManager,
    messageHandler,
    chatUIController,
    eventService,
  };

  for (const [k, v] of Object.entries(REQUIRED)) {
    if (!v) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${k}`);
  }

  /* ------------------------------------------------------------------ */
  /* Internal state                                                      */
  /* ------------------------------------------------------------------ */
  // Use the unified eventService bus instead of a private EventTarget to
  // avoid event-system fragmentation.
  const chatBus = eventService?.getAppBus?.() || eventService?._getBus?.();

  let inputField = null;
  let sendButton = null;
  let messageContainer = null;

  /* ------------------------------------------------------------------ */
  /* Private helpers                                                     */
  /* ------------------------------------------------------------------ */

  async function _wireDOMElements() {
    // Wait for essential DOM elements to be present before wiring events.
    await domReadinessService.dependenciesAndElements({
      domSelectors: ['#chatInput', '#chatSendBtn', '#chatMessages'],
      timeout: 10_000,
      context: MODULE_CONTEXT,
    });

    inputField       = domAPI.getElementById('chatInput');
    sendButton       = domAPI.getElementById('chatSendBtn');
    messageContainer = domAPI.getElementById('chatMessages');

    chatUIController.setMessageContainer(messageContainer);

    chatUIController.attachEventHandlers({
      inputField,
      sendButton,
      messageContainer,
      onSend: (text) => sendMessage(text),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  async function initialize() {
    logger.info('[ChatManager] initialize()', { context: MODULE_CONTEXT });

    await chatUIController.attachUI();

    // Wire DOM once elements are ready.
    _wireDOMElements().catch((err) => {
      logger.error('[ChatManager] Failed to wire DOM elements', err, { context: MODULE_CONTEXT });
    });

    // Kick-off conversation bootstrap (load last or create new).
    conversationManager.loadConversationHistory().catch((err) => {
      logger.error('[ChatManager] Conversation bootstrap failed', err, { context: MODULE_CONTEXT });
    });
  }

  async function sendMessage(content) {
    if (!content || !content.trim()) return;

    chatUIController.appendMessage(
      chatUIController.createMessageElement(content, 'user', Date.now()),
    );

    chatUIController.showTypingIndicator();

    try {
      const responseData = await messageHandler.sendMessage(content, {
        conversationId: conversationManager.getCurrentConversationId(),
        model: null, // let backend decide for now
      });

      chatUIController.hideTypingIndicator();

      const aiText = responseData?.assistant_response
                  ?? responseData?.reply
                  ?? responseData?.content
                  ?? null;

      if (aiText) {
        const aiEl = chatUIController.createMessageElement(
          aiText,
          'ai',
          Date.now(),
          responseData?.message_id || null,
        );
        chatUIController.appendMessage(aiEl);
      }

      eventService.emit('chat:messageSent', { text: content, response: responseData });
    } catch (err) {
      chatUIController.hideTypingIndicator();
      logger.error('[ChatManager] sendMessage failed', err, { context: MODULE_CONTEXT });
    }
  }

  /* Simple thin wrappers delegating to ConversationManager ------------- */

  const createNewConversation  = (...a) => conversationManager.createNewConversation(...a);
  const loadConversation       = (...a) => conversationManager.loadConversation(...a);
  const deleteConversation     = (...a) => conversationManager.deleteConversation(...a);
  const getCurrentConversation = ()   => conversationManager.getCurrentConversationId();

  /* ------------------------------------------------------------------ */
  /* Cleanup                                                             */
  /* ------------------------------------------------------------------ */

  function cleanup() {
    chatUIController.cleanup();
    // sub-modules provide their own cleanup(); call if present.
    [conversationManager, messageHandler, chatUIEnhancements].forEach((mod) => {
      if (mod && typeof mod.cleanup === 'function') {
        try { mod.cleanup(); }
        catch (err) {
          logger.error('[ChatManager] sub-module cleanup failed', err, { context: MODULE_CONTEXT });
        }
      }
    });

    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    logger.debug('[ChatManager] cleaned up', { context: MODULE_CONTEXT });
  }

  /* ------------------------------------------------------------------ */
  /* Exported object                                                     */
  /* ------------------------------------------------------------------ */

  const apiObject = {
    initialize,
    sendMessage,
    createNewConversation,
    loadConversation,
    deleteConversation,
    getCurrentConversationId: getCurrentConversation,
    chatBus,
    chatUIController,
    chatUIEnhancements,
    cleanup,
  };

  // Back-compat: expose `currentConversationId` as a (readonly) property.
  Object.defineProperty(apiObject, 'currentConversationId', {
    get: getCurrentConversation,
    enumerable: false,
  });

  return apiObject;
}

export default createChatManager;

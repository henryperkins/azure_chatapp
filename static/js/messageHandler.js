// Message Handler – extracted from oversized chat.js (Phase-2 decomposition)
// Handles sendMessage, response handling, token estimation.

export function createMessageHandler({
  apiRequest,
  chatUIEnhancements,
  tokenStatsManager,
  logger
} = {}) {
  if (!apiRequest) throw new Error('[MessageHandler] apiRequest dependency missing');
  if (!chatUIEnhancements) throw new Error('[MessageHandler] chatUIEnhancements dependency missing');
  if (!tokenStatsManager) throw new Error('[MessageHandler] tokenStatsManager dependency missing');
  if (!logger) throw new Error('[MessageHandler] logger dependency missing');

  async function sendMessage(content, { conversationId, model } = {}) {
    if (!content) throw new Error('[MessageHandler] content required');

    const payload = {
      conversationId,
      model,
      content
    };

    try {
      const resp = await apiRequest.post('/messages', payload);
      // Basic update of token stats; detailed handling still in chat.js until full extraction.
      if (resp?.data?.usage) {
        tokenStatsManager.updateStats(resp.data.usage);
      }

      chatUIEnhancements?.scrollToBottom?.();
      return resp?.data ?? null;
    } catch (err) {
      logger.error('[MessageHandler] sendMessage failed', err);  
      throw err;
    }
  }

  async function estimateTokens(inputText) {
    if (!inputText) return 0;
    try {
      const resp = await apiRequest.post('/tokens/estimate', { text: inputText });
      return resp?.data?.tokens ?? 0;
    } catch (err) {
      logger.warn('[MessageHandler] token estimation failed', err);  
      return 0;
    }
  }

  function handleResponse(response) {
    // Placeholder: real logic remains in chat.js for now
    return response;
  }

  return {
    sendMessage,
    estimateTokens,
    handleResponse,
    cleanup() {}
  };
}

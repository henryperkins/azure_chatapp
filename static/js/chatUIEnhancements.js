/**
 * chatUIEnhancements.js
 *
 * Guardrails-compliant factory export exclusively. No top-level logic or direct DOM/global access.
 * All dependencies (including domReadinessService, logger) injected via DI; no side effects at import time.
 *
 * Provides UI gating helpers for safe DOM event binding (esp. chat UI) per project/timing.
 */

export function createChatUIEnhancements({
  domAPI,
  eventHandlers,
  browserService,
  domReadinessService,
  logger
} = {}) {
  const MODULE_CONTEXT = 'chatUIEnhancements';

  if (!domAPI || !domAPI.getElementById)  throw new Error('[chatUIEnhancements] domAPI required');
  if (!eventHandlers?.trackListener)      throw new Error('[chatUIEnhancements] eventHandlers required');
  if (!browserService?.setTimeout)        throw new Error('[chatUIEnhancements] browserService required');
  if (!domReadinessService) throw new Error('[chatUIEnhancements] domReadinessService required');
  if (!logger) throw new Error('[chatUIEnhancements] logger required');

  // Defensive sanitizer fallback
  const sanitizer = domReadinessService.sanitizer || {
    sanitize: (text) => {
      if (logger && logger.warn) {
        logger.warn(`[${MODULE_CONTEXT}] No sanitizer provided, using fallback.`, { context: MODULE_CONTEXT });
      }
      return text;
    }
  };

  // Local state object
  const state = {
    initialized: false,
    initializing: null,
    typingIndicatorVisible: false
  };

  /**
   * Safe handler wrapper for all event handlers.
   * @param {Function} fn - The handler function.
   * @param {string} eventType - The event type for logging.
   * @returns {Function}
   */
  function safeHandler(fn, eventType) {
    return function(event) {
      try {
        return fn(event);
      } catch (err) {
        logger.error(`[${MODULE_CONTEXT}] Handler error for ${eventType}`, err, { context: MODULE_CONTEXT });
      }
    };
  }

  /**
   * Async readiness helper for chat UI elements.
   * Resolves when all selectors are present; logs and rejects on error/timeout.
   *
   * @param {Object} opts
   * @param {string[]} opts.domSelectors - Array of required selector strings.
   * @param {number} [opts.timeout=8000] - Optional timeout (ms).
   * @param {string} [opts.context]      - Optional log context.
   * @returns {Promise<void>}
   */
  async function whenChatUIReady(opts = {}) {
    const {
      domSelectors,
      timeout = 8000,
      context = `${MODULE_CONTEXT}::whenChatUIReady`
    } = opts;
    if (!Array.isArray(domSelectors) || domSelectors.length === 0) {
      logger.error(`[${MODULE_CONTEXT}] Invalid domSelectors param for whenChatUIReady`, { context: 'chatUIEnhancements' });
      throw new Error(`[${MODULE_CONTEXT}] Must provide one or more selectors to whenChatUIReady`);
    }
    try {
      await domReadinessService.dependenciesAndElements({
        domSelectors,
        timeout,
        context
      });
      // Optionally validate post-gating presence (defensive)
      const doc = domAPI.getDocument && domAPI.getDocument();
      if (doc) {
        for (const sel of domSelectors) {
          if (!doc.querySelector(sel)) {
            logger.error(`[${MODULE_CONTEXT}] Selector ${sel} still missing after readiness wait`, { context: 'chatUIEnhancements' });
            throw new Error(`[${MODULE_CONTEXT}] DOM selector missing after gating: ${sel}`);
          }
        }
      }
    } catch (err) {
      logger.error(`[${MODULE_CONTEXT}] DOM readiness failed for selectors: ${domSelectors.join(', ')}`, err, { context: 'chatUIEnhancements' });
      throw err;
    }
  }

  /**
   * Initialize chat UI enhancements
   * @param {Object} options - Initialization options
   * @returns {Promise<void>}
   */
  function initialize(options = {}) {
    if (state.initialized) return Promise.resolve();
    if (state.initializing) return state.initializing;

    state.initializing = whenChatUIReady({
      domSelectors: ['#chatUIInput', '#globalChatMessages', '#globalChatSendBtn'],
      context: `${MODULE_CONTEXT}::initialize`
    }).then(() => {
      const chatInput = domAPI.getElementById && domAPI.getElementById('chatUIInput');
      const sendBtn = domAPI.getElementById && domAPI.getElementById('globalChatSendBtn');
      const doc = domAPI.getDocument && domAPI.getDocument();

      // Add event listeners
      if (chatInput) {
        eventHandlers.trackListener(
          chatInput,
          'keypress',
          safeHandler(handleInputKeypress, 'keypress'),
          { context: 'chatUIEnhancements', description: 'Chat input keypress handler' }
        );
      }

      // Add message event listener
      if (doc) {
        eventHandlers.trackListener(
          doc,
          'chatNewMessage',
          safeHandler(handleNewMessage, 'chatNewMessage'),
          { context: 'chatUIEnhancements', description: 'New message handler' }
        );
      }

      state.initialized = true;
      state.initializing = null;
    }).catch(err => {
      logger.error(`[${MODULE_CONTEXT}] Failed to initialize chat UI: `, err, { context: 'chatUIEnhancements' });
      state.initializing = null;
      throw err;
    });

    return state.initializing;
  }

  /**
   * Handle new message event
   * @param {Event} event - The custom event containing message data
   */
  function handleNewMessage(event) {
    if (!event.detail) return;

    const { message, sender, timestamp } = event.detail;

    // Create enhanced message element
    const messageEl = createMessageElement(message, sender, timestamp);

    // Add to chat container
    const chatContainer = domAPI.getElementById && domAPI.getElementById('globalChatMessages');
    if (chatContainer && messageEl) {
      chatContainer.appendChild(messageEl);
      scrollToBottom(chatContainer);
    }
  }

  /**
   * Create an enhanced message element
   * @param {string} message - The message content
   * @param {string} sender - The sender (user or ai)
   * @param {number} timestamp - The message timestamp
   * @returns {HTMLElement} The message element
   */
  function createMessageElement(message, sender, timestamp) {
    const isUser = sender === 'user';
    const messageClass = isUser ? 'user-message' : 'ai-message';

    // Create message container
    const messageEl = domAPI.createElement && domAPI.createElement('div');
    if (!messageEl) return null;
    messageEl.className = `chat-message ${messageClass}`;

    // Create message bubble
    const bubbleEl = domAPI.createElement && domAPI.createElement('div');
    if (!bubbleEl) return null;
    bubbleEl.className = 'message-bubble';

    // Sanitize and set message content
    bubbleEl.innerHTML = sanitizer.sanitize(message);

    // Create metadata element
    const metadataEl = domAPI.createElement && domAPI.createElement('div');
    if (!metadataEl) return null;
    metadataEl.className = 'message-metadata';

    // Format and add timestamp
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    metadataEl.textContent = time;

    // Create message actions
    const actionsEl = domAPI.createElement && domAPI.createElement('div');
    if (!actionsEl) return null;
    actionsEl.className = 'message-actions';

    // Add copy button for AI messages
    if (!isUser) {
      const copyBtn = domAPI.createElement && domAPI.createElement('button');
      if (copyBtn) {
        copyBtn.className = 'message-action-btn';
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.innerHTML = sanitizer.sanitize(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
        );

        eventHandlers.trackListener(
          copyBtn,
          'click',
          safeHandler(() => copyMessageToClipboard(message), 'click'),
          { context: 'chatUIEnhancements', description: 'Copy message to clipboard' }
        );

        actionsEl.appendChild(copyBtn);
      }
    }

    // Assemble the message element
    messageEl.appendChild(bubbleEl);
    messageEl.appendChild(metadataEl);
    messageEl.appendChild(actionsEl);

    return messageEl;
  }

  /**
   * Copy message content to clipboard
   * @param {string} message - The message to copy
   */
  function copyMessageToClipboard(message) {
    // Strip HTML tags for plain text
    const tempEl = domAPI.createElement && domAPI.createElement('div');
    if (!tempEl) return;
    tempEl.innerHTML = sanitizer.sanitize(message);
    const textContent = tempEl.textContent;

    const doc = domAPI.getDocument && domAPI.getDocument();
    if (!doc) return;

    // Use clipboard API if available (DI-safe)
    const clip = browserService.getWindow?.()?.navigator?.clipboard;
    if (clip?.writeText) {
      clip.writeText(textContent)
        .then(() => showCopyFeedback(true))
        .catch(err => {
          logger.error('[chatUIEnhancements] Failed to copy text: ', err, { context: 'chatUIEnhancements' });
          showCopyFeedback(false);
        });
    } else {
      // Fallback method
      const textarea = domAPI.createElement && domAPI.createElement('textarea');
      if (!textarea) return;
      textarea.value = textContent;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      doc.body.appendChild(textarea);
      textarea.select();

      try {
        const successful = doc.execCommand && doc.execCommand('copy');
        showCopyFeedback(successful);
      } catch (err) {
        logger.error('[chatUIEnhancements] Failed to copy text: ', err, { context: 'chatUIEnhancements' });
        showCopyFeedback(false);
      }

      doc.body.removeChild(textarea);
    }
  }

  /**
   * Show feedback after copy attempt
   * @param {boolean} success - Whether the copy was successful
   */
  function showCopyFeedback(success) {
    const doc = domAPI.getDocument && domAPI.getDocument();
    if (!doc) return;

    // Remove existing toast if present
    const existing = doc.getElementById && doc.getElementById('chatCopyToast');
    if (existing) existing.remove();

    // Create toast notification
    const toast = domAPI.createElement && domAPI.createElement('div');
    if (!toast) return;
    toast.id = 'chatCopyToast';
    toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ${success ? 'bg-success text-success-content' : 'bg-error text-error-content'
      } transition-opacity duration-300`;
    toast.textContent = success ? 'Copied to clipboard!' : 'Failed to copy text';

    // Add to document
    doc.body.appendChild(toast);

    // Remove after delay
    browserService.setTimeout(() => {
      toast.style.opacity = '0';
      browserService.setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 2000);
  }

  /**
   * Handle keypress in the chat input
   * @param {KeyboardEvent} event - The keypress event
   */
  function handleInputKeypress(event) {
    // Submit on Enter (without Shift)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const sendBtn = domAPI.getElementById && domAPI.getElementById('globalChatSendBtn');
      if (sendBtn) {
        sendBtn.click();
      }
    }
  }

  /**
   * Show typing indicator in the chat
   */
  function showTypingIndicator() {
    if (state.typingIndicatorVisible) return;

    const chatContainer = domAPI.getElementById && domAPI.getElementById('globalChatMessages');
    if (!chatContainer) return;

    const indicatorEl = domAPI.createElement && domAPI.createElement('div');
    if (!indicatorEl) return;
    indicatorEl.id = 'typingIndicator';
    indicatorEl.className = 'chat-message ai-message';

    const indicatorContent = domAPI.createElement && domAPI.createElement('div');
    if (!indicatorContent) return;
    indicatorContent.className = 'typing-indicator';
    indicatorContent.innerHTML = sanitizer.sanitize('<span></span><span></span><span></span>');

    indicatorEl.appendChild(indicatorContent);
    chatContainer.appendChild(indicatorEl);
    scrollToBottom(chatContainer);

    state.typingIndicatorVisible = true;
  }

  /**
   * Hide typing indicator
   */
  function hideTypingIndicator() {
    if (!state.typingIndicatorVisible) return;

    const indicator = domAPI.getElementById && domAPI.getElementById('typingIndicator');
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }

    state.typingIndicatorVisible = false;
  }

  /**
   * Scroll chat container to bottom
   * @param {HTMLElement} container - The chat container element
   */
  function scrollToBottom(container) {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Clean up resources
   */
  function cleanup() {
    if (eventHandlers.cleanupListeners) {
      eventHandlers.cleanupListeners({ context: 'chatUIEnhancements' });
    }
    state.initialized = false;
    state.initializing = null;
    state.typingIndicatorVisible = false;
  }

  /**
   * Attach all enhanced event handlers to the chat UI elements.
   * @param {Object} params - DOM handles and callbacks.
   *   {HTMLElement} params.inputField
   *   {HTMLElement} params.sendButton
   *   {HTMLElement} params.messageContainer
   *   {Function} params.onSend
   */
  function attachEventHandlers({ inputField, sendButton, messageContainer, onSend }) {
    // Enhanced submit on Enter (no Shift)
    if (inputField && eventHandlers && typeof eventHandlers.trackListener === 'function') {
      eventHandlers.trackListener(
        inputField,
        'keydown',
        safeHandler((event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (typeof onSend === 'function') {
              onSend(inputField.value);
            }
          }
        }, 'inputKeydown'),
        { context: 'chatUIEnhancements', description: 'Enhanced chat input handler' }
      );
    }
    if (sendButton && typeof onSend === 'function' && eventHandlers && typeof eventHandlers.trackListener === 'function') {
      eventHandlers.trackListener(
        sendButton,
        'click',
        safeHandler(() => {
          onSend(inputField ? inputField.value : '');
        }, 'sendButtonClick'),
        { context: 'chatUIEnhancements', description: 'Send button click handler' }
      );
    }
    // Could add enhanced copy, emoji menu, etc.
  }

  // Public API
  return {
    initialize,
    showTypingIndicator,
    hideTypingIndicator,
    cleanup,
    createMessageElement,
    attachEventHandlers
  };
}

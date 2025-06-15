/**
 * Chat UI Controller – Phase 2 decomposition from chat.js and chatUIEnhancements.js
 * 
 * Handles pure UI rendering, DOM manipulation, and UI state management for chat interface.
 * Extracted from oversized files to enforce 1000-line module limit.
 * 
 * Responsibilities:
 * - Message rendering and DOM creation
 * - UI state management (typing indicators, input controls)
 * - Event handling for UI interactions
 * - Citation rendering and interaction
 * - Message container management
 */

import { getSafeHandler } from './utils/getSafeHandler.js';

export function createChatUIController({
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  DependencySystem,
  eventService,
  browserService,
  messageHandler,
  tokenStatsManager
} = {}) {
  if (!domAPI) throw new Error('[ChatUIController] domAPI dependency missing');
  if (!eventHandlers) throw new Error('[ChatUIController] eventHandlers dependency missing');
  if (!logger) throw new Error('[ChatUIController] logger dependency missing');
  if (!sanitizer) throw new Error('[ChatUIController] sanitizer dependency missing');
  if (!DependencySystem) throw new Error('[ChatUIController] DependencySystem dependency missing');
  if (!eventService) throw new Error('[ChatUIController] eventService dependency missing');
  if (!browserService) throw new Error('[ChatUIController] browserService dependency missing');
  if (!messageHandler) throw new Error('[ChatUIController] messageHandler dependency missing');
  if (!tokenStatsManager) throw new Error('[ChatUIController] tokenStatsManager dependency missing');

  const MODULE_CONTEXT = 'ChatUIController';
  const safeHandler = getSafeHandler(DependencySystem);

  // Internal state
  const state = {
    rootEl: null,
    messageContainer: null,
    typingIndicatorVisible: false,
    typingIndicatorEl: null
  };

  /**
   * Attach UI to specified root element
   */
  function attachUI(rootSelector = '#chat-root') {
    state.rootEl = domAPI.querySelector(rootSelector);
    if (!state.rootEl) {
      logger.warn('[ChatUIController] attachUI could not find root element', { 
        context: MODULE_CONTEXT, 
        selector: rootSelector 
      });
      return;
    }
    logger.info('[ChatUIController] UI attached successfully', { context: MODULE_CONTEXT });
  }

  /**
   * Detach UI and clean up DOM elements
   */
  function detachUI() {
    if (state.rootEl) {
      domAPI.replaceChildren(state.rootEl);
      state.rootEl = null;
    }
    state.messageContainer = null;
    hideTypingIndicator();
  }

  /**
   * Update input field state (enabled/disabled)
   */
  function updateInputState(enabled) {
    const inputEl = state.rootEl?.querySelector('textarea, input');
    if (inputEl) {
      inputEl.disabled = !enabled;
      logger.debug('[ChatUIController] Input state updated', { 
        context: MODULE_CONTEXT, 
        enabled 
      });
    }
  }

  /**
   * Set the active message container for displaying messages
   */
  function setMessageContainer(container) {
    if (!container) {
      logger.warn('[ChatUIController] setMessageContainer called with null container', {
        context: MODULE_CONTEXT
      });
      return;
    }

    state.messageContainer = container;
    logger.info('[ChatUIController] Message container set', {
      context: MODULE_CONTEXT,
      containerId: container.id || 'unnamed'
    });
  }

  /**
   * Render citations as clickable DOM elements within content
   */
  function renderCitationsAsDOM(content) {
    const fragment = domAPI.createDocumentFragment();
    if (typeof content !== "string") {
      domAPI.appendChild(fragment, domAPI.createTextNode(String(content)));
      return fragment;
    }

    const citeRegex = /\[\[cite:(\w+)\]\]/g;
    let lastIndex = 0;
    let match;
    let idx = 1;

    while ((match = citeRegex.exec(content)) !== null) {
      // Add text before the citation
      if (match.index > lastIndex) {
        const textBefore = content.substring(lastIndex, match.index);
        domAPI.appendChild(fragment, domAPI.createTextNode(textBefore));
      }

      // Create citation element
      const citeId = match[1];
      const citeEl = domAPI.createElement('sup');
      citeEl.className = 'citation';
      citeEl.dataset.citeId = citeId;

      // Create clickable link inside sup
      const citeLink = domAPI.createElement('a');
      citeLink.href = '#';
      citeLink.className = 'citation-link';
      citeLink.textContent = `[${idx}]`;

      // Add click handler to citation
      eventHandlers.trackListener(
        citeLink,
        'click',
        safeHandler((e) => {
          e.preventDefault();
          // Emit citation click via unified event service
          eventService.emit('chat:citationClick', { citeId });
        }, 'citationClick'),
        { context: MODULE_CONTEXT }
      );

      domAPI.appendChild(citeEl, citeLink);
      domAPI.appendChild(fragment, citeEl);

      lastIndex = match.index + match[0].length;
      idx++;
    }

    // Add remaining text after last citation
    if (lastIndex < content.length) {
      const textAfter = content.substring(lastIndex);
      domAPI.appendChild(fragment, domAPI.createTextNode(textAfter));
    }

    return fragment;
  }

  /**
   * Create a complete message element with avatar, content, and actions
   */
  function createMessageElement(message, sender, timestamp = Date.now(), messageId = null) {
    const context = `${MODULE_CONTEXT}::createMessageElement`;
    try {
      const isUser = sender === 'user';

      // Create message container
      const messageEl = domAPI.createElement('div');
      messageEl.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
      if (messageId) {
        messageEl.dataset.messageId = messageId;
      }

      // Create avatar
      const avatarEl = domAPI.createElement('div');
      avatarEl.className = 'message-avatar';

      // Set avatar content based on sender
      const avatarSvg = isUser
        ? '<svg class="w-8 h-8 text-primary" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path></svg>'
        : '<svg class="w-8 h-8 text-secondary" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path><path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path></svg>';
      domAPI.setInnerHTML(avatarEl, sanitizer.sanitize(avatarSvg));

      // Create message content container
      const contentEl = domAPI.createElement('div');
      contentEl.className = 'message-content';

      // Create message bubble
      const bubbleEl = domAPI.createElement('div');
      bubbleEl.className = 'message-bubble';

      // Process and set message content
      if (!isUser && typeof message === "string") {
        // Use DOM building function for AI content with citations
        const processedContentFragment = renderCitationsAsDOM(message);
        domAPI.appendChild(bubbleEl, processedContentFragment);
      } else {
        // For user messages or non-string content, sanitize and set as text
        const safeText = sanitizer.sanitize(String(message));
        domAPI.setInnerHTML(bubbleEl, safeText);
      }

      // Create message footer with timestamp
      const footerEl = domAPI.createElement('div');
      footerEl.className = 'message-footer text-xs opacity-70';

      // Format timestamp
      const date = new Date(timestamp);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      domAPI.setTextContent(footerEl, timeStr);

      // Add copy button for AI messages
      if (!isUser) {
        const actionsEl = domAPI.createElement('div');
        actionsEl.className = 'message-actions';

        const copyBtn = domAPI.createElement('button');
        copyBtn.className = 'btn btn-ghost btn-xs';
        copyBtn.setAttribute('aria-label', 'Copy message');
        const copySvg = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>';
        domAPI.setInnerHTML(copyBtn, sanitizer.sanitize(copySvg));

        // Add click handler to copy button - emit event for external handling
        eventHandlers.trackListener(
          copyBtn,
          'click',
          safeHandler(() => {
            // Emit copy request event instead of direct clipboard access
            eventService.emit('chat:messageCopyRequest', { message, messageId });
          }, 'copyMessage'),
          { context: MODULE_CONTEXT }
        );

        domAPI.appendChild(actionsEl, copyBtn);
        domAPI.appendChild(contentEl, actionsEl);
      }

      // Assemble message element
      domAPI.appendChild(contentEl, bubbleEl);
      domAPI.appendChild(contentEl, footerEl);
      domAPI.appendChild(messageEl, avatarEl);
      domAPI.appendChild(messageEl, contentEl);

      return messageEl;
    } catch (err) {
      logger.error(`[${MODULE_CONTEXT}] Error creating message element`, err, {
        context,
        sender,
        messageId: messageId || 'N/A'
      });
      return null;
    }
  }

  /**
   * Show typing indicator in the message container
   */
  function showTypingIndicator() {
    if (state.typingIndicatorVisible || !state.messageContainer) return;

    try {
      // Create typing indicator element
      state.typingIndicatorEl = domAPI.createElement('div');
      state.typingIndicatorEl.className = 'message ai-message typing-indicator';
      state.typingIndicatorEl.id = 'typingIndicator';

      // Create avatar
      const avatarEl = domAPI.createElement('div');
      avatarEl.className = 'message-avatar';
      const avatarSvg = '<svg class="w-8 h-8 text-secondary" fill="currentColor" viewBox="0 0 20 20"><path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path><path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path></svg>';
      domAPI.setInnerHTML(avatarEl, sanitizer.sanitize(avatarSvg));

      // Create content container
      const contentEl = domAPI.createElement('div');
      contentEl.className = 'message-content';

      // Create bubble with dots
      const bubbleEl = domAPI.createElement('div');
      bubbleEl.className = 'message-bubble';
      
      const dotsEl = domAPI.createElement('div');
      dotsEl.className = 'typing-dots';
      for (let i = 0; i < 3; i++) {
        const dot = domAPI.createElement('span');
        dot.className = 'typing-dot';
        domAPI.appendChild(dotsEl, dot);
      }
      
      domAPI.appendChild(bubbleEl, dotsEl);
      domAPI.appendChild(contentEl, bubbleEl);
      domAPI.appendChild(state.typingIndicatorEl, avatarEl);
      domAPI.appendChild(state.typingIndicatorEl, contentEl);

      // Add to container
      domAPI.appendChild(state.messageContainer, state.typingIndicatorEl);
      state.typingIndicatorVisible = true;

      // Scroll to bottom
      scrollToBottom();

      logger.debug('[ChatUIController] Typing indicator shown', { context: MODULE_CONTEXT });
    } catch (err) {
      logger.error('[ChatUIController] Error showing typing indicator', err, { context: MODULE_CONTEXT });
    }
  }

  /**
   * Hide typing indicator from the message container
   */
  function hideTypingIndicator() {
    if (!state.typingIndicatorVisible || !state.typingIndicatorEl) return;

    try {
      if (state.typingIndicatorEl.parentNode) {
        state.typingIndicatorEl.parentNode.removeChild(state.typingIndicatorEl);
      }
      state.typingIndicatorEl = null;
      state.typingIndicatorVisible = false;

      logger.debug('[ChatUIController] Typing indicator hidden', { context: MODULE_CONTEXT });
    } catch (err) {
      logger.error('[ChatUIController] Error hiding typing indicator', err, { context: MODULE_CONTEXT });
    }
  }

  /**
   * Append a message element to the message container
   */
  function appendMessage(messageEl) {
    if (!state.messageContainer || !messageEl) return;
    domAPI.appendChild(state.messageContainer, messageEl);
    scrollToBottom();
  }

  /**
   * Clear all conversation list DOM elements
   */
  function clearConversationList() {
    const conversationList = domAPI.querySelector('.conversation-list');
    if (conversationList) {
      domAPI.replaceChildren(conversationList);
      logger.debug('[ChatUIController] Conversation list cleared', { context: MODULE_CONTEXT });
    }
  }

  /**
   * Scroll message container to bottom smoothly
   */
  function scrollToBottom() {
    if (!state.messageContainer) return;
    
    try {
      state.messageContainer.scrollTo({
        top: state.messageContainer.scrollHeight,
        behavior: 'smooth'
      });
    } catch (err) {
      logger.error('Smooth scroll failed, using fallback', err, { context: 'ChatUIController:scrollToBottom' });
      // Fallback for older browsers
      state.messageContainer.scrollTop = state.messageContainer.scrollHeight;
    }
  }

  /**
   * Attach event handlers to chat UI elements
   */
  function attachEventHandlers({
    inputField,
    sendButton,
    messageContainer,
    onSend
  }) {
    const context = `${MODULE_CONTEXT}::attachEventHandlers`;

    if (!inputField || !sendButton || !messageContainer) {
      logger.error(`[${MODULE_CONTEXT}] Missing required elements for attaching event handlers`, {
        context,
        hasInputField: !!inputField,
        hasSendButton: !!sendButton,
        hasMessageContainer: !!messageContainer
      });
      return;
    }

    // Set the active message container
    setMessageContainer(messageContainer);

    // Enhanced submit on Enter (no Shift)
    if (inputField && typeof onSend === 'function') {
      eventHandlers.trackListener(
        inputField,
        'keydown',
        safeHandler((event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend(domAPI.getValue(inputField)); // Use domAPI wrapper for value
          }
        }, 'inputKeydownAttach'),
        {
          context: MODULE_CONTEXT,
          description: 'Enhanced chat input handler on keydown'
        }
      );
    }

    // Send button click handler
    if (sendButton && typeof onSend === 'function') {
      eventHandlers.trackListener(
        sendButton,
        'click',
        safeHandler(() => {
          onSend(inputField ? domAPI.getValue(inputField) : ''); // Use domAPI wrapper for value
        }, 'sendButtonClickAttach'),
        {
          context: MODULE_CONTEXT,
          description: 'Send button click handler'
        }
      );
    }

    // Live token estimation (debounced)
    if (inputField && typeof messageHandler.estimateTokens === 'function') {
      let debounceTimer = null;

      eventHandlers.trackListener(
        inputField,
        'input',
        safeHandler(() => {
          if (debounceTimer) {
            if (typeof browserService.clearTimeout === 'function') {
              browserService.clearTimeout(debounceTimer);
            } else if (typeof browserService.clearInterval === 'function') {
              // fallback if clearTimeout not exposed separately
              browserService.clearInterval(debounceTimer);
            }
          }

          debounceTimer = browserService.setTimeout(async () => {
            try {
              const text = domAPI.getValue(inputField);
              if (!text || !text.trim()) {
                tokenStatsManager?.setInputTokenCount?.(0);
                return;
              }

              const tokens = await messageHandler.estimateTokens(text);
              tokenStatsManager?.setInputTokenCount?.(tokens);
            } catch (err) {
              logger.warn('[ChatUIController] live token estimation failed', err, { context: MODULE_CONTEXT });
              tokenStatsManager?.setInputTokenCount?.(0);
            }
          }, 400);
        }, 'liveTokenEstimateInput'),
        { context: MODULE_CONTEXT, description: 'liveTokenEstimateInput' }
      );
    }

    logger.info(`[${MODULE_CONTEXT}] Event handlers attached to chat UI elements`, {
      context
    });
  }

  return {
    // Core UI methods
    attachUI,
    detachUI,
    updateInputState,
    
    // Message container management
    setMessageContainer,
    appendMessage,
    clearConversationList,
    
    // Message rendering
    createMessageElement,
    renderCitationsAsDOM,
    
    // UI state management
    showTypingIndicator,
    hideTypingIndicator,
    scrollToBottom,
    
    // Event handling
    attachEventHandlers,
    
    // Cleanup
    cleanup() {
      detachUI();
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  };
}

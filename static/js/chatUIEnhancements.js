/**
 * chatUIEnhancements.js
 *
 * Guardrails-compliant factory export exclusively. No top-level logic or direct DOM/global access.
 * All dependencies (including domReadinessService, logger) injected via DI; no side effects at import time.
 *
 * Provides UI gating helpers for safe DOM event binding (esp. chat UI) per project/timing.
 */

export function createChatUIEnhancements(deps = {}) {
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION (No fallback, throw immediately, BEFORE destructuring) ===
  if (!deps) throw new Error('Missing deps');
  if (!deps.domAPI) throw new Error('Missing domAPI');
  if (!deps.eventHandlers) throw new Error('Missing eventHandlers');
  if (!deps.browserService) throw new Error('Missing browserService');
  if (!deps.domReadinessService) throw new Error('Missing domReadinessService');
  if (!deps.logger) throw new Error('Missing logger');
  if (!deps.sanitizer) throw new Error('Missing sanitizer');
  if (!deps.DependencySystem) throw new Error('Missing DependencySystem');
  // chatManager and modalManager are optional

  const { domAPI, eventHandlers, browserService, domReadinessService, logger, sanitizer, chatManager, modalManager, DependencySystem } = deps;

  const MODULE_CONTEXT = 'chatUIEnhancements';

  const state = {
    initialized: false,
    initializing: null,
    typingIndicatorVisible: false,
    messageContainer: null // ← cache current chat container
  };

  // Use canonical safeHandler from DI
  const safeHandler = DependencySystem.modules.get('safeHandler');

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
      logger.error(`[${MODULE_CONTEXT}] Invalid domSelectors param for whenChatUIReady`, {
        context
      });
      throw new Error(`[${MODULE_CONTEXT}] Must provide one or more selectors to whenChatUIReady`);
    }
    try {
      await domReadinessService.dependenciesAndElements({
        domSelectors,
        timeout,
        context
      });
      // Optionally validate post-gating presence (defensive)
      const doc = domAPI.getDocument();
      if (doc) {
        for (const sel of domSelectors) {
          if (!domAPI.querySelector(sel)) {
            logger.error(`[${MODULE_CONTEXT}] Selector ${sel} still missing after readiness wait`, {
              context
            });
            throw new Error(`[${MODULE_CONTEXT}] DOM selector missing after gating: ${sel}`);
          }
        }
      }
      logger.info(`[${MODULE_CONTEXT}] DOM readiness achieved for selectors`, {
        context,
        domSelectors
      });
    } catch (err) {
      logger.error(`[${MODULE_CONTEXT}] DOM readiness failed for selectors: ${domSelectors.join(', ')}`, err, {
        context
      });
      throw err;
    }
  }

  /**
   * Initialize chat UI enhancements. Waits for required DOM elements.
   * Attaches event listeners to the default chat UI selectors if found.
   *
   * @param {Object} options - Initialization options (currently unused).
   * @returns {Promise<void>} A promise that resolves when initialization is complete or fails.
   */
  function initialize(options = {}) {
    if (state.initialized) return Promise.resolve();
    if (state.initializing) return state.initializing;

    // Project-only selectors for chat UI
    const CHAT_SELECTORS = [
      '#chatInput',
      '#chatMessages',
      '#chatSendBtn'
    ];
    const context = `${MODULE_CONTEXT}::initialize`;

    state.initializing = (async () => {
      try {
        await whenChatUIReady({
          domSelectors: CHAT_SELECTORS,
          context
        });
      } catch (err) {
        logger.error('[chatUIEnhancements] Error during chat UI initialization', err, {
          context
        });
        logger.warn('[chatUIEnhancements] Chat UI not yet in DOM – will retry later', err, {
          context
        });
        state.initializing = null;
        return; // allow another “initialize()” call later
      }

      const chatInput = domAPI.getElementById('chatInput');
      const sendBtn = domAPI.getElementById('chatSendBtn');
      const chatContainer = domAPI.getElementById('chatMessages');
      const doc = domAPI.getDocument();

      // Cache default container
      state.messageContainer = chatContainer;

      // Add event listeners to default UI
      if (chatInput) {
        eventHandlers.trackListener(
          chatInput,
          'keypress',
          safeHandler(handleInputKeypress, 'inputKeypress'),
          {
            context: MODULE_CONTEXT,
            description: 'Chat input keypress handler'
          }
        );
      }

      // Add message event listener (listens on document for custom events)
      if (doc) {
        eventHandlers.trackListener(
          doc,
          'chatNewMessage',
          safeHandler(handleNewMessage, 'chatNewMessage'),
          {
            context: MODULE_CONTEXT,
            description: 'New message handler'
          }
        );
      }

      // Add click listener to default send button
      if (sendBtn) {
        eventHandlers.trackListener(
          sendBtn,
          'click',
          safeHandler(() => {
            // Assuming a global chat logic will pick up input value and handle send
            logger.info('[chatUIEnhancements] Default send button clicked', {
              context: MODULE_CONTEXT
            });
            // Note: This handler doesn't directly call a 'send' function.
            // It's expected that external logic (e.g., ChatManager)
            // listens for this click or provides a custom `onSend`
            // via `attachEventHandlers`. This is a handler for the
            // *default* send button if no custom one is provided.
          }, 'defaultSendButtonClick'),
          {
            context: MODULE_CONTEXT,
            description: 'Default send button click handler'
          }
        );
      }


      state.initialized = true;
      state.initializing = null;
      logger.info('[chatUIEnhancements] Initialization complete', {
        context
      });
    })();

    return state.initializing;
  }

  /**
   * Handle new message event. Appends message element to container.
   * @param {CustomEvent} event - The custom event containing message data in event.detail.
   *   Expected detail structure: { message: string, sender: 'user'|'ai', timestamp?: number, messageId?: string|number }
   */
  function handleNewMessage(event) {
    const context = `${MODULE_CONTEXT}::handleNewMessage`;
    if (!event.detail) {
      logger.warn(`[${MODULE_CONTEXT}] Received chatNewMessage event without detail`, {
        context
      });
      return;
    }

    const {
      message,
      sender,
      timestamp,
      messageId
    } = event.detail;
    logger.info(`[${MODULE_CONTEXT}] Processing new message event`, {
      context,
      sender,
      messageId: messageId || 'N/A'
    });

    const messageEl = createMessageElement(message, sender, timestamp, messageId);
    const chatContainer =
      state.messageContainer || domAPI.getElementById('chatMessages'); // Use cached or find default
    if (chatContainer && messageEl) {
      domAPI.appendChild(chatContainer, messageEl); // Use domAPI for append
      scrollToBottom(chatContainer);
      logger.info(`[${MODULE_CONTEXT}] Message appended to container`, {
        context,
        messageId: messageId || 'N/A'
      });
    } else {
      logger.error(`[${MODULE_CONTEXT}] Failed to find chat container or create message element`, {
        context
      });
    }
  }

  /**
   * Transforms [[cite:XYZ]] markers in AI message content into clickable superscript elements.
   * Builds DOM nodes using domAPI to avoid innerHTML for complex content.
   *
   * @param {string} content - The message content potentially containing citation markers.
   * @returns {DocumentFragment} A document fragment containing the processed message DOM structure.
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
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        domAPI.appendChild(fragment, domAPI.createTextNode(textBefore));
      }

      const citeId = match[1];
      // Sanitize the ID before embedding in data attribute
      const safeId = sanitizer.sanitize(citeId);
      const number = idx++;

      // Create the superscript element using domAPI
      const supEl = domAPI.createElement('sup');
      supEl.className = 'msg-citation';
      supEl.setAttribute('data-citation-id', safeId);
      supEl.setAttribute('tabindex', '0'); // Make it focusable
      supEl.style.cursor = 'pointer';
      supEl.style.color = '#1565c0'; // Example styling
      supEl.setAttribute('aria-label', `Citation ${number}`);
      supEl.setAttribute('title', 'View source');
      domAPI.appendChild(supEl, domAPI.createTextNode(String(number)));

      domAPI.appendChild(fragment, supEl);
      lastIndex = citeRegex.lastIndex;
    }

    // Append any remaining text after the last match
    const textAfter = content.substring(lastIndex);
    if (textAfter) {
      domAPI.appendChild(fragment, domAPI.createTextNode(textAfter));
    }

    return fragment;
  }


  /**
   * Create an enhanced message element.
   * @param {string} message - The message content.
   * @param {'user'|'ai'|string} sender - The sender ('user' or 'ai').
   * @param {number} [timestamp] - Optional message timestamp (defaults to now).
   * @param {string|number} [messageId] - Optional unique message ID (for retry).
   * @returns {HTMLElement|null} The message element or null if creation fails.
   */
  function createMessageElement(message, sender, timestamp, messageId = null) {
    const context = `${MODULE_CONTEXT}::createMessageElement`;
    const isUser = sender === 'user';
    const messageClass = isUser ? 'user-message' : 'ai-message';

    // Create message container
    const messageEl = domAPI.createElement('div');
    if (!messageEl) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create message container div`, {
        context
      });
      return null;
    }
    messageEl.className = `chat-message ${messageClass}`;
    if (messageId !== null) {
      messageEl.setAttribute('data-message-id', messageId);
    }


    // Create message bubble
    const bubbleEl = domAPI.createElement('div');
    if (!bubbleEl) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create message bubble div`, {
        context
      });
      return null;
    }
    bubbleEl.className = 'message-bubble';

    // Process and set message content
    if (!isUser && typeof message === "string") {
      // Use DOM building function for AI content with citations
      const processedContentFragment = renderCitationsAsDOM(message);
      domAPI.appendChild(bubbleEl, processedContentFragment);
    } else {
      // For user messages or non-string content, sanitize and set as text
      // Note: If user messages could contain Markdown/HTML, a similar DOM building
      // or stricter sanitization/rendering step would be needed. Assuming plain text here.
      const safeText = sanitizer.sanitize(String(message)); // Sanitize potential text content
      domAPI.appendChild(bubbleEl, domAPI.createTextNode(safeText));
    }

    // Create metadata element
    const metadataEl = domAPI.createElement('div');
    if (!metadataEl) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create message metadata div`, {
        context
      });
      return null;
    }
    metadataEl.className = 'message-metadata';

    // Format and add timestamp
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    domAPI.appendChild(metadataEl, domAPI.createTextNode(time));


    // Create message actions
    const actionsEl = domAPI.createElement('div');
    if (!actionsEl) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create message actions div`, {
        context
      });
      return null;
    }
    actionsEl.className = 'message-actions';

    // Add copy and retry button for AI messages
    if (!isUser) {
      // Copy Button
      const copyBtn = domAPI.createElement('button');
      if (copyBtn) {
        copyBtn.className = 'message-action-btn';
        copyBtn.setAttribute('aria-label', 'Copy message');
        // Build SVG via DOM API if possible, otherwise sanitize innerHTML
        // For simplicity with complex SVGs, sanitize static innerHTML here.
        const copySvg = sanitizer.sanitize(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>'
        );
        domAPI.setInnerHTML(copyBtn, copySvg); // Use domAPI wrapper for innerHTML

        eventHandlers.trackListener(
          copyBtn,
          'click',
          safeHandler(() => copyMessageToClipboard(message), 'copyMessageButtonClick'),
          {
            context: MODULE_CONTEXT,
            description: 'Copy message to clipboard handler'
          }
        );
        domAPI.appendChild(actionsEl, copyBtn);
      } else {
        logger.warn(`[${MODULE_CONTEXT}] Failed to create copy button`, {
          context
        });
      }


      // Retry Button
      const retryBtn = domAPI.createElement('button');
      if (retryBtn) {
        retryBtn.className = 'message-action-btn';
        retryBtn.setAttribute('aria-label', 'Retry message');
        // Sanitize static SVG innerHTML
        const retrySvg = sanitizer.sanitize(
          '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-7H1"/></svg>'
        );
        domAPI.setInnerHTML(retryBtn, retrySvg); // Use domAPI wrapper for innerHTML

        eventHandlers.trackListener(
          retryBtn,
          'click',
          safeHandler(async () => {
            const retryContext = `${MODULE_CONTEXT}::retryMessageClick`;
            try {
              if (chatManager && typeof chatManager.retryMessage === "function") {
                if (messageId === null || messageId === undefined) {
                  logger.warn(`[${MODULE_CONTEXT}] Retry button clicked for message without ID`, {
                    context: retryContext
                  });
                } else {
                  await chatManager.retryMessage(messageId);
                  logger.info(`[${MODULE_CONTEXT}] Retry message requested`, {
                    context: retryContext,
                    messageId
                  });
                }
              } else {
                logger.error(`[${MODULE_CONTEXT}] chatManager.retryMessage missing or not DI-ed`, {
                  context: retryContext,
                  messageId
                });
              }
            } catch (err) {
              logger.error(`[${MODULE_CONTEXT}] Retry message error`, err, {
                context: retryContext,
                messageId
              });
            }
          }, 'retryMessageButtonClick'),
          {
            context: MODULE_CONTEXT,
            description: 'Retry message handler'
          }
        );
        domAPI.appendChild(actionsEl, retryBtn);
      } else {
        logger.warn(`[${MODULE_CONTEXT}] Failed to create retry button`, {
          context
        });
      }
    }

    // Assemble the message element
    domAPI.appendChild(messageEl, bubbleEl);
    domAPI.appendChild(messageEl, metadataEl);
    domAPI.appendChild(messageEl, actionsEl);

    logger.info(`[${MODULE_CONTEXT}] Message element created`, {
      context,
      sender,
      messageId: messageId || 'N/A'
    });

    return messageEl;
  }

  /**
   * Copy message content to clipboard. Strips HTML from AI messages before copying.
   * @param {string} message - The message content to copy.
   */
  function copyMessageToClipboard(message) {
    const context = `${MODULE_CONTEXT}::copyMessageToClipboard`;
    // Strip HTML tags for plain text copy, using sanitizer for safety first
    const sanitizedMessage = sanitizer.sanitize(String(message));
    const tempEl = domAPI.createElement('div');
    // Set sanitized HTML, then get textContent which is plain text
    domAPI.setInnerHTML(tempEl, sanitizedMessage); // Use domAPI wrapper for innerHTML
    const textContent = domAPI.getTextContent(tempEl); // Use domAPI wrapper for textContent


    const doc = domAPI.getDocument();

    // Use clipboard API if available (DI-safe via browserService)
    const clip = browserService.getWindow()?.navigator?.clipboard;
    if (clip?.writeText) {
      clip.writeText(textContent)
        .then(() => {
          logger.info(`[${MODULE_CONTEXT}] Text copied via clipboard API`, {
            context
          });
          showCopyFeedback(true);
        })
        .catch(err => {
          logger.error(`[${MODULE_CONTEXT}] Failed to copy text via clipboard API`, err, {
            context
          });
          showCopyFeedback(false);
        });
    } else {
      // Fallback method using textarea
      logger.warn(`[${MODULE_CONTEXT}] Clipboard API not available, using fallback copy method`, {
        context
      });
      const textarea = domAPI.createElement('textarea');
      if (!textarea) {
        logger.error(`[${MODULE_CONTEXT}] Failed to create textarea for fallback copy`, {
          context
        });
        showCopyFeedback(false);
        return;
      }
      domAPI.setValue(textarea, textContent); // Use domAPI wrapper for value
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      domAPI.appendChild(doc.body, textarea);

      try {
        domAPI.selectElement(textarea); // Use domAPI wrapper for select
        const successful = domAPI.callMethod(doc, 'execCommand', 'copy');
        if (!successful) {
          logger.error(`[${MODULE_CONTEXT}] doc.execCommand('copy') failed`, {
            context
          });
        } else {
          logger.info(`[${MODULE_CONTEXT}] Text copied via fallback execCommand`, {
            context
          });
        }
        showCopyFeedback(successful);
      } catch (err) {
        logger.error(`[${MODULE_CONTEXT}] Fallback copy method error`, err, {
          context
        });
        showCopyFeedback(false);
      } finally {
        if (textarea.parentNode) {
          domAPI.removeChild(textarea.parentNode, textarea); // Use domAPI wrapper for removeChild
        }
      }
    }
  }

  /**
   * Show feedback after copy attempt using a temporary toast element.
   * @param {boolean} success - Whether the copy was successful.
   */
  function showCopyFeedback(success) {
    const context = `${MODULE_CONTEXT}::showCopyFeedback`;
    const doc = domAPI.getDocument();

    // Remove existing toast if present
    const existing = domAPI.getElementById('chatCopyToast');
    if (existing && existing.parentNode) {
      domAPI.removeChild(existing.parentNode, existing);
    }

    // Create toast notification
    const toast = domAPI.createElement('div');
    if (!toast) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create copy feedback toast element`, {
        context
      });
      return;
    }
    domAPI.setElementId(toast, 'chatCopyToast'); // Use domAPI wrapper for ID
    domAPI.setClassName(toast, `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ${success ? 'bg-success text-success-content' : 'bg-error text-error-content'} transition-opacity duration-300`); // Use domAPI wrapper for className
    domAPI.setTextContent(toast, success ? 'Copied to clipboard!' : 'Failed to copy text'); // Use domAPI wrapper for textContent

    // Add to document body using domAPI
    domAPI.appendChild(doc.body, toast);
    logger.info(`[${MODULE_CONTEXT}] Copy feedback toast shown (success: ${success})`, {
      context
    });

    // Remove after delay
    browserService.setTimeout(() => {
      // Use domAPI wrapper for style
      domAPI.setStyle(toast, 'opacity', '0');
      browserService.setTimeout(() => {
        if (toast.parentNode) {
          domAPI.removeChild(toast.parentNode, toast); // Use domAPI wrapper for removeChild
          logger.info(`[${MODULE_CONTEXT}] Copy feedback toast removed`, {
            context
          });
        }
      }, 300); // Fade out duration
    }, 2000); // Display duration
  }

  /**
   * Handle keypress in the chat input field.
   * Submits on Enter (without Shift).
   * @param {KeyboardEvent} event - The keypress event.
   */
  function handleInputKeypress(event) {
    const context = `${MODULE_CONTEXT}::handleInputKeypress`;
    // Submit on Enter (without Shift)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent default form submission or newline
      const sendBtn = domAPI.getElementById('chatSendBtn'); // Use domAPI
      if (sendBtn) {
        // Trigger click on the send button. Assumes another handler (like in attachEventHandlers or external)
        // is listening to this click event to perform the actual message sending.
        sendBtn.click();
        logger.info(`[${MODULE_CONTEXT}] Enter key pressed in input, simulating send button click`, {
          context
        });
      } else {
        logger.warn(`[${MODULE_CONTEXT}] Enter key pressed but send button not found`, {
          context
        });
      }
    }
  }

  /**
   * Show typing indicator in the chat container.
   */
  function showTypingIndicator() {
    const context = `${MODULE_CONTEXT}::showTypingIndicator`;
    if (state.typingIndicatorVisible) {
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator already visible`, {
        context
      });
      return;
    }

    const chatContainer =
      state.messageContainer || domAPI.getElementById('chatMessages');
    if (!chatContainer) {
      logger.warn(`[${MODULE_CONTEXT}] Chat container not found for typing indicator`, {
        context
      });
      return;
    }

    // Create indicator element using domAPI
    const indicatorEl = domAPI.createElement('div');
    if (!indicatorEl) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create typing indicator element`, {
        context
      });
      return;
    }
    domAPI.setElementId(indicatorEl, 'typingIndicator');
    domAPI.setClassName(indicatorEl, 'chat-message ai-message');

    // Create typing dots container using domAPI
    const indicatorContent = domAPI.createElement('div');
    if (!indicatorContent) {
      logger.error(`[${MODULE_CONTEXT}] Failed to create typing indicator content element`, {
        context
      });
      // Clean up partially created element if any
      if (indicatorEl && indicatorEl.parentNode) {
        domAPI.removeChild(indicatorEl.parentNode, indicatorEl);
      }
      return;
    }
    domAPI.setClassName(indicatorContent, 'typing-indicator');

    // Create individual span dots using domAPI instead of innerHTML
    for (let i = 0; i < 3; i++) {
      const span = domAPI.createElement('span');
      domAPI.appendChild(indicatorContent, span);
    }

    domAPI.appendChild(indicatorEl, indicatorContent);
    domAPI.appendChild(chatContainer, indicatorEl); // Use domAPI for append
    scrollToBottom(chatContainer);

    state.typingIndicatorVisible = true;
    logger.info(`[${MODULE_CONTEXT}] Typing indicator shown`, {
      context
    });
  }

  /**
   * Hide typing indicator if currently visible.
   */
  function hideTypingIndicator() {
    const context = `${MODULE_CONTEXT}::hideTypingIndicator`;
    if (!state.typingIndicatorVisible) {
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator already hidden`, {
        context
      });
      return;
    }

    const chatContainer =
      state.messageContainer || domAPI.getElementById('chatMessages');
    // Find the indicator element using querySelector on the container
    const indicator =
      domAPI.querySelector(chatContainer, '#typingIndicator');
    if (indicator && indicator.parentNode) {
      domAPI.removeChild(indicator.parentNode, indicator); // Use domAPI for removeChild
      logger.info(`[${MODULE_CONTEXT}] Typing indicator hidden`, {
        context
      });
    } else {
      logger.warn(`[${MODULE_CONTEXT}] Typing indicator element not found to hide`, {
        context
      });
    }

    state.typingIndicatorVisible = false;
  }

  /**
   * Scroll chat container to bottom using scrollTop.
   * @param {HTMLElement} container - The chat container element.
   */
  function scrollToBottom(container) {
    if (!container) return;
    // Direct DOM property access for performance and standard behavior
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Clean up all resources, primarily event listeners tracked by eventHandlers.
   */
  function cleanup() {
    const context = `${MODULE_CONTEXT}::cleanup`;
    if (eventHandlers.cleanupListeners) {
      eventHandlers.cleanupListeners({
        context: MODULE_CONTEXT
      });
      logger.info(`[${MODULE_CONTEXT}] Event listeners cleaned up`, {
        context
      });
    }
    hideTypingIndicator(); // Ensure indicator is removed on cleanup
    state.initialized = false;
    state.initializing = null;
    state.typingIndicatorVisible = false;
    state.messageContainer = null; // Clear cached container on cleanup
    logger.info(`[${MODULE_CONTEXT}] Module state reset`, {
      context
    });
  }

  /**
   * Attach or re-attach enhanced event handlers to specific chat UI elements.
   * This is useful when the chat UI might be dynamically replaced (e.g., in modals).
   * Cleans up previous listeners for this module's context before adding new ones.
   *
   * @param {Object} params - DOM handles and callbacks.
   *   @param {HTMLElement} params.inputField - The chat input element.
   *   @param {HTMLElement} params.sendButton - The send button element.
   *   @param {HTMLElement} [params.messageContainer] - Optional message container element to cache.
   *   @param {Function} params.onSend - Callback function when a message should be sent (triggered by Enter key or Send button click). Receives the input value.
   */
  function attachEventHandlers({
    inputField,
    sendButton,
    messageContainer,
    onSend
  }) {
    const context = `${MODULE_CONTEXT}::attachEventHandlers`;
    logger.info(`[${MODULE_CONTEXT}] Attaching enhanced event handlers`, {
      context
    });

    /* ‼️ Prevent listener duplication when ChatManager re-binds to a new pane */
    eventHandlers.cleanupListeners({
      context: MODULE_CONTEXT
    });
    logger.debug(`[${MODULE_CONTEXT}] Cleaned up previous listeners for re-attachment`, {
      context
    });

    hideTypingIndicator(); // remove orphan indicator from old pane if any

    /* remember the active container so showTypingIndicator/… work for both
       the global chat and the per-project chat inside Project Details */
    state.messageContainer = messageContainer || null; // Cache the provided container
    state.typingIndicatorVisible = false; // reset state for new pane

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
      logger.debug(`[${MODULE_CONTEXT}] Keydown listener attached to inputField`, {
        context
      });
    } else {
      logger.warn(`[${MODULE_CONTEXT}] Input field or onSend callback missing, skipping keydown listener attachment`, {
        context
      });
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
      logger.debug(`[${MODULE_CONTEXT}] Click listener attached to sendButton`, {
        context
      });
    } else {
      logger.warn(`[${MODULE_CONTEXT}] Send button or onSend callback missing, skipping click listener attachment`, {
        context
      });
    }
    // Could add enhanced copy, emoji menu, etc.
  }

  /**
   * Show a DI-guarded confirmation modal before deleting a conversation.
   * Requires `modalManager` dependency.
   * @param {string} conversationTitle - The title of the conversation to show in the modal.
   * @returns {Promise<boolean>} Resolves true if user confirms, false otherwise.
   */
  async function confirmDeleteConversationModal(conversationTitle) {
    const context = `${MODULE_CONTEXT}::confirmDeleteConversationModal`;
    if (!modalManager?.showModal || !modalManager?.closeModal) {
      logger.error(`[${MODULE_CONTEXT}] modalManager dependency missing or incomplete`, {
        context
      });
      return false;
    }

    return new Promise((resolve) => {
      // Sanitize user-provided conversation title before embedding
      const safeTitle = conversationTitle ? sanitizer.sanitize(conversationTitle) : "this conversation";
      // Sanitize the entire message string containing static text and sanitized title
      const msg = sanitizer.sanitize(
        `Are you sure you want to delete <strong>${safeTitle}</strong>? This action cannot be undone.`
      );
      const confirmBtnId = "confirmDeleteBtn_" + Math.random().toString(36).slice(2, 10);
      const cancelBtnId = "cancelDeleteBtn_" + Math.random().toString(36).slice(2, 10);

      // Sanitize the entire modal HTML string before passing it to showModal
      const modalHtml = sanitizer.sanitize(`
        <div class="p-4">
          <div class="text-lg font-bold mb-2 text-error">Delete Conversation</div>
          <div class="mb-4">${msg}</div>
          <div class="flex flex-row-reverse gap-2">
            <button class="btn btn-error btn-sm" id="${confirmBtnId}">Delete</button>
            <button class="btn btn-outline btn-sm" id="${cancelBtnId}">Cancel</button>
          </div>
        </div>
      `);

      // showModal safely mounts a modal and returns its DOM for wiring
      const modalEl = modalManager.showModal({
        content: modalHtml,
        closeOnBackdrop: false, // User must click a button
        width: 390,
        context: MODULE_CONTEXT // Context for modal manager's tracking
      });

      if (!modalEl) {
        logger.error(`[${MODULE_CONTEXT}] modalManager.showModal returned null`, {
          context
        });
        resolve(false); // Cannot show modal, treat as cancel
        return;
      }

      const modalContext = `confirmDeleteModal:${confirmBtnId}`; // Specific context for modal listeners

      function handleClose(confirmed) {
        // Use domAPI wrapper for checking parentNode and removing
        if (modalEl && domAPI.getParentNode(modalEl)) {
          modalManager.closeModal(modalEl);
          logger.info(`[${MODULE_CONTEXT}] Modal closed`, {
            context: modalContext,
            confirmed
          });
        } else {
          logger.warn(`[${MODULE_CONTEXT}] Modal element not found or already removed during close`, {
            context: modalContext
          });
        }

        if (confirmed) {
          logger.info(`[${MODULE_CONTEXT}] User confirmed conversation delete`, {
            context: modalContext
          });
        } else {
          logger.info(`[${MODULE_CONTEXT}] User canceled conversation delete`, {
            context: modalContext
          }); // Use info for cancel, not warn
        }
        // Cleanup listeners specifically for this modal instance
        eventHandlers.cleanupListeners({
          context: modalContext
        });
        resolve(!!confirmed);
      }

      // Hook buttons via DI event handler, always with context
      const doc = domAPI.getDocument();
      const confirmBtn = domAPI.getElementById(confirmBtnId);
      const cancelBtn = domAPI.getElementById(cancelBtnId);

      if (confirmBtn) {
        eventHandlers.trackListener(
          confirmBtn,
          "click",
          safeHandler(() => handleClose(true), 'confirmDeleteClick'), // Wrap handler
          {
            context: modalContext,
            description: "Confirm Delete Conversation Button"
          }
        );
        logger.debug(`[${MODULE_CONTEXT}] Confirm button listener attached`, {
          context: modalContext
        });
      } else {
        logger.error(`[${MODULE_CONTEXT}] Confirm button with ID ${confirmBtnId} not found in modal`, {
          context: modalContext
        });
      }

      if (cancelBtn) {
        eventHandlers.trackListener(
          cancelBtn,
          "click",
          safeHandler(() => handleClose(false), 'cancelDeleteClick'), // Wrap handler
          {
            context: modalContext,
            description: "Cancel Delete Conversation Button"
          }
        );
        logger.debug(`[${MODULE_CONTEXT}] Cancel button listener attached`, {
          context: modalContext
        });
      } else {
        logger.error(`[${MODULE_CONTEXT}] Cancel button with ID ${cancelBtnId} not found in modal`, {
          context: modalContext
        });
      }
    });
  }

  // Public API
  return {
    initialize,
    showTypingIndicator,
    hideTypingIndicator,
    cleanup,
    createMessageElement,
    attachEventHandlers,
    confirmDeleteConversationModal,
    renderCitationsAsDOM // Exporting the DOM-building function, not string renderer
  };
}

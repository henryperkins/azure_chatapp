/**
 * chatUIEnhancements.js
 *
 * Guardrails-compliant factory export exclusively. No top-level logic or direct DOM/global access.
 * All dependencies (including domReadinessService, logger) injected via DI; no side effects at import time.
 *
 * Provides comprehensive UI management for chat interface:
 * - Message rendering and display
 * - Input handling and submission
 * - Typing indicators
 * - UI state management (empty states, loading)
 * - Mobile-specific enhancements
 * - Project-specific chat integration
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
    messageContainer: null, // ← cache current chat container
    activeTab: null,        // Track active tab for project context
    projectId: null,        // Store current project ID
    isMobile: browserService?.isMobile || false
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
      return Promise.reject(new Error('Invalid domSelectors'));
    }

    try {
      await domReadinessService.elementsReady(domSelectors, {
        timeout,
        context,
        observeMutations: true
      });
      logger.debug(`[${MODULE_CONTEXT}] Chat UI elements ready`, {
        context,
        selectors: domSelectors
      });
      return Promise.resolve();
    } catch (err) {
      logger.error(`[${MODULE_CONTEXT}] Chat UI elements not ready within timeout`, err, {
        context,
        timeout,
        selectors: domSelectors
      });
      return Promise.reject(err);
    }
  }

  /**
   * Initialize chat UI enhancements. Waits for required DOM elements.
   * Attaches event listeners to the default chat UI selectors if found.
   *
   * @param {Object} options - Initialization options
   * @param {string} [options.projectId] - Optional project ID for project-specific chat
   * @returns {Promise<void>} A promise that resolves when initialization is complete or fails.
   */
  function initialize(options = {}) {
    if (state.initialized) return Promise.resolve();
    if (state.initializing) return state.initializing;

    // Store project ID if provided
    if (options.projectId) {
      state.projectId = options.projectId;
    }

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
        return; // allow another "initialize()" call later
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

      // Setup chat header collapse functionality
      setupChatHeaderCollapse();

      // Setup mobile-specific enhancements
      if (state.isMobile) {
        setupMobileEnhancements();
      }

      // Setup project-specific enhancements if in project context
      if (state.projectId) {
        setupProjectChatEnhancements();
      }

      state.initialized = true;
      state.initializing = null;

      logger.info(`[${MODULE_CONTEXT}] Chat UI enhancements initialized`, {
        context,
        projectId: state.projectId || 'global'
      });

      return Promise.resolve();
    })();

    return state.initializing;
  }

  /**
   * Setup collapsible chat header functionality
   */
  function setupChatHeaderCollapse() {
    const chatHeader = domAPI.getElementById('chatHeader');
    const chatMetadata = domAPI.getElementById('chatMetadata');

    if (!chatHeader || !chatMetadata) return;

    eventHandlers.trackListener(
      chatHeader,
      'click',
      safeHandler(() => {
        const isExpanded = chatHeader.getAttribute('aria-expanded') === 'true';
        const newState = !isExpanded;

        chatHeader.setAttribute('aria-expanded', newState ? 'true' : 'false');
        chatMetadata.style.display = newState ? 'flex' : 'none';

        // Rotate chevron
        const indicator = chatHeader.querySelector('.expandable-indicator');
        if (indicator) {
          indicator.style.transform = newState ? 'rotate(0deg)' : 'rotate(-90deg)';
        }
      }, 'chatHeaderToggle'),
      {
        context: MODULE_CONTEXT,
        description: 'Chat header collapse toggle'
      }
    );
  }

  /**
   * Setup mobile-specific enhancements for chat UI
   */
  function setupMobileEnhancements() {
    // Improve touch targets
    domAPI.querySelectorAll('#chatHeader button, #chatInput, #chatSendBtn').forEach(el => {
      if (el.tagName === 'BUTTON' && !el.classList.contains('btn-lg')) {
        el.style.minHeight = '44px'; // Ensure minimum touch target size
      }
    });

    // Improve keyboard experience for input
    const chatInput = domAPI.getElementById('chatInput');
    if (chatInput) {
      // Prevent iOS zoom by ensuring font size is at least 16px
      chatInput.style.fontSize = '16px';

      // Add proper mobile keyboard support
      chatInput.setAttribute('inputmode', 'text');
      chatInput.setAttribute('enterkeyhint', 'send');
    }

    // Setup pull-to-refresh for chat messages
    setupPullToRefresh();
  }

  /**
   * Setup pull-to-refresh functionality for chat messages
   */
  function setupPullToRefresh() {
    try {
      const chatMessages = domAPI.getElementById('chatMessages');
      if (!chatMessages) return;

      let startY = 0;
      let isPulling = false;
      let refreshTriggered = false;

      // Create pull indicator if it doesn't exist
      let pullIndicator = domAPI.getElementById('chatPullToRefreshIndicator');
      if (!pullIndicator) {
        pullIndicator = domAPI.createElement('div');
        pullIndicator.id = 'chatPullToRefreshIndicator';
        pullIndicator.className = 'pull-to-refresh-indicator';
        domAPI.setInnerHTML(pullIndicator, `
          <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Refreshing...</span>
        `);
        domAPI.setStyle(pullIndicator, 'position', 'absolute');
        domAPI.setStyle(pullIndicator, 'top', '0');
        domAPI.setStyle(pullIndicator, 'left', '0');
        domAPI.setStyle(pullIndicator, 'right', '0');
        domAPI.setStyle(pullIndicator, 'display', 'flex');
        domAPI.setStyle(pullIndicator, 'justify-content', 'center');
        domAPI.setStyle(pullIndicator, 'align-items', 'center');
        domAPI.setStyle(pullIndicator, 'padding', '10px');
        domAPI.setStyle(pullIndicator, 'background', 'var(--color-base-200)');
        domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
        domAPI.setStyle(pullIndicator, 'transition', 'transform 0.3s ease');
        domAPI.setStyle(pullIndicator, 'z-index', '10');

        const container = domAPI.querySelector('.chat-container');
        if (container) {
          domAPI.appendChild(container, pullIndicator);
        }
      }

      // Touch event handlers
      const onTouchStart = (e) => {
        if (chatMessages.scrollTop === 0) {
          startY = e.touches[0].clientY;
          isPulling = true;
        }
      };

      const onTouchMove = (e) => {
        if (!isPulling) return;

        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0 && diff < 100) {
          domAPI.setStyle(pullIndicator, 'transform', `translateY(${diff - 50}px)`);
          if (diff > 70 && !refreshTriggered) {
            domAPI.addClass(pullIndicator, 'visible');
          }
        }
      };

      const onTouchEnd = () => {
        if (!isPulling) return;

        const pullDistance = parseInt(pullIndicator.style.transform.replace('translateY(', '').replace('px)', '')) + 50;

        if (pullDistance > 20) {
          refreshTriggered = true;
          domAPI.setStyle(pullIndicator, 'transform', 'translateY(0)');

          // Reload conversation if in project context
          if (state.projectId && chatManager) {
            const currentConversationId = chatManager.currentConversationId;
            if (currentConversationId) {
              chatManager.loadConversation(currentConversationId)
                .finally(() => {
                  browserService.setTimeout(() => {
                    domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
                    domAPI.removeClass(pullIndicator, 'visible');
                    isPulling = false;
                    refreshTriggered = false;
                  }, 1000);
                });
            } else {
              resetPullIndicator();
            }
          } else {
            resetPullIndicator();
          }
        } else {
          // Not pulled far enough, reset
          resetPullIndicator();
        }
      };

      function resetPullIndicator() {
        domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
        domAPI.removeClass(pullIndicator, 'visible');
        isPulling = false;
        refreshTriggered = false;
      }

      // Attach event listeners
      eventHandlers.trackListener(
        chatMessages,
        'touchstart',
        onTouchStart,
        { context: MODULE_CONTEXT }
      );

      eventHandlers.trackListener(
        chatMessages,
        'touchmove',
        onTouchMove,
        { context: MODULE_CONTEXT }
      );

      eventHandlers.trackListener(
        chatMessages,
        'touchend',
        onTouchEnd,
        { context: MODULE_CONTEXT }
      );
    } catch (error) {
      logger.error('[setupPullToRefresh]', error, { context: MODULE_CONTEXT });
    }
  }

  /**
   * Setup project-specific chat enhancements
   */
  function setupProjectChatEnhancements() {
    // Setup "New Conversation" button if available
    const newConversationBtn = domAPI.getElementById('newConversationBtn');
    if (newConversationBtn && !newConversationBtn.dataset.bound) {
      eventHandlers.trackListener(
        newConversationBtn,
        'click',
        safeHandler(() => {
          if (chatManager && typeof chatManager.createNewConversation === 'function') {
            chatManager.createNewConversation()
              .catch(err => {
                logger.error('[chatUIEnhancements] Error creating new conversation', err, {
                  context: MODULE_CONTEXT
                });
              });
          }
        }, 'newConversationClick'),
        {
          context: MODULE_CONTEXT,
          description: 'New conversation button click'
        }
      );
      newConversationBtn.dataset.bound = '1';
    }

    // Setup conversation list item clicks
    setupConversationListItemClicks();
  }

  /**
   * Setup click handlers for conversation list items
   */
  function setupConversationListItemClicks() {
    const conversationsList = domAPI.getElementById('conversationsList');
    if (!conversationsList) return;

    // Use event delegation for conversation items
    eventHandlers.trackListener(
      conversationsList,
      'click',
      safeHandler((event) => {
        // Find closest conversation item
        const conversationItem = domAPI.closest(event.target, '.conversation-item');
        if (!conversationItem) return;

        // Get conversation ID
        const conversationId = domAPI.getDataAttribute(conversationItem, 'conversationId');
        if (!conversationId) return;

        // Load conversation if chatManager is available
        if (chatManager && typeof chatManager.loadConversation === 'function') {
          // Highlight active conversation
          domAPI.querySelectorAll('.conversation-item.active').forEach(item => {
            domAPI.removeClass(item, 'active');
          });
          domAPI.addClass(conversationItem, 'active');

          // Load conversation
          chatManager.loadConversation(conversationId)
            .catch(err => {
              logger.error('[chatUIEnhancements] Error loading conversation', err, {
                context: MODULE_CONTEXT,
                conversationId
              });
            });
        }
      }, 'conversationItemClick'),
      {
        context: MODULE_CONTEXT,
        description: 'Conversation item click'
      }
    );
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
          // Dispatch citation click event
          const doc = domAPI.getDocument();
          if (doc) {
            const event = new CustomEvent('citationClick', {
              detail: { citeId }
            });
            doc.dispatchEvent(event);
          }
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
   * Creates a message element for display in the chat UI.
   * @param {string} message - The message content.
   * @param {string} sender - The message sender ('user' or 'ai').
   * @param {number} [timestamp] - Optional timestamp for the message.
   * @param {string|number} [messageId] - Optional message ID.
   * @returns {HTMLElement} The created message element.
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
      if (isUser) {
        avatarEl.innerHTML = sanitizer.sanitize(`
          <svg class="w-8 h-8 text-primary" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"></path>
          </svg>
        `);
      } else {
        avatarEl.innerHTML = sanitizer.sanitize(`
          <svg class="w-8 h-8 text-secondary" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z"></path>
            <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z"></path>
          </svg>
        `);
      }

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
        copyBtn.innerHTML = sanitizer.sanitize(`
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
          </svg>
        `);

        // Add click handler to copy button
        eventHandlers.trackListener(
          copyBtn,
          'click',
          safeHandler(() => {
            copyMessageToClipboard(message);
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
      domAPI.setStyle(textarea, 'position', 'fixed');
      domAPI.setStyle(textarea, 'top', '0');
      domAPI.setStyle(textarea, 'left', '0');
      domAPI.setStyle(textarea, 'width', '2em');
      domAPI.setStyle(textarea, 'height', '2em');
      domAPI.setStyle(textarea, 'padding', '0');
      domAPI.setStyle(textarea, 'border', 'none');
      domAPI.setStyle(textarea, 'outline', 'none');
      domAPI.setStyle(textarea, 'boxShadow', 'none');
      domAPI.setStyle(textarea, 'background', 'transparent');
      domAPI.setValue(textarea, textContent);

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
   * Show feedback toast for copy operation
   * @param {boolean} success - Whether the copy operation was successful
   */
  function showCopyFeedback(success) {
    const context = `${MODULE_CONTEXT}::showCopyFeedback`;
    try {
      // Create toast element
      const toast = domAPI.createElement('div');
      toast.className = `copy-toast ${success ? 'success' : 'error'}`;
      toast.textContent = success ? 'Copied to clipboard!' : 'Failed to copy';

      // Style the toast
      domAPI.setStyle(toast, 'position', 'fixed');
      domAPI.setStyle(toast, 'bottom', '20px');
      domAPI.setStyle(toast, 'left', '50%');
      domAPI.setStyle(toast, 'transform', 'translateX(-50%)');
      domAPI.setStyle(toast, 'padding', '8px 16px');
      domAPI.setStyle(toast, 'background', success ? 'var(--color-success)' : 'var(--color-error)');
      domAPI.setStyle(toast, 'color', 'white');
      domAPI.setStyle(toast, 'border-radius', '4px');
      domAPI.setStyle(toast, 'z-index', '9999');
      domAPI.setStyle(toast, 'opacity', '0');
      domAPI.setStyle(toast, 'transition', 'opacity 0.3s ease');

      // Add to DOM
      const doc = domAPI.getDocument();
      domAPI.appendChild(doc.body, toast);

      // Animate in
      browserService.setTimeout(() => {
        domAPI.setStyle(toast, 'opacity', '1');
      }, 10);

      // Remove after delay
      browserService.setTimeout(() => {
        domAPI.setStyle(toast, 'opacity', '0');
        browserService.setTimeout(() => {
          if (toast.parentNode) {
            domAPI.removeChild(toast.parentNode, toast);
          }
        }, 300);
      }, 2000);
    } catch (err) {
      logger.error(`[${MODULE_CONTEXT}] Error showing copy feedback`, err, {
        context,
        success
      });
    }
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
   * Scroll a container to the bottom.
   * @param {HTMLElement} container - The container to scroll.
   */
  function scrollToBottom(container) {
    if (!container) return;

    // Use requestAnimationFrame for smooth scrolling after DOM updates
    browserService.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  /**
   * Show typing indicator in the chat UI.
   */
  function showTypingIndicator() {
    const context = `${MODULE_CONTEXT}::showTypingIndicator`;
    if (state.typingIndicatorVisible) {
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator already visible, skipping`, {
        context
      });
      return;
    }

    const container = state.messageContainer || domAPI.getElementById('chatMessages');
    if (!container) {
      logger.warn(`[${MODULE_CONTEXT}] Cannot show typing indicator, container not found`, {
        context
      });
      return;
    }

    // Create typing indicator element
    const indicatorEl = domAPI.createElement('div');
    indicatorEl.id = 'typingIndicator';
    indicatorEl.className = 'typing-indicator';

    // Create dots
    const dotsContainer = domAPI.createElement('div');
    dotsContainer.className = 'typing-dots';

    for (let i = 0; i < 3; i++) {
      const dot = domAPI.createElement('div');
      dot.className = 'typing-dot';
      domAPI.appendChild(dotsContainer, dot);
    }

    domAPI.appendChild(indicatorEl, dotsContainer);
    domAPI.appendChild(container, indicatorEl);

    scrollToBottom(container);
    state.typingIndicatorVisible = true;

    logger.debug(`[${MODULE_CONTEXT}] Typing indicator shown`, {
      context
    });
  }

  /**
   * Hide typing indicator in the chat UI.
   */
  function hideTypingIndicator() {
    const context = `${MODULE_CONTEXT}::hideTypingIndicator`;
    if (!state.typingIndicatorVisible) {
      logger.debug(`[${MODULE_CONTEXT}] No typing indicator visible, skipping`, {
        context
      });
      return;
    }

    const indicator = domAPI.getElementById('typingIndicator');
    if (indicator && indicator.parentNode) {
      domAPI.removeChild(indicator.parentNode, indicator);
      state.typingIndicatorVisible = false;
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator removed`, {
        context
      });
    } else {
      logger.warn(`[${MODULE_CONTEXT}] Cannot hide typing indicator, element not found`, {
        context
      });
      // Reset state anyway to avoid getting stuck
      state.typingIndicatorVisible = false;
    }
  }

  /**
   * Set the active message container for the chat UI.
   * This allows the module to work with different chat containers.
   * @param {HTMLElement} messageContainer - The container element for chat messages.
   */
  function setMessageContainer(messageContainer) {
    const context = `${MODULE_CONTEXT}::setMessageContainer`;

    hideTypingIndicator(); // remove orphan indicator from old pane if any

    /* remember the active container so showTypingIndicator/… work for both
       the global chat and the per-project chat inside Project Details */
    state.messageContainer = messageContainer || null; // Cache the provided container
    state.typingIndicatorVisible = false; // reset state for new pane

    logger.debug(`[${MODULE_CONTEXT}] Message container set`, {
      context,
      containerId: messageContainer?.id || 'null'
    });
  }

  /**
   * Attach event handlers to chat UI elements.
   * @param {Object} options - Options for attaching event handlers.
   * @param {HTMLElement} options.inputField - The input field element.
   * @param {HTMLElement} options.sendButton - The send button element.
   * @param {HTMLElement} options.messageContainer - The container for messages.
   * @param {Function} options.onSend - Callback function when a message is sent.
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

    logger.info(`[${MODULE_CONTEXT}] Event handlers attached to chat UI elements`, {
      context
    });
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
      const modalContext = `${MODULE_CONTEXT}:deleteConversationModal`;
      const confirmBtnId = 'confirmDeleteConversation';
      const cancelBtnId = 'cancelDeleteConversation';

      // Sanitize conversation title for display
      const safeTitle = sanitizer.sanitize(conversationTitle || 'this conversation');

      const modalContent = `
        <div class="modal-content p-6">
          <h3 class="text-lg font-bold mb-4">Delete Conversation</h3>
          <p class="mb-6">Are you sure you want to delete "${safeTitle}"? This action cannot be undone.</p>
          <div class="modal-actions flex justify-end gap-2">
            <button id="${cancelBtnId}" class="btn btn-ghost">Cancel</button>
            <button id="${confirmBtnId}" class="btn btn-error">Delete</button>
          </div>
        </div>
      `;

      // Function to handle modal close with result
      const handleClose = (confirmed) => {
        modalManager.closeModal();
        resolve(confirmed);
      };

      // Show the modal
      modalManager.showModal({
        content: modalContent,
        onClose: () => handleClose(false)
      });

      // Get buttons and attach event listeners
      const confirmBtn = domAPI.getElementById(confirmBtnId);
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

      const cancelBtn = domAPI.getElementById(cancelBtnId);
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

  /**
   * Clean up all event listeners and resources.
   */
  function cleanup() {
    const context = `${MODULE_CONTEXT}::cleanup`;
    logger.info(`[${MODULE_CONTEXT}] Cleaning up chat UI enhancements`, {
      context
    });

    // Clean up all event listeners
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });

    // Reset state
    state.initialized = false;
    state.initializing = null;
    state.typingIndicatorVisible = false;
    state.messageContainer = null;

    logger.info(`[${MODULE_CONTEXT}] Chat UI enhancements cleaned up`, {
      context
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
    renderCitationsAsDOM,
    setMessageContainer,
    setupMobileEnhancements,
    setupProjectChatEnhancements
  };
}

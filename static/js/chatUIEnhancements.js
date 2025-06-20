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

import { createDomWaitHelper } from './utils/initHelpers.js';
import { createElement } from './utils/globalUtils.js';
import { createPullToRefresh } from './utils/pullToRefresh.js';
import { getSafeHandler } from './utils/getSafeHandler.js';
import { SELECTORS } from './utils/selectorConstants.js';

export function createChatUIEnhancements(deps = {}) {
  // Validate required dependencies
  const required = ['domAPI', 'eventHandlers', 'browserService', 'domReadinessService', 'logger', 'sanitizer', 'DependencySystem', 'modalManager'];
  required.forEach(dep => { if (!deps[dep]) throw new Error(`Missing ${dep}`); });

  const { domAPI, eventHandlers, browserService, domReadinessService, logger, sanitizer, chatManager: initialChatManager, modalManager, DependencySystem, eventService = null, uiStateService = null } = deps;
  const MODULE_CONTEXT = 'chatUIEnhancements';

  if (!modalManager) throw new Error('Missing modalManager');

  // Allow chatManager to be resolved later via DependencySystem if not provided now.
  function getChatManager() {
    return initialChatManager || DependencySystem?.modules?.get?.('chatManager') || null;
  }

  // Initialize state in UIStateService instead of local object
  const STATE_COMPONENT = 'ChatUIEnhancements';
  
  function getState(key, defaultValue = null) {
    return uiStateService ? uiStateService.getState(STATE_COMPONENT, key) || defaultValue : defaultValue;
  }
  
  function setState(key, value) {
    if (uiStateService) {
      uiStateService.setState(STATE_COMPONENT, key, value);
    }
  }
  
  // Initialize default values
  if (uiStateService) {
    setState('typingIndicatorVisible', getState('typingIndicatorVisible', false));
    setState('messageContainer', getState('messageContainer', null));
    setState('activeTab', getState('activeTab', null));
    setState('projectId', getState('projectId', null));
    setState('isMobile', getState('isMobile', browserService?.isMobile || false));
  }

  // -------------------------------------------------------------------
  // Phase-2 de-duplication: delegate heavy UI helpers to ChatUIController
  // -------------------------------------------------------------------

  function _getChatController() {
    return DependencySystem?.modules?.get?.('chatUIController') || null;
  }

  // -------------------------------------------------------------------
  // Thin wrapper helpers (delegating heavy lifting to ChatUIController)
  // -------------------------------------------------------------------

  // LEGACY duplicate implementation – renamed to prevent shadowing
// Legacy heavyweight duplicate – retained for reference but no longer used.
function createMessageElement(message, sender, timestamp = Date.now(), messageId = null) {
    return _getChatController()?.createMessageElement?.(message, sender, timestamp, messageId) || null;
  }

  function scrollToBottom() {
    _getChatController()?.scrollToBottom?.();
  }

  function setMessageContainer(container) {
    _getChatController()?.setMessageContainer?.(container);
    setState('messageContainer', container); // keep state for legacy callers
  }

  function showTypingIndicator() {
    _getChatController()?.showTypingIndicator?.();
  }

  function hideTypingIndicator() {
    _getChatController()?.hideTypingIndicator?.();
  }

  function appendMessage(role, content, id = null, thinking = null, redacted = false) {
    const ctrl = _getChatController();
    if (!ctrl) return;
    const msgEl = ctrl.createMessageElement(content, role === 'user' ? 'user' : 'ai', Date.now(), id);
    ctrl.appendMessage(msgEl);
    if (role !== 'user' && (thinking || redacted)) ctrl.showTypingIndicator();
  }

  function clearConversationList() {
    _getChatController()?.clearConversationList?.();
  }

  function renderCitationsAsDOM(content) {
    return _getChatController()?.renderCitationsAsDOM?.(content) || null;
  }

  const safeHandler = getSafeHandler(DependencySystem);

  // Use utility helper for DOM waiting
  const waitForElements = createDomWaitHelper(domReadinessService, logger);

  /**
   * Initialize chat UI enhancements. Waits for required DOM elements.
   * Attaches event listeners to the default chat UI selectors if found.
   *
   * @param {Object} options - Initialization options
   * @param {string} [options.projectId] - Optional project ID for project-specific chat
   * @returns {Promise<void>} A promise that resolves when initialization is complete or fails.
   */
  // Gap #5 – Retry-capable initialize implementation (exponential back-off)
  async function initialize(options = {}) {
    const MAX_RETRIES = 4;
    const BASE_DELAY_MS = 250;
    let attempt = 0;

    const tryInit = async () => {
      attempt += 1;

      // Propagate optional projectId on every attempt so latest value is used
      if (options.projectId) setState('projectId', options.projectId);

      const CHAT_SELECTORS = [SELECTORS.chatInput, SELECTORS.chatMessages, SELECTORS.chatSendBtn];
      const context = `${MODULE_CONTEXT}::initialize_attempt_${attempt}`;

      try {
        await waitForElements({
          domSelectors: CHAT_SELECTORS,
          timeout: 8000,
          context
        });
      } catch (err) {
        logger.warn(`[chatUIEnhancements] Required elements missing – attempt ${attempt}/${MAX_RETRIES}`, err, { context });
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), 4000);
          browserService.setTimeout(tryInit, delay);
        } else {
          logger.error('[chatUIEnhancements] Initialization failed after maximum retries', err, { context });
        }
        return;
      }

      // Elements present – proceed with normal initialization
      const chatInput = domAPI.getElementById(SELECTORS.chatInput.slice(1));
      const sendBtn = domAPI.getElementById(SELECTORS.chatSendBtn.slice(1));
      const chatContainer = domAPI.getElementById(SELECTORS.chatMessages.slice(1));
      const doc = domAPI.getDocument();

      setState('messageContainer', chatContainer);

      if (doc) {
        eventHandlers.trackListener(
          doc,
          'chatNewMessage',
          safeHandler(handleNewMessage, 'chatNewMessage'),
          { context: MODULE_CONTEXT, description: 'New message handler' }
        );
      }

      setupChatHeaderCollapse();
      if (getState('isMobile')) setupMobileEnhancements();
      if (getState('projectId')) setupProjectChatEnhancements();

      logger.info(`[${MODULE_CONTEXT}] Chat UI enhancements initialized on attempt ${attempt}`,
        { context: MODULE_CONTEXT, projectId: getState('projectId') || 'global' });
    };

    // Kick off first attempt (immediately)
    await tryInit();
    return;
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
    domAPI.querySelectorAll(`#chatHeader button, ${SELECTORS.chatInput}, ${SELECTORS.chatSendBtn}`).forEach(el => {
      if (el.tagName === 'BUTTON' && !el.classList.contains('btn-lg')) {
        el.style.minHeight = '44px'; // Ensure minimum touch target size
      }
    });

    // Improve keyboard experience for input
    const chatInput = domAPI.getElementById(SELECTORS.chatInput.slice(1));
    if (chatInput) {
      // Prevent iOS zoom by ensuring font size is at least 16px
      chatInput.style.fontSize = '16px';

      // Add proper mobile keyboard support
      chatInput.setAttribute('inputmode', 'text');
      chatInput.setAttribute('enterkeyhint', 'send');
    }

    // Setup pull-to-refresh for chat messages
    createPullToRefresh({
      element        : domAPI.getElementById(SELECTORS.chatMessages.slice(1)),
      onRefresh      : () => {
        const cm = getChatManager();
        cm?.loadConversation?.(cm.currentConversationId);
      },
      eventHandlers, domAPI, browserService,
      ctx            : MODULE_CONTEXT
    });
  }


  /**
   * Setup project-specific chat enhancements
   */
  function setupProjectChatEnhancements() {
    // Setup "New Conversation" button if available
    const newConversationBtn = domAPI.getElementById(SELECTORS.newConversationBtn.slice(1));
    if (newConversationBtn && !newConversationBtn.dataset.bound) {
      eventHandlers.trackListener(
        newConversationBtn,
        'click',
        safeHandler(() => {
          const cm = getChatManager();
          if (cm?.createNewConversation) {
            cm.createNewConversation()
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
    const conversationsList = domAPI.getElementById(SELECTORS.conversationsList.slice(1));
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
        const cm = getChatManager();
        if (cm?.loadConversation) {
          // Highlight active conversation
          domAPI.querySelectorAll('.conversation-item.active').forEach(item => {
            domAPI.removeClass(item, 'active');
          });
          domAPI.addClass(conversationItem, 'active');

          // Load conversation
          cm.loadConversation(conversationId)
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

  // Handle new message event
  function handleNewMessage(event) {
    if (!event.detail) {
      logger.warn(`[${MODULE_CONTEXT}] Received chatNewMessage event without detail`, { context: MODULE_CONTEXT });
      return;
    }

    const { message, sender, timestamp, messageId } = event.detail;
    const messageEl = createMessageElement(message, sender, timestamp, messageId);
    const chatContainer = getState('messageContainer') || domAPI.getElementById(SELECTORS.chatMessages.slice(1));

    if (chatContainer && messageEl) {
      domAPI.appendChild(chatContainer, messageEl);
      scrollToBottom(chatContainer);
    } else {
      logger.error(`[${MODULE_CONTEXT}] Failed to find chat container or create message element`, { context: MODULE_CONTEXT });
    }
  }


  // NOTE: duplicate legacy implementation of renderCitationsAsDOM removed – now delegated to ChatUIController via thin wrapper above.

  /**
   * Creates a message element for display in the chat UI.
   * @param {string} message - The message content.
   * @param {string} sender - The message sender ('user' or 'ai').
   * @param {number} [timestamp] - Optional timestamp for the message.
   * @param {string|number} [messageId] - Optional message ID.
   * @returns {HTMLElement} The created message element.
   */
// Legacy heavyweight duplicate – not used anymore.
function _legacyHeavyCreateMessageElement(message, sender, timestamp = Date.now(), messageId = null) {
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
      const textareaStyles = {
        position: 'fixed', top: '0', left: '0', width: '2em', height: '2em',
        padding: '0', border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent'
      };
      Object.entries(textareaStyles).forEach(([prop, value]) => domAPI.setStyle(textarea, prop, value));
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
      const toastStyles = {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        padding: '8px 16px', background: success ? 'var(--color-success)' : 'var(--color-error)',
        color: 'white', 'border-radius': '4px', 'z-index': '9999', opacity: '0', transition: 'opacity 0.3s ease'
      };
      Object.entries(toastStyles).forEach(([prop, value]) => domAPI.setStyle(toast, prop, value));

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


  // Duplicate legacy scrollToBottom removed – ChatUIController implementation used through thin wrapper.

  /**
   * Show typing indicator in the chat UI.
   */
// LEGACY duplicate implementation – renamed to prevent shadowing
// Legacy heavyweight duplicate – not used anymore.
function _legacyShowTypingIndicatorHeavy() {
    const context = `${MODULE_CONTEXT}::showTypingIndicator`;
    if (getState('typingIndicatorVisible')) {
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator already visible, skipping`, {
        context
      });
      return;
    }

    const container = getState('messageContainer') || domAPI.getElementById(SELECTORS.chatMessages.slice(1));
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
    setState('typingIndicatorVisible', true);

    logger.debug(`[${MODULE_CONTEXT}] Typing indicator shown`, {
      context
    });
  }

  /**
   * Hide typing indicator in the chat UI.
   */
// LEGACY duplicate implementation – renamed to prevent shadowing
// Legacy heavyweight duplicate – not used anymore.
function _legacyHideTypingIndicatorHeavy() {
    const context = `${MODULE_CONTEXT}::hideTypingIndicator`;
    if (!getState('typingIndicatorVisible')) {
      logger.debug(`[${MODULE_CONTEXT}] No typing indicator visible, skipping`, {
        context
      });
      return;
    }

    const indicator = domAPI.getElementById('typingIndicator');
    if (indicator && indicator.parentNode) {
      domAPI.removeChild(indicator.parentNode, indicator);
      setState('typingIndicatorVisible', false);
      logger.debug(`[${MODULE_CONTEXT}] Typing indicator removed`, {
        context
      });
    } else {
      logger.warn(`[${MODULE_CONTEXT}] Cannot hide typing indicator, element not found`, {
        context
      });
      // Reset state anyway to avoid getting stuck
      setState('typingIndicatorVisible', false);
    }
  }

  /**
   * Set the active message container for the chat UI.
   * This allows the module to work with different chat containers.
   * @param {HTMLElement} messageContainer - The container element for chat messages.
   */
  // LEGACY duplicate implementation – renamed to prevent shadowing
  function legacySetMessageContainer(messageContainer) {
    const context = `${MODULE_CONTEXT}::setMessageContainer`;

    hideTypingIndicator(); // remove orphan indicator from old pane if any

    /* remember the active container so showTypingIndicator/… work for both
       the global chat and the per-project chat inside Project Details */
    setState('messageContainer', messageContainer || null); // Cache the provided container
    setState('typingIndicatorVisible', false); // reset state for new pane

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

    // Preferred path: use ModalManager.confirmDelete if available (wire to deleteConfirmModal)
    if (typeof modalManager?.confirmDelete === 'function') {
      return new Promise((resolve) => {
        modalManager.confirmDelete({
          title: 'Delete Conversation',
          message: `Are you sure you want to delete "${sanitizer.sanitize(conversationTitle || 'this conversation')}"? This action cannot be undone.`,
          confirmText: 'Delete',
          confirmClass: 'btn-error',
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false)
        });
      });
    }

    if (!modalManager?.showModal || !modalManager?.closeModal) {
      logger.error(`[${MODULE_CONTEXT}] modalManager dependency missing or incomplete`, { context });
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
    setState('typingIndicatorVisible', false);
    setState('messageContainer', null);

    logger.info(`[${MODULE_CONTEXT}] Chat UI enhancements cleaned up`, {
      context
    });
  }

  // NOTE: appendMessage and clearConversationList are already defined above (lines 80-90)
  // Removing duplicate definitions to fix lint errors

  // Public API
  const apiObject = {
    initialize,
    // Wrapped helpers – implemented via ChatUIController
    showTypingIndicator,
    hideTypingIndicator,
    cleanup,
    createMessageElement,
    attachEventHandlers,
    confirmDeleteConversationModal,
    renderCitationsAsDOM,
    setMessageContainer,
    setupMobileEnhancements,
    setupProjectChatEnhancements,
    appendMessage,
    clearConversationList
  };

  // Ensure wrapper helpers override any legacy implementations defined earlier.
  apiObject.createMessageElement   = createMessageElement;
  apiObject.showTypingIndicator    = showTypingIndicator;
  apiObject.hideTypingIndicator    = hideTypingIndicator;
  apiObject.setMessageContainer    = setMessageContainer;
  apiObject.appendMessage          = appendMessage;
  apiObject.clearConversationList  = clearConversationList;

  // Registration is handled by appInitializer.js to avoid duplicate DI entries.

  return apiObject;
}

export default createChatUIEnhancements;

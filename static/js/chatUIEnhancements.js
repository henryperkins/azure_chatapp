/**
 * Chat UI Enhancements
 * 
 * This module provides enhanced UI functionality for the chat interface.
 * It follows the factory pattern and dependency injection principles.
 */

export function createChatUIEnhancements({
  domAPI,
  eventHandlers,
  sanitizer,
  logger
}) {
  // Validate dependencies
  if (!domAPI) throw new Error('domAPI is required');
  if (!eventHandlers) throw new Error('eventHandlers is required');
  if (!sanitizer) throw new Error('sanitizer is required');
  if (!logger) logger = { log: console.log, error: console.error };

  // Context for event tracking
  const CONTEXT = 'chatUIEnhancements';
  
  // State
  const state = {
    initialized: false,
    typingIndicatorVisible: false
  };

  /**
   * Initialize the chat UI enhancements
   */
  function initialize() {
    if (state.initialized) return;
    
    // Load the custom CSS
    loadChatStyles();
    
    // Initialize event listeners
    initEventListeners();
    
    state.initialized = true;
    logger.log('[ChatUIEnhancements] Initialized', { context: CONTEXT });
  }

  /**
   * Load the custom CSS for chat styling
   */
  function loadChatStyles() {
    const head = domAPI.getDocument().head;
    const link = domAPI.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = '/static/css/chat-styles.css';
    head.appendChild(link);
  }

  /**
   * Initialize event listeners
   */
  function initEventListeners() {
    // Listen for new messages to apply enhanced styling
    eventHandlers.trackListener(
      domAPI.getDocument(),
      'chatMessageAdded',
      handleNewMessage,
      { context: CONTEXT, description: 'Handle new chat message' }
    );
    
    // Listen for chat input keypress
    const chatInput = domAPI.getElementById('chatUIInput');
    if (chatInput) {
      eventHandlers.trackListener(
        chatInput,
        'keypress',
        handleInputKeypress,
        { context: CONTEXT, description: 'Handle chat input keypress' }
      );
    }
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
    const chatContainer = domAPI.getElementById('globalChatMessages');
    if (chatContainer) {
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
    const messageEl = domAPI.createElement('div');
    messageEl.className = `chat-message ${messageClass}`;
    
    // Create message bubble
    const bubbleEl = domAPI.createElement('div');
    bubbleEl.className = 'message-bubble';
    
    // Sanitize and set message content
    bubbleEl.innerHTML = sanitizer.sanitize(message);
    
    // Create metadata element
    const metadataEl = domAPI.createElement('div');
    metadataEl.className = 'message-metadata';
    
    // Format and add timestamp
    const time = new Date(timestamp || Date.now()).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    metadataEl.textContent = time;
    
    // Create message actions
    const actionsEl = domAPI.createElement('div');
    actionsEl.className = 'message-actions';
    
    // Add copy button for AI messages
    if (!isUser) {
      const copyBtn = domAPI.createElement('button');
      copyBtn.className = 'message-action-btn';
      copyBtn.setAttribute('aria-label', 'Copy message');
      copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      
      eventHandlers.trackListener(
        copyBtn,
        'click',
        () => copyMessageToClipboard(message),
        { context: CONTEXT, description: 'Copy message to clipboard' }
      );
      
      actionsEl.appendChild(copyBtn);
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
    const tempEl = domAPI.createElement('div');
    tempEl.innerHTML = message;
    const textContent = tempEl.textContent;
    
    // Use clipboard API if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textContent)
        .then(() => showCopyFeedback(true))
        .catch(err => {
          logger.error('[ChatUIEnhancements] Failed to copy text: ', err, { context: CONTEXT });
          showCopyFeedback(false);
        });
    } else {
      // Fallback method
      const textarea = domAPI.createElement('textarea');
      textarea.value = textContent;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      domAPI.getDocument().body.appendChild(textarea);
      textarea.select();
      
      try {
        const successful = domAPI.getDocument().execCommand('copy');
        showCopyFeedback(successful);
      } catch (err) {
        logger.error('[ChatUIEnhancements] Failed to copy text: ', err, { context: CONTEXT });
        showCopyFeedback(false);
      }
      
      domAPI.getDocument().body.removeChild(textarea);
    }
  }

  /**
   * Show feedback after copy attempt
   * @param {boolean} success - Whether the copy was successful
   */
  function showCopyFeedback(success) {
    // Create toast notification
    const toast = domAPI.createElement('div');
    toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg ${
      success ? 'bg-success text-success-content' : 'bg-error text-error-content'
    } transition-opacity duration-300`;
    toast.textContent = success ? 'Copied to clipboard!' : 'Failed to copy text';
    
    // Add to document
    domAPI.getDocument().body.appendChild(toast);
    
    // Remove after delay
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        domAPI.getDocument().body.removeChild(toast);
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
      const sendBtn = domAPI.getElementById('globalChatSendBtn');
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
    
    const chatContainer = domAPI.getElementById('globalChatMessages');
    if (!chatContainer) return;
    
    const indicatorEl = domAPI.createElement('div');
    indicatorEl.id = 'typingIndicator';
    indicatorEl.className = 'chat-message ai-message';
    
    const indicatorContent = domAPI.createElement('div');
    indicatorContent.className = 'typing-indicator';
    indicatorContent.innerHTML = '<span></span><span></span><span></span>';
    
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
    
    const indicator = domAPI.getElementById('typingIndicator');
    if (indicator) {
      indicator.remove();
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
    eventHandlers.cleanupListeners({ context: CONTEXT });
    state.initialized = false;
  }

  // Public API
  return {
    initialize,
    showTypingIndicator,
    hideTypingIndicator,
    cleanup
  };
}

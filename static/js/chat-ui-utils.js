/*
// static/js/chat-ui-utils.js
// Factory that adds UI helpers onto an existing ChatManager instance
export function attachChatUI(chatMgr, deps) {
  const { domAPI, DOMPurify, eventHandlers, notify, errorReporter } = deps;

  async function _setupUIElements() {
    notify.debug('Setting up UI elements using stored selectors.', {
      source: '_setupUIElements',
      selectors: {
        container: chatMgr.containerSelector,
        messages: chatMgr.messageContainerSelector,
        input: chatMgr.inputSelector,
        send: chatMgr.sendButtonSelector,
        minimize: chatMgr.minimizeButtonSelector,
        title: chatMgr.titleSelector
      }
    });

    if (!domAPI) {
      notify.error('domAPI not available in _setupUIElements. Cannot proceed with UI setup.', { source: '_setupUIElements' });
      chatMgr._handleError('_setupUIElements', new Error('domAPI is required for UI setup.'));
      throw new Error('domAPI is required for UI setup.');
    }

    chatMgr.container = domAPI.querySelector(chatMgr.containerSelector);
    if (!chatMgr.container) {
      notify.error(`Chat container not found with selector: ${chatMgr.containerSelector}`, { source: '_setupUIElements' });
      throw new Error(`Chat container not found: ${chatMgr.containerSelector}`);
    }

    chatMgr.messageContainer = domAPI.querySelector(chatMgr.messageContainerSelector);
    if (!chatMgr.messageContainer) {
      notify.warn(`Message container not found with selector: ${chatMgr.messageContainerSelector}. Attempting to create.`, { source: '_setupUIElements' });
      chatMgr.messageContainer = domAPI.createElement('div');
      chatMgr.messageContainer.id = chatMgr.messageContainerSelector.startsWith('#') ? chatMgr.messageContainerSelector.substring(1) : 'chatMessages';
      domAPI.appendChild(chatMgr.container, chatMgr.messageContainer);
    }

    chatMgr.inputField = domAPI.querySelector(chatMgr.inputSelector);
    if (!chatMgr.inputField) {
      notify.warn(`Input field not found with selector: ${chatMgr.inputSelector}. Attempting to create.`, { source: '_setupUIElements' });
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
      if (!chatMgr.sendButton) {
        notify.warn(`Send button not found with selector: ${chatMgr.sendButtonSelector}, even though input field was found.`, { source: '_setupUIElements' });
      }
    }

    chatMgr.titleElement = domAPI.querySelector(chatMgr.titleSelector);
    if (!chatMgr.titleElement) {
      notify.debug(`Chat title element not found with selector: ${chatMgr.titleSelector}. Chat title will not be displayed by ChatManager.`, { source: '_setupUIElements' });
    }

    if (chatMgr.minimizeButtonSelector) {
      chatMgr.minimizeButton = domAPI.querySelector(chatMgr.minimizeButtonSelector);
      if (!chatMgr.minimizeButton) {
        notify.debug(`Minimize button not found with selector: ${chatMgr.minimizeButtonSelector}. Minimize functionality will not be available.`, { source: '_setupUIElements' });
      }
    }

    notify.debug('UI elements setup process complete.', {
      source: '_setupUIElements',
      elementsFound: {
        container: !!chatMgr.container,
        messageContainer: !!chatMgr.messageContainer,
        inputField: !!chatMgr.inputField,
        sendButton: !!chatMgr.sendButton,
        titleElement: !!chatMgr.titleElement,
        minimizeButton: !!chatMgr.minimizeButton
      }
    });
  }

  function _setupEventListeners() {
    notify.debug('Setting up event listeners', { source: '_setupEventListeners' });
    if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
      notify.error('eventHandlers.trackListener not available. Cannot bind UI events.', { source: '_setupEventListeners' });
      return;
    }
    if (typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: 'chatManager' });
    }

    if (chatMgr.sendButton && chatMgr.inputField) {
      eventHandlers.trackListener(chatMgr.sendButton, 'click', () => {
        const messageText = chatMgr.inputField.value.trim();
        if (messageText) {
          chatMgr.sendMessage(messageText);
          chatMgr.inputField.value = '';
        }
      }, { context: 'chatManager', description: 'Chat Send Button' });
    }

    if (chatMgr.inputField) {
      eventHandlers.trackListener(chatMgr.inputField, 'keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const messageText = chatMgr.inputField.value.trim();
          if (messageText) {
            chatMgr.sendMessage(messageText);
            chatMgr.inputField.value = '';
          }
        }
      }, { context: 'chatManager', description: 'Chat Input Enter Key' });
    }

    if (chatMgr.minimizeButton) {
      eventHandlers.trackListener(chatMgr.minimizeButton, 'click', () => {
        chatMgr.toggleMinimize();
      }, { context: 'chatManager', description: 'Chat Minimize Toggle' });
    }

    if (!domAPI || typeof domAPI.getDocument !== 'function') {
      notify.error('Cannot listen for modelConfigChanged: domAPI.getDocument is not available.', { source: '_setupEventListeners' });
    } else {
      const eventTargetForModelConfig = domAPI.getDocument();
      eventHandlers.trackListener(eventTargetForModelConfig, "modelConfigChanged", (e) => {
        if (e.detail) chatMgr.updateModelConfig(e.detail);
      }, { description: 'Model config changed event for ChatManager', context: 'chatManager' });
    }

    notify.debug('Event listeners set up successfully', { source: '_setupEventListeners' });
  }

  function _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
    notify.debug(`Showing message in UI. Role: ${role}, Content Length: ${content?.length || 0}`, {
      source: '_showMessage',
      role,
      messageId: id,
      hasThinking: !!thinking,
      isRedacted: redactedThinking
    });
    if (!chatMgr.messageContainer) {
      notify.warn('Message container not found. Cannot show message.', { source: '_showMessage' });
      return;
    }
    const message = domAPI.createElement("div");
    message.className = `message ${role}-message`;
    if (id) message.id = id;

    const header = domAPI.createElement("div");
    header.className = "message-header";
    const nowStr = new Date().toLocaleTimeString();

    domAPI.setInnerHTML(
      header,
      `
        <span class="message-role">${role === "assistant" ? "Claude" : role === "user" ? "You" : "System"}</span>
        <span class="message-time">${nowStr}</span>
      `
    );

    const contentEl = domAPI.createElement("div");
    contentEl.className = "message-content";
    domAPI.setInnerHTML(
      contentEl,
      DOMPurify.sanitize(content || "", {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br', 'p']
      })
    );

    domAPI.appendChild(message, header);
    domAPI.appendChild(message, contentEl);

    if (thinking || redactedThinking) {
      const thinkingBlock = chatMgr._createThinkingBlock(thinking, redactedThinking);
      domAPI.appendChild(message, thinkingBlock);
    }

    domAPI.appendChild(chatMgr.messageContainer, message);
    chatMgr.messageContainer.scrollTop = chatMgr.messageContainer.scrollHeight;
  }

  function _createThinkingBlock(thinking, redacted) {
    const container = domAPI.createElement("div");
    container.className = "thinking-container";

    const toggle = domAPI.createElement("button");
    toggle.className = "thinking-toggle";
    toggle.setAttribute("aria-label", "Toggle reasoning details");
    domAPI.setInnerHTML(
      toggle,
      `
        <svg class="thinking-chevron" viewBox="0 0 24 24">
          <path d="M19 9l-7 7-7-7"></path>
        </svg>
        <span>${thinking ? "Show detailed reasoning" : "Safety notice"}</span>
      `
    );

    const content = domAPI.createElement("div");
    content.className = "thinking-content hidden";

    if (thinking) {
      domAPI.setInnerHTML(content, DOMPurify.sanitize(thinking));
    } else if (redacted) {
      domAPI.setInnerHTML(
        content,
        `
          <div class="redacted-notice">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2
                6.48 2 12s4.48 10 10 10 10-4.48
                10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z">
              </path>
            </svg>
            <span>Some reasoning was redacted for safety reasons</span>
          </div>
        `
      );
    }

    // Toggle logic
    const handler = () => {
      content.classList.toggle("hidden");
      const chevron = toggle.querySelector(".thinking-chevron");
      const span = toggle.querySelector("span");
      if (content.classList.contains("hidden")) {
        span.textContent = thinking ? "Show detailed reasoning" : "Show safety notice";
        if (chevron) chevron.style.transform = "";
      } else {
        span.textContent = thinking ? "Hide detailed reasoning" : "Hide safety notice";
        if (chevron) chevron.style.transform = "rotate(180deg)";
      }
    };
    eventHandlers.trackListener(toggle, "click", handler, {
      description: 'Thinking block toggle',
      context: 'chatManager',
      source: 'ChatManager._createThinkingBlock'
    });

    domAPI.appendChild(container, toggle);
    domAPI.appendChild(container, content);
    return container;
  }

  function _clearInputField() {
    if (chatMgr.inputField) {
      chatMgr.inputField.value = "";
      chatMgr.inputField.focus();
      notify.debug('Chat input field cleared and focused.', { source: '_clearInputField' });
    } else {
      notify.warn('Input field not found. Cannot clear.', { source: '_clearInputField' });
    }
  }

  function _showErrorMessage(message) {
    notify.debug(`Showing error message in UI: "${message}"`, { source: '_showErrorMessage' });
    if (!chatMgr.messageContainer) {
      notify.warn('Message container not found. Cannot show error message.', { source: '_showErrorMessage' });
      return;
    }
    const errorEl = domAPI.createElement("div");
    errorEl.className = "error-message";
    domAPI.setInnerHTML(errorEl, `
      <div class="error-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2
           6.48 2 12s4.48 10 10 10 10-4.48
           10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
        </svg>
      </div>
      <div class="error-content">
        <h4>Error</h4>
        <p>${DOMPurify.sanitize(message)}</p>
      </div>
    `);
    domAPI.appendChild(chatMgr.messageContainer, errorEl);
    chatMgr.messageContainer.scrollTop = chatMgr.messageContainer.scrollHeight;
  }

  function _clearMessages() {
    if (chatMgr.messageContainer) {
      domAPI.replaceChildren(chatMgr.messageContainer);
      notify.debug('All messages cleared from UI.', { source: '_clearMessages' });
    } else {
      notify.warn('Message container not found. Cannot clear messages.', { source: '_clearMessages' });
    }
  }

  function _renderMessages(messages) {
    notify.debug(`Rendering ${messages?.length || 0} messages.`, { source: '_renderMessages', count: messages?.length || 0 });
    chatMgr._clearMessages();
    if (!messages?.length) {
      chatMgr._showMessage("system", "No messages yet");
      return;
    }
    messages.forEach((msg) => {
      chatMgr._showMessage(
        msg.role,
        msg.content,
        msg.id,
        msg.thinking,
        msg.redacted_thinking
      );
    });
  }

  function _showLoadingIndicator() {
    notify.debug('Showing loading indicator.', { source: '_showLoadingIndicator' });
    if (!chatMgr.messageContainer) {
      notify.warn('Message container not found. Cannot show loading indicator.', { source: '_showLoadingIndicator' });
      return;
    }
    const indicator = domAPI.createElement("div");
    indicator.id = "chatLoadingIndicator";
    indicator.className = "loading-indicator";
    domAPI.setInnerHTML(
      indicator,
      `
      <div class="loading-spinner"></div>
      <span>Loading conversation...</span>
    `
    );
    domAPI.appendChild(chatMgr.messageContainer, indicator);
  }

  function _hideLoadingIndicator() {
    const indicator = domAPI.querySelector("#chatLoadingIndicator");
    if (indicator) {
      indicator.remove();
      notify.debug('Loading indicator hidden.', { source: '_hideLoadingIndicator' });
    }
  }

  function _showThinkingIndicator() {
    notify.debug('Showing thinking indicator.', { source: '_showThinkingIndicator' });
    if (!chatMgr.messageContainer) {
      notify.warn('Message container not found. Cannot show thinking indicator.', { source: '_showThinkingIndicator' });
      return;
    }
    const indicator = domAPI.createElement("div");
    indicator.id = "thinkingIndicator";
    indicator.className = "thinking-indicator";
    domAPI.setInnerHTML(
      indicator,
      `
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span>Claude is thinking...</span>
      `
    );
    domAPI.appendChild(chatMgr.messageContainer, indicator);
    chatMgr.messageContainer.scrollTop = chatMgr.messageContainer.scrollHeight;
  }

  function _hideThinkingIndicator() {
    const el = domAPI.querySelector("#thinkingIndicator");
    if (el) {
      el.remove();
      notify.debug('Thinking indicator hidden.', { source: '_hideThinkingIndicator' });
    }
  }

  function toggleMinimize() {
    if (!chatMgr.container || !chatMgr.messageContainer || !chatMgr.inputField) {
      notify.warn('Cannot toggle minimize: core UI elements not found.', { source: 'toggleMinimize' });
      return;
    }
    chatMgr.container.classList.toggle('chat-minimized');
    notify.info(`Chat UI minimized state toggled. Now: ${chatMgr.container.classList.contains('chat-minimized') ? 'minimized' : 'expanded'}`, { source: 'toggleMinimize' });
  }

  Object.assign(chatMgr, {
    _setupUIElements,
    _setupEventListeners,
    _showMessage,
    _createThinkingBlock,
    _clearInputField,
    _showErrorMessage,
    _clearMessages,
    _renderMessages,
    _showLoadingIndicator,
    _hideLoadingIndicator,
    _showThinkingIndicator,
    _hideThinkingIndicator,
    toggleMinimize
  });
}
*/

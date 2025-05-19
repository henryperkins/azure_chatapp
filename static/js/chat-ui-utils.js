// static/js/chat-ui-utils.js
const UI_CTX = 'chatManager:UI';
// static/js/chat-ui-utils.js
// Factory that adds UI helpers onto an existing ChatManager instance
export function attachChatUI(chatMgr, deps) {
  const {
    domAPI,
    DOMPurify,
    eventHandlers,
    domReadinessService        // ← new
  } = deps;

  async function _setupUIElements() {
    if (!domAPI) {
      chatMgr._handleError('_setupUIElements', new Error('domAPI is required for UI setup.'));
      throw new Error('domAPI is required for UI setup.');
    }

    // Wait until the template has really been injected
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

    /* --- ensure visibility + correct header state ----------------------- */
    // The per-view chat container may start hidden; always expose it now
    if (chatMgr.container) domAPI.removeClass(chatMgr.container, 'hidden');
    /* -------------------------------------------------------------------- */
  }

  function _setupEventListeners() {
    if (!eventHandlers || typeof eventHandlers.trackListener !== 'function') {
      return;
    }
    if (typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: UI_CTX });
    }

    if (chatMgr.sendButton && chatMgr.inputField) {
      eventHandlers.trackListener(chatMgr.sendButton, 'click', () => {
        const messageText = chatMgr.inputField.value.trim();
        if (messageText) {
          chatMgr.sendMessage(messageText);
          chatMgr.inputField.value = '';
        }
      }, { context: UI_CTX, description: 'Chat Send Button' });
    }

    if (chatMgr.inputField) {
      eventHandlers.trackListener(chatMgr.inputField, 'keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const messageText = chatMgr.inputField.value.trim();
          if (messageText) {
            chatMgr.sendMessage(messageText);
            chatMgr.inputField.value = '';
          }
        }
      }, { context: UI_CTX, description: 'Chat Input Enter Key' });
    }

    if (chatMgr.minimizeButton) {
      eventHandlers.trackListener(chatMgr.minimizeButton, 'click', () => {
        chatMgr.toggleMinimize();
      }, { context: UI_CTX, description: 'Chat Minimize Toggle' });
    }

    // new: listen on the modelConfig event bus directly
    const modelConfigBus = chatMgr.modelConfigAPI?.getEventBus?.();
    if (modelConfigBus) {
      eventHandlers.trackListener(
        modelConfigBus,
        "modelConfigChanged",
        (e) => {
          if (e.detail) chatMgr.updateModelConfig(e.detail);
        },
        { description: 'Model config changed event for ChatManager', context: UI_CTX }
      );
    }
  }

  function _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
    if (!chatMgr.messageContainer) {
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
      context: UI_CTX,
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
    }
  }

  function _showErrorMessage(message) {
    if (!chatMgr.messageContainer) {
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
    }
  }

  function _renderMessages(messages) {
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
    if (!chatMgr.messageContainer) {
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
    }
  }

  function _showThinkingIndicator() {
    if (!chatMgr.messageContainer) {
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
    }
  }

  function toggleMinimize() {
    if (!chatMgr.container || !chatMgr.messageContainer || !chatMgr.inputField) return;
    chatMgr.container.classList.toggle('chat-minimized');
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

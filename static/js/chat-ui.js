/**
 * chat-ui.js
 * UI components for chat interface.
 * Handles all DOM manipulation, rendering of messages, input controls, and visual elements.
 * Focuses strictly on presentation and user interaction, delegating non-UI logic to other modules.
 */

// Define UIComponents as a constructor function attached to window
window.UIComponents = function (options = {}) {
  // Store selectors at instance level for flexibility across different chat contexts
  this.messageContainerSelector = options.messageContainerSelector || '#globalChatMessages';
  this.inputSelector = options.inputSelector || '#chatUIInput';
  this.sendButtonSelector = options.sendButtonSelector || '#globalChatSendBtn';

  console.log('UIComponents initialized with selectors:', {
    messageContainer: this.messageContainerSelector,
    input: this.inputSelector,
    sendButton: this.sendButtonSelector
  });

  // Central selectors for container IDs (can be switched for project context)
  const SELECTORS = {
    mainChatContainerId: 'globalChatContainer',
    mainChatUI: 'globalChatUI',
    mainMessages: 'globalChatMessages',
    mainInput: 'globalChatInput',
    mainSendBtn: 'globalChatSendBtn',
    projectChatContainerId: 'globalChatContainer',
    projectChatUI: 'globalChatUI',
    projectMessages: 'globalChatMessages',
    projectInput: 'globalChatInput',
    projectSendBtn: 'globalChatSendBtn',
    markdownStyleId: 'markdown-styles',
    markdownStyles: `
      .markdown-table{width:100%;border-collapse:collapse;margin:1em 0}
      .markdown-table th,.markdown-table td{padding:.5em;border:1px solid #ddd}
      .markdown-code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}
      .markdown-pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
      .markdown-quote{border-left:3px solid #ddd;padding:0 1em;color:#666}
      .code-block-wrapper{position:relative}
      .copy-code-btn{position:absolute;right:.5em;top:.5em;padding:.25em .5em;background:#fff;border:1px solid #ddd;
        border-radius:3px;cursor:pointer;font-size:.8em}
      .copy-code-btn:hover{background:#f5f5f5}
    `
  };

  /**
   * Inject global markdown styles if not present.
   */
  this.addMarkdownStyles = function () {
    if (document.getElementById(SELECTORS.markdownStyleId)) return;
    const style = document.createElement('style');
    style.id = SELECTORS.markdownStyleId;
    style.textContent = SELECTORS.markdownStyles;
    document.head.appendChild(style);
  };

  /**
   * Create or locate the required chat container for project or main chat.
   * Return the container if found/created/visible, or null otherwise.
   * @param {boolean} isProjectContext - Whether to use project-specific container IDs
   * @returns {HTMLElement|null} - The chat container element or null if not created
   */
  this.findOrCreateChatContainer = async function (isProjectContext = false) {
    const containerId = isProjectContext
      ? SELECTORS.projectChatContainerId
      : SELECTORS.mainChatContainerId;

    let container = document.querySelector(`#${containerId}`);
    if (!container) {
      console.log(`Chat container (#${containerId}) not found, creating...`);
      const mainContent = document.querySelector('main');
      if (mainContent) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'mt-4 transition-all duration-300 ease-in-out';
        container.style.display = 'block'; // Ensure visible

        // Create messages container
        const messagesContainer = document.createElement('div');
        messagesContainer.id = isProjectContext
          ? SELECTORS.projectMessages
          : SELECTORS.mainMessages;
        messagesContainer.className = 'chat-message-container';
        container.appendChild(messagesContainer);

        // Create input area
        const inputArea = document.createElement('div');
        inputArea.className = 'flex items-center border-t border-gray-200 dark:border-gray-700 p-2';

        const chatInput = document.createElement('input');
        chatInput.id = isProjectContext
          ? SELECTORS.projectInput
          : SELECTORS.mainInput;
        chatInput.type = 'text';
        chatInput.className = 'flex-1 border rounded-l px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white';
        chatInput.placeholder = 'Type your message...';

        const sendBtn = document.createElement('button');
        sendBtn.id = isProjectContext
          ? SELECTORS.projectSendBtn
          : SELECTORS.mainSendBtn;
        sendBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-r transition-colors';
        sendBtn.textContent = 'Send';

        inputArea.appendChild(chatInput);
        inputArea.appendChild(sendBtn);
        container.appendChild(inputArea);

        mainContent.appendChild(container);
        console.log(`Created chat container: #${container.id}`);
      }
    }
    if (container) {
      // Ensure container is visible
      container.classList.remove('hidden');
      container.style.display = 'block';

      // Ensure parent is visible too
      let parent = container.parentElement;
      while (parent && parent !== document.body) {
        if (parent.classList.contains('hidden')) {
          parent.classList.remove('hidden');
        }
        if (parent.style.display === 'none') {
          parent.style.display = 'block';
        }
        parent = parent.parentElement;
      }
    }
    return container;
  };

  /**
   * Ensure the chat container is visible, trying multiple times if needed.
   * @param {boolean} isProjectContext - Whether to use project-specific container IDs
   * @returns {Promise<HTMLElement|null>} - The visible container or null if not found
   */
  this.ensureChatContainerVisible = async function (isProjectContext = false) {
    let attempts = 0;
    const maxAttempts = 15;
    const delay = 400;

    while (attempts < maxAttempts) {
      const container = await this.findOrCreateChatContainer(isProjectContext);
      if (container && container.offsetParent !== null) {
        console.log(`Chat container #${container.id} found and visible.`);
        return container;
      }
      if (attempts % 3 === 0) {
        console.log(`Searching for chat container (attempt ${attempts + 1}/${maxAttempts})...`);
      }
      attempts++;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    console.error("Could not find chat container after multiple attempts.");
    return null;
  };

  // Message list component for rendering messages
  this.messageList = {
    container: document.querySelector(this.messageContainerSelector),
    messageContainerSelector: this.messageContainerSelector, // Store selector for error reporting
    thinkingId: 'thinkingIndicator',
    // Use existing formatText from formatting.js if available
    formatText: window.formatText || function (text) { return text; },
    _defaultFormatter: window.formatText,

    /**
     * Clear all messages from the container.
     */
    clear: function () {
      if (this.container) this.container.innerHTML = '';
    },

    /**
     * Display a loading message in the container.
     * @param {string} msg - Loading message text
     */
    setLoading: function (msg = 'Loading...') {
      if (this.container) {
        this.container.innerHTML = `<div class="text-center text-gray-500">${msg}</div>`;
      }
    },

    /**
     * Add a thinking indicator (e.g., "Claude is thinking...").
     * @returns {HTMLElement} - The created thinking indicator element
     */
    addThinking: function () {
      const thinkingDiv = document.createElement('div');
      thinkingDiv.id = this.thinkingId;
      thinkingDiv.className = 'mb-2 p-2 rounded bg-gray-50 text-gray-600 flex items-center';
      thinkingDiv.innerHTML = `
        <div class="animate-pulse flex space-x-2">
          <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
          <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
          <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
        </div>
        <span class="ml-2">Claude is thinking...</span>
      `;
      if (this.container) {
        this.container.appendChild(thinkingDiv);
        this.container.scrollTop = this.container.scrollHeight;
      }
      return thinkingDiv;
    },

    /**
     * Remove the thinking indicator from the container.
     */
    removeThinking: function () {
      document.getElementById(this.thinkingId)?.remove();
    },

    /**
     * Remove the last assistant message (e.g., for regeneration).
     */
    removeLastAssistantMessage: function () {
      if (!this.container) return;
      const messages = this.container.querySelectorAll('div.bg-green-50');
      if (messages.length > 0) {
        messages[messages.length - 1].remove();
      }
    },

    /**
     * Remove the last message added to the container.
     */
    removeLastMessage: function () {
      if (!this.container) return;
      const lastMessage = this.container.lastElementChild;
      if (lastMessage && lastMessage.classList.contains('mb-4')) {
        lastMessage.remove();
      }
    },

    /**
     * Render a list of messages in the container.
     * @param {Array<Object>} messages - Array of message objects to render
     */
    renderMessages: function (messages) {
      this.clear();
      if (!messages || messages.length === 0) {
        this.appendMessage("system", "No messages yet");
        return;
      }
      messages.forEach(msg => {
        const metadata = msg.metadata || {};
        this.appendMessage(
          msg.role,
          msg.content,
          null,
          metadata.thinking,
          metadata.redacted_thinking,
          metadata
        );
      });
    },

    /**
     * Append a single message to the container.
     * @param {string} role - Message role (e.g., 'user', 'assistant', 'system')
     * @param {string} content - Message content
     * @param {string|null} id - Optional message ID
     * @param {string|null} thinking - Optional thinking text for assistant messages
     * @param {string|null} redacted - Optional redacted thinking indicator
     * @param {Object|null} metadata - Optional metadata for the message
     * @returns {HTMLElement|null} - The created message element or null if failed
     */
    appendMessage: function (role, content, id = null, thinking = null, redacted = null, metadata = null) {
      // Check container existence with fallback
      const container = this.container || document.querySelector('#projectChatMessages');
      if (!container || !document.contains(container)) {
        console.error('Project chat container missing - verify:',
          '\n1. Project UI initialization',
          '\n2. Parent container existence (#projectChatContainer)',
          '\n3. DOM loading sequence');
        return null;
      }
      this.container = container; // Maintain reference

      try {
        // Verify container is writable
        if (!container?.appendChild || typeof container.appendChild !== 'function') {
          throw new Error('Chat container is not a valid DOM element');
        }

        // Handle null/undefined content
        const safeContent = content || '';
        const contentLength = safeContent.length;

        console.log(`[UI] Appending ${role} message (${contentLength} chars)`);
        if (contentLength > 50) {
          console.debug('Message preview:', safeContent.substring(0, 50) + '...');
        }
        // Create message container
        const msgDiv = document.createElement('div');
        msgDiv.className = `mb-4 p-4 rounded shadow-sm ${role === 'assistant'
            ? 'bg-green-50 text-green-800'
            : role === 'system'
              ? 'bg-gray-50 text-gray-600 text-sm'
              : 'bg-blue-50 text-blue-900'
          }`;
        if (id) msgDiv.id = id;

        // Add data attributes for message metadata
        if (metadata) {
          msgDiv.dataset.thinking = metadata.thinking || '';
          msgDiv.dataset.redactedThinking = metadata.redacted_thinking || '';
          msgDiv.dataset.model = metadata.model || '';
          msgDiv.dataset.tokens = metadata.tokens || '';
        }

        // Add header with role indicator
        const header = document.createElement('div');
        header.className = 'flex items-center mb-2';
        header.innerHTML = `
          <span class="font-medium ${role === 'assistant' ? 'text-green-700' : 'text-blue-700'}">
            ${role === 'assistant' ? 'Claude' : 'You'}
          </span>
          <span class="ml-2 text-xs text-gray-500">
            ${metadata?.created_at ? new Date(metadata.created_at).toLocaleTimeString() : new Date().toLocaleTimeString()}
          </span>
        `;
        msgDiv.appendChild(header);

        // Add main content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'prose max-w-none';

        // Handle potential JSON responses
        let processedContent = content;
        try {
          // Check if content is JSON string
          if (typeof content === 'string' &&
            (content.trim().startsWith('{') || content.trim().startsWith('['))) {
            const parsed = JSON.parse(content);
            if (parsed.answer || parsed.content || parsed.message) {
              processedContent = parsed.answer || parsed.content || parsed.message;

              // Extract thinking if available
              if (!thinking && parsed.thinking) {
                thinking = parsed.thinking;
              }
            }
          }
        } catch (e) {
          // Not JSON, use as is
          console.log('Content is not JSON, using as is');
        }

        // Ensure newlines are preserved and apply formatting
        try {
          const safeContent = processedContent || '';
          if (window.formatText) {
            contentDiv.innerHTML = window.formatText(safeContent.replace(/\\n/g, '<br>'));
          } else {
            contentDiv.textContent = safeContent; // Fallback to plain text
          }
        } catch (err) {
          console.error('Error formatting message content:', err);
          contentDiv.textContent = processedContent; // Fallback to plain text
        }

        msgDiv.appendChild(contentDiv);

        // Add copy buttons to code blocks
        msgDiv.querySelectorAll('pre code').forEach(block => {
          const btn = document.createElement('button');
          btn.className = 'copy-code-btn';
          btn.textContent = 'Copy';
          btn.onclick = () => {
            navigator.clipboard.writeText(block.textContent)
              .then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 2000);
              });
          };

          const wrapper = document.createElement('div');
          wrapper.className = 'code-block-wrapper';
          wrapper.appendChild(block.cloneNode(true));
          wrapper.appendChild(btn);
          block.replaceWith(wrapper);
        });

        // Add knowledge base indicator if metadata indicates usage
        if (role === 'assistant' && metadata?.used_knowledge_context) {
          const kb = document.createElement('div');
          kb.className = 'mt-2 bg-blue-50 text-blue-800 rounded p-2 text-xs flex items-center';
          kb.innerHTML = `
            <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Response includes information from project files</span>
          `;
          msgDiv.appendChild(kb);
        }

        // Add thinking block display for Claude models
        if (role === 'assistant') {
          // Handle redacted thinking
          if (redacted) {
            const redactedContainer = document.createElement('div');
            redactedContainer.className = 'bg-yellow-50 text-yellow-800 p-2 rounded text-sm mt-2';
            redactedContainer.innerHTML = `
              <div class="flex items-center">
                <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
                <span>Some reasoning was redacted for safety</span>
              </div>
            `;
            msgDiv.appendChild(redactedContainer);
          }

          // Handle regular thinking blocks
          if (thinking) {
            const container = this._createThinkingContainer(thinking, false, metadata);
            msgDiv.appendChild(container);
          }
        }

        this.container.appendChild(msgDiv);
        this.container.scrollTop = this.container.scrollHeight;
        return msgDiv;
      } catch (error) {
        console.error('Error appending message:', error);
        return null;
      }
    },

    // Helper to create thinking blocks
    _createThinkingContainer: function (thinking, redacted, metadata) {
      const container = document.createElement('div');
      container.className = 'mt-3 border-t border-gray-200 pt-2';

      // Add model metadata indicator if available
      if (metadata && (metadata.model || metadata.tokens)) {
        const metaIndicator = document.createElement('div');
        metaIndicator.className = 'text-xs text-gray-500 mb-2';
        let metaText = '';
        if (metadata.model) metaText += `Model: ${metadata.model}`;
        if (metadata.tokens) {
          if (metaText) metaText += ' • ';
          metaText += `Tokens: ${metadata.tokens}`;
        }
        metaIndicator.textContent = metaText;
        container.appendChild(metaIndicator);
      }

      const toggle = document.createElement('button');
      toggle.className = 'text-gray-600 text-xs flex items-center mb-1 hover:text-gray-800';
      toggle.innerHTML = `
        <svg class="h-4 w-4 mr-1 thinking-chevron transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
        ${thinking ? 'Show detailed reasoning' : 'Show safety notice'}
      `;

      // Add tooltip explaining thinking blocks
      toggle.title = thinking
        ? "Claude's step-by-step reasoning process"
        : "Some reasoning was redacted for safety";

      const contentDiv = document.createElement('div');
      contentDiv.className = 'bg-gray-50 p-2 rounded text-gray-800 text-sm hidden thinking-content';

      if (thinking) {
        // Format thinking blocks with proper line breaks and use existing formatter
        const formattedThinking = thinking.replace(/\n/g, '<br>');
        contentDiv.innerHTML = window.formatText ?
          window.formatText(formattedThinking) :
          formattedThinking;
      } else if (redacted) {
        contentDiv.innerHTML = `
            <div class="flex items-center text-yellow-700">
                <svg class="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                </svg>
                Claude's full reasoning is encrypted for safety but will be used internally
            </div>
        `;
      }

      toggle.onclick = () => {
        contentDiv.classList.toggle('hidden');
        const chevron = toggle.querySelector('.thinking-chevron');
        if (contentDiv.classList.contains('hidden')) {
          toggle.innerHTML = toggle.innerHTML.replace('Hide', 'Show');
          if (chevron) chevron.style.transform = '';
        } else {
          toggle.innerHTML = toggle.innerHTML.replace('Show', 'Hide');
          if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
      };

      container.appendChild(toggle);
      container.appendChild(contentDiv);
      return container;
    },

    /**
     * Add an image indicator to the last user message.
     * @param {string} imageUrl - URL of the image to display
     */
    addImageIndicator: function (imageUrl) {
      if (!this.container) return;
      const msgDivs = this.container.querySelectorAll("div.bg-blue-50");
      const lastUserDiv = msgDivs?.[msgDivs.length - 1];
      if (lastUserDiv) {
        const container = document.createElement("div");
        container.className = "flex items-center bg-gray-50 rounded p-1 mt-2";

        const img = document.createElement("img");
        img.className = "h-10 w-10 object-cover rounded mr-2";
        img.src = document.getElementById('chatPreviewImg')?.src || imageUrl;
        img.alt = "Attached Image";

        const label = document.createElement("div");
        label.className = "text-xs text-gray-500";
        label.textContent = "📷 Image attached";

        container.appendChild(img);
        container.appendChild(label);
        lastUserDiv.appendChild(container);
      }
    },

    /**
     * Show an AI error message in the container.
     * @param {string} message - Error message to display
     * @param {string} suggestedAction - Suggested action for the user
     * @returns {HTMLElement|null} - The created error element or null if failed
     */
    showAIErrorMessage: function (message, suggestedAction) {
      if (!this.container) return null;

      // Remove thinking indicator if present
      this.removeThinking();

      // Create an error message element
      const errorDiv = document.createElement('div');
      errorDiv.className = 'mb-4 p-4 rounded-lg shadow-sm bg-yellow-50 text-yellow-800 border border-yellow-200';

      // Add header with error icon
      const header = document.createElement('div');
      header.className = 'flex items-center mb-2';
      header.innerHTML = `
        <svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span class="font-medium">Claude couldn't generate a response</span>
      `;
      errorDiv.appendChild(header);

      // Add error message
      const messageDiv = document.createElement('div');
      messageDiv.className = 'mb-2';
      messageDiv.textContent = message;
      errorDiv.appendChild(messageDiv);

      // Add suggested action if provided
      if (suggestedAction) {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'text-sm font-medium';
        actionDiv.textContent = `Suggestion: ${suggestedAction}`;
        errorDiv.appendChild(actionDiv);
      }

      // Add retry button
      const buttonDiv = document.createElement('div');
      buttonDiv.className = 'mt-3 flex justify-end';

      const retryButton = document.createElement('button');
      retryButton.className = 'px-3 py-1 text-sm bg-yellow-200 hover:bg-yellow-300 text-yellow-900 rounded transition-colors';
      retryButton.textContent = 'Try Again';
      retryButton.onclick = () => {
        // Remove this error message
        errorDiv.remove();
        // Trigger regenerate event
        document.dispatchEvent(new CustomEvent('regenerateChat'));
      };

      buttonDiv.appendChild(retryButton);
      errorDiv.appendChild(buttonDiv);

      // Add to container
      this.container.appendChild(errorDiv);
      this.container.scrollTop = this.container.scrollHeight;

      return errorDiv;
    }
  };

  // Input component for handling user input
  this.input = {
    element: null,
    button: null,
    onSend: options.onSend || (() => { }),

    /**
     * Get the current value of the input field.
     * @returns {string} - Trimmed input value
     */
    getValue: function () {
      return this.element ? this.element.value.trim() : '';
    },

    /**
     * Clear the input field.
     */
    clear: function () {
      if (this.element) this.element.value = '';
    },

    /**
     * Focus the input field.
     */
    focus: function () {
      if (this.element) this.element.focus();
    },

    /**
     * Initialize the input component, setting up elements and event listeners.
     */
    init: function () {
      // Only initialize if chat container exists and is needed
      const chatContainer = document.getElementById('chatUIContainer');
      if (!chatContainer || chatContainer.dataset.requiresChat !== 'true') {
        return;
      }

      // More robust element finding logic
      // First try with the provided selectors
      this.element = document.querySelector(this.inputSelector);
      this.button = document.querySelector(this.sendButtonSelector);

      // If not found, try common selectors and fallbacks
      if (!this.element) {
        console.log('Input element not found with selector:', this.inputSelector);
        // Try common input selectors
        const possibleInputs = [
          '#chatInput',
          '#chatUIInput',
          '#projectChatInput',
          'input[placeholder*="message" i]',
          '.chat-input',
          'input[type="text"]'
        ];

        for (const selector of possibleInputs) {
          const element = document.querySelector(selector);
          if (element) {
            console.log('Found input element with fallback selector:', selector);
            this.element = element;
            break;
          }
        }
      }

      // If button not found, try common button selectors or find sibling button
      if (!this.button) {
        console.log('Send button not found with selector:', this.sendButtonSelector);
        // Try common button selectors
        const possibleButtons = [
          '#sendBtn',
          '#projectChatSendBtn',
          'button:has-text("Send")',
          'button.chat-send-button',
          // Look for a button near the input
          this.element ? this.element.nextElementSibling : null
        ];

        for (const selector of possibleButtons) {
          if (!selector) continue; // Skip null entries

          // Handle DOM element directly
          if (selector instanceof Element) {
            if (selector.tagName === 'BUTTON') {
              console.log('Found button element as sibling of input');
              this.button = selector;
              break;
            }
            continue;
          }

          // Handle selector strings
          const element = document.querySelector(selector);
          if (element) {
            console.log('Found button element with fallback selector:', selector);
            this.button = element;
            break;
          }
        }

        // Last resort - look for any button in the chat container
        if (!this.button) {
          const chatContainer = document.querySelector('#projectChatUI') ||
            document.querySelector('#chatUI');
          if (chatContainer) {
            const containerButton = chatContainer.querySelector('button');
            if (containerButton) {
              console.log('Found fallback button in chat container');
              this.button = containerButton;
            }
          }
        }
      }

      // Log final element status
      console.log('Final input element:', this.element);
      console.log('Final button element:', this.button);

      // Set up event listeners if elements were found
      if (this.element) {
        // Use safer event listener removal and re-attachment
        const keyupHandler = (e) => {
          if (e.key === "Enter") this._send();
        };

        this.element.removeEventListener("keyup", keyupHandler);
        this.element.addEventListener("keyup", keyupHandler);
      } else {
        console.error('Could not find input element for chat');
      }

      if (this.button) {
        // Create a new click handler
        const clickHandler = () => {
          console.log('Send button clicked');
          this._send();
        };

        // Remove any existing listeners to prevent duplicates
        const newButton = this.button.cloneNode(true);
        if (this.button.parentNode) {
          this.button.parentNode.replaceChild(newButton, this.button);
        }
        this.button = newButton;

        // Add the click event listener
        this.button.addEventListener("click", clickHandler);
      } else {
        console.error('Could not find send button for chat');
      }

      // Check for model configuration events
      if (!this._hasModelConfigListener) {
        document.addEventListener('modelConfigChanged', (e) => {
          console.log('Model config changed, updating UI if needed:', e.detail);
          // Any UI updates needed can be added here
        });
        this._hasModelConfigListener = true;
      }
    },

    /**
     * Internal method to send the message from input.
     */
    _send: function () {
      const msg = this.getValue();
      if (msg) {
        console.log('Sending message:', msg);
        this.onSend(msg);
        this.clear();
        this.focus(); // Auto focus after sending
      }
    }
  };

  // Image upload component for handling image attachments
  this.imageUpload = {
    button: document.querySelector(options.attachButtonSelector || '#chatAttachImageBtn'),
    input: document.querySelector(options.imageInputSelector || '#chatImageInput'),
    preview: document.querySelector(options.previewSelector || '#chatImagePreview'),
    image: document.querySelector(options.previewImageSelector || '#chatPreviewImg'),
    remove: document.querySelector(options.removeButtonSelector || '#chatRemoveImageBtn'),
    onChange: options.onImageChange || (() => { }),

    /**
     * Initialize the image upload component, setting up event listeners.
     */
    init: function () {
      if (!this.button || !this.input || !this.preview || !this.remove) return;

      this.button.addEventListener("click", () => {
        const model = window.MODEL_CONFIG?.modelName;
        if (model !== "o1" && model !== "gpt-4o") {
          window.ChatUtils.showNotification("Vision only works with the o1 model", "warning");
          return;
        }
        this.input.click();
      });

      this.input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          window.ChatUtils.showNotification("Only JPEG/PNG supported", "error");
          this.input.value = '';
          return;
        }

        if (file.size > 5 * 1024 * 1024) {
          window.ChatUtils.showNotification("Image must be under 5MB", "error");
          this.input.value = '';
          return;
        }

        try {
          if (this.image) {
            this.image.src = URL.createObjectURL(file);
          }
          this.preview.classList.remove("hidden");

          const reader = new FileReader();
          reader.readAsDataURL(file);
          const base64 = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
          });

          // Store in a global config for the vision model
          window.MODEL_CONFIG = window.MODEL_CONFIG || {};
          window.MODEL_CONFIG.visionImage = base64;
          window.MODEL_CONFIG.visionDetail = "auto";

          this.onChange(base64);
        } catch (err) {
          console.error("Image processing error:", err);
          window.ChatUtils.showNotification("Failed to process image", "error");
          this.preview.classList.add("hidden");
        }
      });

      this.remove.addEventListener("click", () => {
        this.input.value = '';
        this.preview.classList.add("hidden");
        if (window.MODEL_CONFIG) {
          window.MODEL_CONFIG.visionImage = null;
        }
        this.onChange(null);
      });
    },

    /**
     * Clear the image upload input and preview.
     */
    clear: function () {
      if (this.input) this.input.value = '';
      if (this.preview) this.preview.classList.add("hidden");
    }
  };
};

/**
 * Initialize UI components.
 * @returns {Object} - The UIComponents instance for chaining
 */
window.UIComponents.prototype.init = function () {
  this.input.init();
  this.imageUpload.init();
  this.addMarkdownStyles();
  return this;
};

// Make utility methods available globally for backward compatibility
window.UIUtils = window.UIUtils || {};
window.UIUtils.showAIErrorHint = function (message, suggestedAction) {
  // Find active chat interface
  const chatInterface = window.chatInterface || window.projectChatInterface;
  if (chatInterface?.ui?.messageList?.showAIErrorMessage) {
    chatInterface.ui.messageList.showAIErrorMessage(message, suggestedAction);
  }
};

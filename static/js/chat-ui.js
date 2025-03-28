/**
 * chat-ui.js
 * UI components for chat interface
 */

// Define UIComponents as a constructor function attached to window
window.UIComponents = function(options = {}) {
  // Allow message container selector to be passed in
  const messageContainerSelector = options.messageContainerSelector || '#conversationArea';
  
  // Message list component for rendering messages
  this.messageList = {
    container: document.querySelector(messageContainerSelector),
    thinkingId: 'thinkingIndicator',
    // Use existing formatText from formatting.js
    formatText: window.formatText || function(text) { return text; },
    _defaultFormatter: window.formatText,

    clear: function() {
      if (this.container) this.container.innerHTML = '';
    },

    setLoading: function(msg = 'Loading...') {
      if (this.container) {
        this.container.innerHTML = `<div class="text-center text-gray-500">${msg}</div>`;
      }
    },

    addThinking: function() {
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

    removeThinking: function() {
      document.getElementById(this.thinkingId)?.remove();
    },

    renderMessages: function(messages) {
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

    appendMessage: function(role, content, id = null, thinking = null, redacted = null, metadata = null) {
      if (!this.container) return null;

      try {
        // Create message container
        const msgDiv = document.createElement('div');
        msgDiv.className = `mb-4 p-4 rounded-lg shadow-sm ${this.getClass(role)}`;
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
            ${new Date().toLocaleTimeString()}
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
        // Use window.formatText from formatting.js
        try {
          if (window.formatText) {
            contentDiv.innerHTML = window.formatText(processedContent.replace(/\\n/g, '<br>'));
          } else {
            contentDiv.textContent = processedContent; // Fallback to plain text
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
        if (role === 'assistant' && (thinking || redacted)) {
          // Create container
          const container = this._createThinkingContainer(thinking, redacted, metadata);
          msgDiv.appendChild(container);
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
    _createThinkingContainer: function(thinking, redacted, metadata) {
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

    addImageIndicator: function(imageUrl) {
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

    getClass: function(role) {
      switch (role) {
        case "user":
          return "bg-blue-50 text-blue-900";
        case "assistant":
          return "bg-green-50 text-green-900";
        case "system":
          return "bg-gray-50 text-gray-600 text-sm";
        default:
          return "bg-white";
      }
    }
  };

  // Input component
  this.input = {
    element: document.querySelector(options.inputSelector || '#chatInput'),
    button: document.querySelector(options.sendButtonSelector || '#sendBtn'),
    onSend: options.onSend || (() => {}),

    getValue: function() {
      return this.element ? this.element.value.trim() : '';
    },

    clear: function() {
      if (this.element) this.element.value = '';
    },

    focus: function() {
      if (this.element) this.element.focus();
    },

    init: function() {
      if (this.element) {
        this.element.addEventListener("keyup", (e) => {
          if (e.key === "Enter") this._send();
        });
      }
      if (this.button) {
        this.button.addEventListener("click", () => this._send());
      }
    },

    _send: function() {
      const msg = this.getValue();
      if (msg) {
        this.onSend(msg);
        this.clear();
      }
    }
  };

  // Image upload component
  this.imageUpload = {
    button: document.querySelector(options.attachButtonSelector || '#chatAttachImageBtn'),
    input: document.querySelector(options.imageInputSelector || '#chatImageInput'),
    preview: document.querySelector(options.previewSelector || '#chatImagePreview'),
    image: document.querySelector(options.previewImageSelector || '#chatPreviewImg'),
    remove: document.querySelector(options.removeButtonSelector || '#chatRemoveImageBtn'),
    onChange: options.onImageChange || (() => {}),
    showNotification: options.showNotification || window.showNotification || console.log,

    init: function() {
      if (!this.button || !this.input || !this.preview || !this.remove) return;

      this.button.addEventListener("click", () => {
        const model = localStorage.getItem("modelName");
        if (model !== "o1") {
          this.showNotification("Vision only works with the o1 model", "warning");
          return;
        }
        this.input.click();
      });

      this.input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          this.showNotification("Only JPEG/PNG supported", "error");
          this.input.value = '';
          return;
        }

        if (file.size > 5 * 1024 * 1024) {
          this.showNotification("Image must be under 5MB", "error");
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
          this.showNotification("Failed to process image", "error");
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

    clear: function() {
      if (this.input) this.input.value = '';
      if (this.preview) this.preview.classList.add("hidden");
    }
  };
};

// Initialize UI components
window.UIComponents.prototype.init = function() {
  this.input.init();
  this.imageUpload.init();
  return this;
};

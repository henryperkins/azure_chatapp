/**
 * MessageList.js
 * Handles message rendering and display
 */

export default class MessageList {
  constructor(containerSelector) {
    this.containerSelector = containerSelector;
    this.container = document.querySelector(containerSelector);
    this.formatText = window.formatText || this._defaultFormatText;
    this.thinkingMessageId = 'thinkingIndicator';
  }

  /**
   * Clear all messages from the container
   */
  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * Set a loading message
   */
  setLoading(message = 'Loading conversation...') {
    if (this.container) {
      this.container.innerHTML = `<div class="text-center text-gray-500">${message}</div>`;
    }
  }

  /**
   * Set an error message
   */
  setError(message = 'Error loading conversation') {
    if (this.container) {
      this.container.innerHTML = `<div class="text-center text-red-500">${message}</div>`;
    }
  }

  /**
   * Append a new message to the container
   */
  appendMessage(role, content, thinking = null, redacted_thinking = null, metadata = null) {
    if (!this.container) return null;

    // If content includes '[Conversation summarized]', show an indicator
    if (content.includes('[Conversation summarized]') && typeof window.showSummaryIndicator === 'function') {
      const summaryEl = document.createElement('div');
      summaryEl.innerHTML = window.showSummaryIndicator();
      this.container.appendChild(summaryEl);
    }

    // Create message div
    const msgDiv = this._createDomElement("div", {
      className: `mb-2 p-2 rounded ${this._getMessageClass(role)}`
    });

    // Format content with markdown support
    const formattedContent = this.formatText(content);
    msgDiv.innerHTML = formattedContent;
    
    // Add copy button to code blocks
    msgDiv.querySelectorAll('pre code').forEach(codeBlock => {
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-btn';
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.textContent)
          .then(() => {
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
              copyButton.textContent = 'Copy';
            }, 2000);
          })
          .catch(err => {
            console.error('Failed to copy:', err);
          });
      });
      
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      wrapper.appendChild(codeBlock.cloneNode(true));
      wrapper.appendChild(copyButton);
      codeBlock.replaceWith(wrapper);
    });
    
    // Knowledge Base Indicator - when AI used project files to answer
    const usedKnowledgeBase = metadata?.used_knowledge_context || false;
    if (role === 'assistant' && usedKnowledgeBase) {
      const kbContainer = document.createElement('div');
      kbContainer.className = 'mt-2 bg-blue-50 text-blue-800 rounded p-2 text-xs flex items-center';
      kbContainer.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>Response includes information from project files</span>
      `;
      msgDiv.appendChild(kbContainer);
    }
    
    // Add thinking blocks if available (for assistant messages)
    if (role === 'assistant' && (thinking || redacted_thinking)) {
      // Create a collapsible thinking section
      const thinkingContainer = document.createElement('div');
      thinkingContainer.className = 'mt-3 border-t border-gray-200 pt-2';
      
      // Create a toggle button
      const toggleButton = document.createElement('button');
      toggleButton.className = 'text-gray-600 text-xs flex items-center mb-1';
      toggleButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 thinking-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
        Show thinking process
      `;
      
      // Create the content area (hidden by default)
      const thinkingContent = document.createElement('div');
      thinkingContent.className = 'bg-gray-50 p-2 rounded text-gray-800 text-sm hidden thinking-content';
      
      if (thinking) {
        thinkingContent.innerHTML = window.formatText ? window.formatText(thinking) : thinking;
      } else if (redacted_thinking) {
        thinkingContent.innerHTML = '<em>Claude\'s full reasoning is available but has been automatically encrypted for safety reasons.</em>';
      }
      
      // Add toggle functionality
      toggleButton.addEventListener('click', () => {
        thinkingContent.classList.toggle('hidden');
        const chevron = toggleButton.querySelector('.thinking-chevron');
        if (thinkingContent.classList.contains('hidden')) {
          toggleButton.innerHTML = toggleButton.innerHTML.replace('Hide', 'Show');
          chevron.style.transform = '';
        } else {
          toggleButton.innerHTML = toggleButton.innerHTML.replace('Show', 'Hide');
          chevron.style.transform = 'rotate(180deg)';
        }
      });
      
      thinkingContainer.appendChild(toggleButton);
      thinkingContainer.appendChild(thinkingContent);
      msgDiv.appendChild(thinkingContainer);
    }
    
    this.container.appendChild(msgDiv);
    this.container.scrollTop = this.container.scrollHeight;
    return msgDiv;
  }

  /**
   * Add a thinking indicator message that can be replaced later
   */
  addThinkingIndicator() {
    const indicator = this.appendMessage("assistant", "<em>Thinking...</em>");
    if (indicator) {
      indicator.setAttribute("id", this.thinkingMessageId);
    }
    return indicator;
  }

  /**
   * Remove the thinking indicator
   */
  removeThinkingIndicator() {
    const indicator = document.getElementById(this.thinkingMessageId);
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Add a visual image indicator to the last user message
   */
  addImageIndicator(imageUrl) {
    if (!this.container) return;
    
    const msgDivs = this.container.querySelectorAll("div.bg-blue-50");
    const lastUserDiv = msgDivs?.[msgDivs.length - 1];
    
    if (lastUserDiv) {
      const imgContainer = this._createDomElement("div", {
        className: "flex items-center bg-gray-50 rounded p-1 mt-2"
      });

      const imgElement = document.createElement("img");
      imgElement.className = "h-10 w-10 object-cover rounded mr-2";
      imgElement.src = document.getElementById('chatPreviewImg')?.src || imageUrl;
      imgElement.alt = "Attached Image";
      
      imgContainer.appendChild(imgElement);

      const imgLabel = this._createDomElement("div", {
        className: "text-xs text-gray-500"
      }, "📷 Image attached");
      
      imgContainer.appendChild(imgLabel);
      lastUserDiv.appendChild(imgContainer);
    }
  }

  /**
   * Render a list of messages
   */
  renderMessages(messages) {
    this.clear();
    
    if (!messages || messages.length === 0) {
      this.appendMessage("system", "No messages in this conversation yet");
      return;
    }
    
    messages.forEach(msg => {
      const metadata = msg.metadata || {};
      this.appendMessage(
        msg.role, 
        msg.content, 
        metadata.thinking, 
        metadata.redacted_thinking, 
        metadata
      );
    });
  }

  // Helper methods
  _getMessageClass(role) {
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

  _createDomElement(type, attributes = {}, children = []) {
    if (typeof window.createDomElement === 'function') {
      return window.createDomElement(type, attributes, children);
    }
    
    const element = document.createElement(type);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'class' || key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([prop, val]) => {
          element.style[prop] = val;
        });
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventType = key.substring(2).toLowerCase();
        element.addEventListener(eventType, value);
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }
    
    return element;
  }

  _defaultFormatText(text) {
    // Very simple formatter that escapes HTML and preserves line breaks
    const escapeHtml = (str) => {
      return str.replace(/[&<>"']/g, (m) => {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[m];
      });
    };
    
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}
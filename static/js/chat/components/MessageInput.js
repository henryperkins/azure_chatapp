/**
 * MessageInput.js
 * Handles user input for chat messages
 */

export default class MessageInput {
  constructor(options = {}) {
    this.inputSelector = options.inputSelector || '#chatInput';
    this.sendButtonSelector = options.sendButtonSelector || '#sendBtn';
    this.onSend = options.onSend || (() => {});
    
    this.input = document.querySelector(this.inputSelector);
    this.sendButton = document.querySelector(this.sendButtonSelector);
    
    this._setupEventListeners();
  }

  /**
   * Get the current input value
   */
  getValue() {
    return this.input ? this.input.value.trim() : '';
  }

  /**
   * Clear the input field
   */
  clear() {
    if (this.input) {
      this.input.value = '';
    }
  }

  /**
   * Focus the input field
   */
  focus() {
    if (this.input) {
      this.input.focus();
    }
  }

  /**
   * Enable or disable the input
   */
  setEnabled(enabled) {
    if (this.input) {
      this.input.disabled = !enabled;
    }
    if (this.sendButton) {
      this.sendButton.disabled = !enabled;
    }
  }

  /**
   * Set up event listeners for input and button
   */
  _setupEventListeners() {
    this._setupKeyboardHandler();
    this._setupSendButton();
  }

  /**
   * Set up keyboard handler (Enter key)
   */
  _setupKeyboardHandler() {
    const setupHandler = () => {
      if (!this.input) {
        console.error("Chat input not found in DOM. Will retry in 500ms.");
        setTimeout(setupHandler, 500);
        return;
      }
      
      console.log("Setting up keyboard event listener");
      
      this.input.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          this._handleSendMessage();
        }
      });
    };
    
    setupHandler();
  }

  /**
   * Set up send button click handler
   */
  _setupSendButton() {
    const setupHandler = () => {
      if (!this.sendButton) {
        console.error("Send button not found in DOM. Will retry in 500ms.");
        setTimeout(setupHandler, 500);
        return;
      }
      
      console.log("Setting up send button event listener");
      
      this.sendButton.addEventListener("click", () => {
        this._handleSendMessage();
      });
    };
    
    setupHandler();
  }

  /**
   * Handle send message action
   */
  _handleSendMessage() {
    const message = this.getValue();
    
    if (message) {
      this.onSend(message);
      this.clear();
    }
  }
}
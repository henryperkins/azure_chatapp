/**
 * chat-messages.js
 * Message handling service for chat functionality.
 * Manages sending and receiving messages, including AI model configurations and message-specific error processing.
 */

// Define MessageService as a constructor function attached to window
window.MessageService = function (options = {}) {
  this.onMessageReceived = options.onMessageReceived || (() => { });
  this.onSending = options.onSending || (() => { });
  this.onError = options.onError || ((context, error) => window.ChatUtils.handleError(context, error));
  this.chatId = null;

  // Initialize with current model configuration if available
  this.modelConfig = window.MODEL_CONFIG || {
    modelName: localStorage.getItem("modelName") || "claude-3-sonnet-20240229",
    maxTokens: parseInt(localStorage.getItem("maxTokens") || "500", 10),
    extendedThinking: localStorage.getItem("extendedThinking") === "true",
    thinkingBudget: parseInt(localStorage.getItem("thinkingBudget") || "16000", 10),
    reasoningEffort: localStorage.getItem("reasoningEffort") || "medium",
    visionEnabled: localStorage.getItem("visionEnabled") === "true",
    visionDetail: localStorage.getItem("visionDetail") || "auto"
  };

  console.log("MessageService initialized with model config:", this.modelConfig);
};

/**
 * Clear all message state.
 */
window.MessageService.prototype.clear = function () {
  this.chatId = null;

  try {
    // Clear any UI state with empty array via callback
    if (typeof this.onMessageReceived === 'function') {
      this.onMessageReceived([]);
    }
  } catch (error) {
    console.error('Error clearing messages:', error);
    window.ChatUtils.handleError('Clearing messages', error);
  }
};

/**
 * Count tokens using Claude's token counting API.
 * @param {string} text - Text to count tokens for
 * @returns {Promise<number>} - Number of tokens
 */
window.MessageService.prototype.countClaudeTokens = async function (text) {
  try {
    const response = await window.apiRequest(
      '/api/claude/count_tokens',
      'POST',
      { text, model: this.modelConfig?.modelName }
    );
    return response.data?.input_tokens || Math.ceil(text.length / 4);
  } catch (error) {
    window.ChatUtils.handleError('Counting tokens', error);
    return Math.ceil(text.length / 4); // Fallback
  }
};

/**
 * Initialize the service with a chat ID.
 * @param {string} chatId - Conversation ID to initialize with
 */
window.MessageService.prototype.initialize = function (chatId) {
  this.chatId = chatId;
  console.log(`MessageService initialized for chat ID: ${chatId}`);
};

/**
 * Update the model configuration.
 * @param {Object} config - New model configuration
 */
window.MessageService.prototype.updateModelConfig = function (config) {
  // Store current model configuration for message sending
  this.modelConfig = config;
  console.log("MessageService updated with new model config:", config);
};

/**
 * Send a message to the current conversation.
 * @param {string|Object} content - Message content or object to send
 * @returns {Promise<Object>} - Response from the server
 */
window.MessageService.prototype.sendMessage = async function (content) {
  if (!this.chatId) {
    throw new Error('Invalid conversation ID: No conversation ID set');
  }

  if (!window.ChatUtils.isValidUUID(this.chatId)) {
    console.error(`Cannot send message: Invalid conversation ID format: ${this.chatId}`);
    throw new Error(`Invalid conversation ID: ${this.chatId}`);
  }

  // Notify UI that message is being sent
  if (typeof this.onSending === 'function') {
    this.onSending();
  }

  // Create the message payload with Claude-specific fields
  const messagePayload = {
    content: typeof content === 'string' ? content : content.content,
    role: "user",
    type: "message",
    vision_detail: this.modelConfig?.visionDetail || "auto"
  };

  // If this is a system message, handle it specially for Claude API
  if ((typeof content === 'string' && content.startsWith('system:')) || (typeof content === 'object' && content.role === 'system')) {
    // Extract system message content
    let systemContent = '';
    if (typeof content === 'string' && content.startsWith('system:')) {
      systemContent = content.substring(7).trim();
      // Update the regular content to be empty or a default user message
      messagePayload.content = '';
    } else if (typeof content === 'object' && content.role === 'system') {
      systemContent = content.content;
      messagePayload.content = '';
    }

    // Add system content as a top-level parameter as required by Claude API
    if (systemContent) {
      messagePayload.system = systemContent;
    }
  }

  // Add extended thinking config if enabled
  if (this.modelConfig?.extendedThinking) {
    messagePayload.thinking = {
      type: "enabled",
      budget_tokens: Math.max(
        1024, // Minimum required by Claude
        Math.min(
          this.modelConfig.thinkingBudget || 16000,
          this.modelConfig.maxTokens - 1000 // Leave room for response
        )
      )
    };
  }

  // Add image data if present
  if (this.currentImage) {
    messagePayload.image_data = this.currentImage;
    this.currentImage = null; // Clear after using
  }

  // Add model configuration details
  if (this.modelConfig) {
    messagePayload.vision_detail = this.modelConfig.visionDetail || "auto";
    messagePayload.enable_thinking = this.modelConfig.enableThinking || false;
    messagePayload.thinking_budget = this.modelConfig.thinkingBudget || null;
  }

  try {
    return await this._sendMessageHttp(messagePayload);
  } catch (error) {
    window.ChatUtils.handleError('Sending message', error);
    throw error;
  }
};

/**
 * HTTP implementation for message sending.
 * @param {Object} messagePayload - Payload to send
 * @returns {Promise<Object>} - Server response
 * @private
 */
window.MessageService.prototype._sendMessageHttp = async function (messagePayload) {
  // Validate conversation ID again before HTTP request
  if (!this.chatId || !window.ChatUtils.isValidUUID(this.chatId)) {
    throw new Error('Invalid conversation ID');
  }

  // Add authentication check using centralized utility
  const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
  if (!isAuthenticated) {
    throw new Error('Not authenticated - please login first');
  }

  try {
    // Construct the API endpoint URL
    const projectId = window.ChatUtils.getProjectId();
    const chatId = this.chatId;

    if (!chatId) {
      throw new Error('No conversation ID is set, cannot send messages');
    }

    let apiUrl;
    if (projectId) {
      apiUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
    } else {
      apiUrl = `/api/chat/conversations/${chatId}/messages`;
    }

    // Make the HTTP request
    const response = await window.apiRequest(apiUrl, 'POST', messagePayload);

    // Parse and handle the response
    if (response.data?.assistant_message) {
      // Handle assistant response message
      if (typeof this.onMessageReceived === 'function') {
        this.onMessageReceived({
          role: 'assistant',
          content: response.data.assistant_message.content,
          thinking: response.data.thinking,
          redacted_thinking: response.data.redacted_thinking,
          metadata: response.data.assistant_message.metadata || {}
        });
      }
    } else if (response.data?.assistant_error) {
      // Extract detailed error information
      const errorMsg = this._extractAIErrorMessage(response.data.assistant_error);
      throw new Error(errorMsg);
    }

    return response.data;
  } catch (error) {
    window.ChatUtils.handleError('HTTP message send', error);
    throw error;
  }
};

/**
 * Extract detailed error message from AI response error.
 * @param {string|Object} errorStr - Error message or object from AI
 * @returns {string} - User-friendly error message
 * @private
 */
window.MessageService.prototype._extractAIErrorMessage = function (errorStr) {
  // Ensure errorStr is a string to avoid errors
  if (errorStr === null || errorStr === undefined) {
    return "AI couldn't generate a response due to an unknown error.";
  }

  // Handle object errors more gracefully
  if (typeof errorStr === 'object') {
    const errorMessage = errorStr.message || errorStr.error || errorStr.description ||
      errorStr.details || errorStr.reason;
    if (errorMessage) {
      return this._extractAIErrorMessage(errorMessage); // Process the extracted message
    }
    const keys = Object.keys(errorStr);
    if (keys.length > 0) {
      try {
        return `AI generation error: ${JSON.stringify(errorStr)}`;
      } catch (e) {
        return `AI generation error: Object with properties [${keys.join(', ')}]`;
      }
    }
  }

  // Convert to string if it's not already a string
  const errorString = typeof errorStr === 'string' ? errorStr : String(errorStr);

  // If it's a generic "Failed to generate response" error, provide more context
  if (errorString === "Failed to generate response") {
    return "AI couldn't generate a response. This may be due to content moderation, system load, or connection issues. Please try again or rephrase your message.";
  }

  // Handle Claude credit balance errors
  if (errorString.includes("credit balance") || errorString.includes("Plans & Billing")) {
    return "Your Claude API credit balance is too low. Please go to Plans & Billing to upgrade or purchase credits.";
  }

  // Handle common error patterns and map to better user-facing messages
  if (errorString.includes("token") && errorString.includes("limit")) {
    return "Response exceeded maximum length. Please try a shorter prompt or break your request into smaller parts.";
  }

  if (errorString.includes("content policy") || errorString.includes("moderation")) {
    return "Your request was flagged by content moderation. Please modify your message and try again.";
  }

  if (errorString.includes("rate limit") || errorString.includes("throttling")) {
    return "Too many requests. Please wait a moment before trying again.";
  }

  if (errorString.includes("timeout")) {
    return "The AI response timed out. This could be due to high system load or a complex request. Please try again later.";
  }

  // If we can't categorize the error, return the original with a prefix
  return `AI generation error: ${errorString}`;
};

/**
 * Check if knowledge base is enabled for a project.
 * @param {string} projectId - The project ID to check
 * @returns {Promise<{enabled: boolean, error?: boolean}>}
 * @private
 */
window.MessageService.prototype._checkKnowledgeBaseStatus = async function (projectId) {
  try {
    const response = await window.apiRequest(
      `/api/projects/${projectId}/knowledge-base-status`,
      "GET"
    );
    return { enabled: response.data?.isActive || false };
  } catch (error) {
    console.warn("Error checking knowledge base status:", error);
    window.ChatUtils.handleError('Checking knowledge base status', error);
    return { enabled: false, error: true };
  }
};

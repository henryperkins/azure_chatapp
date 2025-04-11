/**
 * chat-messages.js
 * Message handling service for chat functionality
 */

// Define MessageService as a constructor function attached to window
window.MessageService = function (options = {}) {
  this.onMessageReceived = options.onMessageReceived || (() => { });
  this.onSending = options.onSending || (() => { });
  this.onError = options.onError || ((context, error) => window.ChatUtils?.handleError(context, error));
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
 * Clear all message state
 */
window.MessageService.prototype.clear = function() {
  this.chatId = null;
  
  
  try {
    // Clear any UI state with empty array
    if (typeof this.onMessageReceived === 'function') {
      this.onMessageReceived([]);
    }
  } catch (error) {
    console.error('Error clearing messages:', error);
  }
  
};

/**
 * Count tokens using Claude's token counting API
 */
window.MessageService.prototype.countClaudeTokens = async function(text) {
  try {
    const response = await window.apiRequest(
      '/api/claude/count_tokens', 
      'POST',
      { text, model: this.modelConfig?.modelName }
    );
    return response.data?.input_tokens || Math.ceil(text.length / 4);
  } catch {
    return Math.ceil(text.length / 4); // Fallback
  }
};

/**
 * Initialize the service with a chat ID and optional WebSocket service
 */
window.MessageService.prototype.initialize = function (chatId) {
  this.chatId = chatId;
};

/**
 * Helper function to validate UUIDs in MessageService
 */
window.MessageService.prototype._isValidUUID = function (uuid) {
  if (!uuid) {
    console.warn('UUID validation failed: UUID is null or undefined');
    return false;
  }
  const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  if (!isValid) {
    console.warn(`UUID validation failed for: ${uuid}`);
  }
  return isValid;
};

/**
 * Update the model configuration
 */
window.MessageService.prototype.updateModelConfig = function (config) {
  // Store current model configuration for message sending
  this.modelConfig = config;
  console.log("MessageService updated with new model config:", config);
};

/**
 * Send a message (user_message) using WebSocket if available or HTTP fallback
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
    content: content,
    role: "user", 
    type: "message",
    vision_detail: this.modelConfig?.visionDetail || "auto"
  };

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
    // Only handle error if it hasn't been handled yet
    if (!error._handled) {
      window.ChatUtils?.handleError?.('Sending message', error) ||
        this.onError('Sending message', error);
      error._handled = true;
    }
    throw error;
  }
};

/**
 * HTTP fallback for message sending
 */
window.MessageService.prototype._sendMessageHttp = async function (messagePayload) {
  // Validate conversation ID again before HTTP request
  if (!this.chatId || !window.ChatUtils.isValidUUID(this.chatId)) {
    throw new Error('Invalid conversation ID');
  }

  // Add authentication check with improved error handling
  try {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
  } catch (authError) {
    console.warn('[MessageService] Authentication error when sending message:', authError);
    window.auth.handleAuthError(authError, "sending message");
    throw authError;
  }

  try {
      // Construct the API endpoint URL
      const projectId = localStorage.getItem('selectedProjectId')?.trim();
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
    // Enhanced error handling
    const enhancedError = this._handleAIError(error);
    window.ChatUtils?.handleError?.('HTTP message', enhancedError) ||
      this.onError('HTTP send', enhancedError);
    throw enhancedError;
  }
};

/**
 * Extract detailed error message from AI response error
 * @param {string} errorStr - Error message from AI
 * @returns {string} - User-friendly error message
 */
window.MessageService.prototype._extractAIErrorMessage = function(errorStr) {
  // If it's a generic "Failed to generate response" error, provide more context
  if (errorStr === "Failed to generate response") {
    return "AI couldn't generate a response. This may be due to content moderation, system load, or connection issues. Please try again or rephrase your message.";
  }
  
  // Handle Claude credit balance errors
  if (errorStr.includes("credit balance") || errorStr.includes("Plans & Billing")) {
    return "Your Claude API credit balance is too low. Please go to Plans & Billing to upgrade or purchase credits.";
  }
  
  // Handle common error patterns and map to better user-facing messages
  if (errorStr.includes("token") && errorStr.includes("limit")) {
    return "Response exceeded maximum length. Please try a shorter prompt or break your request into smaller parts.";
  }
  
  if (errorStr.includes("content policy") || errorStr.includes("moderation")) {
    return "Your request was flagged by content moderation. Please modify your message and try again.";
  }
  
  if (errorStr.includes("rate limit") || errorStr.includes("throttling")) {
    return "Too many requests. Please wait a moment before trying again.";
  }
  
  if (errorStr.includes("timeout")) {
    return "The AI response timed out. This could be due to high system load or a complex request. Please try again later.";
  }
  
  // If we can't categorize the error, return the original with a prefix
  return `AI generation error: ${errorStr}`;
};

/**
 * Transform general errors into more specific AI errors
 */
window.MessageService.prototype._handleAIError = function(error) {
  // If it's already an Error object
  if (error instanceof Error) {
    // For the generic "Failed to generate response" error
    if (error.message === "Failed to generate response") {
      error.message = this._extractAIErrorMessage("Failed to generate response");
      error.code = "AI_GENERATION_FAILED";
      error.userAction = "Try rephrasing your query or waiting a moment before trying again.";
    }
    return error;
  }
  
  // If it's a string, create a proper Error
  if (typeof error === 'string') {
    const enhancedError = new Error(this._extractAIErrorMessage(error));
    enhancedError.code = "AI_GENERATION_FAILED";
    enhancedError.originalMessage = error;
    return enhancedError;
  }
  
  // If it's an API error object with status
  if (error.status) {
    const statusCode = error.status;
    let message = error.message || "Unknown error";
    
    // Check for credit balance issues in the error message or response
    if (statusCode === 400 && 
        (message.includes("credit balance") || 
         message.includes("Plans & Billing") || 
         (error.response && error.response.data && 
          error.response.data.assistant_error && 
          (error.response.data.assistant_error.includes("credit balance") || 
           error.response.data.assistant_error.includes("Plans & Billing"))))) {
      message = "Your Claude API credit balance is too low. Please go to Plans & Billing to upgrade or purchase credits.";
    }
    // Map HTTP status codes to better error messages
    else if (statusCode === 429) {
      message = "Too many requests. Please wait a moment before trying again.";
    } else if (statusCode === 400 && message.includes("Failed to generate")) {
      message = this._extractAIErrorMessage("Failed to generate response");
    } else if (statusCode >= 500) {
      message = "The AI service is currently unavailable. Please try again later.";
    }
    
    const enhancedError = new Error(message);
    enhancedError.status = statusCode;
    enhancedError.code = "AI_SERVICE_ERROR";
    enhancedError.originalError = error;
    return enhancedError;
  }
  
  // Return original if we can't enhance it
  return error;
};


/**
 * Check if knowledge base is enabled for a project
 * @param {string} projectId - The project ID to check
 * @returns {Promise<{enabled: boolean, error?: boolean}>}
 */
window.MessageService.prototype._checkKnowledgeBaseStatus = async function(projectId) {
  try {
    const response = await window.apiRequest(
      `/api/projects/${projectId}/knowledge-base-status`,
      "GET"
    );
    return { enabled: response.data?.isActive || false };
  } catch (error) {
    console.warn("Error checking knowledge base status:", error);
    return { enabled: false, error: true };
  }
};

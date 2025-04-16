/**
 * chat-conversations.js
 * Conversation management service for chat functionality.
 * Handles conversation lifecycle including creation, loading, and deletion.
 */

// Define ConversationService as a constructor function attached to window
window.ConversationService = class ConversationService {
  /**
   * Constructor for ConversationService.
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.onConversationLoaded = options.onConversationLoaded || (() => { });
    this.onError = options.onError || ((context, error) => window.ChatUtils.handleError(context, error));
    this.onLoadingStart = options.onLoadingStart || (() => { });
    this.onLoadingEnd = options.onLoadingEnd || (() => { });
    this.onConversationDeleted = options.onConversationDeleted || (() => { });
    this.currentConversation = null;
  }

  /**
   * Validate a UUID string.
   * @param {string} uuid - UUID to validate
   * @returns {boolean} - Whether the UUID is valid
   * @private
   */
  _isValidUUID(uuid) {
    return window.ChatUtils.isValidUUID(uuid);
  }

  /**
   * Handle redacted thinking in message content.
   * @param {Object} data - Message data
   * @returns {Object} - Modified message data
   * @private
   */
  _handleRedactedThinking(data) {
    return {
      ...data,
      content: data.redacted_thinking ?
        "[Some reasoning was redacted for safety]" :
        data.content
    };
  }

  /**
   * Check if text fits within the context window for a model.
   * @param {string} model - Model name
   * @param {string} text - Text to check
   * @returns {boolean} - Whether text fits within context window
   * @private
   */
  _checkContextWindow(model, text) {
    const MAX_TOKENS = {
      "claude-3-7-sonnet-20250219": 128000,
      "claude-3-opus-20240229": 200000,
      "claude-3-sonnet-20240229": 200000
    };
    return (text.length / 4) < (MAX_TOKENS[model] * 0.9); // 90% safety margin
  }

  /**
   * Load a conversation by ID.
   * @param {string} chatId - Conversation ID to load
   * @returns {Promise<boolean>} - Success status
   */
  async loadConversation(chatId) {
    if (!chatId || !this._isValidUUID(chatId)) {
      window.ChatUtils.handleError('Loading conversation', new Error('Invalid conversation ID'));
      return false;
    }

    // Use centralized auth check
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      window.ChatUtils.showNotification("Please log in to access conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      // Log the chatId being attempted
      console.log(`[ConversationService] Loading conversation with ID: ${chatId}`);
      // First determine if the conversation belongs to a project
      let convUrl = `/api/conversations/${chatId}`; // Default to standalone endpoint
      let msgUrl = `/api/conversations/${chatId}/messages`;
      let conversation, messages;
      let isProjectConversation = false;
      let projectId = window.ChatUtils.getProjectId();

      // Log project context for debugging
      console.log(`[ConversationService] Attempting load with projectId: ${projectId || 'none'}`);

      // Use project-specific endpoint if projectId is available and valid
      if (projectId && this._isValidUUID(projectId)) {
        convUrl = `/api/projects/${projectId}/conversations/${chatId}`;
        msgUrl = `/api/projects/${projectId}/conversations/${chatId}/messages`;
        isProjectConversation = true;
        console.log(`[ConversationService] Using project-specific endpoint: ${convUrl}`);
      } else if (projectId) {
        console.warn(`[ConversationService] Invalid project ID detected: ${projectId}, falling back to standalone endpoint`);
        projectId = null; // Reset to avoid using invalid ID
      } else {
        console.warn("[ConversationService] No project ID found, attempting standalone conversation load");
      }

      try {
        console.log(`[ConversationService] Fetching conversation from ${convUrl}`);
        conversation = await window.apiRequest(convUrl, "GET");
        console.log(`[ConversationService] Successfully loaded conversation from ${convUrl}`);
      } catch (error) {
        console.error(`[ConversationService] Failed to load conversation from ${convUrl}:`, error);
        if (error.status === 404 && isProjectConversation) {
          // Fallback to standalone endpoint if project-specific fails
          console.log(`[ConversationService] Project-based load failed for ${projectId}, trying standalone endpoint.`);
          convUrl = `/api/conversations/${chatId}`;
          isProjectConversation = false;
          conversation = await window.apiRequest(convUrl, "GET").catch(standaloneError => {
            console.error(`[ConversationService] Standalone endpoint also failed from ${convUrl}:`, standaloneError);
            throw standaloneError;
          });
          console.log(`[ConversationService] Successfully loaded conversation from standalone endpoint`);
        } else if (error.status === 401) {
          window.ChatUtils.showNotification("Session expired, please log in again", "error");
          throw new Error("Authentication failed (401)");
        } else if (error.status === 403) {
          window.ChatUtils.showNotification("Access denied to this conversation", "error");
          throw new Error("Access denied (403)");
        } else if (error.status === 404) {
          window.ChatUtils.showNotification("Conversation not found", "error");
          throw new Error("Conversation not found (404)");
        } else {
          throw new Error(`Failed to load conversation: ${error.message || 'Unknown error'} (Status: ${error.status || 'N/A'})`);
        }
      }

      // If we got here, we have a valid conversation
      if (isProjectConversation) {
        msgUrl = `/api/projects/${projectId}/conversations/${chatId}/messages`;
      } else if (conversation.project_id && this._isValidUUID(conversation.project_id)) {
        projectId = conversation.project_id;
        msgUrl = `/api/projects/${projectId}/conversations/${chatId}/messages`;
        isProjectConversation = true;
        console.log(`[ConversationService] Updated projectId from conversation data: ${projectId}`);
      }

      // Now get messages using the correct endpoint
      try {
        console.log(`[ConversationService] Fetching messages from ${msgUrl}`);
        messages = await window.apiRequest(msgUrl, "GET");
        console.log(`[ConversationService] Successfully loaded messages from ${msgUrl}`);
      } catch (error) {
        console.error(`[ConversationService] Message retrieval failed from ${msgUrl}:`, error);
        if (error.status === 404) {
          let fallbackProjectId = projectId || conversation.project_id || window.ChatUtils.getProjectId();
          if (fallbackProjectId && this._isValidUUID(fallbackProjectId)) {
            console.log(`[ConversationService] Message retrieval failed with endpoint ${msgUrl}. Trying project endpoint with ID ${fallbackProjectId}.`);
            msgUrl = `/api/projects/${fallbackProjectId}/conversations/${chatId}/messages`;
            try {
              console.log(`[ConversationService] Attempting fallback to: ${msgUrl}`);
              messages = await window.apiRequest(msgUrl, "GET");
              console.log(`[ConversationService] Fallback to project endpoint for messages succeeded.`);
            } catch (fallbackError) {
              console.error(`[ConversationService] Fallback also failed: ${fallbackError.message}. Using empty messages.`);
              messages = { data: { messages: [] } };
              window.ChatUtils.showNotification("Failed to load messages, displaying conversation without content", "warning");
            }
          } else {
            console.error("[ConversationService] No valid fallback project ID available. Using empty messages.");
            messages = { data: { messages: [] } };
          }
        } else {
          throw new Error(`Failed to load messages: ${error.message || 'Unknown error'} (Status: ${error.status || 'N/A'})`);
        }
      }

      this.currentConversation = {
        id: chatId,
        ...(conversation.data || conversation),
        messages: messages.data?.messages || []
      };

      this.onConversationLoaded(this.currentConversation);
      this.onLoadingEnd();
      return true;
    } catch (error) {
      this.onLoadingEnd();
      let errorMessage = 'Failed to load conversation';
      if (error.message.includes('Authentication failed')) {
        errorMessage = 'Session expired - please log in again';
      } else if (error.message.includes('not found')) {
        errorMessage = 'Conversation not found - it may have been deleted or moved';
      } else if (error.message.includes('Access denied')) {
        errorMessage = 'You do not have permission to access this conversation';
      } else {
        errorMessage = `Failed to load conversation: ${error.message}`;
      }
      console.error(`[ConversationService] ${errorMessage}`, error);
      window.ChatUtils.handleError('Loading conversation', new Error(errorMessage));
      return false;
    }
  }


  /**
   * Create a new conversation with a direct token (for specific auth scenarios).
   * @param {string} token - Authentication token
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} - Created conversation
   */
  async createNewConversationWithToken(token, maxRetries = 2) {
    if (!token) {
      throw new Error("Token is required for direct token conversation creation");
    }

    console.log(`Creating new conversation with direct token (first ${token.substring(0, 10)}...)`);
    const defaultTitle = `New Chat ${new Date().toLocaleString()}`;
    const model = window.MODEL_CONFIG?.modelName ||
      localStorage.getItem("modelName") ||
      "claude-3-7-sonnet-20250219";

    // Validate model against supported Claude models
    const CLAUDE_MODELS = [
      "claude-3-7-sonnet-20250219",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229"
    ];

    if (!CLAUDE_MODELS.includes(model)) {
      throw new Error(`Unsupported model: ${model}`);
    }

    const projectId = window.ChatUtils.getProjectId();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = projectId
          `/api/projects/${projectId}/conversations`;

        // Custom fetch implementation that uses the provided token directly
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            title: defaultTitle,
            model_id: model
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Server error: ${response.status}`);
        }

        const data = await response.json();
        const conversation = data.data?.id
          ? data.data
          : (data.id ? data : { id: null });

        if (!conversation.id) throw new Error("Invalid response format");

        this.currentConversation = conversation;
        console.log(`Successfully created conversation with direct token: ${conversation.id}`);
        return conversation;
      } catch (error) {
        if (attempt === maxRetries) {
          console.error('Failed to create conversation with direct token:', error);
          window.ChatUtils.handleError('Creating conversation with token', error);
          throw error;
        }

        console.warn(`Direct token conversation creation attempt ${attempt + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  /**
   * Create a new conversation.
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} - Created conversation
   */
  async createNewConversation(maxRetries = 2) {
    // First verify auth state using centralized utility
    const isAuthenticated = await window.ChatUtils.isAuthenticated();
    if (!isAuthenticated) {
      window.ChatUtils.showNotification("Please log in to create conversations", "error");
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: false }
      }));
      throw new Error("Not authenticated");
    }

    const projectId = window.ChatUtils.getProjectId();
    const model = window.MODEL_CONFIG?.modelName ||
      localStorage.getItem("modelName") ||
      "claude-3-7-sonnet-20250219";

    // Validate model against supported Claude models
    const CLAUDE_MODELS = [
      "claude-3-7-sonnet-20250219",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229"
    ];

    if (!CLAUDE_MODELS.includes(model)) {
      throw new Error(`Unsupported model: ${model}`);
    }

    console.log(`Creating new conversation with model: ${model}`);
    const defaultTitle = `New Chat ${new Date().toLocaleString()}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!projectId) {
          throw new Error("No project is currently selected. Please select a project before creating a conversation.");
        }
        const url = `/api/projects/${projectId}/conversations`;

        const data = await window.apiRequest(url, "POST", {
          title: defaultTitle,
          model_id: model
        });

        const conversation = data.data?.id
          ? data.data
          : (data.id ? data : { id: null });

        if (!conversation.id) throw new Error("Invalid response format");

        this.currentConversation = conversation;
        return conversation;
      } catch (error) {
        if (attempt === maxRetries) {
          window.ChatUtils.handleError('Creating conversation', error);
          throw error;
        }

        console.warn(`Conversation creation attempt ${attempt + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  /**
   * Delete a conversation.
   * @param {string} chatId - Conversation ID to delete
   * @param {string} projectId - Project ID (optional, fetched if not provided)
   * @returns {Promise<boolean>} - Success status
   */
  async deleteConversation(chatId, projectId = window.ChatUtils.getProjectId()) {
    if (!chatId || !this._isValidUUID(chatId)) {
      window.ChatUtils.handleError('Deleting conversation', new Error('Invalid conversation ID'));
      return false;
    }

    // Use centralized auth check
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      window.ChatUtils.showNotification("Please log in to delete conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      const finalProjectId = projectId;
      if (!finalProjectId) {
        throw new Error("Project ID is required for conversation deletion");
      }
      const deleteUrl = `/api/projects/${finalProjectId}/conversations/${chatId}`;

      await window.apiRequest(deleteUrl, "DELETE");

      if (this.currentConversation?.id === chatId) {
        this.currentConversation = null;
      }

      this.onLoadingEnd();
      this.onConversationDeleted(chatId);
      window.ChatUtils.showNotification("Conversation deleted successfully", "success");
      return true;
    } catch (error) {
      this.onLoadingEnd();
      window.ChatUtils.handleError('Deleting conversation', error);
      return false;
    }
  }
};

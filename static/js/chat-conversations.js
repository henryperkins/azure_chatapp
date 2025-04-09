/**
 * chat-conversations.js
 * Conversation management service for chat functionality
 * Uses auth.js exclusively for authentication
 */

// Converted from ES module to global reference
if (typeof apiRequest === 'undefined') {
  const apiRequest = window.apiRequest;
}

window.ConversationService = class ConversationService {
  _handleRedactedThinking(data) {
    return {
      ...data,
      content: data.redacted_thinking ?
        "[Some reasoning was redacted for safety]" :
        data.content
    };
  }

  _checkContextWindow(model, text) {
    const MAX_TOKENS = {
      "claude-3-7-sonnet-20250219": 128000,
      "claude-3-opus-20240229": 200000,
      "claude-3-sonnet-20240229": 200000
    };

    return (text.length / 4) < (MAX_TOKENS[model] * 0.9); // 90% safety margin
  }

  constructor(options = {}) {
    this.onConversationLoaded = options.onConversationLoaded || (() => { });
    this.onError = options.onError || ((context, error) => window.ChatUtils?.handleError(context, error, options.showNotification));
    this.onLoadingStart = options.onLoadingStart || (() => { });
    this.onLoadingEnd = options.onLoadingEnd || (() => { });
    this.onConversationDeleted = options.onConversationDeleted || (() => { });
    this.showNotification = options.showNotification || window.showNotification || console.log;
    this.currentConversation = null;
  }

  _isValidUUID(uuid) {
    if (!uuid) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  }

  async loadConversation(chatId) {
    if (!chatId || !this._isValidUUID(chatId)) {
      this.onError('Loading conversation', new Error('Invalid conversation ID'));
      return false;
    }

    // Use auth.js for authentication check
    let isAuthenticated = false;
    try {
      isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
    } catch (e) {
      console.warn("[chat-conversations] Auth verification failed:", e);
      window.auth.handleAuthError(e, "loading conversation");
    }

    if (!isAuthenticated) {
      this.showNotification("Please log in to access conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      // First determine if the conversation belongs to a project
      // We'll try the standalone endpoint first
      let convUrl = `/api/chat/conversations/${chatId}`;
      let msgUrl = `/api/chat/conversations/${chatId}/messages`;
      let conversation, messages;
      let isProjectConversation = false;
      let projectId = null;
      
      try {
        // Try to load the conversation from the standalone endpoint
        conversation = await apiRequest(convUrl, "GET");
      } catch (error) {
        if (error.status === 404) {
          // If 404, the conversation might belong to a project
          // Get the project ID from the URL or localStorage
          projectId = window.location.pathname.includes('/projects/') 
            ? window.location.pathname.split('/')[2] 
            : localStorage.getItem("selectedProjectId");
            
          if (projectId) {
            // Try the project-specific endpoint
            console.log(`Conversation ${chatId} not found in standalone conversations. Trying project ${projectId}.`);
            convUrl = `/api/chat/projects/${projectId}/conversations/${chatId}`;
            msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
            isProjectConversation = true;
            conversation = await apiRequest(convUrl, "GET");
          } else {
            // If no project ID available, re-throw the original error
            throw error;
          }
        } else {
          // For other error types, re-throw
          throw error;
        }
      }
      
      // If we got here, we have a valid conversation.
      
      // Ensure we are using the correct msg URL based on where we found the conversation
      if (isProjectConversation) {
        msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
      } else if (conversation.project_id) {
        // If conversation was found via standalone endpoint but has a project_id
        // This is important - some endpoints might allow retrieving project conversations
        // via the standalone endpoint (for compatibility), but messages API might be strict
        projectId = conversation.project_id;
        msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
        isProjectConversation = true;
      }
      
      // Now get messages using the correct endpoint
      try {
        messages = await apiRequest(msgUrl, "GET");
      } catch (error) {
        if (error.status === 404) {
          // Even if we already tried to handle this by checking conversation.project_id earlier,
          // we'll still try to fall back to project endpoint if:
          // 1. We have a project ID from any source
          // 2. Or we can extract one from the conversation
          let fallbackProjectId = projectId || conversation.project_id;
          
          // Also try localStorage as a last resort
          if (!fallbackProjectId && localStorage) {
            fallbackProjectId = localStorage.getItem("selectedProjectId");
          }
          
          if (fallbackProjectId) {
            console.log(`Message retrieval failed with endpoint ${msgUrl}. Trying project endpoint with ID ${fallbackProjectId}.`);
            msgUrl = `/api/chat/projects/${fallbackProjectId}/conversations/${chatId}/messages`;
            
            try {
              console.log(`Attempting fallback to: ${msgUrl}`);
              messages = await apiRequest(msgUrl, "GET");
              console.log(`Fallback to project endpoint for messages succeeded.`);
            } catch (fallbackError) {
              // If even the fallback fails, throw the original error
              console.error(`Fallback also failed: ${fallbackError.message}`);
              throw error; 
            }
          } else {
            // No project ID available to try as fallback
            throw error;
          }
        } else {
          // For non-404 errors, just throw
          throw error;
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
      if (error.status === 404) {
        errorMessage = 'Conversation not found - it may have been deleted or moved';
      } else if (error.status === 401) {
        if (window.auth?.handleAuthError) {
          window.auth.handleAuthError(error, 'Loading conversation');
          return false;
        }
        errorMessage = 'Session expired - please log in again';
      }

      window.ChatUtils?.handleError?.(errorMessage, error, this.showNotification) ||
        this.onError('Loading conversation', new Error(errorMessage));

      return false;
    }
  }

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

    const projectId = localStorage.getItem("selectedProjectId");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = projectId
          ? `/api/projects/${projectId}/conversations`
          : `/api/chat/conversations`;
          
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
          throw error;
        }

        console.warn(`Direct token conversation creation attempt ${attempt + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  async createNewConversation(maxRetries = 2) {
    // First verify auth state using auth.js
    let authState = false;
    try {
      authState = await window.auth.isAuthenticated();
    } catch (e) {
      console.warn("[chat-conversations] Auth verification failed:", e);
    }

    if (!authState) {
      this.showNotification("Please log in to create conversations", "error");
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: false }
      }));
      throw new Error("Not authenticated");
    }

    const projectId = localStorage.getItem("selectedProjectId");
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
        const url = projectId
          ? `/api/projects/${projectId}/conversations`
          : `/api/chat/conversations`;

        const data = await apiRequest(url, "POST", {
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
          // Use auth.js for handling auth errors if available
          if (error.status === 401 && window.auth?.handleAuthError) {
            window.auth.handleAuthError(error, 'Creating conversation');
          } else {
            window.ChatUtils?.handleError?.('Creating conversation', error, this.showNotification) ||
              this.onError('Creating conversation', error);
          }
          throw error;
        }

        console.warn(`Conversation creation attempt ${attempt + 1} failed:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  async deleteConversation(chatId, projectId = localStorage.getItem("selectedProjectId")) {
    if (!chatId || !this._isValidUUID(chatId)) {
      this.onError('Deleting conversation', new Error('Invalid conversation ID'));
      return false;
    }

    // Use auth.js for authentication check
    let isAuthenticated = false;
    try {
      isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
    } catch (e) {
      console.warn("[chat-conversations] Auth verification failed:", e);
      window.auth.handleAuthError(e, "deleting conversation");
    }

    if (!isAuthenticated) {
      this.showNotification("Please log in to delete conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      const finalProjectId = projectId;
      if (!finalProjectId) {
        throw new Error("Project ID is required for conversation deletion");
      }
      const deleteUrl = `/api/projects/${finalProjectId}/conversations/${chatId}`;

      await apiRequest(deleteUrl, "DELETE");

      if (this.currentConversation?.id === chatId) {
        this.currentConversation = null;
      }

      this.onLoadingEnd();
      this.onConversationDeleted(chatId);
      this.showNotification("Conversation deleted successfully", "success");
      return true;
    } catch (error) {
      this.onLoadingEnd();

      // Use auth.js for handling auth errors if available
      if (error.status === 401 && window.auth?.handleAuthError) {
        window.auth.handleAuthError(error, 'Deleting conversation');
      } else {
        window.ChatUtils?.handleError?.('Deleting conversation', error, this.showNotification) ||
          this.onError('Deleting conversation', error);
      }

      return false;
    }
  }
}

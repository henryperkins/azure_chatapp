/**
 * chat-conversations.js
 * Conversation management service for chat functionality
 */

// Define ConversationService as a constructor function attached to window
window.ConversationService = function(options = {}) {
  this.onConversationLoaded = options.onConversationLoaded || (() => {});
  this.onError = options.onError || ((context, error) => window.ChatUtils?.handleError(context, error, options.showNotification));
  this.onLoadingStart = options.onLoadingStart || (() => {});
  this.onLoadingEnd = options.onLoadingEnd || (() => {});
  this.showNotification = options.showNotification || window.showNotification || console.log;
  this.currentConversation = null;
};

// Helper method to validate UUID
window.ConversationService.prototype._isValidUUID = function(uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// Load an existing conversation
window.ConversationService.prototype.loadConversation = async function(chatId) {
  if (!chatId || !this._isValidUUID(chatId)) {
    this.onError('Loading conversation', new Error('Invalid conversation ID'));
    return false;
  }

  // Use standardized auth check
  const authState = await window.ChatUtils?.isAuthenticated?.() || 
                   (window.auth?.verify ? await window.auth.verify() : false);
    
  if (!authState) {
    this.showNotification("Please log in to access conversations", "error");
    return false;
  }

  this.onLoadingStart();

  try {
    const projectId = localStorage.getItem("selectedProjectId");
    let convUrl, msgUrl;

    if (projectId) {
      convUrl = `/api/projects/${projectId}/conversations/${chatId}`;
      msgUrl = `/api/projects/${projectId}/conversations/${chatId}/messages`;
    } else {
      convUrl = `/api/chat/conversations/${chatId}`;
      msgUrl = `/api/chat/conversations/${chatId}/messages`;
    }

    // Include project_id in request if available
    const options = projectId ? { project_id: projectId } : {};
    
    // Use window.apiRequest for API requests
    const conversation = await window.apiRequest(convUrl, "GET", options);
    const messages = await window.apiRequest(msgUrl, "GET", options);

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
    
    // Use standardized error handling
    window.ChatUtils?.handleError?.('Loading conversation', error, this.showNotification) || 
    this.onError('Loading conversation', error);
    
    return false;
  }
};

// Create a new conversation with built-in retries
window.ConversationService.prototype.createNewConversation = async function(maxRetries = 2) {
  const projectId = localStorage.getItem("selectedProjectId");
  const model = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
  
  // Generate a default title with timestamp
  const defaultTitle = `New Chat ${new Date().toLocaleString()}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const url = projectId
        ? `/api/projects/${projectId}/conversations`
        : `/api/chat/conversations`;

      // Use window.apiRequest for API requests
      const data = await window.apiRequest(url, "POST", {
        title: defaultTitle,
        model_id: model
      });

      // Handle different API response formats
      const conversation = data.data?.id
        ? data.data
        : (data.id ? data : { id: null });

      if (!conversation.id) {
        throw new Error("Invalid response format");
      }

      this.currentConversation = conversation;
      return conversation;
    } catch (error) {
      if (attempt === maxRetries) {
        // Use standardized error handling on final attempt
        window.ChatUtils?.handleError?.('Creating conversation', error, this.showNotification) ||
        this.onError('Creating conversation', error);
        throw error;
      }
      
      console.warn(`Conversation creation attempt ${attempt + 1} failed:`, error);
      
      // Exponential-ish backoff
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
};
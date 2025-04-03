/**
 * chat-conversations.js
 * Conversation management service for chat functionality
 */

// Converted from ES module to global reference
if (typeof apiRequest === 'undefined') {
  const apiRequest = window.apiRequest;
}

// Add helper methods for Claude 3.7 Sonnet features
window.ConversationService.prototype._handleRedactedThinking = function(data) {
  return {
    ...data,
    content: data.redacted_thinking ? 
      "[Some reasoning was redacted for safety]" : 
      data.content
  };
};

window.ConversationService.prototype._checkContextWindow = function(model, text) {
  const MAX_TOKENS = {
    "claude-3-7-sonnet-20250219": 128000,
    "claude-3-opus-20240229": 200000, 
    "claude-3-sonnet-20240229": 200000
  };
  
  return (text.length / 4) < (MAX_TOKENS[model] * 0.9); // 90% safety margin
};

window.ConversationService = class ConversationService {
  constructor(options = {}) {
    this.onConversationLoaded = options.onConversationLoaded || (() => {});
    this.onError = options.onError || ((context, error) => window.ChatUtils?.handleError(context, error, options.showNotification));
    this.onLoadingStart = options.onLoadingStart || (() => {});
    this.onLoadingEnd = options.onLoadingEnd || (() => {});
    this.onConversationDeleted = options.onConversationDeleted || (() => {});
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

    const authState = await window.ChatUtils?.isAuthenticated?.() || 
                     (window.auth?.verify ? await window.auth.verify() : false);
    
    if (!authState) {
      this.showNotification("Please log in to access conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      const projectId = localStorage.getItem("selectedProjectId")?.trim();
      
      let convUrl, msgUrl;

      if (projectId) {
        convUrl = `/api/chat/projects/${projectId}/conversations/${chatId}`;
        msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
      } else {
        convUrl = `/api/chat/conversations/${chatId}`;
        msgUrl = `/api/chat/conversations/${chatId}/messages`;
      }

const conversation = await apiRequest(convUrl, "GET");
const messages = await apiRequest(msgUrl, "GET");

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
  window.ChatUtils?.handleError?.('Loading conversation', error, this.showNotification) ||
    this.onError('Loading conversation', error);
  return false;
}
  }

  async createNewConversation(maxRetries = 2) {
    // First verify auth state
    const authState = await window.ChatUtils?.isAuthenticated?.() ||
                     (window.auth?.verify ? await window.auth.verify() : false);
    
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
        window.ChatUtils?.handleError?.('Creating conversation', error, this.showNotification) ||
          this.onError('Creating conversation', error);
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

  const authState = await window.ChatUtils?.isAuthenticated?.() ||
    (window.auth?.verify ? await window.auth.verify() : false);

  if (!authState) {
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
    window.ChatUtils?.handleError?.('Deleting conversation', error, this.showNotification) ||
      this.onError('Deleting conversation', error);
    return false;
  }
}
}

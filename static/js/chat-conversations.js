/**
 * chat-conversations.js
 * Conversation management service for chat functionality
 */

// Converted from ES module to global reference
if (typeof apiRequest === 'undefined') {
  const apiRequest = window.apiRequest;
}

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
      const projectId = localStorage.getItem("selectedProjectId");
      let convUrl, msgUrl;

      if (projectId) {
        convUrl = `/ api / projects / ${ projectId } /conversations/${ chatId } `;
        msgUrl = `/ api / projects / ${ projectId } /conversations/${ chatId }/messages`;
      } else {
  convUrl = `/api/chat/conversations/${chatId}`;
  msgUrl = `/api/chat/conversations/${chatId}/messages`;
}

const options = projectId ? { project_id: projectId } : {};

const conversation = await apiRequest(convUrl, "GET", options);
const messages = await apiRequest(msgUrl, "GET", options);

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
  const projectId = localStorage.getItem("selectedProjectId");
  const model = window.MODEL_CONFIG?.modelName ||
    localStorage.getItem("modelName") ||
    "claude-3-sonnet-20240229";

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

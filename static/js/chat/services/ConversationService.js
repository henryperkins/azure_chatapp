/**
 * ConversationService.js
 * Manages conversation loading, creation, and history
 */

export default class ConversationService {
    constructor(options = {}) {
      this.onConversationLoaded = options.onConversationLoaded || (() => {});
      this.onError = options.onError || console.error;
      this.onLoadingStart = options.onLoadingStart || (() => {});
      this.onLoadingEnd = options.onLoadingEnd || (() => {});
      this.apiRequest = options.apiRequest || window.apiRequest || this._defaultApiRequest;
      this.showNotification = options.showNotification || window.showNotification || console.log;
      this.currentConversation = null;
    }
  
    async loadConversation(chatId) {
      if (!chatId || !this._isValidUUID(chatId)) {
        this.onError('Invalid conversation ID');
        return false;
      }
    
      // More strict authentication check
      if (!this._isAuthenticatedStrict()) {
        console.warn("Authentication required to load conversation");
        this.showNotification("Please log in to access conversations", "error");
        this.onError('Authentication required', new Error('Authentication required'));
        return false;
      }
    
      this.onLoadingStart();
    
      try {
        const conversationData = await this._fetchConversation(chatId);
        const messagesData = await this._fetchMessages(chatId);
        
        // Update current conversation data
        this.currentConversation = {
          id: chatId,
          ...conversationData,
          messages: messagesData.data?.messages || []
        };
        
        // Notify listeners
        this.onConversationLoaded(this.currentConversation);
        this.onLoadingEnd();
        return true;
      } catch (error) {
        if (error.message === 'Resource not found') {
          console.warn("Conversation not found:", chatId);
          this.showNotification("This conversation could not be found or is inaccessible. Try creating a new one.", "error");
        } else if (error.message.includes('Authentication required') || error.message.includes('401') || error.message.includes('403')) {
          console.warn("Authentication required to access conversation:", chatId);
          this.showNotification("Please log in to access this conversation", "error");
          // Clear any invalid auth state
          if (window.TokenManager?.clearTokens) {
            window.TokenManager.clearTokens();
          }
        } else {
          console.error("Error loading conversation:", error);
          this.showNotification("Error loading conversation", "error");
        }
        
        this.onLoadingEnd();
        this.onError('Failed to load conversation', error);
        return false;
      }
    }
    // Add this method before _isAuthenticatedStrict()
    _isAuthenticated() {
      // Check multiple possible authentication indicators
      const hasAuthState = sessionStorage.getItem('auth_state') !== null;
      const hasUserInfo = sessionStorage.getItem('userInfo') !== null;
      const isAuthenticated = window.API_CONFIG?.isAuthenticated === true;
      const hasTokens = window.TokenManager?.accessToken !== null;
      
      // Return true if any authentication indicator is present
      return hasAuthState || hasUserInfo || isAuthenticated || hasTokens;
    }
    // Add a stricter authentication check
    _isAuthenticatedStrict() {
      // First try the existing check
      const basicAuth = this._isAuthenticated();
      
      if (!basicAuth) return false;
      
      // For stricter checking, require both auth state and tokens
      const hasAuthState = sessionStorage.getItem('auth_state') !== null;
      const hasUserInfo = sessionStorage.getItem('userInfo') !== null;
      const hasTokens = window.TokenManager?.accessToken !== null;
      
      // Check token expiration if possible
      let isExpired = false;
      try {
        const authState = JSON.parse(sessionStorage.getItem('auth_state') || '{}');
        const timestamp = authState.timestamp || 0;
        const now = Date.now();
        // Consider expired if token is more than 30 minutes old
        isExpired = (now - timestamp) > 30 * 60 * 1000;
      } catch (e) {
        console.warn("Error checking token expiration:", e);
        isExpired = true;
      }
      
      // Return true only if we have all authentication indicators and token isn't expired
      return hasAuthState && hasUserInfo && hasTokens && !isExpired;
    }
  
    async createNewConversation(options = {}) {
      try {
        // Use the selected model from localStorage instead of hardcoding
        const selectedProjectId = localStorage.getItem("selectedProjectId");
        const selectedModel = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
        
        const payload = {
          title: "New Chat",
          model_id: selectedModel,
          ...options
        };
  
        let url = selectedProjectId
          ? `/api/projects/${selectedProjectId}/conversations`
          : `/api/chat/conversations`;
  
        console.log("Creating new conversation with URL:", url);
  
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
          credentials: 'include'
        });
  
        if (!response.ok) {
          throw new Error(`API error response (${response.status}): ${response.statusText}`);
        }
  
        // Parse the response and extract the conversation ID
        const responseData = await response.json();
        
        // Handle different response formats
        let conversation = this._extractConversationFromResponse(responseData);
        
        if (!conversation.id) {
          throw new Error("Invalid response format from server. Missing conversation ID.");
        }
  
        this.currentConversation = conversation;
        return conversation;
      } catch (error) {
        console.error("Error creating new chat:", error);
        this.showNotification(`Failed to create new chat: ${error.message}`, "error");
        throw error;
      }
    }
  
    // Private methods for internal use
    _isValidUUID(str) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    }
  
    async _fetchConversation(chatId) {
      try {
        const projectId = localStorage.getItem("selectedProjectId");
        const conversationEndpoint = projectId
          ? `/api/projects/${projectId}/conversations/${chatId}`
          : `/api/chat/conversations/${chatId}`;
        
        const response = await this.apiRequest(conversationEndpoint);
        
        // Handle different response formats
        if (response.data) {
          return response.data;
        } else {
          return response;
        }
      } catch (error) {
        // Enhance error handling
        if (error.message.includes('401') || error.message.includes('403')) {
          throw new Error('Authentication required');
        }
        throw error;
      }
    }
  
    async _fetchMessages(chatId) {
      const projectId = localStorage.getItem("selectedProjectId");
      const messagesEndpoint = projectId
        ? `/api/projects/${projectId}/conversations/${chatId}/messages`
        : `/api/chat/conversations/${chatId}/messages`;
        
      return this.apiRequest(messagesEndpoint);
    }
  
    _extractConversationFromResponse(responseData) {
      let conversation = null;
      
      if (responseData.data && responseData.data.id) {
        // Format: {data: {id: "uuid", ...}}
        conversation = responseData.data;
      } else if (responseData.data && responseData.data.data && responseData.data.data.id) {
        // Format: {data: {data: {id: "uuid", ...}}}
        conversation = responseData.data.data;
      } else if (responseData.id) {
        // Format: {id: "uuid", ...}
        conversation = responseData;
      } else {
        console.error("Unable to parse conversation from response:", responseData);
        // Return an object with empty id to fail validation
        return { id: null };
      }
      
      return conversation;
    }
  
    // Default API request implementation if none is provided
    async _defaultApiRequest(endpoint, method = "GET", data = null) {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      };
  
      if (data) {
        options.body = JSON.stringify(data);
      }
  
      const response = await fetch(endpoint, options);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Resource not found');
        }
        throw new Error(`API error response (${response.status}): ${response.statusText}`);
      }
      return response.json();
    }
  }

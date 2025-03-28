/**
 * chat-messages.js
 * Message handling service for chat functionality
 */

// Define MessageService as a constructor function attached to window
window.MessageService = function(options = {}) {
  this.onMessageReceived = options.onMessageReceived || (() => {});
  this.onSending = options.onSending || (() => {});
  this.onError = options.onError || console.error;
  this.chatId = null;
  this.wsService = null;
};

// Initialize service with chat ID and optional WebSocket service
window.MessageService.prototype.initialize = function(chatId, wsService) {
  this.chatId = chatId;
  this.wsService = wsService;
  if (wsService) {
    // Assign a default WebSocket 'onmessage' -> funnel to our handler
    wsService.onMessage = this._handleWsMessage.bind(this);
  }
};

// Helper function to validate UUIDs in MessageService
window.MessageService.prototype._isValidUUID = function(uuid) {
  if (!uuid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
};

// Send message using WebSocket or HTTP fallback
window.MessageService.prototype.sendMessage = async function(content) {
  try {
    // Validate conversation ID first
    if (!this.chatId || !this._isValidUUID(this.chatId)) {
      console.warn('Invalid conversation ID, cannot send message');
      throw new Error('Invalid conversation ID');
    }

    this.onSending();

    // Determine if we're in project context or standalone chat
    const isProjectContext = window.location.pathname.includes('/projects');
    const projectId = isProjectContext ? localStorage.getItem("selectedProjectId") : null;
    
    const messagePayload = {
      content: content,
      model_id: localStorage.getItem("modelName") || "claude-3-sonnet-20240229",
      enable_thinking: true  // Enable thinking blocks for Claude
    };

    // Only include project_id if we're in project context
    if (isProjectContext && projectId) {
      messagePayload.project_id = projectId;
    }

    if (this.wsService && this.wsService.isConnected()) {
      // Use WebSocket if available
      try {
        const wsResponse = await this.wsService.send({
          type: 'message',
          chatId: this.chatId,
          ...messagePayload
        });
        
        this.onMessageReceived({
          role: 'assistant',
          content: wsResponse.content || wsResponse.message || '',
          thinking: wsResponse.thinking,
          redacted_thinking: wsResponse.redacted_thinking,
          metadata: wsResponse.metadata || {}
        });
      } catch (wsError) {
        // Use fallback if WebSocket fails
        console.warn('WebSocket message failed, using HTTP fallback:', wsError);
        this._sendMessageHttp(messagePayload);
      }
    } else {
      // Use HTTP if WebSocket not available
      await this._sendMessageHttp(messagePayload);
    }
  } catch (error) {
    if (window.handleAPIError) {
      window.handleAPIError('chat messaging', error);
    } else {
      this.onError('Failed to send message', error);
    }
  }
};

// HTTP fallback for message sending
window.MessageService.prototype._sendMessageHttp = async function(messagePayload) {
  try {
    // Validate chatId before proceeding
    if (!this.chatId || !this._isValidUUID(this.chatId)) {
      throw new Error('Invalid conversation ID');
    }
    
    // Determine if we're in project context or standalone chat
    const isProjectContext = window.location.pathname.includes('/projects');
    const projectId = isProjectContext ? localStorage.getItem("selectedProjectId") : null;
        
    // Determine correct endpoint based on context
    const endpoint = isProjectContext && projectId
      ? `/api/projects/${projectId}/conversations/${this.chatId}/messages`
      : `/api/chat/conversations/${this.chatId}/messages`;
    
    // Use window.apiRequest instead of direct fetch
    const data = await window.apiRequest(endpoint, 'POST', messagePayload);
    const responseData = data.data || data;
    
    console.log('API response data:', responseData);
    
    // Handle both response format variations
    let assistantContent = '';
    let assistantThinking = null;
    let assistantRedactedThinking = null;
    let assistantMetadata = {};
    
    if (responseData.assistant_message) {
      try {
        // Try to parse the assistant_message if it's a string
        const assistantMsg = typeof responseData.assistant_message === 'string' 
          ? JSON.parse(responseData.assistant_message) 
          : responseData.assistant_message;
          
        assistantContent = assistantMsg.content || assistantMsg.message || '';
        
        // Check for thinking in both places
        assistantThinking = assistantMsg.metadata?.thinking || assistantMsg.thinking;
        assistantRedactedThinking = assistantMsg.metadata?.redacted_thinking || assistantMsg.redacted_thinking;
        
        // Merge metadata from all possible sources
        assistantMetadata = {
          ...(assistantMsg.metadata || {}),
          thinking: assistantThinking,
          redacted_thinking: assistantRedactedThinking
        };
      } catch (e) {
        console.warn('Failed to parse assistant_message:', e);
        // Fallback to direct fields
        assistantContent = responseData.assistant_content || responseData.content || responseData.message || '';
      }
    } else {
      // Use direct fields
      assistantContent = responseData.content || responseData.message || '';
      assistantThinking = responseData.thinking;
      assistantRedactedThinking = responseData.redacted_thinking;
      assistantMetadata = responseData.metadata || {};
    }
    
    // Additional fallback for direct root-level fields
    if (!assistantContent && responseData.assistant_content) {
      assistantContent = responseData.assistant_content;
    }
    
    this.onMessageReceived({
      role: 'assistant',
      content: assistantContent,
      thinking: assistantThinking,
      redacted_thinking: assistantRedactedThinking,
      metadata: assistantMetadata
    });
  } catch (error) {
    // Use existing error handling from app.js
    if (window.handleAPIError) {
      window.handleAPIError('sending message', error);
    } else {
      this.onError('Failed to send message via HTTP', error);
    }
  }
};

// Handle WebSocket messages
window.MessageService.prototype._handleWsMessage = function(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('WebSocket message received:', data);
    
    // If it's a plain message broadcast from the server
    if (data.type === 'message') {
      this.onMessageReceived({
        role: 'assistant',
        content: data.content || data.message || '',
        thinking: data.thinking,
        redacted_thinking: data.redacted_thinking,
        metadata: data.metadata || {}
      });
    }
    
    // Handle Claude-specific response format
    else if (data.type === 'claude_response') {
      this.onMessageReceived({
        role: 'assistant',
        content: data.answer || data.content || '',
        thinking: data.thinking,
        redacted_thinking: data.redacted_thinking,
        metadata: {
          model: data.model || '',
          tokens: data.token_count || 0,
          thinking: data.thinking,
          redacted_thinking: data.redacted_thinking
        }
      });
    }
    
    // Handle assistant message with specific role
    else if (data.role === 'assistant') {
      this.onMessageReceived({
        role: 'assistant',
        content: data.content || data.message || '',
        thinking: data.thinking,
        redacted_thinking: data.redacted_thinking,
        metadata: {
          model: data.model_id,
          tokens: data.token_count,
          ...data.metadata
        }
      });
    }
    
    // Add status updates
    else if (data.type === 'status') {
      console.log('WebSocket status update:', data.message);
    }
  } catch (error) {
    this.onError('Failed to process WebSocket message', error);
  }
};

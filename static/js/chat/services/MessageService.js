/**
 * MessageService.js
 * Handles message sending, receiving, and processing
 */

export default class MessageService {
  constructor(options = {}) {
    this.onMessageReceived = options.onMessageReceived || (() => {});
    this.onError = options.onError || console.error;
    this.onSending = options.onSending || (() => {});
    this.wsService = options.wsService || null;
    this.currentChatId = null;
    this.apiRequest = options.apiRequest || window.apiRequest || this._defaultApiRequest;
  }

  initialize(chatId, wsService) {
    this.currentChatId = chatId;
    
    if (wsService) {
      this.wsService = wsService;
      this.wsService.onMessage = this._handleWebSocketMessage.bind(this);
    }
  }

  async sendMessage({ conversationId, content, modelConfig }) {
    if (!conversationId) {
      this.onError('No conversation ID available for sending message');
      return false;
    }

    this.onSending(content);

    const payload = {
      content,
      role: 'user',
      model_id: modelConfig.modelName,
      max_tokens: modelConfig.maxTokens,
      image_data: modelConfig.visionEnabled ? window.MODEL_CONFIG?.visionImage : null,
      vision_detail: modelConfig.visionDetail,
      enable_thinking: modelConfig.extendedThinking,
      thinking_budget: modelConfig.thinkingBudget
    };

    // Try WebSocket first
    if (this.wsService) {
      try {
        const sent = await this.wsService.send(payload).catch(error => {
          console.warn('WebSocket send failed:', error);
          return false;
        });
        
        if (sent) return true;
      } catch (error) {
        console.warn('WebSocket error:', error);
      }
    }

    // Fall back to HTTP
    return this._sendMessageViaHttp(conversationId, payload);
  }

  // Private methods for internal use
  _handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'error') {
        this.onError(data.message || 'WebSocket server error');
        return;
      }
      
      if (data.role && data.content) {
        // Create metadata object if not exists
        const metadata = {};
        
        // Add knowledge context flag if present
        if (data.used_knowledge_context) {
          metadata.used_knowledge_context = true;
        }
        
        this.onMessageReceived({
          role: data.role,
          content: data.content,
          thinking: data.thinking,
          redacted_thinking: data.redacted_thinking,
          metadata: metadata
        });
      }
    } catch (error) {
      this.onError('Failed to parse WebSocket message', error);
    }
  }

  _prepareMessagePayload(userMsg, options = {}) {
    const visionImage = window.MODEL_CONFIG?.visionImage;
    const modelName = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
    
    const payload = {
      role: "user",
      content: userMsg,
      model_id: modelName,
      image_data: visionImage || null,
      vision_detail: window.MODEL_CONFIG?.visionDetail || "auto",
      max_completion_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
      max_tokens: Number(window.MODEL_CONFIG?.maxTokens) || 500,
      reasoning_effort: window.MODEL_CONFIG?.reasoningEffort || "low"
    };

    // Clear vision data if it exists
    if (visionImage && typeof options.clearVisionImage === 'undefined' || options.clearVisionImage) {
      if (window.MODEL_CONFIG) window.MODEL_CONFIG.visionImage = null;
      
      const visionFileInput = document.getElementById('visionFileInput');
      if (visionFileInput) visionFileInput.value = '';
      
      const chatImageInput = document.getElementById('chatImageInput');
      if (chatImageInput) chatImageInput.value = '';
      
      if (window.showNotification) window.showNotification('Image removed', 'info');
      
      const chatImagePreview = document.getElementById('chatImagePreview');
      if (chatImagePreview) chatImagePreview.classList.add('hidden');
      
      const visionPreview = document.getElementById('visionPreview');
      if (visionPreview) visionPreview.innerHTML = '';
    }

    return payload;
  }

  async _sendMessageViaHttp(chatId, payload) {
    // Determine the appropriate API endpoint
    const projectId = localStorage.getItem("selectedProjectId");
    const apiEndpoint = projectId
      ? `/api/projects/${projectId}/conversations/${chatId}/messages`
      : `/api/chat/conversations/${chatId}/messages`;

    try {
      const respData = await this.apiRequest(apiEndpoint, "POST", payload);
      
      // Extract assistant message based on different response formats
      const assistantMessage = this._extractAssistantMessage(respData);
      
      if (assistantMessage) {
        // Get the full metadata from the message
        const metadata = assistantMessage.metadata || {};
        const thinking = metadata.thinking;
        const redactedThinking = metadata.redacted_thinking;

        // Process the received message
        this.onMessageReceived({
          role: assistantMessage.role,
          content: assistantMessage.content,
          thinking: thinking,
          redacted_thinking: redactedThinking,
          metadata: metadata
        });
        
        return true;
      } else if (respData.data?.assistant_error) {
        this.onError("Error generating response: " + respData.data.assistant_error);
        return false;
      } else {
        this.onError("Unexpected response format");
        return false;
      }
    } catch (error) {
      this.onError("Error sending message", error);
      return false;
    }
  }

  _extractAssistantMessage(respData) {
    let assistantMessage = null;
    
    if (respData.data && respData.data.assistant_message) {
      // Direct access
      assistantMessage = respData.data.assistant_message;
    } else if (respData.data && respData.data.response && respData.data.response.assistant_message) {
      // Response wrapper
      assistantMessage = respData.data.response.assistant_message;
    } else if (respData.data && typeof respData.data.assistant_message === 'string') {
      // String JSON format
      try {
        assistantMessage = JSON.parse(respData.data.assistant_message);
      } catch (e) {
        console.error("Failed to parse assistant_message string:", e);
      }
    }
    
    return assistantMessage;
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
      throw new Error(`API error response (${response.status}): ${response.statusText}`);
    }
    return response.json();
  }
}

/**
 * chat-messages.js
 * Message handling service for chat functionality
 */

// Define MessageService as a constructor function attached to window
window.MessageService = function(options = {}) {
  this.onMessageReceived = options.onMessageReceived || (() => {});
  this.onSending = options.onSending || (() => {});
  this.onError = options.onError || ((context, error) => window.ChatUtils?.handleError(context, error));
  this.chatId = null;
  this.wsService = null;
  
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

// Initialize service with chat ID and optional WebSocket service
window.MessageService.prototype.initialize = function(chatId, wsService) {
  this.chatId = chatId;
  this.wsService = wsService;
  if (wsService) {
    // Assign a default WebSocket 'onmessage' -> funnel to our handler
    // But note that 'send()' uses an internal event listener for request correlation
    wsService.onMessage = this._handleWsMessage.bind(this);
  }
};

// Helper function to validate UUIDs in MessageService
window.MessageService.prototype._isValidUUID = function(uuid) {
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

// Send message using WebSocket or HTTP fallback
window.MessageService.prototype.sendMessage = async function(content) {
  try {
    // Validate conversation ID first with better error message
    if (!this.chatId) {
      console.error('Cannot send message: No conversation ID set');
      throw new Error('Invalid conversation ID: No conversation ID set');
    }
    
    if (!this._isValidUUID(this.chatId)) {
      console.error(`Cannot send message: Invalid conversation ID format: ${this.chatId}`);
      throw new Error(`Invalid conversation ID: ${this.chatId}`);
    }

    console.log(`Sending message to conversation: ${this.chatId}`);
    this.onSending();

    // Determine if we're in project context or standalone chat
    const isProjectContext = window.location.pathname.includes('/projects');
    const projectId = isProjectContext ? localStorage.getItem("selectedProjectId") : null;
    
    // Use the stored model config if available, otherwise fall back to localStorage
    const messagePayload = {
      type: "user_message",
      content: content,
      model_id: this.modelConfig?.modelName || localStorage.getItem("modelName") || "claude-3-sonnet-20240229",
      enable_thinking: this.modelConfig?.extendedThinking || localStorage.getItem("extendedThinking") === "true" || true,
      project_id: isProjectContext ? projectId : null
    };

    // Add vision parameters if enabled
    if (this.modelConfig?.visionEnabled && this.modelConfig?.visionImage) {
      messagePayload.vision_enabled = true;
      messagePayload.vision_image = this.modelConfig.visionImage;
      messagePayload.vision_detail = this.modelConfig.visionDetail || "auto";
    }
    
    // Add reasoning parameters if available
    if (this.modelConfig?.reasoningEffort) {
      messagePayload.reasoning_effort = this.modelConfig.reasoningEffort;
    }

    // Only include project_id if we're in project context
    if (isProjectContext && projectId) {
      messagePayload.project_id = projectId;
      
      // Add knowledge base integration
      try {
        // Check if knowledge base is enabled for this project
        // First check project-specific conversation setting, then check global project KB setting
        const kbStatus = await this._checkKnowledgeBaseStatus(projectId);
        if (kbStatus) {
          messagePayload.use_knowledge_base = kbStatus.enabled;
          console.log(`Using knowledge base for project ${projectId}: ${kbStatus.enabled}`);
        }
      } catch (e) {
        console.warn("Error checking knowledge base status:", e);
      }
    }
    
    // Add thinking budget if available and model supports it
    const thinkingBudget = this.modelConfig?.thinkingBudget || localStorage.getItem("thinkingBudget");
    if (thinkingBudget) {
      try {
        const budget = parseInt(thinkingBudget, 10);
        if (!isNaN(budget) && budget > 0) {
          messagePayload.thinking_budget = budget;
          console.log(`Applied thinking budget of ${budget} tokens`);
        }
      } catch (e) {
        console.warn('Error parsing thinking budget:', e);
      }
    }

    if (this.wsService && this.wsService.isConnected()) {
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
        // Use standardized error handling, then fall back to HTTP
        window.ChatUtils?.handleError?.('WebSocket message', wsError);
        console.warn('WebSocket message failed, using HTTP fallback:', wsError);
        await this._sendMessageHttp(messagePayload);
      }
    } else {
      // Use HTTP if WebSocket not available
      await this._sendMessageHttp(messagePayload);
    }
  } catch (error) {
    // Always use standardized error handling from ChatUtils
    window.ChatUtils?.handleError?.('Sending message', error) || 
    this.onError('Sending message', error);
  }
};

// HTTP fallback for message sending
window.MessageService.prototype._sendMessageHttp = async function(messagePayload) {
  try {
    // Validate chatId before proceeding
    if (!this.chatId || !this._isValidUUID(this.chatId)) {
      throw new Error('Invalid conversation ID');
    }
    
    // Get project context from URL or localStorage
    const projectId = localStorage.getItem("selectedProjectId") ||
      (window.location.pathname.match(/projects\/([^/]+)/) || [])[1];
        
    // Determine correct endpoint based on context
    const endpoint = projectId
      ? `/api/projects/${projectId}/conversations/${this.chatId}/messages`
      : `/api/chat/conversations/${this.chatId}/messages`;
    
    // Create options with projectId if available
    const requestBody = {
      ...messagePayload,
      project_id: projectId || null
    };
    
    // Check if knowledge base should be used
    if (projectId) {
      try {
        const kbStatus = await this._checkKnowledgeBaseStatus(projectId);
        if (kbStatus) {
          requestBody.use_knowledge_base = kbStatus.enabled;
          console.log(`[HTTP] Using knowledge base for project ${projectId}: ${kbStatus.enabled}`);
        }
      } catch (e) {
        console.warn("[HTTP] Error checking knowledge base status:", e);
      }
    }
    
    // Use fetch directly if apiRequest is not available
    const fetchOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify(requestBody)
    };
    
    const response = await (window.apiRequest ?
      window.apiRequest(endpoint, 'POST', requestBody) :
      fetch(endpoint, fetchOptions).then(res => res.json()));
    
    const responseData = response.data || response;
    
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
    
    // Only call onMessageReceived if we actually got content
    if (assistantContent) {
      this.onMessageReceived({
        role: 'assistant',
        content: assistantContent,
        thinking: assistantThinking,
        redacted_thinking: assistantRedactedThinking,
        metadata: assistantMetadata
      });
    } else {
      console.error('Empty or missing assistant content in response:', responseData);
      this.onError('HTTP message', new Error('No response content received from API'));
    }
  } catch (error) {
    // Use standardized error handling
    window.ChatUtils?.handleError?.('HTTP message', error) || 
    this.onError('HTTP message', error);
  }
};

// Update model configuration
window.MessageService.prototype.updateModelConfig = function(config) {
  // Store current model configuration for message sending
  this.modelConfig = config;
  console.log("MessageService updated with new model config:", config);
};

// Handle WebSocket messages
window.MessageService.prototype._handleWsMessage = function(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('[WS IN] Raw message:', event.data);
    console.debug('[WS IN] Parsed:', data);

    // Log ping/pong messages
    if (data.type === 'ping' || data.type === 'pong') {
      console.debug('[WS] Keepalive:', data.type);
      return;
    }
    
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
    // Use standardized error handling
    window.ChatUtils?.handleError?.('Processing WebSocket message', error) || 
    this.onError('Processing WebSocket message', error);
  }
};

/**
 * Check if knowledge base is enabled for a project
 * @private
 * @param {string} projectId - Project ID
 * @returns {Promise<Object>} Knowledge base status
 */
window.MessageService.prototype._checkKnowledgeBaseStatus = async function(projectId) {
  try {
    // First check local cache
    const localSetting = localStorage.getItem(`kb_enabled_${projectId}`);
    if (localSetting !== null) {
      return { enabled: localSetting === "true", source: "localStorage" };
    }
    
    // If window.knowledgeBaseState is available, use it
    if (window.knowledgeBaseState?.verifyKB) {
      const kbState = await window.knowledgeBaseState.verifyKB(projectId);
      if (kbState) {
        // Cache the result
        localStorage.setItem(`kb_enabled_${projectId}`, String(kbState.isActive));
        return { enabled: kbState.isActive, exists: kbState.exists, source: "api" };
      }
    }
    
    // Fall back to API request
    try {
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-base-status`,
        "GET"
      );
      
      const data = response.data || {};
      localStorage.setItem(`kb_enabled_${projectId}`, String(data.isActive));
      return { enabled: data.isActive, exists: data.exists, source: "api" };
    } catch (apiError) {
      console.warn("Knowledge base status API error:", apiError);
      return { enabled: false, exists: false, source: "api_error" };
    }
  } catch (error) {
    console.warn("Error checking knowledge base status:", error);
    return { enabled: false, error: true };
  }
};

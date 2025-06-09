/**
 * Conversation Manager – Phase 2 decomposition from oversized chat.js
 * 
 * Handles conversation CRUD operations, data fetching, and state management.
 * Extracted from chat.js to enforce 1000-line module limit.
 * 
 * Responsibilities:
 * - Conversation creation, loading, and deletion
 * - Message history management
 * - Project-conversation data coordination
 * - Authentication and validation
 * - State synchronization
 */

export function createConversationManager({
  apiRequest,
  projectContextService,
  authenticationService,
  logger,
  apiEndpoints,
  browserService,
  tokenStatsManager,
  modelConfig,
  eventBus,
  DependencySystem,
  CHAT_CONFIG
} = {}) {
  if (!apiRequest) throw new Error('[ConversationManager] apiRequest dependency missing');
  if (!projectContextService) throw new Error('[ConversationManager] projectContextService dependency missing');
  if (!authenticationService) throw new Error('[ConversationManager] authenticationService dependency missing');
  if (!logger) throw new Error('[ConversationManager] logger dependency missing');
  if (!apiEndpoints) throw new Error('[ConversationManager] apiEndpoints dependency missing');
  if (!browserService) throw new Error('[ConversationManager] browserService dependency missing');
  if (!tokenStatsManager) throw new Error('[ConversationManager] tokenStatsManager dependency missing');
  if (!modelConfig) throw new Error('[ConversationManager] modelConfig dependency missing');
  if (!eventBus) throw new Error('[ConversationManager] eventBus dependency missing');

  const MODULE_CONTEXT = 'ConversationManager';
  
  // Internal state
  const state = {
    currentConversationId: null,
    isLoading: false,
    loadPromise: null,
    currentRequestId: 0
  };

  /**
   * Validate project ID using projectContextService
   */
  function isValidProjectId(projectId) {
    return projectContextService.isValidProjectId?.(projectId) || false;
  }

  /**
   * Get current project ID from project context service
   */
  function getCurrentProjectId() {
    return projectContextService.getCurrentProjectId();
  }

  /**
   * Load conversation with robust error handling and data normalization
   */
  async function loadConversation(conversationId) {
    if (!conversationId) {
      logger.warn('[ConversationManager] No conversation ID provided', { context: MODULE_CONTEXT });
      return { success: false, error: 'No conversation ID provided' };
    }

    // Check authentication
    if (!authenticationService.isAuthenticated()) {
      logger.warn('[ConversationManager] User not authenticated', { context: MODULE_CONTEXT });
      return { success: false, error: 'User not authenticated' };
    }

    // Resolve and validate project ID
    let projectId = getCurrentProjectId();
    if (!isValidProjectId(projectId)) {
      logger.warn(`[ConversationManager] Invalid project ID (${projectId}), attempting to resolve`, {
        context: MODULE_CONTEXT,
        conversationId,
        currentProjectId: projectId
      });

      const resolvedProjectId = projectContextService.resolveProjectId?.();
      if (isValidProjectId(resolvedProjectId)) {
        logger.info(`[ConversationManager] Resolved valid project ID: ${resolvedProjectId}`, {
          context: MODULE_CONTEXT,
          conversationId,
          resolvedProjectId
        });
        projectId = resolvedProjectId;
      } else {
        const errorMsg = `Invalid or missing project ID (${projectId}). Cannot load conversation. Resolved: ${resolvedProjectId}`;
        logger.error('[ConversationManager] ' + errorMsg, new Error(errorMsg), {
          context: MODULE_CONTEXT,
          conversationId,
          resolvedProjectId
        });
        return { success: false, error: errorMsg };
      }
    }

    // Update token stats manager
    if (tokenStatsManager?.fetchConversationTokenStats) {
      tokenStatsManager.fetchConversationTokenStats(conversationId);
    }

    // Handle concurrent requests
    const requestId = ++state.currentRequestId;
    if (state.loadPromise) {
      const result = await state.loadPromise;
      return requestId === state.currentRequestId ? result : { success: false, error: 'Request superseded' };
    }

    state.isLoading = true;

    state.loadPromise = (async () => {
      try {
        // Fetch conversation and messages in parallel
        const [conversationResponse, messagesResponse] = await Promise.all([
          apiRequest.get(apiEndpoints.CONVERSATION(projectId, conversationId)),
          apiRequest.get(apiEndpoints.MESSAGES(projectId, conversationId))
        ]);

        // Normalize conversation data structure
        const conversation =
          conversationResponse?.data?.conversation
          ?? conversationResponse?.data
          ?? conversationResponse?.conversation
          ?? conversationResponse;

        if (!conversation?.id) {
          throw new Error('Failed to fetch valid conversation details.');
        }

        const messages = messagesResponse.data?.messages || [];

        // Update internal state
        state.currentConversationId = conversationId;
        
        // Update URL
        browserService.setSearchParam('chatId', conversationId);

        // Update token stats
        if (tokenStatsManager?.fetchConversationTokenStats) {
          tokenStatsManager.fetchConversationTokenStats(conversationId);
        }

        // Emit event for UI updates
        const event = new CustomEvent('conversation:loaded', {
          detail: {
            conversationId,
            conversation,
            messages,
            projectId
          }
        });
        eventBus.dispatchEvent(event);

        return {
          success: true,
          conversation,
          messages,
          conversationId,
          projectId
        };
      } catch (error) {
        logger.error('[ConversationManager] Error loading conversation', error, { 
          context: MODULE_CONTEXT,
          conversationId,
          projectId
        });
        return { success: false, error: error.message };
      } finally {
        state.isLoading = false;
        state.loadPromise = null;
      }
    })();

    return state.loadPromise;
  }

  /**
   * Create new conversation with robust response handling
   */
  async function createNewConversation(overrideProjectId) {
    let projectId = overrideProjectId || getCurrentProjectId();
    
    if (overrideProjectId) {
      projectId = isValidProjectId(overrideProjectId) ? overrideProjectId : projectId;
    }

    // Check authentication using centralized service
    if (!authenticationService.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    // Validate project ID
    if (!isValidProjectId(projectId)) {
      const errorMsg = `Invalid or missing project ID (${projectId}). Cannot create new conversation.`;
      logger.error('[ConversationManager] ' + errorMsg, new Error(errorMsg), { 
        context: MODULE_CONTEXT,
        projectId
      });
      throw new Error(errorMsg);
    }

    try {
      // Get current model configuration
      const cfg = modelConfig.getConfig();
      logger.info(`[ConversationManager] Creating conversation with model: ${cfg.modelName}`, { 
        context: MODULE_CONTEXT, 
        modelConfig: cfg,
        projectId
      });

      // Get current user from auth service
      const currentUser = authenticationService.getCurrentUser() || {};

      // Prepare payload
      const payload = {
        title: `New Chat ${(new Date()).toLocaleString()}`,
        model_id: cfg.modelName || CHAT_CONFIG?.DEFAULT_MODEL || 'gpt-4'
      };
      if (currentUser.id) payload.user_id = currentUser.id;

      // Construct endpoint
      const convoEndpoint = typeof apiEndpoints.CONVERSATIONS === 'function'
        ? apiEndpoints.CONVERSATIONS(projectId)
        : String(apiEndpoints.CONVERSATIONS).replace('{id}', projectId);

      // Create conversation
      const response = await apiRequest.post(convoEndpoint, payload, { returnFullResponse: true });

      // Robust response normalization
      const headers = response?.headers || {};
      let conversation =
        response?.data?.conversation
        ?? response?.data
        ?? response?.conversation
        ?? response
        ?? {};

      // Unwrap nested conversation object
      if (conversation?.conversation && typeof conversation.conversation === 'object') {
        conversation = conversation.conversation;
      }

      // Extract conversation ID with multiple fallbacks
      let convId =
        conversation?.id ??
        conversation?.conversation_id ??
        conversation?.uuid ??
        conversation?.conversationId ??
        null;

      // Check Location header for ID
      if (!convId && headers.location) {
        const loc = headers.location;
        convId = loc.split('/').filter(Boolean).pop();
      }

      // Fallback: fetch latest conversation if ID still missing
      if (!convId) {
        const getResp = await apiRequest.get(convoEndpoint, {
          params: { limit: 1, sort: 'desc' }
        });
        
        const conversations =
          getResp?.conversations
          ?? getResp?.data?.conversations
          ?? (Array.isArray(getResp?.data) ? getResp.data : Array.isArray(getResp) ? getResp : []);

        if (conversations.length) {
          const latest = conversations[0];
          convId =
            latest?.id ??
            latest?.conversation_id ??
            latest?.uuid ??
            latest?.conversationId ??
            null;

          if (!conversation) conversation = latest;
        }
      }

      // Ensure conversation has ID
      if (!('id' in conversation) && convId) {
        conversation = { ...(conversation || {}), id: convId };
      }

      // Update internal state
      state.currentConversationId = convId;
      
      // Update URL
      browserService.setSearchParam('chatId', convId);

      // Emit creation event
      const event = new CustomEvent('conversation:created', {
        detail: {
          conversationId: conversation.id,
          projectId,
          title: conversation.title,
          conversation
        }
      });
      eventBus.dispatchEvent(event);

      return {
        success: true,
        conversation,
        conversationId: convId,
        projectId
      };
    } catch (error) {
      logger.error('[ConversationManager] Error creating conversation', error, { 
        context: MODULE_CONTEXT,
        projectId
      });
      throw error;
    }
  }

  /**
   * Delete conversation with confirmation
   */
  async function deleteConversation(conversationId = state.currentConversationId) {
    if (!conversationId) {
      throw new Error('[ConversationManager] conversationId required for deletion');
    }

    // Check authentication
    if (!authenticationService.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    try {
      // Delete via API
      await apiRequest.delete(apiEndpoints.CONVERSATION_DELETE?.(conversationId) || `/conversations/${conversationId}`);
      
      // Clear current conversation if it was deleted
      if (conversationId === state.currentConversationId) {
        state.currentConversationId = null;
        browserService.removeSearchParam?.('chatId');
      }

      // Emit deletion event
      const event = new CustomEvent('conversation:deleted', {
        detail: {
          conversationId,
          wasActive: conversationId === state.currentConversationId
        }
      });
      eventBus.dispatchEvent(event);

      return { success: true, conversationId };
    } catch (error) {
      logger.error('[ConversationManager] Error deleting conversation', error, { 
        context: MODULE_CONTEXT,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Load conversation history for current project
   */
  async function loadConversationHistory() {
    const projectId = getCurrentProjectId();
    if (!isValidProjectId(projectId)) {
      logger.warn('[ConversationManager] Invalid project ID for history loading', {
        context: MODULE_CONTEXT,
        projectId
      });
      return { success: false, error: 'Invalid project ID' };
    }

    try {
      // Check for conversation ID in URL
      const urlConversationId = browserService.getSearchParam?.('chatId');
      
      if (urlConversationId) {
        logger.info('[ConversationManager] Found conversation ID in URL, loading', {
          context: MODULE_CONTEXT,
          conversationId: urlConversationId,
          projectId
        });
        return await loadConversation(urlConversationId);
      }

      // No URL conversation, try to load existing conversations
      const conversationsEndpoint = typeof apiEndpoints.CONVERSATIONS === 'function'
        ? apiEndpoints.CONVERSATIONS(projectId)
        : String(apiEndpoints.CONVERSATIONS).replace('{id}', projectId);

      const response = await apiRequest.get(conversationsEndpoint, {
        params: { limit: 1, sort: 'desc' }
      });

      const conversations =
        response?.conversations
        ?? response?.data?.conversations
        ?? (Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []);

      if (conversations.length > 0) {
        const latestConversation = conversations[0];
        const latestId = latestConversation?.id || latestConversation?.conversation_id;
        
        if (latestId) {
          logger.info('[ConversationManager] Loading latest conversation', {
            context: MODULE_CONTEXT,
            conversationId: latestId,
            projectId
          });
          return await loadConversation(latestId);
        }
      }

      // No existing conversations, create new one
      logger.info('[ConversationManager] No conversations found, creating new one', {
        context: MODULE_CONTEXT,
        projectId
      });
      return await createNewConversation();
    } catch (error) {
      logger.error('[ConversationManager] Error loading conversation history', error, {
        context: MODULE_CONTEXT,
        projectId
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Load messages for a specific conversation
   */
  async function loadMessages(conversationId) {
    if (!conversationId) {
      throw new Error('[ConversationManager] conversationId required for loading messages');
    }

    const projectId = getCurrentProjectId();
    if (!isValidProjectId(projectId)) {
      throw new Error('Invalid project ID for message loading');
    }

    try {
      const response = await apiRequest.get(apiEndpoints.MESSAGES(projectId, conversationId));
      const messages = response.data?.messages || [];
      
      // Emit messages loaded event
      const event = new CustomEvent('conversation:messagesLoaded', {
        detail: {
          conversationId,
          messages,
          projectId
        }
      });
      eventBus.dispatchEvent(event);

      return { success: true, messages, conversationId };
    } catch (error) {
      logger.error('[ConversationManager] Error loading messages', error, {
        context: MODULE_CONTEXT,
        conversationId,
        projectId
      });
      throw error;
    }
  }

  /**
   * Get current conversation ID
   */
  function getCurrentConversationId() {
    return state.currentConversationId;
  }

  /**
   * Set current conversation ID
   */
  function setCurrentConversationId(id) {
    const oldId = state.currentConversationId;
    state.currentConversationId = id;
    
    if (oldId !== id) {
      // Emit conversation change event
      const event = new CustomEvent('conversation:changed', {
        detail: {
          oldConversationId: oldId,
          newConversationId: id
        }
      });
      eventBus.dispatchEvent(event);
    }
  }

  /**
   * Check if currently loading
   */
  function isLoading() {
    return state.isLoading;
  }

  return {
    // Core CRUD operations
    loadConversation,
    createNewConversation,
    deleteConversation,
    
    // History and message management
    loadConversationHistory,
    loadMessages,
    
    // State management
    getCurrentConversationId,
    setCurrentConversationId,
    isLoading,
    
    // Utility methods
    isValidProjectId,
    getCurrentProjectId,
    
    // Cleanup
    cleanup() {
      state.currentConversationId = null;
      state.isLoading = false;
      state.loadPromise = null;
      state.currentRequestId = 0;
    }
  };
}

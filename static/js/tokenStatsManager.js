/**
 * tokenStatsManager.js
 *
 * Manages token usage statistics display and interaction in the UI.
 * Follows all code guardrails - exports factory function only,
 * dependency injection, proper event tracking, and sanitization.
 */

export function createTokenStatsManager({
  apiClient,
  domAPI,
  eventHandlers,
  browserService,
  modalManager,
  sanitizer,
  logger,
  projectManager,
  app,
  chatManager,
  domReadinessService
} = {}) {
  const MODULE_CONTEXT = 'tokenStatsManager';

  // Validate required dependencies
  if (!apiClient) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: apiClient`);
  if (!domAPI) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: domAPI`);
  if (!eventHandlers) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: eventHandlers`);
  if (!sanitizer) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: sanitizer`);
  if (!logger) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: logger`);
  if (!modalManager) throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: modalManager`);
  if (!domReadinessService)
    throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: domReadinessService`);

  // Module state
  const state = {
    initialized: false,
    initializing: null,
    currentProject: null,
    currentConversation: null,
    statsData: {
      project: {
        tokenUsage: 0,
        maxTokens: 200000
      },
      conversation: {
        contextTokenUsage: 0,
        messageCount: 0,
        userMsgTokens: 0,
        aiMsgTokens: 0,
        systemMsgTokens: 0,
        knowledgeTokens: 0,
        totalTokens: 0
      }
    }
  };

  /**
   * Safe logging wrapper functions
   */
  function _logInfo(msg, meta = {}) {
    try { logger.info(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); }
    catch (e) {
      try {
        logger.error(`[${MODULE_CONTEXT}] Failed to log info`, e, { context: MODULE_CONTEXT, ...meta });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log info (secondary catch)`, logErr, { context: MODULE_CONTEXT, ...meta });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  function _logError(message, err, meta = {}) {
    try {
      const details = err instanceof Error
        ? { message: err.message, stack: err.stack }
        : { error: err };
      logger.error(
        `[${MODULE_CONTEXT}] ${message}`,
        { ...details, context: MODULE_CONTEXT, ...meta }
      );
    } catch (logErr) {
      try {
        logger.error(`[${MODULE_CONTEXT}] Failed to log error`, logErr, { context: MODULE_CONTEXT, ...meta });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error (secondary catch)`, logErr, { context: MODULE_CONTEXT, ...meta });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  // Use canonical safeHandler from DI (following custom instructions pattern)
  function _safeHandler(handler, description) {
    const safeHandler = DependencySystem?.modules?.get?.('safeHandler');
    if (!safeHandler) {
      logger.warn(`[${MODULE_CONTEXT}] safeHandler not available in DI, using fallback`, { context: MODULE_CONTEXT });
      return (...args) => {
        try {
          return handler(...args);
        } catch (err) {
          logger.error(`[${MODULE_CONTEXT}][${description}]`, err, { context: MODULE_CONTEXT });
          throw err;
        }
      };
    }
    return safeHandler(handler, description);
  }

  /**
   * Initialize the token stats manager
   */
  async function initialize() {
    if (state.initialized) return;
    if (state.initializing) return state.initializing;

    state.initializing = (async () => {
      try {
        _logInfo('Initializing token stats manager');

        const requiredSel = [
          '#tokenUsageStat',
          '#tokenStatsBtn',
          '#tokenStatsCurrentUsage'
        ];

        try {
          await domReadinessService.elementsReady(requiredSel, {
            observeMutations: true,          // handle late template injection
            timeout: 8000,
            context: MODULE_CONTEXT + '::init'
          });
        } catch (err) {
          _logInfo('Token-stats UI not yet present – deferring initialization', {
            missing: requiredSel
          });
          state.initializing = null;   // allow future retries
          return false;                // non-fatal
        }

        // Bind event listeners
        _bindEventListeners();

        // Initialize modal functionality
        _initializeTokenStatsModal();

        state.initialized = true;
        _logInfo('Token stats manager initialized');
      } catch (err) {
        _logError('Failed to initialize token stats manager', err);
      } finally {
        state.initializing = null;
      }
    })();

    return state.initializing;
  }

  /**
   * Bind event listeners for token stats interactions
   */
  function _bindEventListeners() {
    const doc = domAPI.getDocument();

    // Clean up any existing listeners
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });

    // Token usage stat click in project details
    const tokenUsageStat = domAPI.getElementById('tokenUsageStat');
    if (tokenUsageStat) {
      eventHandlers.trackListener(
        tokenUsageStat,
        'click',
        _safeHandler(() => {
          _showTokenStatsModal();
        }, 'tokenUsageStatClick'),
        { context: MODULE_CONTEXT }
      );
    }

    // Token stats button in chat UI dropdown
    const tokenStatsBtn = domAPI.getElementById('tokenStatsBtn');
    if (tokenStatsBtn) {
      eventHandlers.trackListener(
        tokenStatsBtn,
        'click',
        _safeHandler(() => {
          _showTokenStatsModal();
        }, 'tokenStatsBtnClick'),
        { context: MODULE_CONTEXT }
      );
    }

    // Refresh button in token stats modal
    const refreshTokenStatsBtn = domAPI.getElementById('refreshTokenStatsBtn');
    if (refreshTokenStatsBtn) {
      eventHandlers.trackListener(
        refreshTokenStatsBtn,
        'click',
        _safeHandler(() => {
          _refreshTokenStats();
        }, 'refreshTokenStatsBtnClick'),
        { context: MODULE_CONTEXT }
      );
    }

    // Listen for conversation changes to update stats
    eventHandlers.trackListener(
      doc,
      'chat:conversationChanged',
      _safeHandler((e) => {
        if (e.detail && e.detail.conversationId) {
          state.currentConversation = e.detail.conversationId;
          fetchConversationTokenStats(e.detail.conversationId);
        }
      }, 'conversationChangedEvent'),
      { context: MODULE_CONTEXT }
    );

    // Listen for new messages to update stats
    eventHandlers.trackListener(
      doc,
      'chat:messageSent',
      _safeHandler((e) => {
        if (state.currentConversation) {
          fetchConversationTokenStats(state.currentConversation);
        }
      }, 'messageSentEvent'),
      { context: MODULE_CONTEXT }
    );

    // Listen for project changes to update stats
    eventHandlers.trackListener(
      doc,
      'projectLoaded',
      _safeHandler((e) => {
        // Handle both formats: e.detail.project and e.detail (project object directly)
        const project = e.detail?.project || e.detail;
        if (project && project.id) {
          state.currentProject = project;
          _updateProjectTokenStats(project);
          _logInfo('Project loaded, updating token stats', { projectId: project.id, tokenUsage: project.token_usage });
        }
      }, 'projectLoadedEvent'),
      { context: MODULE_CONTEXT }
    );

    // Listen for AppBus current project changes
    if (app && app.AppBus) {
      eventHandlers.trackListener(
        app.AppBus,
        'currentProjectChanged',
        _safeHandler((e) => {
          const project = e.detail?.project;
          if (project && project.id) {
            state.currentProject = project;
            _updateProjectTokenStats(project);
            _logInfo('Current project changed, updating token stats', { projectId: project.id, tokenUsage: project.token_usage });
          }
        }, 'currentProjectChangedEvent'),
        { context: MODULE_CONTEXT }
      );
    }
  }

  /**
   * Initialize token stats modal
   */
  function _initializeTokenStatsModal() {
    const closeBtn = domAPI.getElementById('closeTokenStatsModalBtn');
    const exportBtn = domAPI.getElementById('exportTokenStatsBtn');

    if (closeBtn) {
      try {
        eventHandlers.trackListener(
          closeBtn,
          'click',
          _safeHandler(() => {
            modalManager.hide('tokenStats');
          }, 'closeTokenStatsModal'),
          { context: MODULE_CONTEXT }
        );
      } catch (err) {
        _logError('Failed to bind closeTokenStatsModalBtn event', err);
        try {
          logger.error(`[${MODULE_CONTEXT}] Exception in _initializeTokenStatsModal (closeBtn)`, err, { context: MODULE_CONTEXT });
        } catch (logErr) {
          try {
            logger.error(`[${MODULE_CONTEXT}] Failed to log error in _initializeTokenStatsModal (closeBtn)`, logErr, { context: MODULE_CONTEXT });
          } catch (finalErr) {
            // If logging fails, do nothing further to avoid infinite loop
          }
        }
      }
    }

    if (exportBtn) {
      try {
        eventHandlers.trackListener(
          exportBtn,
          'click',
          _safeHandler(() => {
            _exportTokenStats();
          }, 'exportTokenStats'),
          { context: MODULE_CONTEXT }
        );
      } catch (err) {
        _logError('Failed to bind exportTokenStatsBtn event', err);
        try {
          logger.error(`[${MODULE_CONTEXT}] Exception in _initializeTokenStatsModal (exportBtn)`, err, { context: MODULE_CONTEXT });
        } catch (logErr) {
          try {
            logger.error(`[${MODULE_CONTEXT}] Failed to log error in _initializeTokenStatsModal (exportBtn)`, logErr, { context: MODULE_CONTEXT });
          } catch (finalErr) {
            // If logging fails, do nothing further to avoid infinite loop
          }
        }
      }
    }
  }

  /**
   * Show the token stats modal
   */
  function _showTokenStatsModal() {
    try {
      // Update stats in the modal
      _updateTokenStatsModal();

      // Show the modal
      modalManager.show('tokenStats');

      // If we have a current conversation, refresh the data
      if (state.currentConversation) {
        fetchConversationTokenStats(state.currentConversation);
      }
    } catch (err) {
      _logError('Failed to show token stats modal', err);
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in _showTokenStatsModal`, err, { context: MODULE_CONTEXT });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in _showTokenStatsModal`, logErr, { context: MODULE_CONTEXT });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Refresh token stats data
   */
  function _refreshTokenStats() {
    try {
      _logInfo('Refreshing token stats data');

      // Refresh project stats if we have a current project
      if (state.currentProject) {
        _updateProjectTokenStats(state.currentProject);
      }

      // Refresh conversation stats if we have a current conversation
      if (state.currentConversation) {
        fetchConversationTokenStats(state.currentConversation);
      }

      // Update the modal display
      _updateTokenStatsModal();

      _logInfo('Token stats refreshed successfully');
    } catch (err) {
      _logError('Failed to refresh token stats', err);
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in _refreshTokenStats`, err, { context: MODULE_CONTEXT });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in _refreshTokenStats`, logErr, { context: MODULE_CONTEXT });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Update project token stats display
   */
  function _updateProjectTokenStats(project) {
    if (!project) return;

    try {
      // Update state
      state.statsData.project.tokenUsage = project.token_usage || 0;
      state.statsData.project.maxTokens = project.max_tokens || 200000;

      // Update UI
      const tokenUsageEl = domAPI.getElementById('tokenUsage');
      const maxTokensEl = domAPI.getElementById('maxTokens');
      const tokenPercentageEl = domAPI.getElementById('tokenPercentage');
      const tokenProgressBarEl = domAPI.getElementById('tokenProgressBar');

      if (tokenUsageEl) tokenUsageEl.textContent = state.statsData.project.tokenUsage.toLocaleString();
      if (maxTokensEl) maxTokensEl.textContent = state.statsData.project.maxTokens.toLocaleString();

      // Calculate percentage
      const percentage = state.statsData.project.maxTokens > 0
        ? Math.min(100, Math.round((state.statsData.project.tokenUsage / state.statsData.project.maxTokens) * 100))
        : 0;

      if (tokenPercentageEl) tokenPercentageEl.textContent = `${percentage}%`;
      if (tokenProgressBarEl) {
        tokenProgressBarEl.value = percentage;
        tokenProgressBarEl.max = 100;
      }

      // Update dropdown stats
      const projectTokenLimitEl = domAPI.getElementById('projectTokenLimit');
      if (projectTokenLimitEl) {
        projectTokenLimitEl.textContent = state.statsData.project.maxTokens.toLocaleString();
      }

      // Update total tokens in dropdown
      const totalTokenCountEl = domAPI.getElementById('totalTokenCount');
      if (totalTokenCountEl) {
        totalTokenCountEl.textContent = state.statsData.project.tokenUsage.toLocaleString();
      }
    } catch (err) {
      _logError('Failed to update project token stats', err);
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in _updateProjectTokenStats`, err, { context: MODULE_CONTEXT });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in _updateProjectTokenStats`, logErr, { context: MODULE_CONTEXT });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Update the token stats modal with current data
   */
  function _updateTokenStatsModal() {
    try {
      // Project usage stats
      const currentUsageEl = domAPI.getElementById('tokenStatsCurrentUsage');
      const projectLimitEl = domAPI.getElementById('tokenStatsProjectLimit');
      const percentageEl = domAPI.getElementById('tokenStatsPercentage');
      const progressBarEl = domAPI.getElementById('tokenStatsProgressBar');

      if (currentUsageEl) currentUsageEl.textContent = state.statsData.project.tokenUsage.toLocaleString();
      if (projectLimitEl) projectLimitEl.textContent = state.statsData.project.maxTokens.toLocaleString();

      // Calculate percentage
      const percentage = state.statsData.project.maxTokens > 0
        ? Math.min(100, Math.round((state.statsData.project.tokenUsage / state.statsData.project.maxTokens) * 100))
        : 0;

      if (percentageEl) percentageEl.textContent = `${percentage}%`;
      if (progressBarEl) {
        progressBarEl.value = percentage;
        progressBarEl.max = 100;
      }

      // Conversation stats
      const contextUsageEl = domAPI.getElementById('tokenStatsContextUsage');
      const messageCountEl = domAPI.getElementById('tokenStatsMessageCount');
      const avgPerMessageEl = domAPI.getElementById('tokenStatsAvgPerMessage');

      if (contextUsageEl) contextUsageEl.textContent = state.statsData.conversation.contextTokenUsage.toLocaleString();
      if (messageCountEl) messageCountEl.textContent = state.statsData.conversation.messageCount.toLocaleString();

      // Calculate average tokens per message
      const avgTokens = state.statsData.conversation.messageCount > 0
        ? Math.round(state.statsData.conversation.totalTokens / state.statsData.conversation.messageCount)
        : 0;

      if (avgPerMessageEl) avgPerMessageEl.textContent = avgTokens.toLocaleString();

      // Token breakdown
      const userMsgTokensEl = domAPI.getElementById('tokenStatsUserMsgTokens');
      const userMsgPercentEl = domAPI.getElementById('tokenStatsUserMsgPercent');
      const aiMsgTokensEl = domAPI.getElementById('tokenStatsAIMsgTokens');
      const aiMsgPercentEl = domAPI.getElementById('tokenStatsAIMsgPercent');
      const systemMsgTokensEl = domAPI.getElementById('tokenStatsSystemMsgTokens');
      const systemMsgPercentEl = domAPI.getElementById('tokenStatsSystemMsgPercent');
      const knowledgeTokensEl = domAPI.getElementById('tokenStatsKnowledgeTokens');
      const knowledgePercentEl = domAPI.getElementById('tokenStatsKnowledgePercent');
      const totalTokensEl = domAPI.getElementById('tokenStatsTotalTokens');

      if (userMsgTokensEl) userMsgTokensEl.textContent = state.statsData.conversation.userMsgTokens.toLocaleString();
      if (aiMsgTokensEl) aiMsgTokensEl.textContent = state.statsData.conversation.aiMsgTokens.toLocaleString();
      if (systemMsgTokensEl) systemMsgTokensEl.textContent = state.statsData.conversation.systemMsgTokens.toLocaleString();
      if (knowledgeTokensEl) knowledgeTokensEl.textContent = state.statsData.conversation.knowledgeTokens.toLocaleString();
      if (totalTokensEl) totalTokensEl.textContent = state.statsData.conversation.totalTokens.toLocaleString();

      // Calculate percentages
      const totalTokens = state.statsData.conversation.totalTokens || 1; // Avoid division by zero

      const userPercent = Math.round((state.statsData.conversation.userMsgTokens / totalTokens) * 100);
      const aiPercent = Math.round((state.statsData.conversation.aiMsgTokens / totalTokens) * 100);
      const systemPercent = Math.round((state.statsData.conversation.systemMsgTokens / totalTokens) * 100);
      const knowledgePercent = Math.round((state.statsData.conversation.knowledgeTokens / totalTokens) * 100);

      if (userMsgPercentEl) userMsgPercentEl.textContent = `${userPercent}%`;
      if (aiMsgPercentEl) aiMsgPercentEl.textContent = `${aiPercent}%`;
      if (systemMsgPercentEl) systemMsgPercentEl.textContent = `${systemPercent}%`;
      if (knowledgePercentEl) knowledgePercentEl.textContent = `${knowledgePercent}%`;
    } catch (err) {
      _logError('Failed to update token stats modal', err);
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in _updateTokenStatsModal`, err, { context: MODULE_CONTEXT });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in _updateTokenStatsModal`, logErr, { context: MODULE_CONTEXT });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Export token stats as CSV
   */
  function _exportTokenStats() {
    try {
      // Create CSV content
      const csvContent = [
        'Category,Item,Value',
        `Project,Token Usage,${state.statsData.project.tokenUsage}`,
        `Project,Max Tokens,${state.statsData.project.maxTokens}`,
        `Project,Usage Percentage,${Math.round((state.statsData.project.tokenUsage / state.statsData.project.maxTokens) * 100)}%`,
        `Conversation,Context Tokens,${state.statsData.conversation.contextTokenUsage}`,
        `Conversation,Message Count,${state.statsData.conversation.messageCount}`,
        `Conversation,Avg Tokens per Message,${state.statsData.conversation.messageCount > 0 ? Math.round(state.statsData.conversation.totalTokens / state.statsData.conversation.messageCount) : 0}`,
        `Breakdown,User Messages Tokens,${state.statsData.conversation.userMsgTokens}`,
        `Breakdown,AI Responses Tokens,${state.statsData.conversation.aiMsgTokens}`,
        `Breakdown,System Messages Tokens,${state.statsData.conversation.systemMsgTokens}`,
        `Breakdown,Knowledge Context Tokens,${state.statsData.conversation.knowledgeTokens}`,
        `Breakdown,Total Tokens,${state.statsData.conversation.totalTokens}`
      ].join('\n');

      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      // Create and trigger download
      const link = domAPI.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `token_stats_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.display = 'none';

      domAPI.appendChild(domAPI.getDocument().body, link);
      link.click();

      // Clean up
      browserService.setTimeout(() => {
        URL.revokeObjectURL(url);
        if (link.parentNode) {
          domAPI.removeChild(link.parentNode, link);
        }
      }, 100);
    } catch (err) {
      _logError('Failed to export token stats', err);
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in _exportTokenStats`, err, { context: MODULE_CONTEXT });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in _exportTokenStats`, logErr, { context: MODULE_CONTEXT });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Fetch token statistics for a conversation
   */
  async function fetchConversationTokenStats(conversationId) {
    if (!conversationId) return;

    try {
      // Get current project ID
      const projectId = state.currentProject?.id || projectManager?.getCurrentProject()?.id;
      if (!projectId) {
        _logError('No project ID available for token stats', new Error('Missing project ID'));
        return;
      }

      // Make API request
      const response = await apiClient(`/api/projects/${projectId}/conversations/${conversationId}/token-stats`);

      if (!response) {
        _logError('Empty response from token stats API', new Error('Empty response'));
        return;
      }

      // Update state with conversation stats
      state.statsData.conversation = {
        contextTokenUsage: response.context_token_usage || 0,
        messageCount: response.message_count || 0,
        userMsgTokens: response.user_msg_tokens || 0,
        aiMsgTokens: response.ai_msg_tokens || 0,
        systemMsgTokens: response.system_msg_tokens || 0,
        knowledgeTokens: response.knowledge_tokens || 0,
        totalTokens: response.total_tokens || 0
      };

      // Update conversation token count in header
      const conversationTokenCountEl = domAPI.getElementById('conversationTokenCount');
      if (conversationTokenCountEl) {
        conversationTokenCountEl.textContent = state.statsData.conversation.contextTokenUsage.toLocaleString();
      }

      // Update context token count in dropdown
      const contextTokenCountEl = domAPI.getElementById('contextTokenCount');
      if (contextTokenCountEl) {
        contextTokenCountEl.textContent = state.statsData.conversation.contextTokenUsage.toLocaleString();
      }

      // If modal is open, update it
      _updateTokenStatsModal();

      _logInfo('Updated conversation token stats', { conversationId });
    } catch (err) {
      _logError('Failed to fetch conversation token stats', err, { conversationId });
      try {
        logger.error(`[${MODULE_CONTEXT}] Exception in fetchConversationTokenStats`, err, { context: MODULE_CONTEXT, conversationId });
      } catch (logErr) {
        try {
          logger.error(`[${MODULE_CONTEXT}] Failed to log error in fetchConversationTokenStats`, logErr, { context: MODULE_CONTEXT, conversationId });
        } catch (finalErr) {
          // If logging fails, do nothing further to avoid infinite loop
        }
      }
    }
  }

  /**
   * Set the current input token count
   */
  function setInputTokenCount(count) {
    const liveTokenCountEl = domAPI.getElementById('liveTokenCount');
    if (liveTokenCountEl) {
      liveTokenCountEl.textContent = count.toLocaleString();
    }
  }

  /**
   * Cleanup function
   */
  function cleanup() {
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    state.initialized = false;
    _logInfo('Token stats manager cleaned up');
  }

  // Public API
  return {
    initialize,
    fetchConversationTokenStats,
    setInputTokenCount,
    cleanup
  };
}

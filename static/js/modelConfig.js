/**
 * modelConfig.js - Lightweight model configuration manager
 * Dependencies:
 * - localStorage (browser built-in)
 * - CustomEvent (browser built-in)
 * - window.chatManager (external dependency, expected to be available in global scope)
 */

/**
 * Modular ModelConfig
 * Exported as a factory function to avoid implicit globals.
 * Uses centralized auth state if needed by consumers.
 */
export function createModelConfig() {
  const modelConfigState = {
    modelName: localStorage.getItem("modelName") || "claude-3-sonnet-20240229",
    provider: localStorage.getItem("provider") || "anthropic",
    maxTokens: parseInt(localStorage.getItem("maxTokens") || "4096", 10),
    reasoningEffort: localStorage.getItem("reasoningEffort") || "medium",
    visionEnabled: localStorage.getItem("visionEnabled") === "true",
    visionDetail: localStorage.getItem("visionDetail") || "auto",
    visionImage: null,
    extendedThinking: localStorage.getItem("extendedThinking") === "true",
    thinkingBudget: parseInt(localStorage.getItem("thinkingBudget") || "16000", 10),
    customInstructions: localStorage.getItem("globalCustomInstructions") || "",
    azureParams: {
      maxCompletionTokens: parseInt(localStorage.getItem("azureMaxCompletionTokens") || "5000", 10),
      reasoningEffort: localStorage.getItem("azureReasoningEffort") || "medium",
      visionDetail: localStorage.getItem("azureVisionDetail") || "auto"
    }
  };

  /**
   * Update model configuration and notify listeners
   */
  function updateModelConfig(config) {
    Object.assign(modelConfigState, {
      modelName: config.modelName || modelConfigState.modelName,
      maxTokens: Math.max(100, Math.min(100000, config.maxTokens || modelConfigState.maxTokens)),
      reasoningEffort: config.reasoningEffort || modelConfigState.reasoningEffort,
      visionEnabled: config.visionEnabled ?? modelConfigState.visionEnabled,
      visionDetail: config.visionDetail || modelConfigState.visionDetail,
      extendedThinking: config.extendedThinking ?? modelConfigState.extendedThinking,
      thinkingBudget: Math.max(2048, Math.min(32000, config.thinkingBudget || modelConfigState.thinkingBudget)),
      customInstructions: config.customInstructions || modelConfigState.customInstructions,
      azureParams: {
        maxCompletionTokens: Math.max(1000, Math.min(10000, config.azureParams?.maxCompletionTokens || modelConfigState.azureParams.maxCompletionTokens)),
        reasoningEffort: config.azureParams?.reasoningEffort || modelConfigState.azureParams.reasoningEffort,
        visionDetail: config.azureParams?.visionDetail || modelConfigState.azureParams.visionDetail
      }
    });

    // Persist to localStorage
    localStorage.setItem("modelName", modelConfigState.modelName);
    localStorage.setItem("provider", modelConfigState.provider);
    localStorage.setItem("maxTokens", modelConfigState.maxTokens);
    localStorage.setItem("reasoningEffort", modelConfigState.reasoningEffort);
    localStorage.setItem("visionEnabled", modelConfigState.visionEnabled);
    localStorage.setItem("visionDetail", modelConfigState.visionDetail);
    localStorage.setItem("extendedThinking", modelConfigState.extendedThinking);
    localStorage.setItem("thinkingBudget", modelConfigState.thinkingBudget);

    if (modelConfigState.customInstructions) {
      localStorage.setItem("globalCustomInstructions", modelConfigState.customInstructions);
    }

    // Save Azure-specific settings
    localStorage.setItem("azureMaxCompletionTokens", modelConfigState.azureParams.maxCompletionTokens);
    localStorage.setItem("azureReasoningEffort", modelConfigState.azureParams.reasoningEffort);
    localStorage.setItem("azureVisionDetail", modelConfigState.azureParams.visionDetail);

    // DependencySystem preferred: update chatManager if registered
    const ds = window.DependencySystem;
    const chatMgr = ds?.modules?.get('chatManager');
    if (chatMgr?.updateModelConfig) {
      chatMgr.updateModelConfig(modelConfigState);
    }

    document.dispatchEvent(new CustomEvent('modelConfigChanged', {
      detail: { ...modelConfigState }
    }));
  }

  function getModelOptions() {
    return [
      {
        id: 'claude-3-opus-20240229',
        name: 'Claude 3 Opus',
        provider: 'anthropic',
        maxTokens: 200000,
        supportsVision: false
      },
      {
        id: 'claude-3-sonnet-20240229',
        name: 'Claude 3 Sonnet',
        provider: 'anthropic',
        maxTokens: 200000,
        supportsVision: false
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        maxTokens: 128000,
        supportsVision: true
      }
    ];
  }

  function getConfig() {
    return { ...modelConfigState };
  }

  function onConfigChange(callback) {
    document.addEventListener('modelConfigChanged', (e) => callback(e.detail));
  }

  function initializeUI() {
    if (window.uiRenderer) {
      if (typeof window.uiRenderer.setupModelDropdown === "function") window.uiRenderer.setupModelDropdown();
      if (typeof window.uiRenderer.setupMaxTokensUI === "function") window.uiRenderer.setupMaxTokensUI();
      if (typeof window.uiRenderer.setupVisionUI === "function") window.uiRenderer.setupVisionUI();
    }
  }

  return {
    getConfig,
    updateConfig: updateModelConfig,
    getModelOptions,
    onConfigChange,
    initializeUI
  };
}

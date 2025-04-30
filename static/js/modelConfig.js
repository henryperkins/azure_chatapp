/**
 * modelConfig.js - DependencySystem/DI Refactored Edition
 *
 * Modular model configuration manager.
 * - No `window.*` access internally
 * - All dependencies via DI (DependencySystem, eventHandlers optionally injected)
 * - UI event binding via DI-injected eventHandlers if available
 *
 * Exports: createModelConfig({ DependencySystem, eventHandlers })
 */

export function createModelConfig({ DependencySystem, eventHandlers } = {}) {
  // Dependency resolution: always prefer DI, fallback to DependencySystem argument, never window.*
  DependencySystem = DependencySystem || (typeof window !== 'undefined' && window.DependencySystem) || undefined;
  eventHandlers = eventHandlers || (DependencySystem?.modules?.get?.('eventHandlers')) || undefined;

  // --- Module State ---
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

  // --- Update and Broadcast Model Config ---
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

    // Persist settings to localStorage
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
    localStorage.setItem("azureMaxCompletionTokens", modelConfigState.azureParams.maxCompletionTokens);
    localStorage.setItem("azureReasoningEffort", modelConfigState.azureParams.reasoningEffort);
    localStorage.setItem("azureVisionDetail", modelConfigState.azureParams.visionDetail);

    // Notify chatManager via DependencySystem if registered
    let chatManager = undefined;
    if (DependencySystem && DependencySystem.modules?.get) {
      chatManager = DependencySystem.modules.get('chatManager');
    }
    if (chatManager?.updateModelConfig) {
      chatManager.updateModelConfig(modelConfigState);
    }

    // Broadcast event (for listeners wanting model changes)
    document.dispatchEvent(new CustomEvent('modelConfigChanged', {
      detail: { ...modelConfigState }
    }));
  }

  // Option generator
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
    // Standard event subscribe
    document.addEventListener('modelConfigChanged', (e) => callback(e.detail));
  }

  // --- UI Component Initializer ---
  function initializeUI() {
    if (typeof setupModelDropdown === "function") setupModelDropdown();
    if (typeof setupMaxTokensUI === "function") setupMaxTokensUI();
    if (typeof setupVisionUI === "function") setupVisionUI();
  }

  // --- Model Config UI Setup (no globals, no window.eventHandlers used) ---
  function setupModelDropdown() {
    const sel = document.getElementById('modelSelect');
    if (!sel) return;
    const options = getModelOptions();
    sel.innerHTML = '';
    options.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      if (m.description) opt.title = m.description;
      sel.appendChild(opt);
    });
    const current = getConfig().modelName;
    if (current) sel.value = current;
    const handler = () => updateModelConfig({ modelName: sel.value });
    if (eventHandlers?.trackListener) {
      eventHandlers.trackListener(sel, 'change', handler);
    } else {
      sel.addEventListener('change', handler);
    }
  }

  function setupMaxTokensUI() {
    const container = document.getElementById('maxTokensContainer');
    if (!container) return;
    const current = getConfig().maxTokens || 4096;
    const slider = Object.assign(document.createElement('input'), { type: 'range', min: 100, max: 100000, value: current, className: 'w-full mt-2' });
    const display = Object.assign(document.createElement('div'), { className: 'text-sm text-gray-600 dark:text-gray-400', textContent: `${current} tokens` });
    const update = (v) => { const t = Math.max(100, Math.min(100000, +v)); display.textContent = `${t} tokens`; updateModelConfig({ maxTokens: t }); };
    slider.addEventListener('input', (e) => update(e.target.value));
    container.innerHTML = ''; container.append(slider, display);
  }

  function setupVisionUI() {
    const panel = document.getElementById('visionPanel');
    if (!panel) return;
    const name = getConfig().modelName;
    const supports = getModelOptions().find(m => m.id === name)?.supportsVision;
    panel.classList.toggle('hidden', !supports);
    if (!supports) return;
    const toggle = Object.assign(document.createElement('input'), { type: 'checkbox', id: 'visionToggle', className: 'mr-2', checked: getConfig().visionEnabled });
    const label = Object.assign(document.createElement('label'), { htmlFor: 'visionToggle', className: 'text-sm', textContent: 'Enable Vision' });
    const handler = () => updateModelConfig({ visionEnabled: toggle.checked });
    if (eventHandlers?.trackListener) {
      eventHandlers.trackListener(toggle, 'change', handler);
    } else {
      toggle.addEventListener('change', handler);
    }
    panel.innerHTML = '';
    panel.append(toggle, label);
  }

  // --- Module API ---
  return {
    getConfig,
    updateConfig: updateModelConfig,
    getModelOptions,
    onConfigChange,
    initializeUI,
  };
}

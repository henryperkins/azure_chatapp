/**
 * modelConfig.js (Notification, logging, and error reporting code REMOVED)
 *
 * Key checklist points enforced:
 * - No notification, logging, or error reporting system (per checklist).
 * - No top-level side effects; always factory export.
 * - All dependencies injected, no global access.
 * - No direct window/document/console/localStorage or side effects at import.
 * - DOM/event/utility access only via injection.
 * - Pure imports. Context/tagging for listeners.
 * - Safe user HTML via sanitizer always.
 * - Central state + modular event bus pattern.
 *
 * Usage:
 *   import { createModelConfig } from './modelConfig.js';
 *   const modelConfig = createModelConfig({});
 *   modelConfig.initializeUI(); // optional
 *   modelConfig.renderQuickConfig(document.getElementById('configPanel'));
 */
const MODULE_CONTEXT = "ModelConfig";

/**
 * Factory: Creates the model configuration module.
 * @param {object} deps - Injected dependencies only.
 * @param {object} [deps.dependencySystem] - Reference to dependency system.
 * @param {object} [deps.eventHandler] - { trackListener, untrackListener } for DOM events.
 * @param {object} [deps.storageHandler] - { getItem(key), setItem(key, val) }.
 * @param {object} [deps.sanitizer] - { sanitize(htmlString) }.
 * @param {function} [deps.scheduleTask] - Scheduling function (fn, ms).
 * @returns {object} Public API for config and UI.
 */
export function createModelConfig({
  dependencySystem,
  eventHandler,
  storageHandler,
  sanitizer,
  scheduleTask
} = {}) {
  // CHECKLIST: Validate only business deps (no notify, no logger, no errorReporter)
  if (!dependencySystem) throw new Error('[ModelConfig] dependencySystem is required');
  if (!eventHandler) throw new Error('[ModelConfig] eventHandler is required');
  if (!storageHandler) throw new Error('[ModelConfig] storageHandler is required');
  if (!sanitizer || typeof sanitizer.sanitize !== 'function')
    throw new Error('[ModelConfig] sanitizer with sanitize() is required');

  // Setup injected dependencies
  function setupDependencies() {
    const ds = dependencySystem;
    const fallbackEventHandler = {
      trackListener: () => {},
      untrackListener: () => {}
    };
    const evts = eventHandler || fallbackEventHandler;
    const blankStorage = { getItem: () => null, setItem: () => {} };
    const store = storageHandler || blankStorage;
    const safe = sanitizer && typeof sanitizer.sanitize === 'function'
      ? (html) => sanitizer.sanitize(html)
      : (x) => x;
    const delayed = scheduleTask || ((fn, ms) => setTimeout(fn, ms));
    return { ds, evts, store, safe, delayed };
  }

  // Build the default state for the model config (from injected storage)
  function buildState(api) {
    const rawModelName = api.store.getItem('modelName') || 'claude-3-sonnet-20240229';
    const defaultState = {
      modelName: rawModelName,
      provider: api.store.getItem('provider') || 'anthropic',
      maxTokens: parseInt(api.store.getItem('maxTokens') || '4096', 10),
      reasoningEffort: api.store.getItem('reasoningEffort') || 'medium',
      visionEnabled: api.store.getItem('visionEnabled') === 'true',
      visionDetail: api.store.getItem('visionDetail') || 'auto',
      visionImage: null,
      extendedThinking: api.store.getItem('extendedThinking') === 'true',
      thinkingBudget: parseInt(api.store.getItem('thinkingBudget') || '16000', 10),
      customInstructions: api.store.getItem('globalCustomInstructions') || '',
      azureParams: {
        maxCompletionTokens: parseInt(api.store.getItem('azureMaxCompletionTokens') || '5000', 10),
        reasoningEffort: api.store.getItem('azureReasoningEffort') || 'medium',
        visionDetail: api.store.getItem('azureVisionDetail') || 'auto'
      }
    };
    return defaultState;
  }

  /**
   * Track an event listener with tagged context.
   * @param {HTMLElement|EventTarget} el
   * @param {string} evt
   * @param {function} handler
   * @param {object} opts
   */
  function registerListener(api, el, evt, handler, opts = {}) {
    const optionsWithContext = {
      ...opts,
      context: MODULE_CONTEXT,
      module: MODULE_CONTEXT,
      source: opts.source || opts.description || `event_${evt}`
    };
    api.evts.trackListener(el, evt, handler, optionsWithContext);
  }

  /**
   * Remove all listeners registered with this module's context.
   */
  function cleanup(api) {
    if (api.ds && typeof api.ds.cleanupModuleListeners === 'function') {
      api.ds.cleanupModuleListeners(MODULE_CONTEXT);
    } else if (api.evts && typeof api.evts.cleanupListeners === 'function') {
      api.evts.cleanupListeners({ context: MODULE_CONTEXT });
    }
  }

  function clampInt(val, min, max, fallback) {
    if (val === undefined || val === null || isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, parseInt(val, 10)));
  }

  // -------- Model Config Business Logic --------

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

  function getConfig(state) {
    return { ...state };
  }

  function onConfigChange(api, callback) {
    const listener = (e) => {
      if (e.detail) callback(e.detail);
    };
    const eventTarget = (api.ds?.modules?.get?.('domAPI')?.getDocument?.()) || (typeof document !== 'undefined' ? document : null);
    if (eventTarget) {
      registerListener(api, eventTarget, 'modelConfigChanged', listener, {
        description: 'model config change subscription'
      });
    }
  }

  function setStateFromConfig(state, config) {
    Object.assign(state, {
      modelName: config.modelName || state.modelName,
      maxTokens: clampInt(config.maxTokens, 100, 100000, state.maxTokens),
      reasoningEffort: config.reasoningEffort || state.reasoningEffort,
      visionEnabled: (config.visionEnabled !== undefined) ? config.visionEnabled : state.visionEnabled,
      visionDetail: config.visionDetail || state.visionDetail,
      extendedThinking: (config.extendedThinking !== undefined)
        ? config.extendedThinking : state.extendedThinking,
      thinkingBudget: clampInt(config.thinkingBudget, 2048, 32000, state.thinkingBudget),
      customInstructions: config.customInstructions !== undefined ? config.customInstructions : state.customInstructions,
      azureParams: {
        maxCompletionTokens: clampInt(
          config.azureParams?.maxCompletionTokens,
          1000,
          10000,
          state.azureParams.maxCompletionTokens
        ),
        reasoningEffort: config.azureParams?.reasoningEffort
          || state.azureParams.reasoningEffort,
        visionDetail: config.azureParams?.visionDetail
          || state.azureParams.visionDetail
      }
    });
  }

  function persistConfig(api, state) {
    api.store.setItem('modelName', state.modelName);
    api.store.setItem('provider', state.provider);
    api.store.setItem('maxTokens', state.maxTokens.toString());
    api.store.setItem('reasoningEffort', state.reasoningEffort);
    api.store.setItem('visionEnabled', state.visionEnabled.toString());
    api.store.setItem('visionDetail', state.visionDetail);
    api.store.setItem('extendedThinking', state.extendedThinking.toString());
    api.store.setItem('thinkingBudget', state.thinkingBudget.toString());
    api.store.setItem('globalCustomInstructions', state.customInstructions);
    api.store.setItem('azureMaxCompletionTokens', state.azureParams.maxCompletionTokens.toString());
    api.store.setItem('azureReasoningEffort', state.azureParams.reasoningEffort);
    api.store.setItem('azureVisionDetail', state.azureParams.visionDetail);
  }

  function notifyChatManager(api, state) {
    const chatManager = api.ds?.modules?.get?.('chatManager');
    if (chatManager?.updateModelConfig) {
      chatManager.updateModelConfig({ ...state });
    }
  }

  function dispatchGlobalEvent(api, eventName, detailObj) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
      domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent(eventName, { detail: detailObj }));
    }
  }

  function updateModelConfig(api, state, config) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    const loadingEl = domAPI && typeof domAPI.getElementById === 'function'
      ? domAPI.getElementById('modelConfigLoading') : null;
    if (loadingEl) loadingEl.classList.remove('hidden');
    setStateFromConfig(state, config);
    persistConfig(api, state);
    notifyChatManager(api, state);
    updateModelDisplay(api, state);
    dispatchGlobalEvent(api, 'modelConfigChanged', { ...state });
    api.delayed(() => {
      if (loadingEl) loadingEl.classList.add('hidden');
    }, 100);
  }

  // --------- UI Setup ---------
  function initializeUI(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    setupModelDropdown(api, state);
    setupMaxTokensUI(api, state);
    setupVisionUI(api, state);
    setupExtendedThinkingUI(api, state);
    setupCustomInstructionsUI(api, state);
    updateModelDisplay(api, state);
    dispatchGlobalEvent(api, 'modelconfig:initialized', { success: true });
  }

  function setupModelDropdown(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const sel = domAPI.getElementById('modelSelect');
    if (!sel) return;
    sel.textContent = '';
    const opts = getModelOptions();
    opts.forEach((m) => {
      const opt = domAPI.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
    sel.value = state.modelName;
    registerListener(api, sel, 'change', () => {
      const selectedModel = getModelOptions().find(m => m.id === sel.value);
      updateModelConfig(api, state, { modelName: sel.value, provider: selectedModel?.provider || 'unknown' });
      setupVisionUI(api, state);
      updateModelDisplay(api, state);
    }, { description: 'model dropdown change' });
  }

  function setupMaxTokensUI(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const container = domAPI.getElementById('maxTokensContainer');
    if (!container) return;
    const currentVal = state.maxTokens || 4096;
    const slider = domAPI.createElement('input');
    slider.type = 'range';
    slider.min = '100';
    slider.max = '100000';
    slider.value = currentVal;
    slider.className = 'w-full mt-2 range range-xs';
    const display = domAPI.createElement('div');
    display.className = 'text-sm text-gray-600 dark:text-gray-400';
    display.textContent = `${currentVal} tokens`;
    registerListener(api, slider, 'input', (e) => {
      const t = parseInt(e.target.value, 10);
      display.textContent = `${t} tokens`;
      updateModelConfig(api, state, { maxTokens: t });
    }, { description: 'maxTokens slider input' });
    container.textContent = '';
    container.append(slider, display);
  }

  function setupVisionUI(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const panel = domAPI.getElementById('visionPanel');
    if (!panel) return;
    const name = state.modelName;
    const supports = getModelOptions().find((m) => m.id === name)?.supportsVision;
    panel.classList.toggle('hidden', !supports);
    if (!supports) {
      panel.textContent = '';
      return;
    }
    panel.textContent = '';
    const toggle = domAPI.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'visionToggle';
    toggle.className = 'toggle toggle-sm mr-2';
    toggle.checked = state.visionEnabled;
    const label = domAPI.createElement('label');
    label.htmlFor = 'visionToggle';
    label.className = 'text-sm cursor-pointer';
    label.textContent = 'Enable Vision';
    const wrapper = domAPI.createElement('div');
    wrapper.className = 'flex items-center';
    wrapper.append(toggle, label);
    registerListener(api, toggle, 'change', () => {
      updateModelConfig(api, state, { visionEnabled: toggle.checked });
    }, { description: 'vision toggle check' });
    panel.appendChild(wrapper);
  }

  function setupExtendedThinkingUI(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const toggle = domAPI.getElementById('extendedThinkingToggle');
    const budgetSelect = domAPI.getElementById('thinkingBudget');
    const panel = domAPI.getElementById('extendedThinkingPanel');
    if (!toggle || !budgetSelect || !panel) return;
    toggle.checked = state.extendedThinking;
    budgetSelect.value = state.thinkingBudget.toString();
    panel.classList.toggle('hidden', !state.extendedThinking);
    registerListener(api, toggle, 'change', () => {
      const isChecked = toggle.checked;
      panel.classList.toggle('hidden', !isChecked);
      updateModelConfig(api, state, { extendedThinking: isChecked });
    }, { description: 'extended thinking toggle change' });
    registerListener(api, budgetSelect, 'change', () => {
      updateModelConfig(api, state, { thinkingBudget: parseInt(budgetSelect.value, 10) });
    }, { description: 'thinking budget select change' });
  }

  function setupCustomInstructionsUI(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const textarea = domAPI.getElementById('globalCustomInstructions');
    const saveButton = domAPI.getElementById('saveGlobalInstructions');
    if (!textarea || !saveButton) return;
    textarea.value = state.customInstructions;
    registerListener(api, saveButton, 'click', () => {
      updateModelConfig(api, state, { customInstructions: textarea.value });
    }, { description: 'save global custom instructions' });
  }

  function updateModelDisplay(api, state) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const modelNameEl = domAPI.getElementById('currentModelName');
    const maxTokensEl = domAPI.getElementById('currentMaxTokens');
    const reasoningEl = domAPI.getElementById('currentReasoning');
    const visionStatusEl = domAPI.getElementById('visionEnabledStatus');
    if (modelNameEl) {
      const modelOption = getModelOptions().find(m => m.id === state.modelName);
      modelNameEl.textContent = modelOption ? modelOption.name : state.modelName;
    }
    if (maxTokensEl) {
      maxTokensEl.textContent = state.maxTokens.toString();
    }
    if (reasoningEl) {
      reasoningEl.textContent = state.reasoningEffort || 'N/A';
    }
    if (visionStatusEl) {
      const modelSupportsVision = getModelOptions().find(m => m.id === state.modelName)?.supportsVision;
      if (modelSupportsVision) {
        visionStatusEl.textContent = state.visionEnabled ? 'Enabled' : 'Disabled';
      } else {
        visionStatusEl.textContent = 'Not Supported';
      }
    }
  }

  // ---- Quick Config Rendering ----
  function renderQuickConfig(api, state, container) {
    if (!container) return;
    container.textContent = '';
    api.delayed(() => {
      try {
        buildModelSelectUI(api, state, container);
        buildMaxTokensUI(api, state, container);
        buildVisionToggleIfNeeded(api, state, container);
        dispatchGlobalEvent(api, 'modelConfigRendered', { containerId: container.id });
      } catch (error) {
        const fallbackHTML = `<div class="p-2 text-xs">Error loading config.</div>`;
        container.textContent = '';
        container.insertAdjacentHTML(
          'beforeend',
          sanitizer.sanitize(fallbackHTML)
        );
        dispatchGlobalEvent(api, 'modelConfigRendered', { containerId: container.id, error: true });
      }
    }, 0);
  }

  function buildModelSelectUI(api, state, container) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const modelLabel = domAPI.createElement('label');
    modelLabel.htmlFor = `quickModelSelect-${container.id}`;
    modelLabel.className = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
    modelLabel.textContent = 'Model:';
    const modelSelect = domAPI.createElement('select');
    modelSelect.id = `quickModelSelect-${container.id}`;
    modelSelect.className = 'select select-bordered select-sm w-full mb-2';
    getModelOptions().forEach((opt) => {
      const option = domAPI.createElement('option');
      option.value = opt.id;
      option.text = opt.name;
      modelSelect.appendChild(option);
    });
    modelSelect.value = state.modelName;
    registerListener(api, modelSelect, 'change', () => {
      const selectedModel = getModelOptions().find(m => m.id === modelSelect.value);
      updateModelConfig(api, state, { modelName: modelSelect.value, provider: selectedModel?.provider || 'unknown' });
      const visionContainer = container.querySelector('.quick-vision-container');
      if (visionContainer) {
        visionContainer.remove();
        buildVisionToggleIfNeeded(api, state, container);
      }
    }, { description: `quick config model select for ${container.id}` });
    container.appendChild(modelLabel);
    container.appendChild(modelSelect);
  }

  function buildMaxTokensUI(api, state, container) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const maxTokensDiv = domAPI.createElement('div');
    maxTokensDiv.className = 'my-2 flex flex-col';
    const maxTokensLabel = domAPI.createElement('label');
    maxTokensLabel.htmlFor = `quickMaxTokens-${container.id}`;
    maxTokensLabel.className = 'text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';
    maxTokensLabel.textContent = 'Max Tokens:';
    const maxTokensValue = domAPI.createElement('span');
    maxTokensValue.className = 'ml-1 text-xs text-gray-500 dark:text-gray-400';
    maxTokensValue.textContent = state.maxTokens;
    const maxTokensInput = domAPI.createElement('input');
    maxTokensInput.id = `quickMaxTokens-${container.id}`;
    maxTokensInput.type = 'range';
    maxTokensInput.min = '100';
    maxTokensInput.max = '100000';
    maxTokensInput.value = state.maxTokens;
    maxTokensInput.className = 'range range-xs';
    registerListener(api, maxTokensInput, 'input', (e) => {
      const val = parseInt(e.target.value, 10);
      maxTokensValue.textContent = val;
      updateModelConfig(api, state, { maxTokens: val });
    }, { description: `quick config maxTokens slider for ${container.id}` });
    const labelAndValue = domAPI.createElement('div');
    labelAndValue.className = 'flex justify-between items-center';
    labelAndValue.append(maxTokensLabel, maxTokensValue);
    maxTokensDiv.append(labelAndValue, maxTokensInput);
    container.appendChild(maxTokensDiv);
  }

  function buildVisionToggleIfNeeded(api, state, container) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (!domAPI) return;
    const model = getModelOptions().find((m) => m.id === state.modelName);
    if (!model?.supportsVision) return;
    const visionDiv = domAPI.createElement('div');
    visionDiv.className = 'mt-2 flex items-center quick-vision-container';
    const toggle = domAPI.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = `quickVisionToggle-${container.id}`;
    toggle.className = 'toggle toggle-xs mr-2';
    toggle.checked = state.visionEnabled;
    const toggleLabel = domAPI.createElement('label');
    toggleLabel.htmlFor = `quickVisionToggle-${container.id}`;
    toggleLabel.className = 'text-xs cursor-pointer';
    toggleLabel.textContent = 'Enable Vision';
    registerListener(api, toggle, 'change', () => {
      updateModelConfig(api, state, { visionEnabled: toggle.checked });
    }, { description: `quick config vision toggle for ${container.id}` });
    visionDiv.append(toggle, toggleLabel);
    container.appendChild(visionDiv);
  }

  // -------- FINAL MODULE ASSEMBLY (Factory, notification-free) --------
  const moduleBuild = (function buildModule() {
    const api = setupDependencies();
    const state = buildState(api);
    // Public module API
    const modelApi = {
      getConfig: () => getConfig(state),
      updateConfig: (cfg) => updateModelConfig(api, state, cfg),
      getModelOptions,
      onConfigChange: (cb) => onConfigChange(api, cb),
      initializeUI: () => initializeUI(api, state),
      renderQuickConfig: (container) => renderQuickConfig(api, state, container),
      cleanup: () => cleanup(api),
      initWithReadiness: async () => {
        const ds = api.ds;
        if (!ds?.waitFor)
          throw new Error('[ModelConfig] DependencySystem.waitFor is required for readiness gating.');
        await ds.waitFor(['app', 'domAPI']);
        initializeUI(api, state);
      }
    };
    return modelApi;
  }());
  return moduleBuild;
}

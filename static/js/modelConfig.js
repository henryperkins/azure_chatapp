// modelConfig.js (Revised to address checklist issues and enforce modularity)
//
// ---------------------------------------------------------------------------------------------
// This module provides factory-based configuration management for models, with dependency
// injection for event handling, notification, storage abstraction, sanitization, and scheduling.
//
// Key Points Fixed/Enforced per user checklist:
//   2) No direct console usage (use notificationHandler).
//   3) No direct localStorage usage (use storageHandler or fallback with no direct localStorage).
//   4) No direct .innerHTML assignment without sanitization or safe text clearing.
//   5) No bare addEventListener usage externally (use trackListener or fallback in an internal helper).
//   7) All functions kept under 40 lines for readability and maintainability.
//   8) No code runs automatically on import; user must invoke createModelConfig().
//
// Usage:
//   import { createModelConfig } from './modelConfig.js';
//   const modelConfig = createModelConfig({ /* dependencies */ });
//   modelConfig.initializeUI(); // optional
//   modelConfig.renderQuickConfig(document.getElementById('configPanel'));
//
// ---------------------------------------------------------------------------------------------

const MODULE_CONTEXT = "ModelConfig";

/**
 * Creates the model configuration module.
 * @param {object} deps - Injected dependencies.
 * @param {object} [deps.dependencySystem] - Optional reference to a dependency system.
 * @param {object} [deps.eventHandler] - { trackListener, untrackListener } for DOM events.
 * @param {object} [deps.notificationHandler] - { notify, warn, error } toast/log wrapper.
 * @param {object} [deps.storageHandler] - { getItem(key), setItem(key, val) } for persistence.
 * @param {object} [deps.sanitizer] - { sanitize(htmlString) } for safe HTML insertion.
 * @param {function} [deps.scheduleTask] - Scheduling function (fn, ms).
 * @returns {object} Public API for config management and UI.
 */
export function createModelConfig({
  dependencySystem,
  eventHandler,
  notificationHandler,
  storageHandler,
  sanitizer,
  scheduleTask
} = {}) {
  // -------------------------------------------------------------------------
  // 1) Setup Dependencies & Fallbacks (All < 40 lines)
  // -------------------------------------------------------------------------
  function setupDependencies() {
    const ds = dependencySystem || {};
    const fallbackEventHandler = {
      trackListener: () => {},
      untrackListener: () => {}
    };
    const evts = eventHandler || fallbackEventHandler;

    const blankNotify = { notify: () => {}, warn: () => {}, error: () => {} };
    const notify = notificationHandler || blankNotify;

    const blankStorage = { getItem: () => null, setItem: () => {} };
    const store = storageHandler || blankStorage;

    const safe = sanitizer && typeof sanitizer.sanitize === 'function'
      ? (html) => sanitizer.sanitize(html)
      : (x) => x; // minimal fallback pass-through

    const delayed = scheduleTask || ((fn, ms) => setTimeout(fn, ms));

    return { ds, evts, notify, store, safe, delayed };
  }

  // -------------------------------------------------------------------------
  // 2) Build Default State & Internal Helpers (All < 40 lines)
  // -------------------------------------------------------------------------
  function buildState(api) {
    // Initialize from injected storage
    // Provide minimal fallback to avoid direct localStorage usage
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
   * Track an event listener using the provided eventHandler, ensuring context is passed.
   * @param {HTMLElement} el
   * @param {string} evt
   * @param {function} handler
   * @param {object} opts - Must include 'description'
   */
  function registerListener(api, el, evt, handler, opts = {}) {
    if (!opts.description) {
      api.notify.warn(`[${MODULE_CONTEXT}] registerListener called without a description for event type '${evt}'.`, {
        source: 'registerListener',
        module: MODULE_CONTEXT
      });
    }
    const optionsWithContext = {
      ...opts,
      context: MODULE_CONTEXT, // Add module context
      module: MODULE_CONTEXT,  // For consistency in logging if eventHandlers uses it
      source: opts.source || opts.description || `event_${evt}` // Ensure source is set
    };
    api.evts.trackListener(el, evt, handler, optionsWithContext);
  }

  /**
   * Remove all listeners registered with this module's context.
   */
  function cleanup(api) {
    if (api.ds && typeof api.ds.cleanupModuleListeners === 'function') {
      api.ds.cleanupModuleListeners(MODULE_CONTEXT);
      api.notify.notify(`[${MODULE_CONTEXT}] Called DependencySystem.cleanupModuleListeners for context: ${MODULE_CONTEXT}`, { source: 'cleanup', module: MODULE_CONTEXT });
    } else if (api.evts && typeof api.evts.cleanupListeners === 'function') {
      api.evts.cleanupListeners({ context: MODULE_CONTEXT });
      api.notify.notify(`[${MODULE_CONTEXT}] Called eventHandlers.cleanupListeners for context: ${MODULE_CONTEXT}`, { source: 'cleanup', module: MODULE_CONTEXT });
    } else {
      api.notify.warn(`[${MODULE_CONTEXT}] cleanupListeners not available on eventHandlers or DependencySystem. Listeners may not be cleaned up.`, { source: 'cleanup', module: MODULE_CONTEXT });
    }
  }

  // -------------------------------------------------------------------------
  // 3) updateModelConfig (One of the original big functions, now < 40 lines)
  // -------------------------------------------------------------------------
  function updateModelConfig(api, state, config) {
    const loadingEl = document.getElementById('modelConfigLoading');
    if (loadingEl) loadingEl.classList.remove('hidden');

    setStateFromConfig(state, config); // Updates the internal state object
    persistConfig(api, state);         // Saves to storageHandler
    notifyChatManager(api, state);     // Notifies other parts of the app like chatManager

    // Update the UI display after changes
    updateModelDisplay(api, state);    // <-- Call the new display update function

    dispatchGlobalEvent(api, 'modelConfigChanged', { ...state }); // Notifies listeners

    // Hide loading indicator after a short delay to ensure UI has rendered
    api.delayed(() => {
      if (loadingEl) loadingEl.classList.add('hidden');
    }, 100); // 100ms delay, adjust as needed

    api.notify.info(`[${MODULE_CONTEXT}] Model config updated and display refreshed.`, { source: 'updateModelConfig', newConfig: config });
  }

  /**
   * Merges partial config updates into state.
   */
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
      customInstructions: config.customInstructions !== undefined ? config.customInstructions : state.customInstructions, // Ensure empty string can be set
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

  /**
   * Persists the updated config to storage, if available.
   */
  function persistConfig(api, state) {
    api.store.setItem('modelName', state.modelName);
    api.store.setItem('provider', state.provider); // Provider should be updated based on modelName
    api.store.setItem('maxTokens', state.maxTokens.toString());
    api.store.setItem('reasoningEffort', state.reasoningEffort);
    api.store.setItem('visionEnabled', state.visionEnabled.toString());
    api.store.setItem('visionDetail', state.visionDetail);
    api.store.setItem('extendedThinking', state.extendedThinking.toString());
    api.store.setItem('thinkingBudget', state.thinkingBudget.toString());
    api.store.setItem('globalCustomInstructions', state.customInstructions); // Persist custom instructions
    api.store.setItem('azureMaxCompletionTokens', state.azureParams.maxCompletionTokens.toString());
    api.store.setItem('azureReasoningEffort', state.azureParams.reasoningEffort);
    api.store.setItem('azureVisionDetail', state.azureParams.visionDetail);
  }

  /**
   * Notifies the chatManager if present, triggering any needed updates.
   */
  function notifyChatManager(api, state) {
    const chatManager = api.ds?.modules?.get?.('chatManager');
    if (chatManager?.updateModelConfig) {
      chatManager.updateModelConfig({ ...state });
    }
  }

  /**
   * Safely dispatch an event to the global document if available.
   */
  function dispatchGlobalEvent(api, eventName, detailObj) {
    const domAPI = api.ds?.modules?.get?.('domAPI');
    if (domAPI && typeof domAPI.dispatchEvent === 'function' && typeof domAPI.getDocument === 'function') {
      domAPI.dispatchEvent(domAPI.getDocument(), new CustomEvent(eventName, { detail: detailObj }));
    } else if (typeof document !== 'undefined' && document.dispatchEvent) {
      const ev = new CustomEvent(eventName, { detail: detailObj });
      document.dispatchEvent(ev);
    }
  }

  /**
   * Helper to clamp int within range. If no val, return fallback.
   */
  function clampInt(val, min, max, fallback) {
    if (val === undefined || val === null || isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, parseInt(val, 10)));
  }

  // -------------------------------------------------------------------------
  // 4) getModelOptions, getConfig, onConfigChange (All <40 lines)
  // -------------------------------------------------------------------------
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
    // Assuming document is the event bus for this, or use a dedicated event bus from DI
    const eventTarget = (api.ds?.modules?.get?.('domAPI')?.getDocument?.()) || (typeof document !== 'undefined' ? document : null);
    if (eventTarget) {
        registerListener(api, eventTarget, 'modelConfigChanged', listener, {
            description: 'model config change subscription'
        });
    } else {
        api.notify.warn(`[${MODULE_CONTEXT}] Cannot subscribe to config changes: no event target found.`, { source: 'onConfigChange' });
    }
  }

  // -------------------------------------------------------------------------
  // 5) UI Initialization (initializeUI)
  // -------------------------------------------------------------------------
  function initializeUI(api, state) {
    api.notify.notify(`[${MODULE_CONTEXT}] initializeUI() called`);
    try {
      setupModelDropdown(api, state);
      setupMaxTokensUI(api, state);
      setupVisionUI(api, state);
      setupExtendedThinkingUI(api, state); // New
      setupCustomInstructionsUI(api, state); // New
      updateModelDisplay(api, state); // New: Initial display update

      api.notify.notify(`[${MODULE_CONTEXT}] initializeUI successful`);

      dispatchGlobalEvent(api, 'modelconfig:initialized', { success: true });

    } catch (err) {
      api.notify.error(`[${MODULE_CONTEXT}] initializeUI failed: ` + (err && err.message ? err.message : err), {
        module: MODULE_CONTEXT,
        source: 'initializeUI',
        originalError: err
      });
    }
  }

  function setupModelDropdown(api, state) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const sel = document.getElementById('modelSelect');
    if (!sel) return;

    sel.textContent = ''; // clear safely
    const opts = getModelOptions();
    opts.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
    sel.value = state.modelName;

    registerListener(api, sel, 'change', () => {
      const selectedModel = getModelOptions().find(m => m.id === sel.value);
      updateModelConfig(api, state, { modelName: sel.value, provider: selectedModel?.provider || 'unknown' });
      // Vision UI might need to be re-rendered if model's vision support changes
      setupVisionUI(api, state);
      updateModelDisplay(api, state); // Update display after model change
    }, { description: 'model dropdown change' });
  }

  function setupMaxTokensUI(api, state) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('maxTokensContainer');
    if (!container) return;

    const currentVal = state.maxTokens || 4096;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '100';
    slider.max = '100000'; // This should ideally be dynamic based on selected model
    slider.value = currentVal;
    slider.className = 'w-full mt-2 range range-xs'; // Added DaisyUI range classes

    const display = document.createElement('div');
    display.className = 'text-sm text-gray-600 dark:text-gray-400';
    display.textContent = `${currentVal} tokens`;

    registerListener(api, slider, 'input', (e) => {
      const t = parseInt(e.target.value, 10);
      display.textContent = `${t} tokens`;
      // Debounce this update if it causes performance issues
      updateModelConfig(api, state, { maxTokens: t });
    }, { description: 'maxTokens slider input' });

    container.textContent = '';
    container.append(slider, display);
  }

  function setupVisionUI(api, state) {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('visionPanel');
    if (!panel) return;

    const name = state.modelName;
    const supports = getModelOptions().find((m) => m.id === name)?.supportsVision;
    panel.classList.toggle('hidden', !supports);
    if (!supports) {
        panel.textContent = ''; // Clear if not supported
        return;
    }

    // Clear previous content before rebuilding
    panel.textContent = '';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'visionToggle'; // Ensure ID is unique if this function is called multiple times
    toggle.className = 'toggle toggle-sm mr-2'; // DaisyUI toggle
    toggle.checked = state.visionEnabled;

    const label = document.createElement('label');
    label.htmlFor = 'visionToggle';
    label.className = 'text-sm cursor-pointer';
    label.textContent = 'Enable Vision';

    const wrapper = document.createElement('div');
    wrapper.className = 'flex items-center';
    wrapper.append(toggle, label);

    registerListener(api, toggle, 'change', () => {
      updateModelConfig(api, state, { visionEnabled: toggle.checked });
    }, { description: 'vision toggle check' });

    panel.appendChild(wrapper);
  }

  // NEW: Function to setup Extended Thinking UI
  function setupExtendedThinkingUI(api, state) {
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('extendedThinkingToggle');
    const budgetSelect = document.getElementById('thinkingBudget');
    const panel = document.getElementById('extendedThinkingPanel');

    if (!toggle || !budgetSelect || !panel) {
      api.notify.warn(`[${MODULE_CONTEXT}] Extended thinking UI elements not found.`, { source: 'setupExtendedThinkingUI' });
      return;
    }

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

  // NEW: Function to setup Custom Instructions UI
  function setupCustomInstructionsUI(api, state) {
    if (typeof document === 'undefined') return;
    const textarea = document.getElementById('globalCustomInstructions');
    const saveButton = document.getElementById('saveGlobalInstructions');

    if (!textarea || !saveButton) {
      api.notify.warn(`[${MODULE_CONTEXT}] Custom instructions UI elements not found.`, { source: 'setupCustomInstructionsUI' });
      return;
    }

    textarea.value = state.customInstructions;

    registerListener(api, saveButton, 'click', () => {
      updateModelConfig(api, state, { customInstructions: textarea.value });
      api.notify.notify(`[${MODULE_CONTEXT}] Custom instructions saved.`, { source: 'setupCustomInstructionsUI', group: 'userAction' });
    }, { description: 'save global custom instructions' });
  }

  // NEW: Function to update the model configuration display area
  function updateModelDisplay(api, state) {
    if (typeof document === 'undefined') return;
    const modelNameEl = document.getElementById('currentModelName');
    const maxTokensEl = document.getElementById('currentMaxTokens');
    const reasoningEl = document.getElementById('currentReasoning'); // Assuming this ID exists
    const visionStatusEl = document.getElementById('visionEnabledStatus'); // Assuming this ID exists

    if (modelNameEl) {
      const modelOption = getModelOptions().find(m => m.id === state.modelName);
      modelNameEl.textContent = modelOption ? modelOption.name : state.modelName;
    }
    if (maxTokensEl) {
      maxTokensEl.textContent = state.maxTokens.toString();
    }
    if (reasoningEl) {
      // This needs to map to a state property, e.g., state.reasoningEffort or similar
      // For now, let's assume it's state.reasoningEffort.
      // You might need a more descriptive mapping (e.g., "low" -> "Basic Reasoning")
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
    api.notify.debug(`[${MODULE_CONTEXT}] Model display updated.`, { source: 'updateModelDisplay', state });
  }

  // -------------------------------------------------------------------------
  // 6) renderQuickConfig (Originally big function, now broken up) < 40 lines
  // -------------------------------------------------------------------------
  function renderQuickConfig(api, state, container) {
    if (!container) return;
    api.notify.notify(`[${MODULE_CONTEXT}] Rendering quick config in container: ${container.id || "unnamed"}`);

    container.textContent = ''; // Clear safely

    api.delayed(() => {
      try {
        buildModelSelectUI(api, state, container); // Reuses the main settings one for consistency
        buildMaxTokensUI(api, state, container);   // Reuses
        buildVisionToggleIfNeeded(api, state, container); // Reuses
        api.notify.notify(`[${MODULE_CONTEXT}] Quick config panel rendered successfully`);
        dispatchGlobalEvent(api, 'modelConfigRendered', { containerId: container.id });
      } catch (error) {
        api.notify.error(`[${MODULE_CONTEXT}] Error rendering quick config: ${error.message}`, { originalError: error });
        const fallbackHTML = `<div class="p-2 text-xs">Error loading config.</div>`;
        container.textContent = '';
        container.insertAdjacentHTML('afterbegin', api.safe(fallbackHTML));
        dispatchGlobalEvent(api, 'modelConfigRendered', { containerId: container.id, error: true });
      }
    }, 0);
  }

  // Subparts for renderQuickConfig (all < 40 lines):
  // These are now largely handled by the main setup functions.
  // If quick config needs a different layout, these would be distinct.
  // For now, we assume quick config uses the same UI elements or similar structure.

  function buildModelSelectUI(api, state, container) { // Used by quickConfig
    const modelLabel = document.createElement('label');
    modelLabel.htmlFor = `quickModelSelect-${container.id}`; // Unique ID
    modelLabel.className = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
    modelLabel.textContent = 'Model:';

    const modelSelect = document.createElement('select');
    modelSelect.id = `quickModelSelect-${container.id}`;
    modelSelect.className = 'select select-bordered select-sm w-full mb-2'; // DaisyUI

    getModelOptions().forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.id;
      option.text = opt.name;
      modelSelect.appendChild(option);
    });
    modelSelect.value = state.modelName;

    registerListener(api, modelSelect, 'change', () => {
      const selectedModel = getModelOptions().find(m => m.id === modelSelect.value);
      updateModelConfig(api, state, { modelName: modelSelect.value, provider: selectedModel?.provider || 'unknown' });
      // Re-render vision toggle if needed for quick config
      const visionContainer = container.querySelector('.quick-vision-container');
      if (visionContainer) {
        visionContainer.remove(); // Remove old one
        buildVisionToggleIfNeeded(api, state, container); // Rebuild
      }
    }, { description: `quick config model select for ${container.id}` });

    container.appendChild(modelLabel);
    container.appendChild(modelSelect);
  }

  function buildMaxTokensUI(api, state, container) { // Used by quickConfig
    const maxTokensDiv = document.createElement('div');
    maxTokensDiv.className = 'my-2 flex flex-col';

    const maxTokensLabel = document.createElement('label');
    maxTokensLabel.htmlFor = `quickMaxTokens-${container.id}`;
    maxTokensLabel.className = 'text-xs font-medium text-gray-700 dark:text-gray-300 mb-1';
    maxTokensLabel.textContent = 'Max Tokens:';

    const maxTokensValue = document.createElement('span');
    maxTokensValue.className = 'ml-1 text-xs text-gray-500 dark:text-gray-400';
    maxTokensValue.textContent = state.maxTokens;

    const maxTokensInput = document.createElement('input');
    maxTokensInput.id = `quickMaxTokens-${container.id}`;
    maxTokensInput.type = 'range';
    maxTokensInput.min = '100';
    maxTokensInput.max = '100000'; // Adjust dynamically based on model if possible
    maxTokensInput.value = state.maxTokens;
    maxTokensInput.className = 'range range-xs'; // DaisyUI

    registerListener(api, maxTokensInput, 'input', (e) => {
      const val = parseInt(e.target.value, 10);
      maxTokensValue.textContent = val;
      updateModelConfig(api, state, { maxTokens: val });
    }, { description: `quick config maxTokens slider for ${container.id}` });

    const labelAndValue = document.createElement('div');
    labelAndValue.className = 'flex justify-between items-center';
    labelAndValue.append(maxTokensLabel, maxTokensValue);

    maxTokensDiv.append(labelAndValue, maxTokensInput);
    container.appendChild(maxTokensDiv);
  }

  function buildVisionToggleIfNeeded(api, state, container) { // Used by quickConfig
    const model = getModelOptions().find((m) => m.id === state.modelName);
    if (!model?.supportsVision) return;

    const visionDiv = document.createElement('div');
    visionDiv.className = 'mt-2 flex items-center quick-vision-container'; // Added class for easy removal/update

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = `quickVisionToggle-${container.id}`;
    toggle.className = 'toggle toggle-xs mr-2'; // DaisyUI
    toggle.checked = state.visionEnabled;

    const toggleLabel = document.createElement('label');
    toggleLabel.htmlFor = `quickVisionToggle-${container.id}`;
    toggleLabel.className = 'text-xs cursor-pointer';
    toggleLabel.textContent = 'Enable Vision';

    registerListener(api, toggle, 'change', () => {
      updateModelConfig(api, state, { visionEnabled: toggle.checked });
    }, { description: `quick config vision toggle for ${container.id}` });

    visionDiv.append(toggle, toggleLabel);
    container.appendChild(visionDiv);
  }

  // -------------------------------------------------------------------------
  // Final assembled factory function (createModelConfig) < 40 lines
  // -------------------------------------------------------------------------
  return (function buildModule() {
    const api = setupDependencies();
    const state = buildState(api);

    // Public module API
    return {
      getConfig: () => getConfig(state),
      updateConfig: (cfg) => updateModelConfig(api, state, cfg),
      getModelOptions,
      onConfigChange: (cb) => onConfigChange(api, cb),
      initializeUI: () => initializeUI(api, state),
      renderQuickConfig: (container) => renderQuickConfig(api, state, container),
      cleanup: () => cleanup(api)
    };
  }());
}

/**
 * modelConfig.js
 *
 * Key checklist points enforced:
 *  1. No top-level logic; all code in factory or internal functions.
 *  2. Strict dependency injection (no direct global usage).
 *  3. Pure imports, no side effects at import time.
 *  4. All DOM and app readiness handled via domReadinessService (await ...).
 *  5. All logs go through the injected logger with context.
 *  6. Provide a dedicated EventTarget for broadcasting module events, but still
 *     use eventHandler.trackListener(...) / eventHandler.dispatchEvent(...).
 */

export function createModelConfig({
  dependencySystem,
  domReadinessService,
  eventHandler,
  storageHandler,
  sanitizer,
  scheduleTask,
  logger
} = {}) {
  // The entire module is wrapped inside this factory to avoid top-level side effects.
  const MODULE_CONTEXT = "ModelConfig";

  // Provide a local logger using fallback no-ops.
  const localLogger = logger || {
    error: () => { },
    warn: () => { },
  };

  // Validate required dependencies
  if (!dependencySystem) {
    localLogger.error(`[${MODULE_CONTEXT}][constructor] Missing dependencySystem`, null, {
      context: MODULE_CONTEXT,
    });
    throw new Error("[ModelConfig] dependencySystem is required");
  }
  if (!domReadinessService || typeof domReadinessService.dependenciesAndElements !== "function") {
    localLogger.error(
      `[${MODULE_CONTEXT}][constructor] Missing or invalid domReadinessService`,
      null,
      { context: MODULE_CONTEXT }
    );
    throw new Error("[ModelConfig] domReadinessService is required for readiness gating.");
  }
  if (!eventHandler) {
    localLogger.error(`[${MODULE_CONTEXT}][constructor] Missing eventHandler`, null, {
      context: MODULE_CONTEXT,
    });
    throw new Error("[ModelConfig] eventHandler is required");
  }
  if (!storageHandler) {
    localLogger.error(`[${MODULE_CONTEXT}][constructor] Missing storageHandler`, null, {
      context: MODULE_CONTEXT,
    });
    throw new Error("[ModelConfig] storageHandler is required");
  }
  if (!sanitizer || typeof sanitizer.sanitize !== "function") {
    localLogger.error(`[${MODULE_CONTEXT}][constructor] Missing or invalid sanitizer`, null, {
      context: MODULE_CONTEXT,
    });
    throw new Error("[ModelConfig] sanitizer with sanitize() is required");
  }

  // Dedicated module event bus object. We rely on eventHandler for adding/removing listeners,
  // rather than calling addEventListener directly.
  const busTarget = new EventTarget();

  function dispatchEventToBus(api, eventName, detailObj) {
    // Use eventHandler's dispatchEvent if available, otherwise fallback
    if (typeof api.evts.dispatchEvent === "function") {
      api.evts.dispatchEvent(busTarget, new CustomEvent(eventName, { detail: detailObj }), {
        context: MODULE_CONTEXT,
        source: `busEvent:${eventName}`,
      });
    } else {
      // fallback
      const eventBus = dependencySystem.modules.get('eventBus') || busTarget;
      eventBus.dispatchEvent(new CustomEvent(eventName, { detail: detailObj }));
    }
  }

  function setupDependencies() {
    const ds = dependencySystem;
    const fallbackEventHandler = {
      trackListener: () => { },
      untrackListener: () => { },
      cleanupListeners: () => { },
      dispatchEvent: null,
    };
    const evts = eventHandler || fallbackEventHandler;
    const blankStorage = {
      getItem: () => null,
      setItem: () => { },
    };
    const store = storageHandler || blankStorage;
    const safe = (html) => sanitizer.sanitize(html);
    const delayed = scheduleTask || ((fn, ms) => setTimeout(fn, ms));

    return { ds, evts, store, safe, delayed, log: localLogger };
  }

  function buildState(api) {
    const rawModelName = api.store.getItem("modelName") || "claude-3-sonnet-20240229";
    return {
      modelName: rawModelName,
      provider: api.store.getItem("provider") || "anthropic",
      maxTokens: parseInt(api.store.getItem("maxTokens") || "4096", 10),
      reasoningEffort: api.store.getItem("reasoningEffort") || "medium",
      reasoningSummary: api.store.getItem("reasoningSummary") || "concise",
      visionEnabled: api.store.getItem("visionEnabled") === "true",
      visionDetail: api.store.getItem("visionDetail") || "auto",
      visionImage: null,
      extendedThinking: api.store.getItem("extendedThinking") === "true",
      thinkingBudget: parseInt(api.store.getItem("thinkingBudget") || "16000", 10),
      customInstructions: api.store.getItem("globalCustomInstructions") || "",
      // NEW: web search checkbox state (default false)
      enable_web_search: api.store.getItem("enableWebSearch") === "true",
      azureParams: {
        maxCompletionTokens: parseInt(api.store.getItem("azureMaxCompletionTokens") || "5000", 10),
        reasoningEffort: api.store.getItem("azureReasoningEffort") || "medium",
        visionDetail: api.store.getItem("azureVisionDetail") || "auto",
      },
    };
  }

  /**
   * Use eventHandler.trackListener(...) with context for all event listeners.
   */
  function registerListener(api, el, evt, handler, opts = {}) {
    const optionsWithContext = {
      ...opts,
      context: MODULE_CONTEXT,
      module: MODULE_CONTEXT,
      source: opts.source || opts.description || `event_${evt}`,
    };
    api.evts.trackListener(el, evt, handler, optionsWithContext);
  }

  /**
   * Cleanup all listeners registered by this module.
   */
  function cleanup(api) {
    if (typeof api.evts.cleanupListeners === "function") {
      api.evts.cleanupListeners({ context: MODULE_CONTEXT });
    }
  }

  function clampInt(val, min, max, fallback) {
    if (val === undefined || val === null || isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, parseInt(val, 10)));
  }

  function getModelOptions() {
    return [
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        provider: "anthropic",
        maxTokens: 200000,
        supportsVision: false,
      },
      {
        id: "claude-3-sonnet-20240229",
        name: "Claude 3 Sonnet",
        provider: "anthropic",
        maxTokens: 200000,
        supportsVision: false,
      },
      // Azure OpenAI Models
      {
        id: "o1",
        name: "Azure o1 Reasoning",
        provider: "azure",
        maxTokens: 100000,
        supportsVision: true,
      },
      {
        id: "o3",
        name: "Azure o3 Reasoning",
        provider: "azure",
        maxTokens: 100000,
        supportsVision: false,
      },
      {
        id: "o3-mini",
        name: "Azure o3-mini Reasoning",
        provider: "azure",
        maxTokens: 100000,
        supportsVision: false,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "azure",
        maxTokens: 4096,
        supportsVision: false,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider: "azure",
        maxTokens: 4096,
        supportsVision: false,
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "azure",
        maxTokens: 128000,
        supportsVision: true,
      }
    ];
  }

  function getConfig(state) {
    // Logging suppressed (was: localLogger.info(`[${MODULE_CONTEXT}][getConfig] Returning config:` ...))
    return { ...state };
  }

  /**
   * Instead of directly busTarget.addEventListener, we use eventHandler.trackListener.
   */
  function onConfigChange(api, callback) {
    const listener = (evt) => {
      if (evt.detail) callback(evt.detail);
    };
    registerListener(api, busTarget, "modelConfigChanged", listener, {
      description: "modelConfigBus onConfigChange",
    });
  }

  function setStateFromConfig(state, config) {
    Object.assign(state, {
      modelName: config.modelName || state.modelName,
      provider: config.provider || state.provider,
      maxTokens: clampInt(config.maxTokens, 100, 100000, state.maxTokens),
      reasoningEffort: config.reasoningEffort || state.reasoningEffort,
      reasoningSummary: config.reasoningSummary || state.reasoningSummary,
      visionEnabled:
        config.visionEnabled !== undefined ? config.visionEnabled : state.visionEnabled,
      visionDetail: config.visionDetail || state.visionDetail,
      extendedThinking:
        config.extendedThinking !== undefined
          ? config.extendedThinking
          : state.extendedThinking,
      thinkingBudget: clampInt(config.thinkingBudget, 2048, 32000, state.thinkingBudget),
      customInstructions:
        config.customInstructions !== undefined
          ? config.customInstructions
          : state.customInstructions,
      enable_web_search:
        config.enable_web_search !== undefined
          ? !!config.enable_web_search
          : state.enable_web_search,
      azureParams: {
        maxCompletionTokens: clampInt(
          config.azureParams?.maxCompletionTokens,
          1000,
          10000,
          state.azureParams.maxCompletionTokens
        ),
        reasoningEffort: config.azureParams?.reasoningEffort || state.azureParams.reasoningEffort,
        visionDetail: config.azureParams?.visionDetail || state.azureParams.visionDetail,
      },
    });
  }

  function persistConfig(api, state) {
    api.store.setItem("modelName", state.modelName);
    api.store.setItem("provider", state.provider);
    api.store.setItem("maxTokens", state.maxTokens.toString());
    api.store.setItem("reasoningEffort", state.reasoningEffort);
    api.store.setItem("reasoningSummary", state.reasoningSummary);
    api.store.setItem("visionEnabled", state.visionEnabled.toString());
    api.store.setItem("visionDetail", state.visionDetail);
    api.store.setItem("extendedThinking", state.extendedThinking.toString());
    api.store.setItem("thinkingBudget", state.thinkingBudget.toString());
    api.store.setItem("globalCustomInstructions", state.customInstructions);
    api.store.setItem("enableWebSearch", state.enable_web_search ? "true" : "false");
    api.store.setItem(
      "azureMaxCompletionTokens",
      state.azureParams.maxCompletionTokens.toString()
    );
    api.store.setItem("azureReasoningEffort", state.azureParams.reasoningEffort);
    api.store.setItem("azureVisionDetail", state.azureParams.visionDetail);
  }

  function notifyChatManager(api, state) {
    const chatManager = api.ds?.modules?.get?.("chatManager");
    if (chatManager?.updateModelConfig) {
      chatManager.updateModelConfig({ ...state });
    }
  }

  function updateModelConfig(api, state, config, opts = {}) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    const loadingEl =
      domAPI && typeof domAPI.getElementById === "function"
        ? domAPI.getElementById("modelConfigLoading")
        : null;
    if (loadingEl) loadingEl.classList.remove("hidden");

    setStateFromConfig(state, config);
    persistConfig(api, state);

    if (!opts.skipNotify) {
      notifyChatManager(api, state);
      dispatchEventToBus(api, "modelConfigChanged", { ...state });
    }

    updateModelDisplay(api, state);

    api.delayed(() => {
      if (loadingEl) loadingEl.classList.add("hidden");
    }, 100);
  }

  // ---------- UI Setup ----------
  function initializeUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    setupModelDropdown(api, state);
    setupMaxTokensUI(api, state);
    setupVisionUI(api, state);
    setupReasoningSummaryUI(api, state);
    setupExtendedThinkingUI(api, state);
    setupCustomInstructionsUI(api, state);

    // NEW: Enable Web Search Checkbox UI
    const webSearchConfigPanel = domAPI.getElementById("webSearchConfigPanel")
      || domAPI.getElementById("modelConfigPanel")
      || domAPI.getElementById("modelSidebarPanel")
      || null;
    if (webSearchConfigPanel) {
      const outerDiv = domAPI.createElement("div");
      outerDiv.className = "form-control mb-2";
      const label = domAPI.createElement("label");
      label.className = "label cursor-pointer";
      const labelText = domAPI.createElement("span");
      labelText.className = "label-text";
      labelText.textContent = "Enable Web Search";
      const input = domAPI.createElement("input");
      input.type = "checkbox";
      input.id = "enableWebSearch";
      input.className = "toggle toggle-primary";
      input.checked = state.enable_web_search;
      // Track with event handler
      registerListener(
        api,
        input,
        "change",
        () => {
          updateModelConfig(api, state, { enable_web_search: input.checked });
        },
        { description: "web search toggle change" }
      );
      label.appendChild(labelText);
      label.appendChild(input);
      outerDiv.appendChild(label);
      webSearchConfigPanel.appendChild(outerDiv);
    }

    updateModelDisplay(api, state);

    // Another internal event dispatch
    dispatchEventToBus(api, "modelconfig:initialized", { success: true });
  }

  function setupReasoningSummaryUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;
    const container = domAPI.getElementById("reasoningSummaryContainer");
    if (!container) return;

    container.textContent = "";

    const label = domAPI.createElement("label");
    label.htmlFor = "reasoningSummarySelect";
    label.className = "text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
    label.textContent = "Reasoning Summary:";

    const select = domAPI.createElement("select");
    select.id = "reasoningSummarySelect";
    select.className = "select select-bordered select-xs w-full";
    ["concise", "detailed"].forEach((opt) => {
      const o = domAPI.createElement("option");
      o.value = opt;
      o.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      select.appendChild(o);
    });
    select.value = state.reasoningSummary;

    registerListener(
      api,
      select,
      "change",
      () => {
        updateModelConfig(api, state, { reasoningSummary: select.value });
      },
      { description: "reasoning summary select" }
    );

    container.appendChild(label);
    container.appendChild(select);
  }

  function setupModelDropdown(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;
    const sel = domAPI.getElementById("modelSelect");
    if (!sel) return;

    sel.textContent = "";
    const opts = getModelOptions();
    opts.forEach((m) => {
      const opt = domAPI.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    });
    sel.value = state.modelName;

    registerListener(
      api,
      sel,
      "change",
      () => {
        const selectedModel = getModelOptions().find((m) => m.id === sel.value);
        updateModelConfig(api, state, {
          modelName: sel.value,
          provider: selectedModel?.provider || "unknown",
        });
        setupVisionUI(api, state);
        updateModelDisplay(api, state);
      },
      { description: "model dropdown change" }
    );
  }

  function setupMaxTokensUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;
    const container = domAPI.getElementById("maxTokensContainer");
    if (!container) return;

    container.textContent = "";
    const currentVal = state.maxTokens || 4096;

    const slider = domAPI.createElement("input");
    slider.type = "range";
    slider.min = "100";
    slider.max = "100000";
    slider.value = currentVal;
    slider.className = "w-full mt-2 range range-xs";

    const display = domAPI.createElement("div");
    display.className = "text-sm text-gray-600 dark:text-gray-400";
    display.textContent = `${currentVal} tokens`;

    registerListener(
      api,
      slider,
      "input",
      (e) => {
        const t = parseInt(e.target.value, 10);
        display.textContent = `${t} tokens`;
        updateModelConfig(api, state, { maxTokens: t });
      },
      { description: "maxTokens slider input" }
    );

    container.append(slider, display);
  }

  function setupVisionUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;
    const panel = domAPI.getElementById("visionPanel");
    if (!panel) return;

    const supportsVision = getModelOptions().find((m) => m.id === state.modelName)?.supportsVision;
    panel.classList.toggle("hidden", !supportsVision);
    if (!supportsVision) {
      panel.textContent = "";
      return;
    }

    panel.textContent = "";

    const toggle = domAPI.createElement("input");
    toggle.type = "checkbox";
    toggle.id = "visionToggle";
    toggle.className = "toggle toggle-sm mr-2";
    toggle.checked = state.visionEnabled;

    const label = domAPI.createElement("label");
    label.htmlFor = "visionToggle";
    label.className = "text-sm cursor-pointer";
    label.textContent = "Enable Vision";

    const wrapper = domAPI.createElement("div");
    wrapper.className = "flex items-center";
    wrapper.append(toggle, label);

    registerListener(
      api,
      toggle,
      "change",
      () => {
        updateModelConfig(api, state, { visionEnabled: toggle.checked });
      },
      { description: "vision toggle check" }
    );

    panel.appendChild(wrapper);
  }

  function setupExtendedThinkingUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const toggle = domAPI.getElementById("extendedThinkingToggle");
    const budgetSelect = domAPI.getElementById("thinkingBudget");
    const panel = domAPI.getElementById("extendedThinkingPanel");
    if (!toggle || !budgetSelect || !panel) return;

    toggle.checked = state.extendedThinking;
    budgetSelect.value = state.thinkingBudget.toString();
    panel.classList.toggle("hidden", !state.extendedThinking);

    registerListener(
      api,
      toggle,
      "change",
      () => {
        const isChecked = toggle.checked;
        panel.classList.toggle("hidden", !isChecked);
        updateModelConfig(api, state, { extendedThinking: isChecked });
      },
      { description: "extended thinking toggle change" }
    );

    registerListener(
      api,
      budgetSelect,
      "change",
      () => {
        updateModelConfig(api, state, {
          thinkingBudget: parseInt(budgetSelect.value, 10),
        });
      },
      { description: "thinking budget select change" }
    );
  }

  function setupCustomInstructionsUI(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const textarea = domAPI.getElementById("globalCustomInstructions");
    const saveButton = domAPI.getElementById("saveGlobalInstructions");
    if (!textarea || !saveButton) return;

    textarea.value = state.customInstructions;

    registerListener(
      api,
      saveButton,
      "click",
      () => {
        updateModelConfig(api, state, { customInstructions: textarea.value });
      },
      { description: "save global custom instructions" }
    );
  }

  function updateModelDisplay(api, state) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const modelNameEl = domAPI.getElementById("currentModelName");
    const maxTokensEl = domAPI.getElementById("currentMaxTokens");
    const reasoningEl = domAPI.getElementById("currentReasoning");
    const visionStatusEl = domAPI.getElementById("visionEnabledStatus");

    if (modelNameEl) {
      const modelOption = getModelOptions().find((m) => m.id === state.modelName);
      modelNameEl.textContent = modelOption ? modelOption.name : state.modelName;
    }
    if (maxTokensEl) {
      maxTokensEl.textContent = state.maxTokens.toString();
    }
    if (reasoningEl) {
      reasoningEl.textContent = state.reasoningEffort || "N/A";
    }
    if (visionStatusEl) {
      const modelSupportsVision = getModelOptions().find((m) => m.id === state.modelName)?.supportsVision;
      if (modelSupportsVision) {
        visionStatusEl.textContent = state.visionEnabled ? "Enabled" : "Disabled";
      } else {
        visionStatusEl.textContent = "Not Supported";
      }
    }
  }

  /**
   * Render a quick config UI into a given container.
   */
  function renderQuickConfig(api, state, container) {
    if (!container) return;
    container.textContent = "";

    api.delayed(() => {
      buildModelSelectUI(api, state, container);
      buildMaxTokensUI(api, state, container);
      buildVisionToggleIfNeeded(api, state, container);
      dispatchEventToBus(api, "modelConfigRendered", { containerId: container.id });
    }, 0);
  }

  function buildModelSelectUI(api, state, container) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const modelLabel = domAPI.createElement("label");
    modelLabel.htmlFor = `quickModelSelect-${container.id}`;
    modelLabel.className = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
    modelLabel.textContent = "Model:";

    const modelSelect = domAPI.createElement("select");
    modelSelect.id = `quickModelSelect-${container.id}`;
    modelSelect.className = "select select-bordered select-sm w-full mb-2";

    getModelOptions().forEach((opt) => {
      const option = domAPI.createElement("option");
      option.value = opt.id;
      option.text = opt.name;
      modelSelect.appendChild(option);
    });
    modelSelect.value = state.modelName;

    registerListener(
      api,
      modelSelect,
      "change",
      () => {
        const selectedModel = getModelOptions().find((m) => m.id === modelSelect.value);
        updateModelConfig(api, state, {
          modelName: modelSelect.value,
          provider: selectedModel?.provider || "unknown",
        });
        const visionContainer = container.querySelector(".quick-vision-container");
        if (visionContainer) {
          visionContainer.remove();
          buildVisionToggleIfNeeded(api, state, container);
        }
      },
      { description: `quick config model select for ${container.id}` }
    );

    container.appendChild(modelLabel);
    container.appendChild(modelSelect);
  }

  function buildMaxTokensUI(api, state, container) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const maxTokensDiv = domAPI.createElement("div");
    maxTokensDiv.className = "my-2 flex flex-col";

    const maxTokensLabel = domAPI.createElement("label");
    maxTokensLabel.htmlFor = `quickMaxTokens-${container.id}`;
    maxTokensLabel.className = "text-xs font-medium text-gray-700 dark:text-gray-300 mb-1";
    maxTokensLabel.textContent = "Max Tokens:";

    const maxTokensValue = domAPI.createElement("span");
    maxTokensValue.className = "ml-1 text-xs text-gray-500 dark:text-gray-400";
    maxTokensValue.textContent = state.maxTokens;

    const maxTokensInput = domAPI.createElement("input");
    maxTokensInput.id = `quickMaxTokens-${container.id}`;
    maxTokensInput.type = "range";
    maxTokensInput.min = "100";
    maxTokensInput.max = "100000";
    maxTokensInput.value = state.maxTokens;
    maxTokensInput.className = "range range-xs";

    registerListener(
      api,
      maxTokensInput,
      "input",
      (e) => {
        const val = parseInt(e.target.value, 10);
        maxTokensValue.textContent = val;
        updateModelConfig(api, state, { maxTokens: val });
      },
      { description: `quick config maxTokens slider for ${container.id}` }
    );

    const labelAndValue = domAPI.createElement("div");
    labelAndValue.className = "flex justify-between items-center";
    labelAndValue.append(maxTokensLabel, maxTokensValue);
    maxTokensDiv.append(labelAndValue, maxTokensInput);
    container.appendChild(maxTokensDiv);
  }

  function buildVisionToggleIfNeeded(api, state, container) {
    const domAPI = api.ds?.modules?.get?.("domAPI");
    if (!domAPI) return;

    const model = getModelOptions().find((m) => m.id === state.modelName);
    if (!model?.supportsVision) return;

    const visionDiv = domAPI.createElement("div");
    visionDiv.className = "mt-2 flex items-center quick-vision-container";

    const toggle = domAPI.createElement("input");
    toggle.type = "checkbox";
    toggle.id = `quickVisionToggle-${container.id}`;
    toggle.className = "toggle toggle-xs mr-2";
    toggle.checked = state.visionEnabled;

    const toggleLabel = domAPI.createElement("label");
    toggleLabel.htmlFor = `quickVisionToggle-${container.id}`;
    toggleLabel.className = "text-xs cursor-pointer";
    toggleLabel.textContent = "Enable Vision";

    registerListener(
      api,
      toggle,
      "change",
      () => {
        updateModelConfig(api, state, { visionEnabled: toggle.checked });
      },
      { description: `quick config vision toggle for ${container.id}` }
    );

    visionDiv.append(toggle, toggleLabel);
    container.appendChild(visionDiv);
  }

  // Build and return the final public module object (the factory's product).
  const moduleBuild = (function buildModule() {
    const api = setupDependencies();
    const state = buildState(api);

    const modelApi = {
      getConfig: () => getConfig(state),
      updateConfig: (cfg, opts = {}) => updateModelConfig(api, state, cfg, opts),
      getModelOptions,
      onConfigChange: (cb) => onConfigChange(api, cb),
      initializeUI: () => initializeUI(api, state),
      renderQuickConfig: (container) => renderQuickConfig(api, state, container),
      cleanup: () => cleanup(api),
      initWithReadiness: async () => {
        // We rely entirely on the DI-provided domReadinessService for readiness gating.
        await api.ds.modules.get("domReadinessService").dependenciesAndElements(["app", "domAPI"]);
        initializeUI(api, state);
      },
      // Provide a handle for advanced usage if another module wants to manually track or dispatch
      // events. This ensures no direct global usage of addEventListener.
      getEventBus: () => busTarget,
    };

    return modelApi;
  })();

  return moduleBuild;
}

/**
 * modelConfig.js
 * ----------------
 * Manages model selection, token limits, and optional reasoning/vision toggles.
 */

// Tracked event listeners for proper cleanup
const trackedListeners = new Set();

/**
 * Track a listener for cleanup
 * @param {Element} element - Element to attach listener to
 * @param {string} type - Event type
 * @param {Function} handler - Event handler
 * @param {Object} [options] - Event listener options
 */
function trackListener(element, type, handler, options = {}) {
  if (!element) return;

  element.addEventListener(type, handler, options);
  trackedListeners.add({ element, type, handler, options });
}

/**
 * Clean up all tracked event listeners
 */
function cleanupListeners() {
  trackedListeners.forEach(({ element, type, handler, options }) => {
    element.removeEventListener(type, handler, options);
  });
  trackedListeners.clear();
}

/**
 * Central state object for model configuration
 */
const modelConfigState = {
  modelName: "claude-3-sonnet-20240229",
  provider: "anthropic",
  maxTokens: 4096,
  // Azure-specific state
  azureParams: {
    maxCompletionTokens: 5000,
    reasoningEffort: 'medium',
    visionDetail: 'auto',
  },
  reasoningEffort: "medium",
  visionEnabled: false,
  visionDetail: "auto",
  visionImage: null,
  extendedThinking: false,
  thinkingBudget: 16000,
  customInstructions: "",

  // Load state from localStorage
  loadFromStorage() {
    this.modelName = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
    this.provider = localStorage.getItem("provider") || "anthropic";
    this.maxTokens = parseInt(localStorage.getItem("maxTokens") || "4096", 10);
    this.loadAzureSettings();
    this.reasoningEffort = localStorage.getItem("reasoningEffort") || "medium";
    this.visionEnabled = localStorage.getItem("visionEnabled") === "true";
    this.visionDetail = localStorage.getItem("visionDetail") || "auto";
    this.extendedThinking = localStorage.getItem("extendedThinking") === "true";
    this.thinkingBudget = parseInt(localStorage.getItem("thinkingBudget") || "16000", 10);
    this.customInstructions = localStorage.getItem("globalCustomInstructions") || "";

    // Ensure values are within valid ranges
    this.maxTokens = Math.max(100, Math.min(100000, this.maxTokens));
    this.thinkingBudget = Math.max(2048, Math.min(32000, this.thinkingBudget));

   return this;
  },

  // Save state to localStorage
  saveToStorage() {
    localStorage.setItem("modelName", this.modelName);
    localStorage.setItem("provider", this.provider);
    this.saveAzureSettings();
    localStorage.setItem("reasoningEffort", this.reasoningEffort);
    localStorage.setItem("visionEnabled", this.visionEnabled);
    localStorage.setItem("visionDetail", this.visionDetail);
    localStorage.setItem("extendedThinking", this.extendedThinking);
    localStorage.setItem("thinkingBudget", this.thinkingBudget);

    // Don't overwrite custom instructions if they haven't changed
    if (this.customInstructions) {
      localStorage.setItem("globalCustomInstructions", this.customInstructions);
    }

    return this;
  },
  loadAzureSettings() {
    try {
      const azureSettings = JSON.parse(localStorage.getItem("azureSettings") || "{}");
      this.azureParams.maxCompletionTokens = azureSettings.maxCompletionTokens || 5000;
      this.azureParams.reasoningEffort = azureSettings.reasoningEffort || 'medium';
      this.azureParams.visionDetail = azureSettings.visionDetail || 'auto';
    } catch (e) {
      console.warn("Failed to load azure settings", e);
    }
  },
  saveAzureSettings() {
    try {
      const azureSettings = {
        maxCompletionTokens: this.azureParams.maxCompletionTokens,
        reasoningEffort: this.azureParams.reasoningEffort,
        visionDetail: this.azureParams.visionDetail
      };

      localStorage.setItem("azureSettings", JSON.stringify(azureSettings));
    } catch (e) {
      console.warn("Failed to save azure settings", e);
    }

  },

  // Update the global MODEL_CONFIG object
  updateGlobalConfig() {
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    Object.assign(window.MODEL_CONFIG, {
      modelName: this.modelName,
      maxTokens: this.maxTokens,
      reasoningEffort: this.reasoningEffort,
      visionEnabled: this.visionEnabled,
      visionDetail: this.visionDetail,
      visionImage: this.visionImage,
      extendedThinking: this.extendedThinking,
      thinkingBudget: this.thinkingBudget,
      customInstructions: this.customInstructions
    });

    return this;
  },

  // Notify other components of changes
  notifyChanges() {
    document.dispatchEvent(new CustomEvent('modelConfigChanged', {
      detail: {
        modelName: this.modelName,
        maxTokens: this.maxTokens,
        reasoningEffort: this.reasoningEffort,
        visionEnabled: this.visionEnabled,
        visionDetail: this.visionDetail,
        extendedThinking: this.extendedThinking,
        thinkingBudget: this.thinkingBudget,
        customInstructions: this.customInstructions,
        timestamp: Date.now()
      }
    }));

    return this;
  }

};

/**
 * Initialize model configuration module
 */
function initModelConfig() {
  try {
    console.log("Initializing model config module");

    // Clean up any existing listeners
    cleanupListeners();

    // Load saved values
    modelConfigState.loadFromStorage().updateGlobalConfig();

    // Initialize UI elements
    setupModelDropdown();
    setupMaxTokensUI();
    setupReasoningUI();
    setupVisionUI();
    setupExtendedThinkingUI();

    // Update the display with current values
    updateModelConfigDisplay();

    console.log("Model config module initialized with:", window.MODEL_CONFIG);

    // Dispatch event to notify other components
    document.dispatchEvent(new CustomEvent('modelConfigInitialized', {
      detail: window.MODEL_CONFIG
    }));

    return true;
  } catch (error) {
    console.error("Model config initialization failed:", error);
    return false;
  }
}

/**
 * Set up the model selection dropdown
 */
function setupModelDropdown() {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) return;

  // Get available models
  const models = getModelOptions();

  // Clear existing options
  modelSelect.innerHTML = '';

  // Add models to dropdown
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    if (model.description) option.title = model.description;
    modelSelect.appendChild(option);
  });

  // Set the current model
  modelSelect.value = modelConfigState.modelName;

  // Add change handler
  trackListener(modelSelect, "change", () => {
    modelConfigState.modelName = modelSelect.value;

    // Check if model supports vision
    const isVisionModel = modelSelect.value === "o1";
    const visionPanel = document.getElementById('visionPanel');
    if (visionPanel) {
      visionPanel.classList.toggle("hidden", !isVisionModel);
    }

    // Update related UI elements
    const extendedThinkingPanel = document.getElementById("extendedThinkingPanel");
    if (extendedThinkingPanel) {
      const supportsExtendedThinking = models.find(m => m.id === modelSelect.value)?.supportsExtendedThinking;
      extendedThinkingPanel.classList.toggle("hidden", !supportsExtendedThinking);
    }

    // Save and notify changes
    persistSettings();
  }
}

/**
 * Set up max tokens UI elements
 */
function setupMaxTokensUI() {
  const maxTokensContainer = document.getElementById("maxTokensContainer");
  if (!maxTokensContainer) return;

  // Create UI elements
  const maxTokensGroup = document.createElement("div");
  maxTokensGroup.className = "flex flex-col gap-2";

  // Slider
  const maxTokensSlider = document.createElement("input");
  maxTokensSlider.type = "range";
  maxTokensSlider.id = "maxTokensSlider";
  maxTokensSlider.min = "100";
  maxTokensSlider.max = "100000";
  maxTokensSlider.value = modelConfigState.maxTokens;
  maxTokensSlider.step = "100";
  maxTokensSlider.className = "mt-2 flex-1";

  // Number Input
  const maxTokensInput = document.createElement("input");
  maxTokensInput.type = "number";
  maxTokensInput.id = "maxTokensInput";
  maxTokensInput.min = "100";
  maxTokensInput.max = "100000";
  maxTokensInput.value = modelConfigState.maxTokens;
  maxTokensInput.className = "w-24 px-2 py-1 border rounded";

  // Add elements to container
  maxTokensContainer.innerHTML = '';
  maxTokensGroup.appendChild(maxTokensSlider);
  maxTokensGroup.appendChild(maxTokensInput);
  maxTokensContainer.appendChild(maxTokensGroup);

  // Add hidden input for form submission
  const maxTokensHidden = document.createElement("input");
  maxTokensHidden.type = "hidden";
  maxTokensHidden.id = "maxTokensHidden";
  maxTokensHidden.value = maxTokensSlider.value;
  maxTokensContainer.appendChild(maxTokensHidden);

  // Add event handlers
  const syncMaxTokens = (value) => {
    const clamped = Math.max(100, Math.min(100000, value));
    maxTokensSlider.value = clamped;
    maxTokensInput.value = clamped;
    maxTokensHidden.value = clamped;
    modelConfigState.maxTokens = clamped;
    persistSettings();
  };

  trackListener(maxTokensSlider, "input", () => {
    syncMaxTokens(maxTokensSlider.value);
  });

  trackListener(maxTokensInput, "change", () => {
    syncMaxTokens(maxTokensInput.value);
  });
}

/**
 * Set up reasoning effort UI
 */
function setupReasoningUI() {
  const reasoningPanel = document.getElementById("reasoningPanel");
  if (!reasoningPanel) return;

  // Clear existing content
  reasoningPanel.innerHTML = '';

  // Create label
  const label = document.createElement("label");
  label.textContent = "Reasoning Effort:";
  label.className = "block text-sm font-medium dark:text-gray-200";
  reasoningPanel.appendChild(label);

  // Create slider
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "reasoningEffortRange";
  slider.min = "1";
  slider.max = "3";
  slider.value = modelConfigState.reasoningEffort === "low" ? "1" :
    modelConfigState.reasoningEffort === "medium" ? "2" : "3";
  slider.step = "1";
  slider.className = "mt-2 w-full";
  reasoningPanel.appendChild(slider);

  // Create output display
  const sliderOutput = document.createElement("span");
  sliderOutput.className = "ml-2";
  reasoningPanel.appendChild(sliderOutput);

  // Update display function
  const updateSliderOutput = (value) => {
    if (value === "1") {
      sliderOutput.textContent = "Low";
      modelConfigState.reasoningEffort = "low";
    } else if (value === "2") {
      sliderOutput.textContent = "Medium";
      modelConfigState.reasoningEffort = "medium";
    } else {
      sliderOutput.textContent = "High";
      modelConfigState.reasoningEffort = "high";
    }
  };

  // Set initial state
  updateSliderOutput(slider.value);

  // Add change handler
  trackListener(slider, "input", () => {
    updateSliderOutput(slider.value);
    persistSettings();
  });
}

/**
 * Set up vision UI elements
 */
function setupVisionUI() {
  const visionPanel = document.getElementById('visionPanel');
  if (!visionPanel) return;

  // Add vision detail selector if it doesn't exist
  if (!document.getElementById('visionDetail')) {
    const visionDetailLabel = document.createElement('div');
    visionDetailLabel.className = 'mt-2';
    visionDetailLabel.innerHTML = '<label class="block text-sm font-medium dark:text-gray-200">Image Detail:</label>';
    visionPanel.appendChild(visionDetailLabel);

    const visionDetailSelect = document.createElement('select');
    visionDetailSelect.id = 'visionDetail';
    visionDetailSelect.className = 'w-full px-2 py-1 mt-1 border rounded dark:bg-gray-700 dark:border-gray-600';
    visionDetailSelect.innerHTML = `
      <option value="auto">Auto</option>
      <option value="low">Low Detail</option>
      <option value="high">High Detail</option>
    `;
    visionDetailSelect.value = modelConfigState.visionDetail;
    visionDetailLabel.appendChild(visionDetailSelect);

    // Add change handler
    trackListener(visionDetailSelect, 'change', () => {
      modelConfigState.visionDetail = visionDetailSelect.value;
      persistSettings();
    });
  }

  // Set up file input handler
  setupVisionFileInput();

  // Set initial visibility
  visionPanel.classList.toggle('hidden', modelConfigState.modelName !== 'o1');
}

/**
 * Set up extended thinking UI
 */
function setupExtendedThinkingUI() {
  const extendedThinkingPanel = document.getElementById("extendedThinkingPanel");
  if (!extendedThinkingPanel) return;

  // Set initial visibility based on model
  const supportsExtendedThinking =
    modelConfigState.modelName === "claude-3-7-sonnet-20250219" ||
    modelConfigState.modelName === "claude-3-opus-20240229";

  extendedThinkingPanel.classList.toggle("hidden", !supportsExtendedThinking);

  // Get UI elements
  const extendedThinkingToggle = document.getElementById("extendedThinking");
  const thinkingBudgetSelect = document.getElementById("thinkingBudget");

  // Set initial values
  if (extendedThinkingToggle) {
    extendedThinkingToggle.checked = modelConfigState.extendedThinking;
    trackListener(extendedThinkingToggle, "change", () => {
      modelConfigState.extendedThinking = extendedThinkingToggle.checked;
      persistSettings();
    });
  }

  if (thinkingBudgetSelect) {
    thinkingBudgetSelect.value = modelConfigState.thinkingBudget;
    trackListener(thinkingBudgetSelect, "change", () => {
      modelConfigState.thinkingBudget = parseInt(thinkingBudgetSelect.value, 10);
      persistSettings();
    });
  }
}

/**
 * Setup vision file input handler
 */
function setupVisionFileInput() {
  const visionInputEl = document.getElementById('visionFileInput');
  if (!visionInputEl) return;

  const statusEl = document.getElementById('visionStatus');
  const previewEl = document.getElementById('visionPreview');

  // Clear existing listeners
  visionInputEl.removeEventListener('change', visionInputEl._changeHandler);

  // Convert file to base64
  async function convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  }

  // Handle file selection
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate model
    if (modelConfigState.modelName !== 'o1') {
      if (statusEl) statusEl.textContent = 'Vision only works with o1 model';
      e.target.value = '';
      return;
    }

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      if (statusEl) statusEl.textContent = 'Only JPEG/PNG allowed';
      e.target.value = '';
      return;
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      if (statusEl) statusEl.textContent = 'File must be <5MB';
      e.target.value = '';
      return;
    }

    // Show preview
    if (previewEl) {
      previewEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.className = 'max-h-32 object-contain mt-2 rounded';
      previewEl.appendChild(img);
    }

    // Process image
    if (statusEl) statusEl.textContent = 'Processing...';

    try {
      const base64 = await convertToBase64(file);
      modelConfigState.visionImage = base64;
      window.MODEL_CONFIG.visionImage = base64;

      if (statusEl) statusEl.textContent = 'Ready for analysis';
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error processing image';
      console.error('Error processing vision image:', err);
    }
  };

  // Store handler reference for cleanup
  visionInputEl._changeHandler = handleFileChange;
  trackListener(visionInputEl, 'change', handleFileChange);
}

/**
 * Update the model configuration display
 */
function updateModelConfigDisplay() {
  // Get display elements
  const currentModelNameEl = document.getElementById("currentModelName");
  const currentMaxTokensEl = document.getElementById("currentMaxTokens");
  const currentReasoningEl = document.getElementById("currentReasoning");
  const visionEnabledStatusEl = document.getElementById("visionEnabledStatus");

  // Update display values if elements exist
  if (currentModelNameEl) {
    currentModelNameEl.textContent = modelConfigState.modelName;
  }

  if (currentMaxTokensEl) {
    currentMaxTokensEl.textContent = `${modelConfigState.maxTokens} tokens`;
  }

  if (currentReasoningEl) {
    currentReasoningEl.textContent = modelConfigState.reasoningEffort;
  }

  if (visionEnabledStatusEl) {
    visionEnabledStatusEl.textContent = modelConfigState.visionEnabled ? "Enabled" : "Disabled";
  }
}

/**
 * Get available models for the dropdown
 * @returns {Array} List of available models
 */
function getCurrentModelConfig() {
  const models = getModelOptions();
  return models.find(m => m.id === modelConfigState.modelName) || models[0];
}

function getModelOptions() {
  return [
    // Claude models (existing, unchanged)
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      description: 'Most powerful Claude model for complex tasks',
      provider: 'anthropic',
      supportsExtendedThinking: true,
      maxTokens: 200000
    },
    {
      id: 'claude-3-sonnet-20240229',
      name: 'Claude 3 Sonnet',
      description: 'Balanced model - good mix of capability and speed',
      maxTokens: 200000
    },
    {
      id: 'claude-3-haiku-20240307',
      name: 'Claude 3 Haiku',
      description: 'Fastest Claude model - great for simple tasks',
      maxTokens: 200000
    },
    {
      id: 'claude-3-7-sonnet-20250219',
      name: 'Claude 3.7 Sonnet',
      description: 'Latest Claude model with enhanced capabilities (128K context, vision support)',
      supportsExtendedThinking: true,
      supportsVision: true,
      maxTokens: 128000,
      defaultThinkingBudget: 16000,
      minThinkingBudget: 1024,
      requiresStreaming: 21333,
      betaHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19',
        'anthropic-version': '2023-06-01',
        'anthropic-features': 'extended-thinking-2025-02-19,long-context-2025-02-19'
      },
      requiredHeaders: {
        'anthropic-version': '2023-06-01'
      }
    },

    // Azure OpenAI models - Phase 1 core definitions
    {
      id: 'o3-mini',
      name: 'Azure o3-mini',
      provider: 'azure',
      description: 'Advanced reasoning for code/science/math',
      parameters: {
        type: 'reasoning',
        max_completion_tokens: 100000,
        reasoning_effort: ['low', 'medium', 'high'],
        markdown_mode: false
      },
      contextWindow: 200000,
      visionSupported: false,
      requires: ['max_completion_tokens', 'reasoning_effort']
    },
    {
      id: 'o1',
      name: 'Azure o1',
      provider: 'azure',
      description: 'Multimodal reasoning with vision',
      parameters: {
        type: 'multimodal-reasoning',
        max_completion_tokens: 100000,
        reasoning_effort: ['low', 'medium', 'high'],
        vision_detail: ['auto', 'low', 'high']
      },
      contextWindow: 200000,
      visionSupported: true,
      requires: ['max_completion_tokens', 'vision_detail']
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'azure',
      description: 'Advanced multimodal model with vision',
      parameters: {
        type: 'vision',
        max_tokens: 4096,
        vision_detail: ['auto', 'low', 'high']
      },
      contextWindow: 128000,
      visionSupported: true,
      requires: ['max_tokens', 'vision_detail']
    },

    // Legacy OpenAI models (existing, unchanged)
    {
      id: 'gpt-4',
      name: 'GPT-4',
      description: 'Highly capable GPT model',
      maxTokens: 8192
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      description: 'Fast GPT model for simpler queries',
      maxTokens: 4096
    }
  ];
}

/**
 * Save all settings to storage and update global state
 */
function persistSettings() {
  try {
    // Save to local storage
    modelConfigState.saveToStorage();

    // Update global model config
    modelConfigState.updateGlobalConfig();

    // Update display
    updateModelConfigDisplay();

    // Notify other components
    modelConfigState.notifyChanges();

    // Update loading indicator if present
    const loadingEl = document.getElementById('modelConfigLoading');
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      setTimeout(() => loadingEl.classList.add('hidden'), 500);
    }
  } catch (error) {
    console.error('Error persisting model settings:', error);
  }
}

// Export functions
window.initModelConfig = initModelConfig;
window.initializeModelDropdown = function () {
  setupModelDropdown();
  return true;
};
window.persistSettings = persistSettings;

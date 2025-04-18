/**
 * modelConfig.js
 * ----------------
 * Manages model selection, token limits, and optional reasoning/vision toggles.
 */

// Import auth.js
const auth = window.auth;

// Use centralized event handling instead of duplicate implementation
function trackListener(element, type, handler, options = {}) {
  if (!window.eventHandlers?.trackListener) {
    console.warn("[modelConfig] EventHandlers not available; skipping trackListener");
    return;
  }
  window.eventHandlers.trackListener(element, type, handler, options);
}

// Remove local cleanupListeners in favor of global eventHandlers version
// If needed, we can call window.eventHandlers.cleanupListeners() externally.

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
    try {
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
    } catch (e) {
      console.warn("Failed to load model config from storage:", e);
    }

    // Ensure values are within valid ranges
    this.maxTokens = Math.max(100, Math.min(100000, this.maxTokens));
    this.thinkingBudget = Math.max(2048, Math.min(32000, this.thinkingBudget));

    return this;
  },

  // Save state to localStorage
  async saveToStorage() {
    try {
      // Verify authentication before saving
      const isAuthenticated = await auth.verifyAuthState();
      if (!isAuthenticated) {
        console.warn("Not authenticated - using session storage only");
        sessionStorage.setItem("modelName", this.modelName);
        sessionStorage.setItem("provider", this.provider);
        this.saveAzureSettings();
        return this;
      }

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
    } catch (e) {
      console.error("Failed to save model config:", e);
      throw e;
    }
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
async function initModelConfig() {
  try {
    console.log("Initializing model config module");

    // Clean up any existing listeners
    cleanupListeners();

    // Load saved values regardless of authentication
    modelConfigState.loadFromStorage().updateGlobalConfig();

    // Wait for auth to initialize if needed
    if (!window.auth?.isInitialized) {
      await new Promise(resolve => {
        const checkAuth = () => {
          if (window.auth?.isInitialized) {
            document.removeEventListener('authStateChanged', checkAuth);
            resolve(true);
          }
        };
        document.addEventListener('authStateChanged', checkAuth);

        // Timeout fallback
        setTimeout(() => {
          document.removeEventListener('authStateChanged', checkAuth);
          resolve(false);
        }, 5000);
      });
    }

    // Initialize UI elements
    await setupModelDropdown();
    await setupMaxTokensUI();
    await setupReasoningUI();
    await setupVisionUI();
    await setupExtendedThinkingUI();

    // Update the display with current values
    await updateModelConfigDisplay();

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
 * Get the current model configuration object
 * @returns {Object} The matching model object from getModelOptions()
 */
async function getCurrentModelConfig() {
  // Allow config access without authentication
  const models = getModelOptions();
  return models.find(m => m.id === modelConfigState.modelName) || models[0];
}

/**
 * Return a list of all available model configurations
 * (Duplicates removed and providers set explicitly)
 */
function getModelOptions() {
  return [
    // Claude models
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      description: 'Most powerful Claude model for complex tasks',
      provider: 'anthropic',
      supportsExtendedThinking: true,
      maxTokens: 200000,
      supportsVision: false,
      parameters: {
        reasoning_effort: ['low', 'medium', 'high'],
        vision_detail: []
      }
    },
    {
      id: 'claude-3-7-sonnet-20250219',
      name: 'Claude 3.7 Sonnet',
      description: 'Upgraded version with advanced features from Anthropic',
      provider: 'anthropic',
      supportsExtendedThinking: true,
      maxTokens: 200000,
      supportsVision: false,
      parameters: {
        reasoning_effort: ['low', 'medium', 'high'],
        vision_detail: []
      }
    },
    {
      id: 'o1',
      name: 'OpenAI GPT-4 with Vision support (Hypothetical Test-Mock)',
      description: 'GPT-4 with advanced vision capabilities',
      provider: 'openai',
      supportsExtendedThinking: false,
      maxTokens: 32000,
      supportsVision: true,
      parameters: {
        reasoning_effort: ['low', 'medium', 'high'],
        vision_detail: ['auto', 'low', 'high']
      }
    }
  ];
}

/**
 * Set up the model selection dropdown
 */
async function setupModelDropdown() {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.log("User not authenticated - showing auth prompt");
    modelSelect.innerHTML = '<option value="">Please sign in to select model</option>';
    modelSelect.disabled = true;

    // Listen for auth changes to re-enable
    const authListener = () => {
      if (auth.isAuthenticated) {
        document.removeEventListener('authStateChanged', authListener);
        setupModelDropdown(); // Retry now that we're authenticated
      }
    };
    document.addEventListener('authStateChanged', authListener);
    return;
  }

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
    const selectedModel = models.find(m => m.id === modelSelect.value);
    const visionPanel = document.getElementById('visionPanel');
    if (visionPanel) {
      visionPanel.classList.toggle("hidden", !selectedModel?.supportsVision);
    }

    // Update related UI elements (extended thinking, etc.)
    const extendedThinkingPanel = document.getElementById("extendedThinkingPanel");
    if (extendedThinkingPanel) {
      const supportsExtendedThinking = selectedModel?.supportsExtendedThinking;
      extendedThinkingPanel.classList.toggle("hidden", !supportsExtendedThinking);
    }

    // Save and notify changes
    persistSettings();
  });
}

/**
 * Set up max tokens UI elements
 */
async function setupMaxTokensUI() {
  const maxTokensContainer = document.getElementById("maxTokensContainer");
  if (!maxTokensContainer) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    maxTokensContainer.classList.add("hidden");
    return;
  }

  // Create UI elements
  const maxTokensGroup = document.createElement('div');
  maxTokensGroup.className = "flex flex-col gap-2";

  // Slider
  const maxTokensSlider = document.createElement('input');
  maxTokensSlider.type = "range";
  maxTokensSlider.id = "maxTokensSlider";
  maxTokensSlider.min = "100";
  maxTokensSlider.max = "100000";
  maxTokensSlider.value = modelConfigState.maxTokens;
  maxTokensSlider.step = "100";
  maxTokensSlider.className = "mt-2 flex-1";

  // Number Input
  const maxTokensInput = document.createElement('input');
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
  const maxTokensHidden = document.createElement('input');
  maxTokensHidden.type = "hidden";
  maxTokensHidden.id = "maxTokensHidden";
  maxTokensHidden.value = maxTokensSlider.value;
  maxTokensContainer.appendChild(maxTokensHidden);

  // Sync function
  const syncMaxTokens = (value) => {
    const clamped = Math.max(100, Math.min(100000, value));
    maxTokensSlider.value = clamped;
    maxTokensInput.value = clamped;
    maxTokensHidden.value = clamped;
    modelConfigState.maxTokens = clamped;
    persistSettings();
  };

  // Event handlers
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
async function setupReasoningUI() {
  const model = getCurrentModelConfig();
  const reasoningPanel = document.getElementById('reasoningPanel');
  if (!reasoningPanel) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    reasoningPanel.classList.add("hidden");
    return;
  }

  // For models that allow adjustable 'reasoning_effort' in their parameters
  const supportsReasoning = model.parameters?.reasoning_effort?.length > 0;
  reasoningPanel.classList.toggle('hidden', !supportsReasoning);

  if (supportsReasoning) {
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
    slider.step = "1";
    slider.className = "mt-2 w-full";

    // Convert current state to a numeric scale
    let currentNumeric = 2; // default "medium"
    if (modelConfigState.reasoningEffort === "low") currentNumeric = 1;
    if (modelConfigState.reasoningEffort === "high") currentNumeric = 3;
    slider.value = currentNumeric.toString();
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

    // Listen for slider input
    trackListener(slider, "input", () => {
      updateSliderOutput(slider.value);
      persistSettings();
    });
  }
}

/**
 * Set up vision UI elements
 */
async function setupVisionUI() {
  const model = getCurrentModelConfig();
  const visionPanel = document.getElementById('visionPanel');
  if (!visionPanel) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    visionPanel.classList.add("hidden");
    return;
  }

  // Reset UI elements
  visionPanel.innerHTML = '';

  if (model.supportsVision) {
    // Add vision detail selector
    const detailLabel = document.createElement('label');
    detailLabel.className = 'block text-sm font-medium dark:text-gray-200';
    detailLabel.textContent = 'Image Detail:';
    visionPanel.appendChild(detailLabel);

    const detailSelector = document.createElement('select');
    detailSelector.className = 'w-full px-2 py-1 mt-1 border rounded dark:bg-gray-700 dark:border-gray-600';

    // Add available detail levels
    const detailLevels = model.parameters?.vision_detail || ['auto', 'low', 'high'];
    detailLevels.forEach(level => {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level.charAt(0).toUpperCase() + level.slice(1);
      detailSelector.appendChild(option);
    });

    // Set the default from state
    detailSelector.value = modelConfigState.visionDetail;
    trackListener(detailSelector, 'change', () => {
      modelConfigState.visionDetail = detailSelector.value;
      persistSettings();
    });

    visionPanel.appendChild(detailSelector);
  }

  // Set up file input
  setupVisionFileInput();
}

/**
 * Set up extended thinking UI
 */
async function setupExtendedThinkingUI() {
  const extendedThinkingPanel = document.getElementById("extendedThinkingPanel");
  if (!extendedThinkingPanel) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    extendedThinkingPanel.classList.add("hidden");
    return;
  }

  // Show or hide extendedThinkingPanel based on model
  const supportsExtendedThinking =
    modelConfigState.modelName === "claude-3-7-sonnet-20250219" ||
    modelConfigState.modelName === "claude-3-opus-20240229";

  extendedThinkingPanel.classList.toggle("hidden", !supportsExtendedThinking);

  // Get UI elements
  const extendedThinkingToggle = document.getElementById("extendedThinkingToggle");
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
async function setupVisionFileInput() {
  const visionInputEl = document.getElementById('visionFileInput');
  if (!visionInputEl) return;

  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    visionInputEl.disabled = true;
    return;
  }

  const statusEl = document.getElementById('visionStatus');
  const previewEl = document.getElementById('visionPreview');

  // Clear any existing onChange
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

    // Verify authentication
    const isAuthenticated = await auth.verifyAuthState();
    if (!isAuthenticated) {
      console.error("User not authenticated");
      e.target.value = '';
      return;
    }

    // Validate model
    if (!["o1", "gpt-4o", "claude-3-7-sonnet-20250219", "claude-3-opus-20240229"].includes(modelConfigState.modelName)) {
      if (statusEl) statusEl.textContent = 'Vision only works with supported vision models';
      e.target.value = '';
      return;
    }

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      if (statusEl) statusEl.textContent = 'Only JPEG/PNG allowed';
      e.target.value = '';
      return;
    }

    // Validate file size (max 5MB)
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

  visionInputEl._changeHandler = handleFileChange;
  trackListener(visionInputEl, 'change', handleFileChange);
}

/**
 * Update the model configuration display
 */
async function updateModelConfigDisplay() {
  // Verify authentication
  const isAuthenticated = await auth.verifyAuthState();
  if (!isAuthenticated) {
    console.error("User not authenticated");
    return;
  }

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
 * Save all settings to storage and update global state
 */
async function persistSettings() {
  try {
    // Verify authentication
    const isAuthenticated = await auth.verifyAuthState();
    if (!isAuthenticated) {
      console.error("User not authenticated");
      return;
    }

    // Save to local storage
    modelConfigState.saveToStorage();

    // Update global model config
    modelConfigState.updateGlobalConfig();

    // Update display
    updateModelConfigDisplay();

    // Notify other components
    modelConfigState.notifyChanges();

    // Loading indicator (if present)
    const loadingEl = document.getElementById('modelConfigLoading');
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      setTimeout(() => loadingEl.classList.add('hidden'), 500);
    }
  } catch (error) {
    console.error('Error persisting model settings:', error);
  }
}

// Exported functions
window.initModelConfig = initModelConfig;
window.initializeModelDropdown = function () {
  setupModelDropdown();
  return true;
};
window.persistSettings = persistSettings;

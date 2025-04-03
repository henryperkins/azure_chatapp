/**
 * model-config.js
 * ----------------
 * Manages model selection, token limits, and optional reasoning/vision toggles.
 * Production-ready: no placeholders. Adjust HTML element IDs to match your UI.
 */

// Remove any existing isDevelopment declaration to prevent conflicts
if (typeof isDevelopment !== 'undefined') {
  delete window.isDevelopment;
}

/**
 * Initialize model configuration module
 */
function initModelConfig() {
  try {
    console.log("Initializing model config module");
    
    // DOM references
    const modelSelect = document.getElementById("modelSelect");

    // Replace dropdown with slider for max tokens
    // Max Tokens Input Group
    const maxTokensGroup = document.createElement("div");
    maxTokensGroup.className = "flex flex-col gap-2"; // Changed to vertical layout for sidebar
    
    // Slider
    const maxTokensSlider = document.createElement("input");
    maxTokensSlider.type = "range";
    maxTokensSlider.id = "maxTokensSlider";
    maxTokensSlider.min = "100";
    maxTokensSlider.max = "100000";
    maxTokensSlider.value = "500";
    maxTokensSlider.step = "100";
    maxTokensSlider.className = "mt-2 flex-1";

    // Number Input
    const maxTokensInput = document.createElement("input");
    maxTokensInput.type = "number";
    maxTokensInput.id = "maxTokensInput";
    maxTokensInput.min = "100";
    maxTokensInput.max = "100000";
    maxTokensInput.value = "500";
    maxTokensInput.className = "w-24 px-2 py-1 border rounded";

    // Sync slider and input
    const syncMaxTokens = (value) => {
      const clamped = Math.max(100, Math.min(100000, value));
      maxTokensSlider.value = clamped;
      maxTokensInput.value = clamped;
      persistSettings();
    };

    // Sync function with better error handling
    maxTokensSlider.addEventListener("input", () => {
      try {
        syncMaxTokens(maxTokensSlider.value);
      } catch (e) {
        console.error("Error syncing max tokens from slider:", e);
      }
    });

    maxTokensInput.addEventListener("change", () => {
      try {
        syncMaxTokens(maxTokensInput.value);
      } catch (e) {
        console.error("Error syncing max tokens from input:", e);
      }
    });

    const maxTokensContainer = document.getElementById("maxTokensContainer");
    if (maxTokensContainer) {
      try {
        maxTokensContainer.innerHTML = '';
        maxTokensGroup.appendChild(maxTokensSlider);
        maxTokensGroup.appendChild(maxTokensInput);
        maxTokensContainer.appendChild(maxTokensGroup);
        
        // Keep hidden input for form submission
        const maxTokensHidden = document.createElement("input");
        maxTokensHidden.type = "hidden";
        maxTokensHidden.id = "maxTokensHidden";
        maxTokensHidden.value = maxTokensSlider.value;
        maxTokensContainer.appendChild(maxTokensHidden);
      } catch (e) {
        console.error("Error setting up max tokens UI:", e);
      }
    }
    
    const visionToggle = document.getElementById("visionToggle");
    
    
    // Safely handle the possibility that the 'reasoningPanel' doesn't exist
    const reasoningPanel = document.getElementById("reasoningPanel");
    if (reasoningPanel) {
      // Create a slider in place of the select
      const label = document.createElement("label");
      label.textContent = "Reasoning Effort:";
      label.className = "block text-sm font-medium dark:text-gray-200";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.id = "reasoningEffortRange";
      slider.min = "1";
      slider.max = "3";
      slider.value = "1";
      slider.step = "1";
      slider.className = "mt-2 w-full";

      const sliderOutput = document.createElement("span");
      sliderOutput.className = "ml-2";

      const updateSliderOutput = (value) => {
        if (value === "1") {
          sliderOutput.textContent = "Low";
        } else if (value === "2") {
          sliderOutput.textContent = "Medium";
        } else {
          sliderOutput.textContent = "High";
        }
      };

      updateSliderOutput(slider.value);

      slider.addEventListener("input", () => {
        updateSliderOutput(slider.value);
        persistSettings();
      });

      reasoningPanel.appendChild(label);
      reasoningPanel.appendChild(slider);
      reasoningPanel.appendChild(sliderOutput);
    }

    const visionDetailSelect = document.createElement('select');
    visionDetailSelect.id = 'visionDetail';
    visionDetailSelect.innerHTML = `
      <option value="auto">Auto</option>
      <option value="low">Low Detail</option>
      <option value="high">High Detail</option>
    `;

    const visionPanel = document.getElementById('visionPanel');
    if (visionPanel) {
      visionPanel.appendChild(
        Object.assign(document.createElement('div'), {
          className: 'mt-2',
          innerHTML: '<label class="block text-sm font-medium dark:text-gray-200">Image Detail:</label>'
        })
      ).appendChild(visionDetailSelect);
    }

    visionDetailSelect.addEventListener('change', () => {
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.visionDetail = visionDetailSelect.value;
    });

    // Load existing settings from localStorage (or defaults)
    const storedModel = localStorage.getItem("modelName") || "claude-3-sonnet-20240229"; // Set Claude as default
    const storedMaxTokens = localStorage.getItem("maxTokens") || "500";
    const storedReasoning = localStorage.getItem("reasoningEffort") || "";
    const storedVision = localStorage.getItem("visionEnabled") === "true";
    const storedExtendedThinking = localStorage.getItem("extendedThinking") === "true";
    const storedThinkingBudget = localStorage.getItem("thinkingBudget") || "16000";
    
    // Initialize UI with stored values
    if (modelSelect) modelSelect.value = storedModel;
    
    // Initialize max tokens UI elements
    if (maxTokensInput) {
      maxTokensInput.value = storedMaxTokens;
      maxTokensInput.type = "number";
      maxTokensInput.min = "100";
      maxTokensInput.max = "100000";
    }
    
    if (maxTokensSlider) {
      maxTokensSlider.value = storedMaxTokens;
    }
    
    // Set hidden input value
    const maxTokensHidden = document.getElementById("maxTokensHidden");
    if (maxTokensHidden) {
      maxTokensHidden.value = storedMaxTokens;
    }
    // Set the reasoningEffortSelect if there's a saved value
    if (storedReasoning) {
      const reasoningEffortSelectEl = document.getElementById("reasoningEffortSelect");
      if (reasoningEffortSelectEl) {
        reasoningEffortSelectEl.value = storedReasoning;
      }
    }
    
    // Vision toggle remains the same
    if (visionToggle) visionToggle.checked = storedVision;
    
    // Set extended thinking toggle and budget
    const extendedThinkingToggle = document.getElementById("extendedThinking");
    const thinkingBudgetSelect = document.getElementById("thinkingBudget");
    
    if (extendedThinkingToggle) extendedThinkingToggle.checked = storedExtendedThinking;
    if (thinkingBudgetSelect) thinkingBudgetSelect.value = storedThinkingBudget;
    
    // Show/hide the extended thinking panel based on model selection
    const extendedThinkingPanel = document.getElementById("extendedThinkingPanel");
    if (extendedThinkingPanel) {
      const isCompatibleModel = storedModel === "claude-3-7-sonnet-20250219" || 
                            storedModel === "claude-3-opus-20240229";
      extendedThinkingPanel.classList.toggle("hidden", !isCompatibleModel);
    }

    // Event listeners for changes
    if (modelSelect) {
      modelSelect.addEventListener("change", () => {
        persistSettings();
        const isVisionModel = modelSelect.value === "o1";
        // Update vision panel visibility based on selected model
        const visionPanel = document.getElementById('visionPanel');
        if (visionPanel) {
          visionPanel.classList.toggle("hidden", !isVisionModel);
        }
      });
    }
    if (maxTokensInput) {
      maxTokensInput.addEventListener("change", persistSettings);
    }
    if (visionToggle) {
      visionToggle.addEventListener("change", persistSettings);
    }

    // Initialize window.MODEL_CONFIG with stored values
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.modelName = storedModel;
    window.MODEL_CONFIG.maxTokens = parseInt(storedMaxTokens, 10) || 500;
    window.MODEL_CONFIG.visionEnabled = storedVision;
    window.MODEL_CONFIG.extendedThinking = storedExtendedThinking;
    window.MODEL_CONFIG.thinkingBudget = parseInt(storedThinkingBudget, 10) || 16000;
    window.MODEL_CONFIG.reasoningEffort = storedReasoning || "medium";
    
    // Ensure settings are consistent and dispatch initialization event
    persistSettings();

    // Setup vision file input handler
    setupVisionFileInput();

    console.log("Model config module initialized with:", window.MODEL_CONFIG);
    
    // Dispatch event to notify other components
    document.dispatchEvent(new CustomEvent('modelConfigInitialized', {
      detail: window.MODEL_CONFIG
    }));
  } catch (error) {
    console.error("Model config initialization failed:", error);
    throw error;
  }
}

/**
 * Get available models for the dropdown
 */
function getModelOptions() {
  return [
    { 
      id: 'claude-3-opus-20240229', 
      name: 'Claude 3 Opus',
      description: 'Most powerful Claude model for complex tasks'
    },
    { 
      id: 'claude-3-sonnet-20240229', 
      name: 'Claude 3 Sonnet',
      description: 'Balanced model - good mix of capability and speed'
    },
    { 
      id: 'claude-3-haiku-20240307', 
      name: 'Claude 3 Haiku',
      description: 'Fastest Claude model - great for simple tasks'
    },
    { 
      id: 'claude-3-7-sonnet-20250219', 
      name: 'Claude 3.7 Sonnet',
      description: 'Latest Claude model with enhanced capabilities (128K context)',
      supportsExtendedThinking: true,
      maxTokens: 128000,
      defaultThinkingBudget: 16000,
      minThinkingBudget: 2048
    },
    { 
      id: 'gpt-4', 
      name: 'GPT-4',
      description: 'Highly capable GPT model'
    },
    { 
      id: 'gpt-3.5-turbo', 
      name: 'GPT-3.5 Turbo',
      description: 'Fast GPT model for simpler queries'
    },
    { 
      id: 'o1', 
      name: 'o1 (Vision)',
      description: 'Azure OpenAI model with image understanding'
    }
  ];
}

/**
 * Initialize the model selection dropdown
 */
function initializeModelDropdown() {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) return;

  // Clear existing options
  modelSelect.innerHTML = '';

  // Get available models
  const modelOptions = getModelOptions();
  
  // Add models to dropdown
  modelOptions.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    if (model.description) option.title = model.description;
    modelSelect.appendChild(option);
  });
}

/**
 * Setup vision file input handler
 */
function setupVisionFileInput() {
  async function convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  }

  const visionInputEl = document.getElementById('visionFileInput');
  if (visionInputEl) {
    visionInputEl.addEventListener('change', async (e) => {
      const statusEl = document.getElementById('visionStatus');
      const file = e.target.files[0];
      if (!file) return;

      // Validate model
      if (window.MODEL_CONFIG?.modelName !== 'o1') {
        statusEl.textContent = 'Vision only works with o1 model';
        e.target.value = '';
        return;
      }

      // Validate file type
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        statusEl.textContent = 'Only JPEG/PNG allowed';
        e.target.value = '';
        return;
      }

      // Validate file size
      if (file.size > 5 * 1024 * 1024) {
        statusEl.textContent = 'File must be <5MB';
        e.target.value = '';
        return;
      }

      // Show preview image
      const preview = document.getElementById('visionPreview');
      if (preview) {
        preview.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.className = 'max-h-32 object-contain mt-2 rounded';
        preview.appendChild(img);
      }

      statusEl.textContent = 'Processing...';
      try {
        const base64 = await convertToBase64(file);
        window.MODEL_CONFIG.visionImage = base64;
        statusEl.textContent = 'Ready for analysis';
      } catch (err) {
        statusEl.textContent = 'Error processing image';
        console.error(err);
      }
    });
  }
}

/**
 * Save changes to localStorage and (optionally) to a global object
 */
function persistSettings() {
  // Model
  const modelSelect = document.getElementById("modelSelect");
  if (modelSelect) {
    localStorage.setItem("modelName", modelSelect.value);
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.modelName = modelSelect.value;
  }

  // Max tokens - Try multiple sources for the token value
  let maxTokensValue;
  
  // First try the slider
  const maxTokensSlider = document.getElementById("maxTokensSlider");
  if (maxTokensSlider) {
    maxTokensValue = Number(maxTokensSlider.value);
  }
  
  // Then try the input field
  if (!maxTokensValue) {
    const maxTokensInput = document.getElementById("maxTokensInput");
    if (maxTokensInput) {
      maxTokensValue = Number(maxTokensInput.value);
    }
  }
  
  // Finally try the hidden field
  if (!maxTokensValue) {
    const maxTokensHidden = document.getElementById("maxTokensHidden");
    if (maxTokensHidden) {
      maxTokensValue = Number(maxTokensHidden.value);
    }
  }
  
  // Use a sensible default if all else fails
  if (!maxTokensValue || isNaN(maxTokensValue)) {
    maxTokensValue = 500;
  }
  
  // Clamp to a reasonable range
  const clampedVal = Math.min(Math.max(maxTokensValue, 100), 100000);
  
  // Update all token-related elements
  localStorage.setItem("maxTokens", clampedVal.toString());
  window.MODEL_CONFIG = window.MODEL_CONFIG || {};
  window.MODEL_CONFIG.maxTokens = clampedVal;
   
  // Reasoning effort
  const reasoningEffortRange = document.getElementById("reasoningEffortRange");
  if (reasoningEffortRange) {
    let effort = '';
    if (reasoningEffortRange.value === '1') effort = 'low';
    else if (reasoningEffortRange.value === '2') effort = 'medium';
    else effort = 'high';

    localStorage.setItem("reasoningEffort", effort);
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.reasoningEffort = effort;
  }

  // Vision toggle
  const visionToggle = document.getElementById("visionToggle");
  if (visionToggle) {
    localStorage.setItem("visionEnabled", String(visionToggle.checked));
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.visionEnabled = visionToggle.checked;
  }
  
  // Extended thinking toggle
  const extendedThinkingToggle = document.getElementById("extendedThinking");
  if (extendedThinkingToggle) {
    localStorage.setItem("extendedThinking", String(extendedThinkingToggle.checked));
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.extendedThinking = extendedThinkingToggle.checked;
  }
  
  // Thinking budget
  const thinkingBudgetSelect = document.getElementById("thinkingBudget");
  if (thinkingBudgetSelect) {
    localStorage.setItem("thinkingBudget", thinkingBudgetSelect.value);
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.thinkingBudget = Number(thinkingBudgetSelect.value);
  }

  // Load custom instructions if available
  const globalCustomInstructions = localStorage.getItem("globalCustomInstructions");
  if (globalCustomInstructions) {
    window.MODEL_CONFIG.customInstructions = globalCustomInstructions;
  }

  // If there's a selected project, check for project instructions
  const selectedProjectId = localStorage.getItem("selectedProjectId");
  if (selectedProjectId) {
    const projectInstructions = localStorage.getItem(`project_${selectedProjectId}_instructions`);
    if (projectInstructions) {
      window.MODEL_CONFIG.projectInstructions = projectInstructions;
    }
  }

  updateModelConfigDisplay();
  
  // Include all relevant model config in the event detail
  const modelConfigData = {
    modelName: localStorage.getItem('modelName'),
    maxTokens: localStorage.getItem('maxTokens'),
    visionEnabled: localStorage.getItem('visionEnabled'),
    visionDetail: localStorage.getItem('visionDetail'),
    extendedThinking: localStorage.getItem('extendedThinking'),
    thinkingBudget: localStorage.getItem('thinkingBudget'),
    reasoningEffort: localStorage.getItem('reasoningEffort'),
    customInstructions: localStorage.getItem('globalCustomInstructions'),
    timestamp: Date.now() // Add timestamp to ensure listeners detect the change
  };
  
  // Dispatch config change event
  const event = new CustomEvent('modelConfigChanged', {
    detail: modelConfigData
  });
  document.dispatchEvent(event);
  
  console.log("Model config persisted and event dispatched:", modelConfigData);
}

/**
 * Update the model configuration display
 */
function updateModelConfigDisplay() {
  try {
    // Ensure MODEL_CONFIG exists
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    
    // Get display elements
    const currentModelNameEl = document.getElementById("currentModelName");
    const currentMaxTokensEl = document.getElementById("currentMaxTokens");
    const currentReasoningEl = document.getElementById("currentReasoning");
    const visionEnabledStatusEl = document.getElementById("visionEnabledStatus");
    
    // Model - with failsafe fallbacks
    if (currentModelNameEl) {
      const modelName = window.MODEL_CONFIG.modelName ||
                       localStorage.getItem("modelName") ||
                       "claude-3-sonnet-20240229";
      currentModelNameEl.textContent = modelName;
    }

    // Max Tokens - with failsafe fallbacks
    if (currentMaxTokensEl) {
      const maxTokens = window.MODEL_CONFIG.maxTokens ||
                       localStorage.getItem("maxTokens") ||
                       "500";
      currentMaxTokensEl.textContent = `${maxTokens} tokens`;
    }

    // Reasoning - with failsafe fallbacks
    if (currentReasoningEl) {
      const reasoningEffort = window.MODEL_CONFIG.reasoningEffort ||
                             localStorage.getItem("reasoningEffort") ||
                             "medium";
      currentReasoningEl.textContent = reasoningEffort;
    }

    // Vision - with failsafe fallbacks
    if (visionEnabledStatusEl) {
      const visionEnabled = window.MODEL_CONFIG.visionEnabled ||
                            localStorage.getItem("visionEnabled") === "true";
      visionEnabledStatusEl.textContent = visionEnabled ? "Enabled" : "Disabled";
    }
    
    // Also update any UI elements that should reflect these values
    const modelSelect = document.getElementById("modelSelect");
    if (modelSelect && window.MODEL_CONFIG.modelName) {
      try {
        modelSelect.value = window.MODEL_CONFIG.modelName;
      } catch (e) {
        console.warn("Could not update model select UI:", e);
      }
    }
    
    // Update UI token elements if present
    try {
      const maxTokensSlider = document.getElementById("maxTokensSlider");
      const maxTokensInput = document.getElementById("maxTokensInput");
      const maxTokensHidden = document.getElementById("maxTokensHidden");
      
      if (window.MODEL_CONFIG.maxTokens) {
        if (maxTokensSlider) maxTokensSlider.value = window.MODEL_CONFIG.maxTokens;
        if (maxTokensInput) maxTokensInput.value = window.MODEL_CONFIG.maxTokens;
        if (maxTokensHidden) maxTokensHidden.value = window.MODEL_CONFIG.maxTokens;
      }
    } catch (e) {
      console.warn("Could not update token UI elements:", e);
    }
  } catch (error) {
    console.error("Error updating model config display:", error);
  }
}

// Export functions
window.initModelConfig = initModelConfig;
window.initializeModelDropdown = initializeModelDropdown;

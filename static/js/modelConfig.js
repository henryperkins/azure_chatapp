/**
 * model-config.js
 * ----------------
 * Manages model selection, token limits, and optional reasoning/vision toggles.
 * Production-ready: no placeholders. Adjust HTML element IDs to match your UI.
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM references
  const modelSelect = document.getElementById("modelSelect");
  const maxTokensSelect = document.getElementById("maxTokensSelect");
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

    function updateSliderOutput(value) {
      if (value === "1") {
        sliderOutput.textContent = "Low";
      } else if (value === "2") {
        sliderOutput.textContent = "Medium";
      } else {
        sliderOutput.textContent = "High";
      }
    }

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

  document.getElementById('visionPanel').appendChild(
    Object.assign(document.createElement('div'), {
      className: 'mt-2',
      innerHTML: `<label class="block text-sm font-medium dark:text-gray-200">Image Detail:</label>`
    })
  ).appendChild(visionDetailSelect);

  visionDetailSelect.addEventListener('change', () => {
    window.MODEL_CONFIG = window.MODEL_CONFIG || {};
    window.MODEL_CONFIG.visionDetail = visionDetailSelect.value;
  });

  // Load existing settings from localStorage (or defaults)
  const storedModel = localStorage.getItem("modelName") || "o3-mini";
  const storedMaxTokens = localStorage.getItem("maxTokens") || "500";
  const storedReasoning = localStorage.getItem("reasoningEffort") || "";
  const storedVision = localStorage.getItem("visionEnabled") === "true";
  
  // Initialize UI
  if (modelSelect) modelSelect.value = storedModel;
  if (maxTokensSelect) maxTokensSelect.value = storedMaxTokens;
  
  // Set the reasoningEffortSelect if there's a saved value
  if (storedReasoning) {
    const reasoningEffortSelectEl = document.getElementById("reasoningEffortSelect");
    if (reasoningEffortSelectEl) {
      reasoningEffortSelectEl.value = storedReasoning;
    }
  }
  
  // Vision toggle remains the same
  if (visionToggle) visionToggle.checked = storedVision;

  // Save changes to localStorage and (optionally) to a global object
  function persistSettings() {
    // Model
    if (modelSelect) {
      localStorage.setItem("modelName", modelSelect.value);
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.modelName = modelSelect.value;
    }
    // Max tokens
    if (maxTokensSelect) {
      localStorage.setItem("maxTokens", maxTokensSelect.value);
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.maxTokens = Number(maxTokensSelect.value);
    }
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
    if (visionToggle) {
      localStorage.setItem("visionEnabled", String(visionToggle.checked));
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.visionEnabled = visionToggle.checked;
    }
    updateModelConfigDisplay();
    updateModelConfigDisplay();
  }
  
  function updateModelConfigDisplay() {
    const currentModelNameEl = document.getElementById("currentModelName");
    const currentMaxTokensEl = document.getElementById("currentMaxTokens");
    const currentReasoningEl = document.getElementById("currentReasoning");
    const visionEnabledStatusEl = document.getElementById("visionEnabledStatus");
  
    // Model
    if (currentModelNameEl) {
      currentModelNameEl.textContent = window.MODEL_CONFIG?.modelName || "N/A";
    }
  
    // Max Tokens
    if (currentMaxTokensEl) {
      currentMaxTokensEl.textContent = window.MODEL_CONFIG?.maxTokens?.toString() || "N/A";
    }
  
    // Reasoning
    if (currentReasoningEl) {
      currentReasoningEl.textContent = window.MODEL_CONFIG?.reasoningEffort || "N/A";
    }
  
    // Vision
    if (visionEnabledStatusEl) {
      visionEnabledStatusEl.textContent = window.MODEL_CONFIG?.visionEnabled ? "Enabled" : "Disabled";
    }
  }

  // Event listeners for changes
  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      persistSettings();
      const isVisionModel = modelSelect.value === "o1";
      const reasoningEffortSelectEl = document.getElementById("reasoningEffortSelect");
      document.getElementById("visionPanel").classList.toggle("hidden", !isVisionModel);
  
      // Enable/disable the reasoning dropdown only for certain models
      if (reasoningEffortSelectEl) {
        if (["o3-mini", "o1"].includes(modelSelect.value)) {
          reasoningEffortSelectEl.disabled = false;
        } else {
          reasoningEffortSelectEl.value = "";
          reasoningEffortSelectEl.disabled = true;
          persistSettings();
        }
      }
    });
  }
  if (maxTokensSelect) {
    maxTokensSelect.addEventListener("change", persistSettings);
  }
  // Removed references to reasoningToggle since it's no longer used (replaced by the new slider)
  if (visionToggle) {
    visionToggle.addEventListener("change", persistSettings);
  }

  // Ensure window.MODEL_CONFIG is in sync on load
  persistSettings();

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
});

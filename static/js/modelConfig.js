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
    const reasoningEffortSelect = document.createElement("select");
    reasoningEffortSelect.id = "reasoningEffortSelect";
    reasoningEffortSelect.className = "border border-gray-300 rounded p-1 ml-2";
    reasoningEffortSelect.innerHTML = `
      <option value="">(disabled)</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    `;
  
    const containerDiv = Object.assign(document.createElement("div"), {
      className: "mt-2",
      innerHTML: `<label class="block text-sm font-medium dark:text-gray-200">Reasoning Effort:</label>`
    });
  
    reasoningPanel.appendChild(containerDiv).appendChild(reasoningEffortSelect);
  
    // Listen for changes to reasoning effort
    reasoningEffortSelect.addEventListener("change", () => {
      persistSettings();
    });
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
    const reasoningEffortSelectEl = document.getElementById("reasoningEffortSelect");
    if (reasoningEffortSelectEl) {
      const effort = reasoningEffortSelectEl.value;
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
  if (reasoningToggle) {
    reasoningToggle.addEventListener("change", persistSettings);
  }
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

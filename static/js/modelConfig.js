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
  const reasoningToggle = document.getElementById("reasoningToggle");
  const visionToggle = document.getElementById("visionToggle");

  // Load existing settings from localStorage (or defaults)
  const storedModel = localStorage.getItem("modelName") || "o3-mini";
  const storedMaxTokens = localStorage.getItem("maxTokens") || "500";
  const storedReasoning = localStorage.getItem("reasoningEffort") || "";
  const storedVision = localStorage.getItem("visionEnabled") === "true";

  // Initialize UI
  if (modelSelect) modelSelect.value = storedModel;
  if (maxTokensSelect) maxTokensSelect.value = storedMaxTokens;
  if (reasoningToggle) reasoningToggle.checked = !!storedReasoning;
  if (visionToggle) visionToggle.checked = storedVision;

  // Save changes to localStorage and (optionally) to a global object
  function persistSettings() {
    if (modelSelect) {
      localStorage.setItem("modelName", modelSelect.value);
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.modelName = modelSelect.value;
    }
    if (maxTokensSelect) {
      localStorage.setItem("maxTokens", maxTokensSelect.value);
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.maxTokens = Number(maxTokensSelect.value);
    }
    if (reasoningToggle) {
      const effort = reasoningToggle.checked ? "medium" : "";
      localStorage.setItem("reasoningEffort", effort);
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.reasoningEffort = effort;
    }
    if (visionToggle) {
      localStorage.setItem("visionEnabled", String(visionToggle.checked));
      window.MODEL_CONFIG = window.MODEL_CONFIG || {};
      window.MODEL_CONFIG.visionEnabled = visionToggle.checked;
    }
  }

  // Event listeners for changes
  if (modelSelect) {
    modelSelect.addEventListener("change", persistSettings);
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
});

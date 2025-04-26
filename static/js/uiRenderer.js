/**
 * uiRenderer.js - Module for rendering UI elements like projects and conversations.
 * SPA Integration: Explicitly initialize with uiRenderer.initialize() from app.js.
 * All error handling uses window.app.showNotification. Auth checks use window.app.state.isAuthenticated.
 * No automatic global registration; call initialize() in your orchestrator.
 */

/**
 * Dependencies:
 * - window.sidebar (optional, for conversation starring)
 * - window.navigateToConversation (for SPA navigation)
 * - window.navigateToProject (for SPA navigation)
 * - window.chatConfig, window.modelConfig (config managers)
 * - window.eventHandlers (event management)
 * - window.app.state.isAuthenticated (auth check)
 * - window.app.showNotification (notifications/errors)
 * - document (browser DOM)
 */

function createConversationListItem(item) {
  const li = document.createElement('li');
  li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';
  const container = document.createElement('div');
  container.className = 'flex flex-col';
  const firstLine = document.createElement('div');
  firstLine.className = 'flex items-center justify-between';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'flex-1 truncate font-medium';
  titleSpan.textContent = item.title || 'Conversation ' + item.id;
  firstLine.appendChild(titleSpan);
  const isStarred = window.sidebar?.isConversationStarred?.(item.id);
  const starBtn = document.createElement('button');
  starBtn.className = `ml-2 ${isStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
  starBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
         fill="${isStarred ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915
            c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c
            .3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976
            2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914
            a1 1 0 00.951-.69l1.519-4.674z"/>
    </svg>`;
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.app.state.isAuthenticated) {
      window.app.showNotification('You must be logged in to star conversations.', 'warning');
      return;
    }
    if (window.sidebar?.toggleStarConversation) {
      const nowStarred = window.sidebar.toggleStarConversation(item.id);
      starBtn.className = `ml-2 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
      starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');
    } else {
      window.app.showNotification('Unable to access star conversation functionality.', 'error');
    }
  });
  firstLine.appendChild(starBtn);
  const secondLine = document.createElement('div');
  secondLine.className = 'flex items-center text-xs text-gray-500 mt-1';
  if (item.model_id) {
    const modelSpan = document.createElement('span');
    modelSpan.className = 'truncate';
    modelSpan.textContent = item.model_id;
    secondLine.appendChild(modelSpan);
  }
  if (item.project_id) {
    if (item.model_id) {
      const separator = document.createElement('span');
      separator.className = 'mx-1';
      separator.textContent = '•';
      secondLine.appendChild(separator);
    }
    const projectSpan = document.createElement('span');
    projectSpan.className = 'truncate';
    projectSpan.textContent = 'Project';
    secondLine.appendChild(projectSpan);
  }
  container.appendChild(firstLine);
  container.appendChild(secondLine);
  li.appendChild(container);
  li.addEventListener('click', () => {
    if (!window.app.state.isAuthenticated) {
      window.app.showNotification('Please sign in to access conversations.', 'warning');
      return;
    }
    if (window.navigateToConversation) window.navigateToConversation(item.id);
    else window.app.showNotification('Conversation navigation unavailable.', 'error');
  });
  return li;
}

function renderConversations(data) {
  try {
    const container = document.getElementById('sidebarConversations');
    if (!container) return;
    container.innerHTML = '';
    const seenIds = new Set();
    const conversations = (data?.data?.conversations || data?.conversations || [])
      .filter(conv => {
        if (!conv?.id || seenIds.has(conv.id)) return false;
        seenIds.add(conv.id);
        return true;
      });
    window.chatConfig = window.chatConfig || {};
    window.chatConfig.conversations = conversations;
    if (conversations.length === 0) {
      const element = document.createElement('li');
      element.className = 'text-gray-500 text-center py-4';
      element.textContent = 'No conversations yet';
      container.appendChild(element);
      return;
    }
    conversations.forEach(conv => {
      const item = createConversationListItem(conv);
      if (item) container.appendChild(item);
    });
  } catch (err) {
    window.app.showNotification('Error rendering conversations sidebar.', 'error');
    console.error(err);
  }
}

function renderProjects(projects) {
  try {
    const container = document.getElementById('sidebarProjects');
    if (!container) return;

    container.innerHTML = '';

    if (!projects || projects.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.className = 'text-center text-gray-500 py-4';
      emptyMsg.textContent = 'No projects yet';
      container.appendChild(emptyMsg);
      return;
    }

    projects.forEach(project => {
      const item = document.createElement('li');
      item.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';

      const title = document.createElement('div');
      title.className = 'font-medium truncate';
      title.textContent = project.name || `Project ${project.id}`;

      const desc = document.createElement('div');
      desc.className = 'text-xs text-gray-500 truncate mt-1';
      desc.textContent = project.description || 'No description';

      item.appendChild(title);
      item.appendChild(desc);

      item.addEventListener('click', () => {
        if (!window.app.state.isAuthenticated) {
          window.app.showNotification('Please sign in to access projects.', 'warning');
          return;
        }
        if (window.navigateToProject) window.navigateToProject(project.id);
        else window.app.showNotification('Project navigation unavailable.', 'error');
      });

      container.appendChild(item);
    });
  } catch (err) {
    window.app.showNotification('Error rendering projects sidebar.', 'error');
    console.error(err);
  }
}

// Model configuration UI components
async function setupModelDropdown() {
  try {
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect) return;

    // Use model options from window.modelConfig if available, else fallback to hardcoded list
    let models = [];
    if (window.modelConfig && typeof window.modelConfig.getModelOptions === "function") {
      models = window.modelConfig.getModelOptions();
    } else {
      models = [
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

    // Set current model
    const currentConfig = window.modelConfig?.getConfig() || {};
    modelSelect.value = currentConfig.modelName || 'claude-3-sonnet-20240229';

    // Add change handler
    if (window.eventHandlers && typeof window.eventHandlers.trackListener === "function") {
      window.eventHandlers.trackListener(modelSelect, "change", () => {
        window.modelConfig.updateConfig({
          modelName: modelSelect.value
        });
      }, { description: 'uiRenderer Model Dropdown Change' });
    } else {
      modelSelect.addEventListener("change", () => {
        window.modelConfig.updateConfig({
          modelName: modelSelect.value
        });
      });
    }
  } catch (err) {
    window.app.showNotification('Error setting up model dropdown.', 'error');
    console.error(err);
  }
}

function setupMaxTokensUI() {
  try {
    const maxTokensContainer = document.getElementById("maxTokensContainer");
    if (!maxTokensContainer) return;

    const currentConfig = window.modelConfig?.getConfig() || {};

    // Create slider
    const slider = document.createElement('input');
    slider.type = "range";
    slider.min = "100";
    slider.max = "100000";
    slider.value = currentConfig.maxTokens || 4096;
    slider.className = "w-full mt-2";

    // Create value display
    const valueDisplay = document.createElement('div');
    valueDisplay.className = "text-sm text-gray-600 dark:text-gray-400";
    valueDisplay.textContent = `${currentConfig.maxTokens || 4096} tokens`;

    // Update function
    const updateMaxTokens = (value) => {
      const tokens = Math.max(100, Math.min(100000, value));
      valueDisplay.textContent = `${tokens} tokens`;
      window.modelConfig.updateConfig({
        maxTokens: tokens
      });
    };

    // Event listeners
    if (window.eventHandlers && typeof window.eventHandlers.trackListener === "function") {
      window.eventHandlers.trackListener(slider, "input", (e) => {
        updateMaxTokens(e.target.value);
      }, { description: 'uiRenderer Max Tokens Slider' });
    } else {
      slider.addEventListener("input", (e) => {
        updateMaxTokens(e.target.value);
      });
    }

    // Add to container
    maxTokensContainer.innerHTML = '';
    maxTokensContainer.appendChild(slider);
    maxTokensContainer.appendChild(valueDisplay);
  } catch (err) {
    window.app.showNotification('Error setting up max tokens UI.', 'error');
    console.error(err);
  }
}

function setupVisionUI() {
  try {
    const visionPanel = document.getElementById('visionPanel');
    if (!visionPanel) return;

    const currentConfig = window.modelConfig?.getConfig() || {};
    const supportsVision = currentConfig.modelName === 'gpt-4o';

    visionPanel.classList.toggle('hidden', !supportsVision);
    if (supportsVision) {
      const toggle = document.createElement('input');
      toggle.type = "checkbox";
      toggle.id = "visionToggle";
      toggle.checked = currentConfig.visionEnabled || false;
      toggle.className = "mr-2";

      const label = document.createElement('label');
      label.htmlFor = "visionToggle";
      label.textContent = "Enable Vision";
      label.className = "text-sm";

      if (window.eventHandlers && typeof window.eventHandlers.trackListener === "function") {
        window.eventHandlers.trackListener(toggle, "change", () => {
          window.modelConfig.updateConfig({
            visionEnabled: toggle.checked
          });
        }, { description: 'uiRenderer Vision Checkbox' });
      } else {
        toggle.addEventListener("change", () => {
          window.modelConfig.updateConfig({
            visionEnabled: toggle.checked
          });
        });
      }

      visionPanel.innerHTML = '';
      visionPanel.appendChild(toggle);
      visionPanel.appendChild(label);
    }
  } catch (err) {
    window.app.showNotification('Error setting up vision UI.', 'error');
    console.error(err);
  }
}

// Exported renderer module
export const uiRenderer = {
  renderConversations,
  renderProjects,
  setupModelDropdown,
  setupMaxTokensUI,
  setupVisionUI,
  initialize() {
    // Attach this module to window for SPA use
    window.uiRenderer = uiRenderer;
  }
};

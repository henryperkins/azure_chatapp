/**
 * uiRenderer.js - Module for rendering UI elements like projects and conversations.
 * Separated from app.js to reduce file size and improve modularity.
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
    if (window.sidebar?.toggleStarConversation) {
      const nowStarred = window.sidebar.toggleStarConversation(item.id);
      starBtn.className = `ml-2 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
      starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');
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
    if (window.navigateToConversation) window.navigateToConversation(item.id);
  });
  return li;
}

function renderConversations(data) {
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
}

// Export to window for app.js integration
window.uiRenderer = {
  renderConversations,
  renderProjects,

  // Model configuration UI components
  setupModelDropdown: async function() {
    const modelSelect = document.getElementById("modelSelect");
    if (!modelSelect) return;

    const models = [
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
    window.eventHandlers.trackListener(modelSelect, "change", () => {
      window.modelConfig.updateConfig({
        modelName: modelSelect.value
      });
    });
  },

  setupMaxTokensUI: function() {
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
    window.eventHandlers.trackListener(slider, "input", (e) => {
      updateMaxTokens(e.target.value);
    });

    // Add to container
    maxTokensContainer.innerHTML = '';
    maxTokensContainer.appendChild(slider);
    maxTokensContainer.appendChild(valueDisplay);
  },

  setupVisionUI: function() {
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

      window.eventHandlers.trackListener(toggle, "change", () => {
        window.modelConfig.updateConfig({
          visionEnabled: toggle.checked
        });
      });

      visionPanel.innerHTML = '';
      visionPanel.appendChild(toggle);
      visionPanel.appendChild(label);
    }
  }
};

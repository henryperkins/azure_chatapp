/**
 * Enhanced projectListComponent.js
 * -----------------------
 * Component for displaying and managing the project list view
 * With added customization features for project cards
 */

(function () {
  /**
   * Project List Component - Handles the project list view
   */
  class ProjectListComponent {
    /**
     * Initialize the project list component with customization options
     * @param {Object} options - Configuration options
     */
    constructor(options) {
      if (!options || !options.elementId) {
        console.error('ProjectListComponent: Missing required options');
        throw new Error('ProjectListComponent requires elementId option');
      }

      console.log('[DEBUG] Initializing ProjectListComponent');

      /* ===========================
         STATE MANAGEMENT
         =========================== */
      this.state = {
        projects: [],
        filter: 'all',
        loading: false,
        cardCustomization: this._loadCardCustomization() // Load saved customization
      };

      /* ===========================
         OPTIONS & ELEMENT REFERENCES
         =========================== */
      this.elementId = options.elementId;
      this.element = document.getElementById(this.elementId);
      this.onViewProject = options.onViewProject;
      this.messageEl = document.getElementById("noProjectsMessage");

      // Create fallback container if needed
      if (!this.element) {
        console.error(`ProjectListComponent: Element with ID '${this.elementId}' not found - creating fallback`);
        this.element = document.createElement('div');
        this.element.id = this.elementId;
        this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 h-full overflow-y-auto';
        const listView = document.getElementById('projectListView');
        if (listView) {
          listView.appendChild(this.element);
        }
      }

      // Define available themes
      this.availableThemes = [
        { id: 'default', name: 'Default' },
        { id: 'primary', name: 'Primary (Blue)' },
        { id: 'success', name: 'Success (Green)' },
        { id: 'warning', name: 'Warning (Yellow)' },
        { id: 'danger', name: 'Danger (Red)' },
        { id: 'info', name: 'Info (Cyan)' },
        { id: 'neutral', name: 'Neutral (Gray)' }
      ];

      // Define available badge styles
      this.badgeStyles = [
        { id: 'default', name: 'Default (Gray)' },
        { id: 'blue', name: 'Blue' },
        { id: 'green', name: 'Green' },
        { id: 'yellow', name: 'Yellow' },
        { id: 'red', name: 'Red' },
        { id: 'purple', name: 'Purple' }
      ];

      this._bindFilterEvents();
      this._bindCreateProjectButton();
      this._initializeCustomizationUI();
    }

    /* ===========================
       PUBLIC METHODS
       =========================== */

    /**
     * Show the project list view
     */
    show() {
      const listView = document.getElementById('projectListView');
      const detailsView = document.getElementById('projectDetailsView');

      if (listView) {
        listView.classList.remove('hidden');
        listView.classList.add('flex-1', 'min-h-0');
      }
      if (detailsView) detailsView.classList.add('hidden');
      if (this.element) this.element.style.display = 'grid';
    }

    /**
     * Hide the project list view
     */
    hide() {
      const element = document.getElementById("projectListView");
      if (element) {
        window.uiUtilsInstance.toggleVisibility(element, false);
      } else {
        console.error('projectListView element not found');
      }
    }

    /**
     * Render the list of projects
     * @param {Array|Object} eventOrProjects - Projects array or event containing projects
     */
    renderProjects(eventOrProjects) {
      try {
        // New: Ensure container visibility
        const container = document.getElementById("projectListView");
        if (container) container.classList.remove("hidden");

        const projects = this._extractProjects(eventOrProjects);
        this.state.projects = projects;

        // New: Cancel if element missing
        if (!this.element) {
          console.error('ProjectListComponent: Missing container element');
          return;
        }

        // New: Reset scroll position
        if (projects.length > 0) {
          requestAnimationFrame(() => {
            if (this.element) this.element.scrollTop = 0;
          });
        }

        // Enhanced filter handling
        const currentFilter = this.state.filter || 'all';
        const filteredProjects = projects.filter(p => 
          currentFilter === 'all' ? true :
          currentFilter === 'pinned' ? p.pinned :
          currentFilter === 'archived' ? p.archived : true
        );

        // New: Debounced render
        clearTimeout(this._renderDebounce);
        this._renderDebounce = setTimeout(() => {
          this._performDOMUpdate(filteredProjects, currentFilter);
        }, 50); // Short debounce for rapid auth state changes

      } catch (err) {
        console.error('Error in renderProjects:', err);
        this._renderErrorState("Error displaying projects");
      }
    }

    // New helper method
    _performDOMUpdate(filteredProjects, currentFilter) {
      // Safe element reference
      const element = this.element;
      if (!element) return;

      // Cache DOM nodes
      const noProjectsMsg = document.getElementById("noProjectsMessage");
      
      // Clear existing content
      element.innerHTML = "";

      // Handle empty state
      if (filteredProjects.length === 0) {
        const message = filteredProjects === this.state.projects ? 
          currentFilter === 'all' ?
            'No projects available' :
            `No ${currentFilter} projects found` :
          'Loading projects...';

        if (noProjectsMsg) {
          noProjectsMsg.textContent = message;
          noProjectsMsg.classList.remove("hidden");
        }
        return;
      }

      // Create DOM fragments
      const fragment = document.createDocumentFragment();
      filteredProjects.forEach(project => {
        const card = this._createProjectCard(project);
        if (card) fragment.appendChild(card);
      });

      // Atomic DOM update
      element.appendChild(fragment);
      if (noProjectsMsg) noProjectsMsg.classList.add("hidden");
      
      // New: Force layout recalc if needed
      if (filteredProjects.length > 4) {
        element.offsetHeight; // Trigger reflow
      }
    }

    // Add this to the class
    _renderDebounce = null;

    /**
     * Apply a theme to all project cards
     * @param {string} themeId - The theme identifier to apply
     */
    applyGlobalTheme(themeId) {
      if (!this.availableThemes.some(theme => theme.id === themeId)) {
        console.error(`Unknown theme: ${themeId}`);
        return;
      }

      // Update state
      this.state.cardCustomization.theme = themeId;
      this._saveCardCustomization();

      // Re-render all cards
      this.renderProjects(this.state.projects);
    }

    /**
     * Add a custom badge to a project
     * @param {string} projectId - The project ID
     * @param {Object} badge - Badge configuration {text, style, icon}
     */
    addProjectBadge(projectId, badge) {
      if (!badge.text) {
        console.error('Badge text is required');
        return;
      }

      // Find project and update badges
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      if (!project.badges) project.badges = [];
      project.badges.push({
        text: badge.text,
        style: badge.style || 'default',
        icon: badge.icon || null
      });

      // Update the specific card
      const projectCard = this.element.querySelector(`[data-project-id="${projectId}"]`);
      if (projectCard) {
        const badgesContainer = projectCard.querySelector('.project-card-badges');
        if (badgesContainer) {
          const newBadge = this._createBadgeElement(badge);
          badgesContainer.appendChild(newBadge);
        }
      }
    }

    /* ===========================
       PRIVATE METHODS
       =========================== */

    /**
     * Initialize UI for card customization
     * @private
     */
    _initializeCustomizationUI() {
      // Create customization button in list header if not present
      const listHeader = document.querySelector('#projectListView .mb-4');
      if (!listHeader) return;

      // Check if the button already exists
      if (!document.getElementById('customizeCardsBtn')) {
        const customizeBtn = window.uiUtilsInstance.createElement("button", {
          id: "customizeCardsBtn",
          className: "ml-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-1 rounded text-sm flex items-center",
          innerHTML: `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 001.066-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Customize Cards
          `,
          onclick: () => this._showCustomizationModal()
        });

        // Find the correct place to insert the button
        const actionContainer = listHeader.querySelector('div:last-child');
        if (actionContainer) {
          actionContainer.insertBefore(customizeBtn, actionContainer.firstChild);
        } else {
          listHeader.appendChild(customizeBtn);
        }
      }

      // Create the customization modal if not present
      if (!document.getElementById('cardCustomizationModal')) {
        this._createCustomizationModal();
      }
    }

    /**
     * Create the customization modal
     * @private
     */
    _createCustomizationModal() {
      const modal = document.createElement('div');
      modal.id = 'cardCustomizationModal';
      modal.className = 'hidden fixed inset-0 bg-black bg-opacity-50 z-modal flex items-center justify-center';
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('role', 'dialog');

      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">Customize Project Cards</h3>
            <button id="closeCustomizationBtn" class="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Card Theme
            </label>
            <select id="cardThemeSelect" class="w-full px-3 py-2 border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
              ${this.availableThemes.map(theme =>
        `<option value="${theme.id}" ${this.state.cardCustomization.theme === theme.id ? 'selected' : ''}>${theme.name}</option>`
      ).join('')}
            </select>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Card Content Display Priority
            </label>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="flex items-center text-sm">
                  <input type="checkbox" class="mr-2" id="showDescriptionCheckbox" ${this.state.cardCustomization.showDescription ? 'checked' : ''}>
                  Description
                </label>
              </div>
              <div>
                <label class="flex items-center text-sm">
                  <input type="checkbox" class="mr-2" id="showTokensCheckbox" ${this.state.cardCustomization.showTokens ? 'checked' : ''}>
                  Token Usage
                </label>
              </div>
              <div>
                <label class="flex items-center text-sm">
                  <input type="checkbox" class="mr-2" id="showDateCheckbox" ${this.state.cardCustomization.showDate ? 'checked' : ''}>
                  Creation Date
                </label>
              </div>
              <div>
                <label class="flex items-center text-sm">
                  <input type="checkbox" class="mr-2" id="showBadgesCheckbox" ${this.state.cardCustomization.showBadges ? 'checked' : ''}>
                  Show Badges
                </label>
              </div>
            </div>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Badge Style
            </label>
            <select id="defaultBadgeStyleSelect" class="w-full px-3 py-2 border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
              ${this.badgeStyles.map(style =>
        `<option value="${style.id}" ${this.state.cardCustomization.defaultBadgeStyle === style.id ? 'selected' : ''}>${style.name}</option>`
      ).join('')}
            </select>
          </div>
          
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Custom Badge
            </label>
            <div class="flex mb-2">
              <input type="text" id="badgeTextInput" placeholder="Badge text" 
                     class="flex-1 px-3 py-2 border border-gray-300 rounded-l shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
              <select id="badgeStyleSelect" class="px-3 py-2 border-t border-b border-r border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500">
                ${this.badgeStyles.map(style =>
        `<option value="${style.id}">${style.name}</option>`
      ).join('')}
              </select>
            </div>
            <div class="flex mb-2">
              <input type="text" id="badgeEmojiInput" placeholder="Optional emoji (e.g., 🚀, 🔥)" 
                     class="w-24 px-3 py-2 border border-gray-300 rounded shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500">
              <div class="flex-1"></div>
              <button id="addBadgeBtn" class="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 ml-2">
                Add Badge
              </button>
            </div>
            <p class="text-xs text-gray-500 italic">
              ℹ️ Badges will be added to all projects. You can add project-specific badges from each card.
            </p>
          </div>
          
          <div class="flex justify-end space-x-2 mt-6">
            <button id="resetCustomizationBtn" 
                    class="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">
              Reset to Default
            </button>
            <button id="applyCustomizationBtn" 
                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Apply Changes
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Bind events
      document.getElementById('closeCustomizationBtn').addEventListener('click', () => this._hideCustomizationModal());
      document.getElementById('applyCustomizationBtn').addEventListener('click', () => this._applyCardCustomization());
      document.getElementById('resetCustomizationBtn').addEventListener('click', () => this._resetCardCustomization());
      document.getElementById('addBadgeBtn').addEventListener('click', () => this._addGlobalBadge());
    }

    /**
     * Show the customization modal
     * @private
     */
    _showCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (!modal) return;

      // Update form with current settings
      document.getElementById('cardThemeSelect').value = this.state.cardCustomization.theme;
      document.getElementById('showDescriptionCheckbox').checked = this.state.cardCustomization.showDescription;
      document.getElementById('showTokensCheckbox').checked = this.state.cardCustomization.showTokens;
      document.getElementById('showDateCheckbox').checked = this.state.cardCustomization.showDate;
      document.getElementById('showBadgesCheckbox').checked = this.state.cardCustomization.showBadges;
      document.getElementById('defaultBadgeStyleSelect').value = this.state.cardCustomization.defaultBadgeStyle;

      // Use ModalManager if available
      if (window.modalManager && typeof window.modalManager.show === 'function') {
        window.modalManager.show('cardCustomization');
      } else {
        modal.classList.remove('hidden');
      }
    }

    /**
     * Hide the customization modal
     * @private
     */
    _hideCustomizationModal() {
      // Use ModalManager if available
      if (window.modalManager && typeof window.modalManager.hide === 'function') {
        window.modalManager.hide('cardCustomization');
      } else {
        const modal = document.getElementById('cardCustomizationModal');
        if (modal) modal.classList.add('hidden');
      }
    }

    /**
     * Apply the card customization settings from the modal
     * @private
     */
    _applyCardCustomization() {
      // Get values from form
      const theme = document.getElementById('cardThemeSelect').value;
      const showDescription = document.getElementById('showDescriptionCheckbox').checked;
      const showTokens = document.getElementById('showTokensCheckbox').checked;
      const showDate = document.getElementById('showDateCheckbox').checked;
      const showBadges = document.getElementById('showBadgesCheckbox').checked;
      const defaultBadgeStyle = document.getElementById('defaultBadgeStyleSelect').value;

      // Update state
      this.state.cardCustomization = {
        theme,
        showDescription,
        showTokens,
        showDate,
        showBadges,
        defaultBadgeStyle,
        globalBadges: this.state.cardCustomization.globalBadges || []
      };

      // Save settings and re-render
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);

      // Hide modal
      this._hideCustomizationModal();

      // Show notification
      if (window.showNotification) {
        window.showNotification('Card customization applied successfully', 'success');
      }
    }

    /**
     * Reset card customization to default settings
     * @private
     */
    _resetCardCustomization() {
      this.state.cardCustomization = this._getDefaultCardCustomization();
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
      this._hideCustomizationModal();

      if (window.showNotification) {
        window.showNotification('Card customization reset to defaults', 'info');
      }
    }

    /**
     * Add a global badge to all projects
     * @private
     */
    _addGlobalBadge() {
      const text = document.getElementById('badgeTextInput').value.trim();
      if (!text) {
        if (window.showNotification) {
          window.showNotification('Badge text is required', 'error');
        }
        return;
      }

      const style = document.getElementById('badgeStyleSelect').value;
      const emoji = document.getElementById('badgeEmojiInput').value.trim();

      // Create the badge object
      const badge = {
        text,
        style,
        icon: emoji || null
      };

      // Add to global badges
      if (!this.state.cardCustomization.globalBadges) {
        this.state.cardCustomization.globalBadges = [];
      }
      this.state.cardCustomization.globalBadges.push(badge);

      // Save and rerender
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);

      // Clear inputs
      document.getElementById('badgeTextInput').value = '';
      document.getElementById('badgeEmojiInput').value = '';

      if (window.showNotification) {
        window.showNotification(`Badge "${text}" added to all projects`, 'success');
      }
    }

    /**
     * Create a badge element
     * @private
     * @param {Object} badge - Badge configuration
     * @returns {HTMLElement} Badge element
     */
    _createBadgeElement(badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = `project-card-badge project-card-badge-${badge.style || this.state.cardCustomization.defaultBadgeStyle}`;

      if (badge.icon) {
        badgeEl.textContent = `${badge.icon} ${badge.text}`;
      } else {
        badgeEl.textContent = badge.text;
      }

      return badgeEl;
    }

    /**
     * Load saved card customization from localStorage
     * @private
     * @returns {Object} Card customization settings
     */
    _loadCardCustomization() {
      try {
        const savedCustomization = localStorage.getItem('projectCardsCustomization');
        return savedCustomization ? JSON.parse(savedCustomization) : this._getDefaultCardCustomization();
      } catch (err) {
        console.error('Error loading card customization:', err);
        return this._getDefaultCardCustomization();
      }
    }

    /**
     * Save card customization to localStorage
     * @private
     */
    _saveCardCustomization() {
      try {
        localStorage.setItem('projectCardsCustomization', JSON.stringify(this.state.cardCustomization));
      } catch (err) {
        console.error('Error saving card customization:', err);
      }
    }

    /**
     * Get default card customization settings
     * @private
     * @returns {Object} Default settings
     */
    _getDefaultCardCustomization() {
      return {
        theme: 'default',
        showDescription: true,
        showTokens: true,
        showDate: true,
        showBadges: true,
        defaultBadgeStyle: 'default',
        globalBadges: []
      };
    }

    /**
     * Extract projects array from various input formats
     * @private
     * @param {Array|Object} eventOrProjects - Projects array or event with projects
     * @returns {Array} Array of projects
     */
    _extractProjects(eventOrProjects) {
      let projects = [];

      const extractProjects = (obj) => {
        const rawProjects = obj?.data?.projects || obj?.projects || [];
        return rawProjects.map(p => p.to_dict ? p.to_dict() : p);
      };

      if (Array.isArray(eventOrProjects)) {
        projects = eventOrProjects.map(p => p.to_dict ? p.to_dict() : p);
      } else if (eventOrProjects instanceof Event) {
        projects = extractProjects(eventOrProjects.detail);
      } else {
        projects = extractProjects(eventOrProjects);
      }

      console.log('[PROJECTS] Raw projects data:', projects);
      return projects;
    }

    /**
     * Render error state when projects fail to load
     * @private
     * @param {string} message - Error message to display
     */
    _renderErrorState(message = 'Error loading projects') {
      const errorMsg = document.createElement('div');
      errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
      errorMsg.textContent = message;
      this.element.appendChild(errorMsg);
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }

    /**
     * Create a project card element
     * @private
     * @param {Object} project - Project data
     * @returns {HTMLElement} Project card element
     */
    _createProjectCard(project) {
      console.log('[DEBUG] Creating card for project:', project);
      if (!project) {
        console.error('[DEBUG] Project is null/undefined');
        return null;
      }
      if (!project.id) {
        console.error('[DEBUG] Project missing required id field:', project);
        return null;
      }

      // Get project stats
      const usage = project.token_usage || 0;
      const maxTokens = project.max_tokens || 0;
      const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;

      // Get customization
      const customization = this.state.cardCustomization;

      // Apply project-specific theme if set, otherwise use global theme
      const themeClass = `project-card-theme-${project.theme || customization.theme}`;

      // Create card
      let card;
      if (window.uiUtilsInstance && window.uiUtilsInstance.createElement) {
        card = window.uiUtilsInstance.createElement("div", {
          className: `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} 
                      ${project.archived ? "project-card-archived" : ""} ${themeClass}`,
          "data-project-id": project.id
        });
      } else {
        // Fallback implementation
        card = document.createElement('div');
        card.className = `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} 
                          ${project.archived ? "project-card-archived" : ""} ${themeClass}`;
        card.dataset.projectId = project.id;
      }

      // Add card header
      this._addCardHeader(card, project);

      // Add description if enabled
      if (customization.showDescription) {
        const desc = window.uiUtilsInstance.createElement("p", {
          className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
          textContent: project.description || "No description"
        });
        card.appendChild(desc);
      }

      // Add badges if enabled
      if (customization.showBadges) {
        const badgesContainer = window.uiUtilsInstance.createElement("div", {
          className: "project-card-badges"
        });

        // Add global badges
        if (customization.globalBadges && customization.globalBadges.length > 0) {
          customization.globalBadges.forEach(badge => {
            badgesContainer.appendChild(this._createBadgeElement(badge));
          });
        }

        // Add project-specific badges
        if (project.badges && project.badges.length > 0) {
          project.badges.forEach(badge => {
            badgesContainer.appendChild(this._createBadgeElement(badge));
          });
        }

        // Only add container if there are badges
        if (badgesContainer.children.length > 0) {
          card.appendChild(badgesContainer);
        }
      }

      // Add token usage if enabled
      if (customization.showTokens) {
        this._addTokenUsage(card, usage, maxTokens, usagePct);
      }

      // Add footer with date if enabled
      if (customization.showDate) {
        this._addCardFooter(card, project);
      }

      // Make card clickable for view
      card.addEventListener('click', () => this.onViewProject(project.id));

      return card;
    }

    /**
     * Add header section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {Object} project - Project data
     */
    _addCardHeader(card, project) {
      const header = window.uiUtilsInstance.createElement("div", { className: "flex justify-between mb-2" });
      const title = window.uiUtilsInstance.createElement("h3", {
        className: "text-lg font-semibold",
        textContent: project.name
      });
      const statusIndicator = window.uiUtilsInstance.createElement("div", {
        className: "text-xs ml-2 px-2 py-1 rounded-full " + (
          project.archived ? "bg-gray-100 text-gray-600" :
            project.pinned ? "bg-yellow-100 text-yellow-700" :
              "bg-blue-100 text-blue-700"
        ),
        textContent: project.archived ? "Archived" :
          project.pinned ? "Pinned" : "Active"
      });

      const badges = window.uiUtilsInstance.createElement("div", { className: "flex items-center" });
      badges.appendChild(statusIndicator);
      header.appendChild(title);
      header.appendChild(badges);
      card.appendChild(header);
    }

    /**
     * Add token usage section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {number} usage - Token usage
     * @param {number} maxTokens - Maximum tokens
     * @param {string} usagePct - Usage percentage
     */
    _addTokenUsage(card, usage, maxTokens, usagePct) {
      const tokenWrapper = window.uiUtilsInstance.createElement("div", { className: "mb-2" });
      const tokenHeader = window.uiUtilsInstance.createElement("div", {
        className: "flex justify-between mb-1 text-xs",
        innerHTML: `
          <span>Tokens: ${window.uiUtilsInstance.formatNumber(usage)} / ${window.uiUtilsInstance.formatNumber(maxTokens)}</span>
          <span>${usagePct}%</span>
        `
      });

      const progressOuter = window.uiUtilsInstance.createElement("div", { className: "progress-outer" });
      const progressInner = window.uiUtilsInstance.createElement("div", {
        className: "progress-inner h-full transition-all duration-500 ease-out",
        style: { width: `${usagePct}%` }
      });

      progressOuter.appendChild(progressInner);
      tokenWrapper.appendChild(tokenHeader);
      tokenWrapper.appendChild(progressOuter);
      card.appendChild(tokenWrapper);
    }

    /**
     * Add footer section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {Object} project - Project data
     */
    _addCardFooter(card, project) {
      const footer = window.uiUtilsInstance.createElement("div", { className: "flex justify-between mt-auto pt-3" });
      const createdInfo = window.uiUtilsInstance.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `Created ${window.uiUtilsInstance.formatDate(project.created_at)}`
      });

      const actions = window.uiUtilsInstance.createElement("div", { className: "flex space-x-1" });

      // View button
      const viewBtn = window.uiUtilsInstance.createElement("button", {
        className: "p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-150 view-project-btn",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                     -1.274 4.057-5.064 7-9.542 7
                     -4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation(); // Prevent card click
          this.onViewProject(project.id);
        }
      });

      // Badge/status button
      const badgeBtn = window.uiUtilsInstance.createElement("button", {
        className: "p-1 text-green-600 hover:text-green-800 badge-project-btn",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation(); // Prevent card click
          this._showAddBadgeDialog(project.id);
        }
      });

      // Delete button
      const deleteBtn = window.uiUtilsInstance.createElement("button", {
        className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                     a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6
                     m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation(); // Prevent card click
          this._confirmDelete(project);
        }
      });

      actions.appendChild(viewBtn);
      actions.appendChild(badgeBtn);
      actions.appendChild(deleteBtn);
      footer.appendChild(createdInfo);
      footer.appendChild(actions);
      card.appendChild(footer);
    }

    /**
     * Show dialog to add a badge to a specific project
     * @private
     * @param {string} projectId - Project ID
     */
    _showAddBadgeDialog(projectId) {
      // Use ModalManager's confirmAction method for this simple dialog
      if (window.ModalManager && window.ModalManager.confirmAction) {
        let badgeText = '';
        let badgeIcon = '';
        let badgeStyle = this.state.cardCustomization.defaultBadgeStyle;
        const project = this.state.projects.find(p => p.id === projectId);
        const currentTheme = project?.theme || 'default';

        // Create the badge form HTML
        const formHtml = `
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Badge Text</label>
            <input type="text" id="projectBadgeText" class="w-full px-3 py-2 border rounded"
                   placeholder="e.g., In Progress, Urgent, etc.">
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Icon (Optional)</label>
            <input type="text" id="projectBadgeIcon" class="w-full px-3 py-2 border rounded"
                   placeholder="Emoji e.g., 🚀, 🔥, ⚠️">
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Badge Style</label>
            <select id="projectBadgeStyle" class="w-full px-3 py-2 border rounded">
              ${this.badgeStyles.map(style =>
          `<option value="${style.id}">${style.name}</option>`
        ).join('')}
            </select>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Card Theme</label>
            <select id="projectCardTheme" class="w-full px-3 py-2 border rounded">
              ${this.availableThemes.map(theme =>
          `<option value="${theme.id}" ${currentTheme === theme.id ? 'selected' : ''}>${theme.name}</option>`
        ).join('')}
            </select>
          </div>
        `;

        window.ModalManager.confirmAction({
          title: "Customize Project Card",
          message: formHtml,
          confirmText: "Save Changes",
          cancelText: "Cancel",
          onConfirm: () => {
            badgeText = document.getElementById('projectBadgeText').value.trim();
            badgeIcon = document.getElementById('projectBadgeIcon').value.trim();
            badgeStyle = document.getElementById('projectBadgeStyle').value;
            const theme = document.getElementById('projectCardTheme').value;

            // Update project theme
            const project = this.state.projects.find(p => p.id === projectId);
            if (project) {
              project.theme = theme;
            }

            // Add badge if text provided
            if (badgeText) {
              this.addProjectBadge(projectId, {
                text: badgeText,
                style: badgeStyle,
                icon: badgeIcon
              });
            }

            // Re-render the affected card
            const card = this.element.querySelector(`[data-project-id="${projectId}"]`);
            if (card) {
              const newCard = this._createProjectCard(project);
              card.replaceWith(newCard);
            }

            if (window.showNotification) {
              window.showNotification(`Project card customized`, 'success');
            }
          }
        });
      } else {
        // Fallback to simple prompt
        const text = prompt('Enter badge text:');
        if (text) {
          this.addProjectBadge(projectId, {
            text,
            style: this.state.cardCustomization.defaultBadgeStyle
          });
        }
      }
    }

    /**
     * Show confirmation dialog for deleting a project
     * @private
     * @param {Object} project - Project to delete
     */
    _confirmDelete(project) {
      if (!window.modalManager) {
        console.error('modalManager not available');
        return;
      }

      window.modalManager.show('delete', {
        title: "Delete Project",
        message: `Are you sure you want to delete "${project.name}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
        confirmClass: "bg-red-600",
        onConfirm: () => {
          if (!window.projectManager) {
            console.error('projectManager not available');
            window.showNotification("Cannot delete project: system error", "error");
            return;
          }

          window.projectManager.deleteProject(project.id)
            .then(() => {
              window.showNotification("Project deleted", "success");
              window.projectManager.loadProjects();
            })
            .catch(err => {
              console.error("Error deleting project:", err);
              window.showNotification("Failed to delete project", "error");
            });
        }
      });
    }

    /**
     * Bind filter buttons event handlers
     * @private
     */
    _bindFilterEvents() {
      const filterButtons = document.querySelectorAll('.project-filter-btn');
      if (!filterButtons.length) {
        console.warn('No project filter buttons found');
        return;
      }

      // Set initial active filter from URL or default
      const urlParams = new URLSearchParams(window.location.search);
      const initialFilter = urlParams.get('filter') || 'all';
      this.state.filter = initialFilter;

      // Set initial active button with ARIA attributes
      filterButtons.forEach(btn => {
        const isActive = btn.dataset.filter === initialFilter;
        btn.classList.toggle('project-tab-btn-active', isActive);
        btn.classList.toggle('text-gray-500', !isActive);
        btn.setAttribute('aria-selected', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
      });

      // Load initial projects with filter
      if (window.projectManager?.loadProjects) {
        this._showLoadingState();
        window.projectManager.loadProjects(initialFilter)
          .catch(err => {
            console.error('Initial project load failed:', err);
            this._showErrorState('Failed to load projects');
          })
          .finally(() => {
            this._hideLoadingState();
          });
      }

      // Add click handlers
      filterButtons.forEach(button => {
        button.addEventListener('click', () => {
          // Get filter from data attribute
          const filter = button.dataset.filter;
          if (this.state.filter === filter) return; // Skip if already active

          // Show loading state
          this._showLoadingState();

          // Update UI state
          filterButtons.forEach(btn => {
            const isActive = btn === button;
            btn.classList.toggle('project-tab-btn-active', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.setAttribute('aria-selected', isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
          });

          // Update component state
          this.state.filter = filter;

          // Update URL without reload
          const url = new URL(window.location);
          url.searchParams.set('filter', filter);
          window.history.pushState({}, '', url);

          // Reload projects with new filter
          window.projectManager.loadProjects(filter)
            .catch(err => {
              console.error('Project filter failed:', err);
              this._showErrorState('Filter operation failed');
            })
            .finally(() => {
              this._hideLoadingState();
            });
        });
      });

      // Handle back/forward navigation
      window.addEventListener('popstate', () => {
        const params = new URLSearchParams(window.location.search);
        const newFilter = params.get('filter') || 'all';
        if (newFilter !== this.state.filter) {
          this._showLoadingState();
          this.state.filter = newFilter;
          filterButtons.forEach(btn => {
            const isActive = btn.dataset.filter === newFilter;
            btn.classList.toggle('project-tab-btn-active', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.setAttribute('aria-selected', isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
          });
          window.projectManager.loadProjects(newFilter)
            .catch(err => {
              console.error('Navigation project load failed:', err);
              this._showErrorState('Failed to load projects');
            })
            .finally(() => {
              this._hideLoadingState();
            });
        }
      });
    }

    /**
     * Show loading state for project list
     * @private
     */
    _showLoadingState() {
      if (!this.element) return;
      this.element.classList.add('opacity-50');
      this.element.style.pointerEvents = 'none';

      // Add loading spinner if not already present
      if (!this.element.querySelector('.loading-spinner')) {
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner absolute inset-0 flex items-center justify-center';
        spinner.innerHTML = `
          <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        `;
        this.element.appendChild(spinner);
      }
    }

    /**
     * Hide loading state for project list
     * @private
     */
    _hideLoadingState() {
      if (!this.element) return;
      this.element.classList.remove('opacity-50');
      this.element.style.pointerEvents = '';

      const spinner = this.element.querySelector('.loading-spinner');
      if (spinner) {
        spinner.remove();
      }
    }

    /**
     * Bind the "Create Project" button event handler
     * @private
     */
    _bindCreateProjectButton() {
      const createProjectBtn = document.getElementById('createProjectBtn');
      if (createProjectBtn) {
        createProjectBtn.addEventListener('click', () => {
          if (!window.projectModal?.initialized) {
            window.projectModal = new ProjectModal();
          }
          window.projectModal.openModal();
        });
      } else {
        console.error('Create Project button not found');
      }
    }
  }

  // Explicitly export to global window
  window.ProjectListComponent = ProjectListComponent;
})();

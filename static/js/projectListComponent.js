/**
 * Enhanced ProjectListComponent
 * ----------------------------
 * Manages the project list view with:
 * - Customizable project cards
 * - Advanced filtering
 * - Badge support
 * - Theme management
 * - Responsive design
 */

(function () {
  class ProjectListComponent {
    constructor(options) {
      this._validateOptions(options);
      this._initializeState(options);
      this._setupDOMReferences();
      this._bindEvents();
      this._setupCustomization();
    }

    // ======================
    // PUBLIC API
    // ======================

    show() {
      this._toggleListViewVisibility(true);
    }

    hide() {
      this._toggleListViewVisibility(false);
    }

    renderProjects(eventOrProjects) {
      try {
        this._ensureContainerVisibility();

        if (this._shouldLoadProjectsDirectly(eventOrProjects)) {
          return this._loadProjectsThroughManager();
        }

        const projects = this._extractProjects(eventOrProjects);
        this.state.projects = projects;

        this._resetScrollPosition();
        this._renderFilteredProjects();
      } catch (err) {
        console.error('Project rendering error:', err);
        this._renderErrorState('Failed to display projects');
      } finally {
        this._hideLoadingState();
      }
    }

    applyGlobalTheme(themeId) {
      if (!this._isValidTheme(themeId)) return;

      this.state.cardCustomization.theme = themeId;
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
    }

    addProjectBadge(projectId, badge) {
      if (!badge.text) {
        this._showNotification('Badge text is required', 'error');
        return;
      }

      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      project.badges = project.badges || [];
      project.badges.push({
        text: badge.text,
        style: badge.style || 'default',
        icon: badge.icon || null
      });

      this._updateProjectCard(projectId);
    }

    // ======================
    // PRIVATE METHODS
    // ======================

    _validateOptions(options) {
      if (!options?.elementId) {
        throw new Error('ProjectListComponent requires elementId option');
      }
    }

    _initializeState(options) {
      this.state = {
        projects: [],
        filter: 'all',
        loading: false,
        cardCustomization: this._loadCardCustomization()
      };

      this.elementId = options.elementId;
      this.onViewProject = options.onViewProject;

      this.availableThemes = [
        { id: 'default', name: 'Default' },
        { id: 'primary', name: 'Primary' },
        { id: 'success', name: 'Success' },
        { id: 'warning', name: 'Warning' },
        { id: 'danger', name: 'Danger' }
      ];

      this.badgeStyles = [
        { id: 'default', name: 'Default' },
        { id: 'blue', name: 'Blue' },
        { id: 'green', name: 'Green' },
        { id: 'red', name: 'Red' }
      ];
    }

    _setupDOMReferences() {
      this.element = document.getElementById(this.elementId);
      this.messageEl = document.getElementById("noProjectsMessage");

      if (!this.element) {
        this._createFallbackContainer();
      }
    }

    _createFallbackContainer() {
      this.element = document.createElement('div');
      this.element.id = this.elementId;
      this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';

      const listView = document.getElementById('projectListView');
      if (listView) listView.appendChild(this.element);
    }

    _bindEvents() {
      this._bindFilterEvents();
      this._bindCreateProjectButton();
      // Add event delegation for project card clicks
      this._bindProjectCardEvents();
    }

    _setupCustomization() {
      this._initializeCustomizationUI();
      this._createCustomizationModal();
    }

    _toggleListViewVisibility(show) {
      const listView = document.getElementById('projectListView');
      // const detailsView = document.getElementById('projectDetailsView'); // REMOVE - Let app.js handle details view

      if (listView) {
        listView.classList.toggle('hidden', !show);
        listView.classList.toggle('flex-1', show); // Ensure layout class is toggled correctly
        console.log(`[ProjectListComponent] Toggled projectListView visibility: ${show ? 'visible' : 'hidden'}`);
      } else {
        console.warn('[ProjectListComponent] projectListView element not found for visibility toggle.');
      }

      // REMOVED - Let app.js handle details view
      // if (detailsView) {
      //   detailsView.classList.toggle('hidden', show);
      //   console.log(`[ProjectListComponent] Toggled projectDetailsView visibility: ${show ? 'hidden' : 'visible'}`);
      // } else {
      //    console.warn('[ProjectListComponent] projectDetailsView element not found for visibility toggle.');
      // }

      // This part seems redundant if listView itself is the container
      // if (this.element) {
      //   this.element.style.display = show ? 'grid' : 'none';
      // }
    }

    _ensureContainerVisibility() {
      const container = document.getElementById("projectListView");
      if (container) container.classList.remove("hidden");
    }

    _shouldLoadProjectsDirectly(eventOrProjects) {
      return eventOrProjects?.forceRefresh ||
        eventOrProjects?.directCall ||
        !eventOrProjects;
    }

    _loadProjectsThroughManager() {
      if (!window.projectManager?.loadProjects) {
        throw new Error('projectManager not available');
      }

      this._showLoadingState();
      return window.projectManager.loadProjects()
        .catch(err => {
          console.error('Project loading failed:', err);
          this._renderErrorState('Failed to load projects');
        });
    }

    _extractProjects(eventOrProjects) {
      let projects = [];

      if (Array.isArray(eventOrProjects)) {
        projects = eventOrProjects;
      } else if (eventOrProjects instanceof Event) {
        projects = eventOrProjects.detail?.data?.projects || [];
      } else if (eventOrProjects?.data?.projects) {
        projects = eventOrProjects.data.projects;
      } else if (eventOrProjects?.projects) {
        projects = eventOrProjects.projects;
      }

      return projects.map(p => p.to_dict ? p.to_dict() : p);
    }

    _resetScrollPosition() {
      if (this.state.projects.length > 0) {
        requestAnimationFrame(() => {
          if (this.element) this.element.scrollTop = 0;
        });
      }
    }

    _renderFilteredProjects() {
      const filteredProjects = this._getFilteredProjects();

      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => {
        this._performDOMUpdate(filteredProjects);
      }, 50);
    }

    _getFilteredProjects() {
      return this.state.projects.filter(p => {
        switch (this.state.filter) {
          case 'pinned': return p.pinned;
          case 'archived': return p.archived;
          default: return true;
        }
      });
    }

    _performDOMUpdate(filteredProjects) {
      if (!this.element) return;

      this.element.innerHTML = "";

      if (filteredProjects.length === 0) {
        this._showEmptyState();
        return;
      }

      filteredProjects.forEach(project => {
        const card = this._createProjectCard(project);
        if (card) {
          this.element.appendChild(card);
        }
      });
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }

    _showEmptyState() {
      if (!this.messageEl) return;

      const message = this._getEmptyStateMessage();
      this.messageEl.textContent = message;
      this.messageEl.classList.remove("hidden");
    }

    _getEmptyStateMessage() {
      if (this.state.filter === 'all') return 'No projects available';
      if (this.state.filter === 'pinned') return 'No pinned projects';
      if (this.state.filter === 'archived') return 'No archived projects';
      return 'No projects match your criteria';
    }

    _createProjectCard(project) {
      const card = document.createElement('div');
      card.className = 'project-card bg-white dark:bg-gray-800 rounded-sm shadow-xs border border-gray-200 dark:border-gray-700 p-4 flex flex-col justify-between hover:shadow-sm transition-shadow cursor-pointer';
      card.dataset.projectId = project.id;

      // Add project name, description, etc.
      card.innerHTML = `
        <div>
          <h3 class="text-lg font-semibold mb-2 truncate">${project.name || 'Unnamed Project'}</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">${project.description || 'No description'}</p>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-auto pt-2 border-t border-gray-200 dark:border-gray-600">
          <span>Updated: ${new Date(project.updated_at).toLocaleDateString()}</span>
          ${project.pinned ? '<span class="ml-2">📌</span>' : ''}
        </div>
      `;

      return card;
    }

    _updateProjectCard(projectId) {
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      const card = this.element.querySelector(`[data-project-id="${projectId}"]`);
      if (!card) return;

      const newCard = this._createProjectCard(project);
      card.replaceWith(newCard);
    }

    _showAddBadgeDialog(projectId) {
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      const currentTheme = project.theme || 'default';

      const formHtml = `
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1">Badge Text</label>
          <input type="text" id="projectBadgeText" class="w-full px-3 py-2 border rounded-sm" placeholder="e.g., In Progress">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1">Icon (Optional)</label>
          <input type="text" id="projectBadgeIcon" class="w-full px-3 py-2 border rounded-sm" placeholder="Emoji e.g., 🚀">
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1">Badge Style</label>
          <select id="projectBadgeStyle" class="w-full px-3 py-2 border rounded-sm">
            ${this.badgeStyles.map(style =>
        `<option value="${style.id}">${style.name}</option>`
      ).join('')}
          </select>
        </div>
        <div class="mb-4">
          <label class="block text-sm font-medium mb-1">Card Theme</label>
          <select id="projectCardTheme" class="w-full px-3 py-2 border rounded-sm">
            ${this.availableThemes.map(theme =>
        `<option value="${theme.id}" ${currentTheme === theme.id ? 'selected' : ''}>${theme.name}</option>`
      ).join('')}
          </select>
        </div>
      `;

      this._showModal({
        title: "Customize Project Card",
        content: formHtml,
        confirmText: "Save Changes",
        onConfirm: () => this._saveCardCustomizations(projectId)
      });
    }

    _saveCardCustomizations(projectId) {
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      const text = document.getElementById('projectBadgeText').value.trim();
      const icon = document.getElementById('projectBadgeIcon').value.trim();
      const style = document.getElementById('projectBadgeStyle').value;
      const theme = document.getElementById('projectCardTheme').value;

      project.theme = theme;

      if (text) {
        this.addProjectBadge(projectId, {
          text,
          style,
          icon: icon || null
        });
      }

      this._showNotification('Project card customized', 'success');
    }

    _confirmDelete(project) {
      this._showModal({
        title: "Delete Project",
        content: `Are you sure you want to delete "${project.name}"?`,
        confirmText: "Delete",
        confirmClass: "bg-red-600",
        onConfirm: () => this._deleteProject(project.id)
      });
    }

    _deleteProject(projectId) {
      if (!window.projectManager?.deleteProject) {
        this._showNotification("Cannot delete project: system error", "error");
        return;
      }

      window.projectManager.deleteProject(projectId)
        .then(() => {
          this._showNotification("Project deleted", "success");
          window.projectManager.loadProjects();
        })
        .catch(err => {
          console.error("Delete failed:", err);
          this._showNotification("Failed to delete project", "error");
        });
    }

    _showModal({ title, content, confirmText, confirmClass, onConfirm }) {
      if (window.modalManager) {
        window.modalManager.show('confirm', {
          title,
          message: content,
          confirmText,
          confirmClass,
          onConfirm
        });
      } else {
        // Fallback to native confirm
        if (confirm(`${title}\n\n${content}`)) {
          onConfirm();
        }
      }
    }

    _showNotification(message, type = 'info') {
      if (window.showNotification) {
        window.showNotification(message, type);
      } else {
        console.log(`${type.toUpperCase()}: ${message}`);
      }
    }

    _renderErrorState(message) {
      if (!this.element) return;

      const error = document.createElement('div');
      error.className = 'text-red-500 text-center py-8 col-span-3';
      error.textContent = message;

      this.element.appendChild(error);
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }

    _showLoadingState() {
      if (!this.element) return;

      this.element.classList.add('opacity-50');
      this.element.style.pointerEvents = 'none';

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

    _hideLoadingState() {
      if (!this.element) return;

      this.element.classList.remove('opacity-50');
      this.element.style.pointerEvents = '';

      const spinner = this.element.querySelector('.loading-spinner');
      if (spinner) spinner.remove();
    }

    _bindFilterEvents() {
      const buttons = document.querySelectorAll('.project-filter-btn');
      if (!buttons.length) return;

      const initialFilter = this._getInitialFilter();
      this.state.filter = initialFilter;

      this._setInitialActiveButton(buttons, initialFilter);
      this._loadInitialProjects(initialFilter);

      buttons.forEach(btn => {
        btn.addEventListener('click', () => this._handleFilterClick(btn, buttons));
      });

      window.addEventListener('popstate', () => this._handlePopState(buttons));
    }

    _getInitialFilter() {
      const params = new URLSearchParams(window.location.search);
      return params.get('filter') || 'all';
    }

    _setInitialActiveButton(buttons, filter) {
      buttons.forEach(btn => {
        const isActive = btn.dataset.filter === filter;
        btn.classList.toggle('project-tab-btn-active', isActive);
        btn.setAttribute('aria-selected', isActive);
      });
    }

    _loadInitialProjects(filter) {
      if (window.projectManager?.loadProjects) {
        this._showLoadingState();
        window.projectManager.loadProjects(filter)
          .catch(err => {
            console.error('Initial load failed:', err);
            this._renderErrorState('Failed to load projects');
          });
      }
    }

    _handleFilterClick(button, allButtons) {
      const filter = button.dataset.filter;
      if (this.state.filter === filter) return;

      this._showLoadingState();

      allButtons.forEach(btn => {
        const isActive = btn === button;
        btn.classList.toggle('project-tab-btn-active', isActive);
        btn.setAttribute('aria-selected', isActive);
      });

      this.state.filter = filter;
      this._updateURL(filter);

      window.projectManager.loadProjects(filter)
        .catch(err => {
          console.error('Filter failed:', err);
          this._renderErrorState('Filter operation failed');
        });
    }

    _updateURL(filter) {
      const url = new URL(window.location);
      url.searchParams.set('filter', filter);
      window.history.pushState({}, '', url);
    }

    _handlePopState(allButtons) {
      const params = new URLSearchParams(window.location.search);
      const newFilter = params.get('filter') || 'all';

      if (newFilter !== this.state.filter) {
        this._showLoadingState();
        this.state.filter = newFilter;

        allButtons.forEach(btn => {
          const isActive = btn.dataset.filter === newFilter;
          btn.classList.toggle('project-tab-btn-active', isActive);
          btn.setAttribute('aria-selected', isActive);
        });

        window.projectManager.loadProjects(newFilter)
          .catch(err => {
            console.error('Navigation load failed:', err);
            this._renderErrorState('Failed to load projects');
          });
      }
    }

    _bindCreateProjectButton() {
      const button = document.getElementById('createProjectBtn');
      if (!button) {
        console.error('Create button not found');
        return;
      }

      button.addEventListener('click', () => {
        if (!window.projectModal) {
          window.projectModal = new ProjectModal();
        }
        window.projectModal.openModal();
      });
    }

    _initializeCustomizationUI() {
      const header = document.querySelector('#projectListView .mb-4');
      if (!header || document.getElementById('customizeCardsBtn')) return;

      const button = document.createElement('button');
      button.id = 'customizeCardsBtn';
      button.className = 'ml-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-2 py-1 rounded text-sm flex items-center';
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 001.066-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Customize Cards
      `;
      button.addEventListener('click', () => this._showCustomizationModal());

      const actionContainer = header.querySelector('div:last-child');
      if (actionContainer) {
        actionContainer.insertBefore(button, actionContainer.firstChild);
      } else {
        header.appendChild(button);
      }
    }

    _createCustomizationModal() {
      if (document.getElementById('cardCustomizationModal')) return;

      const modal = document.createElement('div');
      modal.id = 'cardCustomizationModal';
      modal.className = 'hidden fixed inset-0 bg-black bg-opacity-50 z-modal flex items-center justify-center';
      modal.setAttribute('aria-modal', 'true');

      modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-md p-6 max-w-md w-full">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">Customize Project Cards</h3>
            <button id="closeCustomizationBtn" class="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Card Theme</label>
            <select id="cardThemeSelect" class="w-full px-3 py-2 border rounded-sm">
              ${this.availableThemes.map(theme =>
        `<option value="${theme.id}" ${this.state.cardCustomization.theme === theme.id ? 'selected' : ''}>${theme.name}</option>`
      ).join('')}
            </select>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Display Options</label>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex items-center text-sm">
                <input type="checkbox" class="mr-2" id="showDescriptionCheckbox" ${this.state.cardCustomization.showDescription ? 'checked' : ''}>
                Description
              </label>
              <label class="flex items-center text-sm">
                <input type="checkbox" class="mr-2" id="showTokensCheckbox" ${this.state.cardCustomization.showTokens ? 'checked' : ''}>
                Token Usage
              </label>
              <label class="flex items-center text-sm">
                <input type="checkbox" class="mr-2" id="showDateCheckbox" ${this.state.cardCustomization.showDate ? 'checked' : ''}>
                Creation Date
              </label>
              <label class="flex items-center text-sm">
                <input type="checkbox" class="mr-2" id="showBadgesCheckbox" ${this.state.cardCustomization.showBadges ? 'checked' : ''}>
                Show Badges
              </label>
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium mb-1">Default Badge Style</label>
            <select id="defaultBadgeStyleSelect" class="w-full px-3 py-2 border rounded-sm">
              ${this.badgeStyles.map(style =>
        `<option value="${style.id}" ${this.state.cardCustomization.defaultBadgeStyle === style.id ? 'selected' : ''}>${style.name}</option>`
      ).join('')}
            </select>
          </div>

          <div class="flex justify-end gap-2 mt-6">
            <button id="resetCustomizationBtn" class="px-4 py-2 border rounded-sm">
              Reset
            </button>
            <button id="applyCustomizationBtn" class="px-4 py-2 bg-blue-600 text-white rounded-sm">
              Apply
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      document.getElementById('closeCustomizationBtn').addEventListener('click', () =>
        this._hideCustomizationModal()
      );

      document.getElementById('applyCustomizationBtn').addEventListener('click', () =>
        this._applyCardCustomization()
      );

      document.getElementById('resetCustomizationBtn').addEventListener('click', () =>
        this._resetCardCustomization()
      );
    }

    _showCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (!modal) return;

      document.getElementById('cardThemeSelect').value = this.state.cardCustomization.theme;
      document.getElementById('showDescriptionCheckbox').checked = this.state.cardCustomization.showDescription;
      document.getElementById('showTokensCheckbox').checked = this.state.cardCustomization.showTokens;
      document.getElementById('showDateCheckbox').checked = this.state.cardCustomization.showDate;
      document.getElementById('showBadgesCheckbox').checked = this.state.cardCustomization.showBadges;
      document.getElementById('defaultBadgeStyleSelect').value = this.state.cardCustomization.defaultBadgeStyle;

      modal.classList.remove('hidden');
    }

    _hideCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (modal) modal.classList.add('hidden');
    }

    _applyCardCustomization() {
      this.state.cardCustomization = {
        theme: document.getElementById('cardThemeSelect').value,
        showDescription: document.getElementById('showDescriptionCheckbox').checked,
        showTokens: document.getElementById('showTokensCheckbox').checked,
        showDate: document.getElementById('showDateCheckbox').checked,
        showBadges: document.getElementById('showBadgesCheckbox').checked,
        defaultBadgeStyle: document.getElementById('defaultBadgeStyleSelect').value,
        globalBadges: this.state.cardCustomization.globalBadges || []
      };

      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
      this._hideCustomizationModal();

      this._showNotification('Customization applied', 'success');
    }

    _resetCardCustomization() {
      this.state.cardCustomization = this._getDefaultCardCustomization();
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
      this._hideCustomizationModal();

      this._showNotification('Customization reset', 'info');
    }

    _loadCardCustomization() {
      try {
        const saved = localStorage.getItem('projectCardsCustomization');
        return saved ? JSON.parse(saved) : this._getDefaultCardCustomization();
      } catch (err) {
        console.error('Load failed:', err);
        return this._getDefaultCardCustomization();
      }
    }

    _saveCardCustomization() {
      try {
        localStorage.setItem(
          'projectCardsCustomization',
          JSON.stringify(this.state.cardCustomization)
        );
      } catch (err) {
        console.error('Save failed:', err);
      }
    }

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

    _isValidTheme(themeId) {
      return this.availableThemes.some(theme => theme.id === themeId);
    }

    _bindProjectCardEvents() {
      if (!this.element) return;

      this.element.addEventListener('click', (event) => {
        const projectCard = event.target.closest('.project-card'); // Assuming project cards have this class
        if (!projectCard) return;

        const projectId = projectCard.dataset.projectId;
        if (!projectId) return;

        // Check if a specific action button within the card was clicked
        const viewButton = event.target.closest('[data-action="view-project"]');
        const pinButton = event.target.closest('[data-action="pin-project"]');
        const archiveButton = event.target.closest('[data-action="archive-project"]');
        const editButton = event.target.closest('[data-action="edit-project"]');

        if (viewButton || !event.target.closest('button, a')) { // Treat click on card itself as view
          if (this.onViewProject && typeof this.onViewProject === 'function') {
            event.preventDefault();
            this.onViewProject(projectId);
          } else if (window.projectManager && window.projectManager.loadProjectDetails) {
             event.preventDefault();
             // Hide list view, show details view (can be handled by listener for projectLoaded event)
             this._toggleListViewVisibility(false);
             window.projectManager.loadProjectDetails(projectId);
          }
        } else if (pinButton) {
           event.preventDefault();
           if (window.projectManager && window.projectManager.togglePinProject) {
             window.projectManager.togglePinProject(projectId).then(() => {
               // Optionally refresh just this card or the list
               this._loadProjectsThroughManager(); // Reload all for simplicity
             }).catch(err => console.error('Error pinning project:', err));
           }
        } else if (archiveButton) {
           event.preventDefault();
           if (window.projectManager && window.projectManager.toggleArchiveProject) {
             window.projectManager.toggleArchiveProject(projectId).then(() => {
                this._loadProjectsThroughManager(); // Reload all
             }).catch(err => console.error('Error archiving project:', err));
           }
        } else if (editButton) {
            event.preventDefault();
            // Assuming a modal or form is shown by projectModal.js or similar
            if (window.ProjectModal && typeof window.ProjectModal.showEditForm === 'function') {
                window.ProjectModal.showEditForm(projectId);
            } else {
                console.warn('Edit project function not found');
            }
        }
        // Add more actions as needed (e.g., delete)
      });
    }
  }

  // Export to global scope
  window.ProjectListComponent = ProjectListComponent;
})();

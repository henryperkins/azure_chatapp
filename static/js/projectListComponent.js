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
    }

    _setupCustomization() {
      this._initializeCustomizationUI();
      this._createCustomizationModal();
    }

    _toggleListViewVisibility(show) {
      const listView = document.getElementById('projectListView');
      const detailsView = document.getElementById('projectDetailsView');

      if (listView) {
        listView.classList.toggle('hidden', !show);
        listView.classList.toggle('flex-1', show);
      }

      if (detailsView) detailsView.classList.toggle('hidden', show);

      if (this.element) {
        this.element.style.display = show ? 'grid' : 'none';
      }
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

      const fragment = document.createDocumentFragment();
      filteredProjects.forEach(project => {
        const card = this._createProjectCard(project);
        if (card) fragment.appendChild(card);
      });

      this.element.appendChild(fragment);
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
      if (!project?.id) {
        console.error('Invalid project data:', project);
        return null;
      }

      const card = document.createElement('div');
      card.className = this._getCardClasses(project);
      card.dataset.projectId = project.id;

      this._addCardHeader(card, project);
      this._addCardContent(card, project);
      this._addCardFooter(card, project);

      card.addEventListener('click', () => this.onViewProject(project.id));

      return card;
    }

    _getCardClasses(project) {
      const theme = project.theme || this.state.cardCustomization.theme;
      return [
        'project-card',
        'flex',
        'flex-col',
        project.pinned ? 'project-card-pinned' : 'project-card-unpinned',
        project.archived ? 'project-card-archived' : '',
        `project-card-theme-${theme}`
      ].join(' ');
    }

    _addCardHeader(card, project) {
      const header = document.createElement('div');
      header.className = 'flex justify-between mb-2';

      const title = document.createElement('h3');
      title.className = 'text-lg font-semibold';
      title.textContent = project.name;

      const status = document.createElement('div');
      status.className = this._getStatusClasses(project);
      status.textContent = this._getStatusText(project);

      header.appendChild(title);
      header.appendChild(status);
      card.appendChild(header);
    }

    _getStatusClasses(project) {
      const base = 'text-xs ml-2 px-2 py-1 rounded-full';

      if (project.archived) return `${base} bg-gray-100 text-gray-600`;
      if (project.pinned) return `${base} bg-yellow-100 text-yellow-700`;
      return `${base} bg-blue-100 text-blue-700`;
    }

    _getStatusText(project) {
      if (project.archived) return 'Archived';
      if (project.pinned) return 'Pinned';
      return 'Active';
    }

    _addCardContent(card, project) {
      if (this.state.cardCustomization.showDescription) {
        this._addDescription(card, project);
      }

      if (this.state.cardCustomization.showBadges) {
        this._addBadges(card, project);
      }

      if (this.state.cardCustomization.showTokens) {
        this._addTokenUsage(card, project);
      }
    }

    _addDescription(card, project) {
      const desc = document.createElement('p');
      desc.className = 'text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2';
      desc.textContent = project.description || 'No description';
      card.appendChild(desc);
    }

    _addBadges(card, project) {
      const badges = this._getAllBadges(project);
      if (badges.length === 0) return;

      const container = document.createElement('div');
      container.className = 'project-card-badges';

      badges.forEach(badge => {
        container.appendChild(this._createBadgeElement(badge));
      });

      card.appendChild(container);
    }

    _getAllBadges(project) {
      const globalBadges = this.state.cardCustomization.globalBadges || [];
      const projectBadges = project.badges || [];
      return [...globalBadges, ...projectBadges];
    }

    _createBadgeElement(badge) {
      const element = document.createElement('span');
      element.className = `project-card-badge project-card-badge-${badge.style || this.state.cardCustomization.defaultBadgeStyle}`;

      if (badge.icon) {
        element.textContent = `${badge.icon} ${badge.text}`;
      } else {
        element.textContent = badge.text;
      }

      return element;
    }

    _addTokenUsage(card, project) {
      const usage = project.token_usage || 0;
      const max = project.max_tokens || 0;
      const percent = max > 0 ? Math.min(100, (usage / max) * 100).toFixed(1) : 0;

      const wrapper = document.createElement('div');
      wrapper.className = 'mb-2';

      const header = document.createElement('div');
      header.className = 'flex justify-between mb-1 text-xs';
      header.innerHTML = `
        <span>Tokens: ${this._formatNumber(usage)} / ${this._formatNumber(max)}</span>
        <span>${percent}%</span>
      `;

      const progress = document.createElement('div');
      progress.className = 'progress-outer';

      const bar = document.createElement('div');
      bar.className = 'progress-inner h-full transition-all duration-500 ease-out';
      bar.style.width = `${percent}%`;

      progress.appendChild(bar);
      wrapper.appendChild(header);
      wrapper.appendChild(progress);
      card.appendChild(wrapper);
    }

    _formatNumber(num) {
      return num?.toLocaleString() || '0';
    }

    _addCardFooter(card, project) {
      const footer = document.createElement('div');
      footer.className = 'flex justify-between mt-auto pt-3';

      const date = document.createElement('div');
      date.className = 'text-xs text-gray-500';
      date.textContent = `Created ${this._formatDate(project.created_at)}`;

      const actions = document.createElement('div');
      actions.className = 'flex gap-1';

      actions.appendChild(this._createViewButton(project.id));
      actions.appendChild(this._createBadgeButton(project.id));
      actions.appendChild(this._createDeleteButton(project));

      footer.appendChild(date);
      footer.appendChild(actions);
      card.appendChild(footer);
    }

    _formatDate(dateString) {
      if (!dateString) return 'unknown date';

      try {
        return new Date(dateString).toLocaleDateString();
      } catch {
        return dateString;
      }
    }

    _createViewButton(projectId) {
      return this._createActionButton({
        className: 'text-blue-600 hover:text-blue-800',
        icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
        onClick: (e) => {
          e.stopPropagation();
          this.onViewProject(projectId);
        }
      });
    }

    _createBadgeButton(projectId) {
      return this._createActionButton({
        className: 'text-green-600 hover:text-green-800',
        icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
        onClick: (e) => {
          e.stopPropagation();
          this._showAddBadgeDialog(projectId);
        }
      });
    }

    _createDeleteButton(project) {
      return this._createActionButton({
        className: 'text-red-600 hover:text-red-800',
        icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
        onClick: (e) => {
          e.stopPropagation();
          this._confirmDelete(project);
        }
      });
    }

    _createActionButton({ className, icon, onClick }) {
      const button = document.createElement('button');
      button.className = `p-1 ${className} transition-colors duration-150`;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'h-4 w-4');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('stroke', 'currentColor');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('d', icon);

      svg.appendChild(path);
      button.appendChild(svg);
      button.addEventListener('click', onClick);

      return button;
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
  }

  // Export to global scope
  window.ProjectListComponent = ProjectListComponent;
})();

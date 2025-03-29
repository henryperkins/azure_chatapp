// Define utility classes with fallbacks
const projectDashboardUtils = require('./projectDashboardUtils');
const UIUtils = projectDashboardUtils.UIUtils;
const AnimationUtils = projectDashboardUtils.AnimationUtils;
const ModalManager = projectDashboardUtils.ModalManager;

// Fallback classes if the imports don't work
class FallbackUIUtils {
  constructor() { 
    console.log('Fallback UIUtils created in projectListComponent'); 
  }
  toggleVisibility(element, visible) {
    if (!element) return;
    element.classList.toggle('hidden', !visible);
  }
  createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.onclick) el.addEventListener('click', options.onclick);
    return el;
  }
  formatNumber(num) { return num?.toString() || '0'; }
  formatDate(date) { return date || ''; }
  formatBytes(bytes) { return (bytes || 0) + ' bytes'; }
  fileIcon() { return '📄'; }
  showNotification(msg, type) { 
    console.log(`${type}: ${msg}`);
    if (window.showNotification) {
      window.showNotification(msg, type);
    } else {
      alert(`${type}: ${msg}`);
    }
  }
}

class FallbackAnimationUtils {
  constructor() { 
    console.log('Fallback AnimationUtils created in projectListComponent'); 
  }
  animateProgress(el, from, to) { 
    if (el) el.style.width = to + '%'; 
  }
}

// Try to use the imported classes, fall back to our defined ones if they don't exist
const UIUtilsClass = UIUtils || FallbackUIUtils;
const AnimationUtilsClass = AnimationUtils || FallbackAnimationUtils;
const ModalManagerClass = ModalManager || class {
  static confirmAction(config) {
    if (confirm(config.message || 'Are you sure?')) {
      config.onConfirm?.();
    } else {
      config.onCancel?.();
    }
  }
};

// Create instances of utility classes for use within this module
const uiUtilsInstance = new UIUtilsClass();
const animationUtilsInstance = new AnimationUtilsClass();

// Ensure instances are available globally if other scripts rely on them (optional, but safer for now)
if (typeof window !== 'undefined') {
  if (!window.UIUtils) window.UIUtils = uiUtilsInstance;
  if (!window.AnimationUtils) window.AnimationUtils = animationUtilsInstance;
}

console.log('UIUtils instance created:', !!uiUtilsInstance?.createElement);
console.log('AnimationUtils instance created:', !!animationUtilsInstance?.animateProgress);

/**
 * Project List Component - Handles the project list view
 */
class ProjectListComponent {
  constructor(options) {
    console.log('[DEBUG] Initializing ProjectListComponent');
    this.elementId = options.elementId;
    this.element = document.getElementById(this.elementId);
    console.log(`[DEBUG] projectList element found: ${!!this.element}`);
    this.onViewProject = options.onViewProject;
    this.messageEl = document.getElementById("noProjectsMessage");
    console.log(`[DEBUG] noProjectsMessage element found: ${!!this.messageEl}`);
    
    // Debug check and fallback container creation
    if (!this.element) {
      console.error(`ProjectListComponent: Element with ID '${this.elementId}' not found - creating fallback`);
      this.element = document.createElement('div');
      this.element.id = this.elementId;
      this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
      this.element.style.minHeight = '200px'; // Ensure visible empty state
      const listView = document.getElementById('projectListView');
      console.log(`[DEBUG] projectListView parent found: ${!!listView}`);
      if (listView) {
        listView.appendChild(this.element);
        console.log('[DEBUG] Created fallback projectList container');
      }
    } else {
      // Ensure existing container has proper classes
      this.element.className = 'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 min-h-[200px]';
    }
    
    this.bindFilterEvents();
  }

  show() {
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');
    
    if (listView) listView.classList.remove('hidden');
    if (detailsView) detailsView.classList.add('hidden');
    if (this.element) this.element.style.display = 'grid';
  }

  hide() {
    const element = document.getElementById("projectListView");
    if (element) {
      uiUtilsInstance.toggleVisibility(element, false);
    } else {
      console.error('projectListView element not found');
    }
  }

  renderProjects(eventOrProjects) {
    try {
      console.log('[DEBUG] renderProjects received:', eventOrProjects);
      const projects = Array.isArray(eventOrProjects)
        ? eventOrProjects
        : eventOrProjects?.detail?.projects || eventOrProjects?.detail?.data?.projects || [];
      console.log('[DEBUG] Projects to render:', projects);
        
      if (!this.element) {
        console.error('Project list container element not found');
        return;
      }

      this.element.innerHTML = "";

      if (projects.error) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
        errorMsg.textContent = 'Error loading projects';
        this.element.appendChild(errorMsg);
        if (this.messageEl) this.messageEl.classList.add("hidden");
        return;
      }

      if (projects.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'text-gray-500 dark:text-gray-400 text-center py-8 col-span-3 transition-colors duration-200';
        emptyMsg.textContent = 'No projects available';
        this.element.appendChild(emptyMsg);
        if (this.messageEl) this.messageEl.classList.add("hidden");
        return;
      }

      if (this.messageEl) this.messageEl.classList.add("hidden");
      
      projects.forEach(project => {
        try {
          const card = this.createProjectCard(project);
          if (card) {
            this.element.appendChild(card);
          }
        } catch (err) {
          console.error('Error rendering project card:', err, project);
        }
      });
    } catch (err) {
      console.error('Error in renderProjects:', err);
      const errorMsg = document.createElement('div');
      errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
      errorMsg.textContent = 'Error displaying projects';
      this.element.appendChild(errorMsg);
    }
  }

  createProjectCard(project) {
    console.log('[DEBUG] Creating card for project:', project);
    if (!project) {
      console.error('[DEBUG] Project is null/undefined');
      return null;
    }
    if (!project.id) {
      console.error('[DEBUG] Project missing required id field:', project);
      return null;
    }
    const usage = project.token_usage || 0;
    const maxTokens = project.max_tokens || 0;
    const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;
    
    let card;
    if (UIUtils && uiUtilsInstance.createElement) {
      card = uiUtilsInstance.createElement("div", {
        className: `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} ${project.archived ? "project-card-archived" : ""}`
      });
    } else {
      // Fallback implementation
      card = document.createElement('div');
      card.className = `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} ${project.archived ? "project-card-archived" : ""}`;
    }
    
    // Header
    const header = uiUtilsInstance.createElement("div", { className: "flex justify-between mb-2" });
    const title = uiUtilsInstance.createElement("h3", { 
      className: "font-semibold text-md", 
      textContent: project.name 
    });
    const badges = uiUtilsInstance.createElement("div", { 
      className: "text-xs text-gray-500",
      textContent: `${project.pinned ? "📌 " : ""}${project.archived ? "🗃️ " : ""}`
    });
    
    header.appendChild(title);
    header.appendChild(badges);
    card.appendChild(header);
    
    // Description
    const desc = uiUtilsInstance.createElement("p", {
      className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
      textContent: project.description || "No description"
    });
    card.appendChild(desc);
    
    // Token usage
    const tokenWrapper = uiUtilsInstance.createElement("div", { className: "mb-2" });
    const tokenHeader = uiUtilsInstance.createElement("div", { 
      className: "flex justify-between mb-1 text-xs",
      innerHTML: `
        <span>Tokens: ${uiUtilsInstance.formatNumber(usage)} / ${uiUtilsInstance.formatNumber(maxTokens)}</span>
        <span>${usagePct}%</span>
      `
    });
    
    const progressOuter = uiUtilsInstance.createElement("div", { className: "progress-outer" });
    const progressInner = uiUtilsInstance.createElement("div", { 
      className: "progress-inner h-full transition-all duration-500 ease-out",
      style: { '--width': `${usagePct}%` }
    });
    
    progressOuter.appendChild(progressInner);
    tokenWrapper.appendChild(tokenHeader);
    tokenWrapper.appendChild(progressOuter);
    card.appendChild(tokenWrapper);
    
    // Footer
    const footer = uiUtilsInstance.createElement("div", { className: "flex justify-between mt-3" });
    const createdInfo = uiUtilsInstance.createElement("div", {
      className: "text-xs text-gray-500",
      textContent: `Created ${uiUtilsInstance.formatDate(project.created_at)}`
    });
    
    const actions = uiUtilsInstance.createElement("div", { className: "flex space-x-1" });
    
    // View button
    const viewBtn = uiUtilsInstance.createElement("button", {
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
      onclick: () => this.onViewProject(project.id)
    });
    
    // Delete button
    const deleteBtn = uiUtilsInstance.createElement("button", {
      className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                   a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6
                   m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      `,
      onclick: () => this.confirmDelete(project)
    });
    
    actions.appendChild(viewBtn);
    actions.appendChild(deleteBtn);
    footer.appendChild(createdInfo);
    footer.appendChild(actions);
    card.appendChild(footer);
    
    return card;
  }

  confirmDelete(project) {
    ModalManager.confirmAction({
      title: "Delete Project",
      message: `Are you sure you want to delete "${project.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        window.projectManager?.deleteProject(project.id)
          .then(() => {
            uiUtilsInstance.showNotification("Project deleted", "success");
            window.projectManager?.loadProjects();
          })
          .catch(err => {
            console.error("Error deleting project:", err);
            uiUtilsInstance.showNotification("Failed to delete project", "error");
          });
      }
    });
  }

  bindFilterEvents() {
    const filterButtons = document.querySelectorAll('.project-filter-btn');
    filterButtons.forEach(button => {
      button.addEventListener('click', () => {
        filterButtons.forEach(btn => {
          btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
          btn.classList.add('text-gray-600');
        });
        button.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        button.classList.remove('text-gray-600');
        
        const filter = button.dataset.filter;
        window.projectManager?.loadProjects(filter);
      });
    });
  }
}

// Export the ProjectListComponent class
module.exports = ProjectListComponent;

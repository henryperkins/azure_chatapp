/**
 * projectDashboard.js
 *
 * Coordinates project dashboard components and state.
 *
 * ## Dependencies:
 * - window.auth: Authentication module.
 * - window.projectManager: Project management API.
 * - window.app: App-level notifications and UI helpers.
 * - window.ProjectListComponent: Renders the project list.
 * - window.ProjectDetailsComponent: Renders project details.
 * - window.eventHandlers: Utility for debouncing.
 * - window.DependencySystem: Optional dependency registration.
 * - document, fetch, URL, URLSearchParams, CustomEvent: Browser built-ins.
 */

// Track dashboard components and state
const components = {
  projectList: null,
  projectDetails: null
};

const dashboardState = {
  currentView: null,      // 'list' or 'details'
  currentProject: null    // Project ID or null
};

/**
 * Loads the project list from the backend.
 * Debounced version is assigned to the component after creation.
 */
const loadProjectList = () => {
  if (window.auth?.isAuthenticated() && window.projectManager?.loadProjects) {
    window.projectManager.loadProjects('all');
  }
};

/**
 * Initializes the project dashboard.
 * Ensures authentication, loads HTML, initializes components, and sets up event listeners.
 *
 * @returns {Promise<boolean>} Resolves true if initialized, false if not authenticated or failed.
 */
async function init() {
  // Prevent multiple initializations
  if (window.projectDashboardInitialized) {
    console.log('[projectDashboard] Already initialized.');
    return true;
  }

  window.projectDashboardInitialized = true;
  console.log('[projectDashboard] Initializing...');

  try {
    // Wait for authentication if not ready
    if (!window.auth?.isAuthenticated()) {
      console.log('[projectDashboard] Not authenticated yet, waiting for auth...');

      if (!window.auth?.isReady()) {
        console.log('[projectDashboard] Auth module not ready, waiting for initialization...');
        await new Promise(resolve => {
          const authReadyHandler = (event) => {
            window.auth.AuthBus.removeEventListener('authReady', authReadyHandler);
            resolve();
          };
          window.auth.AuthBus.addEventListener('authReady', authReadyHandler);
          setTimeout(resolve, 5000); // Fallback timeout
        });
      }

      if (!window.auth?.isAuthenticated()) {
        console.log('[projectDashboard] Auth ready but not authenticated, waiting for login...');
        showLoginRequiredMessage();
        return false;
      }
    }

    console.log('[projectDashboard] Authentication confirmed, proceeding with initialization...');

    // Wait for DOM ready
    if (document.readyState === 'loading') {
      await new Promise(resolve =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true })
      );
    }

    // Load project list HTML and initialize components
    await loadProjectListHtml();
    await initializeComponents();

    // Show initial view based on URL or localStorage
    processUrlParameters();

    // Set up event listeners for dashboard events
    setupEventListeners();

    // Dispatch dashboard initialized event
    document.dispatchEvent(
      new CustomEvent('projectDashboardInitializedEvent', { detail: { success: true } })
    );

    console.log('[projectDashboard] Initialization complete.');
    return true;
  } catch (error) {
    console.error('[projectDashboard] Initialization failed:', error);
    window.app?.showNotification('Dashboard initialization failed', 'error');
    window.projectDashboardInitialized = false;
    document.dispatchEvent(
      new CustomEvent('projectDashboardInitializedEvent', { detail: { success: false, error } })
    );
    return false;
  }
}

/**
 * Shows a login required message and hides dashboard views.
 */
function showLoginRequiredMessage() {
  const loginMessage = document.getElementById('loginRequiredMessage');
  if (loginMessage) {
    loginMessage.classList.remove('hidden');
  }
  const projectViews = document.querySelectorAll('#projectListView, #projectDetailsView');
  projectViews.forEach(view => view.classList.add('hidden'));
}

/**
 * Loads the project list HTML into #projectListView if not already present.
 * @returns {Promise<void>}
 * @throws {Error} If the container is missing or fetch fails.
 */
async function loadProjectListHtml() {
  const container = document.getElementById('projectListView');
  if (!container) {
    console.error('[projectDashboard] projectListView container not found in DOM.');
    throw new Error('Missing projectListView container');
  }

  // Avoid reloading if already present
  if (container.querySelector('#projectList')) {
    console.log('[projectDashboard] project_list.html seems already loaded.');
    return;
  }

  console.log('[projectDashboard] Loading project_list.html...');
  try {
    const response = await fetch('/static/html/project_list.html');
    if (!response.ok) {
      console.error('[projectDashboard] Failed to load project_list.html. Status:', response.status);
      container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
      throw new Error("HTTP " + response.status);
    }

    const html = await response.text();
    container.innerHTML = html;
    console.log('[projectDashboard] project_list.html loaded successfully.');
  } catch (err) {
    console.error('[projectDashboard] Error fetching project_list.html:', err);
    container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
    throw err;
  }
}

/**
 * Loads the project details HTML into #projectDetailsView if not already present.
 * @returns {Promise<void>}
 * @throws {Error} If the container is missing or fetch fails.
 */
async function loadProjectDetailsHtml() {
  const container = document.getElementById('projectDetailsView');
  if (!container) {
    console.error('[projectDashboard] projectDetailsView container not found in DOM.');
    throw new Error('Missing projectDetailsView container');
  }

  // Avoid reloading if already present
  if (container.querySelector('#detailsTab')) {
    console.log('[projectDashboard] project_details.html is already loaded.');
    return;
  }

  console.log('[projectDashboard] Loading project_details.html...');
  try {
    const response = await fetch('/static/html/project_details.html');
    if (!response.ok) {
      console.error('[projectDashboard] Failed to load project_details.html. Status:', response.status);
      container.innerHTML = '<p class="text-error text-center">Error loading project details UI.</p>';
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    container.innerHTML = html;
    console.log('[projectDashboard] project_details.html loaded successfully.');
  } catch (err) {
    console.error('[projectDashboard] Error fetching project_details.html:', err);
    container.innerHTML = '<p class="text-error text-center">Error loading project details UI.</p>';
    throw err;
  }
}

/**
 * Initializes dashboard components (list and details).
 * @returns {Promise<void>}
 */
async function initializeComponents() {
  console.log('[projectDashboard] Initializing components...');

  // Project list component
  if (window.ProjectListComponent) {
    components.projectList = new window.ProjectListComponent({
      elementId: 'projectList',
      onViewProject: handleViewProject
    });
    // Assign debounced load after construction
    components.projectList.load = window.eventHandlers.debounce(loadProjectList, 100);
    console.log('[projectDashboard] ProjectListComponent created.');
  } else {
    console.error('[projectDashboard] ProjectListComponent not found on window.');
  }

  // Project details component
  if (window.ProjectDetailsComponent) {
    components.projectDetails = new window.ProjectDetailsComponent({
      onBack: handleBackToList
    });
    console.log('[projectDashboard] ProjectDetailsComponent created.');
  } else {
    console.error('[projectDashboard] ProjectDetailsComponent not found on window.');
  }

  console.log('[projectDashboard] Components initialized.');
}

/**
 * Processes URL parameters and localStorage to determine initial dashboard view.
 */
function processUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  let projectId = urlParams.get('project');

  // Optionally restore last selected project from localStorage
  if (!projectId) {
    projectId = localStorage.getItem('selectedProjectId');
  }

  if (projectId) {
    showProjectDetails(projectId);
  } else {
    showProjectList();
  }
}

/**
 * Sets up global event listeners for dashboard events and navigation.
 */
function setupEventListeners() {
  // Project events
  document.addEventListener('projectsLoaded', handleProjectsLoaded);
  document.addEventListener('projectLoaded', handleProjectLoaded);
  document.addEventListener('projectStatsLoaded', handleProjectStatsLoaded);
  document.addEventListener('projectFilesLoaded', handleFilesLoaded);
  document.addEventListener('projectArtifactsLoaded', handleArtifactsLoaded);
  document.addEventListener('projectNotFound', handleProjectNotFound);

  // URL navigation
  window.addEventListener('popstate', handlePopState);

  // Auth state changes
  if (window.auth?.AuthBus) {
    window.auth.AuthBus.addEventListener('authStateChange', handleAuthStateChange);
  }
}

/**
 * Handles browser navigation (back/forward) by re-processing URL parameters.
 */
function handlePopState() {
  processUrlParameters();
}

/**
 * Shows the project list view and hides details.
 */
function showProjectList() {
  dashboardState.currentView = 'list';
  dashboardState.currentProject = null;

  // Aggressively clear localStorage for robustness
  localStorage.removeItem('selectedProjectId');

  // DOM visibility toggle - ENFORCE correct state
  const listView = document.getElementById('projectListView');
  const detailsView = document.getElementById('projectDetailsView');

  // Make absolutely sure only one view is visible
  if (listView) {
    listView.classList.remove('hidden');
    listView.style.display = ''; // Reset any inline display style
  }
  if (detailsView) {
    detailsView.classList.add('hidden');
    detailsView.style.display = 'none'; // Force hide with inline style
  }

  // Components visibility control
  if (components.projectDetails) {
    components.projectDetails.hide();
  }
  if (components.projectList) {
    components.projectList.show();
  }

  // Update URL (remove project param)
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.delete('project');
  window.history.pushState({}, '', currentUrl.toString());

  // Load projects (debounced if available)
  if (components.projectList?.load) {
    components.projectList.load();
  } else {
    loadProjectList();
  }
}

/**
 * Shows the project details view for a given project.
 * Loads HTML, updates URL, and triggers data load.
 *
 * @param {string} projectId - The project ID to show.
 * @returns {Promise<boolean>} Resolves true if successful, false if error.
 */
async function showProjectDetails(projectId) {
  if (!projectId) {
    console.error('[projectDashboard] showProjectDetails called without a projectId.');
    // If no project id, forcibly clear any stale selectedProjectId and show list
    localStorage.removeItem('selectedProjectId');
    showProjectList();
    return false;
  }

  dashboardState.currentView = 'details';
  dashboardState.currentProject = projectId;

  try {
    await loadProjectDetailsHtml();
  } catch (err) {
    console.error('[projectDashboard] Error loading project details page:', err);
    window.app?.showNotification('Error loading project details UI', 'error');
    localStorage.removeItem('selectedProjectId');
    showProjectList();
    return false;
  }

  if (components.projectList) {
    components.projectList.hide();
  }
  if (components.projectDetails) {
    components.projectDetails.show();
  }

  // Update URL and localStorage
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('project', projectId);
  window.history.pushState({}, '', currentUrl.toString());
  localStorage.setItem('selectedProjectId', projectId);

  // Load project data
  if (window.auth?.isAuthenticated() && window.projectManager?.loadProjectDetails) {
    window.projectManager
      .loadProjectDetails(projectId)
      .then(project => {
        // If project load returns null/undefined, treat as not found
        if (!project) {
          console.warn('[projectDashboard] Project not found after details load');
          window.app?.showNotification('Project not found', 'error');
          localStorage.removeItem('selectedProjectId');
          showProjectList();
        }
      })
      .catch((error) => {
        console.error('[projectDashboard] Failed to load project details:', error);
        window.app?.showNotification('Failed to load project details', 'error');
        localStorage.removeItem('selectedProjectId');
        showProjectList();
      });
  } else {
    localStorage.removeItem('selectedProjectId');
    showProjectList();
  }

  return true;
}

/**
 * Callback for ProjectListComponent when a project is selected.
 * @param {string} projectId - The selected project ID.
 */
function handleViewProject(projectId) {
  showProjectDetails(projectId);
}

/**
 * Callback for ProjectDetailsComponent when user navigates back.
 */
function handleBackToList() {
  showProjectList();
}

/**
 * Handles authentication state changes.
 * Shows/hides dashboard views and triggers project list reload if needed.
 * @param {CustomEvent} event - The auth state change event.
 */
function handleAuthStateChange(event) {
  const { authenticated } = event.detail || {};

  requestAnimationFrame(() => {
    const loginRequiredMessage = document.getElementById('loginRequiredMessage');
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');

    if (!authenticated) {
      if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
      if (projectListView) projectListView.classList.add('hidden');
      if (projectDetailsView) projectDetailsView.classList.add('hidden');
    } else {
      if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');

      if (dashboardState.currentView === 'details' && dashboardState.currentProject) {
        if (projectListView) projectListView.classList.add('hidden');
        if (projectDetailsView) projectDetailsView.classList.remove('hidden');
      } else {
        if (projectListView) projectListView.classList.remove('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');

        // Load projects if list component is available
        if (dashboardState.currentView === 'list') {
          if (components.projectList?.load) {
            components.projectList.load();
          } else {
            loadProjectList();
          }
        }
      }
    }
  });
}

/**
 * Handles the 'projectsLoaded' event.
 * Renders the project list or shows an error.
 * @param {CustomEvent} event
 */
function handleProjectsLoaded(event) {
  const { projects = [], error = false, message } = event.detail || {};

  if (error) {
    console.error('[projectDashboard] projectsLoaded event with error:', message);
    requestAnimationFrame(() => {
      if (components.projectList?._showErrorState) {
        components.projectList._showErrorState(message || 'Failed to load projects');
      }
    });
    return;
  }

  requestAnimationFrame(() => {
    if (components.projectList) {
      console.log("[projectDashboard] Rendering " + projects.length + " project(s).");
      components.projectList.renderProjects(projects);
    } else {
      console.warn('[projectDashboard] ProjectListComponent not available to render projects.');
    }
  });
}

/**
 * Handles the 'projectLoaded' event.
 * Renders the project details.
 * @param {CustomEvent} event
 */
function handleProjectLoaded(event) {
  const project = event.detail;
  dashboardState.currentProject = project?.id || null;

  requestAnimationFrame(() => {
    if (components.projectDetails) {
      components.projectDetails.renderProject(project);
    }
  });
}

/**
 * Handles the 'projectStatsLoaded' event.
 * Renders project statistics.
 * @param {CustomEvent} event
 */
function handleProjectStatsLoaded(event) {
  const stats = event.detail;
  requestAnimationFrame(() => {
    if (components.projectDetails) {
      components.projectDetails.renderStats(stats);
    }
  });
}

/**
 * Handles the 'projectFilesLoaded' event.
 * Renders project files.
 * @param {CustomEvent} event
 */
function handleFilesLoaded(event) {
  requestAnimationFrame(() => {
    if (components.projectDetails) {
      components.projectDetails.renderFiles(event.detail.files);
    }
  });
}

/**
 * Handles the 'projectArtifactsLoaded' event.
 * Renders project artifacts.
 * @param {CustomEvent} event
 */
function handleArtifactsLoaded(event) {
  requestAnimationFrame(() => {
    if (components.projectDetails?.renderArtifacts) {
      components.projectDetails.renderArtifacts(event.detail.artifacts);
    }
  });
}

/**
 * Handles the 'projectNotFound' event.
 * Shows a notification and returns to the project list.
 * @param {CustomEvent} event
 */
function handleProjectNotFound(event) {
  const { projectId } = event.detail || {};
  console.warn("[projectDashboard] Project not found: " + projectId);

  dashboardState.currentProject = null;
  localStorage.removeItem('selectedProjectId');

  // Force reset the UI
  const detailsView = document.getElementById('projectDetailsView');
  if (detailsView) {
    detailsView.classList.add('hidden');
    detailsView.style.display = 'none';
  }

  window.app?.showNotification('The requested project was not found', 'error');
  showProjectList();
}

// Export the dashboard API to the global window object
window.projectDashboard = {
  init,
  showProjectList,
  showProjectDetails
};

// Register with DependencySystem if available
if (window.DependencySystem?.register) {
  window.DependencySystem.register("projectDashboard", window.projectDashboard);
}

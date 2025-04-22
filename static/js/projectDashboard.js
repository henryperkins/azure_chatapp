/**
 * projectDashboard.js
 * Coordinates project dashboard components and state
 */

// Locally track our components and state
const components = {
  projectList: null,
  projectDetails: null
};

const dashboardState = {
  currentView: null,
  currentProject: null
};

/**
 * Load projects list with debounce to prevent multiple calls
 */
const loadProjectList = window.eventHandlers.debounce(() => {
  // FIXED: Use direct auth method for consistency rather than app.state
  if (window.auth?.isAuthenticated() && window.projectManager?.loadProjects) {
    window.projectManager.loadProjects('all');
  }
}, 100);

async function init() {
  // Prevent multiple initializations
  if (window.projectDashboardInitialized) {
    console.log('[projectDashboard] Already initialized.');
    return true;
  }

  window.projectDashboardInitialized = true; // Set flag early
  console.log('[projectDashboard] Initializing...');

  try {
    // Ensure authentication is established before proceeding
    if (!window.auth?.isAuthenticated()) {
      console.log('[projectDashboard] Not authenticated yet, waiting for auth...');

      // Check if auth module is still initializing
      if (!window.auth?.isReady()) {
        console.log('[projectDashboard] Auth module not ready, waiting for initialization...');
        await new Promise(resolve => {
          const authReadyHandler = (event) => {
            window.auth.AuthBus.removeEventListener('authReady', authReadyHandler);
            resolve();
          };
          window.auth.AuthBus.addEventListener('authReady', authReadyHandler);

          // Safety timeout in case event never fires
          setTimeout(resolve, 5000);
        });
      }

      // If still not authenticated after auth is ready, wait for auth state change
      if (!window.auth?.isAuthenticated()) {
        console.log('[projectDashboard] Auth ready but not authenticated, waiting for login...');
        // Handle non-authenticated state (show login prompt, etc.)
        showLoginRequiredMessage();
        return false;
      }
    }

    console.log('[projectDashboard] Authentication confirmed, proceeding with initialization...');

    // Ensure DOM is ready
    if (document.readyState === 'loading') {
      await new Promise(resolve =>
        document.addEventListener('DOMContentLoaded', resolve, { once: true })
      );
    }

    // Load HTML for the project list view
    await loadProjectListHtml();

    // Initialize components after HTML is loaded
    await initializeComponents();

    // Process URL parameters for initial view
    processUrlParameters();

    // Set up event listeners
    setupEventListeners();

    // Dispatch initialization event
    document.dispatchEvent(
      new CustomEvent('projectDashboardInitializedEvent', { detail: { success: true } })
    );

    console.log('[projectDashboard] Initialization complete.');
    return true;
  } catch (error) {
    console.error('[projectDashboard] Initialization failed:', error);
    window.app?.showNotification('Dashboard initialization failed', 'error');
    window.projectDashboardInitialized = false; // Reset flag on failure
    document.dispatchEvent(
      new CustomEvent('projectDashboardInitializedEvent', { detail: { success: false, error } })
    );
    return false;
  }
}

function showLoginRequiredMessage() {
  const loginMessage = document.getElementById('loginRequiredMessage');
  if (loginMessage) {
    loginMessage.classList.remove('hidden');
  }
  const projectViews = document.querySelectorAll('#projectListView, #projectDetailsView');
  projectViews.forEach(view => view.classList.add('hidden'));
}

/**
 * Loads the project_list.html content if not already present
 */
async function loadProjectListHtml() {
  const container = document.getElementById('projectListView');
  if (!container) {
    console.error('[projectDashboard] projectListView container not found in DOM.');
    throw new Error('Missing projectListView container');
  }

  // Avoid reloading if there's already a #projectList element
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
      throw new Error(`HTTP ${response.status}`);
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
 * Initialize individual dashboard components
 */
async function initializeComponents() {
  console.log('[projectDashboard] Initializing components...');

  // Create project list component if class is available
  if (window.ProjectListComponent) {
    components.projectList = new window.ProjectListComponent({
      elementId: 'projectList', // Must match element in project_list.html
      onViewProject: handleViewProject
    });
    console.log('[projectDashboard] ProjectListComponent created.');
  } else {
    console.error('[projectDashboard] ProjectListComponent not found on window.');
  }

  // Create project details component if available
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
 * Interpret URL parameters to show the correct initial view
 */
function processUrlParameters() {
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('project');

  if (projectId) {
    showProjectDetails(projectId);
  } else {
    showProjectList();
  }
}

/**
 * Sets up global dashboard event listeners
 */
function setupEventListeners() {
  // Authentication state changes
  if (window.auth?.AuthBus) {
    window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
  }

  // Project events
  document.addEventListener('projectsLoaded', handleProjectsLoaded);
  document.addEventListener('projectLoaded', handleProjectLoaded);
  document.addEventListener('projectStatsLoaded', handleProjectStatsLoaded);
  document.addEventListener('projectFilesLoaded', handleFilesLoaded);
  document.addEventListener('projectArtifactsLoaded', handleArtifactsLoaded);
  document.addEventListener('projectNotFound', handleProjectNotFound);

  // URL navigation
  window.addEventListener('popstate', handlePopState);
}

/**
 * Handle popstate (back/forward) by re-checking URL params
 */
function handlePopState() {
  processUrlParameters();
}

/**
 * Show the project list view
 */
function showProjectList() {
  dashboardState.currentView = 'list';
  dashboardState.currentProject = null;

  if (components.projectDetails) {
    components.projectDetails.hide();
  }
  if (components.projectList) {
    components.projectList.show();
  }

  // Update URL without triggering a full reload
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.delete('project');
  window.history.pushState({}, '', currentUrl.toString());

  // Load projects if authenticated - using debounced function
  loadProjectList();
}

/**
 * Show the project details view for a given project
 */
function showProjectDetails(projectId) {
  if (!projectId) {
    console.error('[projectDashboard] showProjectDetails called without a projectId.');
    return false;
  }

  dashboardState.currentView = 'details';
  dashboardState.currentProject = projectId;

  if (components.projectList) {
    components.projectList.hide();
  }
  if (components.projectDetails) {
    components.projectDetails.show();
  }

  // Update URL param
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.set('project', projectId);
  window.history.pushState({}, '', currentUrl.toString());

  // Load project details
  if (window.auth?.isAuthenticated() && window.projectManager?.loadProjectDetails) {
    window.projectManager
      .loadProjectDetails(projectId)
      .catch((error) => {
        console.error('[projectDashboard] Failed to load project details:', error);
        window.app?.showNotification('Failed to load project details', 'error');
        showProjectList();
      });
  } else {
    showProjectList();
  }

  return true;
}

/**
 * onViewProject callback used by ProjectListComponent
 */
function handleViewProject(projectId) {
  showProjectDetails(projectId);
}

/**
 * onBack callback used by ProjectDetailsComponent
 */
function handleBackToList() {
  showProjectList();
}

/**
 * Handle authentication state changes
 */
function handleAuthStateChange(event) {
  const { authenticated } = event.detail || {};

  // Batch DOM updates using requestAnimationFrame
  requestAnimationFrame(() => {
    const loginRequiredMessage = document.getElementById('loginRequiredMessage');
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');

    if (!authenticated) {
      // Hide project views, show login message
      if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
      if (projectListView) projectListView.classList.add('hidden');
      if (projectDetailsView) projectDetailsView.classList.add('hidden');
    } else {
      // Show appropriate dashboard view
      if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');

      if (dashboardState.currentView === 'details' && dashboardState.currentProject) {
        projectListView?.classList.add('hidden');
        projectDetailsView?.classList.remove('hidden');
      } else {
        projectListView?.classList.remove('hidden');
        projectDetailsView?.classList.add('hidden');

        // Only load projects if we're showing the list view
        if (dashboardState.currentView === 'list') {
          loadProjectList();
        }
      }
    }
  });
}

/**
 * Handle projectsLoaded event
 */
function handleProjectsLoaded(event) {
  const { projects = [], error = false, message } = event.detail || {};

  if (error) {
    console.error('[projectDashboard] projectsLoaded event with error:', message);
    // Batch error state update
    requestAnimationFrame(() => {
      if (components.projectList?._showErrorState) {
        components.projectList._showErrorState(message || 'Failed to load projects');
      }
    });
    return;
  }

  // Batch render updates using requestAnimationFrame
  requestAnimationFrame(() => {
    if (components.projectList) {
      console.log(`[projectDashboard] Rendering ${projects.length} project(s).`);
      components.projectList.renderProjects(projects);
    } else {
      console.warn('[projectDashboard] ProjectListComponent not available to render projects.');
    }
  });
}

/**
 * Handle single projectLoaded event
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
 * Handle projectStatsLoaded event
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
 * Handle projectFilesLoaded event
 */
function handleFilesLoaded(event) {
  requestAnimationFrame(() => {
    if (components.projectDetails) {
      components.projectDetails.renderFiles(event.detail.files);
    }
  });
}

/**
 * Handle projectArtifactsLoaded event
 */
function handleArtifactsLoaded(event) {
  requestAnimationFrame(() => {
    if (components.projectDetails?.renderArtifacts) {
      components.projectDetails.renderArtifacts(event.detail.artifacts);
    }
  });
}

/**
 * Handle projectNotFound event
 */
function handleProjectNotFound(event) {
  const { projectId } = event.detail || {};
  console.warn(`[projectDashboard] Project not found: ${projectId}`);

  dashboardState.currentProject = null;
  window.app?.showNotification('The requested project was not found', 'error');
  showProjectList();
}

// Export the dashboard to the global window object
window.projectDashboard = {
  init,
  showProjectList,
  showProjectDetails
};
DependencySystem.register('projectDashboard', window.projectDashboard);

/**
 * projectDashboard.js
 * Coordinates project dashboard components and state
 */

// Project dashboard components
const components = {
  projectList: null,
  projectDetails: null
};

// Dashboard state
const dashboardState = {
  currentView: null,
  currentProject: null
};

async function init() {
  // Prevent multiple initializations
  if (window.projectDashboardInitialized) {
    console.log('[projectDashboard] Already initialized.');
    return true;
  }
  window.projectDashboardInitialized = true; // Set flag early
  console.log('[projectDashboard] Initializing...');

  try {
    // Initialize components
    await initializeComponents(); // Wait for components including HTML loading

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

/**
 * Initialize dashboard components
 */
async function initializeComponents() {
  console.log('[projectDashboard] Initializing components...');
  // Ensure project_list.html is loaded BEFORE creating ProjectListComponent
  await loadProjectListHtml();

  // Now it's safe to create the list component
  if (window.ProjectListComponent) {
    components.projectList = new window.ProjectListComponent({
      elementId: 'projectList', // ID inside project_list.html
      onViewProject: handleViewProject
    });
    console.log('[projectDashboard] ProjectListComponent created.');
  } else {
    console.error('[projectDashboard] ProjectListComponent class not found.');
  }

  // Initialize details component
  if (window.ProjectDetailsComponent) {
    components.projectDetails = new window.ProjectDetailsComponent({
      onBack: handleBackToList
    });
    console.log('[projectDashboard] ProjectDetailsComponent created.');
  } else {
    console.error('[projectDashboard] ProjectDetailsComponent class not found.');
  }
  console.log('[projectDashboard] Components initialized.');
}

async function loadProjectListHtml() {
  const container = document.getElementById('projectListView');
  if (!container) {
    console.error('[projectDashboard] projectListView container not found in DOM.');
    return;
  }
  // Avoid reloading if already populated
  if (container.querySelector('#projectList')) {
    console.log('[projectDashboard] project_list.html seems already loaded.');
    return;
  }

  console.log('[projectDashboard] Loading project_list.html...');
  try {
    const response = await fetch('/static/html/project_list.html');
    if (response.ok) {
      const html = await response.text();
      container.innerHTML = html;
      console.log('[projectDashboard] project_list.html loaded successfully.');
    } else {
      console.error('[projectDashboard] Failed to load project_list.html. Status:', response.status);
      container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
    }
  } catch (err) {
    console.error('[projectDashboard] Error fetching project_list.html:', err);
    container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Authentication state
  window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);

  // Project events
  document.addEventListener('projectsLoaded', handleProjectsLoaded);
  document.addEventListener('projectLoaded', handleProjectLoaded);
  document.addEventListener('projectStatsLoaded', handleProjectStatsLoaded);
  document.addEventListener('projectFilesLoaded', handleFilesLoaded);
  document.addEventListener('projectArtifactsLoaded', handleArtifactsLoaded);
  document.addEventListener('projectNotFound', handleProjectNotFound);

  // Navigation
  window.addEventListener('popstate', handlePopState);
}

/**
 * Process URL parameters for initial view
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
 * Handle popstate (back/forward)
 */
function handlePopState() {
  processUrlParameters();
}

/**
 * Show project list view
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

  // Update URL without triggering popstate
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.delete('project');
  window.history.pushState({}, '', currentUrl.toString());

  // Load projects if authenticated
  if (window.app.state.isAuthenticated && window.projectManager?.loadProjects) {
    window.projectManager.loadProjects('all');
  }
}

/**
 * Show project details view
 */
function showProjectDetails(projectId) {
  if (!projectId) {
    console.error('Cannot show project details: No project ID provided');
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

  // Update URL without triggering popstate
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.set('project', projectId);
  window.history.pushState({}, '', currentUrl.toString());

  // Load project details
  if (window.app.state.isAuthenticated && window.projectManager?.loadProjectDetails) {
    window.projectManager.loadProjectDetails(projectId).catch(error => {
      console.error('Failed to load project details:', error);
      window.app?.showNotification('Failed to load project', 'error');
      showProjectList();
    });
  } else {
    showProjectList();
  }

  return true;
}

/**
 * Handle view project event
 */
function handleViewProject(projectId) {
  showProjectDetails(projectId);
}

/**
 * Handle back to list event
 */
function handleBackToList() {
  showProjectList();
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event) {
  const { authenticated } = event.detail || {};

  const loginRequiredMessage = document.getElementById('loginRequiredMessage');
  const projectListView = document.getElementById('projectListView');
  const projectDetailsView = document.getElementById('projectDetailsView');

  if (!authenticated) {
    // Not authenticated - show login message
    if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
    if (projectListView) projectListView.classList.add('hidden');
    if (projectDetailsView) projectDetailsView.classList.add('hidden');
  } else {
    // Authenticated - show current view
    if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');

    if (dashboardState.currentView === 'details' && dashboardState.currentProject) {
      if (projectListView) projectListView.classList.add('hidden');
      if (projectDetailsView) projectDetailsView.classList.remove('hidden');
    } else {
      if (projectListView) projectListView.classList.remove('hidden');
      if (projectDetailsView) projectDetailsView.classList.add('hidden');

      // Load projects
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects('all');
      }
    }
  }
}

/**
 * Handle projects loaded event
 */
function handleProjectsLoaded(event) {
  const { projects = [], error = false } = event.detail || {};

  if (error) {
    console.error('[projectDashboard] Received projectsLoaded event with error:', event.detail.message);
    if (components.projectList?._showErrorState) {
      components.projectList._showErrorState(event.detail.message || 'Failed to load projects');
    }
    return;
  }

  if (components.projectList) {
    console.log(`[projectDashboard] Rendering ${projects.length} projects.`);
    components.projectList.renderProjects(projects);
  } else {
    console.warn('[projectDashboard] ProjectListComponent not available to render projects.');
  }
}

/**
 * Handle single project loaded event
 */
function handleProjectLoaded(event) {
  const project = event.detail;
  dashboardState.currentProject = project?.id || null;

  if (components.projectDetails) {
    components.projectDetails.renderProject(project);
  }
}

/**
 * Handle project stats loaded event
 */
function handleProjectStatsLoaded(event) {
  const stats = event.detail;
  if (components.projectDetails) {
    components.projectDetails.renderStats(stats);
  }
}

/**
 * Handle project files loaded event
 */
function handleFilesLoaded(event) {
  if (components.projectDetails) {
    components.projectDetails.renderFiles(event.detail.files);
  }
}

/**
 * Handle artifacts loaded event
 */
function handleArtifactsLoaded(event) {
  if (components.projectDetails) {
    components.projectDetails.renderArtifacts?.(event.detail.artifacts);
  }
}

/**
 * Handle project not found event
 */
function handleProjectNotFound(event) {
  const { projectId } = event.detail;
  console.warn(`Project not found: ${projectId}`);

  dashboardState.currentProject = null;

  window.app?.showNotification('The requested project was not found', 'error');
  showProjectList();
}

// Export to window
window.projectDashboard = {
  init,
  showProjectList,
  showProjectDetails
};

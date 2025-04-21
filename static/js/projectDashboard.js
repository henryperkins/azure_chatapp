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

/**
 * Initialize the dashboard
 */
async function init() {
  try {
    // Initialize components
    await initializeComponents();

    // Process URL for initial view
    processUrlParameters();

    // Set up event listeners
    setupEventListeners();

    // Dispatch initialization event
    document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));

    return true;
  } catch (error) {
    console.error('Dashboard initialization failed:', error);
    window.app?.showNotification('Dashboard initialization failed', 'error');
    return false;
  }
}


/**
 * Initialize dashboard components
 */
async function initializeComponents() {
  await loadProjectListHtml();
  components.projectList = new window.ProjectListComponent({
    elementId: 'projectList',
    onViewProject: handleViewProject
  });

  components.projectDetails = new window.ProjectDetailsComponent({
    onBack: handleBackToList
  });
}

async function loadProjectListHtml() {
  const container = document.getElementById('projectListView');
  if (!container) return;
  try {
    const response = await fetch('/static/html/project_list.html');
    if (response.ok) {
      const html = await response.text();
      container.innerHTML = html;
    } else {
      console.warn('[projectDashboard] Failed to load project_list.html. Status:', response.status);
    }
  } catch (err) {
    console.error('[projectDashboard] Error loading project_list.html:', err);
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
 * Handle pop state events
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
 * Handle authentication state changes
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
  // Skip if event is from another source
  if (event.detail?.source && event.detail.source !== 'projectManager') {
    return;
  }

  const { projects = [], count = 0, filter = { type: 'all' }, error = false } = event.detail || {};

  if (components.projectList) {
    components.projectList.renderProjects(projects);
  }
}

/**
 * Handle project loaded event
 */
function handleProjectLoaded(event) {
  const project = event.detail;
  dashboardState.currentProject = project;

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
 * Handle files loaded event
 */
function handleFilesLoaded(event) {
  if (components.projectDetails) {
    components.projectDetails.renderFiles(event.detail.files);
  }
}

/**
 * Handle conversations loaded event
 */
function handleConversationsLoaded(event) {
  let conversations = [];

  if (Array.isArray(event.detail)) {
    conversations = event.detail;
  } else if (event.detail?.conversations) {
    conversations = event.detail.conversations;
  } else if (event.detail?.data?.conversations) {
    conversations = event.detail.data.conversations;
  }

  if (components.projectDetails) {
    components.projectDetails.renderConversations(conversations);
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

// Export showProjectsView for backward compatibility
window.showProjectsView = showProjectList;

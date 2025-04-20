/**
 * projectDashboard.js
 * Manages the project dashboard UI and coordinates components
 */

// Project dashboard components
const components = {
  projectList: null,
  projectDetails: null,
  knowledgeBase: null
};

// Dashboard state
const dashboardState = {
  currentView: null,
  currentProject: null,
  isInitialized: false,
  isInitializing: false
};

/**
 * Initialize the dashboard
 */
async function init() {
  // Prevent duplicate initialization
  if (dashboardState.isInitialized || dashboardState.isInitializing) {
    return dashboardState.isInitialized;
  }

  dashboardState.isInitializing = true;

  try {
    // Check authentication
    const isAuthenticated = await window.auth.checkAuth();

    // Create UI containers if needed
    ensureContainers();

    // Initialize components
    await initializeComponents();

    // Process URL for initial view
    processUrlParameters();

    // Set up event listeners
    setupEventListeners();

    // Mark as initialized
    dashboardState.isInitialized = true;
    dashboardState.isInitializing = false;

    // Dispatch initialization event
    document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));

    return true;
  } catch (error) {
    console.error('Dashboard initialization failed:', error);
    dashboardState.isInitializing = false;

    if (window.app?.showNotification) {
      window.app.showNotification('Dashboard initialization failed', 'error');
    }

    return false;
  }
}

/**
 * Ensure required containers exist
 */
function ensureContainers() {
  // Check for projectListView
  let projectListView = document.getElementById('projectListView');
  if (!projectListView) {
    projectListView = document.createElement('div');
    projectListView.id = 'projectListView';
    projectListView.className = 'flex-1 overflow-y-auto p-4 hidden';
    document.body.appendChild(projectListView);
  }

  // Check for projectDetailsView
  let projectDetailsView = document.getElementById('projectDetailsView');
  if (!projectDetailsView) {
    projectDetailsView = document.createElement('div');
    projectDetailsView.id = 'projectDetailsView';
    projectDetailsView.className = 'flex-1 overflow-y-auto p-4 hidden';
    document.body.appendChild(projectDetailsView);
  }

  // Check for login required message
  let loginRequiredMessage = document.getElementById('loginRequiredMessage');
  if (!loginRequiredMessage) {
    loginRequiredMessage = document.createElement('div');
    loginRequiredMessage.id = 'loginRequiredMessage';
    loginRequiredMessage.className = 'text-center py-10 text-gray-500 hidden';
    loginRequiredMessage.innerHTML = 'Please log in to view your projects';
    document.body.appendChild(loginRequiredMessage);
  }
}

/**
 * Initialize all dashboard components
 */
async function initializeComponents() {
  // Create project list component
  if (window.ProjectListComponent && !components.projectList) {
    components.projectList = new window.ProjectListComponent({
      elementId: 'projectList',
      onViewProject: handleViewProject
    });
  }

  // Create project details component
  if (window.ProjectDetailsComponent && !components.projectDetails) {
    components.projectDetails = new window.ProjectDetailsComponent({
      onBack: handleBackToList
    });
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Listen for authentication changes
  window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);

  // Listen for project-related events
  document.addEventListener('projectsLoaded', handleProjectsLoaded);
  document.addEventListener('projectLoaded', handleProjectLoaded);
  document.addEventListener('projectStatsLoaded', handleProjectStatsLoaded);
  document.addEventListener('projectFilesLoaded', handleFilesLoaded);
  document.addEventListener('projectConversationsLoaded', handleConversationsLoaded);
  document.addEventListener('projectArtifactsLoaded', handleArtifactsLoaded);
  document.addEventListener('projectNotFound', handleProjectNotFound);

  // Listen for navigation events
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
  window.auth.checkAuth().then(isAuthenticated => {
    if (isAuthenticated && window.projectManager?.loadProjects) {
      window.projectManager.loadProjects('all');
    }
  });
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
  window.auth.checkAuth().then(isAuthenticated => {
    if (isAuthenticated && window.projectManager?.loadProjectDetails) {
      window.projectManager.loadProjectDetails(projectId).catch(error => {
        console.error('Failed to load project details:', error);
        window.app?.showNotification('Failed to load project', 'error');
        showProjectList();
      });
    }
  });

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
  showProjectDetails,
  state: dashboardState,
  components
};

// Export showProjectsView for backward compatibility
window.showProjectsView = showProjectList;

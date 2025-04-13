/**
 * debug-project.js
 * -----------------
 * Debug utilities for diagnosing project loading and display issues
 * Adds instrumentation to track authentication and project loading
 */

(function() {
  // Set to false to disable debug output
  const DEBUG_ENABLED = true;
  const PREFIX = '[ProjectDebug]';

  // State tracking
  let authState = {
    checked: false,
    authenticated: false,
    lastCheckTime: null,
    username: null,
    authErrors: []
  };

  let projectLoadState = {
    attempts: 0,
    loaded: false,
    lastAttemptTime: null,
    projectsFound: 0,
    errors: []
  };

  // Debug logging function
  function log(message, data = null, type = 'log') {
    if (!DEBUG_ENABLED) return;

    const timestamp = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
    const prefix = `${PREFIX} [${timestamp}]`;

    if (data) {
      console[type](`${prefix} ${message}`, data);
    } else {
      console[type](`${prefix} ${message}`);
    }
  }

  // Export console commands for debugging
  window.debugProject = {
    // Check current state
    status() {
      console.group(`${PREFIX} Diagnostics Summary`);
      console.log(`Auth Checked: ${authState.checked}`);
      console.log(`Authenticated: ${authState.authenticated}`);
      console.log(`Username: ${authState.username || 'N/A'}`);
      console.log(`Last Auth Check: ${authState.lastCheckTime ? new Date(authState.lastCheckTime).toLocaleTimeString() : 'Never'}`);
      console.log(`Project Load Attempts: ${projectLoadState.attempts}`);
      console.log(`Projects Loaded: ${projectLoadState.loaded ? 'Yes' : 'No'}`);
      console.log(`Projects Found: ${projectLoadState.projectsFound}`);
      console.log(`Last Load Attempt: ${projectLoadState.lastAttemptTime ? new Date(projectLoadState.lastAttemptTime).toLocaleTimeString() : 'Never'}`);

      if (authState.authErrors.length > 0) {
        console.group('Auth Errors');
        authState.authErrors.forEach((err, i) => console.log(`${i+1}. ${err}`));
        console.groupEnd();
      }

      if (projectLoadState.errors.length > 0) {
        console.group('Project Load Errors');
        projectLoadState.errors.forEach((err, i) => console.log(`${i+1}. ${err}`));
        console.groupEnd();
      }

      console.groupEnd();
    },

    // Force refresh the project list
    forceRefreshProjects() {
      log('Forcing project list refresh...');
      if (window.projectListComponent && typeof window.projectListComponent.forceRender === 'function') {
        window.projectListComponent.forceRender();
        log('✅ Called projectListComponent.forceRender()');
      } else if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects('all')
          .then(projects => {
            log(`✅ Loaded ${projects?.length || 0} projects via projectManager`);
            // If projectListComponent exists, try to render them
            if (window.projectListComponent?.renderProjects) {
              window.projectListComponent.renderProjects(projects);
              log('✅ Called projectListComponent.renderProjects with projects');
            }
          })
          .catch(err => {
            log(`❌ Error in loadProjects: ${err.message}`, null, 'error');
            projectLoadState.errors.push(`${new Date().toISOString()}: ${err.message}`);
          });
      } else {
        log('❌ No project loading mechanism found', null, 'error');
      }
    },

    // Check DOM structure for project list
    checkProjectListDOM() {
      const projectListView = document.getElementById('projectListView');
      const projectList = document.getElementById('projectList');

      console.group(`${PREFIX} DOM Structure Check`);
      console.log(`projectListView exists: ${!!projectListView}`);
      console.log(`projectListView hidden: ${projectListView ? projectListView.classList.contains('hidden') : 'N/A'}`);
      console.log(`projectList exists: ${!!projectList}`);
      console.log(`projectList children: ${projectList ? projectList.children.length : 0}`);

      if (projectListView) {
        console.group('projectListView CSS');
        console.log(`display: ${getComputedStyle(projectListView).display}`);
        console.log(`visibility: ${getComputedStyle(projectListView).visibility}`);
        console.log(`opacity: ${getComputedStyle(projectListView).opacity}`);
        console.log(`height: ${getComputedStyle(projectListView).height}`);
        console.log(`overflow: ${getComputedStyle(projectListView).overflow}`);
        console.groupEnd();
      }

      if (projectList) {
        console.log('Project list content:');
        Array.from(projectList.children).forEach((child, i) => {
          console.log(`${i+1}. ${child.tagName} - ${child.className} - ${child.textContent.substring(0, 30)}...`);
        });
      }
      console.groupEnd();
    },

    // Diagnose authentication
    checkAuth() {
      console.group(`${PREFIX} Authentication Check`);
      console.log(`window.auth exists: ${!!window.auth}`);
      console.log(`window.auth ready: ${window.auth?.isReady}`);

      if (window.auth?.isAuthenticated) {
        window.auth.isAuthenticated({forceVerify: true})
          .then(isAuth => {
            console.log(`Server auth check result: ${isAuth}`);
            console.groupEnd();
          })
          .catch(err => {
            console.error('Auth check error:', err);
            console.groupEnd();
          });
      } else {
        console.log('No auth.isAuthenticated method available');
        console.groupEnd();
      }
    },

    // Reset debugging state
    reset() {
      authState = {
        checked: false,
        authenticated: false,
        lastCheckTime: null,
        username: null,
        authErrors: []
      };

      projectLoadState = {
        attempts: 0,
        loaded: false,
        lastAttemptTime: null,
        projectsFound: 0,
        errors: []
      };

      log('Debug state reset');
    }
  };

  // Patch key project functions with instrumentation
  function instrumentProjectFunctions() {
    // Save original functions
    const originalLoadProjects = window.projectManager?.loadProjects;
    const originalRenderProjects = window.projectListComponent?.renderProjects;
    const originalIsAuthenticated = window.auth?.isAuthenticated;

    // Patch loadProjects if it exists
    if (originalLoadProjects) {
      window.projectManager.loadProjects = async function instrumentedLoadProjects(filter) {
        projectLoadState.attempts++;
        projectLoadState.lastAttemptTime = Date.now();
        log(`📋 loadProjects called with filter: ${filter}`);

        try {
          const result = await originalLoadProjects.call(this, filter);
          projectLoadState.projectsFound = result?.length || 0;
          projectLoadState.loaded = projectLoadState.projectsFound > 0;
          log(`📊 loadProjects result: ${projectLoadState.projectsFound} projects found`);
          return result;
        } catch (err) {
          projectLoadState.errors.push(`${new Date().toISOString()} loadProjects: ${err.message}`);
          log(`❌ loadProjects error: ${err.message}`, err, 'error');
          throw err;
        }
      };
      log('✅ Instrumented projectManager.loadProjects');
    }

    // Patch renderProjects if it exists
    if (originalRenderProjects) {
      window.projectListComponent.renderProjects = function instrumentedRenderProjects(projects) {
        log(`🎨 renderProjects called with ${projects?.length || 'unknown'} projects`);
        if (Array.isArray(projects)) {
          log(`Project IDs: ${projects.map(p => p.id || 'unknown').join(', ')}`);
        }

        try {
          const result = originalRenderProjects.call(this, projects);
          log('✅ renderProjects completed');

          // Check DOM after rendering
          setTimeout(() => {
            const projectList = document.getElementById('projectList');
            if (projectList) {
              log(`After render: projectList has ${projectList.children.length} children`);
            } else {
              log('❌ projectList element not found after rendering', null, 'warn');
            }
          }, 100);

          return result;
        } catch (err) {
          log(`❌ renderProjects error: ${err.message}`, err, 'error');
          projectLoadState.errors.push(`${new Date().toISOString()} renderProjects: ${err.message}`);
          throw err;
        }
      };
      log('✅ Instrumented projectListComponent.renderProjects');
    }

    // Patch isAuthenticated if it exists
    if (originalIsAuthenticated) {
      window.auth.isAuthenticated = async function instrumentedIsAuthenticated(options) {
        authState.lastCheckTime = Date.now();
        authState.checked = true;
        log(`🔒 isAuthenticated called with options: ${JSON.stringify(options || {})}`);

        try {
          const result = await originalIsAuthenticated.call(this, options);
          authState.authenticated = result;
          log(`🔑 Auth result: ${result}`);
          return result;
        } catch (err) {
          authState.authErrors.push(`${new Date().toISOString()}: ${err.message}`);
          log(`❌ isAuthenticated error: ${err.message}`, err, 'error');
          throw err;
        }
      };
      log('✅ Instrumented auth.isAuthenticated');
    }
  }

  // Listen for key events
  function setupEventListeners() {
    // Monitor auth state changes
    document.addEventListener('authStateChanged', (e) => {
      const {authenticated, username} = e.detail || {};
      log(`🔄 authStateChanged event: ${authenticated ? 'authenticated' : 'not authenticated'}`);

      authState.authenticated = authenticated;
      authState.username = username;
      authState.lastCheckTime = Date.now();
    });

    // Monitor projectsLoaded events
    document.addEventListener('projectsLoaded', (e) => {
      const projects = e.detail?.data?.projects || e.detail?.projects || [];
      const filter = e.detail?.data?.filter || e.detail?.filter || 'unknown';
      const error = e.detail?.data?.error || e.detail?.error;

      log(`📚 projectsLoaded event: ${projects.length} projects with filter ${filter.type || filter}`);
      if (error) {
        log(`❌ projectsLoaded error: ${error}`, null, 'error');
        projectLoadState.errors.push(`${new Date().toISOString()} projectsLoaded event error`);
      }

      projectLoadState.projectsFound = projects.length;
      projectLoadState.loaded = projects.length > 0;
    });

    // Debug mount state when project list view becomes visible
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.type === 'attributes' &&
            mutation.attributeName === 'class' &&
            mutation.target.id === 'projectListView') {
          const isHidden = mutation.target.classList.contains('hidden');
          log(`🔄 projectListView visibility changed: ${isHidden ? 'hidden' : 'visible'}`);

          if (!isHidden) {
            setTimeout(window.debugProject.checkProjectListDOM, 300);
          }
        }
      });
    });

    const projectListView = document.getElementById('projectListView');
    if (projectListView) {
      observer.observe(projectListView, { attributes: true });
      log('✅ Added observer to projectListView');
    }
  }

  // Initialize the debug module
  function initDebugModule() {
    log('🔧 Project Debug Module Initializing');

    // Wait for key components to load before instrumenting
    const checkComponentsLoaded = setInterval(() => {
      if (window.projectManager && window.auth && window.projectListComponent) {
        clearInterval(checkComponentsLoaded);
        instrumentProjectFunctions();
        setupEventListeners();
        log('✅ Debug module initialization complete');

        // Force a status check
        setTimeout(window.debugProject.status, 2000);
      }
    }, 500);

    // Safety timeout
    setTimeout(() => {
      clearInterval(checkComponentsLoaded);
      log('⚠️ Timed out waiting for components, partial instrumentation may have occurred', null, 'warn');
    }, 10000);
  }

  // Run initialization after the page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugModule);
  } else {
    initDebugModule();
  }

  log('Debug module loaded - Use window.debugProject to access diagnostic functions');
})();

/**
 * debug-project.js
 * -----------------
 * Debug utilities for diagnosing project loading and display issues.
 *
 * - Provides instrumentation to track authentication and project loading.
 * - Exports "window.debugProject" for on-demand debugging controls.
 * - Optionally logs all debug output (when DEBUG_ENABLED is true).
 */

(function () {
  // Toggle to enable/disable debug output
  const DEBUG_ENABLED = false;
  const PREFIX = '[ProjectDebug]';

  // Track authentication lifecycle
  let authState = {
    checked: false,
    authenticated: false,
    lastCheckTime: null,
    username: null,
    authErrors: []
  };

  // Track project loading lifecycle
  let projectLoadState = {
    attempts: 0,
    loaded: false,
    lastAttemptTime: null,
    projectsFound: 0,
    errors: []
  };

  /**
   * Log diagnostic messages if DEBUG_ENABLED is true.
   * @param {string} message - Description of the debug event.
   * @param {*} [data] - Optional data to include with the log.
   * @param {string} [type='log'] - Console method to use ('log', 'warn', 'error', etc.).
   */
  function log(message, data = null, type = 'log') {
    if (!DEBUG_ENABLED) return;

    const timestamp = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
    const prefix = `${PREFIX} [${timestamp}]`;
    if (data !== null) {
      console[type](`${prefix} ${message}`, data);
    } else {
      console[type](`${prefix} ${message}`);
    }
  }

  /**
   * Summarizes the current auth and project load states.
   */
  function status() {
    console.group(`${PREFIX} Diagnostics Summary`);
    console.log(`Auth Checked: ${authState.checked}`);
    console.log(`Authenticated: ${authState.authenticated}`);
    console.log(`Username: ${authState.username || 'N/A'}`);
    console.log(
      `Last Auth Check: ${authState.lastCheckTime
        ? new Date(authState.lastCheckTime).toLocaleTimeString()
        : 'Never'
      }`
    );
    console.log(`Project Load Attempts: ${projectLoadState.attempts}`);
    console.log(
      `Projects Loaded: ${projectLoadState.loaded ? 'Yes' : 'No'}`
    );
    console.log(`Projects Found: ${projectLoadState.projectsFound}`);
    console.log(
      `Last Load Attempt: ${projectLoadState.lastAttemptTime
        ? new Date(projectLoadState.lastAttemptTime).toLocaleTimeString()
        : 'Never'
      }`
    );

    if (authState.authErrors.length > 0) {
      console.group('Auth Errors');
      authState.authErrors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
      console.groupEnd();
    }

    if (projectLoadState.errors.length > 0) {
      console.group('Project Load Errors');
      projectLoadState.errors.forEach((err, i) =>
        console.log(`${i + 1}. ${err}`)
      );
      console.groupEnd();
    }
    console.groupEnd();
  }

  /**
   * Forces a manual refresh of the project list.
   * Attempts to call forceRender or loadProjects if available.
   */
  function forceRefreshProjects() {
    log('Forcing project list refresh...');
    if (window.projectListComponent && typeof window.projectListComponent.forceRender === 'function') {
      window.projectListComponent.forceRender();
      log('✅ Called projectListComponent.forceRender()');
    } else if (window.projectManager?.loadProjects) {
      window.projectManager
        .loadProjects('all')
        .then((projects) => {
          log(`✅ Loaded ${projects?.length || 0} projects via projectManager`);
          if (window.projectListComponent?.renderProjects) {
            window.projectListComponent.renderProjects(projects);
            log('✅ Called projectListComponent.renderProjects with projects');
          }
        })
        .catch((err) => {
          log(`❌ Error in loadProjects: ${err.message}`, null, 'error');
          projectLoadState.errors.push(`${new Date().toISOString()}: ${err.message}`);
        });
    } else {
      log('❌ No project loading mechanism found', null, 'error');
    }
  }

  /**
   * Checks the DOM structure for the project list and logs details.
   */
  function checkProjectListDOM() {
    const projectListView = document.getElementById('projectListView');
    const projectList = document.getElementById('projectList');

    console.group(`${PREFIX} DOM Structure Check`);
    console.log(`projectListView exists: ${!!projectListView}`);
    console.log(
      `projectListView hidden: ${projectListView ? projectListView.classList.contains('hidden') : 'N/A'
      }`
    );
    console.log(`projectList exists: ${!!projectList}`);
    console.log(`projectList children: ${projectList ? projectList.children.length : 0}`);

    if (projectListView) {
      console.group('projectListView CSS');
      const style = getComputedStyle(projectListView);
      console.log(`display: ${style.display}`);
      console.log(`visibility: ${style.visibility}`);
      console.log(`opacity: ${style.opacity}`);
      console.log(`height: ${style.height}`);
      console.log(`overflow: ${style.overflow}`);
      console.groupEnd();
    }

    if (projectList) {
      console.log('Project list content:');
      Array.from(projectList.children).forEach((child, i) => {
        console.log(
          `${i + 1}. ${child.tagName} - ${child.className} - ${child.textContent.substring(0, 30)
          }...`
        );
      });
    }
    console.groupEnd();
  }

  /**
   * Checks authentication readiness and logs relevant info.
   * Forces a server-side auth check if available.
   */
  function checkAuth() {
    console.group(`${PREFIX} Authentication Check`);
    console.log(`window.auth exists: ${!!window.auth}`);
    console.log(`window.auth ready: ${window.auth?.isReady}`);

    if (window.auth?.isAuthenticated) {
      window.auth
        .isAuthenticated({ forceVerify: true })
        .then((isAuth) => {
          console.log(`Server auth check result: ${isAuth}`);
          console.groupEnd();
        })
        .catch((err) => {
          console.error('Auth check error:', err);
          console.groupEnd();
        });
    } else {
      console.log('No auth.isAuthenticated method available');
      console.groupEnd();
    }
  }

  /**
   * Resets all debugging state to initial values.
   */
  function reset() {
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

  // Expose debugging commands
  window.debugProject = {
    status,
    forceRefreshProjects,
    checkProjectListDOM,
    checkAuth,
    reset
  };

  /**
   * Instruments key project functions by wrapping them with debug logic.
   */
  function instrumentProjectFunctions() {
    // Save references to original functions
    const originalLoadProjects = window.projectManager?.loadProjects;
    const originalRenderProjects = window.projectListComponent?.renderProjects;
    const originalIsAuthenticated = window.auth?.isAuthenticated;

    // Patch loadProjects
    if (originalLoadProjects) {
      window.projectManager.loadProjects = async function instrumentedLoadProjects(filter) {
        projectLoadState.attempts++;
        projectLoadState.lastAttemptTime = Date.now();
        log(`📋 loadProjects called with filter: ${filter}`);

        try {
          const result = await originalLoadProjects.call(this, filter);
          projectLoadState.projectsFound = result?.length || 0;
          projectLoadState.loaded = projectLoadState.projectsFound > 0;
          log(`📊 loadProjects result: ${projectLoadState.projectsFound} projects`);
          return result;
        } catch (err) {
          projectLoadState.errors.push(`${new Date().toISOString()} loadProjects: ${err.message}`);
          log(`❌ loadProjects error: ${err.message}`, err, 'error');
          throw err;
        }
      };
      log('✅ Instrumented projectManager.loadProjects');
    }

    // Patch renderProjects
    if (originalRenderProjects) {
      window.projectListComponent.renderProjects = function instrumentedRenderProjects(projects) {
        log(`🎨 renderProjects called with ${projects?.length || 0} projects`);

        try {
          const result = originalRenderProjects.call(this, projects);
          log('✅ renderProjects completed');

          // Check the DOM post-render
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
          projectLoadState.errors.push(`${new Date().toISOString()} renderProjects: ${err.message}`);
          log(`❌ renderProjects error: ${err.message}`, err, 'error');
          throw err;
        }
      };
      log('✅ Instrumented projectListComponent.renderProjects');
    }

    // Patch isAuthenticated
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

  /**
   * Sets up event listeners for authentication and project loading.
   */
  function setupEventListeners() {
    document.addEventListener('authStateChanged', (e) => {
      const { authenticated, username } = e.detail || {};
      log(`🔄 authStateChanged event: ${authenticated ? 'authenticated' : 'not authenticated'}`);

      authState.authenticated = authenticated;
      authState.username = username;
      authState.lastCheckTime = Date.now();
    });

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

    // Detect changes in "projectListView" visibility
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class' &&
          mutation.target.id === 'projectListView'
        ) {
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

  /**
   * Automatically initialize the debug module once the DOM is ready.
   */
  function initDebugModule() {
    log('🔧 Project Debug Module Initializing');

    // Instrument functions
    instrumentProjectFunctions();

    // Setup listeners
    setupEventListeners();

    // Log initial status after short delay
    setTimeout(status, 500);

    log('✅ Debug module initialization complete');
  }

  // Initialize either now or after DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugModule);
  } else {
    initDebugModule();
  }

  // Provide a final message about using debugProject
  log('Debug module loaded - Use window.debugProject.* for diagnostic functions');
})();

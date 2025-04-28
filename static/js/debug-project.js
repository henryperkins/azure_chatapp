/**
 * debug-project.js
 * Temporary debugging script to diagnose project list display issues
 */

(function() {
  // Wait for the app to be fully initialized before running debug hooks
  document.addEventListener('appInitialized', function debugInitHandler() {
    document.removeEventListener('appInitialized', debugInitHandler);
    runDebugHooks();
  });

  function runDebugHooks() {
    console.log("[DEBUG-PROJECT] Initializing project debugging...");

  // Check if we already have a project in localStorage
  const selectedProjectId = localStorage.getItem('selectedProjectId');
  console.log(`[DEBUG-PROJECT] selectedProjectId from localStorage: ${selectedProjectId}`);

  // Monitor response from API
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const [url, options] = args;

    if (url.includes('/api/projects') && !url.includes('/files') && !url.includes('/stats')) {
      console.log(`[DEBUG-PROJECT] Intercepted API call to ${url}`);

      return originalFetch.apply(this, args).then(async (response) => {
        const clone = response.clone();
        try {
          const data = await clone.json();
          console.log('[DEBUG-PROJECT] API Response:', {
            url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data: data
          });

          if (data && Array.isArray(data.projects)) {
            console.log(`[DEBUG-PROJECT] Found ${data.projects.length} projects`);

            // Log each project
            data.projects.forEach((p, i) => {
              console.log(`[DEBUG-PROJECT] Project ${i+1}:`, p);
            });
          } else {
            console.warn('[DEBUG-PROJECT] Invalid project response format:', data);
          }
        } catch (e) {
          console.error('[DEBUG-PROJECT] Error parsing response:', e);
        }
        return response;
      });
    }

    return originalFetch.apply(this, args);
  };

  // Ensure debug DOM checks run only after the project list is ready in the DOM
  document.addEventListener('projectListReady', () => {
    // Monitor projectsLoaded events
    document.addEventListener('projectsLoaded', function(e) {
      console.log('[DEBUG-PROJECT] projectsLoaded event fired with data:', e.detail);

      // Now it's guaranteed projectList is present
      const projectListElement = document.getElementById('projectList');
      if (projectListElement) {
        const cards = projectListElement.querySelectorAll('.project-card');
        console.log(`[DEBUG-PROJECT] Found ${cards.length} project cards rendered`);
      } else {
        console.error('[DEBUG-PROJECT] projectList element not found in DOM');
      }
    });

    // Directly test the API endpoint, but verify DOM rendering after both projectListReady and projectsLoaded
    setTimeout(() => {
      if (window.app?.state?.isAuthenticated) {
        console.log('[DEBUG-PROJECT] Authentication detected, directly testing API endpoint...');
        fetch('/api/projects?filter=all&skip=0&limit=100')
          .then(async response => {
            const clone = response.clone();
            try {
              console.log('[DEBUG-PROJECT] Direct API status:', response.status, response.statusText);
              const rawHeaders = {};
              response.headers.forEach((v, k) => { rawHeaders[k] = v; });
              console.log('[DEBUG-PROJECT] Direct API headers:', rawHeaders);

              const data = await clone.json();
              console.log('[DEBUG-PROJECT] Direct API response data:', data);

              if (data && Array.isArray(data.projects)) {
                console.log(`[DEBUG-PROJECT] Direct API: Found ${data.projects.length} projects`);

                // Only check DOM after both projectListReady and the next projectsLoaded event
                let readyFired = false;
                let projectsFired = false;
                function checkProjectCardRendered() {
                  setTimeout(() => {
                    if (data.projects.length > 0 && !document.querySelector('.project-card')) {
                      console.error('[DEBUG-PROJECT] API returns projects but none are rendered! DOM rendering issue detected');
                    }
                  }, 750);
                }
                document.addEventListener('projectListReady', function handler1() {
                  document.removeEventListener('projectListReady', handler1);
                  readyFired = true;
                  if (projectsFired) checkProjectCardRendered();
                });
                document.addEventListener('projectsLoaded', function handler2() {
                  document.removeEventListener('projectsLoaded', handler2);
                  projectsFired = true;
                  if (readyFired) checkProjectCardRendered();
                });
              } else {
                console.warn('[DEBUG-PROJECT] Invalid/unexpected project response format from direct API call');
              }
            } catch (e) {
              console.error('[DEBUG-PROJECT] Error directly testing API:', e);
            }
          })
          .catch(err => {
            console.error('[DEBUG-PROJECT] Direct API request failed:', err);
          });
      }
    }, 3000);
  });

  // Patch the ProjectListComponent.renderProjects method
  if (window.ProjectListComponent && window.ProjectListComponent.prototype) {
    const originalRenderProjects = window.ProjectListComponent.prototype.renderProjects;

    window.ProjectListComponent.prototype.renderProjects = function(data) {
      console.log('[DEBUG-PROJECT] renderProjects called with:', data);

      // Check if element exists
      if (!this.element) {
        console.error('[DEBUG-PROJECT] this.element is null in renderProjects');
      }

      // Call original method
      const result = originalRenderProjects.apply(this, arguments);

      // Check outcome
      setTimeout(() => {
        if (this.element) {
          console.log(`[DEBUG-PROJECT] After rendering, projectList contains: ${this.element.innerHTML.substring(0, 100)}...`);
          console.log(`[DEBUG-PROJECT] state.projects length: ${this.state?.projects?.length || 0}`);
        }
      }, 100);

      return result;
    };

    console.log('[DEBUG-PROJECT] Patched ProjectListComponent.renderProjects');
  } else {
    console.warn('[DEBUG-PROJECT] Could not patch ProjectListComponent.renderProjects - class not available');
  }

  // Add debugging to projectManager's loadProjects method
  if (window.projectManager) {
    const originalLoadProjects = window.projectManager.loadProjects;

    window.projectManager.loadProjects = function(filter) {
      console.log(`[DEBUG-PROJECT] projectManager.loadProjects called with filter: ${filter}`);
      console.log(`[DEBUG-PROJECT] Auth state: ${window.app?.state?.isAuthenticated}`);

      // Call original method
      return originalLoadProjects.apply(this, arguments)
        .then(projects => {
          console.log(`[DEBUG-PROJECT] projectManager.loadProjects returned ${projects?.length || 0} projects`);
          return projects;
        })
        .catch(err => {
          console.error('[DEBUG-PROJECT] projectManager.loadProjects error:', err);
          throw err;
        });
    };

    console.log('[DEBUG-PROJECT] Patched projectManager.loadProjects');
  } else {
    console.warn('[DEBUG-PROJECT] Could not patch projectManager.loadProjects - not available yet');

    // Add a listener for when it becomes available
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(() => {
        if (window.projectManager && window.projectManager.loadProjects) {
          console.log('[DEBUG-PROJECT] projectManager now available - adding debugging');

          const originalLoadProjects = window.projectManager.loadProjects;

          window.projectManager.loadProjects = function(filter) {
            console.log(`[DEBUG-PROJECT] projectManager.loadProjects called with filter: ${filter}`);

            // Call original method
            return originalLoadProjects.apply(this, arguments)
              .then(projects => {
                console.log(`[DEBUG-PROJECT] projectManager.loadProjects returned ${projects?.length || 0} projects`);
                return projects;
              })
              .catch(err => {
                console.error('[DEBUG-PROJECT] projectManager.loadProjects error:', err);
                throw err;
              });
          };
        }
      }, 1000);
    });
  }

  // Force a project list refresh
  document.addEventListener('appInitialized', function() {
    setTimeout(() => {
      if (window.app?.state?.isAuthenticated && window.projectManager?.loadProjects) {
        console.log('[DEBUG-PROJECT] App initialized and authenticated, forcing project list refresh');
        window.projectManager.loadProjects('all');
      }
    }, 2000);
  });

  console.log('[DEBUG-PROJECT] Debugging hooks installed');

  // Directly test the API endpoint
  setTimeout(() => {
    if (window.app?.state?.isAuthenticated) {
      console.log('[DEBUG-PROJECT] Authentication detected, directly testing API endpoint...');
      fetch('/api/projects?filter=all&skip=0&limit=100')
        .then(async response => {
          const clone = response.clone();
          try {
            console.log('[DEBUG-PROJECT] Direct API status:', response.status, response.statusText);
            const rawHeaders = {};
            response.headers.forEach((v, k) => { rawHeaders[k] = v; });
            console.log('[DEBUG-PROJECT] Direct API headers:', rawHeaders);

            const data = await clone.json();
            console.log('[DEBUG-PROJECT] Direct API response data:', data);

            if (data && Array.isArray(data.projects)) {
              console.log(`[DEBUG-PROJECT] Direct API: Found ${data.projects.length} projects`);
              if (data.projects.length > 0 && !document.querySelector('.project-card')) {
                console.error('[DEBUG-PROJECT] API returns projects but none are rendered! DOM rendering issue detected');
              }
            } else {
              console.warn('[DEBUG-PROJECT] Invalid/unexpected project response format from direct API call');
            }
          } catch (e) {
            console.error('[DEBUG-PROJECT] Error directly testing API:', e);
          }
        })
        .catch(err => {
          console.error('[DEBUG-PROJECT] Direct API request failed:', err);
        });
    }
  }, 3000);
  }
})();

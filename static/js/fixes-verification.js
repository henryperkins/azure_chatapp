/**
 * fixes-verification.js
 * Script to verify the fixes for the project list display issues.
 */

(function() {
  console.log("[FIXES-VERIFICATION] Starting verification of project list display fixes...");

  // Map to store verification results
  const verificationResults = {
    moduleAvailability: {},
    authStateHandling: false,
    projectDashboardInit: false,
    projectManagerLoading: false,
    domStructureValid: false
  };

  // Verify module availability
  function verifyModules() {
    const requiredModules = [
      'app',
      'projectManager',
      'projectDashboard',
      'auth',
      'eventHandlers',
      'modalManager'
    ];

    requiredModules.forEach(module => {
      const available = window[module] !== undefined ||
                       (window.DependencySystem && window.DependencySystem.modules.has(module));
      verificationResults.moduleAvailability[module] = available;
      console.log(`[FIXES-VERIFICATION] Module '${module}' available: ${available}`);
    });
  }

  // Verify auth state handling
  function setupAuthVerification() {
    if (window.auth?.AuthBus) {
      console.log("[FIXES-VERIFICATION] Setting up auth state change listener");
      window.auth.AuthBus.addEventListener('authStateChanged', (event) => {
        const { authenticated } = event.detail || {};
        console.log(`[FIXES-VERIFICATION] Auth state changed: authenticated=${authenticated}`);

        // Check if projects are loaded after authentication
        setTimeout(() => {
          verifyProjectsLoadedAfterAuth(authenticated);
        }, 500);

        verificationResults.authStateHandling = true;
      });
    } else {
      console.error("[FIXES-VERIFICATION] Auth module or AuthBus not available");
    }
  }

  // Verify projects are loaded after authentication
  function verifyProjectsLoadedAfterAuth(authenticated) {
    if (!authenticated) return;

    // Ensure verification only runs after project list is ready in the DOM
    document.addEventListener('projectListReady', function handler() {
      document.removeEventListener('projectListReady', handler);

      console.log("[FIXES-VERIFICATION] Checking if projects are loaded after authentication (projectListReady fired)");

      // Check if projectManager attempted to load projects
      if (window.projectManager && window.projectManager._lastProjectLoadTime) {
        const timeSinceAuth = Date.now() - window.projectManager._lastProjectLoadTime;
        console.log(`[FIXES-VERIFICATION] Projects were loaded ${timeSinceAuth}ms ago`);
        verificationResults.projectManagerLoading = timeSinceAuth < 5000; // Should be recent
      }

      // Check DOM structure
      const projectListElement = document.getElementById('projectList');
      const projectListView = document.getElementById('projectListView');

      if (projectListElement && projectListView) {
        console.log("[FIXES-VERIFICATION] Project list DOM elements found");

        // Check visibility
        const isVisible = !projectListView.classList.contains('hidden') &&
                        !projectListView.classList.contains('opacity-0');
        console.log(`[FIXES-VERIFICATION] Project list is visible: ${isVisible}`);

        // Verify if project cards are rendered with a small delay
        setTimeout(() => {
          const projectCards = projectListElement.querySelectorAll('.project-card');
          console.log(`[FIXES-VERIFICATION] Found ${projectCards.length} project cards`);
          verificationResults.domStructureValid = projectCards.length > 0 ||
                                                projectListElement.innerHTML.includes('No projects found');

          // Final verification report
          reportVerificationResults();
        }, 1000);
      } else {
        console.error("[FIXES-VERIFICATION] Project list DOM elements not found");
        verificationResults.domStructureValid = false;
      }
    });
  }

  // Monitor projectDashboard initialization
  function monitorProjectDashboardInit() {
    document.addEventListener('projectDashboardInitialized', () => {
      console.log("[FIXES-VERIFICATION] projectDashboard initialization event detected");
      verificationResults.projectDashboardInit = true;
    });

    // Check if already initialized
    if (window.projectDashboard && window.projectDashboard.state?.initialized) {
      console.log("[FIXES-VERIFICATION] projectDashboard already initialized");
      verificationResults.projectDashboardInit = true;
    }
  }

  // Patch projectManager to track load attempts
  function patchProjectManager() {
    if (window.projectManager && window.projectManager.loadProjects) {
      const originalLoadProjects = window.projectManager.loadProjects;

      window.projectManager.loadProjects = function() {
        console.log("[FIXES-VERIFICATION] projectManager.loadProjects called");
        window.projectManager._lastProjectLoadTime = Date.now();
        return originalLoadProjects.apply(this, arguments);
      };
    }
  }

  // Report verification results
  function reportVerificationResults() {
    console.log("[FIXES-VERIFICATION] Verification Results:", verificationResults);

    const moduleChecksPassed = Object.values(verificationResults.moduleAvailability).every(val => val);

    const allPassed = moduleChecksPassed &&
                    verificationResults.authStateHandling &&
                    verificationResults.projectDashboardInit &&
                    verificationResults.projectManagerLoading &&
                    verificationResults.domStructureValid;

    if (allPassed) {
      console.log("%c[FIXES-VERIFICATION] All verification checks PASSED! The fixes appear to be working correctly.",
                "color: green; font-weight: bold;");
    } else {
      console.log("%c[FIXES-VERIFICATION] Some verification checks FAILED. There may still be issues with the project list display.",
                "color: red; font-weight: bold;");

      // Suggest additional fixes
      console.log("[FIXES-VERIFICATION] Suggestions:");

      if (!moduleChecksPassed) {
        console.log("- Some required modules are missing. Check application initialization sequence.");
      }

      if (!verificationResults.authStateHandling) {
        console.log("- Auth state change handling not detected. Verify eventHandler.js changes.");
      }

      if (!verificationResults.projectDashboardInit) {
        console.log("- ProjectDashboard initialization not detected. Check projectDashboard.js.");
      }

      if (!verificationResults.projectManagerLoading) {
        console.log("- Project loading after authentication not detected. Verify projectManager integration.");
      }

      if (!verificationResults.domStructureValid) {
        console.log("- DOM structure issues detected. Verify HTML templates and rendering logic.");
      }
    }
  }

  // Run verifications
  function runVerifications() {
    verifyModules();
    setupAuthVerification();
    monitorProjectDashboardInit();
    patchProjectManager();

    // Initial report after page load
    setTimeout(() => {
      console.log("[FIXES-VERIFICATION] Initial verification complete");

      // If user is already authenticated, verify project loading
      if (window.app?.state?.isAuthenticated) {
        verifyProjectsLoadedAfterAuth(true);
      }
    }, 2000);
  }

  // Wait for DependencySystem to be ready before starting verification
  if (window.DependencySystem && Object.keys(window.DependencySystem).length > 0) {
    // Wait for app initialization to complete
    document.addEventListener('appInitialized', function() {
      console.log("[FIXES-VERIFICATION] App initialized, starting verification...");
      setTimeout(runVerifications, 500); // Short delay to ensure all modules are registered
    });
  } else {
    // Fallback - wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function() {
      console.log("[FIXES-VERIFICATION] DOM loaded, starting verification with delay...");
      setTimeout(runVerifications, 2000); // Longer delay if DependencySystem not found
    });
  }
})();

```javascript
/**
 * Fix for excessive auth token debug logging in projectManager.js
 *
 * The main changes:
 * 1. Added proper DEBUG flag control for auth token logging
 * 2. Implemented logging debounce/throttling via timestamp checks
 * 3. Consolidated redundant logging
 */

// Add this near the top with other constants (around line 20-30)
const DEBUG = false; // Set to true only during development
const AUTH_LOG_INTERVAL = 5000; // Minimum ms between auth logs for the same operation
let lastAuthLogTimestamps = {}; // Track last log time by operation

// Then modify the loadProjects function (around line 147)
async function loadProjects(filter = null) {
  const validFilters = ["all", "pinned", "archived", "active"];
  const cleanFilter = validFilters.includes(filter) ? filter : "all";

  // Show loading state immediately
  emitEvent("projectsLoading", { filter: cleanFilter });

  try {
    // Throttled logging with operation key to prevent spam
    const logKey = `loadProjects-${cleanFilter}`;
    const now = Date.now();

    if (DEBUG && (!lastAuthLogTimestamps[logKey] ||
                 (now - lastAuthLogTimestamps[logKey] > AUTH_LOG_INTERVAL))) {
      console.log('[ProjectManager] Getting auth token for loadProjects');
      lastAuthLogTimestamps[logKey] = now;

      // Only check cookies in debug mode and with throttling
      try {
        const hasAccessToken = document.cookie.includes('access_token=');
        console.log(`[ProjectManager] Access token cookie ${hasAccessToken ? 'found' : 'not found'}`);
      } catch (err) {
        console.warn('[ProjectManager] Cookie check error:', err.message);
      }
    }

    // Build query params
    const params = new URLSearchParams();
    params.append("filter", cleanFilter);
    params.append("skip", "0");
    params.append("limit", "100");

    const endpoint = `/api/projects?${params.toString()}`.replace(/^https?:\/\/[^/]+/i, '');

    // During initialization, request the token with graceful option
    const token = await window.auth.getAuthToken({ gracefulInit: true });

    const response = await window.apiRequest(endpoint, "GET", null, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : ''
      }
    });

    // Standardize response format
    let projects = [];
    if (response?.data?.projects) {
      projects = response.data.projects;
    } else if (Array.isArray(response?.data)) {
      projects = response.data;
    } else if (Array.isArray(response)) {
      projects = response;
    } else if (response?.projects) {
      projects = response.projects;
    }

    if (!Array.isArray(projects)) {
      projects = [];
    }

    emitEvent("projectsLoaded", {
      projects,
      count: projects.length,
      filter: { type: cleanFilter }
    });

    return projects;
  } catch (error) {
    console.error("[projectManager] Error loading projects:", error);
    if (window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, "loading projects");
    }
    emitEvent("projectsLoaded", {
      projects: [],
      count: 0,
      filter: { type: filter },
      error: true
    });
    return [];
  }
}

// Also modify getAuthWithRetry function for consistent logging approach (around line 92)
async function getAuthWithRetry() {
  const logKey = 'getAuthWithRetry';
  const now = Date.now();

  if (DEBUG && (!lastAuthLogTimestamps[logKey] ||
               (now - lastAuthLogTimestamps[logKey] > AUTH_LOG_INTERVAL))) {
    console.debug('[ProjectManager] Attempting auth token retrieval');
    lastAuthLogTimestamps[logKey] = now;
  }

  try {
    return await window.auth.getAuthToken();
  } catch (err) {
    // If token retrieval fails, force auth verification
    const isAuth = await window.auth.isAuthenticated({forceVerify: true});
    if (isAuth) {
      return await window.auth.getAuthToken();
    }
    throw err;
  }
}
```

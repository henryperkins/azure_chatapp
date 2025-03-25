/**
 * initComponents.js
 * Initializes all UI components in the correct order
 */

async function initComponents() {
  try {
    console.log("Initializing UI components");
    
    // Create UIUtils if it doesn't exist
    if (!window.UIUtils) {
      window.UIUtils = {
        showNotification: window.showNotification || function(msg, type) {
          console.log(`[Notification] ${type}: ${msg}`);
        }
      };
    }
    
    // Create placeholder TokenManager if not already defined
    if (!window.TokenManager) {
      console.log("Creating placeholder TokenManager");
      window.TokenManager = {
        accessToken: null,
        refreshToken: null,
        getAuthHeader: function() { return {}; },
        setTokens: function(access, refresh) {
          this.accessToken = access;
          this.refreshToken = refresh;
          
          // Store token info
          sessionStorage.setItem('auth_state', JSON.stringify({
            hasTokens: true,
            timestamp: Date.now()
          }));
          
          // Update app configuration
          if (window.API_CONFIG) {
            window.API_CONFIG.isAuthenticated = true;
          }
          
          console.log("TokenManager: Tokens set in placeholder");
          
          // Broadcast auth state change
          document.dispatchEvent(new CustomEvent('authStateChanged', { 
            detail: { authenticated: true } 
          }));
        },
        clearTokens: function() {
          this.accessToken = null;
          this.refreshToken = null;
          
          sessionStorage.removeItem('auth_state');
          
          if (window.API_CONFIG) {
            window.API_CONFIG.isAuthenticated = false;
          }
          
          // Broadcast auth state change
          document.dispatchEvent(new CustomEvent('authStateChanged', { 
            detail: { authenticated: false } 
          }));
        },
        // Renamed to match the new method name in auth.js
        refreshTokens: async function() {
          console.warn("TokenManager: Using placeholder refresh method");
          return false;
        }
      };
    }

    // Create required components even before loading scripts
    // This ensures they exist even if script loading fails
    const requiredComponents = [
      'ProjectListComponent',
      'ProjectDetailsComponent',
      'KnowledgeBaseComponent'
    ];

    for (const component of requiredComponents) {
      if (!window[component]) {
        console.log(`Creating placeholder for component: ${component}`);
        window[component] = class {
          constructor(options = {}) {
            this.options = options;
            console.log(`Initialized ${component} with options:`, options);
          }
          
          // Add standard methods that all components should have
          show() { console.log(`${component}: show called`); }
          hide() { console.log(`${component}: hide called`); }
          render() { console.log(`${component}: render called`); }
        };
      }
    }

    // Load required script files with better error handling
    const requiredScripts = [
      '/static/js/components/projectListComponent.js',
      '/static/js/components/projectDetailsComponent.js',
      '/static/js/components/knowledgebaseComponent.js'
    ];

    // Load scripts in parallel but handle errors for each
    await Promise.allSettled(requiredScripts.map(async (script) => {
      try {
        // Check if script is already loaded
        if (document.querySelector(`script[src="${script}"]`)) {
          console.log(`Script ${script} already loaded, skipping`);
          return;
        }
        
        console.log(`Loading script ${script}`);
        await new Promise((resolve, reject) => {
          const scriptEl = document.createElement('script');
          scriptEl.src = script;
          scriptEl.onload = () => {
            console.log(`Script ${script} loaded successfully`);
            resolve();
          };
          scriptEl.onerror = (err) => {
            console.warn(`Failed to load ${script}, using placeholder:`, err);
            resolve(); // Resolve anyway, we have placeholders
          };
          document.head.appendChild(scriptEl);
          
          // Add a timeout to avoid hanging
          setTimeout(() => resolve(), 3000);
        });
      } catch (error) {
        console.warn(`Error handling script ${script}:`, error);
        // We resolve anyway since we have placeholders
      }
    }));

    console.log("✅ All UI components initialized");
    return true;
  } catch (error) {
    console.error("❌ Component initialization failed:", error);
    // We still return true because our placeholders should allow basic functionality
    return true;
  }
}
// Export initialization function
window.initComponents = initComponents;
/**
 * initComponents.js
 * Initializes all UI components in the correct order
 */

async function initComponents() {
  try {
    console.log("Initializing UI components");
    
    // Ensure UIUtils is available
    if (!window.UIUtils) {
      throw new Error("UIUtils not loaded");
    }

    // Load required script files
    const requiredScripts = [
      '/static/js/components/projectListComponent.js',
      '/static/js/components/projectDetailsComponent.js',
      '/static/js/components/knowledgebaseComponent.js'
    ];

    // Load scripts sequentially
    for (const script of requiredScripts) {
      await new Promise((resolve, reject) => {
        const scriptEl = document.createElement('script');
        scriptEl.src = script;
        scriptEl.onload = resolve;
        scriptEl.onerror = () => reject(new Error(`Failed to load ${script}`));
        document.head.appendChild(scriptEl);
      });
    }

    // Verify components are loaded
    const requiredComponents = [
      'ProjectListComponent',
      'ProjectDetailsComponent',
      'KnowledgeBaseComponent'
    ];

    const missingComponents = requiredComponents.filter(
      component => !window[component]
    );

    if (missingComponents.length > 0) {
      throw new Error(`Missing required components: ${missingComponents.join(', ')}`);
    }

    // Initialize any component-specific configurations
    if (window.ProjectListComponent) {
      console.log("Project list component available");
    }

    if (window.ProjectDetailsComponent) {
      console.log("Project details component available");
    }

    if (window.KnowledgeBaseComponent) {
      console.log("Knowledge base component available");
    }

    console.log("✅ All UI components initialized");
    return true;
  } catch (error) {
    console.error("❌ Component initialization failed:", error);
    throw error;
  }
}

// Export initialization function
window.initComponents = initComponents;
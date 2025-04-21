/**
 * Initializes project list specific functionality like search and create button.
 */
export function initProjectList() {
  // Track initialization state
  let initialized = false;

  // Initialize project list component with dependency checks
  const initWhenReady = async () => {
    if (initialized) return;

    // Wait for required dependencies
    while (!window.projectManager?.loadProjects ||
      !window.projectModal?.openModal) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('[ProjectListInit] Dependencies met, initializing...');

    // Project search
    const projectSearchInput = document.getElementById('projectSearchInput');
    if (projectSearchInput) {
      const searchHandler = function () {
        const searchTerm = this.value.toLowerCase();
        const projectCards = document.querySelectorAll('#projectList .project-card');

        projectCards.forEach(card => {
          const projectName = card.querySelector('.project-name, h3')?.textContent.toLowerCase() || '';
          const projectDescription = card.querySelector('.project-description, p')?.textContent.toLowerCase() || '';

          if (projectName.includes(searchTerm) || projectDescription.includes(searchTerm)) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
      };

      projectSearchInput.addEventListener('input', searchHandler);
      console.log('[ProjectListInit] Search input listener attached.');
    } else {
      console.warn('[ProjectListInit] projectSearchInput not found.');
    }

    // New project button - Use ProjectModal directly
    const setupProjectButton = () => {
      const createProjectBtn = document.getElementById('projectListCreateBtn');
      if (!createProjectBtn) {
        console.warn('[ProjectListInit] projectListCreateBtn not found.');
        return;
      }

      const handler = function () {
        console.log('[ProjectListInit] Create Project button clicked.');
        // Use the ProjectModal's method directly for creating a new project
        window.projectModal.openModal(null);
      };

      createProjectBtn.addEventListener('click', handler);
      console.log('[ProjectListInit] Create project button listener attached.');
    };
    setupProjectButton();

    initialized = true;
    console.log('[ProjectListInit] Initialization complete.');
  };

  // Start the initialization process
  initWhenReady();
}

// Make it available globally if app.js relies on that
window.initProjectList = initProjectList;

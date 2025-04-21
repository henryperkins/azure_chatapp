/**
 * projectListInit.js
 * Initializes the project list logic, including the search input
 * and the create project button. Waits for necessary dependencies,
 * then sets up event listeners.
 */

// Make it available globally if app.js relies on that
window.initProjectList = initProjectList;

/**
 * Initialize project list functionality with dependency checks.
 */
export function initProjectList() {
  let initialized = false;

  /**
   * Dependencies required for this module to work properly:
   * - window.projectManager.loadProjects
   * - window.projectModal.openModal
   * - (optionally) ProjectListComponent for the actual UI
   */
  const requiredGlobals = ['projectManager', 'projectModal'];

  const initWhenReady = async () => {
    if (initialized) return;

    try {
      // Wait for all essential dependencies with a 5s timeout
      await Promise.all(requiredGlobals.map((dep) => waitForDependency(dep, 5000)));

      console.log('[ProjectListInit] Dependencies met, setting up UI...');

      // Setup search input
      const projectSearchInput = document.getElementById('projectSearchInput');
      if (projectSearchInput) {
        const searchHandler = debounce((e) => {
          const searchTerm = e.target.value.toLowerCase();
          const projectCards = document.querySelectorAll('#projectList .project-card');

          projectCards.forEach(card => {
            const projectName = card.querySelector('.project-name')?.textContent.toLowerCase() || '';
            const projectDesc = card.querySelector('.project-description')?.textContent.toLowerCase() || '';
            const matches = projectName.includes(searchTerm) || projectDesc.includes(searchTerm);
            card.classList.toggle('hidden', !matches);
          });
        }, 200);

        projectSearchInput.addEventListener('input', searchHandler);
        console.log('[ProjectListInit] Search input listener attached.');
      } else {
        console.warn('[ProjectListInit] #projectSearchInput not found.');
      }

      // Setup create project button
      const createProjectBtn = document.getElementById('projectListCreateBtn');
      if (createProjectBtn) {
        const handler = () => {
          console.log('[ProjectListInit] Create Project button clicked.');
          // Use the ProjectModal's method directly for creating a new project
          window.projectModal.openModal(null);
        };

        createProjectBtn.addEventListener('click', handler);
        console.log('[ProjectListInit] Create project button listener attached.');
      } else {
        console.warn('[ProjectListInit] #projectListCreateBtn not found.');
      }

      initialized = true;
      console.log('[ProjectListInit] Initialization complete.');
    } catch (err) {
      console.error('[ProjectListInit] Initialization failed:', err);
    }
  };

  initWhenReady();
}

/**
 * Helper: Wait for a specified dependency on window.
 * @param {string} name - The global name to wait for (e.g. 'projectManager')
 * @param {number} timeout - How long to wait before failing
 */
async function waitForDependency(name, timeout = 5000) {
  const startTime = Date.now();
  while (!window[name]) {
    await new Promise(r => setTimeout(r, 100));
    if (Date.now() - startTime > timeout) {
      throw new Error(`Dependency "${name}" not found after ${timeout}ms`);
    }
  }
}

/**
 * Helper: Debounce a function call.
 * @param {Function} fn - The function to debounce
 * @param {number} delay - The debounce delay in ms
 */
function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

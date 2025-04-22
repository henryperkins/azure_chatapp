/**
 * projectListInit.js
 * Initializes the project list logic, including the search input
 * Dependencies:
 * - window.projectManager (external dependency, for project operations)
 * - window.projectModal (external dependency, for modal handling)
 * - document (browser built-in, for DOM manipulation)
 * - DependencySystem (external dependency, for module registration)
 */

// Browser APIs:
// - document (DOM access)

// External Dependencies (Global Scope):
// - window.projectManager (project data operations)
// - window.projectModal (modal management)
// - DependencySystem (module registration)

// Optional Dependencies:
// - Gracefully handles missing DOM elements
// - Provides timeout for dependency loading
// - Falls back gracefully if DependencySystem not available

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

      const ensureProjectModalReady = async () => {
        if (window.projectModal?.init && !window.projectModal.modalElement) {
          await window.projectModal.init();
        }
      };

      // Setup create project button
      const createProjectBtn = document.getElementById('projectListCreateBtn');
      if (createProjectBtn) {
        const handler = async () => {
          await ensureProjectModalReady();
          console.log('[ProjectListInit] Create Project button clicked.');
          window.modalManager?.show('project', {
            updateContent: (modalEl) => {
              const form = modalEl.querySelector('#projectModalForm');
              if (form) {
                form.reset();
                form.querySelector('#projectModalIdInput').value = '';
                // Clear validation errors
                form.querySelectorAll('.error-message').forEach(el => el.classList.add('hidden'));
              }
              const title = modalEl.querySelector('#projectModalTitle');
              if (title) title.textContent = 'Create New Project';
            }
          });
        };
        
        // Remove existing listener to prevent duplicates
        const newBtn = createProjectBtn.cloneNode(true);
        createProjectBtn.parentNode.replaceChild(newBtn, createProjectBtn);
        window.eventHandlers?.trackListener(newBtn, 'click', handler);
        console.log('[ProjectListInit] Create project button listener attached.');
      }

      // Setup sidebar new project button
      const sidebarNewProjectBtn = document.getElementById('sidebarNewProjectBtn');
      if (sidebarNewProjectBtn) {
        const handler = async () => {
          await ensureProjectModalReady();
          console.log('[ProjectListInit] Sidebar New Project button clicked.');
          window.modalManager?.show('project', {
            updateContent: (modalEl) => {
              const form = modalEl.querySelector('#projectForm');
              if (form) {
                form.reset();
                form.querySelector('#projectIdInput').value = '';
              }
              const title = modalEl.querySelector('#projectModalTitle');
              if (title) title.textContent = 'Create New Project';
            }
          });
        };
        sidebarNewProjectBtn.addEventListener('click', handler);
        console.log('[ProjectListInit] Sidebar new project button listener attached.');
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

// Register with DependencySystem
DependencySystem.register('projectListInit', { initProjectList });

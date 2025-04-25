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

            // Setup search input with retry
            const initSearchWithRetry = (attempt = 0) => {
                // Allow both 'projectSearchInput' and 'sidebarProjectSearch' (dual-support)
                const input = document.getElementById('projectSearchInput') ||
                              document.getElementById('sidebarProjectSearch');
                if (!input) {
                    if (attempt < 5) {
                        setTimeout(() => initSearchWithRetry(attempt + 1), 100 * attempt);
                        return;
                    }
                    console.error('Failed to find #projectSearchInput or #sidebarProjectSearch after 5 attempts');
                    return;
                }
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
                input.addEventListener('input', searchHandler);
                console.log('[ProjectListInit] Search input listener attached.');
            };
            initSearchWithRetry();

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

                // Remove existing listeners via cleanup utility, avoid cloning node (preserves bindings)
                if (window.eventHandlers?.cleanupListeners) {
                    window.eventHandlers.cleanupListeners(createProjectBtn);
                }
                window.eventHandlers?.trackListener(createProjectBtn, 'click', handler);
            }

// Hoist function setupSidebarNewProjectBtn so it is defined before use and available globally
function setupSidebarNewProjectBtn() {
    const sidebarNewProjectBtn = document.getElementById('sidebarNewProjectBtn');
    if (sidebarNewProjectBtn) {
        const handler = async () => {
            // ensureProjectModalReady is in initProjectList scope, so re-define if needed
            if (typeof ensureProjectModalReady === 'function') {
                await ensureProjectModalReady();
            } else if (window.projectModal?.init && !window.projectModal.modalElement) {
                await window.projectModal.init();
            }
            console.log('[ProjectListInit] Sidebar New Project button clicked.');
            window.modalManager?.show('project', {
                updateContent: (modalEl) => {
                    const form = modalEl.querySelector('#projectModalForm');
                    if (form) {
                        form.reset();
                        form.querySelector('#projectModalIdInput').value = '';
                    }
                    const title = modalEl.querySelector('#projectModalTitle');
                    if (title) title.textContent = 'Create New Project';
                }
            });
        };
        if (window.eventHandlers?.cleanupListeners) {
            window.eventHandlers.cleanupListeners(sidebarNewProjectBtn);
        }
        window.eventHandlers?.trackListener(sidebarNewProjectBtn, 'click', handler);
    }
}
window.setupSidebarNewProjectBtn = setupSidebarNewProjectBtn;
setupSidebarNewProjectBtn();

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

// Re-bind the sidebar new project button after modals are loaded
document.addEventListener('modalsLoaded', () => {
    setTimeout(() => {
        window.setupSidebarNewProjectBtn();
    }, 0);
});

// Register with DependencySystem
DependencySystem.register('projectListInit', { initProjectList });

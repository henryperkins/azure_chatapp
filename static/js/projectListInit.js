/**
 * Initializes project list functionality
 */
export function initProjectList() {
  // Track initialization state
  let initialized = false;

  // Initialize project list component with dependency checks
  const initWhenReady = async () => {
    if (initialized) return;

    // Wait for all required dependencies
    while (!window.projectManager?.loadProjects ||
           !window.modalManager?.show) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Initial project loading
    window.projectManager.loadProjects('all').catch(err => {
      console.error("Initial project loading failed:", err);
    });

    // Project search
    const projectSearchInput = document.getElementById('projectSearchInput');
    if (projectSearchInput) {
      projectSearchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        const projectCards = document.querySelectorAll('#projectList .project-card');

        projectCards.forEach(card => {
          const projectName = card.querySelector('.project-name')?.textContent.toLowerCase() || '';
          const projectDescription = card.querySelector('.project-description')?.textContent.toLowerCase() || '';

          if (projectName.includes(searchTerm) || projectDescription.includes(searchTerm)) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
      });
    }

    // New project button - wait for modalManager if needed
    const setupProjectButton = () => {
      const createProjectBtn = document.getElementById('projectListCreateBtn');
      if (!createProjectBtn) return;

      if (!window.modalManager) {
        setTimeout(setupProjectButton, 100);
        return;
      }

      createProjectBtn.addEventListener('click', function () {
        window.modalManager.show('project', {
          updateContent: (modalEl) => {
            const form = modalEl.querySelector('form');
            if (form) form.reset();
            const projectIdInput = modalEl.querySelector('#projectIdInput');
            if (projectIdInput) projectIdInput.value = '';
            const title = modalEl.querySelector('.modal-title, h3');
            if (title) title.textContent = 'Create New Project';
          }
        });
      });
    };
    setupProjectButton();
  };

  // Start the initialization process
  initWhenReady();
}

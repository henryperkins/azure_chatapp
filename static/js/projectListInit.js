/**
 * Initializes project list functionality
 */
export function initProjectList() {
  // Initialize project list component once the projectManager is ready
  document.addEventListener('appJsReady', function () {
    if (window.projectManager && window.projectManager.loadProjects) {
      // Initial project loading
      window.projectManager.loadProjects('all').catch(err => {
        console.error("Initial project loading failed:", err);
      });
    }

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

    // New project button
    const createProjectBtn = document.getElementById('projectListCreateBtn');
    if (createProjectBtn) {
      createProjectBtn.addEventListener('click', function () {
        if (window.modalManager && window.modalManager.show) {
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
        } else if (window.projectModal) {
          window.projectModal.openModal();
        }
      });
    }
  });
}

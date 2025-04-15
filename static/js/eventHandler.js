/**
 * eventHandlers.js - Module for setting up event listeners for UI interactions.
 * Separated from app.js to reduce file size and improve modularity.
 */

function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key.toLowerCase() === 'r') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('regenerateChat'));
        }
        if (e.key.toLowerCase() === 'c') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('copyMessage'));
        }
    }
}

function handleNewConversationClick() {
    if (window.ensureAuthenticated) {
        window.ensureAuthenticated().then(isAuth => {
            if (!isAuth) {
                if (window.showNotification) window.showNotification("Please log in to create a conversation", "error");
                return;
            }
            if (window.projectManager?.createConversation) {
                window.projectManager.createConversation(null)
                    .then(newConversation => {
                        window.location.href = '/?chatId=' + newConversation.id;
                    })
                    .catch(err => {
                        if (window.handleAPIError) window.handleAPIError('creating conversation', err);
                    });
            } else {
                console.error('No project manager or conversation creation method found');
            }
        });
    }
}

function handleProjectFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const modalDialog = form.closest('dialog'); // Get the parent dialog
    const projectId = form.querySelector("#projectIdInput")?.value;
    const isEditing = !!projectId;
    const formData = {
        name: form.querySelector("#projectNameInput")?.value.trim(),
        description: form.querySelector("#projectDescInput")?.value.trim(),
        goals: form.querySelector("#projectGoalsInput")?.value.trim(),
        max_tokens: parseInt(form.querySelector("#projectMaxTokensInput")?.value, 10)
    };
    if (!formData.name) {
        if (window.showNotification) window.showNotification("Project name is required", "error");
        return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
    }
    try {
        window.projectManager.createOrUpdateProject(projectId, formData).then(() => {
            if (window.showNotification) window.showNotification(isEditing ? "Project updated" : "Project created", "success");
            if (modalDialog && typeof modalDialog.close === 'function') modalDialog.close();
            else if (window.modalManager) window.modalManager.hide("project");
            window.projectManager.loadProjects('all');
        }).catch(err => {
            console.error("[ProjectDashboard] Error saving project:", err);
            if (window.showNotification) window.showNotification(`Failed to save project: ${err.message || 'Unknown error'}`, "error");
            const errorDiv = form.querySelector('.modal-error-display');
            if (errorDiv) {
                errorDiv.textContent = `Error: ${err.message || 'Unknown error'}`;
                errorDiv.classList.remove('hidden');
            }
        }).finally(() => {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
            }
        });
    } catch (err) {
        console.error("[ProjectDashboard] Error saving project:", err);
        if (window.showNotification) window.showNotification(`Failed to save project: ${err.message || 'Unknown error'}`, "error");
    }
}

function setupEventListeners() {
    // Listeners from app.js
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', (event) => {
        if (event.target.closest('#newConversationBtn')) {
            handleNewConversationClick();
        }
        if (event.target.closest('#createProjectBtn')) {
            if (window.modalManager?.show) window.modalManager.show('project', {
                updateContent: (modalEl) => {
                    const form = modalEl.querySelector('form');
                    if (form) form.reset();
                    const projectIdInput = modalEl.querySelector('#projectId');
                    if (projectIdInput) projectIdInput.value = '';
                    const title = modalEl.querySelector('.modal-title, h3');
                    if (title) title.textContent = 'Create New Project';
                }
            });
        }
        if (event.target.closest('#backToProjectsBtn')) {
            if (window.ProjectDashboard?.showProjectList) window.ProjectDashboard.showProjectList();
            else if (typeof window.showProjectsView === 'function') window.showProjectsView();
            else {
                const listView = document.getElementById('projectListView');
                const detailsView = document.getElementById('projectDetailsView');
                if (listView) listView.classList.remove('hidden');
                if (detailsView) detailsView.classList.add('hidden');
            }
        }
        if (event.target.closest('#editProjectBtn')) {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.modalManager?.show) {
                window.modalManager.show('project', {
                    updateContent: (modalEl) => {
                        const form = modalEl.querySelector('form');
                        if (form) {
                            form.querySelector('#projectId').value = currentProject.id;
                            form.querySelector('#projectName').value = currentProject.name;
                            form.querySelector('#projectDescription').value = currentProject.description || '';
                            const title = modalEl.querySelector('.modal-title, h3');
                            if (title) title.textContent = `Edit Project: ${currentProject.name}`;
                        }
                    }
                });
            }
        }
        if (event.target.closest('#pinProjectBtn')) {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject?.id && window.projectManager?.togglePinProject) {
                window.projectManager.togglePinProject(currentProject.id)
                    .then(updatedProject => {
                        if (window.showNotification) window.showNotification('Project ' + (updatedProject.pinned ? 'pinned' : 'unpinned'), 'success');
                        window.projectManager.loadProjectDetails(currentProject.id);
                        if (window.loadSidebarProjects) window.loadSidebarProjects();
                    })
                    .catch(err => {
                        console.error('Error toggling pin:', err);
                        if (window.showNotification) window.showNotification('Failed to update pin status', 'error');
                    });
            }
        }
        if (event.target.closest('#archiveProjectBtn')) {
            const currentProject = window.projectManager?.getCurrentProject();
            if (currentProject && window.ModalManager?.confirmAction) {
                window.ModalManager.confirmAction({
                    title: 'Confirm Archive',
                    message: `Are you sure you want to ${currentProject.archived ? 'unarchive' : 'archive'} this project?`,
                    confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
                    confirmClass: currentProject.archived ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700',
                    onConfirm: () => {
                        window.projectManager.toggleArchiveProject(currentProject.id)
                            .then(updatedProject => {
                                if (window.showNotification) window.showNotification(`Project ${updatedProject.archived ? 'archived' : 'unarchived'}`, 'success');
                                if (window.ProjectDashboard?.showProjectList) window.ProjectDashboard.showProjectList();
                                if (window.loadSidebarProjects) window.loadSidebarProjects();
                                window.projectManager.loadProjects('all');
                            })
                            .catch(err => {
                                console.error('Error toggling archive:', err);
                                if (window.showNotification) window.showNotification('Failed to update archive status', 'error');
                            });
                    }
                });
            }
        }
        if (event.target.closest('#minimizeChatBtn')) {
            const chatContainer = document.getElementById('projectChatContainer');
            if (chatContainer) chatContainer.classList.toggle('hidden');
        }
    });
    // Additional setup from app.js
    const projectSearch = document.querySelector('#sidebarProjectSearch');
    if (projectSearch) {
        projectSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const projectItems = document.querySelectorAll('#sidebarProjects li');
            projectItems.forEach(item => {
                const projectName = item.textContent.toLowerCase();
                item.style.display = projectName.includes(searchTerm) ? '' : 'none';
            });
        });
    }
    const newProjectBtn = document.querySelector('#sidebarNewProjectBtn');
    if (newProjectBtn) {
        newProjectBtn.addEventListener('click', () => {
            if (window.modalManager?.show) window.modalManager.show('project', {});
        });
    }
    const showLoginBtn = document.querySelector('#showLoginBtn');
    const authButton = document.querySelector('#authButton');
    if (showLoginBtn && authButton) {
        showLoginBtn.addEventListener('click', () => authButton.click());
    }
    // Add form submission listener from projectDashboard.js
    const projectForm = document.getElementById("projectForm");
    if (projectForm) {
        projectForm.addEventListener("submit", handleProjectFormSubmit);
    }
    // Navigation tracking from app.js
    function recordInteraction() {
        sessionStorage.setItem('last_page_interaction', Date.now().toString());
    }
    document.addEventListener('click', (e) => {
        if (e.target.closest('a[href*="project"]') ||
            e.target.closest('button[data-action*="project"]') ||
            e.target.closest('#manageDashboardBtn') ||
            e.target.closest('#projectsNav')) {
            recordInteraction();
        }
    });
    window.addEventListener('beforeunload', recordInteraction);
    recordInteraction();
}

// Export to window for app.js integration
window.eventHandlers = {
    init: setupEventListeners
};

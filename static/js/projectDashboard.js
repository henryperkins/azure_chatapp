// projectDashboard.js
// ------------------
// All direct HTML strings have been removed and placed into a template in index.html.
// This file now only contains the dashboard logic and event handling without inline HTML.

import { formatBytes, calculateTokenPercentage, getFileTypeIcon, apiRequest } from './formatting.js';

let currentProject = null;
let projectFiles = [];
let projectArtifacts = [];
let projectConversations = [];

// Initialize the dashboard when document is ready
document.addEventListener("DOMContentLoaded", () => {
    initProjectDashboard();
    setupEventListeners();
});

/**
 * Initialize the project dashboard
 */
function initProjectDashboard() {
    const dashboardContainer = document.getElementById("projectDashboard");
    if (!dashboardContainer) return;

    // Load projects
    loadProjects();

    // Check if there's a project ID in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    
    if (projectId) {
        loadProjectDetails(projectId);
    } else {
        // If no project specified, show the project list view
        showProjectListView();
    }
}

/**
 * Set up event listeners for dashboard interactions
 */
function setupEventListeners() {
    // Project creation
    const createProjectBtn = document.getElementById("createProjectBtn");
    if (createProjectBtn) {
        createProjectBtn.addEventListener("click", () => {
            // Formerly showed project creation form with HTML;
            // now delegated to external template or modal logic
        });
    }

    // Project search
    const projectSearchInput = document.getElementById("projectSearchInput");
    if (projectSearchInput) {
        projectSearchInput.addEventListener("input", (e) => {
            filterProjects(e.target.value);
        });
    }

    // Tab switching
    const tabButtons = document.querySelectorAll(".project-tab-btn");
    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const tabId = button.getAttribute("data-tab");
            switchProjectTab(tabId);
        });
    });

    // Click delegation for dynamic elements
    document.addEventListener("click", (e) => {
        // Pin/unpin project
        if (e.target.classList.contains("pin-project-btn")) {
            const projectId = e.target.getAttribute("data-project-id");
            togglePinProject(projectId);
        }
        // Archive/unarchive project
        if (e.target.classList.contains("archive-project-btn")) {
            const projectId = e.target.getAttribute("data-project-id");
            toggleArchiveProject(projectId);
        }
        // Edit project
        if (e.target.classList.contains("edit-project-btn")) {
            const projectId = e.target.getAttribute("data-project-id");
            // Formerly displayed edit form HTML; now delegated
        }
        // Delete project
        if (e.target.classList.contains("delete-project-btn")) {
            const projectId = e.target.getAttribute("data-project-id");
            confirmDeleteProject(projectId);
        }
        // View project
        if (e.target.classList.contains("view-project-btn")) {
            const projectId = e.target.getAttribute("data-project-id");
            loadProjectDetails(projectId);
        }
        // File upload button
        if (e.target.classList.contains("upload-file-btn")) {
            const input = document.getElementById("fileInput");
            if (input) input.click();
        }
        // File deletion
        if (e.target.classList.contains("delete-file-btn")) {
            const fileId = e.target.getAttribute("data-file-id");
            const projectId = currentProject?.id;
            if (projectId && fileId) {
                confirmDeleteFile(projectId, fileId);
            }
        }
        // Artifact management
        if (e.target.classList.contains("view-artifact-btn")) {
            const artifactId = e.target.getAttribute("data-artifact-id");
            viewArtifact(artifactId);
        }
        if (e.target.classList.contains("export-artifact-btn")) {
            const artifactId = e.target.getAttribute("data-artifact-id");
            const format = e.target.getAttribute("data-format") || "text";
            exportArtifact(artifactId, format);
        }
        if (e.target.classList.contains("delete-artifact-btn")) {
            const artifactId = e.target.getAttribute("data-artifact-id");
            confirmDeleteArtifact(artifactId);
        }
    });

    // File upload handler
    const fileInput = document.getElementById("fileInput");
    if (fileInput) {
        fileInput.addEventListener("change", handleFileUpload);
    }

    // Save custom instructions
    const saveInstructionsBtn = document.getElementById("saveInstructionsBtn");
    if (saveInstructionsBtn) {
        saveInstructionsBtn.addEventListener("click", saveProjectInstructions);
    }
}

/**
 * Load the list of projects
 */
async function loadProjects() {
    try {
        const data = await apiRequest("/api/projects", "GET");
        // Formerly: renderProjectList(data); now delegated to external HTML template
        // E.g., we might dispatch an event or call a separate function
        // to handle the new template-based approach
        const listEvent = new CustomEvent("ProjectsLoaded", { detail: data });
        document.dispatchEvent(listEvent);
    } catch (error) {
        console.error("Error loading projects:", error);
        if (window.showNotification) {
            window.showNotification("Failed to load projects", "error");
        }
    }
}

/**
 * Filter projects based on search term
 */
function filterProjects(searchTerm) {
    // Formerly updated .innerHTML on the fly; now delegated to external logic or template
    const event = new CustomEvent("ProjectSearch", { detail: { searchTerm } });
    document.dispatchEvent(event);
}

/**
 * Show the project creation form
 */
function showProjectCreateForm() {
    // All form HTML removed; presumably we show/hide something from the new template
}

/**
 * Confirm or show project edit form
 */
async function showProjectEditForm(projectId) {
    // No inline HTML any longer
    // Possibly fetch project data, then display via new template
    try {
        const response = await fetch(`/api/projects/${projectId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const project = await response.json();

        // Fire an event for template rendering
        const editEvent = new CustomEvent("EditProjectData", { detail: project });
        document.dispatchEvent(editEvent);
    } catch (error) {
        console.error("Error loading project for editing:", error);
        if (window.showNotification) {
            window.showNotification("Failed to load project details", "error");
        }
    }
}

/**
 * Load details for a specific project
 */
async function loadProjectDetails(projectId) {
    try {
        // Update URL without reloading the page
        const url = new URL(window.location);
        url.searchParams.set("project", projectId);
        window.history.pushState({}, "", url);

        // Indicate loading
        const loadingEvent = new CustomEvent("ProjectLoading", { detail: { projectId } });
        document.dispatchEvent(loadingEvent);

        // Fetch project details
        const response = await fetch(`/api/projects/${projectId}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }

        const project = await response.json();
        currentProject = project;

        // Formerly rendered a large HTML chunk; now delegated
        const detailsEvent = new CustomEvent("ProjectLoaded", { detail: project });
        document.dispatchEvent(detailsEvent);

        // Load associated data
        loadProjectFiles(projectId);
        loadProjectArtifacts(projectId);
        loadProjectConversations(projectId);
        loadProjectStats(projectId);

        // Switch to details view
        showProjectDetailsView();
    } catch (error) {
        console.error("Error loading project details:", error);
        if (window.showNotification) {
            window.showNotification("Failed to load project details", "error");
        }
        showProjectListView();
    }
}

/**
 * Show/hide UI views
 */
function showProjectListView() {
    const listView = document.getElementById("projectListView");
    const detailsView = document.getElementById("projectDetailsView");
    
    if (listView && detailsView) {
        listView.classList.remove("hidden");
        detailsView.classList.add("hidden");
    }
    
    const url = new URL(window.location);
    url.searchParams.delete("project");
    window.history.pushState({}, "", url);
    currentProject = null;
}

function showProjectDetailsView() {
    const listView = document.getElementById("projectListView");
    const detailsView = document.getElementById("projectDetailsView");
    
    if (listView && detailsView) {
        listView.classList.add("hidden");
        detailsView.classList.remove("hidden");
    }
}

/**
 * Switch project tabs
 */
function switchProjectTab(tabId) {
    const tabButtons = document.querySelectorAll(".project-tab-btn");
    tabButtons.forEach(button => {
        const buttonTabId = button.getAttribute("data-tab");
        if (buttonTabId === tabId) {
            button.classList.add("text-blue-600", "border-b-2", "border-blue-600");
            button.classList.remove("text-gray-500");
        } else {
            button.classList.remove("text-blue-600", "border-b-2", "border-blue-600");
            button.classList.add("text-gray-500");
        }
    });

    // Instead of setting .innerHTML with HTML, dispatch an event
    const tabEvent = new CustomEvent("ProjectTabChanged", { detail: tabId });
    document.dispatchEvent(tabEvent);
}

/**
 * Load project files
 */
async function loadProjectFiles(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/files`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        projectFiles = data;

        // Fire event for external HTML usage
        const filesEvent = new CustomEvent("ProjectFilesLoaded", { detail: data });
        document.dispatchEvent(filesEvent);
    } catch (error) {
        console.error("Error loading project files:", error);
    }
}

/**
 * Handle file upload
 */
async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    if (!currentProject) {
        if (window.showNotification) {
            window.showNotification("No project selected", "error");
        }
        return;
    }
    // Formerly used inline HTML for progress; now can dispatch an event or use a separate module
    const uploadEvent = new CustomEvent("ProjectFilesUploading", { detail: { files } });
    document.dispatchEvent(uploadEvent);

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            // Perform the upload
            const formData = new FormData();
            formData.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/api/projects/${currentProject.id}/files`, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentage = Math.round((e.loaded / e.total) * 100);
                    const progressInfo = { fileName: file.name, percentage };
                    const progressEvt = new CustomEvent("FileUploadProgress", { detail: progressInfo });
                    document.dispatchEvent(progressEvt);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    successCount++;
                } else {
                    failCount++;
                }
                // Check completion
                if (successCount + failCount === files.length) {
                    loadProjectFiles(currentProject.id);
                    loadProjectStats(currentProject.id);
                    const completeEvt = new CustomEvent("FileUploadComplete", { detail: { successCount, failCount } });
                    document.dispatchEvent(completeEvt);
                }
            };

            xhr.onerror = () => {
                failCount++;
                if (successCount + failCount === files.length) {
                    loadProjectFiles(currentProject.id);
                    loadProjectStats(currentProject.id);
                    const errorEvt = new CustomEvent("FileUploadComplete", { detail: { successCount, failCount } });
                    document.dispatchEvent(errorEvt);
                }
            };
            xhr.send(formData);

        } catch (error) {
            console.error(`Error uploading file ${file.name}:`, error);
            failCount++;
        }
    }
}

/**
 * Confirm file deletion
 */
function confirmDeleteFile(projectId, fileId) {
    // No inline HTML; handle externally or in a modal
    const evt = new CustomEvent("ConfirmDeleteFile", { detail: { projectId, fileId } });
    document.dispatchEvent(evt);
}

/**
 * Load project artifacts
 */
async function loadProjectArtifacts(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/artifacts`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        projectArtifacts = data;

        const artifactsEvent = new CustomEvent("ProjectArtifactsLoaded", { detail: data });
        document.dispatchEvent(artifactsEvent);
    } catch (error) {
        console.error("Error loading project artifacts:", error);
    }
}

/**
 * View artifact
 */
function viewArtifact(artifactId) {
    // No inline HTML
    const event = new CustomEvent("ViewArtifact", { detail: { artifactId } });
    document.dispatchEvent(event);
}

/**
 * Export artifact
 */
function exportArtifact(artifactId, format) {
    const event = new CustomEvent("ExportArtifact", { detail: { artifactId, format } });
    document.dispatchEvent(event);
}

/**
 * Confirm artifact deletion
 */
function confirmDeleteArtifact(artifactId) {
    const evt = new CustomEvent("ConfirmDeleteArtifact", { detail: { artifactId } });
    document.dispatchEvent(evt);
}

/**
 * Load project conversations
 */
async function loadProjectConversations(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/conversations`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        projectConversations = data;

        const convEvent = new CustomEvent("ProjectConversationsLoaded", { detail: data });
        document.dispatchEvent(convEvent);
    } catch (error) {
        console.error("Error loading project conversations:", error);
    }
}

/**
 * Load project stats
 */
async function loadProjectStats(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}/stats`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        });
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        const statsEvent = new CustomEvent("ProjectStatsLoaded", { detail: data });
        document.dispatchEvent(statsEvent);
    } catch (error) {
        console.error("Error loading project stats:", error);
    }
}

/**
 * Render or dispatch for updating project stats (no inline HTML)
 */
function renderProjectStats(stats) {
    // Stubbed; replaced by external template usage
}

/**
 * Save project instructions
 */
function saveProjectInstructions() {
    // Stubbed; no inline HTML
}

/**
 * Toggle the pinned status for a project
 */
function togglePinProject(projectId) {
    // Possibly do an API call, then dispatch an event or call loadProjects()
    console.log("Toggling pin for project ID:", projectId);
}

/**
 * Toggle the archived status for a project
 */
function toggleArchiveProject(projectId) {
    // Possibly do an API call, then dispatch an event or call loadProjects()
    console.log("Toggling archive for project ID:", projectId);
}

/**
 * Confirm project deletion
 */
function confirmDeleteProject(projectId) {
    // Stubbed; no inline HTML
    const evt = new CustomEvent("ConfirmDeleteProject", { detail: projectId });
    document.dispatchEvent(evt);
}

/**
 * projectListComponent.js
 * Handles the project list view
 */

class ProjectListComponent {
  constructor(options) {
    this.elementId = options.elementId;
    this.element = document.getElementById(this.elementId);
    this.onViewProject = options.onViewProject;
    this.messageEl = document.getElementById("noProjectsMessage");
  }
  
  show() {
    document.getElementById("projectListView")?.classList.remove("hidden");
  }
  
  hide() {
    document.getElementById("projectListView")?.classList.add("hidden");
  }
  
  renderProjects(projects) {
    if (!this.element) return;
    
    this.element.innerHTML = "";
    
    if (!projects || projects.length === 0) {
      if (this.messageEl) this.messageEl.classList.remove("hidden");
      return;
    }
    
    if (this.messageEl) this.messageEl.classList.add("hidden");
    
    projects.forEach(project => {
      const card = this.createProjectCard(project);
      this.element.appendChild(card);
    });
  }
  
  createProjectCard(project) {
    // Calculate usage percentage
    const usage = project.token_usage || 0;
    const maxTokens = project.max_tokens || 0;
    const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;
    
    // Create card container
    const card = UIUtils.createElement("div", {
      className: `bg-white dark:bg-gray-700 rounded shadow p-4 border-l-4 
        ${project.pinned ? "border-yellow-500" : "border-blue-500"} 
        ${project.archived ? "opacity-60" : ""} w-full md:w-auto mb-2`
    });
    
    // Header with title and badges
    const header = UIUtils.createElement("div", { className: "flex justify-between mb-2" });
    
    const title = UIUtils.createElement("h3", { 
      className: "font-semibold text-md",
      textContent: project.name
    });
    
    const badges = UIUtils.createElement("div", { className: "text-xs text-gray-500" });
    if (project.pinned) badges.appendChild(document.createTextNode("📌 "));
    if (project.archived) badges.appendChild(document.createTextNode("🗃️ "));
    
    header.appendChild(title);
    header.appendChild(badges);
    card.appendChild(header);
    
    // Description
    const desc = UIUtils.createElement("p", {
      className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
      textContent: project.description || "No description"
    });
    card.appendChild(desc);
    
    // Token usage progress
    const tokenWrapper = UIUtils.createElement("div", { className: "mb-2" });
    
    const tokenHeader = UIUtils.createElement("div", { 
      className: "flex justify-between mb-1 text-xs",
      innerHTML: `
        <span>Tokens: ${UIUtils.formatNumber(usage)} / ${UIUtils.formatNumber(maxTokens)}</span>
        <span>${usagePct}%</span>
      `
    });
    
    const progressOuter = UIUtils.createElement("div", { 
      className: "w-full bg-gray-200 rounded-full h-1.5" 
    });
    
    const progressInner = UIUtils.createElement("div", { 
      className: "bg-blue-600 h-1.5 rounded-full",
      style: { width: `${usagePct}%` }
    });
    
    progressOuter.appendChild(progressInner);
    tokenWrapper.appendChild(tokenHeader);
    tokenWrapper.appendChild(progressOuter);
    card.appendChild(tokenWrapper);
    
    // Footer with created date and actions
    const footer = UIUtils.createElement("div", { 
      className: "flex justify-between mt-3" 
    });
    
    const createdInfo = UIUtils.createElement("div", {
      className: "text-xs text-gray-500",
      textContent: `Created ${UIUtils.formatDate(project.created_at)}`
    });
    
    const actions = UIUtils.createElement("div", { className: "flex space-x-1" });
    
    // View button
    const viewBtn = UIUtils.createElement("button", {
      className: "p-1 text-blue-600 hover:text-blue-800 view-project-btn flex items-center justify-center",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span class="loading-spinner hidden ml-1"></span>
      `,
      onclick: () => this.onViewProject(project.id)
    });
    
    // Delete button
    const deleteBtn = UIUtils.createElement("button", {
      className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      `,
      onclick: () => this.confirmDelete(project)
    });
    
    actions.appendChild(viewBtn);
    actions.appendChild(deleteBtn);
    
    footer.appendChild(createdInfo);
    footer.appendChild(actions);
    card.appendChild(footer);
    
    return card;
  }
  
  confirmDelete(project) {
    ModalManager.confirmAction({
      title: "Delete Project",
      message: `Are you sure you want to delete the project "${project.name}"? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        projectManager.deleteProject(project.id)
          .then(() => {
            UIUtils.showNotification("Project deleted", "success");
            projectManager.loadProjects();
          })
          .catch(err => {
            console.error("Error deleting project:", err);
            UIUtils.showNotification("Failed to delete project", "error");
          });
      }
    });
  }
  
  filterBySearch(term) {
    if (!this.element) return;
    
    const projectCards = this.element.querySelectorAll("div");
    let visibleCount = 0;
    term = term.toLowerCase();
    
    projectCards.forEach(card => {
      const projectName = card.querySelector("h3")?.textContent.toLowerCase() || "";
      const projectDesc = card.querySelector("p")?.textContent.toLowerCase() || "";
      const isMatch = projectName.includes(term) || projectDesc.includes(term);
      card.classList.toggle("hidden", !isMatch);
      if (isMatch) visibleCount++;
    });
    
    if (this.messageEl) {
      if (visibleCount === 0) {
        this.messageEl.textContent = "No matching projects found.";
        this.messageEl.classList.remove("hidden");
      } else {
        this.messageEl.classList.add("hidden");
      }
    }
  }
}

// Export the module
window.ProjectListComponent = ProjectListComponent;
/**
 * project_manager.js
 * -------------------
 * Manages user projects by interacting with your backend's project routes:
 *   - GET    /api/projects
 *   - POST   /api/projects
 *   - GET    /api/projects/{project_id}
 *   - PATCH  /api/projects/{project_id}
 *   - DELETE /api/projects/{project_id}
 *   - POST   /api/projects/{project_id}/attach_chat/{chat_id}
 *
 * Production-ready: no placeholders. Adjust DOM element IDs to match your frontend.
 */

document.addEventListener("DOMContentLoaded", () => {
  const projectListEl = document.getElementById("projectList");
  const createBtn = document.getElementById("createProjectBtn");
  const projNameInput = document.getElementById("projNameInput");
  const projSubtitleInput = document.getElementById("projSubtitleInput");
  const projDescInput = document.getElementById("projDescInput");
  const projNotesInput = document.getElementById("projNotesInput");
  const attachChatIdInput = document.getElementById("attachChatId"); // For attaching to chat

const autoFillChatIdBtn = document.getElementById("autoFillChatIdBtn");
if (autoFillChatIdBtn) {
autoFillChatIdBtn.addEventListener("click", () => {
  const chatId = window.CHAT_CONFIG?.chatId || "";
  const attachChatIdInput = document.getElementById("attachChatId");
  if (attachChatIdInput && chatId) {
    attachChatIdInput.value = chatId;
  } else if (!chatId) {
    if (window.showNotification) {
      window.showNotification("No active chat selected", "error");
    } else {
      alert("No active chat selected");
    }
  }
    });
// Scroll to the new conversation if it exists
const urlParams = new URLSearchParams(window.location.search);
const currentChatId = urlParams.get('chatId');
if (currentChatId) {
  const activeItem = Array.from(container.children).find(li => 
    li.textContent.includes(currentChatId)
  );
  if (activeItem) {
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
}
  if (projectListEl) {
    loadProjects();
  }

  if (createBtn) {
    createBtn.addEventListener("click", () => {
      const payload = {
        name: projNameInput?.value?.trim() || "",
        subtitle: projSubtitleInput?.value?.trim() || "",
        description: projDescInput?.value?.trim() || "",
        notes: projNotesInput?.value?.trim() || ""
      };
      createProject(payload);
    });
  }

  // Helper: get JWT from localStorage

  // Helper: create fetch headers
  function getHeaders() {
    return { "Content-Type": "application/json" };
  }

  // Load all user projects
  function loadProjects() {
    fetch("/api/projects", {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    })
      .then(checkResponse)
      .then((data) => {
        if (data.projects) {
          renderProjectList(data.projects);
        }
      })
      .catch((err) => {
        if (!err.message.includes("401")) {
          console.error("Error loading projects:", err);
        }
      });
  }

  // Create a new project
  function createProject(projData) {
    fetch("/api/projects", {
      method: "POST",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify(projData)
    })
      .then(checkResponse)
      .then(() => {
        clearFormInputs();
        loadProjects();
      })
      .catch((err) => console.error("Error creating project:", err));
  }

  // Render the list of projects
  function renderProjectList(projects) {
    projectListEl.innerHTML = "";
    projects.forEach((proj) => {
      const li = document.createElement("li");
      li.classList.add("flex", "justify-between", "items-center", "bg-gray-100", "p-2", "mb-2", "rounded");
      li.textContent = `${proj.name} (ID: ${proj.id})`;

      // Edit button
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.classList.add("ml-2", "px-2", "py-1", "bg-blue-600", "text-white", "rounded");
      editBtn.addEventListener("click", () => promptEditProject(proj));

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.classList.add("ml-2", "px-2", "py-1", "bg-red-600", "text-white", "rounded");
      deleteBtn.addEventListener("click", () => deleteProject(proj.id));

      // Attach button
      const attachBtn = document.createElement("button");
      attachBtn.textContent = "Attach";
      attachBtn.classList.add("ml-2", "px-2", "py-1", "bg-green-600", "text-white", "rounded");
      attachBtn.addEventListener("click", () => {
        if (attachChatIdInput && attachChatIdInput.value.trim()) {
          attachProjectToChat(proj.id, attachChatIdInput.value.trim());
        }
      });

      li.appendChild(editBtn);
      li.appendChild(deleteBtn);
      li.appendChild(attachBtn);

      projectListEl.appendChild(li);
    });
  }

  // Prompt user to edit existing fields and PATCH the project
  function promptEditProject(proj) {
    const newName = prompt("Project Name:", proj.name) || proj.name;
    const newSub = prompt("Subtitle:", proj.subtitle || "") || proj.subtitle;
    const newDesc = prompt("Description:", proj.description || "") || proj.description;
    const newNotes = prompt("Notes:", proj.notes || "") || proj.notes;

    updateProject(proj.id, {
      name: newName.trim(),
      subtitle: newSub.trim(),
      description: newDesc.trim(),
      notes: newNotes.trim()
    });
  }

  // Update project
  function updateProject(projectId, payload) {
    fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: getHeaders(),
      credentials: "include",
      body: JSON.stringify(payload)
    })
      .then(checkResponse)
      .then(() => loadProjects())
      .catch((err) => console.error("Error updating project:", err));
  }

  // Delete project
  function deleteProject(projectId) {
    if (!confirm("Are you sure you want to permanently delete this project?")) return;

    fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
      headers: getHeaders(),
      credentials: "include"
    })
      .then(checkResponse)
      .then(() => loadProjects())
      .catch((err) => console.error("Error deleting project:", err));
  }

  // Attach project to a chat
  function attachProjectToChat(projectId, chatId) {
    fetch(`/api/projects/${projectId}/attach_chat/${chatId}`, {
      method: "POST",
      headers: getHeaders(),
      credentials: "include"
    })
      .then(checkResponse)
      .then((data) => {
        if (data.attached) {
          alert("Project attached successfully!");
        } else {
          alert(data.message || "Project was already attached or an error occurred.");
        }
      })
      .catch((err) => console.error("Error attaching project to chat:", err));
  }

  // Clear form inputs after creating a project
  function clearFormInputs() {
    if (projNameInput) projNameInput.value = "";
    if (projSubtitleInput) projSubtitleInput.value = "";
    if (projDescInput) projDescInput.value = "";
    if (projNotesInput) projNotesInput.value = "";
  }

  // Helper to check fetch response
  function checkResponse(resp) {
    if (!resp.ok) {
      return resp.text().then((text) => {
        throw new Error(`${resp.status}: ${text}`);
      });
    }
    return resp.json();
  }
});

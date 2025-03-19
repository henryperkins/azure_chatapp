/**
 * projectManager.js
 * -----------------
 * Combines the original project manager functionality with new project stats,
 * artifact management, and file upload features.
 */

// Helper function to check fetch response
function checkResponse(resp) {
  if (!resp.ok) {
    return resp.text().then((text) => {
      throw new Error(resp.status + ": " + text);
    });
  }
  return resp.json();
}

// Helper function to get headers
function getHeaders() {
  return { "Content-Type": "application/json" };
}

document.addEventListener("DOMContentLoaded", () => {
  // ------------------------------------------------
  // DOM Elements from original code
  // ------------------------------------------------
  const projectListEl = document.getElementById("projectList");
  const createBtn = document.getElementById("createProjectBtn");
  const projNameInput = document.getElementById("projNameInput");
  const projSubtitleInput = document.getElementById("projSubtitleInput");
  const projDescInput = document.getElementById("projDescInput");
  const projNotesInput = document.getElementById("projNotesInput");
  const attachChatIdInput = document.getElementById("attachChatId");
  const autoFillChatIdBtn = document.getElementById("autoFillChatIdBtn");

  // If there's an auto-fill chat ID button, set up the behavior
  if (autoFillChatIdBtn) {
    autoFillChatIdBtn.addEventListener("click", () => {
      const chatId = window.CHAT_CONFIG?.chatId || "";
      const attachChatEl = document.getElementById("attachChatId");
      if (attachChatEl && chatId) {
        attachChatEl.value = chatId;
      } else if (!chatId) {
        if (window.showNotification) {
          window.showNotification("No active chat selected", "error");
        } else {
          alert("No active chat selected");
        }
      }
    });
    // Possibly scroll to the new conversation if it exists
    const urlParams = new URLSearchParams(window.location.search);
    const currentChatId = urlParams.get("chatId");
    if (currentChatId && projectListEl) {
      const activeItem = Array.from(projectListEl.children).find((li) =>
        li.textContent.includes(currentChatId)
      );
      if (activeItem) {
        activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  // If the project list element is present, load existing projects
  if (projectListEl) {
    loadProjects();
  }

  // If there's a create button, set up the behavior for creating new projects
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

  // ------------------------------------------------
  // Original code for listing/creating/editing projects
  // ------------------------------------------------

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
        console.error("Error loading projects:", err);
        if (err.message.includes("401")) {
          if (window.showNotification) {
            window.showNotification("You must be logged in to list projects.", "error");
          }
          document.dispatchEvent(new CustomEvent("authStateChanged", {
            detail: { authenticated: false }
          }));
        }
      });
  }

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

  function renderProjectList(projects) {
    projectListEl.innerHTML = "";
    projects.forEach((proj) => {
      const li = document.createElement("li");
      li.classList.add(
        "flex","justify-between","items-center","bg-gray-100","p-2","mb-2","rounded"
      );
      li.textContent = `${proj.name} (ID: ${proj.id})`;

      // Edit button
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.classList.add(
        "ml-2","px-2","py-1","bg-blue-600","text-white","rounded"
      );
      editBtn.addEventListener("click", () => promptEditProject(proj));

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Delete";
      deleteBtn.classList.add(
        "ml-2","px-2","py-1","bg-red-600","text-white","rounded"
      );
      deleteBtn.addEventListener("click", () => deleteProject(proj.id));

      // Attach button
      const attachBtn = document.createElement("button");
      attachBtn.textContent = "Attach";
      attachBtn.classList.add(
        "ml-2","px-2","py-1","bg-green-600","text-white","rounded"
      );
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

  function clearFormInputs() {
    if (projNameInput) projNameInput.value = "";
    if (projSubtitleInput) projSubtitleInput.value = "";
    if (projDescInput) projDescInput.value = "";
    if (projNotesInput) projNotesInput.value = "";
  }

  // ------------------------------------------------
  // New Features: Stats, Artifacts, File Upload
  // ------------------------------------------------

  // Load project stats
  window.loadProjectStats = function loadProjectStats(projectId) {
    fetch(`/api/projects/${projectId}/stats`, {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    })
      .then(checkResponse)
      .then(data => {
        renderProjectStats(data);
      })
      .catch(err => console.error("Error loading project stats:", err));
  };

  function renderProjectStats(stats) {
    const statsContainer = document.getElementById("projectStats");
    if (!statsContainer) return;
    
    const tokenPercentage = stats.usage_percentage.toFixed(1);
    
    statsContainer.innerHTML = `
      <div class="mb-4">
          <div class="flex justify-between mb-1">
              <span>Token Usage: ${stats.token_usage.toLocaleString()} / ${stats.max_tokens.toLocaleString()}</span>
              <span>${tokenPercentage}%</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5">
              <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${tokenPercentage}%"></div>
          </div>
      </div>
      <div class="grid grid-cols-3 gap-4 text-center">
          <div class="bg-white p-3 rounded shadow">
              <div class="text-lg font-semibold">${stats.conversation_count}</div>
              <div class="text-xs text-gray-500">Conversations</div>
          </div>
          <div class="bg-white p-3 rounded shadow">
              <div class="text-lg font-semibold">${stats.file_count}</div>
              <div class="text-xs text-gray-500">Files</div>
          </div>
          <div class="bg-white p-3 rounded shadow">
              <div class="text-lg font-semibold">${stats.artifact_count}</div>
              <div class="text-xs text-gray-500">Artifacts</div>
          </div>
      </div>
    `;
  }

  // Artifact Management
  window.loadArtifacts = function loadArtifacts(projectId) {
    fetch(`/api/projects/${projectId}/artifacts`, {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    })
      .then(checkResponse)
      .then(data => renderArtifactsList(data.artifacts))
      .catch(err => console.error("Error loading artifacts:", err));
  };

  function renderArtifactsList(artifacts) {
    const artifactsListEl = document.getElementById("artifactsList");
    if (!artifactsListEl) return;
    
    artifactsListEl.innerHTML = "";
    if (!artifacts || artifacts.length === 0) {
      artifactsListEl.innerHTML = "<li class='text-gray-500'>No artifacts found</li>";
      return;
    }
    
    artifacts.forEach(artifact => {
      const li = document.createElement("li");
      li.classList.add(
        "p-2","mb-2","rounded","bg-gray-100","flex","justify-between","items-center"
      );
      
      let icon = "📄";
      if (artifact.content_type === "code") icon = "💻";
      if (artifact.content_type === "image") icon = "🖼️";
      
      li.innerHTML = `
        <div>
          <span class="mr-2">${icon}</span>
          <span class="font-medium">${artifact.name}</span> 
          <span class="text-xs text-gray-500">(${new Date(artifact.created_at).toLocaleString()})</span>
        </div>
        <div>
          <button class="view-artifact-btn text-blue-600 mr-2" data-id="${artifact.id}">View</button>
          <button class="delete-artifact-btn text-red-600" data-id="${artifact.id}">Delete</button>
        </div>
      `;
      
      artifactsListEl.appendChild(li);
    });
    
    document.querySelectorAll('.view-artifact-btn').forEach(btn => {
      btn.addEventListener('click', () => viewArtifact(btn.dataset.id));
    });
    document.querySelectorAll('.delete-artifact-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteArtifact(btn.dataset.id));
    });
  }

  function viewArtifact(artifactId) {
    console.log(`Viewing artifact: ${artifactId}`);
    // Implementation for viewing a single artifact details
  }

  function deleteArtifact(artifactId) {
    const projectId = document.getElementById('projectSelect')?.value;
    if (!projectId) {
      alert("No project selected!");
      return;
    }

    if (!confirm("Are you sure you want to delete this artifact?")) {
      return;
    }

    fetch(`/api/projects/${projectId}/artifacts/${artifactId}`, {
      method: "DELETE",
      headers: getHeaders(),
      credentials: 'include'
    })
      .then(checkResponse)
      .then(result => {
        console.log("Artifact deleted:", result);
        loadArtifacts(projectId);
      })
      .catch(err => {
        console.error("Error deleting artifact:", err);
        alert("Failed to delete artifact");
      });
  }

  // File Upload for Projects
  window.setupFileUpload = function setupFileUpload() {
    const fileUploadForm = document.getElementById('fileUploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadFileBtn');
    
    if (!fileUploadForm || !fileInput || !uploadBtn) return;
    
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Check file size (30MB limit)
      if (file.size > 30 * 1024 * 1024) {
        if (window.showNotification) {
          window.showNotification("File too large (max 30MB)", "error");
        } else {
          alert("File too large (max 30MB)");
        }
        return;
      }
      
      const formData = new FormData();
      formData.append('file', file);
      
      const projectId = document.getElementById('projectSelect')?.value;
      if (!projectId) {
        if (window.showNotification) {
          window.showNotification("Please select a project first", "error");
        } else {
          alert("Please select a project first");
        }
        return;
      }
      
      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading...";
        
        const response = await fetch(`/api/projects/${projectId}/files`, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText);
        }
        
        const result = await response.json();
        
        if (window.showNotification) {
          window.showNotification("File uploaded successfully", "success");
        } else {
          alert("File uploaded successfully");
        }
        
        // Refresh file list
        // This function must exist in your code if you want to load the file list
        // e.g., loadProjectFiles(projectId);
        
        // Reset form
        fileInput.value = '';
      } catch (error) {
        console.error("File upload error:", error);
        if (window.showNotification) {
            window.showNotification("Upload failed: " + error.message, "error");
        } else {
            alert("Upload failed: " + error.message);
        }
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload File";
      }
    });
  };
});

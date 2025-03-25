/**
 * projectEnhancements.js
 * -----------------------
 * Adds optional or extended features, hooking into the same
 * events from projectManager if desired. Avoids duplicating the
 * core load or render logic already in projectManager and projectDashboard.
 *
 * You can register additional listeners or override certain behaviors if needed.
 */

/**
 * Initialize project enhancements module
 */
function initProjectEnhancements() {
  try {
    console.log("Initializing project enhancements");

    // Listen to an event from projectManager for custom logic
    document.addEventListener("projectFilesLoaded", (e) => {
      const files = e.detail.files;
      console.log("[Enhancement] projectFilesLoaded - we have files:", files);
    });

    // Setup drag and drop file upload functionality
    setupDragDropFileUpload();

    console.log("Project enhancements initialized");
  } catch (error) {
    console.error("Project enhancements initialization failed:", error);
    throw error;
  }
}

// Export initialization function
window.initProjectEnhancements = initProjectEnhancements;

/**
   * Sets up drag and drop file upload for the project files area
   */
  function setupDragDropFileUpload() {
    const dragDropZone = document.getElementById("dragDropZone");
    
    if (!dragDropZone) {
      console.warn("Drag drop zone not found in DOM");
      return;
    }

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dragDropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Highlight drop area when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
      dragDropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dragDropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
      dragDropZone.classList.add('bg-gray-100', 'dark:bg-gray-700', 'border-blue-400');
    }

    function unhighlight() {
      dragDropZone.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'border-blue-400');
    }

    // Connect browse files button
    const browseFilesBtn = document.getElementById('browseFilesBtn');
    if (browseFilesBtn) {
      browseFilesBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
          if (e.target.files.length > 0) {
            handleFilesUpload(e.target.files);
          }
        };
        input.click();
      });
    }

    // Handle dropped files
    dragDropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
      const dt = e.dataTransfer;
      const files = dt.files;
      
      if (files.length > 0) {
        console.log(`Dropped ${files.length} files`);
        handleFilesUpload(files);
      }
    }

    /**
     * Handle uploading multiple files from drag and drop
     */
    function handleFilesUpload(files) {
      const p = window.projectManager.currentProject;
      if (!p) {
        window.showNotification?.("No project selected", "error");
        return;
      }

      // Show upload progress UI
      document.getElementById("filesUploadProgress")?.classList.remove("hidden");
      const progressBar = document.getElementById("fileProgressBar");
      const uploadStatus = document.getElementById("uploadStatus");
      
      if (progressBar) progressBar.style.width = "0%";
      if (uploadStatus) uploadStatus.textContent = `Uploading 0/${files.length} files...`;

      let completed = 0;
      let failed = 0;

      Array.from(files).forEach(file => {
        window.projectManager.uploadFile(p.id, file)
          .then(() => {
            completed++;
            updateUploadProgress(completed, failed, files.length);
          })
          .catch(err => {
            console.error("File upload error:", err);
            failed++;
            completed++;
            updateUploadProgress(completed, failed, files.length);
          });
      });
    }

    /**
     * Update the file upload progress UI
     */
    function updateUploadProgress(completed, errors, total) {
      const progressBar = document.getElementById("fileProgressBar");
      const uploadStatus = document.getElementById("uploadStatus");

      const percentage = Math.round((completed / total) * 100);
      if (progressBar) progressBar.style.width = `${percentage}%`;
      if (uploadStatus) {
        uploadStatus.textContent = `Uploading ${completed}/${total} files...`;
      }

      if (completed === total) {
        if (errors === 0) {
          if (uploadStatus) uploadStatus.textContent = "Upload complete!";
          window.showNotification?.("Files uploaded successfully", "success");
        } else {
          if (uploadStatus) uploadStatus.textContent = `Upload completed with ${errors} error(s)`;
          window.showNotification?.(`${errors} file(s) failed to upload`, "error");
        }

        // Refresh file list & stats
        if (window.projectManager.currentProject) {
          window.projectManager.loadProjectFiles(window.projectManager.currentProject.id);
          window.projectManager.loadProjectStats(window.projectManager.currentProject.id);
        }

        // Hide progress after a short delay
        setTimeout(() => {
          document.getElementById("filesUploadProgress")?.classList.add("hidden");
        }, 3000);
      }
    }
  }

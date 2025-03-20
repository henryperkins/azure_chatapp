/**
 * Enhancements Integration Script
 * 
 * This script connects our enhanced UI components and functionality to 
 * the existing codebase without modifying the original files extensively.
 */
document.addEventListener("DOMContentLoaded", () => {
  // Get references to the tab buttons and content
  const tabButtons = document.querySelectorAll(".project-tab-btn");
  
  // Enhance tab switching with smooth transitions and accessibility
  tabButtons.forEach((button, index) => {
    // Add proper ARIA attributes for accessibility
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    button.setAttribute('tabindex', index === 0 ? '0' : '-1');
    
    const tabId = button.getAttribute('data-tab');
    const tabPanel = document.getElementById(`${tabId}Tab`);
    
    if (tabPanel) {
      // Create unique IDs for ARIA relationships
      const buttonId = `tab-${tabId}`;
      const panelId = `tabpanel-${tabId}`;
      
      button.id = buttonId;
      button.setAttribute('aria-controls', panelId);
      
      tabPanel.id = panelId;
      tabPanel.setAttribute('role', 'tabpanel');
      tabPanel.setAttribute('aria-labelledby', buttonId);
      tabPanel.setAttribute('tabindex', '0');
    }
    
    button.addEventListener("click", () => {
      // Get the tab ID from the button's data attribute
      const tabId = button.getAttribute("data-tab");
      
      // Update tab button styles and ARIA attributes
      tabButtons.forEach(btn => {
        btn.classList.remove("border-b-2", "border-blue-600", "text-blue-600");
        btn.classList.add("text-gray-500");
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
      });
      
      button.classList.remove("text-gray-500");
      button.classList.add("border-b-2", "border-blue-600", "text-blue-600");
      button.setAttribute('aria-selected', 'true');
      button.setAttribute('tabindex', '0');
      
      // Show the selected tab content
      const tabContents = document.querySelectorAll(".project-tab-content");
      tabContents.forEach(content => {
        content.classList.add("hidden");
        content.setAttribute('aria-hidden', 'true');
      });
      
      const selectedTab = document.getElementById(`${tabId}Tab`);
      if (selectedTab) {
        selectedTab.classList.remove("hidden");
        selectedTab.setAttribute('aria-hidden', 'false');
      }
    });
    
    // Add keyboard navigation
    button.addEventListener('keydown', (e) => {
      let targetIndex;
      
      switch(e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          targetIndex = (index + 1) % tabButtons.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          targetIndex = index - 1 < 0 ? tabButtons.length - 1 : index - 1;
          break;
        case 'Home':
          e.preventDefault();
          targetIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          targetIndex = tabButtons.length - 1;
          break;
        default:
          return;
      }
      
      tabButtons[targetIndex].focus();
      tabButtons[targetIndex].click();
    });
  });
  
  // Enhance the file upload button and add drag and drop support
  const uploadFileBtn = document.getElementById("uploadFileBtn");
  const fileInput = document.getElementById("fileInput");
  const filesTab = document.getElementById("filesTab");
  
  if (uploadFileBtn && fileInput) {
    uploadFileBtn.addEventListener("click", () => {
      fileInput.click();
    });
    
    fileInput.addEventListener("change", (e) => {
      if (typeof window.handleFileUpload === "function") {
        window.handleFileUpload(e);
      }
    });
  }
  
  // Add drag and drop support for file uploads
  if (filesTab) {
    // Create drop zone overlay for the entire page
    const dropZone = document.createElement('div');
    dropZone.id = 'fileDropZone';
    dropZone.className = 'hidden fixed inset-0 bg-blue-500 bg-opacity-10 z-30 flex items-center justify-center';
    dropZone.innerHTML = `
      <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg border-2 border-dashed border-blue-400">
        <div class="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-blue-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p class="text-lg font-medium mb-1">Drop files here</p>
          <p class="text-sm text-gray-500">Release to upload your files</p>
        </div>
      </div>
    `;
    document.body.appendChild(dropZone);
    
    // Also set up the in-tab drag drop zone
    const dragDropZone = document.getElementById('dragDropZone');
    if (dragDropZone) {
      dragDropZone.addEventListener('click', () => {
        if (fileInput) fileInput.click();
      });
      
      // Enhance the visual appearance when files are dragged over
      ['dragenter', 'dragover'].forEach(eventName => {
        dragDropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragDropZone.classList.add('border-blue-400', 'bg-blue-50', 'dark:bg-blue-900', 'dark:bg-opacity-20');
        });
      });
      
      // Reset appearance when files leave the drop zone
      ['dragleave', 'drop'].forEach(eventName => {
        dragDropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragDropZone.classList.remove('border-blue-400', 'bg-blue-50', 'dark:bg-blue-900', 'dark:bg-opacity-20');
        });
      });
      
      // Handle file drop directly in the zone
      dragDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (window.projectManager && window.projectManager.currentProject) {
          const droppedFiles = e.dataTransfer.files;
          if (droppedFiles && droppedFiles.length > 0) {
            if (typeof window.handleFileUpload === "function") {
              // Create a synthetic event
              const syntheticEvent = { target: { files: droppedFiles } };
              window.handleFileUpload(syntheticEvent);
            }
          }
        }
      });
    }
    
    // Handle drag enter/over for the whole document
    ['dragenter', 'dragover'].forEach(eventName => {
      document.addEventListener(eventName, () => {
        // Only show if we're on the files tab and a project is loaded
        if (!document.getElementById("projectManagerPanel").classList.contains("hidden") &&
            !document.getElementById("filesTab").classList.contains("hidden") &&
            window.projectManager && window.projectManager.currentProject) {
          dropZone.classList.remove('hidden');
        }
      }, false);
    });
    
    // Handle drag leave/drop for the overlay
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('hidden');
      }, false);
    });
    
    // Handle file drop on the overlay
    dropZone.addEventListener('drop', (e) => {
      if (window.projectManager && window.projectManager.currentProject) {
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles && droppedFiles.length > 0) {
          if (typeof window.handleFileUpload === "function") {
            // Create a synthetic event
            const syntheticEvent = { target: { files: droppedFiles } };
            window.handleFileUpload(syntheticEvent);
          }
        }
      }
    }, false);
  }
  
  // Enhance the project details view
  document.addEventListener("projectLoaded", (event) => {
    if (typeof window.renderProjectDetails === "function") {
      window.renderProjectDetails(event);
    }
  });
  
  // Enhance the project stats display
  document.addEventListener("projectStatsLoaded", (event) => {
    if (typeof window.renderProjectStats === "function") {
      window.renderProjectStats(event);
    }
  });
  
  // Enhance the file listing
  document.addEventListener("projectFilesLoaded", (event) => {
    if (typeof window.renderProjectFiles === "function") {
      window.renderProjectFiles(event);
    }
  });
  
  // Enhance the conversations listing
  document.addEventListener("projectConversationsLoaded", (event) => {
    if (typeof window.renderProjectConversations === "function") {
      window.renderProjectConversations(event);
    }
  });
  
  // Enhance the artifacts listing
  document.addEventListener("projectArtifactsLoaded", (event) => {
    if (typeof window.renderProjectArtifacts === "function") {
      window.renderProjectArtifacts(event);
    }
  });
  
  // Enhance the new conversation button
  const newConversationBtn = document.getElementById("newConversationBtn");
  if (newConversationBtn) {
    newConversationBtn.addEventListener("click", () => {
      if (typeof window.startNewConversation === "function") {
        window.startNewConversation();
      }
    });
  }
  
  // Add keyboard shortcuts for project management
  document.addEventListener("keydown", (e) => {
    // Only if we're in project detail view
    if (document.getElementById("projectDetailsView")?.classList.contains("hidden")) {
      return;
    }
    
    // Ctrl/Cmd + S to switch to project Stats
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      document.querySelector('[data-tab="details"]')?.click();
    }
    
    // Ctrl/Cmd + F to switch to Files tab
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      document.querySelector('[data-tab="files"]')?.click();
    }
    
    // Ctrl/Cmd + C to switch to Conversations tab
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      e.preventDefault();
      document.querySelector('[data-tab="conversations"]')?.click();
    }
    
    // Ctrl/Cmd + A to switch to Artifacts tab
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      document.querySelector('[data-tab="artifacts"]')?.click();
    }
  });
  
  // Add mobile responsiveness enhancements
  function handleMobileLayout() {
    const isMobile = window.innerWidth < 768;
    
    // Adjust tab layout on mobile
    if (isMobile) {
      document.querySelectorAll('.project-tab-btn').forEach(btn => {
        btn.classList.add('text-xs', 'px-2');
      });
      
      // Make file upload button full width on mobile
      const uploadBtn = document.getElementById('uploadFileBtn');
      if (uploadBtn) {
        uploadBtn.classList.add('w-full', 'mt-2');
      }
    } else {
      document.querySelectorAll('.project-tab-btn').forEach(btn => {
        btn.classList.remove('text-xs', 'px-2');
      });
      
      // Restore file upload button on desktop
      const uploadBtn = document.getElementById('uploadFileBtn');
      if (uploadBtn) {
        uploadBtn.classList.remove('w-full', 'mt-2');
      }
    }
  }
  
  // Initial call and add resize listener
  handleMobileLayout();
  window.addEventListener('resize', handleMobileLayout);
  
  // Add dark mode detection and customization
  function updateDarkModeStyles() {
    const isDarkMode = document.documentElement.classList.contains('dark') || 
                       window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Find all pill badges and adjust colors for dark mode
    document.querySelectorAll('[class*="bg-"][class*="-100"]:not([data-dark-adjusted])').forEach(el => {
      if (isDarkMode) {
        // Store original classes for light mode
        el.dataset.lightClasses = el.className;
        
        // Adjust background opacity for better contrast in dark mode
        el.className = el.className
          .replace(/bg-(\w+)-100/g, 'bg-$1-900 bg-opacity-30')
          .replace(/text-(\w+)-800/g, 'text-$1-300');
      } else if (el.dataset.lightClasses) {
        // Restore light mode classes
        el.className = el.dataset.lightClasses;
      }
      
      el.dataset.darkAdjusted = 'true';
    });
    
    // Adjust file and artifact item backgrounds
    document.querySelectorAll('.file-item, .artifact-item, .conversation-item').forEach(el => {
      if (isDarkMode) {
        el.classList.remove('bg-gray-50');
        el.classList.add('bg-gray-700', 'text-gray-100');
      } else {
        el.classList.remove('bg-gray-700', 'text-gray-100');
        el.classList.add('bg-gray-50');
      }
    });
  }
  
  // Check for dark mode on load
  updateDarkModeStyles();
  
  // Watch for dark mode changes
  const darkModeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        updateDarkModeStyles();
      }
    });
  });
  
  darkModeObserver.observe(document.documentElement, { attributes: true });
  
  // Also listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateDarkModeStyles);
});
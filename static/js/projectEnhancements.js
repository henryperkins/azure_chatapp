/**
 * Project Enhancements
 * 
 * This file extends the functionality of projectManager.js with additional
 * methods for handling project resources like files, conversations, and artifacts.
 */

(function() {
  // Wait for document and other scripts to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Ensure projectManager exists
    if (!window.projectManager) {
      console.error('Project manager not initialized');
      return;
    }

    // Add missing methods to projectManager
    
    /**
     * Load project files list
     * @param {string} projectId - The ID of the project
     */
    window.projectManager.loadProjectFiles = function(projectId) {
      const projectFilesList = document.getElementById('projectFilesList');
      
      if (!projectId) {
        console.error('Project ID is required to load files');
        return;
      }
      
      // Show loading state
      projectFilesList.innerHTML = '<div class="text-center py-4"><div class="spinner"></div><p class="text-sm text-gray-500 mt-2">Loading files...</p></div>';
      
      // Fetch project files
      window.apiRequest(`/api/projects/${projectId}/files`)
        .then(files => {
          if (files && files.length > 0) {
            projectFilesList.innerHTML = '';
            
            // Render each file
            files.forEach(file => {
              const fileElement = document.createElement('div');
              fileElement.className = 'bg-white dark:bg-gray-800 p-3 rounded shadow-sm flex items-center justify-between transition-all hover:shadow-md';
              fileElement.innerHTML = `
                <div class="flex items-center">
                  <div class="mr-3 text-blue-500">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div class="font-medium">${file.filename}</div>
                    <div class="text-xs text-gray-500">${new Date(file.created_at).toLocaleString()} · ${formatFileSize(file.file_size || 0)}</div>
                  </div>
                </div>
                <div class="flex space-x-2">
                  <button class="text-blue-600 hover:text-blue-800 p-1" title="View file" data-file-id="${file.id}" data-action="view">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button class="text-red-600 hover:text-red-800 p-1" title="Delete file" data-file-id="${file.id}" data-action="delete">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              `;
              
              projectFilesList.appendChild(fileElement);
            });
            
            // Add event listeners for file actions
            addFileActionListeners();
          } else {
            projectFilesList.innerHTML = '<div class="text-gray-500 text-center py-8">No files uploaded yet</div>';
          }
        })
        .catch(error => {
          console.error('Error loading project files:', error);
          projectFilesList.innerHTML = '<div class="text-red-500 text-center py-4">Error loading files. Please try again.</div>';
        });
    };
    
    /**
     * Load project conversations with improved error handling
     * @param {string} projectId - The ID of the project
     */
    window.projectManager.loadProjectConversations = function(projectId) {
      if (!projectId) {
        console.error('Project ID is required to load conversations');
        window.showNotification?.("Invalid project ID", "error");
        return;
      }
      const conversationsList = document.getElementById('projectConversationsList');
      
      if (!projectId) {
        console.error('Project ID is required to load conversations');
        return;
      }
      
      // Show loading state
      conversationsList.innerHTML = '<div class="text-center py-4"><div class="spinner"></div><p class="text-sm text-gray-500 mt-2">Loading conversations...</p></div>';
      
      // Try different endpoints with fallbacks
      const endpoints = [
        `/api/projects/${projectId}/conversations`,
        `/api/projects/${projectId}/chats`
      ];
      
      // Function to try the next endpoint
      function tryNextEndpoint(index = 0) {
        if (index >= endpoints.length) {
          // All endpoints failed, show empty state
          console.warn('All conversation endpoints failed, showing empty state');
          conversationsList.innerHTML = '<div class="text-gray-500 text-center py-8">No conversations available. Try creating a new one.</div>';
          return;
        }
        
        window.apiRequest(endpoints[index])
          .then(conversations => {
            if (conversations && Array.isArray(conversations) && conversations.length > 0) {
              conversationsList.innerHTML = '';
              
              // Render each conversation
              conversations.forEach(conversation => {
                const conversationElement = document.createElement('div');
                conversationElement.className = 'bg-white dark:bg-gray-800 p-3 rounded shadow-sm flex items-center justify-between mb-2 transition-all hover:shadow-md';
                
                const date = new Date(conversation.created_at || conversation.timestamp || Date.now());
                const timeAgo = formatTimeAgo(date);
                
                conversationElement.innerHTML = `
                  <div>
                    <div class="font-medium">${conversation.title || conversation.name || 'Untitled Conversation'}</div>
                    <div class="text-xs text-gray-500">${timeAgo} · ${conversation.message_count || conversation.messages?.length || 0} messages</div>
                  </div>
                  <div class="flex space-x-2">
                    <button class="text-blue-600 hover:text-blue-800 p-1" title="Open conversation" data-conversation-id="${conversation.id}" data-action="open">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </button>
                    <button class="text-red-600 hover:text-red-800 p-1" title="Delete conversation" data-conversation-id="${conversation.id}" data-action="delete">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                `;
                
                conversationsList.appendChild(conversationElement);
              });
              
              // Add event listeners for conversation actions
              addConversationActionListeners();
            } else {
              conversationsList.innerHTML = '<div class="text-gray-500 text-center py-8">No conversations yet.</div>';
            }
          })
          .catch(error => {
            console.warn(`Error loading conversations from ${endpoints[index]}:`, error);
            // Try the next endpoint
            tryNextEndpoint(index + 1);
          });
      }
      
      // Start trying endpoints
      tryNextEndpoint();
    };
    
    /**
     * Load project artifacts
     * @param {string} projectId - The ID of the project
     */
    window.projectManager.loadProjectArtifacts = function(projectId) {
      const artifactsList = document.getElementById('projectArtifactsList');
      
      if (!projectId) {
        console.error('Project ID is required to load artifacts');
        return;
      }
      
      // Show loading state
      artifactsList.innerHTML = '<div class="text-center py-4"><div class="spinner"></div><p class="text-sm text-gray-500 mt-2">Loading artifacts...</p></div>';
      
      // Fetch project artifacts
      window.apiRequest(`/api/projects/${projectId}/artifacts`)
        .then(artifacts => {
          if (artifacts && artifacts.length > 0) {
            artifactsList.innerHTML = '';
            
            // Render each artifact
            artifacts.forEach(artifact => {
              const artifactElement = document.createElement('div');
              artifactElement.className = 'bg-white dark:bg-gray-800 p-3 rounded shadow-sm mb-3 transition-all hover:shadow-md';
              
              const date = new Date(artifact.created_at);
              const timeAgo = formatTimeAgo(date);
              
              artifactElement.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                  <div class="font-medium">${artifact.title || 'Unnamed Artifact'}</div>
                  <div class="text-xs text-gray-500">${timeAgo}</div>
                </div>
                <div class="text-sm text-gray-700 dark:text-gray-300 mb-2 line-clamp-2">
                  ${artifact.description || 'No description provided'}
                </div>
                <div class="flex justify-end space-x-2">
                  <button class="text-blue-600 hover:text-blue-800 text-xs font-medium" data-artifact-id="${artifact.id}" data-action="view">
                    View Details
                  </button>
                  <button class="text-red-600 hover:text-red-800 text-xs font-medium" data-artifact-id="${artifact.id}" data-action="delete">
                    Delete
                  </button>
                </div>
              `;
              
              artifactsList.appendChild(artifactElement);
            });
            
            // Add event listeners for artifact actions
            addArtifactActionListeners();
          } else {
            artifactsList.innerHTML = '<div class="text-gray-500 text-center py-8">No artifacts generated yet.</div>';
          }
        })
        .catch(error => {
          console.error('Error loading artifacts:', error);
          artifactsList.innerHTML = '<div class="text-red-500 text-center py-4">Error loading artifacts. Please try again.</div>';
        });
    };
    
    /**
     * Update project with all required fields to avoid 422 errors
     * @param {string} projectId - The ID of the project
     * @param {object} updateData - The data to update
     */
    window.projectManager.updateProjectData = function(projectId, updateData) {
      if (!projectId) {
        console.error('Project ID is required for updates');
        return Promise.reject(new Error('Project ID is required'));
      }
      
      // Get current project data first
      return window.apiRequest(`/api/projects/${projectId}`, { method: 'GET' })
        .then(projectData => {
          // Prepare complete update payload with all required fields
          const completeUpdateData = {
            name: updateData.name || projectData.name,
            description: updateData.description || projectData.description,
            goals: updateData.goals || projectData.goals,
            custom_instructions: updateData.custom_instructions || projectData.custom_instructions,
            max_tokens: updateData.max_tokens || projectData.max_tokens,
            is_default: updateData.is_default !== undefined ? updateData.is_default : projectData.is_default,
            pinned: updateData.pinned !== undefined ? updateData.pinned : projectData.pinned,
            archived: updateData.archived !== undefined ? updateData.archived : projectData.archived,
            extra_data: updateData.extra_data || projectData.extra_data || {}
          };
          
          // Send complete update to avoid 422 errors
          return window.apiRequest(`/api/projects/${projectId}`, {
            method: 'PUT',
            body: JSON.stringify(completeUpdateData)
          });
        });
    };
    
    // Add the missing createNewChat function to the window
    window.createNewChat = function(projectId = null) {
      // Show loading state
      showNotification('Creating new conversation...', 'info');
      
      const payload = {};
      if (projectId) {
        payload.project_id = projectId;
      }
      
      return window.apiRequest('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      .then(chatData => {
        showNotification('Conversation created successfully', 'success');
        
        // Redirect to the chat with the new ID
        window.location.href = `/?chatId=${chatData.id}`;
        return chatData;
      })
      .catch(error => {
        console.error('Error creating new chat:', error);
        showNotification('Failed to create new conversation', 'error');
        throw error;
      });
    };
    
    // Helper functions
    
    function formatFileSize(bytes) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function formatTimeAgo(date) {
      const now = new Date();
      const diff = now - date;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      
      if (days > 7) {
        return date.toLocaleDateString();
      } else if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
      } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
      } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
      } else {
        return 'Just now';
      }
    }
    
    function addFileActionListeners() {
      document.querySelectorAll('[data-action="view"][data-file-id]').forEach(button => {
        button.addEventListener('click', function() {
          const fileId = this.getAttribute('data-file-id');
          // Implement file viewing functionality
          window.open(`/api/files/${fileId}/content`, '_blank');
        });
      });
      
      document.querySelectorAll('[data-action="delete"][data-file-id]').forEach(button => {
        button.addEventListener('click', function() {
          const fileId = this.getAttribute('data-file-id');
          if (confirm('Are you sure you want to delete this file? This action cannot be undone.')) {
            deleteFile(fileId);
          }
        });
      });
    }
    
    function addConversationActionListeners() {
      document.querySelectorAll('[data-action="open"][data-conversation-id]').forEach(button => {
        button.addEventListener('click', function() {
          const conversationId = this.getAttribute('data-conversation-id');
          window.location.href = `/?chatId=${conversationId}`;
        });
      });
      
      document.querySelectorAll('[data-action="delete"][data-conversation-id]').forEach(button => {
        button.addEventListener('click', function() {
          const conversationId = this.getAttribute('data-conversation-id');
          if (confirm('Are you sure you want to delete this conversation? This action cannot be undone.')) {
            deleteConversation(conversationId);
          }
        });
      });
    }
    
    function addArtifactActionListeners() {
      document.querySelectorAll('[data-action="view"][data-artifact-id]').forEach(button => {
        button.addEventListener('click', function() {
          const artifactId = this.getAttribute('data-artifact-id');
          viewArtifact(artifactId);
        });
      });
      
      document.querySelectorAll('[data-action="delete"][data-artifact-id]').forEach(button => {
        button.addEventListener('click', function() {
          const artifactId = this.getAttribute('data-artifact-id');
          if (confirm('Are you sure you want to delete this artifact? This action cannot be undone.')) {
            deleteArtifact(artifactId);
          }
        });
      });
    }
    
    // API functions for actions
    
    function deleteFile(fileId) {
      window.apiRequest(`/api/files/${fileId}`, { method: 'DELETE' })
        .then(() => {
          showNotification('File deleted successfully', 'success');
          if (window.projectManager.currentProjectId) {
            window.projectManager.loadProjectFiles(window.projectManager.currentProjectId);
          }
        })
        .catch(error => {
          console.error('Error deleting file:', error);
          showNotification('Failed to delete file', 'error');
        });
    }
    
    function deleteConversation(conversationId) {
      window.apiRequest(`/api/chat/${conversationId}`, { method: 'DELETE' })
        .then(() => {
          showNotification('Conversation deleted successfully', 'success');
          if (window.projectManager.currentProjectId) {
            window.projectManager.loadProjectConversations(window.projectManager.currentProjectId);
          }
        })
        .catch(error => {
          console.error('Error deleting conversation:', error);
          showNotification('Failed to delete conversation', 'error');
        });
    }
    
    function viewArtifact(artifactId) {
      window.apiRequest(`/api/artifacts/${artifactId}`)
        .then(artifact => {
          // Create a modal to display the artifact
          const modal = document.createElement('div');
          modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
          modal.id = 'artifactModal';
          
          modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-semibold">${artifact.title || 'Artifact Details'}</h3>
                <button id="closeArtifactModal" class="text-gray-500 hover:text-gray-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div class="mb-4">
                <p class="text-sm text-gray-500">Created: ${new Date(artifact.created_at).toLocaleString()}</p>
              </div>
              <div class="mb-4">
                <h4 class="font-medium mb-2">Description</h4>
                <p class="text-gray-700 dark:text-gray-300">${artifact.description || 'No description provided'}</p>
              </div>
              <div class="mb-4">
                <h4 class="font-medium mb-2">Content</h4>
                <div class="bg-gray-100 dark:bg-gray-700 p-4 rounded overflow-x-auto">
                  <pre class="text-sm">${artifact.content || 'No content available'}</pre>
                </div>
              </div>
              <div class="flex justify-end">
                <button id="downloadArtifactBtn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                  Download Content
                </button>
              </div>
            </div>
          `;
          
          document.body.appendChild(modal);
          
          // Close modal action
          document.getElementById('closeArtifactModal').addEventListener('click', function() {
            document.body.removeChild(modal);
          });
          
          // Download action
          document.getElementById('downloadArtifactBtn').addEventListener('click', function() {
            const blob = new Blob([artifact.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${artifact.title || 'artifact'}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          });
        })
        .catch(error => {
          console.error('Error viewing artifact:', error);
          showNotification('Failed to load artifact details', 'error');
        });
    }
    
    function deleteArtifact(artifactId) {
      window.apiRequest(`/api/artifacts/${artifactId}`, { method: 'DELETE' })
        .then(() => {
          showNotification('Artifact deleted successfully', 'success');
          if (window.projectManager.currentProjectId) {
            window.projectManager.loadProjectArtifacts(window.projectManager.currentProjectId);
          }
        })
        .catch(error => {
          console.error('Error deleting artifact:', error);
          showNotification('Failed to delete artifact', 'error');
        });
    }
    
    // Update event listeners for the "New Chat" button
    document.getElementById('newChatBtn').addEventListener('click', function() {
      window.createNewChat();
    });
    
    // Update event listener for the "New Conversation" button in project view
    document.getElementById('newConversationBtn').addEventListener('click', function() {
      const projectId = window.projectManager.currentProjectId;
      if (projectId) {
        window.createNewChat(projectId);
      } else {
        showNotification('No project selected', 'error');
      }
    });
    
    console.log('Project Enhancements loaded');
  });
})();

/**
 * chatExtensions.js
 * ------------------------
 * Additional chat functionality that extends the core chat.js file
 * - Chat title editing
 * - Additional conversation actions
 */

/**
 * Initializes chat extensions module
 */
function initChatExtensions() {
  try {
    setupChatTitleEditing();
    console.log("Chat extensions initialized");
  } catch (error) {
    console.error("Chat extensions initialization failed:", error);
  }
}

// Export initialization function
window.initChatExtensions = initChatExtensions;

/**
 * Sets up the chat title editing functionality
 */
function setupChatTitleEditing() {
  const editTitleBtn = document.getElementById('chatTitleEditBtn');
  const chatTitleEl = document.getElementById('chatTitle');

  if (!editTitleBtn || !chatTitleEl) {
    console.warn('Chat title edit elements not found in DOM');
    return;
  }

  editTitleBtn.addEventListener('click', () => {
    // Already in edit mode?
    if (chatTitleEl.getAttribute('contenteditable') === 'true') {
      return;
    }

    // Store the original title in case we need to revert
    const originalTitle = chatTitleEl.textContent;

    // Make the title editable
    chatTitleEl.setAttribute('contenteditable', 'true');
    chatTitleEl.classList.add('border', 'border-blue-400', 'px-2', 'focus:outline-none', 'focus:ring-1', 'focus:ring-blue-500');
    chatTitleEl.focus();

    // Select all text in the editable element
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(chatTitleEl);
    selection.removeAllRanges();
    selection.addRange(range);

    // Change the edit button to a save button
    editTitleBtn.textContent = 'Save';

    // Handle editing completion
    const completeEditing = async (save) => {
      // Remove editable state
      chatTitleEl.setAttribute('contenteditable', 'false');
      chatTitleEl.classList.remove('border', 'border-blue-400', 'px-2', 'focus:outline-none', 'focus:ring-1', 'focus:ring-blue-500');

      // Restore the edit button
      editTitleBtn.textContent = 'Edit';

      if (!save) {
        // Revert to original title
        chatTitleEl.textContent = originalTitle;
        return;
      }

      // Get the new title, trimming whitespace
      const newTitle = chatTitleEl.textContent.trim();

      // Don't save if empty
      if (!newTitle) {
        chatTitleEl.textContent = originalTitle;
        window.showNotification?.('Title cannot be empty', 'error');
        return;
      }

      // Don't save if unchanged
      if (newTitle === originalTitle) {
        return;
      }

      // Save the new title
      try {
        const isAuthenticated = await window.auth.isAuthenticated();
        if (!isAuthenticated || !window.CHAT_CONFIG?.chatId) {
          window.showNotification?.('No active conversation', 'error');
          chatTitleEl.textContent = originalTitle;
          return;
        }

        const token = await window.auth.getAuthToken();
        const chatId = window.CHAT_CONFIG.chatId;
        const endpoint = window.CHAT_CONFIG?.projectId
          ? `/api/projects/${window.CHAT_CONFIG.projectId}/conversations/${chatId}`
          : `/api/projects/no_project_specified/conversations/${chatId}`;

        await window.apiRequest(endpoint, 'PATCH', { title: newTitle }, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        window.showNotification?.('Conversation title updated', 'success');

        // Update sidebar if conversation list exists
        if (typeof window.loadConversationList === 'function') {
          setTimeout(() => window.loadConversationList(), 500);
        }
      } catch (error) {
        console.error('Failed to update conversation title:', error);
        window.auth.handleAuthError(error, 'Updating conversation title');
        chatTitleEl.textContent = originalTitle;
      }
    };

    // Handle save button click
    const originalClickHandler = editTitleBtn.onclick;
    editTitleBtn.onclick = () => {
      completeEditing(true);
      editTitleBtn.onclick = originalClickHandler;
    };

    // Handle Enter key and Escape key
    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        completeEditing(true);
        chatTitleEl.removeEventListener('keydown', keyHandler);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        completeEditing(false);
        chatTitleEl.removeEventListener('keydown', keyHandler);
      }
    };

    chatTitleEl.addEventListener('keydown', keyHandler);

    // Handle clicking outside
    const clickOutsideHandler = (e) => {
      if (e.target !== chatTitleEl && e.target !== editTitleBtn) {
        completeEditing(true);
        document.removeEventListener('click', clickOutsideHandler);
      }
    };

    // Small delay to avoid immediate triggering
    setTimeout(() => {
      document.addEventListener('click', clickOutsideHandler);
    }, 100);
  });
}

/**
 * app.js
 * ----------------------------------------------------------------------------
 * A production-ready, high-level orchestrator for the Azure OpenAI Chat Application.
 * - Manages global UI elements (sidebar, modals, top nav).
 * - Checks user session state (JWT) for offline/online status.
 * - Implements ephemeral notifications for successes/errors.
 * - Handles keyboard shortcuts for re-generating chat messages, copying content, etc.
 * - Supports mobile device optimizations (responsive toggles, orientation handling).
 * - Ensures advanced accessibility (keyboard nav, ARIA attributes, etc.).
 */

document.addEventListener("DOMContentLoaded", () => {
  // -----------------------------
  // DOM References
  // -----------------------------
  const sidebarEl = document.getElementById("mainSidebar");
  const navToggleBtn = document.getElementById("navToggleBtn");
  const userStatusEl = document.getElementById("userStatus"); // e.g. a <span> that shows "Online" or "Offline"
  const notificationArea = document.getElementById("notificationArea"); // a container for ephemeral toasts

  // For advanced mobile device handling
  handleWindowResize();
  window.addEventListener("resize", handleWindowResize);

  // Session check on load
  updateUserSessionState();

  // Keyboard shortcuts
  setupGlobalKeyboardShortcuts();

  // Event Listeners
  if (navToggleBtn && sidebarEl) {
    navToggleBtn.addEventListener("click", toggleSidebar);
  }

  // Example of listening for project updates globally
  document.addEventListener("projectUpdated", (e) => {
    // e.detail might contain project info, refresh UI accordingly
    console.log("Global event: 'projectUpdated' triggered, detail:", e.detail);
  });

  // Example of listening for "sessionExpired" event from auth.js 
  document.addEventListener("sessionExpired", () => {
    showNotification("Your session has expired. Please log in again.", "error");
    updateUserSessionState();
  });

  // Set up sidebar project search
  const sidebarProjectSearch = document.getElementById("sidebarProjectSearch");
  if (sidebarProjectSearch) {
    sidebarProjectSearch.addEventListener("input", (e) => {
      searchSidebarProjects(e.target.value);
    });
  }
  
  // Functions for sidebar projects
  window.loadSidebarProjects = function() {
    apiRequest("/api/projects")
      .then(response => {
        const projects = Array.isArray(response.data) ? response.data : [];
        const sidebarProjects = document.getElementById("sidebarProjects");
        if (!sidebarProjects) return;
        
        sidebarProjects.innerHTML = "";
        
        if (projects.length === 0) {
          const li = document.createElement("li");
          li.className = "text-gray-500 text-center";
          li.textContent = "No projects found";
          sidebarProjects.appendChild(li);
          return;
        }
        
        projects.forEach(project => {
          const li = document.createElement("li");
          li.className = "p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center";
          li.dataset.projectId = project.id;
          
          const nameSpan = document.createElement("span");
          nameSpan.textContent = project.name;
          nameSpan.className = "flex-1 truncate";
          
          li.appendChild(nameSpan);
          
          if (project.pinned) {
            const pinIcon = document.createElement("span");
            pinIcon.textContent = "📌";
            pinIcon.className = "ml-1 text-yellow-600";
            li.appendChild(pinIcon);
          }
          
          li.addEventListener("click", () => {
            localStorage.setItem("selectedProjectId", project.id);
            if (typeof window.projectManager?.loadProjectDetails === "function") {
              window.projectManager.loadProjectDetails(project.id);
            }
          });
          
          sidebarProjects.appendChild(li);
        });
      })
      .catch(err => {
        console.error("Error loading sidebar projects:", err);
      });
  };
  
  window.searchSidebarProjects = function(term) {
    if (!term) {
      // If search is cleared, reload all projects
      document.querySelectorAll("#sidebarProjects li").forEach(li => {
        li.classList.remove("hidden");
      });
      return;
    }
    
    term = term.toLowerCase();
    document.querySelectorAll("#sidebarProjects li").forEach(li => {
      const projectName = li.querySelector("span")?.textContent?.toLowerCase() || "";
      const isMatch = projectName.includes(term);
      li.classList.toggle("hidden", !isMatch);
    });
  };
  
  // Set up sidebar new project button
  const sidebarNewProjectBtn = document.getElementById("sidebarNewProjectBtn");
  if (sidebarNewProjectBtn) {
    sidebarNewProjectBtn.addEventListener("click", () => {
      if (typeof window.projectManager?.showProjectCreateForm === "function") {
        window.projectManager.showProjectCreateForm();
      } else {
        document.getElementById("createProjectBtn")?.click();
      }
    });
  }

  // Automatically load the conversation list if the element is present
  if (document.getElementById('sidebarConversations')) {
    loadConversationList();
  }

  // Add a "New Standalone Chat" button to the sidebar
  const sidebarNewChatBtn = document.createElement('button');
  sidebarNewChatBtn.id = "sidebarNewChatBtn";
  sidebarNewChatBtn.className = "w-full text-left p-2 bg-blue-500 hover:bg-blue-600 text-white rounded mt-2 flex items-center";
  sidebarNewChatBtn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg> New Standalone Chat';
  sidebarNewChatBtn.addEventListener('click', () => {
    // Clear selected project to create a standalone chat
    localStorage.removeItem("selectedProjectId");
    // Trigger new chat creation
    if (typeof window.createNewChat === 'function') {
      window.createNewChat();
    }
  });
  
  const sidebarActions = document.querySelector('#sidebarActions') || document.querySelector('#mainSidebar');
  if (sidebarActions) {
    sidebarActions.appendChild(sidebarNewChatBtn);
  }
  
  // Call the improved authentication function after existing setup
  checkAndHandleAuth();
});

/**
 * Load the user's conversation list, relying solely on cookie-based auth.
 */
function loadConversationList() {
  const selectedProjectId = localStorage.getItem("selectedProjectId");
  
  // Use standalone endpoint if no project is selected
  const endpoint = selectedProjectId 
    ? `/api/projects/${selectedProjectId}/conversations`
    : `/api/chat/conversations`;
  
  apiRequest(endpoint)
    .then((data) => {
      const container = document.getElementById('sidebarConversations');
      if (!container) return;
      container.innerHTML = '';
      if (data.conversations && data.conversations.length > 0) {
        data.conversations.forEach((item) => {
          const li = document.createElement('li');
          li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center justify-between';
          li.innerHTML = `
            <span class="truncate">${item.title || 'Conversation ' + item.id}</span>
            ${item.project_id ? '<span class="text-xs text-gray-500 ml-2">(Project)</span>' : ''}
          `;
          li.addEventListener('click', () => {
            window.history.pushState({}, '', `/?chatId=${item.id}`);
            // Show chat UI and hide "no chat" message
            const chatUI = document.getElementById("chatUI");
            const noChatMsg = document.getElementById("noChatSelectedMessage");
            if (chatUI) chatUI.classList.remove("hidden");
            if (noChatMsg) noChatMsg.classList.add("hidden");
            // Update chat title and load messages
            const chatTitleEl = document.getElementById("chatTitle");
            if (chatTitleEl) chatTitleEl.textContent = item.title;
            if (typeof window.loadConversation === 'function') {
              window.loadConversation(item.id);
            }
          });
          container.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.className = 'text-gray-500';
        li.textContent = 'No conversations yet—Begin now!';
        container.appendChild(li);
      }
    })
    .catch((err) => {
      console.error('Error loading conversation list:', err);
    });
}

// ---------------------------------------------------------------------
// Improved authentication handling (updated)
// ---------------------------------------------------------------------
function checkAndHandleAuth() {
  apiRequest("/api/auth/verify")
    .then(resp => {
      // User is authenticated - load data
      const selectedProjectId = localStorage.getItem("selectedProjectId");
      // Always load conversations (either project-specific or standalone)
      loadConversationList();
      
      // Load projects list
      if (typeof window.projectManager?.loadProjects === "function") {
        window.projectManager.loadProjects();
        loadSidebarProjects();
      }
      
      if (window.CHAT_CONFIG?.chatId) {
        if (typeof window.loadConversation === 'function') {
          window.loadConversation(window.CHAT_CONFIG.chatId);
        }
      }
      document.getElementById("userMenu")?.classList.remove("hidden");
      document.getElementById("authButton")?.classList.add("hidden");
      
      // Show chat UI if a chat is selected
      if (window.CHAT_CONFIG?.chatId) {
        document.getElementById("chatUI")?.classList.remove("hidden");
        document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
      }

      // Hide login required message (if any)
      const loginRequiredMessage = document.getElementById("loginRequiredMessage");
      if (loginRequiredMessage) {
        loginRequiredMessage.classList.add("hidden");
      }
    })
    .catch(err => {
      // User is not authenticated - show login dialog
      document.getElementById("userMenu")?.classList.add("hidden");
      document.getElementById("authButton")?.classList.remove("hidden");
      
      // Show a notification that login is required
      if (window.showNotification) {
        window.showNotification("Please log in to use the application", "info");
      }

      // Show login required message
      const loginRequiredMessage = document.getElementById("loginRequiredMessage");
      if (loginRequiredMessage) {
        loginRequiredMessage.classList.remove("hidden");
      }

      // Hide content that requires authentication
      document.getElementById("chatUI")?.classList.add("hidden");
      document.getElementById("projectManagerPanel")?.classList.add("hidden");
      document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
      
      console.error("Auth check failed:", err);
    });

  // Add event listener for the login button
  const showLoginBtn = document.getElementById("showLoginBtn");
  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      document.getElementById("authButton")?.click();
    });
  }
}
// ---------------------------------------------------------------------

function updateUserSessionState() {
  const authStatus = document.getElementById("authStatus");
  apiRequest("/api/auth/verify")
    .then(resp => {
      if(authStatus) {
        authStatus.textContent = "Authenticated";
        authStatus.classList.remove("text-red-600");
        authStatus.classList.add("text-green-600");
      }
    })
    .catch(err => {
      if(authStatus) {
        authStatus.textContent = "Not Authenticated";
        authStatus.classList.remove("text-green-600");
        authStatus.classList.add("text-red-600");
      }
      console.error("Auth check failed:", err);
    });
}

/**
 * Toggles the main sidebar for mobile or small screens.
 */
function toggleSidebar() {
  const sidebarEl = document.getElementById("mainSidebar");
  const toggleBtn = document.getElementById("navToggleBtn");
  if (sidebarEl && toggleBtn) {
    const isExpanded = toggleBtn.getAttribute("aria-expanded") === "true";
    toggleBtn.setAttribute("aria-expanded", !isExpanded);
    sidebarEl.classList.toggle("hidden");
    // Add mobile-specific positioning
    if (window.innerWidth < 768) {
      sidebarEl.classList.toggle("fixed");
      sidebarEl.classList.toggle("inset-0");
      sidebarEl.classList.toggle("z-50");
    }
  }
}

/**
 * Adapts layout for mobile or desktop on window resize.
 */
function handleWindowResize() {
  const sidebarEl = document.getElementById("mainSidebar");
  if (!sidebarEl) return;

  // Remove mobile-specific classes on desktop
  if (window.innerWidth >= 768) {
    sidebarEl.classList.remove("fixed", "inset-0", "z-50");
  }
}

/**
 * Sets up keyboard shortcuts for improved accessibility:
 *  - Ctrl/Cmd + R => Ask chat.js to regenerate the last message
 *  - Ctrl/Cmd + C => Copy the last assistant message or selected text
 */
function setupGlobalKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      // Regenerate
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        // Dispatch a custom event "regenerateChat"
        document.dispatchEvent(new CustomEvent("regenerateChat"));
      }
      // Copy
      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("copyMessage"));
      }
    }
  });
}

/**
 * Displays ephemeral notifications (toasts) in the notificationArea.
 * @param {String} msg - The message to display
 * @param {String} type - "success", "error", or "info"
 */
function showNotification(msg, type = "info") {
  const notificationArea = document.getElementById("notificationArea");
  if (!notificationArea) {
    console.warn("No notificationArea found in DOM.");
    return;
  }
  const toast = document.createElement("div");
  toast.classList.add(
    "mb-2",
    "px-4",
    "py-2",
    "rounded",
    "shadow",
    "text-white",
    "transition-opacity",
    "opacity-0"
  );

  switch (type) {
    case "success":
      toast.classList.add("bg-green-600");
      break;
    case "error":
      toast.classList.add("bg-red-600");
      break;
    default:
      toast.classList.add("bg-gray-700");
  }
  toast.textContent = msg;

  notificationArea.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.classList.remove("opacity-0");
  });

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 3000);
}

// Expose showNotification globally if needed
window.showNotification = showNotification;

/**
 * Listen to authStateChanged for UI updates
 */
document.addEventListener("authStateChanged", (e) => {
  const authStatus = document.getElementById("authStatus");
  const authButton = document.getElementById("authButton");
  const userMenu = document.getElementById("userMenu");
  const chatUI = document.getElementById("chatUI");
  const projectManagerPanel = document.getElementById("projectManagerPanel");

  if (e.detail.authenticated) {
    // Update UI for authenticated user
    if (authButton) authButton.classList.add("hidden");
    if (userMenu) userMenu.classList.remove("hidden");
    
    // Show authenticated content
    [chatUI, projectManagerPanel].forEach(el => el?.classList.remove("hidden"));
    authStatus.textContent = "Authenticated";
    authStatus.classList.replace("text-red-600", "text-green-600");

    // Load user data
    loadConversationList();
    // Load projects list
    if (typeof window.projectManager?.loadProjects === "function") {
      window.projectManager.loadProjects();
      loadSidebarProjects();
    }
    if (window.CHAT_CONFIG?.chatId) {
      if (typeof window.loadConversation === "function") {
        window.loadConversation(window.CHAT_CONFIG.chatId);
      }
    }
  } else {
    // Update UI for unauthenticated user
    if (authButton) authButton.classList.remove("hidden");
    if (userMenu) userMenu.classList.add("hidden");
    
    // Hide authenticated content
    [chatUI, projectManagerPanel].forEach(el => el?.classList.add("hidden"));
    authStatus.textContent = "Not Authenticated";
    authStatus.classList.replace("text-green-600", "text-red-600");

    // Clear conversation area
    const conversationArea = document.getElementById("conversationArea");
    if (conversationArea) conversationArea.innerHTML = "";
  }
});

window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');
  if (chatId) {
    document.getElementById("chatUI")?.classList.remove("hidden");
    if (typeof window.loadConversation === 'function') {
      window.loadConversation(chatId);
    }
    document.getElementById("noChatSelectedMessage")?.classList.add("hidden");
  } else {
    document.getElementById("chatUI")?.classList.add("hidden");
    document.getElementById("noChatSelectedMessage")?.classList.remove("hidden");
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    // Implement focus trapping logic if needed
  }
});

// NEW UTILITY FUNCTIONS TO REDUCE DUPLICATION

/**
 * Standardized API request function to eliminate duplicate fetch code
 * @param {String} url - The URL to fetch
 * @param {String|Object} methodOrOptions - HTTP method (GET, POST, etc) or options object
 * @param {Object} data - Request body for POST/PUT/PATCH
 * @param {Object} additionalOptions - Additional fetch options
 * @returns {Promise} - Resolves to parsed JSON response
 */
window.apiRequest = async function(url, methodOrOptions = "GET", data = null) {
  const token = document.cookie.split('; ')
    .find(row => row.startsWith('access_token='))
    ?.split('=')[1];

  const options = {
    method: typeof methodOrOptions === 'string' ? methodOrOptions : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    credentials: 'include'
  };

  if (data) options.body = JSON.stringify(data);
  
  // Validate UUID format for conversation IDs
  if (url.includes('/conversations/')) {
    const parts = url.split('/');
    const idIndex = parts.findIndex(p => p === 'conversations') + 1;
    if (idIndex > 0 && idIndex < parts.length && !isValidUUID(parts[idIndex])) {
      throw new Error(`Invalid UUID format: ${parts[idIndex]}`);
    }
  }

  function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  }
  
  try {
    console.log(`API ${fetchOptions.method} request to ${url}`, fetchOptions.body ? 'with data' : '');
    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API error response (${response.status}):`, errorText);
      try {
        const jsonError = JSON.parse(errorText);
        throw new Error(jsonError.detail || jsonError.message || `Error ${response.status}`);
      } catch (e) {
        throw new Error(`${response.status}: ${errorText}`);
      }
    }
    
    // For no-content responses
    if (response.status === 204) {
      return {};
    }
    
    // Parse JSON response
    const responseData = await response.json();
    
    // Handle our standard { data: ..., success: true } format
    if (responseData && responseData.data !== undefined) {
      return responseData;
    }
    
    // For other formats, wrap in our standard format
    return { 
      data: responseData, 
      success: true 
    };
  } catch (error) {
    console.error(`API request failed: ${url}`, error);
    throw error;
  }
};

/**
 * Form data serialization helper
 * @param {HTMLFormElement} form - The form to serialize
 * @returns {Object} - Form data as key-value pairs
 */
window.serializeForm = function(form) {
  const formData = new FormData(form);
  const data = {};
  
  for (let [key, value] of formData.entries()) {
    data[key] = value;
  }
  
  return data;
};

/**
 * Form validation helper
 * @param {HTMLFormElement} form - The form to validate
 * @returns {Object} - Validation result with isValid flag and errors
 */
window.validateForm = function(form) {
  const data = window.serializeForm(form);
  const errors = {};
  
  // Check required fields
  Array.from(form.elements).forEach(el => {
    if (el.required && !el.value.trim()) {
      errors[el.name] = "This field is required";
    }
  });
  
  return {
    isValid: Object.keys(errors).length === 0,
    data,
    errors
  };
};

/**
 * DOM manipulation helper
 * @param {String} selector - CSS selector
 * @param {HTMLElement} context - Context element (optional)
 * @returns {HTMLElement} - Found element or null
 */
window.find = function(selector, context = document) {
  return context.querySelector(selector);
};

/**
 * Create HTML element with attributes and children
 * @param {String} tag - Element tag name
 * @param {Object} attrs - Element attributes
 * @param {Array|String} children - Child elements or text content
 * @returns {HTMLElement} - Created element
 */
window.createElement = function(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  
  // Set attributes
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.entries(value).forEach(([dataKey, dataValue]) => {
        el.dataset[dataKey] = dataValue;
      });
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.substring(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  });
  
  // Add children
  if (typeof children === 'string') {
    el.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        el.appendChild(child);
      }
    });
  }
  
  return el;
};
window.showProjectSelection = function() {
    return new Promise(async (resolve) => {
        // Fetch available projects
        const { data: projects } = await window.apiRequest("/api/projects?filter=active");
        
        // Create modal elements
        const modal = document.createElement("div");
        modal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50";
        
        const modalContent = document.createElement("div");
        modalContent.className = "bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md";
        
        // Build project selection UI
        modalContent.innerHTML = `
          <h3 class="text-lg font-medium mb-4">Select a Project</h3>
          <div class="space-y-2" id="projectSelectionList"></div>
          <div class="mt-6 flex justify-end space-x-2">
            <button 
              type="button" 
              class="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              onclick="this.closest('.fixed').remove(); resolve(null)"
            >
              Skip
            </button>
          </div>
        `;
    
        // Populate project list
        const projectList = modalContent.querySelector("#projectSelectionList");
        
        if (projects.length === 0) {
          projectList.innerHTML = `
            <div class="text-center p-4 text-gray-500">
              No projects found. <a href="/projects" class="text-blue-600 hover:underline">Create one first?</a>
            </div>
          `;
        } else {
          projects.forEach(project => {
            const projectButton = document.createElement("button");
            projectButton.className = "w-full text-left p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";
            projectButton.innerHTML = `
              <span class="font-medium">${project.name}</span>
              ${project.description ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">${project.description}</p>` : ''}
            `;
            projectButton.onclick = () => {
              modal.remove();
              resolve(project.id);
            };
            projectList.appendChild(projectButton);
          });
        }
    
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
    });
};

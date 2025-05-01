/****
 * Chat Manager Module
 *
 * Provides a complete chat interface implementation with conversation management,
 * message handling, and UI integration. Designed to work within the application's
 * dependency injection system.
 *
 * Key Features:
 * - Manages chat conversations (create, loading, deletion)
 * - Handles message sending with queuing and error handling
 * - Supports image attachments with size validation
 * - Provides UI integration for chat display and input
 * - Implements model configuration management
 * - Includes comprehensive error handling and user feedback
 *
 * Dependencies:
 * - External:
 *   - DOMPurify: For XSS protection in message rendering
 * - Internal:
 *   - ./utils/globalUtils.js: Provides authentication and validation utilities
 *   - DependencySystem: For accessing shared modules (app, eventHandlers, etc.)
 *
 * Exports:
 * - Factory function `createChatManager()` that returns a configured ChatManager instance
 *
 * Usage Example:
 * ```
 * const chatManager = createChatManager({
 *   DependencySystem, // Required
 *   app,             // Optional (will be resolved via DependencySystem if not provided)
 *   eventHandlers,   // Optional
 *   modelConfig,     // Optional
 *   projectDetailsComponent // Optional
 * });
 * await chatManager.initialize({ projectId: '123' });
 * ```
 ****/

import { isValidProjectId, isAuthenticated } from './utils/globalUtils.js';
import DOMPurify from './vendor/dompurify.es.js';

/**
 * API endpoint templates for chat operations
 * @constant
 * @type {Object}
 * @property {function} CONVERSATIONS - Endpoint for conversations list (project-scoped)
 * @property {function} CONVERSATION - Endpoint for a specific conversation
 * @property {function} MESSAGES - Endpoint for conversation messages
 */
const API_ENDPOINTS = {
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations/`,
  CONVERSATION: (projectId, conversationId) =>
    `/api/projects/${projectId}/conversations/${conversationId}/`,
  MESSAGES: (projectId, conversationId) =>
    `/api/projects/${projectId}/conversations/${conversationId}/messages/`
};

/**
 * Default configuration for chat operations
 * @constant
 * @type {Object}
 * @property {string} DEFAULT_MODEL - Default AI model to use
 * @property {number} MAX_TOKENS - Maximum tokens per message
 * @property {number} THINKING_BUDGET - Default thinking budget
 * @property {string} REASONING_EFFORT - Default reasoning effort level
 * @property {number} MAX_IMAGE_SIZE - Maximum allowed image size in bytes (4MB)
 */
const CHAT_CONFIG = {
  DEFAULT_MODEL: "claude-3-sonnet-20240229",
  MAX_TOKENS: 4096,
  THINKING_BUDGET: 16000,
  REASONING_EFFORT: "medium",
  MAX_IMAGE_SIZE: 4 * 1024 * 1024 // 4MB
};

/**
 * Message queue for handling sequential message processing.
 * Ensures only one message is processed at a time.
 * @class
 */
class MessageQueue {
  constructor() {
    /**
     * @type {Array<{task: function, resolve: function}>}
     * The queue of tasks, each containing the task function to execute and a resolver for the result.
     */
    this.queue = [];

    /**
     * @type {boolean}
     * Indicates if a task is currently being processed.
     */
    this.isProcessing = false;
  }

  /**
   * Adds a task to the queue and returns a promise that resolves with the task’s result.
   * @param {function} task - The async function to be executed in sequence.
   * @returns {Promise<*>} - Resolves value returned by the task once processed.
   */
  add(task) {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      this.process();
    });
  }

  /**
   * Processes the next task in the queue (if any), ensuring only one is active at a time.
   * @private
   */
  async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    const { task, resolve } = this.queue.shift();
    try {
      const result = await task();
      resolve(result);
    } finally {
      this.isProcessing = false;
      this.process();
    }
  }
}

/**
 * Gets the current project ID from the DependencySystem, if available.
 * @function
 * @param {Object} DependencySystem - The application's dependency system
 * @returns {string|null} The current project ID or null if not found
 */
function getCurrentProjectId(DependencySystem) {
  if (!DependencySystem?.modules?.get) return null;
  const pm = DependencySystem.modules.get('projectManager');
  return pm?.getCurrentProject?.()?.id ?? null;
}

/**
 * Factory function to create a ChatManager instance. The returned instance
 * integrates project management, conversation flow, user input, and UI bindings.
 *
 * @function
 * @param {Object} params - Dependencies and configuration
 * @param {Object} [params.app] - Main application instance
 * @param {Object} [params.eventHandlers] - Event handler utilities
 * @param {Object} [params.modelConfig] - Model configuration manager
 * @param {Object} [params.projectDetailsComponent] - UI component handling project-related features
 * @param {Object} params.DependencySystem - Dependency injection system (required)
 * @returns {ChatManager} - New ChatManager instance
 * @throws {Error} If no DependencySystem is provided
 */
export function createChatManager({
  app,
  eventHandlers,
  modelConfig,
  projectDetailsComponent,
  DependencySystem,
  apiRequest // <-- accept apiRequest as param
} = {}) {
  if (!DependencySystem) {
    throw new Error("DependencySystem must be provided to createChatManager");
  }

  /**
   * Helper to retrieve modules or singletons from the DependencySystem
   * @param {string} name - Name of the module to fetch
   * @returns {*} - The resolved module, or undefined if not found
   */
  function resolveDep(name) {
    return DependencySystem?.modules?.get(name) ?? DependencySystem?.get?.(name);
  }

  // Attempt to fill missing parameters from the DependencySystem
  app = app || resolveDep('app');
  eventHandlers = eventHandlers || resolveDep('eventHandlers');
  modelConfig = modelConfig || resolveDep('modelConfig');
  projectDetailsComponent = projectDetailsComponent || resolveDep('projectDetailsComponent');
  apiRequest = apiRequest || resolveDep('apiRequest');

  /**
   * Returns the current model config or a fallback stub if not present
   * @returns {Object} - An object with getConfig, updateConfig, etc.
   */
  function getModelConfig() {
    return modelConfig || {
      getConfig: () => ({}),
      updateConfig: () => { },
      getModelOptions: () => [],
      onConfigChange: () => { }
    };
  }

  /**
   * Manager class providing chat operations: creating/loading conversations,
   * sending messages with concurrency control, image attachments, and UI updates.
   * @class
   */
  class ChatManager {
    constructor() {
      /**
       * Set up dependency-injected apiRequest for all ChatManager methods
       */
      this.apiRequest = apiRequest;

      /**
       * @type {string|null}
       * The currently loaded conversation ID
       */
      this.currentConversationId = null;

      /**
       * @type {string|null}
       * The current project ID in use for all chat operations
       */
      this.projectId = null;

      /**
       * @type {boolean}
       * Whether this ChatManager has completed its basic setup
       */
      this.isInitialized = false;

      /**
       * @type {boolean}
       * Tracks if a conversation load is in progress
       */
      this.isLoading = false;

      /**
       * @type {string|null}
       * Base64-encoded image data to attach to the next user message
       */
      this.currentImage = null;

      /**
       * @type {Promise|null}
       * Promise reference if conversation loading is in progress
       */
      this.loadPromise = null;

      /**
       * @type {number}
       * Incremented for each new load request to avoid race conditions
       */
      this.currentRequestId = 0;

      /**
       * @type {MessageQueue}
       * Enforces sequential processing of message sends
       */
      this.messageQueue = new MessageQueue();

      // UI references
      this.container = null;
      this.messageContainer = null;
      this.inputField = null;
      this.sendButton = null;
      this.titleElement = null;

      /**
       * @type {Object}
       * Internal map of custom event handlers if needed
       */
      this._eventHandlers = {};

      /**
       * @type {Object}
       * Model config snapshot for convenience
       */
      this.modelConfig = getModelConfig().getConfig();
    }

    /**
     * Initializes the chat manager by setting up UI elements, binding events,
     * validating user and project, and optionally creating a default conversation.
     * @async
     * @param {Object} [options] - Config for UI selectors and optional projectId
     * @param {string} [options.projectId] - If provided, forcibly use this projectId
     * @param {string} [options.containerSelector] - CSS selector for main chat container
     * @param {string} [options.messageContainerSelector] - Selector for message area
     * @param {string} [options.inputSelector] - Selector for user input field
     * @param {string} [options.sendButtonSelector] - Selector for send button
     * @param {string} [options.titleSelector] - Selector for conversation title element
     * @returns {Promise<boolean>} - Resolves once initialization is complete
     * @throws {Error} If projectId is invalid or user is not authenticated
     */
    async initialize(options = {}) {
      const requestedProjectId =
        options.projectId && isValidProjectId(options.projectId)
          ? options.projectId
          : getCurrentProjectId(DependencySystem);

      // Only skip if already initialized for this project
      if (this.isInitialized && this.projectId === requestedProjectId) {
        console.warn(`[Chat] System already initialized for this project (${requestedProjectId}).`);
        // Still ensure DOM/UI is rebound in case view changed:
        this._setupUIElements(options);
        this._bindEvents();
        return true;
      }

      const previousProjectId = this.projectId;
      this.projectId = requestedProjectId;

      // Allow global/no-project mode: if no valid projectId, set global mode, skip project-specific logic.
      this.isGlobalMode = !isValidProjectId(this.projectId);

      // If switching projects (or first time), reset relevant state
      if (
        this.isInitialized &&
        previousProjectId !== requestedProjectId
      ) {
        this.isInitialized = false;
        this.currentConversationId = null;
        this.loadPromise = null;
        this.isLoading = false;
        this.messageContainer?.replaceChildren?.();
        // Optionally, unbind events/UI if you use delegated listeners (not strictly necessary if ._setupUIElements will always re-bind on each init)
        if (typeof this._unbindEvents === "function") {
          this._unbindEvents();
        }
      }

      if (!isAuthenticated()) {
        const msg = "[Chat] User not authenticated";
        this._showErrorMessage(msg);
        this._handleError("initialization", msg);
        projectDetailsComponent?.disableChatUI?.("Chat unavailable: not authenticated.");
        throw new Error(msg);
      }

      if (this.isGlobalMode) {
        // In global (no-project) mode: Log, wire up UI, skip history/conversation loads
        console.info("[Chat] Starting in global (no-project) mode.");
        try {
          this._setupUIElements(options);
          this._bindEvents();
        } catch (convError) {
          console.error("[Chat] Failed to initialize global chat UI:", convError);
          this._showErrorMessage(
            "Could not initialize chat UI in global mode. Please contact support."
          );
        }
        this.isInitialized = true;
        return true;
      }

      // Project-specific mode: always fresh setup
      console.log(`[Chat] Initializing chat system for projectId: ${this.projectId}`);

      try {
        // Set up DOM references and event bindings
        this._setupUIElements(options);
        this._bindEvents();

        try {
          // Always create or load default conversation
          await this.createNewConversation();
        } catch (convError) {
          console.error("[Chat] Failed to create default conversation:", convError);
          this._showErrorMessage(
            "Could not create a new conversation. Please check your project configuration or contact support."
          );
        }

        this.isInitialized = true;
        return true;
      } catch (error) {
        this._handleError("initialization", error);
        projectDetailsComponent?.disableChatUI?.("Chat unavailable: " + (error?.message || error));
        throw error;
      }
    }

    /**
     * Loads an existing conversation by ID, fetching its data and messages,
     * then rendering them in the UI.
     * @async
     * @param {string} conversationId - The ID of the conversation to load
     * @returns {Promise<boolean>} - True if loaded successfully, otherwise false
     */
    async loadConversation(conversationId) {
      if (!conversationId) {
        console.error("[Chat] Invalid conversation ID given to loadConversation");
        return false;
      }

      if (!isAuthenticated()) {
        console.warn("[Chat] loadConversation called but user not authenticated");
        return false;
      }

      if (!isValidProjectId(this.projectId)) {
        this._handleError("loading conversation", "[Chat] Project ID is invalid or missing.");
        this._showErrorMessage("Cannot load conversation: Project is not loaded or ID is invalid.");
        return false;
      }

      // Keep track of request concurrency
      const requestId = ++this.currentRequestId;

      // If a load is already in progress, reuse that promise
      if (this.loadPromise) {
        console.warn("[Chat] Loading already in progress -- chaining to existing loadPromise.");
        const result = await this.loadPromise;
        return requestId === this.currentRequestId ? result : false;
      }

      this.isLoading = true;
      this._showLoadingIndicator();

      this.loadPromise = (async () => {
        try {
          // Clear previous conversation messages
          this._clearMessages();

          // Parallel fetch: conversation data + messages
          const [conversation, messagesResponse] = await Promise.all([
            this.apiRequest(API_ENDPOINTS.CONVERSATION(this.projectId, conversationId), { method: "GET" }),
            this.apiRequest(API_ENDPOINTS.MESSAGES(this.projectId, conversationId), { method: "GET" })
          ]);

          const messages = messagesResponse.data?.messages || [];
          this.currentConversationId = conversationId;

          if (this.titleElement) {
            this.titleElement.textContent = conversation.title || "New Conversation";
          }

          this._renderMessages(messages);
          this._updateURLWithConversationId(conversationId);

          return true;
        } catch (error) {
          this._handleError("loading conversation", error);
          return false;
        } finally {
          this.isLoading = false;
          this._hideLoadingIndicator();
          this.loadPromise = null;
        }
      })();

      return this.loadPromise;
    }

    /**
     * Creates a new conversation for the current or specified project,
     * updates the UI, and sets it as the active conversation.
     * @async
     * @param {string|null} projectId - Override project ID if needed; otherwise uses current
     * @returns {Promise<Object>} - The newly created conversation object
     * @throws {Error} If no valid project is available or user is not authenticated
     */
    async createNewConversation(projectId = null) {
      this.projectId = isValidProjectId(projectId)
        ? projectId
        : getCurrentProjectId(DependencySystem);

      if (!isAuthenticated()) {
        console.warn("[Chat] User not authenticated, cannot create conversation");
        throw new Error("Not authenticated");
      }

      if (!isValidProjectId(this.projectId)) {
        const msg = "[Chat] Project ID is required to create a conversation";
        this._showErrorMessage(msg);
        this._handleError("creating conversation", msg);
        projectDetailsComponent?.disableChatUI?.("Chat unavailable: project not loaded.");
        throw new Error(msg);
      }

      this._clearMessages();

      try {
        const config = getModelConfig().getConfig();
        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: config.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };

        const response = await this.apiRequest(
          API_ENDPOINTS.CONVERSATIONS(this.projectId),
          { method: "POST", body: payload }
        );
        console.log('[Chat] createNewConversation response:', response);

        const conversation = response?.data?.conversation || response?.data || response?.conversation || response;
        if (!conversation?.id) {
          throw new Error("[Chat] Invalid response from server creating conversation");
        }

        this.currentConversationId = conversation.id;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
        }

        this._updateURLWithConversationId(conversation.id);
        console.log(`[Chat] New conversation created: ${conversation.id}`);

        return conversation;
      } catch (error) {
        this._handleError("creating conversation", error);
        projectDetailsComponent?.disableChatUI?.("Chat unavailable: " + (error?.message || error));
        throw error;
      }
    }

    /**
     * Sends a user message (optionally with an attached image), queued to ensure one
     * message is processed at a time. Renders the user message immediately, then awaits
     * a server response for the assistant message.
     * @async
     * @param {string} messageText - The text content of the message
     * @returns {Promise<Object|undefined>} - Server response data if successful, otherwise undefined
     */
    async sendMessage(messageText) {
      if (!messageText?.trim()) return;

      // Use the messageQueue to ensure concurrency control
      return this.messageQueue.add(async () => {
        if (!isAuthenticated()) {
          app?.showNotification?.("Please log in to send messages", "error");
          return;
        }

        if (!isValidProjectId(this.projectId)) {
          const msg = "No valid project loaded. Please select a valid project before sending messages.";
          this._showErrorMessage(msg);
          this._handleError("sending message", msg);
          projectDetailsComponent?.disableChatUI?.("Chat unavailable: project not loaded.");
          return;
        }

        if (!this.currentConversationId) {
          try {
            await this.createNewConversation();
          } catch (error) {
            this._handleError("creating conversation", error);
            projectDetailsComponent?.disableChatUI?.("Chat unavailable: " + (error?.message || error));
            return;
          }
        }

        // Render the user message optimistically
        this._showMessage("user", messageText);
        this._clearInputField();
        this._showThinkingIndicator();

        try {
          const response = await this._sendMessageToAPI(messageText);
          this._processAssistantResponse(response);
          return response.data;
        } catch (error) {
          this._hideThinkingIndicator();
          this._showErrorMessage(error.message);
          this._handleError("sending message", error);
          projectDetailsComponent?.disableChatUI?.("Chat unavailable: " + (error?.message || error));
        }
      });
    }

    /**
     * Internal helper for posting the user’s message to the server.
     * @private
     * @param {string} messageText - The message text
     * @returns {Promise<Object>} - The API response
     */
    async _sendMessageToAPI(messageText) {
      const modelConfigObj = getModelConfig().getConfig();
      const messagePayload = {
        content: messageText,
        role: "user",
        type: "message",
        vision_detail: modelConfigObj.visionDetail || "auto"
      };

      // If an image is currently set, validate size and attach
      if (this.currentImage) {
        this._validateImageSize();
        messagePayload.image_data = this.currentImage;
        this.currentImage = null;
      }

      if (modelConfigObj.extendedThinking) {
        messagePayload.thinking = {
          type: "enabled",
          budget_tokens: modelConfigObj.thinkingBudget
        };
      }

      return this.apiRequest(
        API_ENDPOINTS.MESSAGES(this.projectId, this.currentConversationId),
        { method: "POST", body: messagePayload }
      );
    }

    /**
     * Ensures the currently stored image data does not exceed the maximum size (4MB).
     * @private
     * @throws {Error} If the image size limit is exceeded
     */
    _validateImageSize() {
      if (typeof this.currentImage === 'string' && this.currentImage.startsWith("data:")) {
        const commaIdx = this.currentImage.indexOf(',');
        const b64 = commaIdx !== -1 ? this.currentImage.slice(commaIdx + 1) : this.currentImage;
        const sizeBytes = Math.floor((b64.length * 3) / 4);

        if (sizeBytes > CHAT_CONFIG.MAX_IMAGE_SIZE) {
          this._hideThinkingIndicator();
          app?.showNotification?.(
            `Image is too large (max ${CHAT_CONFIG.MAX_IMAGE_SIZE / (1024 * 1024)}MB). Please choose a smaller file.`,
            "error"
          );
          throw new Error("Image size exceeds maximum allowed");
        }
      }
    }

    /**
     * Processes the server response after sending a message, rendering assistant or error feedback.
     * @private
     * @param {Object} response - The server response object
     */
    _processAssistantResponse(response) {
      this._hideThinkingIndicator();

      if (response.data?.assistant_message) {
        const { assistant_message, thinking, redacted_thinking } = response.data;
        // Render the assistant’s reply
        this._showMessage(
          "assistant",
          assistant_message.content,
          null,
          thinking,
          redacted_thinking
        );
      } else if (response.data?.assistant_error) {
        const errMsg = this._extractErrorMessage(response.data.assistant_error);
        throw new Error(errMsg);
      }
    }

    /**
     * Deletes the currently active conversation on the server, clears the UI
     * and removes the conversation ID from the URL.
     * @async
     * @returns {Promise<boolean>} - True if deleted successfully, false otherwise
     */
    async deleteConversation() {
      if (!this.currentConversationId) return false;
      if (!isAuthenticated()) {
        console.warn("[Chat] Cannot delete conversation - not authenticated");
        return false;
      }
      if (!isValidProjectId(this.projectId)) {
        this._handleError("deleting conversation", "[Chat] Project ID is invalid or missing.");
        this._showErrorMessage("Cannot delete conversation: Project is not loaded or ID is invalid.");
        return false;
      }

      try {
        await this.apiRequest(
          API_ENDPOINTS.CONVERSATION(this.projectId, this.currentConversationId),
          { method: "DELETE" }
        );

        this.currentConversationId = null;
        this._clearMessages();
        this._removeConversationIdFromURL();
        return true;
      } catch (error) {
        this._handleError("deleting conversation", error);
        return false;
      }
    }

    /**
     * Sets a base64 image to be attached to the next user message, updating the UI indicator if possible.
     * @param {string} base64Image - Base64-encoded image data
     */
    setImage(base64Image) {
      this.currentImage = base64Image;
      if (base64Image && this.messageContainer) {
        const userMessages = this.messageContainer.querySelectorAll(".user-message");
        if (userMessages.length > 0) {
          const lastUserMessage = userMessages[userMessages.length - 1];
          const imageIndicator = document.createElement("div");
          imageIndicator.className = "image-indicator";
          imageIndicator.innerHTML = `
            <img src="${base64Image}" alt="Attached image" class="preview-image" />
            <span>Image attached</span>
          `;
          lastUserMessage.appendChild(imageIndicator);
        }
      }
    }

    /**
     * Updates model configuration and synchronizes any corresponding UI elements (model dropdown, etc.).
     * @param {Object} config - New model configuration to apply
     */
    updateModelConfig(config) {
      getModelConfig().updateConfig(config);
      this.modelConfig = getModelConfig().getConfig();

      const modelSelect = document.getElementById("modelSelect");
      if (modelSelect && this.modelConfig.modelName) {
        modelSelect.value = this.modelConfig.modelName;
      }

      const visionToggle = document.getElementById("visionToggle");
      if (visionToggle && this.modelConfig.visionEnabled !== undefined) {
        visionToggle.checked = this.modelConfig.visionEnabled;
      }

      const tokensDisplay = document.getElementById("maxTokensValue");
      if (tokensDisplay && this.modelConfig.maxTokens) {
        tokensDisplay.textContent = `${this.modelConfig.maxTokens} tokens`;
      }
    }

    // -------------------- UI Helper Methods --------------------

    /**
     * Sets up the main container, message area, input field, and other UI elements based on selectors or by creation.
     * @private
     * @param {Object} options - UI selector options
     */
    _setupUIElements(options) {
      this.container = document.querySelector(options.containerSelector || "#chatUI") ||
        this._createChatContainer();

      this.messageContainer = document.querySelector(options.messageContainerSelector || "#conversationArea") ||
        this._createMessageContainer();

      this._setupInputArea(options);
      this._setupTitleElement(options);

      // If a global extension initialization exists, invoke it
      if (typeof window?.initChatExtensions === "function") {
        window.initChatExtensions();
      }
    }

    /**
     * Creates a new container for the entire chat UI if not present.
     * @private
     * @returns {HTMLElement} The newly created container element
     */
    _createChatContainer() {
      const container = document.createElement("div");
      container.id = "chatUI";
      container.className = "chat-container";
      (document.querySelector("main") || document.body).appendChild(container);
      return container;
    }

    /**
     * Creates a container for displaying conversation messages if not found in the DOM.
     * @private
     * @returns {HTMLElement} The newly created message container
     */
    _createMessageContainer() {
      const container = document.createElement("div");
      container.id = "conversationArea";
      this.container.appendChild(container);
      return container;
    }

    /**
     * Sets up or creates the input area (text field + send button) for user messages.
     * @private
     * @param {Object} options - UI selector options
     */
    _setupInputArea(options) {
      const inputSelector = options.inputSelector || "#chatInput";
      this.inputField = document.querySelector(inputSelector);
      if (!this.inputField) {
        const inputArea = document.createElement("div");
        inputArea.className = "chat-input-area";

        this.inputField = document.createElement("input");
        this.inputField.id = inputSelector.replace("#", "");
        this.inputField.className = "chat-input";
        this.inputField.placeholder = "Type your message...";

        this.sendButton = document.createElement("button");
        this.sendButton.className = "chat-send-button";
        this.sendButton.textContent = "Send";

        inputArea.append(this.inputField, this.sendButton);
        this.container.appendChild(inputArea);
      } else {
        this.sendButton = document.querySelector(options.sendButtonSelector || "#sendBtn");
      }
    }

    /**
     * Finds or creates an element for displaying the conversation title.
     * @private
     * @param {Object} options - UI selector options
     */
    _setupTitleElement(options) {
      this.titleElement = document.querySelector(options.titleSelector || "#chatTitle");
      const editBtn = document.getElementById("chatTitleEditBtn");

      if (this.titleElement) this.titleElement.classList.remove("hidden");
      if (editBtn) editBtn.classList.remove("hidden");
    }

    /**
     * Binds event listeners for sending messages, regenerating chat, and listening for model config changes.
     * @private
     */
    _bindEvents() {
      const trackListener = eventHandlers?.trackListener ||
        ((el, type, fn, opts) => {
          el.addEventListener(type, fn, opts);
          return fn;
        });

      if (this.inputField) {
        trackListener(this.inputField, "keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(this.inputField.value);
          }
        }, { passive: false, description: "Send on Enter" });
      }

      if (this.sendButton) {
        trackListener(this.sendButton, "click", () => {
          this.sendMessage(this.inputField.value);
        });
      }

      // Custom event to regenerate the last conversation message
      trackListener(document, "regenerateChat", () => {
        if (!this.currentConversationId) return;
        const userMessages = Array.from(this.messageContainer.querySelectorAll(".user-message"));
        if (userMessages.length === 0) return;

        const lastUserMessage = userMessages[userMessages.length - 1];
        const messageText = lastUserMessage.querySelector(".message-content")?.textContent;
        if (messageText) {
          const assistantMessages = Array.from(this.messageContainer.querySelectorAll(".assistant-message"));
          if (assistantMessages.length > 0) {
            assistantMessages[assistantMessages.length - 1].remove();
          }
          this.sendMessage(messageText);
        }
      }, { description: "Regenerate chat message" });

      // Event to update the model config from an external source
      trackListener(document, "modelConfigChanged", (e) => {
        if (e.detail) this.updateModelConfig(e.detail);
      });
    }

    /**
     * Renders a chat message with a specific role (user, assistant, system).
     * @private
     * @param {"assistant"|"user"|"system"} role - The sender's role
     * @param {string} content - The message text (HTML-sanitized)
     * @param {string|null} [id=null] - Optional DOM ID
     * @param {string|null} [thinking=null] - Optional chain-of-thought content
     * @param {boolean} [redactedThinking=false] - Whether the thinking was redacted
     */
    _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
      if (!this.messageContainer) return;

      const message = document.createElement("div");
      message.className = `message ${role}-message`;
      if (id) message.id = id;

      const header = document.createElement("div");
      header.className = "message-header";
      header.innerHTML = `
        <span class="message-role">
          ${role === "assistant" ? "Claude" : role === "user" ? "You" : "System"}
        </span>
        <span class="message-time">${new Date().toLocaleTimeString()}</span>
      `;

      const contentEl = document.createElement("div");
      contentEl.className = "message-content";
      contentEl.innerHTML = DOMPurify.sanitize(content || "", {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br', 'p']
      });

      message.append(header, contentEl);

      if (thinking || redactedThinking) {
        message.appendChild(this._createThinkingBlock(thinking, redactedThinking));
      }

      this.messageContainer.appendChild(message);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    /**
     * Creates a collapsible block containing “thinking” text or a redacted notice.
     * @private
     * @param {string|null} thinking - If present, shows chain-of-thought content
     * @param {boolean} redacted - Whether the thinking is redacted
     * @returns {HTMLElement} The DOM element with togglable content
     */
    _createThinkingBlock(thinking, redacted) {
      const container = document.createElement("div");
      container.className = "thinking-container";

      const toggle = document.createElement("button");
      toggle.className = "thinking-toggle";
      toggle.innerHTML = `
        <svg class="thinking-chevron" viewBox="0 0 24 24">
          <path d="M19 9l-7 7-7-7"></path>
        </svg>
        <span>${thinking ? "Show detailed reasoning" : "Safety notice"}</span>
      `;

      const content = document.createElement("div");
      content.className = "thinking-content hidden";

      if (thinking) {
        content.innerHTML = DOMPurify.sanitize(thinking);
      } else if (redacted) {
        content.innerHTML = `
          <div class="redacted-notice">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48
               10 10 10 10-4.48 10-10S17.52 2 12 2zm1
               15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
            </svg>
            <span>Some reasoning was redacted for safety reasons</span>
          </div>
        `;
      }

      // Toggle expand/hide for chain-of-thought content
      toggle.addEventListener("click", () => {
        content.classList.toggle("hidden");
        const chevron = toggle.querySelector(".thinking-chevron");
        const span = toggle.querySelector("span");
        if (content.classList.contains("hidden")) {
          span.textContent = thinking ? "Show detailed reasoning" : "Show safety notice";
          if (chevron) chevron.style.transform = "";
        } else {
          span.textContent = thinking ? "Hide detailed reasoning" : "Hide safety notice";
          if (chevron) chevron.style.transform = "rotate(180deg)";
        }
      });

      container.append(toggle, content);
      return container;
    }

    /**
     * Clears the input field and refocuses it.
     * @private
     */
    _clearInputField() {
      if (this.inputField) {
        this.inputField.value = "";
        this.inputField.focus();
      }
    }

    /**
     * Updates the current URL to reflect the active conversation ID.
     * @private
     * @param {string} conversationId - ID to set in the URL
     */
    _updateURLWithConversationId(conversationId) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("chatId") !== conversationId) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("chatId", conversationId);
        window.history.pushState({}, "", newUrl.toString());
      }
    }

    /**
     * Removes the conversation ID from the URL when a conversation is deleted.
     * @private
     */
    _removeConversationIdFromURL() {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.delete("chatId");
      window.history.pushState(
        {},
        "",
        `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`
      );
    }

    /**
     * Displays a loading indicator in the chat area.
     * @private
     */
    _showLoadingIndicator() {
      if (!this.messageContainer) return;
      const indicator = document.createElement("div");
      indicator.id = "chatLoadingIndicator";
      indicator.className = "loading-indicator";
      indicator.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Loading conversation...</span>
      `;
      this.messageContainer.appendChild(indicator);
    }

    /**
     * Hides the loading indicator, if present.
     * @private
     */
    _hideLoadingIndicator() {
      document.getElementById("chatLoadingIndicator")?.remove();
    }

    /**
     * Shows a “thinking” indicator while awaiting an assistant response.
     * @private
     */
    _showThinkingIndicator() {
      if (!this.messageContainer) return;
      const indicator = document.createElement("div");
      indicator.id = "thinkingIndicator";
      indicator.className = "thinking-indicator";
      indicator.innerHTML = `
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span>Claude is thinking...</span>
      `;
      this.messageContainer.appendChild(indicator);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    /**
     * Hides the “thinking” indicator, if present.
     * @private
     */
    _hideThinkingIndicator() {
      document.getElementById("thinkingIndicator")?.remove();
    }

    /**
     * Renders an error message block in the chat UI.
     * @private
     * @param {string} message - Error message to display
     */
    _showErrorMessage(message) {
      if (!this.messageContainer) return;
      const errorEl = document.createElement("div");
      errorEl.className = "error-message";
      errorEl.innerHTML = `
        <div class="error-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48
             10 10 10 10-4.48 10-10S17.52 2 12 2zm1
             15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
          </svg>
        </div>
        <div class="error-content">
          <h4>Error</h4>
          <p>${DOMPurify.sanitize(message)}</p>
        </div>
      `;
      this.messageContainer.appendChild(errorEl);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    /**
     * Clears all messages from the chat UI.
     * @private
     */
    _clearMessages() {
      this.messageContainer?.replaceChildren();
    }

    /**
     * Renders a list of messages in the chat UI.
     * @private
     * @param {Array<Object>} messages - Array of message objects
     */
    _renderMessages(messages) {
      this._clearMessages();

      if (!messages?.length) {
        this._showMessage("system", "No messages yet");
        return;
      }

      messages.forEach(msg => {
        this._showMessage(
          msg.role,
          msg.content,
          msg.id,
          msg.thinking,
          msg.redacted_thinking
        );
      });
    }

    /**
     * Extracts a user-friendly error message string from various error shapes.
     * @private
     * @param {string|Object|null} error - The raw error payload
     * @returns {string} Clean error message
     */
    _extractErrorMessage(error) {
      if (!error) return "Unknown error occurred";
      if (typeof error === "string") return error;
      if (error.message) return error.message;
      if (typeof error === "object") {
        try {
          return JSON.stringify(error);
        } catch {
          return "Unknown error object";
        }
      }
      return String(error);
    }

    /**
     * Logs the error and shows a notification if possible, for user feedback.
     * @private
     * @param {string} context - Context or label for the error
     * @param {Error|string} error - The error to handle
     */
    _handleError(context, error) {
      const message = this._extractErrorMessage(error);
      console.error(`[Chat - ${context}]`, error);
      app?.showNotification?.(message, "error");
    }
  }

  // Return a new instance of ChatManager
  return new ChatManager();
}

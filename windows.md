## 1. `/home/azureuser/azure_chatapp/static/js/utils/globalUtils.js`

- **Line 6, Column 10**
  ```js
  return window.app?.state?.isAuthenticated === true;
  ```
- **Line 11, Column 7**
  ```js
  if (window.notificationHandler?.show) {
  ```
- **Line 12, Column 5**
  ```js
  window.notificationHandler.show(msg, type, { timeout: dur });
  ```

---

## 2. `/home/azureuser/azure_chatapp/static/js/accessibility-utils.js`

- **Line 21, Column 7**
  ```js
  if (window.DependencySystem) {
  ```
- **Line 22, Column 5**
  ```js
  window.DependencySystem.register('accessibilityUtils', {
  ```
- **Line 32, Column 1**
  ```js
  window.initAccessibilityEnhancements = initAccessibilityEnhancements;
  ```
- **Line 38, Column 3**
  ```js
  window.eventHandlers.trackListener(document, 'keydown', async e => {
  ```
- **Line 41, Column 27**
  ```js
  const sidebar = await window.DependencySystem?.waitFor?.('sidebar', null, 3000);
  ```
- **Line 94, Column 3**
  ```js
  window.eventHandlers.trackListener(document, 'click', e => {
  ```

---

## 3. `/home/azureuser/azure_chatapp/static/js/app.js`

- **Line 34, Column 9**
  ```js
  window.location.hostname === 'localhost' ||
  ```
- **Line 35, Column 9**
  ```js
  window.location.search.includes('debug=1'),
  ```
- **Line 94, Column 28**
  ```js
  const u = new URL(url, window.location.origin);
  ```
- **Line 140, Column 22**
  ```js
  const csrf = window.auth?.getCSRFToken?.();
  ```
- **Line 227, Column 17**
  ```js
  const waitFor = window.DependencySystem.waitFor.bind(window.DependencySystem);
  ```
- **Line 227, Column 54**
  *(Likely a duplicate on the same line)*
  ```js
  const waitFor = window.DependencySystem.waitFor.bind(window.DependencySystem);
  ```
- **Line 236, Column 9**
  ```js
  window.dispatchEvent(new Event('locationchange'));
  ```
- **Line 246, Column 5**
  ```js
  window.addEventListener('popstate', fire);
  ```
- **Line 264, Column 9**
  ```js
  if (window.projectDashboardInitialized) {
  ```
- **Line 277, Column 9**
  ```js
  window.app = {
  ```
- **Line 285, Column 55**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 292, Column 32**
  ```js
  // Security: Lock down window.app after assignment
  ```
- **Line 294, Column 42**
  ```js
  DependencySystem.register('app', window.app);
  ```
- **Line 303, Column 9**
  ```js
  window.projectDashboardInitialized = true;
  ```
- **Line 327, Column 1**
  ```js
  window.projectModal = projectModal; // legacy glue
  ```
- **Line 335, Column 9**
  ```js
  if (window.notificationHandler) {
  ```
- **Line 336, Column 58**
  ```js
  DependencySystem.register('notificationHandler', window.notificationHandler);
  ```
- **Line 344, Column 5**
  ```js
  window.projectManager = projectManager; // legacy glue
  ```
- **Line 345, Column 28**
  ```js
  // Security: Lock down window.projectManager after assignment
  ```
- **Line 375, Column 6**
  ```js
  if (!window.ProjectDetailsComponent) {
  ```
- **Line 377, Column 3**
  ```js
  window.ProjectDetailsComponent = ProjectDetailsComponent;
  ```
- **Line 381, Column 10**
  ```js
  if (!window.projectDashboard) {
  ```
- **Line 383, Column 9**
  ```js
  window.projectDashboard = createProjectDashboard();
  ```
- **Line 384, Column 32**
  ```js
  // Security: Lock down window.projectDashboard after assignment
  ```
- **Line 386, Column 55**
  ```js
  DependencySystem.register('projectDashboard', window.projectDashboard);
  ```
- **Line 390, Column 5**
  ```js
  window.initAccessibilityEnhancements?.();
  ```
- **Line 391, Column 5**
  ```js
  window.initSidebarEnhancements?.();
  ```
- **Line 396, Column 13 & 62**
  ```js
  window.projectDashboard?.showProjectList?.() || (window.location.href = '/');
  ```
- **Line 403, Column 11**
  ```js
  await window.projectDashboard.initialize?.();
  ```
- **Line 412, Column 9**
  ```js
  if (window.FileUploadComponent) {
  ```
- **Line 413, Column 58**
  ```js
  DependencySystem.register('FileUploadComponent', window.FileUploadComponent);
  ```
- **Line 421, Column 5**
  ```js
  window.chatManager = chatManager;
  ```
- **Line 422, Column 28**
  ```js
  // Security: Lock down window.chatManager after assignment
  ```
- **Line 434, Column 15**
  ```js
  auth: window.auth,
  ```
- **Line 435, Column 25**
  ```js
  projectManager: window.projectManager,
  ```
- **Line 437, Column 26**
  ```js
  uiUtilsInstance: window.uiUtilsInstance
  ```
- **Line 441, Column 9**
  ```js
  if (window.app.state.isAuthenticated) {
  ```
- **Line 442, Column 15**
  ```js
  await window.chatManager.initialize({
  ```
- **Line 474, Column 25**
  ```js
  const url = new URL(window.location.href);
  ```
- **Line 487, Column 9**
  ```js
  if (window.projectDashboard) {
  ```
- **Line 489, Column 13**
  ```js
  window.projectDashboard.showProjectList();
  ```
- **Line 493, Column 19**
  ```js
  await window.projectDashboard.showProjectDetails(projectId);
  ```
- **Line 496, Column 23**
  ```js
  if (chatId && window.chatManager) {
  ```
- **Line 500, Column 9**
  ```js
  window.projectDashboard.showProjectList();
  ```
- **Line 515, Column 1**
  ```js
  window.addEventListener('locationchange', handleNavigationChange);
  ```
- **Line 522, Column 22**
  ```js
  return await window.chatManager.loadConversation(conversationId);
  ```
- **Line 536, Column 22**
  ```js
  return await window.projectManager?.loadProjects?.('all');
  ```
- **Line 582, Column 26**
  ```js
  if (authenticated && window.projectManager?.loadProjects) {
  ```
- **Line 583, Column 9**
  ```js
  window.projectManager.loadProjects('all').then(projects => {
  ```
- **Line 585, Column 29**
  ```js
  const sidebar = window.DependencySystem?.modules.get('sidebar');
  ```
- **Line 592, Column 17**
  ```js
  if (window.app?.showNotification) {
  ```
- **Line 593, Column 17**
  ```js
  window.app.showNotification('Failed to load projects after login', 'error');
  ```
- **Line 606, Column 5**
  ```js
  window.addEventListener('popstate', handleNavigationChange);
  ```
- **Line 610, Column 46**
  ```js
  // Prefer DependencySystem, then window.projectManager, then fallback
  ```
- **Line 612, Column 17**
  ```js
  window.projectManager?.currentProject?.id ||
  ```
- **Line 613, Column 18**
  ```js
  (window.projectManager?.getCurrentProject?.()?.id) ||
  ```
- **Line 614, Column 17**
  ```js
  window.app.getProjectId();
  ```

---

## 4. `/home/azureuser/azure_chatapp/static/js/auth.js`

- **Line 14, Column 6**
  ```js
  * - window.apiRequest (optional, for API requests)
  ```
- **Line 15, Column 6**
  ```js
  * - window.DependencySystem (optional, for module registration)
  ```
- **Line 68, Column 5**
  ```js
  window.location.hostname === 'localhost' ||
  ```
- **Line 69, Column 5**
  ```js
  window.location.hostname === '127.0.0.1'
  ```
- **Line 171, Column 27**
  ```js
  if (!isAuthProtected && window.apiRequest && endpoint !== '/api/auth/csrf') {
  ```
- **Line 172, Column 12**
  ```js
  return window.apiRequest(endpoint, method, body);
  ```
- **Line 423, Column 11**
  ```js
  if (window.location.pathname !== '/login') {
  ```
- **Line 424, Column 9**
  ```js
  window.location.href = '/login?loggedout=true';
  ```
- **Line 487, Column 7**
  ```js
  window.eventHandlers?.trackListener(loginForm, 'submit', async (e) => {
  ```
- **Line 496, Column 11**
  ```js
  window.showNotification?.('Login failed: ' + error.message, 'error');
  ```
- **Line 578, Column 1**
  ```js
  window.auth = publicAuth;
  ```
- **Line 579, Column 1**
  ```js
  window.DependencySystem.register('auth', publicAuth);
  ```
- **Line 651, Column 5**
  ```js
  window.addEventListener('blur', hideDropdown);
  ```
- **Line 654, Column 1**
  ```js
  window.DependencySystem.waitFor('auth', (auth) => {
  ```

---

## 5. `/home/azureuser/azure_chatapp/static/js/chat.js`

- **Line 23, Column 9**
  ```js
  if (window.DependencySystem?.modules?.has('modelConfig')) {
  ```
- **Line 24, Column 14**
  ```js
  return window.DependencySystem.modules.get('modelConfig');
  ```
- **Line 73, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 74, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
  ```
- **Line 104, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 105, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
  ```
- **Line 138, Column 38**
  ```js
  const conversation = await window.app.apiRequest(endpoint, { method: "GET" });
  ```
- **Line 141, Column 42**
  ```js
  const messagesResponse = await window.app.apiRequest(messagesEndpoint, { method: "GET" });
  ```
- **Line 150, Column 15 & 43**
  ```js
  if (window.uiRenderer && typeof window.uiRenderer.renderConversations === "function") {
  ```
- **Line 151, Column 13 & 33**
  ```js
  window.chatConfig = window.chatConfig || {};
  ```
- **Line 152, Column 31**
  ```js
  if (Array.isArray(window.chatConfig.conversations)) {
  ```
- **Line 153, Column 15 & 49**
  ```js
  window.chatConfig.conversations = window.chatConfig.conversations.map(conv =>
  ```
- **Line 157, Column 13 & 51**
  ```js
  window.uiRenderer.renderConversations(window.chatConfig);
  ```
- **Line 161, Column 49**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 163, Column 36**
  ```js
  const newUrl = new URL(window.location.href);
  ```
- **Line 165, Column 13**
  ```js
  window.history.pushState({}, "", newUrl.toString());
  ```
- **Line 197, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 198, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
  ```
- **Line 210, Column 32**
  ```js
  const response = await window.app.apiRequest(endpoint, { method: "POST", body: payload });
  ```
- **Line 219, Column 32**
  ```js
  const newUrl = new URL(window.location.href);
  ```
- **Line 221, Column 9**
  ```js
  window.history.pushState({}, "", newUrl.toString());
  ```
- **Line 226, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 227, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
  ```
- **Line 236, Column 9**
  ```js
  window.app?.showNotification?.("Please log in to send messages", "error");
  ```
- **Line 244, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 245, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
  ```
- **Line 254, Column 22**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 255, Column 13**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
  ```
- **Line 284, Column 15**
  ```js
  window.app?.showNotification?.("Image is too large (max 4MB). Please choose a smaller file.", "error");
  ```
- **Line 298, Column 32**
  ```js
  const response = await window.app.apiRequest(endpoint, { method: "POST", body: messagePayload });
  ```
- **Line 320, Column 20**
  ```js
  if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
  ```
- **Line 321, Column 11**
  ```js
  window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
  ```
- **Line 339, Column 15**
  ```js
  await window.app.apiRequest(endpoint, { method: "DELETE" });
  ```
- **Line 342, Column 47**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 344, Column 9**
  ```js
  window.history.pushState(
  ```
- **Line 347, Column 14**
  ```js
  `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`
  ```
- **Line 418, Column 11 & 38**
  ```js
  if (window.initChatExtensions) window.initChatExtensions();
  ```
- **Line 432, Column 9**
  ```js
  window.eventHandlers?.trackListener ??
  ```
- **Line 504, Column 14 & 34**
  ```js
  return window.formatText ? window.formatText(sanitized) : sanitized;
  ```
- **Line 619, Column 11**
  ```js
  if (window.app?.showNotification) {
  ```
- **Line 620, Column 9**
  ```js
  window.app.showNotification(message, "error");
  ```

---

## 6. `/home/azureuser/azure_chatapp/static/js/chatExtensions.js`

- **Line 9, Column 9**
  ```js
  * Uses window.DependencySystem modules for core services.
  ```
- **Line 22, Column 14**
  ```js
  const ds = window.DependencySystem; // Always reference via window for module safety
  ```
- **Line 86, Column 21**
  ```js
  const selection = window.getSelection();
  ```
- **Line 154, Column 18**
  ```js
  if (typeof window.loadConversationList === "function") {
  ```
- **Line 155, Column 26**
  ```js
  setTimeout(() => window.loadConversationList(), 500);
  ```

---

## 7. `/home/azureuser/azure_chatapp/static/js/debug-project.js`

- **Line 25, Column 27**
  ```js
  const originalFetch = window.fetch;
  ```
- **Line 26, Column 5**
  ```js
  window.fetch = function(...args) {
  ```
- **Line 124, Column 13**
  ```js
  if (window.app?.state?.isAuthenticated) {
  ```
- **Line 192, Column 9 & 40**
  ```js
  if (window.ProjectListComponent && window.ProjectListComponent.prototype) {
  ```
- **Line 193, Column 38**
  ```js
  const originalRenderProjects = window.ProjectListComponent.prototype.renderProjects;
  ```
- **Line 195, Column 7**
  ```js
  window.ProjectListComponent.prototype.renderProjects = function(data) {
  ```
- **Line 223, Column 9**
  ```js
  if (window.projectManager) {
  ```
- **Line 224, Column 36**
  ```js
  const originalLoadProjects = window.projectManager.loadProjects;
  ```
- **Line 226, Column 7**
  ```js
  window.projectManager.loadProjects = function(filter) {
  ```
- **Line 228, Column 52**
  ```js
  console.log(`[DEBUG-PROJECT] Auth state: ${window.app?.state?.isAuthenticated}`);
  ```
- **Line 249, Column 15 & 40**
  ```js
  if (window.projectManager && window.projectManager.loadProjects) {
  ```
- **Line 252, Column 42**
  ```js
  const originalLoadProjects = window.projectManager.loadProjects;
  ```
- **Line 254, Column 13**
  ```js
  window.projectManager.loadProjects = function(filter) {
  ```
- **Line 276, Column 13 & 51**
  ```js
  if (window.app?.state?.isAuthenticated && window.projectManager?.loadProjects) {
  ```
- **Line 278, Column 11**
  ```js
  window.projectManager.loadProjects('all');
  ```
- **Line 287, Column 11**
  ```js
  if (window.app?.state?.isAuthenticated) {
  ```

---

## 8. `/home/azureuser/azure_chatapp/static/js/eventHandler.js`

- **Lines 4-8** (comments listing external dependencies)
  ```
  * - window.auth (external dependency, for authentication)
  * - window.app (external dependency, for notifications and UI management)
  * - window.projectManager (external dependency, for project operations)
  * - window.sidebar (external dependency, for sidebar control)
  * - window.modalManager (external dependency, for modal control)
  * - window.DependencySystem (external dependency, for module registration)
  ```
- **Lines 23-28** (similar dependency comments)
  ```
// - window.auth (authentication system)
// - window.app (application core)
// - window.projectManager (project management)
// - window.sidebar (sidebar control)
// - window.modalManager (modal dialogs)
// - window.DependencySystem (module registration)
  ```
- **Line 395, Column 18**
  ```js
  } else if (window.app?.showNotification) {
  ```
- **Line 396, Column 9**
  ```js
  window.app.showNotification(
  ```
- **Line 427, Column 30**
  ```js
  const centralizedHandler = window.DependencySystem?.modules?.get('handleAuthStateChange');
  ```
- **Line 442, Column 7**
  ```js
  if (window.app?.showNotification) {
  ```
- **Line 443, Column 5**
  ```js
  window.app.showNotification(message, 'warning', 8000);
  ```
- **Line 463, Column 9**
  ```js
  if (window.sidebar) {
  ```
- **Line 464, Column 7**
  ```js
  window.sidebar.toggle();
  ```
- **Line 479, Column 33**
  ```js
  const isAuthenticated = window.auth?.isAuthenticated();
  ```
- **Line 481, Column 11**
  ```js
  window.app?.showNotification('Please log in to create a conversation', 'error');
  ```
- **Line 485, Column 13**
  ```js
  if (window.projectManager?.createConversation) {
  ```
- **Line 486, Column 29**
  ```js
  const projectId = window.app?.getProjectId();
  ```
- **Line 487, Column 38**
  ```js
  const conversation = await window.projectManager.createConversation(projectId);
  ```
- **Line 488, Column 11**
  ```js
  window.location.href = `/?chatId=${conversation.id}`;
  ```
- **Line 492, Column 9**
  ```js
  window.app?.showNotification('Failed to create conversation', 'error');
  ```
- **Line 500, Column 11**
  ```js
  if (window.modalManager?.show) {
  ```
- **Line 501, Column 9**
  ```js
  window.modalManager.show('project');
  ```
- **Line 514, Column 7**
  ```js
  window.auth.logout(e).catch(err => {
  ```
- **Line 544, Column 24**
  ```js
  [auth] = await window.DependencySystem.waitFor('auth');
  ```
- **Line 554, Column 9**
  ```js
  window.app?.showNotification('Registration successful', 'success');
  ```
- **Line 566, Column 13**
  ```js
  window.location.href = '/';
  ```
- **Line 582, Column 9**
  ```js
  window.app?.showNotification(errorMsg, 'error');
  ```
- **Line 769, Column 1**
  ```js
  window.eventHandlers = {
  ```
- **Line 783, Column 6**
  ```js
  if (!window.DependencySystem.get) {
  ```
- **Line 784, Column 5**
  ```js
  window.DependencySystem.get = function(moduleName) {
  ```
- **Line 788, Column 1 & 51**
  ```js
  window.DependencySystem.register('eventHandlers', window.eventHandlers);
  ```
- **Line 790, Column 16**
  ```js
  export default window.eventHandlers;
  ```

---

## 9. `/home/azureuser/azure_chatapp/static/js/FileUploadComponent.js`

- **Lines 5-7** (comments listing external dependencies)
  ```
  * - window.eventHandlers (external utility, for event management)
  * - window.projectManager (external dependency, for file upload operations)
  * - window.showNotification (external dependency, for user feedback)
  ```
- **Line 58, Column 7**
  ```js
  window.eventHandlers.trackListener(this.elements.fileInput, 'change', (e) => {
  ```
- **Line 65, Column 7**
  ```js
  window.eventHandlers.trackListener(this.elements.uploadBtn, 'click', () => {
  ```
- **Line 73, Column 9**
  ```js
  window.eventHandlers.trackListener(this.elements.dragZone, eventName, (e) => {
  ```
- **Line 89, Column 7**
  ```js
  window.eventHandlers.trackListener(this.elements.dragZone, 'click', () => {
  ```
- **Line 125, Column 7**
  ```js
  window.showNotification('No project selected', 'error');
  ```
- **Line 133, Column 7**
  ```js
  window.showNotification(`Skipped ${file.name}: ${error}`, 'error');
  ```
- **Line 159, Column 12**
  ```js
  if (!window.projectManager?.uploadFile) {
  ```
- **Line 163, Column 13**
  ```js
  await window.projectManager.uploadFileWithRetry(this.projectId, { file });
  ```
- **Line 165, Column 7**
  ```js
  window.showNotification(`${file.name} uploaded successfully`, 'success');
  ```
- **Line 170, Column 7**
  ```js
  window.showNotification(`Failed to upload ${file.name}: ${errorMsg}`, 'error');
  ```
- **Line 302, Column 1**
  ```js
  window.FileUploadComponent = FileUploadComponent;
  ```

---

## 10. `/home/azureuser/azure_chatapp/static/js/fixes-verification.js`

- **Line 31, Column 25 & 52**
  ```js
  (window.DependencySystem && window.DependencySystem.modules.has(module));
  ```
- **Line 39, Column 9**
  ```js
  if (window.auth?.AuthBus) {
  ```
- **Line 41, Column 7**
  ```js
  window.auth.AuthBus.addEventListener('authStateChanged', (event) => {
  ```
- **Line 68, Column 11 & 36**
  ```js
  if (window.projectManager && window.projectManager._lastProjectLoadTime) {
  ```
- **Line 69, Column 44**
  ```js
  const timeSinceAuth = Date.now() - window.projectManager._lastProjectLoadTime;
  ```
- **Line 111, Column 9 & 36**
  ```js
  if (window.projectDashboard && window.projectDashboard.state?.initialized) {
  ```
- **Line 119, Column 9 & 34**
  ```js
  if (window.projectManager && window.projectManager.loadProjects) {
  ```
- **Line 120, Column 36**
  ```js
  const originalLoadProjects = window.projectManager.loadProjects;
  ```
- **Line 122, Column 7**
  ```js
  window.projectManager.loadProjects = function() {
  ```
- **Line 124, Column 9**
  ```js
  window.projectManager._lastProjectLoadTime = Date.now();
  ```
- **Line 186, Column 11**
  ```js
  if (window.app?.state?.isAuthenticated) {
  ```
- **Line 193, Column 7 & 46**
  ```js
  if (window.DependencySystem && Object.keys(window.DependencySystem).length > 0) {
  ```

---

## 11. `/home/azureuser/azure_chatapp/static/js/formatting.js`

- **Line 15, Column 1**
  ```js
  window.formatText = formatText;
  ```
- **Line 58, Column 1**
  ```js
  window.formatBytes = function(bytes, decimals = 1) {
  ```
- **Line 83, Column 1**
  ```js
  window.formatDate = function(date, includeTime = true) {
  ```
- **Line 106, Column 1**
  ```js
  window.getFileTypeIcon = function(fileType) {
  ```
- **Line 132, Column 1**
  ```js
  window.createDomElement = function(type, attributes = {}, children = []) {
  ```
- **Line 172, Column 1 & 50**
  ```js
  window.parseQueryString = function(queryString = window.location.search) {
  ```
- **Line 189, Column 1**
  ```js
  window.handleFormSubmit = function(event, successCallback, errorMessage = "An error occurred") {
  ```
- **Line 234, Column 9**
  ```js
  if (window.showNotification) {
  ```
- **Line 235, Column 7**
  ```js
  window.showNotification(errorMessage, 'error');
  ```

---

## 12. `/home/azureuser/azure_chatapp/static/js/kb-result-handlers.js`

- **Line 32, Column 27**
  ```js
  const selection = window.getSelection();
  ```
- **Line 215, Column 1**
  ```js
  window.kbResultHandlers = {
  ```

---

## 13. `/home/azureuser/azure_chatapp/static/js/knowledgeBaseComponent.js`

- **Lines 11–15** (comments describing optional dependencies)
  ```
  *     apiRequest,       // optional, else falls back to window.apiRequest
  *     auth,             // optional, else falls back to window.auth
  *     projectManager,   // optional, else falls back to window.projectManager
  *     showNotification, // optional, else falls back to window.showNotification
  *     uiUtilsInstance,  // optional, else falls back to window.uiUtilsInstance
  ```
- **Line 29, Column 50**
  ```js
  // We'll store external dependencies (or their window.* fallbacks) here:
  ```
- **Line 31, Column 18**
  ```js
  apiRequest = window.apiRequest,
  ```
- **Line 32, Column 12**
  ```js
  auth = window.auth,
  ```
- **Line 33, Column 22**
  ```js
  projectManager = window.projectManager,
  ```
- **Line 34, Column 24**
  ```js
  showNotification = window.showNotification,
  ```
- **Line 35, Column 23**
  ```js
  uiUtilsInstance = window.uiUtilsInstance,
  ```
- **Line 36, Column 100 & 125**
  ```js
  getCurrentProjectId = projectManager?.getCurrentProjectId || ... window.projectManager.getCurrentProjectId ...
  ```
- **Line 37, Column 24**
  ```js
  isValidProjectId = window.projectManager?.isValidProjectId || (() => false)
  ```

---

## 14. `/home/azureuser/azure_chatapp/static/js/modalManager.js`

- **Line 8, Column 27**
  ```js
  * and register them with window.DependencySystem.register('modalManager', modalManagerInstance)
  ```
- **Line 14, Column 7**
  ```js
  *  - window.eventHandlers.trackListener (optional) for managed event listening.
  ```
- **Line 15, Column 7**
  ```js
  *  - window.projectManager (optional) for handling project operations.
  ```
- **Line 16, Column 7**
  ```js
  *  - window.showNotification (optional) for user notifications.
  ```
- **Line 56, Column 13**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 57, Column 11**
  ```js
  window.eventHandlers.trackListener(
  ```
- **Line 102, Column 9**
  ```js
  if (window.__appInitializing && !options.showDuringInitialization) {
  ```
- **Line 241, Column 9**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 242, Column 7**
  ```js
  window.eventHandlers.trackListener(newConfirmBtn, "click", confirmHandler, {
  ```
- **Line 245, Column 7**
  ```js
  window.eventHandlers.trackListener(newCancelBtn, "click", cancelHandler, {
  ```
- **Line 376, Column 9**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 377, Column 7**
  ```js
  window.eventHandlers.trackListener(this.formElement, "submit", submitHandler, {
  ```
- **Line 392, Column 11**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 393, Column 9**
  ```js
  window.eventHandlers.trackListener(cancelBtn, "click", cancelHandler, {
  ```
- **Line 407, Column 9**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 408, Column 7**
  ```js
  window.eventHandlers.trackListener(document, "keydown", escHandler, {
  ```
- **Line 421, Column 9**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 422, Column 7**
  ```js
  window.eventHandlers.trackListener(this.modalElement, "click", backdropHandler, {
  ```
- **Line 491, Column 10**
  ```js
  if (!window.projectManager) {
  ```
- **Line 495, Column 11**
  ```js
  await window.projectManager.createOrUpdateProject(projectId, projectData);
  ```
- **Line 519, Column 9**
  ```js
  if (window.showNotification) {
  ```
- **Line 520, Column 7**
  ```js
  window.showNotification(message, "error");
  ```
- **Line 531, Column 9**
  ```js
  if (window.showNotification) {
  ```
- **Line 532, Column 7**
  ```js
  window.showNotification(message, "success");
  ```

---

## 15. `/home/azureuser/azure_chatapp/static/js/modelConfig.js`

- **Line 6, Column 6**
  ```js
  * - window.chatManager (external dependency, expected to be available in global scope)
  ```
- **Line 73, Column 16**
  ```js
  const ds = window.DependencySystem;
  ```
- **Line 140, Column 9 & 46**
  ```js
  if (window.eventHandlers?.trackListener) window.eventHandlers.trackListener(sel, 'change', handler);
  ```

---

## 16. `/home/azureuser/azure_chatapp/static/js/notification-handler.js`

- **Line 221, Column 5**
  ```js
  window.addEventListener('message', handleNotificationMessages);
  ```
- **Line 241, Column 3**
  ```js
  window.notificationHandler = {
  ```
- **Line 249, Column 8**
  ```js
  if (!window.showNotification) {
  ```
- **Line 250, Column 5**
  ```js
  window.showNotification = showNotification;
  ```

---

## 17. `/home/azureuser/azure_chatapp/static/js/projectDashboard.js`

- **Lines 7–11** (comments listing external dependencies)
  ```
  * - window.app: Application core with state management and UI helpers.
  * - window.projectManager: Project management API.
  * - window.ProjectListComponent: Renders the project list.
  * - window.ProjectDetailsComponent: Renders project details.
  * - window.DependencySystem: Dependency injection/registration system.
  * - window.eventHandlers: Utility for debouncing.
  ```
- **Line 32, Column 21**
  ```js
  const authBus = window.auth?.AuthBus;
  ```
- **Line 39, Column 9**
  ```js
  window.projectManager?.loadProjects('all');
  ```
- **Line 48, Column 13**
  ```js
  } else if (!window.auth) {
  ```
- **Line 71, Column 12**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 117, Column 7**
  ```js
  window.app?.showNotification('Dashboard initialization failed', 'error');
  ```
- **Line 140, Column 32**
  ```js
  const currentUrl = new URL(window.location);
  ```
- **Line 143, Column 7**
  ```js
  window.history.replaceState({}, '', currentUrl.toString());
  ```
- **Line 222, Column 7**
  ```js
  window.app?.showNotification('Error loading project details UI', 'error');
  ```
- **Line 250, Column 32**
  ```js
  const currentUrl = new URL(window.location.href);
  ```
- **Line 257, Column 7**
  ```js
  window.history.replaceState({}, '', currentUrl.toString());
  ```
- **Line 262, Column 9 & 45**
  ```js
  if (window.app.state.isAuthenticated && window.projectManager?.loadProjectDetails) {
  window.projectManager
  ```
- **Line 269, Column 13**
  ```js
  window.app?.showNotification('Project not found', 'error');
  ```
- **Line 276, Column 11**
  ```js
  window.app?.showNotification('Failed to load project details', 'error');
  ```
- **Line 438, Column 9**
  ```js
  if (window.ProjectListComponent) {
  ```
- **Line 439, Column 41**
  ```js
  this.components.projectList = new window.ProjectListComponent({
  ```
- **Line 451, Column 75**
  ```js
  console.error('[ProjectDashboard] ProjectListComponent not found on window.');
  ```
- **Line 455, Column 9**
  ```js
  if (window.ProjectDetailsComponent) {
  ```
- **Line 456, Column 44**
  ```js
  this.components.projectDetails = new window.ProjectDetailsComponent({
  ```
- **Line 461, Column 78**
  ```js
  console.error('[ProjectDashboard] ProjectDetailsComponent not found on window.');
  ```
- **Line 468, Column 11**
  ```js
  if (window.projectManager?.currentProjects?.length) {
  ```
- **Line 470, Column 31**
  ```js
  detail: { projects: window.projectManager.currentProjects }
  ```
- **Line 474, Column 9**
  ```js
  window.projectManager?.loadProjects('all');
  ```
- **Line 485, Column 43**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 513, Column 5**
  ```js
  window.addEventListener('popstate', this._handlePopState.bind(this));
  ```
- **Line 544, Column 10**
  ```js
  if (!window.app?.state?.isAuthenticated) {
  ```
- **Line 550, Column 10**
  ```js
  if (!window.projectManager?.loadProjects) {
  ```
- **Line 558, Column 9**
  ```js
  window.projectManager.loadProjects('all')
  ```
- **Line 620, Column 29**
  ```js
  const url = new URL(window.location);
  ```
- **Line 623, Column 11**
  ```js
  window.history.replaceState({}, '', url.toString());
  ```
- **Line 772, Column 5**
  ```js
  window.app?.showNotification('The requested project was not found', 'error');
  ```
- **Line 789, Column 1**
  ```js
  window.projectDashboard = projectDashboard;
  ```

---

## 18. `/home/azureuser/azure_chatapp/static/js/projectDashboardUtils.js`

- **Lines 6–14** (comments including DependencySystem requirement)
  ```
  * @requires window.DependencySystem - For module registration
  * @requires window.eventHandlers - For event management
  * @requires window.projectManager - For project operations
  * @requires window.modalManager - For modal dialogs
  * @requires window.notificationHandler - For notifications
  * @requires window.showNotification - Fallback notification system
  * @requires window.formatDate - For date formatting
  * @requires window.formatBytes - For byte formatting
  * @requires window.app - For authentication state and shared utilities
  ```
- **Line 25, Column 6**
  ```js
  // - window.eventHandlers (event management)
  ```
- **Line 26, Column 6**
  ```js
  // - window.projectManager (project data operations)
  ```
- **Line 27, Column 6**
  ```js
  // - window.modalManager (modal management)
  ```
- **Line 28, Column 6**
  ```js
  // - window.notificationHandler (notification system)
  ```
- **Line 29, Column 6**
  ```js
  // - window.showNotification (fallback notifications)
  ```
- **Line 30, Column 6**
  ```js
  // - window.formatDate (date formatting)
  ```
- **Line 31, Column 6**
  ```js
  // - window.formatBytes (file size formatting)
  ```
- **Line 32, Column 6**
  ```js
  // - window.app (application state)
  ```
- **Line 72, Column 9**
  ```js
  window.eventHandlers.trackListener(element, 'click', options.onclick);
  ```
- **Line 79, Column 11**
  ```js
  window.eventHandlers.trackListener(element, eventType, handler);
  ```
- **Line 109, Column 19 & 61**
  ```js
  // We rely on window.formatDate for date formatting and window.formatBytes for byte formatting.
  ```
- **Line 140, Column 66**
  ```js
  // Removed setupCollapsible wrapper in favor of directly using window.eventHandlers.setupCollapsible
  ```
- **Line 149, Column 5**
  ```js
  window.eventHandlers.trackListener(editBtn, 'click', () => {
  ```
- **Line 150, Column 32**
  ```js
  const currentProject = window.projectManager?.currentProject;
  ```
- **Line 151, Column 20 & 76**
  ```js
  const pm = window.DependencySystem?.modules.get('projectModal') || window.projectModal;
  ```
- **Line 163, Column 7**
  ```js
  window.eventHandlers.trackListener(pinBtn, 'click', async () => {
  ```
- **Line 164, Column 32**
  ```js
  const currentProject = window.projectManager?.currentProject;
  ```
- **Line 165, Column 35**
  ```js
  if (currentProject?.id && window.projectManager?.togglePinProject) {
  ```
- **Line 167, Column 42**
  ```js
  const updatedProject = await window.projectManager.togglePinProject(currentProject.id);
  ```
- **Line 168, Column 17**
  ```js
  if (window.notificationHandler?.show) {
  ```
- **Line 169, Column 15**
  ```js
  window.notificationHandler.show(
  ```
- **Line 173, Column 24**
  ```js
  } else if (window.app?.showNotification) {
  ```
- **Line 174, Column 15**
  ```js
  window.app.showNotification(
  ```
- **Line 181, Column 17**
  ```js
  if (window.notificationHandler?.show) {
  ```
- **Line 182, Column 15**
  ```js
  window.notificationHandler.show('Failed to toggle pin', 'error');
  ```
- **Line 183, Column 24**
  ```js
  } else if (window.app?.showNotification) {
  ```
- **Line 184, Column 15**
  ```js
  window.app.showNotification('Failed to toggle pin', 'error');
  ```
- **Line 194, Column 7**
  ```js
  window.eventHandlers.trackListener(archiveBtn, 'click', async () => {
  ```
- **Line 195, Column 32 & 82**
  ```js
  const currentProject = window.projectManager?.currentProject;
  if (currentProject?.id && window.projectManager?.toggleArchiveProject && window.modalManager) {
  ```
- **Line 197, Column 11**
  ```js
  window.modalManager.confirmAction({
  ```
- **Line 206, Column 23**
  ```js
  await window.projectManager.toggleArchiveProject(currentProject.id);
  ```
- **Line 207, Column 21**
  ```js
  if (window.notificationHandler?.show) {
  ```
- **Line 208, Column 19**
  ```js
  window.notificationHandler.show(
  ```
- **Line 212, Column 28**
  ```js
  } else if (window.app?.showNotification) {
  ```
- **Line 213, Column 19**
  ```js
  window.app.showNotification(
  ```
- **Line 221, Column 21**
  ```js
  if (window.notificationHandler?.show) {
  ```
- **Line 222, Column 19**
  ```js
  window.notificationHandler.show('Failed to toggle archive', 'error');
  ```
- **Line 223, Column 28**
  ```js
  } else if (window.app?.showNotification) {
  ```
- **Line 224, Column 19**
  ```js
  window.app.showNotification('Failed to toggle archive', 'error');
  ```

---

## 19. `/home/azureuser/azure_chatapp/static/js/projectDetailsComponent.js`

- **Lines 6–11** (comments listing dependencies)
  ```
  * - window.app: Application core with state management and notifications.
  * - window.eventHandlers: Event management utilities.
  * - window.projectManager: Project operations.
  * - window.chatManager: Chat functionality.
  * - window.modalManager: Confirmation dialogs.
  * - window.FileUploadComponent: File uploads.
  ```
- **Line 24, Column 7**
  ```js
  window.location.href = '/';
  ```
- **Line 149, Column 7**
  ```js
  window.eventHandlers.trackListener(this.elements.backBtn, 'click', (e) => {
  ```
- **Line 159, Column 7**
  ```js
  window.eventHandlers.trackListener(button, 'click', () => {
  ```
- **Line 168, Column 9**
  ```js
  if (window.FileUploadComponent) {
  ```
- **Line 169, Column 38**
  ```js
  this.fileUploadComponent = new window.FileUploadComponent({
  ```
- **Line 178, Column 48**
  ```js
  if (this.state.currentProject?.id && window.projectManager?.loadProjectFiles) {
  ```
- **Line 179, Column 13**
  ```js
  window.projectManager.loadProjectFiles(this.state.currentProject.id);
  ```
- **Line 188, Column 7**
  ```js
  window.eventHandlers.trackListener(newChatBtn, 'click', () => {
  ```
- **Line 242, Column 5**
  ```js
  window.projectManager?.loadProjectConversations(project.id);
  ```
- **Line 266, Column 7**
  ```js
  window.app?.showNotification?.('Cannot open: No valid project loaded.', 'error');
  ```
- **Line 410, Column 7**
  ```js
  window.app?.showNotification?.('Cannot create chat: No valid project loaded.', 'error');
  ```
- **Line 417, Column 8**
  ```js
  !window.chatManager.isInitialized ||
  ```
- **Line 418, Column 7**
  ```js
  window.chatManager.projectId !== projectId
  ```
- **Line 421, Column 15**
  ```js
  await window.chatManager.initialize({ projectId });
  ```
- **Line 424, Column 9**
  ```js
  window.app.showNotification('Failed to initialize chat', 'error');
  ```
- **Line 430, Column 37**
  ```js
  const newConversation = await window.chatManager.createNewConversation();
  ```
- **Line 439, Column 9 & 10**
  ```js
  window.chatManager.currentConversationId !== newConversationId &&
  !window.chatManager.isLoading
  ```
- **Line 442, Column 15**
  ```js
  await window.chatManager.loadConversation(newConversationId);
  ```
- **Line 446, Column 27**
  ```js
  const url = new URL(window.location.href);
  ```
- **Line 448, Column 7**
  ```js
  window.history.pushState({}, '', url.toString());
  ```
- **Line 451, Column 7**
  ```js
  window.app.showNotification('Failed to create new conversation', 'error');
  ```
- **Line 485, Column 7**
  ```js
  window.app?.showNotification?.('No valid project loaded – cannot view this tab.', 'error');
  ```
- **Line 510, Column 18**
  ```js
  return window.projectManager?.loadProjectFiles?.(projectId);
  ```
- **Line 516, Column 18**
  ```js
  return window.projectManager?.loadProjectConversations?.(projectId);
  ```
- **Line 522, Column 18**
  ```js
  return window.projectManager?.loadProjectArtifacts?.(projectId);
  ```
- **Line 547, Column 7**
  ```js
  window.app.showNotification('Cannot initialize chat: No valid project selected.', 'error');
  ```
- **Line 553, Column 7**
  ```js
  window.chatManager.isInitialized &&
  ```
- **Line 554, Column 7**
  ```js
  window.chatManager.projectId === projectId
  ```
- **Line 556, Column 45**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 560, Column 9 & 10**
  ```js
  window.chatManager.currentConversationId !== chatId &&
  !window.chatManager.isLoading
  ```
- **Line 563, Column 15**
  ```js
  await window.chatManager.loadConversation(chatId);
  ```
- **Line 570, Column 13**
  ```js
  await window.chatManager.initialize({ projectId });
  ```
- **Line 571, Column 45**
  ```js
  const urlParams = new URLSearchParams(window.location.search);
  ```
- **Line 575, Column 15**
  ```js
  await window.chatManager.loadConversation(chatId);
  ```
- **Line 583, Column 7**
  ```js
  window.app.showNotification('Failed to initialize chat', 'error');
  ```
- **Line 634, Column 7**
  ```js
  window.app.showNotification(`Failed to load ${section}`, 'error');
  ```
- **Line 680, Column 9**
  ```js
  if (window.modalManager?.confirmAction) {
  ```
- **Line 681, Column 7**
  ```js
  window.modalManager.confirmAction({
  ```
- **Line 688, Column 19**
  ```js
  await window.projectManager.deleteFile(projectId, fileId);
  ```
- **Line 689, Column 13**
  ```js
  window.app.showNotification('File deleted successfully', 'success');
  ```
- **Line 690, Column 19**
  ```js
  await window.projectManager.loadProjectFiles(projectId);
  ```
- **Line 693, Column 13**
  ```js
  window.app.showNotification('Failed to delete file', 'error');
  ```
- **Line 700, Column 9**
  ```js
  window.projectManager.deleteFile(projectId, fileId)
  ```
- **Line 702, Column 13**
  ```js
  window.app.showNotification('File deleted successfully', 'success');
  ```
- **Line 703, Column 20**
  ```js
  return window.projectManager.loadProjectFiles(projectId);
  ```
- **Line 707, Column 13**
  ```js
  window.app.showNotification('Failed to delete file', 'error');
  ```
- **Line 794, Column 5**
  ```js
  window.eventHandlers.trackListener(downloadBtn, 'click', () => {
  ```
- **Line 795, Column 11**
  ```js
  if (window.projectManager?.downloadFile) {
  ```
- **Line 796, Column 9**
  ```js
  window.projectManager.downloadFile(this.state.currentProject.id, file.id);
  ```
- **Line 810, Column 5**
  ```js
  window.eventHandlers.trackListener(deleteBtn, 'click', () => this._confirmDeleteFile(file.id));
  ```
- **Line 860, Column 5**
  ```js
  window.eventHandlers.trackListener(item, 'click', () => this._handleConversationClick(conversation));
  ```
- **Line 902, Column 5**
  ```js
  window.eventHandlers.trackListener(downloadBtn, 'click', () => {
  ```
- **Line 903, Column 11**
  ```js
  if (window.projectManager?.downloadArtifact) {
  ```
- **Line 904, Column 9**
  ```js
  window.projectManager.downloadArtifact(this.state.currentProject.id, artifact.id);
  ```
- **Line 926, Column 7**
  ```js
  window.app.showNotification('No valid project loaded.', 'error');
  ```
- **Line 936, Column 7**
  ```js
  window.chatManager.projectId === projectId &&
  ```
- **Line 937, Column 7**
  ```js
  window.chatManager.currentConversationId === conversation.id
  ```
- **Line 948, Column 11 & 47**
  ```js
  (!window.chatManager.isInitialized || window.chatManager.projectId !== projectId) &&
  ```
- **Line 959, Column 12, 48 & 112**
  ```js
  if (!window.chatManager.isInitialized || window.chatManager.projectId !== projectId || !isValidProjectId(window.chatManager.projectId)) {
  ```
- **Line 960, Column 15**
  ```js
  await window.chatManager.initialize({ projectId });
  ```
- **Line 963, Column 9 & 10**
  ```js
  window.chatManager.currentConversationId !== conversation.id &&
  !window.chatManager.isLoading
  ```
- **Line 966, Column 15**
  ```js
  await window.chatManager.loadConversation(conversation.id);
  ```
- **Line 969, Column 27**
  ```js
  const url = new URL(window.location.href);
  ```
- **Line 971, Column 7**
  ```js
  window.history.pushState({}, '', url.toString());
  ```
- **Line 974, Column 7**
  ```js
  window.app.showNotification('Failed to load conversation', 'error');
  ```
- **Line 1055, Column 9**
  ```js
  if (window.projectDashboard) {
  ```
- **Line 1056, Column 7**
  ```js
  window.projectDashboard.showProjectList();
  ```
- **Line 1058, Column 7**
  ```js
  window.location.href = '/';
  ```
- **Line 1063, Column 1**
  ```js
  window.projectDetailsComponent = projectDetailsComponent;
  ```

---

## 20. `/home/azureuser/azure_chatapp/static/js/projectListComponent.js`

- **Lines 6–10** (comments listing dependencies)
  ```
  * - window.app: Application core with state management and API requests.
  * - window.eventHandlers: Utility for event management.
  * - window.projectManager: Project management API.
  * - window.modalManager: Modal dialog management.
  * - window.DependencySystem: Dependency injection/registration system.
  ```
- **Line 14, Column 12 & 68**
  ```js
  return window.DependencySystem?.modules.get('projectModal') || window.projectModal;
  ```
- **Line 29, Column 13**
  ```js
  window.location.href = `/?project=${projectId}`;
  ```
- **Line 67, Column 60**
  ```js
  console.log('[DIAG] projectEvents cache on init:', window.projectEvents?.projectsLoaded);
  ```
- **Line 181, Column 13, 37 & 76**
  ```js
  if (window.projectEvents && window.projectEvents.projectsLoaded && window.projectEvents.projectsLoaded.length) {
  ```
- **Line 182, Column 28**
  ```js
  const recent = window.projectEvents.projectsLoaded.at(-1);
  ```
- **Line 189, Column 13**
  ```js
  if (window.projectManager?.currentProjects?.length) {
  ```
- **Line 190, Column 45**
  ```js
  this.renderProjects({ projects: window.projectManager.currentProjects });
  ```
- **Line 211, Column 13**
  ```js
  if (window.projectManager?.currentProjects?.length > 0) {
  ```
- **Line 213, Column 45**
  ```js
  this.renderProjects({ projects: window.projectManager.currentProjects });
  ```
- **Line 232, Column 50**
  ```js
  // Retrieve recent events from a cached log (window.projectEvents) if available.
  ```
- **Line 238, Column 14 & 39**
  ```js
  if (!window.projectEvents || !window.projectEvents[eventName]) {
  ```
- **Line 244, Column 16**
  ```js
  return window.projectEvents[eventName].filter(
  ```
- **Line 254, Column 35**
  ```js
  // Bind event listeners using window.eventHandlers if available.
  ```
- **Line 263, Column 13**
  ```js
  if (window.projectManager?.addEventListener) {
  ```
- **Line 264, Column 13**
  ```js
  window.projectManager.addEventListener('projectsLoaded', handler);
  ```
- **Line 268, Column 9**
  ```js
  window.eventHandlers.trackListener(this.element, 'click', (e) => this._handleCardClick(e), {
  ```
- **Line 301, Column 17**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 302, Column 17**
  ```js
  window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
  ```
- **Line 306, Column 17**
  ```js
  window.eventHandlers.trackListener(tab, 'click', clickHandler, {
  ```
- **Line 310, Column 17**
  ```js
  window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
  ```
- **Line 314, Column 17**
  ```js
  window.eventHandlers.trackListener(tab, 'click', clickHandler, {
  ```
- **Line 338, Column 29**
  ```js
  const url = new URL(window.location);
  ```
- **Line 340, Column 9**
  ```js
  window.history.pushState({}, '', url);
  ```
- **Line 409, Column 13**
  ```js
  if (window.projectManager) {
  ```
- **Line 410, Column 13**
  ```js
  window.projectManager.currentProjects = projects;
  ```
- **Line 453, Column 28**
  ```js
  const cs = window.getComputedStyle(this.element);
  ```
- **Line 460, Column 74**
  ```js
  zIdxLine.push(`${node.id || node.tagName}: z-index=${window.getComputedStyle(node).zIndex}`);
  ```
- **Line 519, Column 14**
  ```js
  if (!window.projectManager?.loadProjects) {
  ```
- **Line 528, Column 19**
  ```js
  await window.projectManager.loadProjects(this.state.filter);
  ```
- **Line 606, Column 64**
  ```js
  if (document.getElementById('projectModal') && window.projectModal) {
  ```
- **Line 646, Column 17**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 647, Column 17**
  ```js
  window.eventHandlers.trackListener(btn, 'click', handler, {
  ```
- **Line 691, Column 13**
  ```js
  if (window.modalManager?.confirmAction) {
  ```
- **Line 692, Column 13**
  ```js
  window.modalManager.confirmAction({
  ```
- **Line 707, Column 14**
  ```js
  if (!window.projectManager?.deleteProject) {
  ```
- **Line 711, Column 9**
  ```js
  window.projectManager.deleteProject(projectId)
  ```
- **Line 713, Column 17**
  ```js
  window.app?.showNotification('Project deleted', 'success');
  ```
- **Line 718, Column 17**
  ```js
  window.app?.showNotification('Failed to delete project', 'error');
  ```
- **Line 757, Column 13**
  ```js
  window.eventHandlers.trackListener(createBtn, 'click', () => this._openNewProjectModal(), {
  ```
- **Line 780, Column 17**
  ```js
  window.dispatchEvent(new CustomEvent('requestLogin'));
  ```
- **Line 782, Column 13**
  ```js
  window.eventHandlers.trackListener(loginBtn, 'click', handler, {
  ```
- **Line 804, Column 13**
  ```js
  window.eventHandlers.trackListener(retryBtn, 'click', () => this._loadProjects(), {
  ```
- **Line 975, Column 5**
  ```js
  window.ProjectListComponent = ProjectListComponent;
  ```

---

## 21. `/home/azureuser/azure_chatapp/static/js/projectManager.js`

- **Lines 7–9** (comments listing dependencies)
  ```
  * - window.app: Application core with state management and API requests.
  * - window.DependencySystem: Dependency injection/registration system.
  * - window.chatManager: Chat/conversation management module.
  ```
- **Line 34, Column 1 & 24**
  ```js
  window.projectEvents = window.projectEvents || {};
  ```
- **Line 127, Column 14 & 58**
  ```js
  DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
  ```
- **Line 148, Column 30**
  ```js
  const response = await window.app.apiRequest('/api/projects', {
  ```
- **Line 197, Column 7**
  ```js
  window.app?.showNotification('Failed to create project', 'error');
  ```
- **Line 204, Column 30**
  ```js
  const response = await window.app.apiRequest(
  ```
- **Line 211, Column 15**
  ```js
  window.modelConfig?.getConfig()?.modelName || 'claude-3-sonnet-20240229'
  ```
- **Line 230, Column 7**
  ```js
  window.app?.showNotification('Default conversation creation failed', 'error');
  ```
- **Line 236, Column 30**
  ```js
  const response = await window.app.apiRequest(
  ```
- **Line 255, Column 7**
  ```js
  window.app?.showNotification('Knowledge base initialization failed', 'error');
  ```
- **Line 282, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 304, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 377, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 391, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 458, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 485, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 514, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 545, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint);
  ```
- **Line 575, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 586, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint, { method, body: projectData });
  ```
- **Line 614, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 620, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint, { method: "DELETE" });
  ```
- **Line 641, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 647, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint, { method: "POST" });
  ```
- **Line 668, Column 10**
  ```js
  if (!window.app.state.isAuthenticated) {
  ```
- **Line 674, Column 30**
  ```js
  const response = await window.app.apiRequest(endpoint, { method: "PATCH" });
  ```
- **Line 698, Column 20**
  ```js
  return await window.chatManager.createNewConversation(projectId, options);
  ```
- **Line 715, Column 13**
  ```js
  await window.chatManager.deleteConversation(conversationId);
  ```
- **Line 770, Column 15**
  ```js
  await window.app.apiRequest(`/api/projects/${projectId}/files/`, {
  ```
- **Line 806, Column 21**
  ```js
  const store = window.projectEvents;
  ```
- **Line 821–824** (comments listing ways to retrieve a project ID)
  ```
  *   - window.projectManager.currentProject.id
  *   - window.projectManager.getCurrentProject().id
  *   - window.app.getProjectId()
  *   - window.app?.state?.currentProjectId
  ```
- **Line 830, Column 19**
  ```js
  const manager = window.projectManager;
  ```
- **Line 831, Column 17**
  ```js
  const appId = window.app?.getProjectId?.();
  ```
- **Line 833, Column 21**
  ```js
  const pathMatch = window.location.pathname.match(/\/projects\/([0-9a-f-]+)/i);
  ```
- **Line 834, Column 40**
  ```js
  const urlParam = new URLSearchParams(window.location.search).get('project');
  ```
- **Line 855, Column 17**
  ```js
  pathname: window.location.pathname,
  ```
- **Line 856, Column 13**
  ```js
  href: window.location.href
  ```
- **Line 873, Column 1**
  ```js
  window.projectManager = projectManager;
  ```

---

## 22. `/home/azureuser/azure_chatapp/static/js/sentry-init.js`

- **Line 13, Column 1 & 36**
  ```js
  window._sentryAlreadyInitialized = window._sentryAlreadyInitialized || false;
  ```
- **Line 26, Column 9**
  ```js
  window.location.hostname === 'localhost' ||
  ```
- **Line 27, Column 9**
  ```js
  window.location.hostname === '127.0.0.1';
  ```
- **Line 52, Column 7**
  ```js
  window.ENV?.SENTRY_DSN ||
  ```
- **Line 53, Column 7**
  ```js
  window.SENTRY_DSN ||
  ```
- **Line 62, Column 22**
  ```js
  const hostname = window.location.hostname.toLowerCase();
  ```
- **Line 63, Column 17 & 44**
  ```js
  const env = window.ENV?.ENVIRONMENT || window.SENTRY_ENVIRONMENT;
  ```
- **Line 81, Column 12**
  ```js
  return window.APP_VERSION || 'azure-chatapp@1.0.0';
  ```
- **Line 88, Column 9**
  ```js
  if (window._sentryAlreadyInitialized) {
  ```
- **Line 105, Column 9**
  ```js
  if (window.Sentry) {
  ```
- **Line 119, Column 11**
  ```js
  if (window.Sentry) {
  ```
- **Line 137, Column 9**
  ```js
  if (window._sentryAlreadyInitialized) {
  ```
- **Line 142, Column 10**
  ```js
  if (!window.Sentry || typeof Sentry.init !== 'function') {
  ```
- **Line 153, Column 12 & 33**
  ```js
  if (!window.app?.state || window.app?.state?.currentPhase === 'initialized') {
  ```
- **Line 159, Column 13**
  ```js
  window.SENTRY_TRACES_SAMPLE_RATE ||
  ```
- **Line 163, Column 13**
  ```js
  window.SENTRY_REPLAY_SESSION_SAMPLE_RATE || '0.0'
  ```
- **Line 166, Column 13**
  ```js
  window.SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE || '1.0'
  ```
- **Line 213, Column 9**
  ```js
  window._sentryAlreadyInitialized = true;
  ```
- **Line 217, Column 47 & 70**
  ```js
  Sentry.setTag('screen_resolution', `${window.screen.width}x${window.screen.height}`);
  ```
- **Line 223, Column 28 & 57**
  ```js
  screen: { width: window.screen.width, height: window.screen.height },
  document: { referrer: document.referrer, url: window.location.href },
  ```
- **Line 237, Column 9**
  ```js
  window.showUserFeedbackDialog = function (eventId) {
  ```
- **Line 238, Column 15**
  ```js
  if (window.Sentry && typeof Sentry.showReportDialog === 'function') {
  ```
- **Line 260, Column 9**
  ```js
  if (window.app?.state) {
  ```
- **Line 277, Column 5**
  ```js
  window.addEventListener('unhandledrejection', (event) => {
  ```
- **Line 278, Column 13**
  ```js
  if (!(window.Sentry && typeof Sentry.captureException === 'function')) return;
  ```
- **Line 290, Column 5**
  ```js
  window.addEventListener('error', (event) => {
  ```
- **Line 291, Column 13**
  ```js
  if (!(window.Sentry && typeof Sentry.captureException === 'function')) return;
  ```
- **Line 296, Column 20**
  ```js
  type: 'window.onerror',
  ```
- **Line 309, Column 14**
  ```js
  //   if (window.Sentry && typeof Sentry.captureException === 'function') {
  ```
- **Line 317, Column 12**
  ```js
  if (!window.Sentry || typeof Sentry.addBreadcrumb !== 'function') return;
  ```
- **Line 339, Column 28**
  ```js
  if (!document.body || !window.Sentry) return;
  ```
- **Line 340, Column 20**
  ```js
  let lastHref = window.location.href;
  ```
- **Line 343, Column 11 & 48**
  ```js
  if (window.location.href !== lastHref && window.Sentry) {
  ```
- **Line 346, Column 37**
  ```js
  message: `Navigated to: ${window.location.href}`,
  ```
- **Line 349, Column 20**
  ```js
  lastHref = window.location.href;
  ```
- **Line 360, Column 5**
  ```js
  window.addEventListener('popstate', () => {
  ```
- **Line 361, Column 11 & 48**
  ```js
  if (window.location.href !== lastHref && window.Sentry) {
  ```
- **Line 364, Column 49**
  ```js
  message: `Navigated by popstate to: ${window.location.href}`,
  ```
- **Line 367, Column 20**
  ```js
  lastHref = window.location.href;
  ```
- **Line 376, Column 10 & 27**
  ```js
  if (!window.fetch || !window.Sentry) return;
  ```
- **Line 383, Column 5**
  ```js
  window.__lastSentryTraceHeaders = lastTraceHeaders; // for debugging
  ```
- **Line 386, Column 27**
  ```js
  const originalFetch = window.fetch;
  ```
- **Line 387, Column 5**
  ```js
  window.fetch = async function (input, init = {}) {
  ```
- **Line 482, Column 3**
  ```js
  window.reportError = function (error, context = {}) {
  ```
- **Line 483, Column 9**
  ```js
  if (window.Sentry && typeof Sentry.captureException === 'function') {
  ```
- **Line 490, Column 3**
  ```js
  window.initSentry = initializeSentry;
  ```
- **Line 493, Column 14**
  ```js
  if (typeof window.sentryOnLoad === 'function') {
  ```
- **Line 494, Column 22**
  ```js
  const original = window.sentryOnLoad;
  ```
- **Line 495, Column 5**
  ```js
  window.sentryOnLoad = function () {
  ```

---

## 23. `/home/azureuser/azure_chatapp/static/js/sidebar-enhancements.js`

- **Line 11, Column 38**
  ```js
  // Helper for tracking events: use window.eventHandlers if available,
  ```
- **Line 13, Column 14**
  ```js
  const EH = window.eventHandlers || {
  ```
- **Line 88, Column 23**
  ```js
  const sidebar = window.DependencySystem?.modules?.get('sidebar');
  ```
- **Line 94, Column 3**
  ```js
  window.initSidebarEnhancements = initSidebarEnhancements;
  ```

---

## 24. `/home/azureuser/azure_chatapp/static/js/sidebar.js`

- **Line 45, Column 14**
  ```js
  const DS = window.DependencySystem;
  ```
- **Line 222, Column 9**
  ```js
  if (window.innerWidth >= 1024) {
  ```
- **Line 229, Column 21**
  ```js
  if (backdrop || window.innerWidth >= 1024) return;
  ```
- **Line 295, Column 16**
  ```js
  const DS = window.DependencySystem;
  ```
- **Line 330, Column 9**
  ```js
  if (window.chatConfig?.conversations && uiR?.renderConversations) {
  ```
- **Line 332, Column 34**
  ```js
  // uiR.renderConversations(window.chatConfig);
  ```
- **Line 334, Column 27**
  ```js
  renderConversations(window.chatConfig);
  ```
- **Line 341, Column 9**
  ```js
  if (window.chatConfig?.conversations) {
  ```
- **Line 342, Column 34**
  ```js
  renderStarredConversations(window.chatConfig);
  ```
- **Line 551, Column 5**
  ```js
  if (window.DependencySystem) {
  ```
- **Line 555, Column 5**
  ```js
  window.DependencySystem.register('sidebar', instance);
  ```

---

## 25. `/home/azureuser/azure_chatapp/static/js/theme-toggle.js`

- **Line 47, Column 12**
  ```js
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
  ```
- **Line 70, Column 3**
  ```js
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  ```

---

## 26. `/home/azureuser/azure_chatapp/static/js/utils.js`

- **Line 22, Column 1**
  ```js
  window.DOMUtils = DOMUtils;
  ```

---

### Summary

Each section above contains lines where `window` is referenced—frequently checking for modules (like `DependencySystem`), global objects (e.g., `projectManager`, `auth`, `chatManager`), or performing registration calls.

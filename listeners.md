Below is a curated summary of **trackListener** and standard (*addEventListener*) usages in your codebase, split into two main sections with each reference presented in a more readable, annotated format. This layout should assist with scanning usage patterns, debugging, or refactoring these event handling mechanisms.

---

# **TrackListener Usage**

> “trackListener” likely refers to a custom wrapper around DOM event binding (and possibly cleanup). Below are all references where it’s mentioned or used.

## **1. `/home/azureuser/azure_chatapp/static/js/accessibility-utils.js`**
- **Line 38, Column 24**
  ```js
  window.eventHandlers.trackListener(document, 'keydown', async e => {
  ```
- **Line 94, Column 24**
  ```js
  window.eventHandlers.trackListener(document, 'click', e => {
  ```

## **2. `/home/azureuser/azure_chatapp/static/js/auth.js`**
- **Line 487, Column 29**
  ```js
  window.eventHandlers?.trackListener(loginForm, 'submit', async (e) => {
  ```

## **3. `/home/azureuser/azure_chatapp/static/js/chat.js`**
- **Line 431, Column 13**
  ```js
  const trackListener =
  ```
- **Line 432, Column 31**
  ```js
  window.eventHandlers?.trackListener ??
  ```
- **Line 436, Column 9**
  ```js
  trackListener(this.inputField, "keydown", (e) => {
  ```
- **Line 444, Column 9**
  ```js
  trackListener(this.sendButton, "click", () => {
  ```
- **Line 448, Column 7**
  ```js
  trackListener(document, "regenerateChat", () => {
  ```
- **Line 461, Column 7**
  ```js
  trackListener(document, "modelConfigChanged", (e) => {
  ```

## **4. `/home/azureuser/azure_chatapp/static/js/chatExtensions.js`**
- **Line 34, Column 9 & 39**
  ```js
  const trackListener = eventHandlers.trackListener
  ```
- **Line 35, Column 21**
  ```js
  ? eventHandlers.trackListener.bind(eventHandlers)
  ```
- **Line 51, Column 3**
  ```js
  trackListener(editTitleBtn, "click", () => {
  ```
- **Line 52, Column 95**
  ```js
  handleTitleEditClick(..., trackListener);
  ```
- **Line 64, Column 3**
  ```js
  trackListener
  ```
- **Line 183, Column 3**
  ```js
  trackListener(chatTitleEl, "keydown", keyHandler, {
  ```
- **Line 186, Column 3**
  ```js
  trackListener(document, "click", clickOutsideHandler, {
  ```
- **Line 189, Column 3**
  ```js
  trackListener(editTitleBtn, "click", () => completeEditing(true), {
  ```

## **5. `/home/azureuser/azure_chatapp/static/js/eventHandler.js`**
- **Line 56, Column 10**
  ```js
  function trackListener(element, type, handler, options = {}) {
  ```
- **Line 239, Column 10**
  ```js
  return trackListener(container, eventType, delegatedHandler, options);
  ```
- **Line 289, Column 3**
  ```js
  trackListener(toggleButton, 'click', () => {
  ```
- **Line 330, Column 5**
  ```js
  trackListener(openBtn, 'click', open);
  ```
- **Line 333, Column 5**
  ```js
  trackListener(closeBtn, 'click', close);
  ```
- **Line 335, Column 3**
  ```js
  trackListener(modal, 'keydown', (e) => {
  ```
- **Line 340, Column 3**
  ```js
  trackListener(modal, 'click', (e) => {
  ```
- **Line 362, Column 3**
  ```js
  trackListener(form, 'submit', async (e) => {
  ```
- **Line 477, Column 5**
  ```js
  trackListener(newConversationBtn, 'click', async () => {
  ```
- **Line 499, Column 5**
  ```js
  trackListener(createProjectBtn, 'click', () => {
  ```
- **Line 513, Column 5**
  ```js
  trackListener(logoutBtn, 'click', (e) => {
  ```
- **Line 614, Column 5**
  ```js
  trackListener(navToggleBtn, 'click', () => {
  ```
- **Line 631, Column 5**
  ```js
  trackListener(closeSidebarBtn, 'click', () => {
  ```
- **Line 656, Column 7**
  ```js
  trackListener(tab, 'click', () => {
  ```
- **Line 689, Column 5**
  ```js
  trackListener(keyboardHelpBtn, 'click', () => {
  ```
- **Line 696, Column 7**
  ```js
  trackListener(closeBtn, 'click', () => {
  ```
- **Line 701, Column 5**
  ```js
  trackListener(keyboardHelp, 'click', (e) => {
  ```
- **Line 709, Column 3**
  ```js
  trackListener(document, 'keydown', (e) => {
  ```
- **Line 741, Column 25**
  ```js
  * @property {Function} trackListener - ...
  ```
- **Line 770, Column 3**
  ```js
  trackListener,
  ```

## **6. `/home/azureuser/azure_chatapp/static/js/FileUploadComponent.js`**
- **Line 58, Column 28**
  ```js
  window.eventHandlers.trackListener(this.elements.fileInput, 'change', (e) => {
  ```
- **Line 65, Column 28**
  ```js
  window.eventHandlers.trackListener(this.elements.uploadBtn, 'click', () => {
  ```
- **Line 73, Column 30**
  ```js
  window.eventHandlers.trackListener(this.elements.dragZone, eventName, (e) => {
  ```
- **Line 89, Column 28**
  ```js
  window.eventHandlers.trackListener(this.elements.dragZone, 'click', () => {
  ```

## **7. `/home/azureuser/azure_chatapp/static/js/modalManager.js`**
- **Line 14, Column 28**
  ```js
  * - window.eventHandlers.trackListener(optional) ...
  ```
- **Line 55, Column 51**
  ```js
  // If eventHandlers is available, use its trackListener. Otherwise, fallback.
  ```
- **Line 56, Column 35**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 57, Column 32**
  ```js
  window.eventHandlers.trackListener(
  ```
- **Line 240, Column 44**
  ```js
  // Attach handlers with eventHandlers->trackListener ...
  ```
- **Line 241, Column 31**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 242, Column 28**
  ```js
  window.eventHandlers.trackListener(newConfirmBtn, "click", confirmHandler, {
  ```
- **Line 245, Column 28**
  ```js
  window.eventHandlers.trackListener(newCancelBtn, "click", cancelHandler, {
  ```
- **Line 376, Column 31**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 377, Column 28**
  ```js
  window.eventHandlers.trackListener(this.formElement, "submit", submitHandler, {
  ```
- **Line 392, Column 33**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 393, Column 30**
  ```js
  window.eventHandlers.trackListener(cancelBtn, "click", cancelHandler, {
  ```
- **Line 407, Column 31**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 408, Column 28**
  ```js
  window.eventHandlers.trackListener(document, "keydown", escHandler, {
  ```
- **Line 421, Column 31**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 422, Column 28**
  ```js
  window.eventHandlers.trackListener(this.modalElement, "click", backdropHandler, {
  ```

## **8. `/home/azureuser/azure_chatapp/static/js/modelConfig.js`**
- **Line 140, Column 31 & 67**
  ```js
  if (window.eventHandlers?.trackListener)
      window.eventHandlers.trackListener(sel, 'change', handler);
  ```

## **9. `/home/azureuser/azure_chatapp/static/js/projectDashboardUtils.js`**
- **Line 72, Column 30**
  ```js
  window.eventHandlers.trackListener(element, 'click', options.onclick);
  ```
- **Line 79, Column 32**
  ```js
  window.eventHandlers.trackListener(element, eventType, handler);
  ```
- **Line 149, Column 26**
  ```js
  window.eventHandlers.trackListener(editBtn, 'click', () => {
  ```
- **Line 163, Column 28**
  ```js
  window.eventHandlers.trackListener(pinBtn, 'click', async () => {
  ```
- **Line 194, Column 28**
  ```js
  window.eventHandlers.trackListener(archiveBtn, 'click', async () => {

## **10. `/home/azureuser/azure_chatapp/static/js/projectDetailsComponent.js`**
- **Line 149, Column 28**
  ```js
  window.eventHandlers.trackListener(this.elements.backBtn, 'click', (e) => {
  ```
- **Line 159, Column 28**
  ```js
  window.eventHandlers.trackListener(button, 'click', () => {
  ```
- **Line 188, Column 28**
  ```js
  window.eventHandlers.trackListener(newChatBtn, 'click', () => {
  ```
- **Line 794, Column 26**
  ```js
  window.eventHandlers.trackListener(downloadBtn, 'click', () => {
  ```
- **Line 810, Column 26**
  ```js
  window.eventHandlers.trackListener(deleteBtn, 'click', () => this._confirmDeleteFile(file.id));
  ```
- **Line 860, Column 26**
  ```js
  window.eventHandlers.trackListener(item, 'click', () => this._handleConversationClick(conversation));
  ```
- **Line 902, Column 26**
  ```js
  window.eventHandlers.trackListener(downloadBtn, 'click', () => {
  ```

## **11. `/home/azureuser/azure_chatapp/static/js/projectListComponent.js`**
- **Line 268, Column 30**
  ```js
  window.eventHandlers.trackListener(this.element, 'click', (e) => this._handleCardClick(e), {
  ```
- **Line 301, Column 39**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 302, Column 38**
  ```js
  window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
  ```
- **Line 306, Column 38**
  ```js
  window.eventHandlers.trackListener(tab, 'click', clickHandler, {
  ```
- **Line 310, Column 38**
  ```js
  window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
  ```
- **Line 314, Column 38**
  ```js
  window.eventHandlers.trackListener(tab, 'click', clickHandler, {
  ```
- **Line 646, Column 39**
  ```js
  if (window.eventHandlers?.trackListener) {
  ```
- **Line 647, Column 38**
  ```js
  window.eventHandlers.trackListener(btn, 'click', handler, {
  ```
- **Line 757, Column 34**
  ```js
  window.eventHandlers.trackListener(createBtn, 'click', () => this._openNewProjectModal(), {
  ```
- **Line 782, Column 34**
  ```js
  window.eventHandlers.trackListener(loginBtn, 'click', handler, {
  ```
- **Line 804, Column 34**
  ```js
  window.eventHandlers.trackListener(retryBtn, 'click', () => this._loadProjects(), {

## **12. `/home/azureuser/azure_chatapp/static/js/sidebar-enhancements.js`**
- **Line 14, Column 5**
  ```js
  trackListener(el, type, handler, opts) {
  ```
- **Line 37, Column 10**
  ```js
  EH.trackListener(oldModelToggle, 'click', () => {
  ```
- **Line 46, Column 10**
  ```js
  EH.trackListener(oldInstrToggle, 'click', () => {
  ```
- **Line 55, Column 10**
  ```js
  EH.trackListener(newModelCheckbox, 'change', () => {
  ```
- **Line 63, Column 10**
  ```js
  EH.trackListener(newInstrCheckbox, 'change', () => {
  ```
- **Line 86, Column 8**
  ```js
  EH.trackListener(btn, 'click', e => {
  ```

## **13. `/home/azureuser/azure_chatapp/static/js/sidebar.js`**
- **Line 121, Column 15**
  ```js
  if (EH?.trackListener) {
  ```
- **Line 122, Column 12**
  ```js
  EH.trackListener(target, type, handler, { description: desc });
  ```
- **Line 236, Column 13**
  ```js
  if (EH?.trackListener) {
  ```
- **Line 237, Column 10**
  ```js
  EH.trackListener(backdrop, 'click', closeHandler, { description: 'Sidebar backdrop' });
  ```

---

# **EventListener Usages**

> These are direct calls to standard DOM events using `addEventListener`. Below is an organized list of each instance.

## **1. `/home/azureuser/azure_chatapp/static/js/accessibility-utils.js`**
- **Line 144, Column 15**
  ```js
  document.addEventListener('invalid', e => {
  ```
- **Line 150, Column 15**
  ```js
  document.addEventListener('change', e => {
  ```
- **Line 216, Column 11**
  ```js
  skip.addEventListener('click', e => {
  ```
- **Line 236, Column 16**
  ```js
  container.addEventListener('keydown', e => {
  ```

## **2. `/home/azureuser/azure_chatapp/static/js/app.js`**
- **Line 246, Column 15**
  ```js
  window.addEventListener('popstate', fire);
  ```
- **Line 515, Column 11**
  ```js
  window.addEventListener('locationchange', handleNavigationChange);
  ```
- **Line 548, Column 21**
  ```js
  auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
  ```
- **Line 606, Column 15**
  ```js
  window.addEventListener('popstate', handleNavigationChange);
  ```
- **Line 626, Column 26**
  ```js
  auth.AuthBus?.addEventListener('authStateChanged', safeInitChat);
  ```
- **Line 629, Column 30**
  ```js
  if (typeof pm.addEventListener === 'function') {
  ```
- **Line 630, Column 23**
  ```js
  pm.addEventListener('projectSelected', handler);
  ```
- **Line 634, Column 29**
  ```js
  document.addEventListener('projectSelected', handler);
  ```
- **Line 654, Column 17**
  ```js
  document.addEventListener('DOMContentLoaded', () => {
  ```

## **3. `/home/azureuser/azure_chatapp/static/js/auth.js`**
- **Line 503, Column 15**
  ```js
  document.addEventListener('modalsLoaded', setupLoginForm);
  ```
- **Line 588, Column 22**
  ```js
  document.addEventListener('DOMContentLoaded', fn, { once: true });
  ```
- **Line 612, Column 19**
  ```js
  document.addEventListener('mousedown', handleOutside, true);
  ```
- **Line 613, Column 19**
  ```js
  document.addEventListener('keydown', handleKeydown, true);
  ```
- **Line 622, Column 22**
  ```js
  document.removeEventListener('mousedown', handleOutside, true);
  ```
- **Line 623, Column 22**
  ```js
  document.removeEventListener('keydown', handleKeydown, true);
  ```
- **Line 641, Column 16**
  ```js
  authBtn.addEventListener('click', (e) => {
  ```
- **Line 651, Column 15**
  ```js
  window.addEventListener('blur', hideDropdown);
  ```
- **Line 655, Column 20**
  ```js
  auth.AuthBus?.addEventListener('authStateChanged', (ev) => {
  ```

## **4. `/home/azureuser/azure_chatapp/static/js/chat.js`**
- **Line 433, Column 42**
  ```js
  (el, type, fn, opts) => { el.addEventListener(type, fn, opts); return fn; }
  ```
- **Line 528, Column 17**
  ```js
  toggle.addEventListener("click", () => {
  ```

## **5. `/home/azureuser/azure_chatapp/static/js/chatExtensions.js`**
- **Line 36, Column 36**
  ```js
  : (el, evt, fn, opts) => el.addEventListener(evt, fn, opts);
  ```
- **Line 98, Column 23**
  ```js
  chatTitleEl.removeEventListener('keydown', keyHandler);
  ```
- **Line 99, Column 20**
  ```js
  document.removeEventListener('click', clickOutsideHandler);
  ```

## **6. `/home/azureuser/azure_chatapp/static/js/debug-project.js`**
- **Line 8, Column 15**
  ```js
  document.addEventListener('appInitialized', function debugInitHandler() {
  ```
- **Line 9, Column 20**
  ```js
  document.removeEventListener('appInitialized', debugInitHandler);
  ```
- **Line 107, Column 17**
  ```js
  document.addEventListener('projectListReady', () => {
  ```
- **Line 109, Column 19**
  ```js
  document.addEventListener('projectsLoaded', function(e) {
  ```
- **Line 247, Column 19**
  ```js
  document.addEventListener('DOMContentLoaded', function() {
  ```
- **Line 274, Column 17**
  ```js
  document.addEventListener('appInitialized', function() {
  ```

## **7. `/home/azureuser/azure_chatapp/static/js/eventHandler.js`**
- **Line 125, Column 14**
  ```js
  element.addEventListener(type, wrappedHandler, finalOptions);
  ```
- **Line 190, Column 30**
  ```js
  listener.element.removeEventListener(
  ```
- **Line 735, Column 13**
  ```js
  document.addEventListener('modalsLoaded', reinitializeAuthElements);
  ```
- **Line 736, Column 13**
  ```js
  document.addEventListener('authStateChanged', reinitializeAuthElements);
  ```

## **8. `/home/azureuser/azure_chatapp/static/js/fixes-verification.js`**
- **Line 41, Column 30**
  ```js
  window.auth.AuthBus.addEventListener('authStateChanged', (event) => {
  ```
- **Line 62, Column 17**
  ```js
  document.addEventListener('projectListReady', function handler() {
  ```
- **Line 63, Column 22**
  ```js
  document.removeEventListener('projectListReady', handler);
  ```
- **Line 105, Column 17**
  ```js
  document.addEventListener('projectDashboardInitialized', (e) => {
  ```
- **Line 195, Column 17**
  ```js
  document.addEventListener('appInitialized', function() {
  ```
- **Line 201, Column 17**
  ```js
  document.addEventListener('DOMContentLoaded', function() {
  ```

## **9. `/home/azureuser/azure_chatapp/static/js/formatting.js`**
- **Line 145, Column 18**
  ```js
  element.addEventListener(eventType, value);
  ```

## **10. `/home/azureuser/azure_chatapp/static/js/kb-result-handlers.js`**
- **Line 6, Column 13**
  ```js
  document.addEventListener('DOMContentLoaded', function() {
  ```
- **Line 21, Column 16**
  ```js
  copyBtn.addEventListener('click', function() {
  ```
- **Line 29, Column 16**
  ```js
  kbModal.addEventListener('keydown', function(e) {
  ```

## **11. `/home/azureuser/azure_chatapp/static/js/knowledgeBaseComponent.js`**
- **Line 96, Column 18**
  ```js
  this._setupEventListeners();  // Setup listeners early
  ```
- **Line 250, Column 41**
  ```js
  this.elements.settingsButton.addEventListener('click', () => this._showKnowledgeBaseModal());
  ```
- **Line 294, Column 11**
  ```js
  _setupEventListeners() {
  ```
- **Line 303, Column 39**
  ```js
  this.elements.searchButton.addEventListener('click', () => this._triggerSearch());
  ```
- **Line 308, Column 38**
  ```js
  this.elements.searchInput.addEventListener('input', (e) => {
  ```
- **Line 311, Column 38**
  ```js
  this.elements.searchInput.addEventListener('keyup', (e) => {
  ```
- **Line 318, Column 35**
  ```js
  this.elements.kbToggle.addEventListener('change', (e) => {
  ```
- **Line 325, Column 42**
  ```js
  this.elements.reprocessButton.addEventListener('click', () => {
  ```
- **Line 333, Column 38**
  ```js
  this.elements.setupButton.addEventListener('click', () => this._showKnowledgeBaseModal());
  ```
- **Line 338, Column 39**
  ```js
  this.elements.settingsForm.addEventListener('submit', (e) => this._handleKnowledgeBaseFormSubmit(e));
  ```
- **Line 342, Column 19**
  ```js
  document.addEventListener('authStateChanged', (e) => {
  ```
- **Line 348, Column 38**
  ```js
  this.elements.modelSelect.addEventListener('change', () => this._validateSelectedModelDimensions());
  ```
- **Line 719, Column 17**
  ```js
  item.addEventListener('click', () => this._showResultDetail(result));
  ```
- **Line 720, Column 17**
  ```js
  item.addEventListener('keydown', e => {
  ```

## **12. `/home/azureuser/azure_chatapp/static/js/modalManager.js`**
- **Line 64, Column 22**
  ```js
  modalEl.addEventListener("close", () => this._onDialogClose(modalId));
  ```
- **Line 249, Column 24**
  ```js
  newConfirmBtn.addEventListener("click", confirmHandler);
  ```
- **Line 250, Column 23**
  ```js
  newCancelBtn.addEventListener("click", cancelHandler);
  ```
- **Line 313, Column 15**
  ```js
  this.setupEventListeners();
  ```
- **Line 371, Column 8**
  ```js
  setupEventListeners() {
  ```
- **Line 382, Column 27**
  ```js
  this.formElement.addEventListener("submit", submitHandler);
  ```
- **Line 397, Column 22**
  ```js
  cancelBtn.addEventListener("click", cancelHandler);
  ```
- **Line 412, Column 19**
  ```js
  document.addEventListener("keydown", escHandler);
  ```
- **Line 426, Column 28**
  ```js
  this.modalElement.addEventListener("click", backdropHandler);
  ```

## **13. `/home/azureuser/azure_chatapp/static/js/modelConfig.js`**
- **Line 115, Column 17**
  ```js
  document.addEventListener('modelConfigChanged', (e) => callback(e.detail));
  ```
- **Line 141, Column 17**
  ```js
  else sel.addEventListener('change', handler);
  ```
- **Line 151, Column 15**
  ```js
  slider.addEventListener('input', (e) => update(e.target.value));
  ```
- **Line 165, Column 15**
  ```js
  toggle.addEventListener('change', handler);
  ```

## **14. `/home/azureuser/azure_chatapp/static/js/notification-handler.js`**
- **Line 71, Column 21**
  ```js
  notification.addEventListener('click', () => {
  ```
- **Line 221, Column 15**
  ```js
  window.addEventListener('message', handleNotificationMessages);
  ```
- **Line 232, Column 21**
  ```js
  element.removeEventListener(type, handler);
  ```

## **15. `/home/azureuser/azure_chatapp/static/js/projectDashboard.js`**
- **Line 46, Column 34**
  ```js
  if (authBus && typeof authBus.addEventListener === 'function') {
  ```
- **Line 47, Column 14**
  ```js
  authBus.addEventListener('authStateChanged', handler);
  ```
- **Line 50, Column 15**
  ```js
  document.addEventListener('authStateChanged', handler);
  ```
- **Line 80, Column 23**
  ```js
  document.addEventListener('DOMContentLoaded', resolve, { once: true })
  ```
- **Line 103, Column 18**
  ```js
  this._setupEventListeners();
  ```
- **Line 500, Column 9**
  ```js
  _setupEventListeners() {
  ```
- **Line 502, Column 17**
  ```js
  document.addEventListener('projectsLoaded', this._handleProjectsLoaded.bind(this));
  ```
- **Line 503, Column 17**
  ```js
  document.addEventListener('projectLoaded', this._handleProjectLoaded.bind(this));
  ```
- **Line 504, Column 17**
  ```js
  document.addEventListener('projectStatsLoaded', this._handleProjectStatsLoaded.bind(this));
  ```
- **Line 505, Column 17**
  ```js
  document.addEventListener('projectFilesLoaded', this._handleFilesLoaded.bind(this));
  ```
- **Line 506, Column 17**
  ```js
  document.addEventListener('projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this));
  ```
- **Line 507, Column 17**
  ```js
  document.addEventListener('projectNotFound', this._handleProjectNotFound.bind(this));
  ```
- **Line 510, Column 17**
  ```js
  document.addEventListener('projectCreated', this._handleProjectCreated.bind(this));
  ```
- **Line 513, Column 15**
  ```js
  window.addEventListener('popstate', this._handlePopState.bind(this));
  ```
- **Line 516, Column 17**
  ```js
  document.addEventListener('authStateChanged', this._handleAuthStateChange.bind(this));
  ```

## **16. `/home/azureuser/azure_chatapp/static/js/projectDashboardUtils.js`**
- **Line 145, Column 25**
  ```js
  ProjectDashboard.setupEventListeners = () => {
  ```
- **Line 239, Column 27**
  ```js
  ProjectDashboard.setupEventListeners();
  ```

## **17. `/home/azureuser/azure_chatapp/static/js/projectDetailsComponent.js`**
- **Line 147, Column 35**
  ```js
  this.elements.backBtn.removeEventListener('click', this.onBack);
  ```
- **Line 194, Column 17**
  ```js
  document.addEventListener('projectConversationsLoaded', (e) => this.renderConversations(e.detail?.conversations || []));
  ```
- **Line 195, Column 17**
  ```js
  document.addEventListener('projectFilesLoaded', (e) => this.renderFiles(e.detail?.files || []));
  ```
- **Line 196, Column 17**
  ```js
  document.addEventListener('projectArtifactsLoaded', (e) => this.renderArtifacts(e.detail?.artifacts || []));
  ```
- **Line 197, Column 17**
  ```js
  document.addEventListener('projectStatsLoaded', (e) => this.renderStats(e.detail || {}));
  ```

## **18. `/home/azureuser/azure_chatapp/static/js/projectListComponent.js`**
- **Line 86, Column 23**
  ```js
  this._bindEventListeners();
  ```
- **Line 145, Column 44**
  ```js
  document.removeEventListener('projectListReady', handler);
  ```
- **Line 149, Column 33**
  ```js
  document.addEventListener('projectListReady', handler, { once: true });
  ```
- **Line 154, Column 44**
  ```js
  document.removeEventListener('projectListReady', handler);
  ```
- **Line 257, Column 10**
  ```js
  _bindEventListeners() {
  ```
- **Line 262, Column 21**
  ```js
  document.addEventListener('projectsLoaded', handler);
  ```
- **Line 263, Column 39**
  ```js
  if (window.projectManager?.addEventListener) {
  ```
- **Line 264, Column 38**
  ```js
  window.projectManager.addEventListener('projectsLoaded', handler);
  ```
- **Line 273, Column 21**
  ```js
  document.addEventListener('projectCreated', (e) => this._handleProjectCreated(e.detail));
  ```
- **Line 274, Column 21**
  ```js
  document.addEventListener('projectUpdated', (e) => this._handleProjectUpdated(e.detail));
  ```
- **Line 277, Column 21**
  ```js
  document.addEventListener('authStateChanged', (e) => {
  ```
- **Line 616, Column 36**
  ```js
  document.removeEventListener('modalsLoaded', listener);
  ```
- **Line 619, Column 25**
  ```js
  document.addEventListener('modalsLoaded', listener);
  ```
- **Line 651, Column 24**
  ```js
  btn.addEventListener('click', handler);
  ```

## **19. `/home/azureuser/azure_chatapp/static/js/sentry-init.js`**
- **Line 228, Column 21**
  ```js
  document.addEventListener('authStateChanged', function (evt) {
  ```
- **Line 265, Column 21**
  ```js
  document.addEventListener('DOMContentLoaded', initWhenReady);
  ```
- **Line 277, Column 15**
  ```js
  window.addEventListener('unhandledrejection', (event) => {
  ```
- **Line 290, Column 15**
  ```js
  window.addEventListener('error', (event) => {
  ```
- **Line 316, Column 17**
  ```js
  document.addEventListener('click', (event) => {
  ```
- **Line 360, Column 15**
  ```js
  window.addEventListener('popstate', () => {
  ```

## **20. `/home/azureuser/azure_chatapp/static/js/sidebar-enhancements.js`**
- **Line 12, Column 32**
  ```js
  // otherwise fall back to addEventListener.
  ```
- **Line 15, Column 23 & 44**
  ```js
  if (el && el.addEventListener) el.addEventListener(type, handler, opts?.capture);
  ```

## **21. `/home/azureuser/azure_chatapp/static/js/sidebar.js`**
- **Line 16, Column 68**
  ```js
  *   - eventHandlers : optional, or fallback to direct addEventListener
  ```
- **Line 124, Column 19**
  ```js
  target.addEventListener(type, handler);
  ```
- **Line 239, Column 19**
  ```js
  backdrop.addEventListener('click', closeHandler);
  ```
- **Line 441, Column 10**
  ```js
  b.addEventListener('click', e => {
  ```
- **Line 482, Column 11**
  ```js
  li.addEventListener('click', () => {
  ```

## **22. `/home/azureuser/azure_chatapp/static/js/theme-toggle.js`**
- **Line 10, Column 13**
  ```js
  document.addEventListener('DOMContentLoaded', () => {
  ```
- **Line 63, Column 21**
  ```js
  darkModeToggle.addEventListener('click', () => {
  ```
- **Line 70, Column 56**
  ```js
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  ```

---

## **Summary**

- **trackListener** usages generally invoke a wrapper function that may handle event subscription, logging, or cleanup in a standardized way.
- Standard **addEventListener** calls directly interact with the DOM or custom event buses (e.g., `AuthBus` or `projectManager`).

This reference should facilitate quick discovery of event listener logic and highlight opportunities for consolidation or best-practice improvements (e.g., consistent naming, usage, or advanced event delegation).

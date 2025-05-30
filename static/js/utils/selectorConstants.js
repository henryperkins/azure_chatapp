/**
 * selectorConstants.js
 * Centralized selectors for critical DOM elements used across the application.
 */

export const SELECTORS = {
  // Project List View
  projectListView: '#projectListView',
  projectListContainer: '#projectListContainer',
  projectCardsPanel: '#projectCardsPanel',
  projectFilterTabs: '#projectFilterTabs',
  loadingState: '#loadingState',

  // Project Details View
  projectDetailsView: '#projectDetailsView',
  projectDetailsContainer: '#projectDetailsContainer',
  projectTitle: '#projectTitle',
  backToProjectsBtn: '#backToProjectsBtn',

  // Project Tabs
  chatTab: '#chatTab',
  filesTab: '#filesTab',
  detailsTab: '#detailsTab',
  knowledgeTab: '#knowledgeTab',
  settingsTab: '#settingsTab',

  // Chat UI
  chatUIContainer: '#chatUIContainer',
  chatMessages: '#chatMessages',
  chatInput: '#chatInput',
  chatSendBtn: '#chatSendBtn',
  chatTitle: '#chatTitle',
  newConversationBtn: '#newConversationBtn',
  conversationsList: '#conversationsList',

  // File Upload
  fileInput: '#fileInput',
  uploadFileBtn: '#uploadFileBtn',
  dragDropZone: '#dragDropZone',
  filesUploadProgress: '#filesUploadProgress',
  fileProgressBar: '#fileProgressBar',
  uploadStatus: '#uploadStatus',
  filesList: '#filesList',

  // Knowledge Base
  knowledgeStatus: '#knowledgeStatus',
  knowledgeBaseInactive: '#knowledgeBaseInactive',
  kbStatusBadge: '#kbStatusBadge',
  kbToggle: '#kbToggle',
  kbDocCount: '#kbDocCount',
  kbChunkCount: '#kbChunkCount',
  kbModelDisplay: '#kbModelDisplay',
  knowledgeBaseName: '#knowledgeBaseName',
  kbVersionDisplay: '#kbVersionDisplay',
  kbLastUsedDisplay: '#kbLastUsedDisplay',
  knowledgeFileSize: '#knowledgeFileSize',
  reprocessButton: '#reprocessButton',
  setupButton: '#setupButton',
  settingsButton: '#settingsButton',
  knowledgeBaseFilesSection: '#knowledgeBaseFilesSection',
  knowledgeBaseFilesListContainer: '#knowledgeBaseFilesListContainer',
  knowledgeBaseSettingsModal: '#knowledgeBaseSettingsModal',
  knowledgeBaseForm: '#knowledgeBaseForm',
  modelSelect: '#modelSelect',
  cancelKnowledgeBaseFormBtn: '#cancelKnowledgeBaseFormBtn',
  deleteKnowledgeBaseBtn: '#deleteKnowledgeBaseBtn'
};

export const ELEMENT_SELECTORS = {
  // Knowledge Base Component specific selectors
  KB: {
    container: 'knowledgeTab',
    activeSection: 'knowledgeStatus',
    inactiveSection: 'knowledgeBaseInactive',
    statusBadge: 'kbStatusBadge',
    toggle: 'kbToggle',
    docCount: 'kbDocCount',
    chunkCount: 'kbChunkCount',
    modelDisplay: 'kbModelDisplay',
    baseName: 'knowledgeBaseName',
    versionDisplay: 'kbVersionDisplay',
    lastUsedDisplay: 'kbLastUsedDisplay',
    fileSize: 'knowledgeFileSize',
    reprocessButton: 'reprocessButton',
    setupButton: 'setupButton',
    settingsButton: 'settingsButton',
    filesSection: 'knowledgeBaseFilesSection',
    filesListContainer: 'knowledgeBaseFilesListContainer',
    settingsModal: 'knowledgeBaseSettingsModal',
    settingsForm: 'knowledgeBaseForm',
    modelSelect: 'modelSelect',
    cancelSettingsBtn: 'cancelKnowledgeBaseFormBtn',
    deleteBtn: 'deleteKnowledgeBaseBtn'
  },

  // Chat Component specific selectors
  CHAT: {
    container: 'chatUIContainer',
    messages: 'chatMessages',
    input: 'chatInput',
    sendBtn: 'chatSendBtn',
    title: 'chatTitle',
    newConversationBtn: 'newConversationBtn',
    conversationsList: 'conversationsList'
  },

  // File Upload Component specific selectors
  FILE_UPLOAD: {
    input: 'fileInput',
    uploadBtn: 'uploadFileBtn',
    dragZone: 'dragDropZone',
    progress: 'filesUploadProgress',
    progressBar: 'fileProgressBar',
    status: 'uploadStatus',
    filesList: 'filesList'
  }
};

export function createSelectorConstants() {
  return { SELECTORS, ELEMENT_SELECTORS, cleanup () {} };
}

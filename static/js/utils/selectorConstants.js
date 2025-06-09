/**
 * selectorConstants.js – Canonical DOM selector IDs (2025 guard-rails)
 * ------------------------------------------------------------------
 * 1.  All values are stored as *ID strings without the leading ‘#’*.
 * 2.  A `getSel(id)` helper returns the CSS selector ‘#id’ – new code should
 *     use this instead of hard-coding ‘#…’ values.
 * 3.  Objects are deeply `Object.freeze()`-d to guarantee immutability which
 *     is enforced by the week-1 selector-constants tests.
 * 4.  Legacy modules that still import `SELECTORS.fooBar` and expect the
 *     *prefixed* form keep working via a proxy that prepends ‘#’ on access.
 */

// ────────────────────────────────────────────────────────────────────────────

function deepFreeze (obj) {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return obj;
}

/**
 * Convenience helper that converts an *id* (no ‘#’) to a CSS selector string.
 */
export function getSel (id) {
  return `#${id}`;
}

/**
 * Utility that picks a subset of keys from a source object and deep-freezes
 * the resulting shallow copy.
 */
export function pickKeys (source, keys) {
  const out = {};
  keys.forEach(k => {
    if (k in source) out[k] = source[k];
  });
  return deepFreeze(out);
}

// Canonical map (ids only – NO leading #) ──────────────────────────────────
const ID_MAP = {
  /* Project List View */
  projectListView: 'projectListView',
  projectListContainer: 'projectListContainer',
  projectCardsPanel: 'projectCardsPanel',
  projectFilterTabs: 'projectFilterTabs',
  loadingState: 'loadingState',

  /* Project Details View */
  projectDetailsView: 'projectDetailsView',
  projectDetailsContainer: 'projectDetailsContainer',
  projectTitle: 'projectTitle',
  backToProjectsBtn: 'backToProjectsBtn',

  /* Project Tabs */
  chatTab: 'chatTab',
  filesTab: 'filesTab',
  detailsTab: 'detailsTab',
  knowledgeTab: 'knowledgeTab',
  settingsTab: 'settingsTab',

  /* Chat UI */
  chatUIContainer: 'chatUIContainer',
  chatMessages: 'chatMessages',
  chatInput: 'chatInput',
  chatSendBtn: 'chatSendBtn',
  chatTitle: 'chatTitle',
  newConversationBtn: 'newConversationBtn',
  conversationsList: 'conversationsList',

  /* File Upload */
  fileInput: 'fileInput',
  uploadFileBtn: 'uploadFileBtn',
  dragDropZone: 'dragDropZone',
  filesUploadProgress: 'filesUploadProgress',
  fileProgressBar: 'fileProgressBar',
  uploadStatus: 'uploadStatus',
  filesList: 'filesList',
  indexKbCheckbox: 'indexKbCheckbox',

  /* Knowledge Base */
  knowledgeStatus: 'knowledgeStatus',
  knowledgeBaseInactive: 'knowledgeBaseInactive',
  kbStatusBadge: 'kbStatusBadge',
  kbToggle: 'kbToggle',
  kbDocCount: 'kbDocCount',
  kbChunkCount: 'kbChunkCount',
  kbModelDisplay: 'kbModelDisplay',
  knowledgeBaseName: 'knowledgeBaseName',
  kbVersionDisplay: 'kbVersionDisplay',
  kbLastUsedDisplay: 'kbLastUsedDisplay',
  knowledgeFileSize: 'knowledgeFileSize',
  reprocessButton: 'reprocessButton',
  setupButton: 'setupButton',
  settingsButton: 'settingsButton',
  knowledgeBaseFilesSection: 'knowledgeBaseFilesSection',
  knowledgeBaseFilesListContainer: 'knowledgeBaseFilesListContainer',
  knowledgeBaseSettingsModal: 'knowledgeBaseSettingsModal',
  knowledgeBaseForm: 'knowledgeBaseForm',
  cancelKnowledgeBaseFormBtn: 'cancelKnowledgeBaseFormBtn',
  deleteKnowledgeBaseBtn: 'deleteKnowledgeBaseBtn',
  modelSelect: 'modelSelect'
};

deepFreeze(ID_MAP);

export const SELECTORS = deepFreeze(
  Object.fromEntries(
    Object.entries(ID_MAP).map(([k, v]) => [k, `#${v}`])
  )
);

// Derived element groups (id-only) ──────────────────────────────────────────
export const ELEMENT_SELECTORS = deepFreeze({
  KB: (() => {
    // 1. Pick base keys (returns *frozen* object) – clone to allow aliasing
    const frozenBase = pickKeys(ID_MAP, [
      'knowledgeTab', // alias container – renamed below
      'knowledgeStatus',
      'knowledgeBaseInactive',
      'kbStatusBadge',
      'kbToggle',
      'kbDocCount',
      'kbChunkCount',
      'kbModelDisplay',
      'knowledgeBaseName',
      'kbVersionDisplay',
      'kbLastUsedDisplay',
      'knowledgeFileSize',
      'reprocessButton',
      'setupButton',
      'settingsButton',
      'knowledgeBaseFilesSection',
      'knowledgeBaseFilesListContainer',
      'knowledgeBaseSettingsModal',
      'knowledgeBaseForm',
      'cancelKnowledgeBaseFormBtn',
      'deleteKnowledgeBaseBtn',
      'modelSelect'
    ]);

    // Clone so we can add aliases before freezing
    const base = { ...frozenBase };

    // Semantic aliases expected by existing KB component code
    base.container = ID_MAP.knowledgeTab;
    base.activeSection = ID_MAP.knowledgeStatus;
    base.inactiveSection = ID_MAP.knowledgeBaseInactive;
    base.statusBadge = ID_MAP.kbStatusBadge;
    return deepFreeze(base);
  })(),

  CHAT: pickKeys(ID_MAP, [
    'chatUIContainer',
    'chatMessages',
    'chatInput',
    'chatSendBtn',
    'chatTitle',
    'newConversationBtn',
    'conversationsList'
  ]),

  FILE_UPLOAD: pickKeys(ID_MAP, [
    'fileInput',
    'uploadFileBtn',
    'dragDropZone',
    'filesUploadProgress',
    'fileProgressBar',
    'uploadStatus',
    'filesList',
    'indexKbCheckbox'
  ])
});

// Legacy helper kept for tree-shaking compatibility (no-op cleanup)
export function createSelectorConstants () {
  return {
    SELECTORS,
    ELEMENT_SELECTORS,
    getSel,
    pickKeys,
    cleanup () {}
  };
}

```javascript
/**
 * modalConstants.js
 * Centralized modal mapping contract for the application.
 * 
 * This file defines the single source of truth for all modal logical keys and their corresponding DOM element IDs.
 * 
 * When adding or modifying a modal, update this mapping and ensure the HTML template matches.
 * 
 * Usage:
 *   import { MODAL_MAPPINGS } from './modalConstants.js';
 *   // or via DependencySystem: DependencySystem.modules.get('modalMapping')
 */

export const MODAL_MAPPINGS = {
  project        : 'projectModal',
  login          : 'loginModal',
  delete         : 'deleteConfirmModal',
  confirm        : 'confirmActionModal',
  error          : 'errorModal',            // ← NUEVO
  knowledge      : 'knowledgeBaseSettingsModal',
  knowledgeResult: 'knowledgeResultModal',
  instructions   : 'instructionsModal',
  contentView    : 'contentViewModal'
};

export default MODAL_MAPPINGS;

```
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
*   // or via DI container registration name `modalMapping` (retrieved during bootstrap only).
 */

export function createModalConstants() {
  const MODAL_MAPPINGS = {           // moved inside: no top-level state
    project: 'projectModal',
    login: 'loginModal',
    // Alias "register" maps to the same combined login/register dialog
    register: 'loginModal',
    delete: 'deleteConfirmModal',
    confirm: 'confirmActionModal',
    error: 'errorModal',
    knowledge: 'knowledgeBaseSettingsModal',
    knowledgeResult: 'knowledgeResultModal',
    instructions: 'instructionsModal',
    contentView: 'contentViewModal',
    tokenStats: 'tokenStatsModal'
  };
  return { MODAL_MAPPINGS, cleanup() {} };
}

export default createModalConstants;
export const MODAL_MAPPINGS = createModalConstants().MODAL_MAPPINGS; // compat

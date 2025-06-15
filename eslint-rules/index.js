/**
 * Custom ESLint Rules for Azure ChatApp
 * Provides project-specific rules for enforcing architecture patterns
 */

const noLegacyEventbus = require('./no-legacy-eventbus');
const noUpwardImport = require('./no-upward-import');
const noGlobalDSInUtils = require('./no-global-ds-in-utils');
const requireCleanupExport = require('./require-cleanup-export');

module.exports = {
    rules: {
        'no-legacy-eventbus': noLegacyEventbus,
        'no-upward-import': noUpwardImport,
        'no-global-ds-in-utils': noGlobalDSInUtils,
        'require-cleanup-export': requireCleanupExport
    }
};
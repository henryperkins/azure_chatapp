/**
 * ESLint Rule: no-upward-import
 * --------------------------------
 * Prevents lower-level modules (utils/services) from importing higher-level layers.
 * Enforces dependency hierarchy: utils -> services -> feature modules
 */
const path = require('path');

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Enforce dependency hierarchy: utils -> services -> feature modules',
            recommended: true
        },
        schema: [],
        messages: {
            upwardImport: '{{fileLayer}} layer must not import from {{importLayer}} layer.'
        }
    },
    create(context) {
        const filename = context.getFilename().replace(/\\/g, '/');
        function getLayer(filePath) {
            if (filePath.includes('/static/js/utils/')) return 'utils';
            if (filePath.includes('/static/services/')) return 'services';
            if (filePath.includes('/static/js/') &&
                !filePath.includes('/static/js/utils/') &&
                !filePath.includes('/static/js/initialization/')) return 'feature';
            return null;
        }
        const fileLayer = getLayer(filename);
        if (!fileLayer) {
            return {};
        }
        return {
            ImportDeclaration(node) {
                const importSource = node.source.value;
                if (typeof importSource !== 'string' || !importSource.startsWith('.')) return;
                const importPath = path.resolve(path.dirname(filename), importSource);
                const normalized = importPath.replace(/\\/g, '/');
                const importLayer = getLayer(normalized);
                if (!importLayer) return;
                if ((fileLayer === 'utils' && importLayer !== 'utils') ||
                    (fileLayer === 'services' && importLayer === 'feature')) {
                    context.report({
                        node,
                        messageId: 'upwardImport',
                        data: { fileLayer, importLayer }
                    });
                }
            }
        };
    }
};
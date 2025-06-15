/**
 * ESLint Rule: require-cleanup-export
 * ----------------------------------
 * Enforces presence of a cleanup() export for uniform teardown contract in utils modules.
 */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Require presence of cleanup() method in utils modules',
            recommended: true
        },
        schema: [],
        messages: {
            missingCleanup: 'Module must expose cleanup() method for teardown.'
        }
    },
    create(context) {
        const filename = context.getFilename().replace(/\\/g, '/');
        if (!filename.includes('/static/js/utils/')) return {};
        let hasCleanup = false;
        return {
            Property(node) {
                if (node.key && ((node.key.name === 'cleanup') || (node.key.value === 'cleanup'))) {
                    hasCleanup = true;
                }
            },
            'Program:exit'(node) {
                if (!hasCleanup) {
                    context.report({ node, messageId: 'missingCleanup' });
                }
            }
        };
    }
};
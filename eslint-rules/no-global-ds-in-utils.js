/**
 * ESLint Rule: no-global-ds-in-utils
 * ----------------------------------
 * Disallows use of globalThis.DependencySystem in utils modules to enforce DI strictness.
 */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow globalThis.DependencySystem usage in utils modules',
            recommended: true
        },
        schema: [],
        messages: {
            noGlobalDS: 'Use injected DependencySystem instead of globalThis.DependencySystem'
        }
    },
    create(context) {
        const filename = context.getFilename().replace(/\\/g, '/');
        if (!filename.includes('/static/js/utils/')) return {};
        return {
            MemberExpression(node) {
                if (node.object.type === 'Identifier' &&
                    node.object.name === 'globalThis' &&
                    node.property && node.property.name === 'DependencySystem') {
                    context.report({ node, messageId: 'noGlobalDS' });
                }
            }
        };
    }
};
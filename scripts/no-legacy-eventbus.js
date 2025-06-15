/**
 * ESLint Rule: no-legacy-eventbus
 * --------------------------------
 * Prevents the use of legacy AppBus/AuthBus in favor of the unified eventService.
 *
 * Installation:
 * 1. Add this file to .eslintrc.js or your ESLint config
 * 2. Enable the rule: "no-legacy-eventbus": "error"
 */

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow legacy AppBus/AuthBus usage in favor of eventService',
            recommended: true,
            url: 'https://your-docs/no-legacy-eventbus'
        },
        fixable: 'code',
        schema: [],
        messages: {
            legacyBusImport: 'Use eventService instead of {{busName}}. The legacy event buses are deprecated.',
            legacyBusAccess: 'Direct access to {{busName}} is deprecated. Use eventService instead.',
            legacyBusMethod: 'Use eventService.{{suggestedMethod}}() instead of {{busName}}.{{method}}().',
            authBusProperty: 'Access to auth.AuthBus is deprecated. Use eventService instead.',
            fallbackPattern: 'Avoid fallback patterns with legacy buses. Use eventService directly.',
            documentFallback: 'Avoid document-level event listeners for {{eventName}}. Use eventService instead.'
        }
    },

    create(context) {
        const sourceCode = context.getSourceCode();

        // Map legacy methods to eventService equivalents
        const methodMap = {
            'addEventListener': 'on',
            'removeEventListener': 'off',
            'dispatchEvent': 'emit'
        };

        // Track variable declarations to catch renamed buses
        const variableMap = new Map();

        return {
            // Check DependencySystem.modules.get() calls
            CallExpression(node) {
                // Pattern: DependencySystem.modules.get('AppBus') or getDep('AuthBus')
                if (node.callee.type === 'MemberExpression') {
                    const isModulesGet =
                        node.callee.object?.type === 'MemberExpression' &&
                        node.callee.object.property?.name === 'modules' &&
                        node.callee.property?.name === 'get';

                    if (isModulesGet && node.arguments.length > 0) {
                        const arg = node.arguments[0];
                        if (arg.type === 'Literal' &&
                            (arg.value === 'AppBus' || arg.value === 'AuthBus')) {

                            context.report({
                                node: arg,
                                messageId: 'legacyBusImport',
                                data: { busName: arg.value },
                                fix(fixer) {
                                    return fixer.replaceText(arg, "'eventService'");
                                }
                            });
                        }
                    }
                }

                // Pattern: getDep('AppBus') or getDep('AuthBus')
                if (node.callee.type === 'Identifier' && node.callee.name === 'getDep' && node.arguments.length > 0) {
                    const arg = node.arguments[0];
                    if (arg.type === 'Literal' &&
                        (arg.value === 'AppBus' || arg.value === 'AuthBus')) {

                        context.report({
                            node: arg,
                            messageId: 'legacyBusImport',
                            data: { busName: arg.value },
                            fix(fixer) {
                                return fixer.replaceText(arg, "'eventService'");
                            }
                        });
                    }
                }

                // Pattern: getAppBus() or getAuthBus()
                if (node.callee.type === 'Identifier' && 
                    (node.callee.name === 'getAppBus' || node.callee.name === 'getAuthBus') &&
                    node.arguments.length === 0) {
                    
                    context.report({
                        node,
                        messageId: 'legacyBusImport',
                        data: { busName: node.callee.name },
                        fix(fixer) {
                            return fixer.replaceText(node, 'eventService');
                        }
                    });
                }

                // Pattern: eventHandlers.trackListener(appBus, ...)
                if (node.callee.type === 'MemberExpression' &&
                    node.callee.property?.name === 'trackListener' &&
                    node.arguments.length >= 3) {

                    const busArg = node.arguments[0];
                    if (busArg.type === 'Identifier') {
                        const busName = variableMap.get(busArg.name);
                        if (busName === 'AppBus' || busName === 'AuthBus') {
                            const eventName = node.arguments[1];
                            const handler = node.arguments[2];
                            const options = node.arguments[3];

                            context.report({
                                node,
                                messageId: 'legacyBusAccess',
                                data: { busName },
                                fix(fixer) {
                                    const newCall = `eventService.on(${sourceCode.getText(eventName)}, ${sourceCode.getText(handler)}${options ? ', ' + sourceCode.getText(options) : ''})`;
                                    return fixer.replaceText(node, newCall);
                                }
                            });
                        }
                    }
                }
            },

            // Check variable declarations that might store buses
            VariableDeclarator(node) {
                if (node.init?.type === 'CallExpression') {
                    const callee = node.init.callee;

                    // Track getDep calls
                    if (callee.type === 'Identifier' && callee.name === 'getDep' &&
                        node.init.arguments.length > 0 &&
                        node.init.arguments[0].type === 'Literal') {

                        const depName = node.init.arguments[0].value;
                        if (depName === 'AppBus' || depName === 'AuthBus') {
                            variableMap.set(node.id.name, depName);
                        }
                    }

                    // Track DependencySystem.modules.get calls
                    if (callee.type === 'MemberExpression' &&
                        callee.object?.type === 'MemberExpression' &&
                        callee.object.property?.name === 'modules' &&
                        callee.property?.name === 'get' &&
                        node.init.arguments.length > 0 &&
                        node.init.arguments[0].type === 'Literal') {

                        const depName = node.init.arguments[0].value;
                        if (depName === 'AppBus' || depName === 'AuthBus') {
                            variableMap.set(node.id.name, depName);
                        }
                    }
                }

                // Track LogicalExpression fallback patterns
                if (node.init?.type === 'LogicalExpression' && node.init.operator === '||') {
                    // Pattern like: const authBus = getDep('AuthBus') || authModule?.AuthBus || null
                    let current = node.init;
                    while (current.type === 'LogicalExpression' && current.operator === '||') {
                        if (current.left.type === 'CallExpression' &&
                            current.left.callee.type === 'Identifier' &&
                            current.left.callee.name === 'getDep' &&
                            current.left.arguments[0]?.type === 'Literal') {
                            
                            const depName = current.left.arguments[0].value;
                            if (depName === 'AppBus' || depName === 'AuthBus') {
                                variableMap.set(node.id.name, depName);
                                
                                context.report({
                                    node: node.init,
                                    messageId: 'fallbackPattern'
                                });
                            }
                        }
                        current = current.right;
                    }
                }
            },

            // Check member expressions like auth.AuthBus
            MemberExpression(node) {
                // Check auth.AuthBus, authModule.AuthBus patterns
                if (node.property?.name === 'AuthBus' &&
                    node.object?.type === 'Identifier') {

                    context.report({
                        node,
                        messageId: 'authBusProperty',
                        fix(fixer) {
                            // Can't auto-fix this as it requires dependency injection changes
                            return null;
                        }
                    });
                }

                // Check for bus.addEventListener, etc.
                if (node.object?.type === 'Identifier' &&
                    methodMap[node.property?.name]) {

                    const busName = variableMap.get(node.object.name);
                    if (busName === 'AppBus' || busName === 'AuthBus') {
                        context.report({
                            node,
                            messageId: 'legacyBusMethod',
                            data: {
                                busName,
                                method: node.property.name,
                                suggestedMethod: methodMap[node.property.name]
                            }
                        });
                    }
                }

                // Check for direct AppBus/AuthBus method calls (even if not tracked in variables)
                if (node.object?.type === 'Identifier' &&
                    (node.object.name === 'AppBus' || node.object.name === 'AuthBus') &&
                    methodMap[node.property?.name]) {
                    
                    context.report({
                        node,
                        messageId: 'legacyBusMethod',
                        data: {
                            busName: node.object.name,
                            method: node.property.name,
                            suggestedMethod: methodMap[node.property.name]
                        }
                    });
                }
            },

            // Check for fallback patterns
            LogicalExpression(node) {
                if (node.operator === '||') {
                    // Pattern: eventService || authBus
                    const leftIsEventService =
                        node.left.type === 'Identifier' &&
                        node.left.name === 'eventService';

                    const rightIsLegacyBus =
                        node.right.type === 'Identifier' &&
                        (variableMap.get(node.right.name) === 'AppBus' ||
                            variableMap.get(node.right.name) === 'AuthBus');

                    if (leftIsEventService && rightIsLegacyBus) {
                        context.report({
                            node: node.right,
                            messageId: 'fallbackPattern'
                        });
                    }
                }
            },

            // Check for document-level event listeners and other patterns (moved to end)
            'CallExpression:exit'(node) {
                if (node.callee.type === 'Identifier' &&
                    node.callee.name === 'addListener' &&
                    node.arguments.length >= 2) {

                    // Check if first argument is document
                    const target = node.arguments[0];
                    const eventName = node.arguments[1];

                    if (target.type === 'CallExpression' &&
                        target.callee.type === 'MemberExpression' &&
                        target.callee.property?.name === 'getDocument' &&
                        eventName.type === 'Literal') {

                        const authEvents = ['authStateChanged', 'authReady'];
                        const appEvents = ['currentProjectChanged', 'projectSelected'];

                        if (authEvents.includes(eventName.value) ||
                            appEvents.includes(eventName.value)) {

                            context.report({
                                node,
                                messageId: 'documentFallback',
                                data: { eventName: eventName.value }
                            });
                        }
                    }
                }
            },

            // Check for variable names that suggest legacy bus usage
            Identifier(node) {
                // Only check identifiers that are not property keys or function names
                if (node.parent.type !== 'Property' && 
                    node.parent.type !== 'FunctionDeclaration' &&
                    node.parent.type !== 'VariableDeclarator' &&
                    (node.name === 'appBus' || node.name === 'authBus')) {
                    
                    // Skip if it's already tracked in our variable map
                    if (!variableMap.has(node.name)) {
                        context.report({
                            node,
                            messageId: 'legacyBusAccess',
                            data: { busName: node.name }
                        });
                    }
                }
            }
        };
    }
};

// Additional ESLint configuration to add to .eslintrc.js:
/*
module.exports = {
    // ... existing config ...

    rules: {
        // ... existing rules ...

        // Prevent legacy EventBus usage
        'no-legacy-eventbus': 'error',

        // Optional: warn on specific global access patterns
        'no-restricted-globals': [
            'error',
            {
                name: 'AppBus',
                message: 'Use DependencySystem.modules.get("eventService") instead of global AppBus'
            },
            {
                name: 'AuthBus',
                message: 'Use DependencySystem.modules.get("eventService") instead of global AuthBus'
            }
        ],

        // Optional: warn on specific property access
        'no-restricted-properties': [
            'error',
            {
                object: 'auth',
                property: 'AuthBus',
                message: 'Use eventService instead of auth.AuthBus'
            },
            {
                object: 'authModule',
                property: 'AuthBus',
                message: 'Use eventService instead of authModule.AuthBus'
            },
            {
                object: 'window',
                property: 'AppBus',
                message: 'Use eventService instead of window.AppBus'
            },
            {
                object: 'window',
                property: 'AuthBus',
                message: 'Use eventService instead of window.AuthBus'
            },
            {
                object: 'globalThis',
                property: 'AppBus',
                message: 'Use eventService instead of globalThis.AppBus'
            },
            {
                object: 'globalThis',
                property: 'AuthBus',
                message: 'Use eventService instead of globalThis.AuthBus'
            }
        ]
    }
};
*/

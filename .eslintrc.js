module.exports = {
    env: {
        browser: true,    // Allows browser globals like `window`, `document`
        es2021: true,     // Enables ES2021 syntax
        node: true,       // Allows Node.js globals (for build scripts, CI, etc.)
        worker: true,     // Allows worker globals like `self`
    },
    parserOptions: {
        ecmaVersion: 2021,    // Match the env setting
        sourceType: 'module', // Enable ES module syntax
    },
    globals: {
        Sentry: 'readonly'
    },
    plugins: [
        'import',            // For import/no-unresolved and other import rules
    ],
    ignorePatterns: ['static/js/vendor/'],
    extends: [
        'eslint:recommended',
        'plugin:import/recommended',
    ],
    rules: {
        // --- Guardrail Enforcement Rules ---

        // Factory Function Export Pattern (Guardrail #1)
        'no-restricted-syntax': [
            'error',
            {
                selector: "ExportDefaultDeclaration",
                message: 'Use named factory function exports (createXyz) instead of default exports',
            },
            {
                selector: "MemberExpression[object.name='window']",
                message: 'Access shared modules via dependency injection instead of window.*',
            },
        ],

        // Strict Dependency Injection (Guardrail #2)
        'no-restricted-globals': [
            'error',
            {
                name: 'window',
                message: 'Do not access window directly; use injected dependencies',
            },
            {
                name: 'document',
                message: 'Do not access document directly; use injected domAPI',
            },
            {
                name: 'console',
                message: 'Do not use console directly; use notify or createDebugTools',
            },
            {
                name: 'setTimeout',
                message: 'Avoid setTimeout for timing/waiting; use async/await or provide justification',
            },
            {
                name: 'setInterval',
                message: 'Avoid setInterval for polling; use event-driven logic or WebSockets',
            },
        ],

        // Ban specific `window` properties explicitly for clarity
        'no-restricted-properties': [
            'error',
            { object: 'window', property: 'app', message: 'Use dependency injection instead of window.app' },
            { object: 'window', property: 'projectManager', message: 'Use dependency injection instead of window.projectManager' },
            { object: 'window', property: 'eventHandlers', message: 'Use dependency injection instead of window.eventHandlers' },
            { object: 'window', property: 'auth', message: 'Use dependency injection instead of window.auth' },
            { object: 'window', property: 'chatManager', message: 'Use dependency injection instead of window.chatManager' },
            { object: 'window', property: 'modalManager', message: 'Use dependency injection instead of window.modalManager' },
            { object: 'window', property: 'location', message: 'Use navigationService instead of window.location' },
            { object: 'window', property: 'fetch', message: 'Use apiClient instead of window.fetch' },
        ],

        // --- Standard Code Quality Rules ---

        'no-var': 'error',
        'prefer-const': ['error', {
            destructuring: 'any',
            ignoreReadBeforeAssign: false,
        }],
        'no-unused-vars': ['error', {
            vars: 'all',
            args: 'after-used',
            ignoreRestSiblings: true,
            varsIgnorePattern: '^_',    // Allow unused vars prefixed with _
            argsIgnorePattern: '^_',    // Allow unused args prefixed with _
        }],
        'eqeqeq': ['error', 'always', { null: 'ignore' }],
        'no-console': ['error', { allow: ['warn', 'error'] }],

        // Import plugin rule to catch missing or misspelled imports
        'import/no-unresolved': ['error', { commonjs: true, amd: true }],
    },

    overrides: [
        {
            files: ['**/test/**/*.js', '**/*.test.js'],
            env: {
                jest: true,   // or mocha: true, depending on your test framework
            },
            rules: {
                // Relax rules for test files if necessary
                'no-console': 'off',
                'no-restricted-globals': 'off',
            },
        },
    ],
};

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
        // --- Refactoring Enforcement Rules ---

        // Ban any direct `window.*` access; use `DependencySystem.get(...)` or injection
        'no-restricted-syntax': [
            'error',
            {
                selector: "MemberExpression[object.name='window']",
                message: 'Access shared modules via DependencySystem.get(...) or dependency injection instead of window.*',
            },
        ],

        // Ban specific `window` properties explicitly for clarity
        'no-restricted-properties': [
            'error',
            { object: 'window', property: 'app', message: 'Use DependencySystem.get("app") or dependency injection.' },
            { object: 'window', property: 'projectManager', message: 'Use DependencySystem.get("projectManager") or dependency injection.' },
            { object: 'window', property: 'eventHandlers', message: 'Use DependencySystem.get("eventHandlers") or dependency injection.' },
            { object: 'window', property: 'auth', message: 'Use DependencySystem.get("auth") or dependency injection.' },
            { object: 'window', property: 'chatManager', message: 'Use DependencySystem.get("chatManager") or dependency injection.' },
            { object: 'window', property: 'modalManager', message: 'Use DependencySystem.get("modalManager") or dependency injection.' },
        ],

        // Ban setTimeout/setInterval to avoid timing hacks and polling loops
        'no-restricted-globals': [
            'error',
            {
                name: 'setTimeout',
                message: 'Avoid setTimeout for timing/waiting; use orchestrator (app.js), async/await, or provide justification via eslint-disable comment.',
            },
            {
                name: 'setInterval',
                message: 'Avoid setInterval for polling; use event-driven logic or WebSockets.',
            },
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
        'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug', 'table'] }],

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
            },
        },
    ],
};

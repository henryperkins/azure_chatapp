#!/usr/bin/env node

/**
 * EventBus Migration Verification Script
 * --------------------------------------
 * Verifies that no legacy AppBus/AuthBus references remain in the codebase.
 * Can be used as a pre-commit hook or CI check.
 *
 * Usage: node verify-eventbus-migration.js
 * Returns: 0 if clean, 1 if legacy references found
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Configuration
const config = {
    baseDir: path.join(__dirname, '..', 'static'),

    // Files that are allowed to have legacy references
    allowedFiles: [
        'bootstrapCore.js',     // Contains the deprecation proxies
        'eventService.js',      // Contains getAppBus/getAuthBus shims
        'eventService.test.js', // Tests may reference legacy names
        'auth-storage.test.js', // Test file with mocks
        'migrate-eventbus.js',  // Migration script itself
        'verify-eventbus-migration.js', // This verification script
        'no-legacy-eventbus.js', // ESLint rule definition
    ],

    // Directories to skip
    skipDirs: [
        'node_modules',
        '.git',
        'dist',
        'build',
        '__tests__',
        'test'
    ],

    // Legacy patterns to detect
    legacyPatterns: [
        {
            name: 'DependencySystem.modules.get AppBus',
            pattern: /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'DependencySystem.modules.get AuthBus',
            pattern: /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'Direct AppBus reference',
            pattern: /\bAppBus\s*\.\s*(addEventListener|dispatchEvent|removeEventListener)/,
            severity: 'error'
        },
        {
            name: 'Direct AuthBus reference',
            pattern: /\bAuthBus\s*\.\s*(addEventListener|dispatchEvent|removeEventListener)/,
            severity: 'error'
        },
        {
            name: 'Optional chaining DS modules get AppBus',
            pattern: /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AppBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'Optional chaining DS modules get AuthBus',
            pattern: /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AuthBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'Optional chaining ds modules get AppBus',
            pattern: /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'Optional chaining ds modules get AuthBus',
            pattern: /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'auth.AuthBus reference',
            pattern: /auth\s*\?\.\s*AuthBus/,
            severity: 'error'
        },
        {
            name: 'authModule.AuthBus reference',
            pattern: /authModule\s*\?\.\s*AuthBus/,
            severity: 'error'
        },
        {
            name: 'getDep AppBus',
            pattern: /getDep\s*\(\s*['"`]AppBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'getDep AuthBus',
            pattern: /getDep\s*\(\s*['"`]AuthBus['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'Variable named appBus',
            pattern: /(?:const|let|var)\s+appBus\s*=/,
            severity: 'warning'
        },
        {
            name: 'Variable named authBus',
            pattern: /(?:const|let|var)\s+authBus\s*=/,
            severity: 'warning'
        },
        {
            name: 'Legacy bus in eventHandlers.trackListener',
            pattern: /eventHandlers\s*\.\s*trackListener\s*\(\s*(?:appBus|authBus|auth\.AuthBus)/,
            severity: 'error'
        },
        {
            name: 'AuthBus fallback pattern',
            pattern: /getDep\s*\(\s*['"`]AuthBus['"`]\s*\)\s*\|\|\s*authModule\s*\?\.\s*AuthBus/,
            severity: 'error'
        },
        {
            name: 'AppBus fallback pattern',
            pattern: /getDep\s*\(\s*['"`]AppBus['"`]\s*\)\s*\|\|\s*\w+\s*\?\.\s*AppBus/,
            severity: 'error'
        },
        {
            name: 'getAppBus method call',
            pattern: /getAppBus\s*\(\s*\)/,
            severity: 'warning'
        },
        {
            name: 'getAuthBus method call',
            pattern: /getAuthBus\s*\(\s*\)/,
            severity: 'warning'
        },
        {
            name: 'AppBus/AuthBus in dependency injection parameters',
            pattern: /(?:authBus|appBus):\s*DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`](?:AuthBus|AppBus)['"`]\s*\)/,
            severity: 'error'
        },
        {
            name: 'AppBus/AuthBus variable method calls',
            pattern: /\b(?:appBus|authBus)\s*\.\s*(?:addEventListener|removeEventListener|dispatchEvent)/,
            severity: 'error'
        },
        {
            name: 'Document event listener fallback',
            pattern: /addListener\s*\(\s*(?:this\.)?domAPI\.getDocument\(\)\s*,\s*['"`](?:authStateChanged|currentProjectChanged)['"`]/,
            severity: 'warning'
        }
    ]
};

// Results tracking
const results = {
    filesScanned: 0,
    violations: [],
    errors: [],
    warnings: []
};

// Helper to check if path should be skipped
function shouldSkip(filePath) {
    const fileName = path.basename(filePath);
    if (config.allowedFiles.includes(fileName)) {
        return true;
    }

    return config.skipDirs.some(dir => filePath.includes(path.sep + dir + path.sep));
}

// Walk directory recursively
async function* walkDirectory(dir) {
    try {
        const files = await readdir(dir);

        for (const file of files) {
            const filePath = path.join(dir, file);

            if (shouldSkip(filePath)) continue;

            const fileStat = await stat(filePath);

            if (fileStat.isDirectory()) {
                yield* walkDirectory(filePath);
            } else if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
                yield filePath;
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}: ${error.message}`);
    }
}

// Check a single file for violations
async function checkFile(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const fileViolations = [];

        for (const check of config.legacyPatterns) {
            const matches = [...content.matchAll(new RegExp(check.pattern, 'g'))];

            for (const match of matches) {
                // Find line number
                let charCount = 0;
                let lineNumber = 1;
                for (let i = 0; i < lines.length; i++) {
                    if (charCount + lines[i].length >= match.index) {
                        lineNumber = i + 1;
                        break;
                    }
                    charCount += lines[i].length + 1; // +1 for newline
                }

                const violation = {
                    file: filePath,
                    line: lineNumber,
                    column: match.index - charCount + 1,
                    rule: check.name,
                    severity: check.severity,
                    match: match[0].trim()
                };

                fileViolations.push(violation);
                results.violations.push(violation);

                if (check.severity === 'error') {
                    results.errors.push(violation);
                } else {
                    results.warnings.push(violation);
                }
            }
        }

        return fileViolations;

    } catch (error) {
        console.error(`Error reading file ${filePath}: ${error.message}`);
        return [];
    }
}

// Format violation for display
function formatViolation(violation) {
    const relativePath = path.relative(process.cwd(), violation.file);
    const icon = violation.severity === 'error' ? '❌' : '⚠️ ';
    return `${icon} ${relativePath}:${violation.line}:${violation.column} - ${violation.rule}\n     ${violation.match}`;
}

// Main verification function
async function verify() {
    console.log('🔍 Verifying EventBus migration...\n');

    const startTime = Date.now();

    try {
        // Scan all JavaScript files
        for await (const filePath of walkDirectory(config.baseDir)) {
            results.filesScanned++;
            await checkFile(filePath);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Print results
        console.log(`📊 Verification Summary:`);
        console.log(`   Files scanned: ${results.filesScanned}`);
        console.log(`   Time: ${duration}s`);
        console.log(`   Errors: ${results.errors.length}`);
        console.log(`   Warnings: ${results.warnings.length}\n`);

        if (results.violations.length === 0) {
            console.log('✅ No legacy EventBus references found!');
            console.log('🎉 Migration verification passed!\n');
            return 0;
        }

        // Group violations by file
        const violationsByFile = {};
        for (const violation of results.violations) {
            if (!violationsByFile[violation.file]) {
                violationsByFile[violation.file] = [];
            }
            violationsByFile[violation.file].push(violation);
        }

        // Display violations grouped by file
        console.log('📋 Legacy references found:\n');
        for (const [file, violations] of Object.entries(violationsByFile)) {
            const relativePath = path.relative(process.cwd(), file);
            console.log(`${relativePath}:`);
            for (const violation of violations) {
                const icon = violation.severity === 'error' ? '  ❌' : '  ⚠️';
                console.log(`${icon} Line ${violation.line}: ${violation.rule}`);
                console.log(`     ${violation.match}\n`);
            }
        }

        // Summary message
        if (results.errors.length > 0) {
            console.log(`\n❌ Verification failed with ${results.errors.length} errors.`);
            console.log('   Please run the migration script: node migrate-eventbus.js\n');
            return 1;
        } else {
            console.log(`\n⚠️  Verification completed with ${results.warnings.length} warnings.`);
            console.log('   Consider addressing these warnings for complete migration.\n');
            return 0;
        }

    } catch (error) {
        console.error('Fatal error during verification:', error);
        return 1;
    }
}

// Export for use as module
module.exports = { verify };

// Run if called directly
if (require.main === module) {
    verify().then(exitCode => {
        process.exit(exitCode);
    }).catch(error => {
        console.error('Verification failed:', error);
        process.exit(1);
    });
}

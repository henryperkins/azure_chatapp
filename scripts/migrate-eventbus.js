#!/usr/bin/env node
/* eslint-env node */

/**
 * EventBus Migration Script
 * -------------------------
 * Migrates all legacy AppBus/AuthBus references to use the unified eventService.
 *
 * Usage: node migrate-eventbus.js [--dry-run] [--verbose]
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
    baseDir: path.join(__dirname, '..', 'static'),
    patterns: {
        // Legacy bus references to find
        legacyBusReferences: [
            // Direct DependencySystem lookups
            /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,

            // Direct property access
            /auth\s*\?\.\s*AuthBus/g,
            /authModule\s*\?\.\s*AuthBus/g,

            // Variable declarations with getDep
            /const\s+(\w+)\s*=\s*getDep\s*\(\s*["']AppBus["']\s*\)/g,
            /const\s+(\w+)\s*=\s*getDep\s*\(\s*["']AuthBus["']\s*\)/g,
            /let\s+(\w+)\s*=\s*getDep\s*\(\s*["']AppBus["']\s*\)/g,
            /let\s+(\w+)\s*=\s*getDep\s*\(\s*["']AuthBus["']\s*\)/g,

            // Fallback patterns with getDep
            /getDep\s*\(\s*["']AuthBus["']\s*\)\s*\|\|\s*authModule\s*\?\.\s*AuthBus/g,
            /getDep\s*\(\s*["']AppBus["']\s*\)\s*\|\|\s*\w+\s*\?\.\s*AppBus/g,

            // Legacy event dispatch
            /AuthBus\s*\.\s*dispatchEvent/g,
            /AppBus\s*\.\s*dispatchEvent/g,
            /\bappBus\s*\.\s*dispatchEvent/g,
            /\bauthBus\s*\.\s*dispatchEvent/g,

            // Legacy event listeners
            /AuthBus\s*\.\s*addEventListener/g,
            /AppBus\s*\.\s*addEventListener/g,
            /\bappBus\s*\.\s*addEventListener/g,
            /\bauthBus\s*\.\s*addEventListener/g,
            /AuthBus\s*\.\s*removeEventListener/g,
            /AppBus\s*\.\s*removeEventListener/g,
            /\bappBus\s*\.\s*removeEventListener/g,
            /\bauthBus\s*\.\s*removeEventListener/g,

            // eventHandlers.trackListener with legacy buses
            /eventHandlers\s*\.\s*trackListener\s*\(\s*auth\.AuthBus/g,
            /eventHandlers\s*\.\s*trackListener\s*\(\s*appBus/g,
            /eventHandlers\s*\.\s*trackListener\s*\(\s*authBus/g,
            /eventHandlers\s*\.\s*trackListener\s*\(\s*\w+\s*\.\s*AuthBus/g,

            // Method calls on legacy buses
            /getAppBus\s*\(\s*\)/g,
            /getAuthBus\s*\(\s*\)/g,

            // Legacy buses in dependency injection parameters
            /authBus:\s*DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            /appBus:\s*DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
        ],

        // Patterns that indicate proper eventService usage (to skip)
        eventServiceUsage: [
            /eventService\s*\.\s*emit/,
            /eventService\s*\.\s*on/,
            /eventService\s*\.\s*off/,
            /eventService\s*\.\s*once/,
            /_eventService/,
        ]
    },

    // Files to exclude from migration
    excludeFiles: [
        'bootstrapCore.js', // Contains the proxy setup
        'eventService.js',  // The service itself
        'test',            // Test files
        '__tests__',       // Test directories
        'node_modules',    // Dependencies
        '.git'            // Version control
    ],

    // Specific migration rules
    migrations: [
        {
            name: 'DependencySystem AppBus lookup',
            find: /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            replace: "DependencySystem.modules.get('eventService')"
        },
        {
            name: 'DependencySystem AuthBus lookup',
            find: /DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            replace: "DependencySystem.modules.get('eventService')"
        },
        {
            name: 'Optional chaining AppBus lookup (DS)',
            find: /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            replace: "DS?.modules?.get?.('eventService')"
        },
        {
            name: 'Optional chaining AuthBus lookup (DS)',
            find: /DS\s*\?\.\s*modules\s*\?\.\s*get\s*\?\.\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            replace: "DS?.modules?.get?.('eventService')"
        },
        {
            name: 'Optional chaining AppBus lookup (ds)',
            find: /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            replace: "ds?.modules?.get('eventService')"
        },
        {
            name: 'Optional chaining AuthBus lookup (ds)',
            find: /ds\s*\?\.\s*modules\s*\?\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            replace: "ds?.modules?.get('eventService')"
        },
        {
            name: 'getDep AppBus variable declaration',
            find: /const\s+(\w+)\s*=\s*getDep\s*\(\s*["']AppBus["']\s*\)/g,
            replace: 'const eventService = getDep("eventService")'
        },
        {
            name: 'getDep AuthBus variable declaration',
            find: /const\s+(\w+)\s*=\s*getDep\s*\(\s*["']AuthBus["']\s*\)/g,
            replace: 'const eventService = getDep("eventService")'
        },
        {
            name: 'let AppBus variable declaration',
            find: /let\s+(\w+)\s*=\s*getDep\s*\(\s*["']AppBus["']\s*\)/g,
            replace: 'let eventService = getDep("eventService")'
        },
        {
            name: 'let AuthBus variable declaration',
            find: /let\s+(\w+)\s*=\s*getDep\s*\(\s*["']AuthBus["']\s*\)/g,
            replace: 'let eventService = getDep("eventService")'
        },
        {
            name: 'AuthBus fallback pattern',
            find: /getDep\s*\(\s*["']AuthBus["']\s*\)\s*\|\|\s*authModule\s*\?\.\s*AuthBus\s*\|\|\s*null/g,
            replace: 'getDep("eventService") || null'
        },
        {
            name: 'AppBus fallback pattern',
            find: /getDep\s*\(\s*["']AppBus["']\s*\)\s*\|\|\s*(\w+)\s*\?\.\s*AppBus/g,
            replace: 'getDep("eventService")'
        },
        {
            name: 'appBus.dispatchEvent',
            find: /appBus\s*\.\s*dispatchEvent\s*\(\s*new\s+CustomEvent\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*{\s*detail:\s*([^}]+)\s*}\s*\)\s*\)/g,
            replace: (match, quote, eventName, detail) => {
                return `eventService.emit('${eventName}', ${detail})`;
            }
        },
        {
            name: 'authBus.dispatchEvent',
            find: /authBus\s*\.\s*dispatchEvent\s*\(\s*new\s+CustomEvent\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*{\s*detail:\s*([^}]+)\s*}\s*\)\s*\)/g,
            replace: (match, quote, eventName, detail) => {
                return `eventService.emit('${eventName}', ${detail})`;
            }
        },
        {
            name: 'appBus.addEventListener',
            find: /appBus\s*\.\s*addEventListener\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return options ? `eventService.on('${eventName}', ${handler}, ${options})` : `eventService.on('${eventName}', ${handler})`;
            }
        },
        {
            name: 'authBus.addEventListener',
            find: /authBus\s*\.\s*addEventListener\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return options ? `eventService.on('${eventName}', ${handler}, ${options})` : `eventService.on('${eventName}', ${handler})`;
            }
        },
        {
            name: 'auth.AuthBus.addEventListener',
            find: /auth\s*\?\.\s*AuthBus\s*\.\s*addEventListener\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return options ? `eventService.on('${eventName}', ${handler}, ${options})` : `eventService.on('${eventName}', ${handler})`;
            }
        },
        {
            name: 'eventHandlers.trackListener with appBus',
            find: /eventHandlers\s*\.\s*trackListener\s*\(\s*appBus\s*,\s*(['"`])([^'"`]+)\1\s*,\s*([^,]+),\s*([^)]+)\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return `eventService.on('${eventName}', ${handler}, ${options})`;
            }
        },
        {
            name: 'eventHandlers.trackListener with authBus',
            find: /eventHandlers\s*\.\s*trackListener\s*\(\s*authBus\s*,\s*(['"`])([^'"`]+)\1\s*,\s*([^,]+),\s*([^)]+)\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return `eventService.on('${eventName}', ${handler}, ${options})`;
            }
        },
        {
            name: 'eventHandlers.trackListener with auth.AuthBus',
            find: /eventHandlers\s*\.\s*trackListener\s*\(\s*auth\s*\.\s*AuthBus\s*,\s*(['"`])([^'"`]+)\1\s*,\s*([^,]+),\s*([^)]+)\)/g,
            replace: (match, quote, eventName, handler, options) => {
                return `eventService.on('${eventName}', ${handler}, ${options})`;
            }
        },
        {
            name: 'Dependency injection parameter AuthBus',
            find: /authBus:\s*DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AuthBus['"`]\s*\)/g,
            replace: 'eventService: DependencySystem.modules.get("eventService")'
        },
        {
            name: 'Dependency injection parameter AppBus',
            find: /appBus:\s*DependencySystem\s*\.\s*modules\s*\.\s*get\s*\(\s*['"`]AppBus['"`]\s*\)/g,
            replace: 'eventService: DependencySystem.modules.get("eventService")'
        },
        {
            name: 'getAppBus method call',
            find: /getAppBus\s*\(\s*\)/g,
            replace: 'eventService'
        },
        {
            name: 'getAuthBus method call',
            find: /getAuthBus\s*\(\s*\)/g,
            replace: 'eventService'
        }
    ]
};

// Command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

// Results tracking
const results = {
    filesScanned: 0,
    filesModified: 0,
    totalReplacements: 0,
    fileChanges: [],
    errors: []
};

// Helper functions
async function* walkDirectory(dir) {
    const files = await readdir(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const shouldExclude = config.excludeFiles.some(exclude =>
            filePath.includes(exclude)
        );

        if (shouldExclude) continue;

        const fileStat = await stat(filePath);

        if (fileStat.isDirectory()) {
            yield* walkDirectory(filePath);
        } else if (filePath.endsWith('.js')) {
            yield filePath;
        }
    }
}

function hasEventServiceAlready(content) {
    return config.patterns.eventServiceUsage.some(pattern =>
        pattern.test(content)
    );
}

function needsMigration(content) {
    return config.patterns.legacyBusReferences.some(pattern =>
        pattern.test(content)
    );
}

async function migrateFile(filePath) {
    try {
        const content = await readFile(filePath, 'utf8');

        // Skip if already uses eventService properly
        if (hasEventServiceAlready(content) && !needsMigration(content)) {
            if (verbose) {
                console.log(`✓ ${filePath} - already migrated`);
            }
            return;
        }

        // Skip if no legacy references found
        if (!needsMigration(content)) {
            return;
        }

        let modifiedContent = content;
        let replacementCount = 0;
        const replacements = [];

        // Apply each migration rule
        for (const migration of config.migrations) {
            const matches = [...modifiedContent.matchAll(migration.find)];
            if (matches.length > 0) {
                modifiedContent = modifiedContent.replace(migration.find, migration.replace);
                replacementCount += matches.length;
                replacements.push({
                    rule: migration.name,
                    count: matches.length
                });
            }
        }

        // Additional manual replacements for complex patterns
        // Replace fallback patterns like: eventService || authBus
        modifiedContent = modifiedContent.replace(
            /const\s+_eventService\s*=\s*eventService\s*\|\|\s*DS\?\.\s*modules\?\.\s*get\?\.\s*\(\s*['"`]eventService['"`]\s*\)\s*\|\|\s*null;/g,
            'const _eventService = eventService || DependencySystem?.modules?.get?.("eventService") || null;'
        );

        if (replacementCount > 0) {
            results.filesModified++;
            results.totalReplacements += replacementCount;
            results.fileChanges.push({
                file: filePath,
                replacements: replacements,
                count: replacementCount
            });

            if (!dryRun) {
                await writeFile(filePath, modifiedContent, 'utf8');
                console.log(`✅ ${filePath} - ${replacementCount} replacements`);
            } else {
                console.log(`🔍 ${filePath} - would make ${replacementCount} replacements`);
            }

            if (verbose) {
                replacements.forEach(r => {
                    console.log(`   - ${r.rule}: ${r.count} replacements`);
                });
            }
        }

    } catch (error) {
        results.errors.push({
            file: filePath,
            error: error.message
        });
        console.error(`❌ Error processing ${filePath}: ${error.message}`);
    }
}

// Main migration function
async function runMigration() {
    console.log('🚀 Starting EventBus migration...');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Base directory: ${config.baseDir}\n`);

    try {
        // Process all JavaScript files
        for await (const filePath of walkDirectory(config.baseDir)) {
            results.filesScanned++;
            await migrateFile(filePath);
        }

        // Print summary
        console.log('\n📊 Migration Summary:');
        console.log(`Files scanned: ${results.filesScanned}`);
        console.log(`Files modified: ${results.filesModified}`);
        console.log(`Total replacements: ${results.totalReplacements}`);

        if (results.errors.length > 0) {
            console.log(`\n⚠️  Errors encountered: ${results.errors.length}`);
            results.errors.forEach(e => {
                console.log(`  - ${e.file}: ${e.error}`);
            });
        }

        if (verbose && results.fileChanges.length > 0) {
            console.log('\n📝 Detailed changes:');
            results.fileChanges.forEach(change => {
                console.log(`\n${change.file}:`);
                change.replacements.forEach(r => {
                    console.log(`  - ${r.rule}: ${r.count} replacements`);
                });
            });
        }

        if (dryRun) {
            console.log('\n💡 This was a dry run. Use without --dry-run to apply changes.');
        }

        // Create migration report
        const reportPath = path.join(__dirname, `eventbus-migration-report-${Date.now()}.json`);
        await writeFile(reportPath, JSON.stringify(results, null, 2), 'utf8');
        console.log(`\n📄 Full report saved to: ${reportPath}`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the migration
runMigration().then(() => {
    console.log('\n✨ Migration complete!');
    process.exit(0);
}).catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});

/**
 * initHelpers.js
 *
 * Helper functions for robust, race-free, DI-safe initialization of modules.
 * Use `waitForDepsAndDom` in your module's `init` or `initialize` method to
 * ensure all dependencies and the required DOM elements are available before
 * proceeding with initialization logic.
 */

export async function waitForDepsAndDom({
    deps = [],
    DependencySystem = window.DependencySystem,
    domSelectors = [],
    pollInterval = 30,
    timeout = 4000
} = {}) {
    if (!DependencySystem) {
        throw new Error('DependencySystem not present for waitForDepsAndDom');
    }

    const start = Date.now();
    while (true) {
        // Check dependencies
        let depsReady = true;
        for (const d of deps) {
            if (!DependencySystem.modules.has(d) || !DependencySystem.modules.get(d)) {
                depsReady = false;
                break;
            }
        }
        // Check DOM elements
        let domReady = true;
        for (const selector of domSelectors) {
            if (!document.querySelector(selector)) {
                domReady = false;
                break;
            }
        }
        if (depsReady && domReady) return;

        if (Date.now() - start > timeout) {
            throw new Error(
                `waitForDepsAndDom: Not ready within ${timeout}ms.\n` +
                `Deps missing: ${deps.filter(d => !DependencySystem.modules.has(d)).join(', ')}\n` +
                `DOM missing: ${domSelectors.filter(s => !document.querySelector(s)).join(', ')}`
            );
        }
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
}

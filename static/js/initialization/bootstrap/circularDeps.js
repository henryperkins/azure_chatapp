// ========================================
// FILE: /initialization/bootstrap/circularDeps.js
// ========================================
/**
 * Circular Dependency Resolution Patterns
 * Helper functions for handling circular dependencies
 */

/**
 * Create a stub that can be upgraded later
 */
export function createUpgradableStub(methodNames = []) {
    const stub = {};
    const upgrades = new Map();

    // Create stub methods
    methodNames.forEach(method => {
        stub[method] = (...args) => {
            const upgraded = upgrades.get(method);
            if (upgraded) {
                return upgraded(...args);
            }
            // Default no-op
            return undefined;
        };
    });

    // Upgrade function
    stub.__upgrade = (realImplementation) => {
        Object.entries(realImplementation).forEach(([key, value]) => {
            if (typeof value === 'function') {
                upgrades.set(key, value);
            }
        });
    };

    return stub;
}

/**
 * Create a lazy resolver for circular dependencies
 */
export function createLazyResolver(DependencySystem, moduleName) {
    let cached = null;

    return new Proxy({}, {
        get(target, prop) {
            if (!cached) {
                cached = DependencySystem.modules.get(moduleName);
                if (!cached) {
                    throw new Error(`[LazyResolver] Module '${moduleName}' not found in DependencySystem`);
                }
            }
            return cached[prop];
        }
    });
}

/**
 * Pattern for setter injection
 */
export function createWithSetterInjection(initialImplementation) {
    const injected = new Map();

    const wrapper = new Proxy(initialImplementation, {
        get(target, prop) {
            // Check injected dependencies first
            if (injected.has(prop)) {
                return injected.get(prop);
            }

            // Check for setter methods
            if (prop.startsWith('set') && prop.length > 3) {
                const depName = prop.slice(3);
                const lowerDepName = depName.charAt(0).toLowerCase() + depName.slice(1);

                return (dependency) => {
                    injected.set(lowerDepName, dependency);

                    // Call original setter if exists
                    if (typeof target[prop] === 'function') {
                        return target[prop](dependency);
                    }
                };
            }

            return target[prop];
        }
    });

    return wrapper;
}

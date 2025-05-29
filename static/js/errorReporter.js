/**
 * errorReporter.js - Unified error reporting with deduplication
 */

export function createErrorReporter({
    logger,
    maxErrors = 50,
    errorTtl = 300000 // 5 minutes
}) {
    if (!logger) throw new Error('[ErrorReporter] logger required');

    const errorCache = new Map(); // signature -> timestamp

    function getErrorSignature(error) {
        return `${error.name}:${error.message}:${error.stack?.split('\n')[0]}`;
    }

    function cleanCache() {
        const now = Date.now();
        for (const [sig, timestamp] of errorCache.entries()) {
            if (now - timestamp > errorTtl) {
                errorCache.delete(sig);
            }
        }
    }

    function report(error, context = {}) {
        const signature = getErrorSignature(error);
        const now = Date.now();

        // Check if recently reported
        if (errorCache.has(signature)) {
            const lastReported = errorCache.get(signature);
            if (now - lastReported < errorTtl) {
                return; // Skip duplicate
            }
        }

        // Update cache
        errorCache.set(signature, now);

        // Trim cache if too large
        if (errorCache.size > maxErrors) {
            const oldest = [...errorCache.entries()]
                .sort(([, a], [, b]) => a - b)
                .slice(0, errorCache.size - maxErrors);

            for (const [sig] of oldest) {
                errorCache.delete(sig);
            }
        }

        // Log the error
        logger.error(error.message, error, {
            context: context.context || 'ErrorReporter',
            ...context,
            errorName: error.name,
            errorStack: error.stack
        });
    }

    // Periodic cache cleanup
    const cleanupInterval = setInterval(cleanCache, 60000); // Every minute

    return {
        report,

        captureException(error, context = {}) {
            report(error, { ...context, severity: 'error' });
        },

        cleanup() {
            clearInterval(cleanupInterval);
            errorCache.clear();
        }
    };
}

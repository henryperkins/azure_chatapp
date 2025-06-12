/**
 * @file projectDashboard.js
 * @description Aligned version. A thin orchestrator that manages the project list
 *              and project details components, delegating all rendering and data logic.
 */

const MODULE_CONTEXT = 'ProjectDashboard';

export function createProjectDashboard(dependencies = {}) {
    const {
        logger,
        navigationService,
        projectListComponent,
        projectDetailsComponent
    } = dependencies;

    // --- Strict DI validation -------------------------------------------------
    const required = [
        'logger',
        'navigationService',
        'projectListComponent',
        'projectDetailsComponent'
    ];
    for (const dep of required) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    /* ----------------------------------------------------------------------- */
    /*  Implementation – purely wires views into navigationService             */
    /* ----------------------------------------------------------------------- */
    class ProjectDashboard {
        constructor() {
            this._logInfo('Instance created.');
        }

        async initialize() {
            this._logInfo('Initializing...');
            await projectListComponent.initialize();
            await projectDetailsComponent.initialize();
            this._registerNavigationViews();
        }

        _registerNavigationViews() {
            navigationService.registerView('projectList', {
                show: () => projectListComponent.show(),
                hide: () => projectListComponent.hide()
            });

            navigationService.registerView('projectDetails', {
                show: (params) => projectDetailsComponent.show(params),
                hide: () => projectDetailsComponent.hide()
            });

            this._logInfo('Navigation views registered.');
        }

        cleanup() {
            this._logInfo('Cleaning up.');
            projectListComponent.cleanup();
            projectDetailsComponent.cleanup();
        }

        /* ----------------- internal helpers -------------------------------- */
        _logInfo(msg, meta = {}) {
            logger.info(`[${MODULE_CONTEXT}] ${msg}`, { ...meta, context: MODULE_CONTEXT });
        }
    }

    // Single orchestrator instance
    const instance = new ProjectDashboard();

    return {
        initialize: () => instance.initialize(),
        cleanup: () => instance.cleanup()
    };
}

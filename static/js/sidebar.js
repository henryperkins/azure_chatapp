/**
 * @file sidebar.js
 * @description Aligned version. Manages the main sidebar container and orchestrates its sub-components.
 */

const MODULE_CONTEXT = 'Sidebar';

export function createSidebar(dependencies = {}) {
    const {
        domAPI,
        eventHandlers,
        logger,
        uiStateService,
        navigationService,
        sidebarAuth,       // injected sub-component
        sidebarMobileDock, // injected sub-component
        modelConfig        // injected quick-settings helper
    } = dependencies;

    const requiredDeps = [
        'domAPI',
        'eventHandlers',
        'logger',
        'uiStateService',
        'navigationService',
        'sidebarAuth',
        'sidebarMobileDock',
        'modelConfig'
    ];
    for (const dep of requiredDeps) {
        if (!dependencies[dep]) {
            throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: ${dep}`);
        }
    }

    /* --------------------------------------------------------------------- */
    /*  Cached DOM look-ups                                                  */
    /* --------------------------------------------------------------------- */
    const elements = {
        get container()    { return domAPI.getElementById('mainSidebar'); },
        get toggleBtn()    { return domAPI.getElementById('navToggleBtn'); },
        get closeBtn()     { return domAPI.getElementById('closeSidebarBtn'); },
        get settingsPanel(){ return domAPI.getElementById('sidebarSettingsPanel'); }
    };

    /* --------------------------------------------------------------------- */
    /*  Internal helpers                                                     */
    /* --------------------------------------------------------------------- */
    function _showSidebar() {
        const { container } = elements;
        if (!container) return;
        uiStateService.setState(MODULE_CONTEXT, 'visible', true);
        domAPI.addClass(container, 'open');
        domAPI.addClass(domAPI.getBody(), 'with-sidebar-open');
    }

    function _closeSidebar() {
        const { container } = elements;
        if (!container) return;
        uiStateService.setState(MODULE_CONTEXT, 'visible', false);
        domAPI.removeClass(container, 'open');
        domAPI.removeClass(domAPI.getBody(), 'with-sidebar-open');
    }

    function _toggleSettingsPanel() {
        const panel = elements.settingsPanel;
        if (!panel) return;
        const hidden = panel.classList.contains('hidden');
        domAPI.toggleClass(panel, 'hidden', !hidden);
        if (hidden) {
            modelConfig.renderQuickConfig(panel); // lazy render
        }
    }

    /* --------------------------------------------------------------------- */
    /*  Public factory return                                                */
    /* --------------------------------------------------------------------- */
    return {
        async initialize() {
            logger.info(`[${MODULE_CONTEXT}] Initializing…`, { context: MODULE_CONTEXT });

            // Initialize sub-components
            await sidebarAuth.initialize();
            await sidebarMobileDock.initialize();

            // Wire clicks
            eventHandlers.trackListener(elements.toggleBtn, 'click', _showSidebar,  { context: MODULE_CONTEXT });
            eventHandlers.trackListener(elements.closeBtn,  'click', _closeSidebar, { context: MODULE_CONTEXT });

            // Mobile dock callbacks
            sidebarMobileDock.onTabActivate((tab) => {
                navigationService.navigateTo(tab);
            });
            sidebarMobileDock.onOpenSettings(_toggleSettingsPanel);
        },

        activateTab(tabName) {
            logger.info(`[${MODULE_CONTEXT}] Activating tab ${tabName}`, { context: MODULE_CONTEXT });
            navigationService.navigateTo(tabName);
        },

        cleanup() {
            logger.info(`[${MODULE_CONTEXT}] Cleaning up.`, { context: MODULE_CONTEXT });
            sidebarAuth.cleanup();
            sidebarMobileDock.cleanup();
            eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
        }
    };
}

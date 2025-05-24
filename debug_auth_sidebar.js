// Debug script for testing sidebar authentication state
// Run this in the browser console when the app is loaded

(function() {
    console.log('=== Sidebar Authentication Debug Script ===');
    
    function checkDependencySystem() {
        if (typeof window.DependencySystem === 'undefined') {
            console.error('❌ DependencySystem not available');
            return false;
        }
        console.log('✅ DependencySystem available');
        return true;
    }
    
    function checkAppModule() {
        const appModule = window.DependencySystem?.modules?.get?.('appModule');
        if (!appModule) {
            console.error('❌ appModule not found');
            return null;
        }
        
        console.log('✅ appModule found');
        console.log('📊 appModule.state:', appModule.state);
        return appModule;
    }
    
    function checkAuthModule() {
        const auth = window.DependencySystem?.modules?.get?.('auth');
        if (!auth) {
            console.error('❌ auth module not found');
            return null;
        }
        
        console.log('✅ auth module found');
        console.log('📊 auth.isAuthenticated():', auth.isAuthenticated?.());
        console.log('📊 auth.getCurrentUserObject():', auth.getCurrentUserObject?.());
        return auth;
    }
    
    function checkSidebarModule() {
        const sidebar = window.DependencySystem?.modules?.get?.('sidebar');
        if (!sidebar) {
            console.error('❌ sidebar module not found');
            return null;
        }
        
        console.log('✅ sidebar module found');
        console.log('📊 sidebar methods:', Object.keys(sidebar));
        return sidebar;
    }
    
    function checkSidebarDOM() {
        const sidebarAuthForm = document.getElementById('sidebarAuthFormContainer');
        const mainSidebar = document.getElementById('mainSidebar');
        
        console.log('📊 Sidebar DOM elements:');
        console.log('  - sidebarAuthFormContainer exists:', !!sidebarAuthForm);
        console.log('  - sidebarAuthFormContainer hidden:', sidebarAuthForm?.classList?.contains('hidden'));
        console.log('  - sidebarAuthFormContainer display:', sidebarAuthForm?.style?.display);
        console.log('  - mainSidebar exists:', !!mainSidebar);
        console.log('  - mainSidebar hidden:', mainSidebar?.classList?.contains('hidden'));
        
        return { sidebarAuthForm, mainSidebar };
    }
    
    function runDiagnostics() {
        console.log('\n🔍 Running full diagnostics...\n');
        
        if (!checkDependencySystem()) return;
        
        const appModule = checkAppModule();
        const auth = checkAuthModule();
        const sidebar = checkSidebarModule();
        const domElements = checkSidebarDOM();
        
        console.log('\n📋 Summary:');
        console.log('  - App authenticated:', appModule?.state?.isAuthenticated);
        console.log('  - Auth module authenticated:', auth?.isAuthenticated?.());
        console.log('  - Form should be hidden:', appModule?.state?.isAuthenticated);
        console.log('  - Form is actually hidden:', domElements.sidebarAuthForm?.classList?.contains('hidden'));
        
        const isConsistent = (appModule?.state?.isAuthenticated === true) === domElements.sidebarAuthForm?.classList?.contains('hidden');
        console.log('  - State is consistent:', isConsistent ? '✅' : '❌');
        
        return {
            appModule,
            auth,
            sidebar,
            domElements,
            isConsistent
        };
    }
    
    function forceAuthRefresh() {
        console.log('\n🔄 Forcing auth state refresh...');
        const sidebar = window.DependencySystem?.modules?.get?.('sidebar');
        if (sidebar?.forceAuthStateRefresh) {
            const result = sidebar.forceAuthStateRefresh();
            console.log('📊 Refresh result:', result);
            return result;
        } else {
            console.error('❌ forceAuthStateRefresh not available');
            return null;
        }
    }
    
    function simulateAuthChange(authenticated, user = null) {
        console.log(`\n🎭 Simulating auth change: authenticated=${authenticated}`);
        
        const appModule = window.DependencySystem?.modules?.get?.('appModule');
        const auth = window.DependencySystem?.modules?.get?.('auth');
        
        if (!appModule?.setAuthState) {
            console.error('❌ appModule.setAuthState not available');
            return;
        }
        
        // Update app state
        appModule.setAuthState({
            isAuthenticated: authenticated,
            currentUser: user
        });
        
        // Dispatch event
        if (auth?.AuthBus) {
            const event = new CustomEvent('authStateChanged', {
                detail: {
                    authenticated,
                    user,
                    source: 'debug_script_simulation'
                }
            });
            auth.AuthBus.dispatchEvent(event);
            console.log('📡 AuthBus event dispatched');
        }
        
        // Also dispatch on document
        const docEvent = new CustomEvent('authStateChanged', {
            detail: {
                authenticated,
                user,
                source: 'debug_script_simulation_doc'
            }
        });
        document.dispatchEvent(docEvent);
        console.log('📡 Document event dispatched');
        
        // Check result after a short delay
        setTimeout(() => {
            console.log('📊 State after simulation:');
            checkSidebarDOM();
        }, 100);
    }
    
    // Expose functions globally for easy access
    window.debugAuth = {
        runDiagnostics,
        forceAuthRefresh,
        simulateLogin: () => simulateAuthChange(true, { id: 1, username: 'testuser' }),
        simulateLogout: () => simulateAuthChange(false, null),
        checkAppModule,
        checkAuthModule,
        checkSidebarModule,
        checkSidebarDOM
    };
    
    console.log('\n🎯 Debug functions available as window.debugAuth:');
    console.log('  - debugAuth.runDiagnostics()');
    console.log('  - debugAuth.forceAuthRefresh()');
    console.log('  - debugAuth.simulateLogin()');
    console.log('  - debugAuth.simulateLogout()');
    
    // Run initial diagnostics
    runDiagnostics();
    
})();

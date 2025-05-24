// Simple verification script to check if the sidebar auth fix is working
// This can be run in the browser console

console.log('🔍 Verifying Sidebar Authentication Fix...\n');

// Check if the application is loaded
if (typeof window.DependencySystem === 'undefined') {
    console.error('❌ Application not loaded - DependencySystem not available');
} else {
    console.log('✅ Application loaded');
    
    // Get modules
    const appModule = window.DependencySystem.modules?.get?.('appModule');
    const auth = window.DependencySystem.modules?.get?.('auth');
    const sidebar = window.DependencySystem.modules?.get?.('sidebar');
    
    if (!appModule) {
        console.error('❌ appModule not found');
    } else {
        console.log('✅ appModule found');
        
        // Check authentication state
        const isAuthenticated = appModule.state?.isAuthenticated;
        const currentUser = appModule.state?.currentUser;
        
        console.log(`📊 Authentication State:`);
        console.log(`   - isAuthenticated: ${isAuthenticated}`);
        console.log(`   - currentUser: ${currentUser ? currentUser.username : 'null'}`);
        
        // Check sidebar form visibility
        const sidebarAuthForm = document.getElementById('sidebarAuthFormContainer');
        if (!sidebarAuthForm) {
            console.error('❌ Sidebar auth form not found in DOM');
        } else {
            const isFormHidden = sidebarAuthForm.classList.contains('hidden');
            const formDisplay = sidebarAuthForm.style.display;
            
            console.log(`📊 Sidebar Form State:`);
            console.log(`   - Form exists: true`);
            console.log(`   - Form has 'hidden' class: ${isFormHidden}`);
            console.log(`   - Form display style: '${formDisplay}'`);
            
            // Check if the state is consistent
            const shouldBeHidden = isAuthenticated === true;
            const isActuallyHidden = isFormHidden || formDisplay === 'none';
            
            console.log(`📊 Consistency Check:`);
            console.log(`   - Should form be hidden? ${shouldBeHidden}`);
            console.log(`   - Is form actually hidden? ${isActuallyHidden}`);
            
            if (shouldBeHidden === isActuallyHidden) {
                console.log('✅ SUCCESS: Sidebar form visibility is consistent with auth state!');
                
                if (isAuthenticated) {
                    console.log('✅ User is authenticated and form is properly hidden');
                } else {
                    console.log('✅ User is not authenticated and form is properly visible');
                }
            } else {
                console.log('❌ ISSUE: Sidebar form visibility is NOT consistent with auth state');
                console.log('🔧 Attempting to fix by forcing auth state refresh...');
                
                if (sidebar?.forceAuthStateRefresh) {
                    const result = sidebar.forceAuthStateRefresh();
                    console.log('📊 Force refresh result:', result);
                    
                    // Check again after refresh
                    setTimeout(() => {
                        const isFormHiddenAfter = sidebarAuthForm.classList.contains('hidden');
                        const formDisplayAfter = sidebarAuthForm.style.display;
                        const isActuallyHiddenAfter = isFormHiddenAfter || formDisplayAfter === 'none';
                        
                        console.log(`📊 After Force Refresh:`);
                        console.log(`   - Form has 'hidden' class: ${isFormHiddenAfter}`);
                        console.log(`   - Form display style: '${formDisplayAfter}'`);
                        console.log(`   - Is form actually hidden? ${isActuallyHiddenAfter}`);
                        
                        if (shouldBeHidden === isActuallyHiddenAfter) {
                            console.log('✅ SUCCESS: Force refresh fixed the issue!');
                        } else {
                            console.log('❌ STILL BROKEN: Force refresh did not fix the issue');
                        }
                    }, 200);
                } else {
                    console.log('❌ forceAuthStateRefresh method not available');
                }
            }
        }
    }
}

// Also provide a manual test function
window.testSidebarAuthFix = function() {
    console.log('\n🧪 Running manual test...');
    
    const appModule = window.DependencySystem?.modules?.get?.('appModule');
    const sidebarAuthForm = document.getElementById('sidebarAuthFormContainer');
    
    if (!appModule || !sidebarAuthForm) {
        console.log('❌ Cannot run test - missing dependencies');
        return;
    }
    
    const originalAuth = appModule.state.isAuthenticated;
    
    console.log('1. Testing logout state...');
    appModule.setAuthState({ isAuthenticated: false, currentUser: null });
    
    setTimeout(() => {
        const isHiddenLogout = sidebarAuthForm.classList.contains('hidden');
        console.log(`   - Form hidden when logged out: ${isHiddenLogout} (should be false)`);
        
        console.log('2. Testing login state...');
        appModule.setAuthState({ isAuthenticated: true, currentUser: { id: 1, username: 'test' } });
        
        setTimeout(() => {
            const isHiddenLogin = sidebarAuthForm.classList.contains('hidden');
            console.log(`   - Form hidden when logged in: ${isHiddenLogin} (should be true)`);
            
            // Restore original state
            appModule.setAuthState({ isAuthenticated: originalAuth, currentUser: originalAuth ? { id: 1, username: 'user' } : null });
            console.log('3. Restored original auth state');
        }, 100);
    }, 100);
};

console.log('\n💡 You can also run window.testSidebarAuthFix() to test the fix manually');

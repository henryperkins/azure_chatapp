// Debugging script to diagnose sidebar and auth button issues
// Run in browser console: copy and paste this code

console.log('🔍 DEBUGGING SIDEBAR AND AUTH BUTTON ISSUES');

// 1. Check DOM elements
console.log('\n📋 DOM ELEMENTS CHECK:');
const elements = {
  navToggleBtn: document.getElementById('navToggleBtn'),
  mainSidebar: document.getElementById('mainSidebar'),
  authButton: document.getElementById('authButton'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn')
};

Object.entries(elements).forEach(([name, el]) => {
  console.log(`${name}: ${el ? '✅ exists' : '❌ missing'}`, el);
});

// 2. Check DependencySystem modules
console.log('\n🔧 DEPENDENCY SYSTEM MODULES:');
const modules = [
  'eventHandlers',
  'modalManager', 
  'sidebar',
  'auth',
  'appModule'
];

modules.forEach(name => {
  const module = DependencySystem.modules.get(name);
  console.log(`${name}: ${module ? '✅ registered' : '❌ missing'}`, module);
});

// 3. Check sidebar state
console.log('\n📏 SIDEBAR STATE:');
const sidebar = DependencySystem.modules.get('sidebar');
if (sidebar) {
  console.log('Sidebar visible:', sidebar.isVisible?.());
  console.log('Sidebar pinned:', sidebar.isPinned?.());
} else {
  console.log('❌ Sidebar module not available');
}

// 4. Check viewport and CSS classes
console.log('\n📱 VIEWPORT AND CSS:');
console.log('Window width:', window.innerWidth);
console.log('Is desktop (>=768):', window.innerWidth >= 768);

if (elements.mainSidebar) {
  console.log('Sidebar classes:', elements.mainSidebar.className);
  console.log('Sidebar computed style transform:', getComputedStyle(elements.mainSidebar).transform);
  console.log('Sidebar display:', getComputedStyle(elements.mainSidebar).display);
  console.log('Sidebar visibility:', getComputedStyle(elements.mainSidebar).visibility);
}

// 5. Check event handlers init status
console.log('\n⚡ EVENT HANDLERS:');
const eventHandlers = DependencySystem.modules.get('eventHandlers');
if (eventHandlers) {
  console.log('EventHandlers available:', !!eventHandlers);
  // Try to check if auth button delegation is bound
  if (eventHandlers._authButtonDelegationBound !== undefined) {
    console.log('Auth button delegation bound:', eventHandlers._authButtonDelegationBound);
  }
} else {
  console.log('❌ EventHandlers not available');
}

// 6. Manual tests
console.log('\n🧪 MANUAL TESTS:');

// Test 1: Try to show sidebar manually
console.log('Test 1: Trying to show sidebar manually...');
if (sidebar && sidebar.show) {
  try {
    sidebar.show();
    console.log('✅ Sidebar.show() executed');
  } catch (err) {
    console.log('❌ Sidebar.show() failed:', err);
  }
} else {
  console.log('❌ Sidebar.show() not available');
}

// Test 2: Try to show login modal manually
console.log('Test 2: Trying to show login modal manually...');
const modalManager = DependencySystem.modules.get('modalManager');
if (modalManager && modalManager.show) {
  try {
    modalManager.show('login');
    console.log('✅ ModalManager.show("login") executed');
  } catch (err) {
    console.log('❌ ModalManager.show("login") failed:', err);
  }
} else {
  console.log('❌ ModalManager.show() not available');
}

// Test 3: Force sidebar visible with CSS
console.log('Test 3: Force sidebar visible with CSS...');
if (elements.mainSidebar) {
  elements.mainSidebar.classList.remove('-translate-x-full', 'hidden');
  elements.mainSidebar.classList.add('translate-x-0');
  console.log('✅ CSS classes updated to show sidebar');
  console.log('New classes:', elements.mainSidebar.className);
} else {
  console.log('❌ mainSidebar element not available');
}

console.log('\n🏁 DEBUG COMPLETE');
console.log('If sidebar is now visible, the issue was CSS classes.');
console.log('If auth button still doesn\'t work, the issue is event delegation.');
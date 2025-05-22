/**
 * project-details-enhancements.js
 * Implements enhanced UI features for the project details and project list pages,
 * following the styling in the corresponding CSS files
 */

function createProjectDetailsEnhancements(deps) {
  // Validate dependencies
  if (!deps || typeof deps !== 'object') {
    throw new Error('[createProjectDetailsEnhancements] Dependencies object is required');
  }

  const {
    domAPI,
    browserService,
    eventHandlers,
    domReadinessService,
    logger,
    sanitizer
  } = deps;

  // Validate required dependencies
  if (!domAPI) throw new Error('[createProjectDetailsEnhancements] Missing dependency: domAPI');
  if (!browserService) throw new Error('[createProjectDetailsEnhancements] Missing dependency: browserService');
  if (!eventHandlers) throw new Error('[createProjectDetailsEnhancements] Missing dependency: eventHandlers');
  if (!domReadinessService) throw new Error('[createProjectDetailsEnhancements] Missing dependency: domReadinessService');
  if (!logger) throw new Error('[createProjectDetailsEnhancements] Missing dependency: logger');
  if (!sanitizer) throw new Error('[createProjectDetailsEnhancements] Missing dependency: sanitizer');

  // State management
  const state = {
    initialized: false,
    // Token stats removed for mobile refactor
    activeTab: 'chat',
    // Project list state
    projectListInitialized: false,
    currentFilter: 'all',
    searchTerm: ''
  };

  // Event tracking context
  const CONTEXT = 'projectEnhancements';

  /**
   * Convert linear progress to circular progress for token usage
   */
  // (Mobile refactor) Legacy token usage indicator removed

  /**
   * Generate a simple sparkline visualization with random data
   * @param {number} points Number of data points
   * @param {number} lastValue Last value to end the sparkline (usually current percentage)
   * @returns {string} HTML for the sparkline
   */
  function generateSparkline(points, lastValue) {
    try {
      // Generate random data that trends toward the lastValue
      const data = [];
      const minValue = Math.max(0, lastValue - 25);

      for (let i = 0; i < points - 1; i++) {
        const value = minValue + Math.random() * (lastValue - minValue) * (i / (points - 1));
        data.push(Math.floor(value));
      }

      // Add the actual lastValue as the final point
      data.push(lastValue);

      // Create the sparkline SVG
      let sparkContent = `<div class="line">`;

      // Add points
      data.forEach((value, index) => {
        const x = (index / (points - 1)) * 100;
        const y = 100 - value; // Invert since SVG 0,0 is top-left

        sparkContent += `<div class="point" style="left: ${x}%; top: ${y}%;"></div>`;
      });

      sparkContent += `</div>`;
      return sparkContent;
    } catch (error) {
      logger.error('[generateSparkline]', error, { context: CONTEXT });
      return '';
    }
  }

  /**
   * Add a floating action button (FAB) to the project details page
   * with enhanced mobile interactions
   */
  function addFloatingActionButton() {
    try {
      // Create FAB element
      const fabElement = domAPI.createElement('button');
      fabElement.id = 'projectFab';
      fabElement.className = 'project-fab';
      fabElement.title = 'Quick Actions';
      fabElement.setAttribute('aria-label', 'Quick Actions');

      // Create FAB icon
      domAPI.setInnerHTML(fabElement, sanitizer.sanitize(`
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      `));

      // Append to project-details-root
      const projectRoot = domAPI.querySelector('.project-details-root');
      if (projectRoot) {
        projectRoot.appendChild(fabElement);
      }

      // Add click handler
      const handleFabClick = (e) => {
        e.preventDefault();

        // Determine current tab and perform relevant action
        let targetBtn;

        switch (state.activeTab) {
          case 'files':
            // Trigger file upload
            targetBtn = domAPI.getElementById('uploadFileBtn');
            break;
          case 'chat':
            // Create new conversation
            targetBtn = domAPI.getElementById('newConversationBtn');
            break;
          case 'knowledge':
            // Search knowledge base
            targetBtn = domAPI.getElementById('searchKnowledgeBtn');
            break;
          default:
            // Edit project details
            targetBtn = domAPI.getElementById('editProjectBtn');
            break;
        }

        if (targetBtn) {
          // Add haptic feedback on mobile if available
          if (browserService && browserService.isMobile && browserService.getWindow()?.navigator?.vibrate) {
            browserService.getWindow().navigator.vibrate(50); // Short vibration for feedback
          }

          // Visual feedback - temporary animation
          fabElement.classList.add('active');
          browserService.setTimeout(() => fabElement.classList.remove('active'), 300);

          targetBtn.click();
        }
      };

      const fabClickUnsub = eventHandlers.trackListener(
        fabElement,
        'click',
        handleFabClick,
        { context: CONTEXT }
      );

      // For mobile: Add reminder pulse after 5 seconds of inactivity
      // to subtly draw attention to the FAB
      if (browserService && browserService.isMobile) {
        browserService.setTimeout(() => {
          // Only add pulse if user hasn't interacted with FAB yet
          if (!fabElement.classList.contains('active')) {
            fabElement.classList.add('reminder-pulse');
            // Remove pulse after 5 seconds
            browserService.setTimeout(() => fabElement.classList.remove('reminder-pulse'), 5000);
          }
        }, 5000);

        // Add touch feedback
        eventHandlers.trackListener(
          fabElement,
          'touchstart',
          () => {
            fabElement.style.transform = 'scale(0.95)';
            fabElement.classList.remove('reminder-pulse');
          },
          { context: CONTEXT }
        );

        eventHandlers.trackListener(
          fabElement,
          'touchend',
          () => {
            fabElement.style.transform = '';
          },
          { context: CONTEXT }
        );
      }
    } catch (error) {
      logger.error('[addFloatingActionButton]', error, { context: CONTEXT });
    }
  }

  /**
   * Enhance empty states with better visuals
   */
  function enhanceEmptyStates() {
    try {
      // Find all empty state messages
      const emptyStates = domAPI.querySelectorAll('.text-base-content\\/60.text-center.py-8');

      emptyStates.forEach(emptyState => {
        const message = emptyState.textContent.trim();
        const parentId = emptyState.parentElement?.id || '';

        // Create enhanced empty state
        const enhancedEmptyState = domAPI.createElement('div');
        enhancedEmptyState.className = 'empty-state';

        // Configure icon and text based on container context
        let icon, title, description;

        if (parentId.includes('file')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>`;
          title = 'No Files Yet';
          description = 'Upload files to your project to get started';
        } else if (parentId.includes('artifactsList')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>`;
          title = 'No Artifacts Generated';
          description = 'Artifacts will appear here when created during conversations';
        } else if (parentId.includes('conversationsList')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>`;
          title = 'No Conversations Yet';
          description = 'Start a new chat to begin your project';
        } else if (parentId.includes('knowledgeProcessedFiles')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>`;
          title = 'Knowledge Base Empty';
          description = 'Upload files to add them to your knowledge base';
        } else {
          // Fallback
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>`;
          title = 'Nothing Here Yet';
          description = message;
        }

        // Construct the enhanced empty state HTML
        domAPI.setInnerHTML(enhancedEmptyState, sanitizer.sanitize(`
          <div class="empty-state-icon">${icon}</div>
          <h4 class="empty-state-title">${title}</h4>
          <p class="empty-state-description">${description}</p>
        `));

        // Replace the original empty state with the enhanced one
        emptyState.replaceWith(enhancedEmptyState);
      });
    } catch (error) {
      logger.error('[enhanceEmptyStates]', error, { context: CONTEXT });
    }
  }

  /**
   * Track active tab changes to update FAB behavior
   */
  function setupTabTracking() {
    try {
      const tabButtons = domAPI.querySelectorAll('.project-tab');

      tabButtons.forEach(button => {
        const tabHandler = (e) => {
          const tabId = button.getAttribute('data-tab');
          if (tabId) {
            state.activeTab = tabId;

            // Update FAB visibility based on tab
            const fab = domAPI.getElementById('projectFab');
            if (fab) {
              // Always show FAB, but change its appearance based on context
              const tabToIconMap = {
                files: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>',
                chat: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>',
                knowledge: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>',
                details: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>',
                artifacts: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>'
              };

              // Update icon based on tab
              if (tabToIconMap[tabId]) {
                domAPI.setInnerHTML(fab, sanitizer.sanitize(tabToIconMap[tabId]));
              }

              // Update title/aria-label based on tab
              const tabToTitleMap = {
                files: 'Upload Files',
                chat: 'New Conversation',
                knowledge: 'Search Knowledge Base',
                details: 'Edit Project Details',
                artifacts: 'View Artifacts'
              };

              if (tabToTitleMap[tabId]) {
                fab.title = tabToTitleMap[tabId];
                fab.setAttribute('aria-label', tabToTitleMap[tabId]);
              }
            }
          }
        };

        const tabUnsub = eventHandlers.trackListener(
          button,
          'click',
          tabHandler,
          { context: CONTEXT }
        );
      });
    } catch (error) {
      logger.error('[setupTabTracking]', error, { context: CONTEXT });
    }
  }

  /**
   * Enhance project list with improved visuals and interactions
   */
  function enhanceProjectList() {
    try {
      // Get the project list container
      const projectList = domAPI.getElementById('projectList');
      if (!projectList) return;

      // Apply enhancements to project cards
      enhanceProjectCards();

      // Add search and filtering enhancements
      setupProjectSearchFiltering();

      // Add animation to "New Project" button
      const createBtn = domAPI.getElementById('projectListCreateBtn');
      if (createBtn) {
        createBtn.classList.add('enhanced-btn');
      }

      // Make sure list is visible with a smooth fade-in
      projectList.style.opacity = '1';

      // Mobile-specific enhancements
      if (browserService && browserService.isMobile) {
        // Improve touch targets
        domAPI.querySelectorAll('#projectList .btn, #projectList button').forEach(btn => {
          if (!btn.classList.contains('btn-lg')) {
            btn.style.minHeight = '44px'; // Ensure minimum touch target size
          }
        });

        // Improve keyboard experience for search input
        const searchInput = domAPI.getElementById('projectSearchInput');
        if (searchInput) {
          // Prevent iOS zoom by ensuring font size is at least 16px
          searchInput.style.fontSize = '16px';

          // Add proper mobile keyboard support
          searchInput.setAttribute('inputmode', 'search');
          searchInput.setAttribute('enterkeyhint', 'search');

          // Clear button for mobile
          const clearBtn = domAPI.createElement('button');
          clearBtn.className = 'input-clear-btn';
          domAPI.setInnerHTML(clearBtn, sanitizer.sanitize(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          `));

          // Insert clear button after search input
          searchInput.parentNode.insertBefore(clearBtn, searchInput.nextSibling);

          // Initially hidden
          clearBtn.style.display = 'none';

          // Show/hide clear button based on input content
          eventHandlers.trackListener(
            searchInput,
            'input',
            () => {
              clearBtn.style.display = searchInput.value ? 'flex' : 'none';
            },
            { context: CONTEXT }
          );

          // Clear input when button is clicked
          eventHandlers.trackListener(
            clearBtn,
            'click',
            () => {
              searchInput.value = '';
              searchInput.dispatchEvent(new Event('input'));
              searchInput.focus();
            },
            { context: CONTEXT }
          );
        }
      }

      state.projectListInitialized = true;
      logger.debug('[enhanceProjectList] Project list enhancements applied', { context: CONTEXT });
    } catch (error) {
      logger.error('[enhanceProjectList]', error, { context: CONTEXT });
    }
  }

  /**
   * Add visual enhancements to project cards
   */
  function enhanceProjectCards() {
    try {
      // Find all project cards
      const projectCards = domAPI.querySelectorAll('.project-card');
      if (projectCards.length === 0) return;

      projectCards.forEach((card, index) => {
        // Add animation delay for staggered appearance
        card.style.animationDelay = `${index * 50}ms`;

        // Enhance the badges for pinned and archived projects
        const badges = card.querySelector('.flex.gap-1');
        if (badges) {
          const badgeElems = badges.querySelectorAll('span');

          badgeElems.forEach(badge => {
            const tip = badge.dataset.tip;

            // Replace emoji-based badges with styled badges
            if (tip === 'Pinned') {
              badge.classList.add('badge', 'badge-pinned');
              domAPI.setInnerHTML(badge, sanitizer.sanitize(`
                <svg xmlns="http://www.w3.org/2000/svg" class="metadata-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                <span>Pinned</span>
              `));
            } else if (tip === 'Archived') {
              badge.classList.add('badge', 'badge-archived');
              domAPI.setInnerHTML(badge, sanitizer.sanitize(`
                <svg xmlns="http://www.w3.org/2000/svg" class="metadata-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span>Archived</span>
              `));
            }
          });
        }

        // Add metadata to the footer
        const footer = card.querySelector('.mt-auto');
        if (footer) {
          // Create metadata container if it doesn't exist
          let metadataDiv = footer.querySelector('.metadata');
          if (!metadataDiv) {
            metadataDiv = domAPI.createElement('div');
            metadataDiv.className = 'metadata mt-2';

            // Append metadata about activity/date (using existing date if available)
            const dateText = footer.textContent?.trim() || '';
            if (dateText) {
              domAPI.setInnerHTML(metadataDiv, sanitizer.sanitize(`
                <div class="metadata-item">
                  <svg xmlns="http://www.w3.org/2000/svg" class="metadata-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>${dateText}</span>
                </div>
              `));
            }

            footer.appendChild(metadataDiv);
          }
        }
      });
    } catch (error) {
      logger.error('[enhanceProjectCards]', error, { context: CONTEXT });
    }
  }

  /**
   * Setup enhanced search and filtering for project list
   */
  function setupProjectSearchFiltering() {
    try {
      const searchInput = domAPI.getElementById('projectSearchInput');
      if (!searchInput) return;

      // Add real-time search filtering
      const handleSearch = (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        state.searchTerm = searchTerm;

        const projectCards = domAPI.querySelectorAll('.project-card');
        const noProjectsMessage = domAPI.getElementById('noProjectsMessage');

        let visibleCount = 0;

        projectCards.forEach(card => {
          const projectName = card.querySelector('.project-name')?.textContent?.toLowerCase() || '';
          const projectDescription = card.querySelector('.text-sm.text-base-content\\/70')?.textContent?.toLowerCase() || '';

          // Check if the card matches the search term
          const matches = projectName.includes(searchTerm) || projectDescription.includes(searchTerm);

          // Also check if it matches the current filter
          const isPinned = card.innerHTML.includes('Pinned');
          const isArchived = card.innerHTML.includes('Archived');

          let matchesFilter = true;
          if (state.currentFilter === 'pinned' && !isPinned) {
            matchesFilter = false;
          } else if (state.currentFilter === 'archived' && !isArchived) {
            matchesFilter = false;
          }

          // Show/hide based on filter and search
          const shouldShow = matches && matchesFilter;
          card.style.display = shouldShow ? '' : 'none';

          if (shouldShow) visibleCount++;
        });

        // Show/hide no projects message
        if (noProjectsMessage) {
          noProjectsMessage.style.display = visibleCount === 0 ? 'block' : 'none';
        }
      };

      // Track search input events
      eventHandlers.trackListener(
        searchInput,
        'input',
        handleSearch,
        { context: CONTEXT }
      );

      // Add filter tab click tracking
      const filterTabs = domAPI.querySelectorAll('#projectFilterTabs .tab');
      filterTabs.forEach(tab => {
        eventHandlers.trackListener(
          tab,
          'click',
          () => {
            state.currentFilter = tab.dataset.filter || 'all';

            // Trigger search to apply filtering
            const event = new Event('input');
            searchInput.dispatchEvent(event);
          },
          { context: CONTEXT }
        );
      });
    } catch (error) {
      logger.error('[setupProjectSearchFiltering]', error, { context: CONTEXT });
    }
  }

  /**
   * Initialize project list enhancements
   */
  async function initializeProjectList() {
    try {
      // Wait for project list elements to be ready
      await domReadinessService.dependenciesAndElements({
        domSelectors: ['#projectList', '#projectCardsPanel', '#projectFilterTabs'],
        context: CONTEXT + '_projectList'
      });

      enhanceProjectList();
      logger.debug('[initializeProjectList] Project list initialized', { context: CONTEXT });
      return true;
    } catch (error) {
      logger.error('[initializeProjectList]', error, { context: CONTEXT });
      return false;
    }
  }

  /**
   * Add mobile-specific pull-to-refresh for the conversation list
   */
  function setupPullToRefresh() {
    const CONTEXT = 'project-details:pull-to-refresh';
    try {
      // Only apply on mobile devices
      if (!browserService || !browserService.isMobile) return;

      const conversationsList = domAPI.getElementById('conversationsList');
      if (!conversationsList) return;

      // Create pull indicator element
      const pullIndicator = domAPI.createElement('div');
      pullIndicator.className = 'pull-indicator';
      domAPI.setInnerHTML(pullIndicator, sanitizer.sanitize(`
        <div class="mobile-loading-indicator"></div>
        <span class="ml-2">Pull to refresh</span>
      `));

      // Insert at the top of the conversations list
      domAPI.insertBefore(conversationsList, pullIndicator, domAPI.getProperty(conversationsList, 'firstChild'));

      // State variables for tracking pull gesture
      let startY = 0;
      let currentY = 0;
      let isPulling = false;
      let refreshTriggered = false;

      // Touch event handlers using strict DI practices
      const onTouchStart = (e) => {
        try {
          const scrollTop = domAPI.getProperty(conversationsList, 'scrollTop');
          if (scrollTop <= 5) {
            const touches = domAPI.getProperty(e, 'touches');
            startY = domAPI.getProperty(touches[0], 'clientY');
            isPulling = true;
          }
        } catch (err) {
          logger.error('[setupPullToRefresh][onTouchStart]', err, { context: CONTEXT });
        }
      };

      const onTouchMove = (e) => {
        try {
          if (!isPulling) return;
          const touches = domAPI.getProperty(e, 'touches');
          currentY = domAPI.getProperty(touches[0], 'clientY');
          const pullDistance = currentY - startY;

          // Only allow pulling down, not up
          if (pullDistance <= 0) {
            isPulling = false;
            return;
          }

          // Apply resistance to the pull
          const resistance = 0.4;
          const transformY = Math.min(pullDistance * resistance, 80);

          domAPI.setStyle(pullIndicator, 'transform', `translateY(${transformY}px)`);
          domAPI.addClass(pullIndicator, 'visible');

          // If pulled far enough, mark as ready to refresh
          if (transformY > 60 && !refreshTriggered) {
            domAPI.setInnerHTML(pullIndicator, sanitizer.sanitize(`
              <div class="mobile-loading-indicator"></div>
              <span class="ml-2">Release to refresh</span>
            `));
            refreshTriggered = true;
          } else if (transformY <= 60 && refreshTriggered) {
            domAPI.setInnerHTML(pullIndicator, sanitizer.sanitize(`
              <div class="mobile-loading-indicator"></div>
              <span class="ml-2">Pull to refresh</span>
            `));
            refreshTriggered = false;
          }

          // Prevent default scrolling
          domAPI.preventDefault(e);
        } catch (err) {
          logger.error('[setupPullToRefresh][onTouchMove]', err, { context: CONTEXT });
        }
      };

      const onTouchEnd = () => {
        try {
          if (!isPulling) return;

          // If we pulled far enough, trigger refresh
          if (refreshTriggered) {
            domAPI.setInnerHTML(pullIndicator, sanitizer.sanitize(`
              <div class="mobile-loading-indicator"></div>
              <span class="ml-2">Refreshing...</span>
            `));

            // Reload conversation list data
            const projectIdEl = domAPI.querySelector('[data-project-id]');
            const DependencySystem = eventHandlers.DependencySystem;
            if (projectIdEl && DependencySystem?.modules?.get('projectManager')) {
              const projectId = domAPI.getDataAttribute(projectIdEl, 'projectId');
              const projectManager = DependencySystem.modules.get('projectManager');
              // Refresh conversations
              projectManager.loadProjectConversations(projectId)
                .finally(() => {
                  browserService.setTimeout(() => {
                    domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
                    domAPI.removeClass(pullIndicator, 'visible');
                    isPulling = false;
                    refreshTriggered = false;
                  }, 1000);
                });
            } else {
              browserService.setTimeout(() => {
                domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
                domAPI.removeClass(pullIndicator, 'visible');
                isPulling = false;
                refreshTriggered = false;
              }, 1000);
            }
          } else {
            // Not pulled far enough, reset
            domAPI.setStyle(pullIndicator, 'transform', 'translateY(-50px)');
            domAPI.removeClass(pullIndicator, 'visible');
          }
          isPulling = false;
          refreshTriggered = false;
        } catch (err) {
          logger.error('[setupPullToRefresh][onTouchEnd]', err, { context: CONTEXT });
        }
      };

      // Track touch events with proper context tagging
      eventHandlers.trackListener(
        conversationsList,
        'touchstart',
        onTouchStart,
        { context: CONTEXT }
      );
      eventHandlers.trackListener(
        conversationsList,
        'touchmove',
        onTouchMove,
        { context: CONTEXT }
      );
      eventHandlers.trackListener(
        conversationsList,
        'touchend',
        onTouchEnd,
        { context: CONTEXT }
      );
    } catch (error) {
      logger.error('[setupPullToRefresh]', error, { context: 'project-details:pull-to-refresh' });
    }
  }

  /**
   * Apply all enhancements
   */
  async function initialize() {
    try {
      // First check if we're on the project details page
      const isProjectDetailsPage = !!domAPI.querySelector('.project-details-root');

      // Or if we're on the project list page
      const isProjectListPage = !!domAPI.getElementById('projectList');

      if (isProjectDetailsPage && !state.initialized) {
        // Wait for DOM to be ready for project details
        await domReadinessService.dependenciesAndElements({
          domSelectors: ['.project-details-root'],
          context: CONTEXT
        });

        // Apply project details enhancements
        addFloatingActionButton();
        enhanceEmptyStates();
        setupTabTracking();

        // Mobile-specific enhancements
        if (browserService && browserService.isMobile) {
          setupPullToRefresh();

          // Improve touch target sizes for mobile
          domAPI.querySelectorAll('.btn, button').forEach(btn => {
            if (!btn.classList.contains('btn-lg') && !btn.classList.contains('project-fab')) {
              btn.style.minHeight = '44px'; // Ensure minimum touch target size
            }
          });
        }

        state.initialized = true;
        logger.debug('[ProjectEnhancements] Project details initialized successfully', { context: CONTEXT });
      }

      if (isProjectListPage && !state.projectListInitialized) {
        // Initialize project list enhancements
        await initializeProjectList();
      }
    } catch (error) {
      logger.error('[initialize]', error, { context: CONTEXT });
    }
  }

  /**
   * Clean up event listeners and references
   */
  function cleanup() {
    eventHandlers.cleanupListeners({ context: CONTEXT });
  }

  // Return public API
  return {
    initialize,
    cleanup
  };
}

// Export the factory function
export { createProjectDetailsEnhancements };

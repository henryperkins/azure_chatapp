/**
 * project-details-enhancements.js
 * Implements enhanced UI features for the project details and project list pages,
 * following the styling in the corresponding CSS files
 */

import { SELECTORS } from "./utils/selectorConstants.js";
import { createPullToRefresh } from "./utils/pullToRefresh.js";
import { getSafeHandler } from './utils/getSafeHandler.js';

export function createProjectDetailsEnhancements({
  domAPI,
  browserService,
  eventHandlers,
  domReadinessService,
  logger,
  sanitizer,
  DependencySystem,
  projectManager = null,
  chatUIEnhancements = null
} = {}) {
  // Validate required dependencies
  if (!domAPI) throw new Error('[createProjectDetailsEnhancements] Missing dependency: domAPI');
  if (!browserService) throw new Error('[createProjectDetailsEnhancements] Missing dependency: browserService');
  if (!eventHandlers) throw new Error('[createProjectDetailsEnhancements] Missing dependency: eventHandlers');
  if (!domReadinessService) throw new Error('[createProjectDetailsEnhancements] Missing dependency: domReadinessService');
  if (!logger) throw new Error('[createProjectDetailsEnhancements] Missing dependency: logger');
  if (!sanitizer) throw new Error('[createProjectDetailsEnhancements] Missing dependency: sanitizer');
  if (!DependencySystem) throw new Error('Missing DependencySystem');

  // ---------------------------------------------------------------------------
  // Resolve optional dependencies ONCE at factory time to avoid later look-ups
  // ---------------------------------------------------------------------------
  if (!projectManager) {
    projectManager = DependencySystem?.modules?.get?.('projectManager') || null;
  }
  if (!chatUIEnhancements) {
    chatUIEnhancements = DependencySystem?.modules?.get?.('chatUIEnhancements') || null;
  }
  // Use canonical safeHandler from DI, normalize for both direct function or object with .safeHandler (early bootstrap)
  const safeHandler = getSafeHandler(DependencySystem);
  if (!safeHandler) throw new Error('safeHandler missing from DependencySystem');

  // State management
  const state = {
    activeTab: 'chat',
    currentFilter: 'all',
    searchTerm: ''
  };

  // Event tracking context
  const CONTEXT = 'projectEnhancements';

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
      // --- Use existing FAB if present, else create it ---
      const FAB_ID = 'projectFab';
      let fabElement = domAPI.getElementById(FAB_ID);          // ← reuse if already in HTML
      if (!fabElement) {                                       // fallback: create only if missing
        fabElement = domAPI.createElement('button');
        fabElement.id = FAB_ID;
        fabElement.className = 'project-fab';
        fabElement.title = 'Quick Actions';
        fabElement.setAttribute('aria-label', 'Quick Actions');
        domAPI.setInnerHTML(
          fabElement,
          sanitizer.sanitize(`<svg xmlns="http://www.w3.org/2000/svg"
                                    class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>`)
        );

        // append to main details container (always present in template)
        const root =
          domAPI.getElementById('projectDetailsContainer') ||
          domAPI.getElementById('projectDetailsView') ||
          domAPI.getBody();
        domAPI.appendChild(root, fabElement);
      }

      // Add click handler only once
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

      // Guard against duplicate wiring
      if (fabElement.dataset.bound !== '1') {
        eventHandlers.trackListener(
          fabElement,
          'click',
          safeHandler(handleFabClick, 'projectFabClick'),
          { context: CONTEXT, description: 'FAB main click' }
        );
        fabElement.dataset.bound = '1';
      }

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
            fabElement.style.transform = 'scale(1)';
          },
          { context: CONTEXT }
        );
      }
    } catch (error) {
      logger.error('[addFloatingActionButton]', error, { context: CONTEXT });
    }
  }

  /**
   * Enhance empty state displays with more visual appeal
   */
  function enhanceEmptyStates() {
    try {
      // Find all empty state elements
      const emptyStates = domAPI.querySelectorAll('.empty-state');

      emptyStates.forEach(emptyState => {
        // Skip if already enhanced
        if (emptyState.classList.contains('enhanced')) return;

        // Create enhanced empty state element
        const enhancedEmptyState = domAPI.createElement('div');
        enhancedEmptyState.className = 'empty-state enhanced';

        // Get parent ID to determine context
        const parentId = emptyState.parentElement?.id || '';
        const message = emptyState.textContent || '';

        // Customize based on context
        let icon = '';
        let title = '';
        let description = '';

        if (parentId.includes('filesList')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>`;
          title = 'No Files Uploaded';
          description = 'Upload files to use in your conversations';
        } else if (parentId.includes('artifactsList')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>`;
          title = 'No Artifacts Generated';
          description = 'Artifacts will appear here when created during conversations';
        } else if (parentId.includes('conversationsList')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>`;
          title = 'No Conversations Yet';
          description = 'Start a new conversation to chat with the AI';
        } else if (parentId.includes('knowledgeResults')) {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>`;
          title = 'Knowledge Search';
          description = 'Search your project knowledge base';
        } else {
          icon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>`;
          title = 'No Content';
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
                chat: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>',
                knowledge: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>',
                details: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>',
                artifacts: '<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>'
              };

              // Update icon based on tab
              if (tabToIconMap[tabId]) {
                domAPI.setInnerHTML(fab, sanitizer.sanitize(tabToIconMap[tabId]));
              }
            }
          }
        };

        // Add click handler to track tab changes
        eventHandlers.trackListener(
          button,
          'click',
          safeHandler(tabHandler, 'tabClick'),
          { context: CONTEXT }
        );

        // Check if this tab is already active
        if (button.classList.contains('active')) {
          const tabId = button.getAttribute('data-tab');
          if (tabId) {
            state.activeTab = tabId;
          }
        }
      });
    } catch (error) {
      logger.error('[setupTabTracking]', error, { context: CONTEXT });
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
            if (tip === 'Pinned') {
              domAPI.setInnerHTML(badge, sanitizer.sanitize(`
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              `));
              badge.classList.add('text-warning');
            } else if (tip === 'Archived') {
              domAPI.setInnerHTML(badge, sanitizer.sanitize(`
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              `));
              badge.classList.add('text-error');
            }
          });
        }

        // Add hover effect for cards
        eventHandlers.trackListener(
          card,
          'mouseenter',
          () => {
            card.classList.add('hover');
          },
          { context: CONTEXT }
        );

        eventHandlers.trackListener(
          card,
          'mouseleave',
          () => {
            card.classList.remove('hover');
          },
          { context: CONTEXT }
        );
      });
    } catch (error) {
      logger.error('[enhanceProjectCards]', error, { context: CONTEXT });
    }
  }


  /**
   * Initialize project list enhancements
   */
  async function initializeProjectList() {
    try {
      // Wait for DOM to be ready for project list
      await domReadinessService.dependenciesAndElements({
        domSelectors: [SELECTORS.projectListContainer],
        context: CONTEXT
      });

      // Apply project list enhancements
      enhanceProjectCards();
      setupProjectFilters();

      logger.info('[initializeProjectList] Project list enhancements initialized', {
        context: CONTEXT
      });
    } catch (error) {
      logger.error('[initializeProjectList]', error, { context: CONTEXT });
    }
  }

  /**
   * Setup project list filtering and search
   */
  function setupProjectFilters() {
    try {
      // Get filter buttons and search input
      const filterButtons = domAPI.querySelectorAll('.project-filter-btn');
      const searchInput = domAPI.getElementById('projectSearchInput');

      // Add click handlers to filter buttons
      filterButtons.forEach(button => {
        const filter = button.dataset.filter || 'all';

        eventHandlers.trackListener(
          button,
          'click',
          safeHandler(() => {
            // Update active filter
            state.currentFilter = filter;

            // Update active button state
            filterButtons.forEach(btn => {
              if (btn.dataset.filter === filter) {
                btn.classList.add('active');
              } else {
                btn.classList.remove('active');
              }
            });

            // Apply filtering
            applyProjectFilters();
          }, 'projectFilterClick'),
          { context: CONTEXT }
        );
      });

      // Add search input handler
      if (searchInput) {
        eventHandlers.trackListener(
          searchInput,
          'input',
          safeHandler(() => {
            state.searchTerm = domAPI.getValue(searchInput).toLowerCase();
            applyProjectFilters();
          }, 'projectSearchInput'),
          { context: CONTEXT }
        );
      }
    } catch (error) {
      logger.error('[setupProjectFilters]', error, { context: CONTEXT });
    }
  }

  /**
   * Apply current filters and search term to project list
   */
  function applyProjectFilters() {
    try {
      const projectCards = domAPI.querySelectorAll('.project-card');
      let visibleCount = 0;

      projectCards.forEach(card => {
        // Get project data from card
        const isPinned = card.dataset.pinned === 'true';
        const isArchived = card.dataset.archived === 'true';
        const projectName = (card.querySelector('.project-name')?.textContent || '').toLowerCase();
        const projectDesc = (card.querySelector('.project-description')?.textContent || '').toLowerCase();

        // Determine if card should be visible based on filter
        let isVisible = true;

        // Apply filter
        switch (state.currentFilter) {
          case 'pinned':
            isVisible = isPinned;
            break;
          case 'archived':
            isVisible = isArchived;
            break;
          case 'active':
            isVisible = !isArchived;
            break;
          case 'all':
          default:
            isVisible = true;
            break;
        }

        // Apply search term if present
        if (state.searchTerm && isVisible) {
          isVisible = projectName.includes(state.searchTerm) ||
            projectDesc.includes(state.searchTerm);
        }

        // Update visibility
        if (isVisible) {
          card.style.display = '';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      // Show/hide empty state
      const emptyState = domAPI.querySelector('.project-list-empty-state');
      if (emptyState) {
        if (visibleCount === 0) {
          emptyState.style.display = '';

          // Update empty state message based on filter/search
          const messageEl = emptyState.querySelector('p');
          if (messageEl) {
            if (state.searchTerm) {
              domAPI.setTextContent(messageEl, `No projects found matching "${state.searchTerm}"`);
            } else {
              switch (state.currentFilter) {
                case 'pinned':
                  domAPI.setTextContent(messageEl, 'No pinned projects');
                  break;
                case 'archived':
                  domAPI.setTextContent(messageEl, 'No archived projects');
                  break;
                case 'active':
                  domAPI.setTextContent(messageEl, 'No active projects');
                  break;
                default:
                  domAPI.setTextContent(messageEl, 'No projects found');
                  break;
              }
            }
          }
        } else {
          emptyState.style.display = 'none';
        }
      }
    } catch (error) {
      logger.error('[applyProjectFilters]', error, { context: CONTEXT });
    }
  }

  /**
   * Initialize project details enhancements
   */
  async function initialize() {
    try {
      // Determine if we're on the project list or project details page
      const isProjectListPage = !!domAPI.querySelector(SELECTORS.projectListContainer);
      const isProjectDetailsPage = !!domAPI.querySelector('.project-details-root');

      // Initialize appropriate enhancements
      if (isProjectListPage) {
        await initializeProjectList();
      }

      if (isProjectDetailsPage) {
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
          createPullToRefresh({
            element        : domAPI.getElementById('conversationsList'),
            onRefresh      : () => {
              return projectManager?.loadProjectConversations?.(state.currentProjectId);
            },
            eventHandlers, domAPI, browserService,
            ctx            : 'project-details:pull-to-refresh'
          });

          // Improve touch target sizes for mobile
          domAPI.querySelectorAll('.btn, button').forEach(btn => {
            if (!btn.classList.contains('btn-lg') && !btn.classList.contains('project-fab')) {
              btn.style.minHeight = '44px'; // Ensure minimum touch target size
            }
          });
        }

        logger.info('[initialize] Project details enhancements initialized', {
          context: CONTEXT
        });
      }
    } catch (error) {
      logger.error('[initialize]', error, { context: CONTEXT });
    }
  }

  /**
   * Clean up event listeners and resources
   */
  function cleanup() {
    try {
      // Clean up all event listeners
      eventHandlers.cleanupListeners({ context: CONTEXT });

      logger.info('[cleanup] Project details enhancements cleaned up', {
        context: CONTEXT
      });
    } catch (error) {
      logger.error('[cleanup]', error, { context: CONTEXT });
    }
  }

  /**
   * Add chat UI enhancements to the project chat tab
   * @param {HTMLElement} chatContainer - The container element for the chat UI
   */
  function setupProjectChatUI(chatContainer) {
    try {
      if (!chatContainer) return;

      // Find the chat UI container in the project details
      const chatUIContainer = domAPI.getElementById('chatUIContainer');
      if (!chatUIContainer) return;

      // Check if we have a chatUIEnhancements module available
      if (!chatUIEnhancements) {
        logger.warn('[setupProjectChatUI] chatUIEnhancements module not available', {
          context: CONTEXT
        });
        return;
      }

      // Set the message container for the chat UI
      if (typeof chatUIEnhancements.setMessageContainer === 'function') {
        const messagesContainer = domAPI.querySelector('#chatUIContainer #chatMessages');
        if (messagesContainer) {
          chatUIEnhancements.setMessageContainer(messagesContainer);

          logger.info('[setupProjectChatUI] Set message container for chat UI', {
            context: CONTEXT
          });
        }
      }

      // Setup project-specific chat enhancements
      if (typeof chatUIEnhancements.setupProjectChatEnhancements === 'function') {
        chatUIEnhancements.setupProjectChatEnhancements();

        logger.info('[setupProjectChatUI] Setup project chat enhancements', {
          context: CONTEXT
        });
      }
    } catch (error) {
      logger.error('[setupProjectChatUI]', error, { context: CONTEXT });
    }
  }

  /**
   * Enhance project stats with visual elements
   */
  function enhanceProjectStats() {
    try {
      // Find all stat elements
      const statElements = domAPI.querySelectorAll('.stat');
      if (statElements.length === 0) return;

      statElements.forEach(statEl => {
        // Skip if already enhanced
        if (statEl.classList.contains('enhanced')) return;

        // Get stat value and title
        const valueEl = statEl.querySelector('.stat-value');
        const titleEl = statEl.querySelector('.stat-title');

        if (!valueEl || !titleEl) return;

        const value = valueEl.textContent.trim();
        const title = titleEl.textContent.trim().toLowerCase();

        // Create sparkline container
        const sparklineContainer = domAPI.createElement('div');
        sparklineContainer.className = 'sparkline';

        // Generate appropriate sparkline based on stat type
        let sparklineHTML = '';
        let lastValue = 0;

        if (title.includes('completion') || title.includes('progress')) {
          // For completion/progress stats, use the percentage value
          const percentMatch = value.match(/(\d+)%/);
          if (percentMatch) {
            lastValue = parseInt(percentMatch[1], 10);
            sparklineHTML = generateSparkline(7, lastValue);
          }
        } else if (title.includes('files') || title.includes('artifacts')) {
          // For count stats, use a random trend
          const countMatch = value.match(/(\d+)/);
          if (countMatch) {
            lastValue = parseInt(countMatch[1], 10);
            sparklineHTML = generateSparkline(7, Math.min(lastValue * 10, 100));
          }
        } else if (title.includes('conversations')) {
          // For conversation stats, use a random trend
          const countMatch = value.match(/(\d+)/);
          if (countMatch) {
            lastValue = parseInt(countMatch[1], 10);
            sparklineHTML = generateSparkline(7, Math.min(lastValue * 5, 100));
          }
        }

        // Add sparkline if generated
        if (sparklineHTML) {
          domAPI.setInnerHTML(sparklineContainer, sanitizer.sanitize(sparklineHTML));
          domAPI.appendChild(statEl, sparklineContainer);
          statEl.classList.add('enhanced');
        }
      });
    } catch (error) {
      logger.error('[enhanceProjectStats]', error, { context: CONTEXT });
    }
  }

  // Return public API
  return {
    initialize,
    cleanup,
    enhanceProjectCards,
    setupProjectFilters,
    enhanceEmptyStates,
    setupProjectChatUI,
    enhanceProjectStats
  };
}

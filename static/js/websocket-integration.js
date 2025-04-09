/**
 * WebSocket Fix Integration Script
 * This script automatically loads the WebSocket fixes when included in the main application
 */

(function() {
  console.log("[WebSocketIntegration] Initializing WebSocket fix integration");
  
  // Function to load the WebSocket fix script
  function loadWebSocketFix() {
    return new Promise((resolve, reject) => {
      try {
        console.log("[WebSocketIntegration] Loading WebSocket fix script");
        
        // Check if already loaded
        if (document.querySelector('script[src="/static/js/websocket-fix.js"]')) {
          console.log("[WebSocketIntegration] WebSocket fix already loaded");
          resolve(true);
          return;
        }
        
        // Create and append the script element
        const script = document.createElement('script');
        script.src = '/static/js/websocket-fix.js';
        
        // Setup event handlers
        script.onload = () => {
          console.log("[WebSocketIntegration] WebSocket fix loaded successfully");
          resolve(true);
        };
        
        script.onerror = (error) => {
          console.error("[WebSocketIntegration] Failed to load WebSocket fix:", error);
          reject(error);
        };
        
        // Add to document head
        document.head.appendChild(script);
      } catch (error) {
        console.error("[WebSocketIntegration] Error in WebSocket fix integration:", error);
        reject(error);
      }
    });
  }
  
  // Load WebSocket fix script after the page is fully loaded
  if (document.readyState === "complete") {
    loadWebSocketFix();
  } else {
    window.addEventListener('load', () => loadWebSocketFix());
  }
  
  // Optional: re-load fix script if WebSocket connection errors are detected
  window.addEventListener('error', function(event) {
    // Check if error is WebSocket-related
    if (event.message && (
        event.message.includes('WebSocket') || 
        event.message.includes('ws://') || 
        event.message.includes('wss://')
    )) {
      console.warn("[WebSocketIntegration] WebSocket error detected, ensuring fix is loaded");
      loadWebSocketFix().catch(() => {
        console.error("[WebSocketIntegration] Could not load fix script after error");
      });
    }
  }, true);
  
  // Create a diagnostic endpoint for WebSocket issues
  window.fixWebSocketConnections = async function() {
    try {
      await loadWebSocketFix();
      console.log("[WebSocketIntegration] WebSocket fixes applied. Reconnecting active services...");
      
      // Attempt to reconnect any active WebSocket services
      if (window.WebSocketService) {
        if (typeof window.WebSocketService.disconnectAll === 'function') {
          window.WebSocketService.disconnectAll();
        }
        
        // If chatInterface exists, attempt to reconnect
        if (window.chatInterface) {
          console.log("[WebSocketIntegration] Reconnecting chat interface...");
          const currentChatId = window.chatInterface.currentChatId;
          
          if (currentChatId) {
            window.chatInterface.establishWebSocketConnection(currentChatId)
              .then((success) => {
                console.log("[WebSocketIntegration] Chat reconnection result:", success ? "Connected" : "Failed");
              })
              .catch(error => {
                console.error("[WebSocketIntegration] Error during chat reconnection:", error);
              });
          }
        }
        
        return {
          success: true,
          message: "WebSocket fixes applied and reconnection attempted"
        };
      } else {
        return {
          success: false,
          message: "WebSocketService not found, fixes applied but could not reconnect"
        };
      }
    } catch (error) {
      console.error("[WebSocketIntegration] Error fixing WebSocket connections:", error);
      return {
        success: false,
        error: error.message || String(error),
        message: "Failed to apply WebSocket fixes"
      };
    }
  };
  
  // Fix for browser extension resource loading errors
  if (window.chrome && chrome.runtime) {
    console.log("[WebSocketIntegration] Applying browser extension resource fixes");
    
    // Fix for FrameDoesNotExistError in background.js
    const originalConnect = chrome.runtime.connect;
    if (originalConnect && typeof originalConnect === 'function') {
      chrome.runtime.connect = function(...args) {
        try {
          const port = originalConnect.apply(chrome.runtime, args);
          return port;
        } catch (error) {
          console.warn("[WebSocketIntegration] Frame connection error:", error);
          
          // Return dummy port object if connection fails to prevent crashes
          if (error.message?.includes('Frame') || error.message?.includes('does not exist')) {
            console.log("[WebSocketIntegration] Providing recovery port for frame error");
            return {
              postMessage: () => {},
              disconnect: () => {},
              onMessage: { addListener: () => {} },
              onDisconnect: { addListener: () => {} }
            };
          }
          throw error;
        }
      };
      console.log("[WebSocketIntegration] Frame connection error handling applied");
    }
  }

  console.log("[WebSocketIntegration] Integration script completed");
})();

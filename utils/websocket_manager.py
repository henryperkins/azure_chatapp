"""
websocket_manager.py
-------------------
Manages WebSocket connections for real-time chat functionality.
Handles connection state, message broadcasting, and connection cleanup.
"""
import logging
import json
from typing import Dict, List, Any, Optional
from fastapi import WebSocket, status

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages active WebSocket connections and message broadcasting."""
    
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance.__init__()
        return cls._instance
        
    def __init__(self):
        if hasattr(self, 'active_connections'):  # Prevent re-initialization
            return
        # Map of conversation_id -> list of active WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Track user IDs for each connection
        self.connection_users: Dict[WebSocket, str] = {}
        # Count of total active connections
        self.connection_count = 0

    async def connect(self, websocket: WebSocket, conversation_id: str, user_id: str) -> bool:
        """
        Accept connection and register it.
        
        Args:
            websocket: The WebSocket connection
            conversation_id: The ID of the conversation
            user_id: The ID of the user
            
        Returns:
            True if connection was successful, False otherwise
        """
        try:
            # Accept the WebSocket connection
            await websocket.accept()
            
            # Initialize conversation list if needed
            if conversation_id not in self.active_connections:
                self.active_connections[conversation_id] = []
                
            # Add the connection to the list
            self.active_connections[conversation_id].append(websocket)
            self.connection_users[websocket] = user_id
            self.connection_count += 1
            
            logger.info(f"WebSocket connected for conversation {conversation_id}, user {user_id}. Total connections: {self.connection_count}")
            return True
        except Exception as e:
            logger.error(f"Error connecting WebSocket: {str(e)}")
            try:
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            except Exception:
                pass
            return False

    async def disconnect(self, websocket: WebSocket) -> None:
        """Improved disconnect with state checks and error filtering"""
        try:
            conversation_id = None
            user_id = None
            
            # Find and remove from active connections
            for cid, connections in self.active_connections.items():
                if websocket in connections:
                    conversation_id = cid
                    connections.remove(websocket)
                    if not connections:
                        del self.active_connections[cid]
                    break

            # Remove user tracking
            if websocket in self.connection_users:
                user_id = self.connection_users[websocket]
                del self.connection_users[websocket]
                self.connection_count = max(0, self.connection_count - 1)

            # Check connection states before closing
            if not self._is_connection_closed(websocket):
                try:
                    await websocket.close()
                except RuntimeError as e:
                    if "Unexpected ASGI message" not in str(e):
                        logger.warning(f"WebSocket close error: {str(e)}")
                except Exception as e:
                    logger.debug(f"Non-critical close error: {str(e)}")

            logger.info(
                f"WebSocket cleanup completed for {f'conversation {conversation_id}, ' if conversation_id else ''}"
                f"user {user_id or 'unknown'}. Remaining connections: {self.connection_count}"
            )

        except Exception as e:
            logger.warning(f"Error during WebSocket disconnect: {str(e)}")

    def _is_connection_closed(self, websocket: WebSocket) -> bool:
        """Check if connection is in a closed/closing state"""
        return (
            websocket.client_state == websocket.client_state.DISCONNECTED
            or websocket.application_state == websocket.application_state.DISCONNECTED
        )
            
    async def broadcast(self, message: Any, conversation_id: str) -> None:
        """
        Send message to all connected clients for a specific conversation.
        
        Args:
            message: The message to send (will be JSON-encoded)
            conversation_id: The conversation ID to broadcast to
        """
        if conversation_id not in self.active_connections:
            return
            
        disconnected = []
        message_json = json.dumps(message) if not isinstance(message, str) else message
        
        for connection in self.active_connections[conversation_id]:
            try:
                await connection.send_text(message_json)
            except Exception as e:
                logger.warning(f"Error sending message to WebSocket: {str(e)}")
                disconnected.append(connection)
        
        # Clean up any disconnected WebSockets
        for connection in disconnected:
            await self.disconnect(connection)
            
    async def send_personal_message(self, message: Any, websocket: WebSocket) -> None:
        """
        Send message to a specific connection.
        
        Args:
            message: The message to send (will be JSON-encoded if not a string)
            websocket: The WebSocket to send to
        """
        try:
            message_json = json.dumps(message) if not isinstance(message, str) else message
            await websocket.send_text(message_json)
        except Exception as e:
            logger.warning(f"Error sending message to WebSocket: {str(e)}")
            await self.disconnect(websocket)
    
    def get_connections_for_conversation(self, conversation_id: str) -> List[WebSocket]:
        """
        Get all WebSocket connections for a specific conversation.
        
        Args:
            conversation_id: The conversation ID
            
        Returns:
            List of WebSocket connections
        """
        return self.active_connections.get(conversation_id, [])
        
    def get_connection_count(self, conversation_id: Optional[str] = None) -> int:
        """
        Get count of connections, either total or for a specific conversation.
        
        Args:
            conversation_id: Optional conversation ID to filter by
            
        Returns:
            Number of connections
        """
        if conversation_id:
            return len(self.active_connections.get(conversation_id, []))
        return self.connection_count

"""
websocket_manager.py
-------------------
Manages WebSocket connections for real-time chat functionality.
Handles connection state, message broadcasting, and connection cleanup.
"""
import logging
import json
from typing import Dict, Set, Any, Optional
from collections import defaultdict
from fastapi import WebSocket, status, WebSocketException
from sqlalchemy.ext.asyncio import AsyncSession
from utils.auth_utils import authenticate_websocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages WebSocket connections with state tracking and conversation context."""
    
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._instance.__init__()
        return cls._instance
        
    def __init__(self):
        if hasattr(self, '_connections'):
            return
            
        # Track all active connections with metadata
        self._connections: Dict[str, dict] = {}  # connection_id -> {websocket, conversation_id, user_id, state}
        
        # Indexes for faster lookups
        self._by_conversation: Dict[str, Set[str]] = defaultdict(set)
        self._by_user: Dict[str, Set[str]] = defaultdict(set)
        
        # Connection states
        self.CONNECTING = 'connecting'
        self.CONNECTED = 'connected'
        self.DISCONNECTED = 'disconnected'

    @property
    def connection_count(self) -> int:
        """Return number of active connections."""
        return len(self._connections)

    async def connect_with_state(
        self,
        websocket: WebSocket,
        conversation_id: str,
        db: AsyncSession,
        user_id: Optional[str] = None,
        state: Optional[str] = None
    ) -> str:
        """
        Connect WebSocket with proper authentication and state tracking.
        
        Args:
            websocket: The WebSocket connection
            conversation_id: The conversation ID
            db: Database session for authentication
            
        Returns:
            connection_id: The unique connection ID
            
        Raises:
            WebSocketException: If authentication fails with proper error codes
        """
        try:
            # Authenticate first using auth_utils
            success, user = await authenticate_websocket(websocket, db)
            if not success or not user:
                logger.error("WebSocket authentication failed")
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                raise WebSocketException(
                    code=status.WS_1008_POLICY_VIOLATION,
                    reason="Authentication failed"
                )
                
            connection_id = str(id(websocket))
            
            self._connections[connection_id] = {
                'websocket': websocket,
                'conversation_id': conversation_id,
                'user_id': user_id or (user.id if user else None),
                'state': state or self.CONNECTED
            }
            
            self._by_conversation[conversation_id].add(connection_id)
            self._by_user[str(user.id)].add(connection_id)
            
            logger.info(f"WebSocket connected for user {user.id}, conversation {conversation_id}")
            return connection_id
            
        except Exception as e:
            logger.error(f"WebSocket connection error: {str(e)}")
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            raise WebSocketException(
                code=status.WS_1011_INTERNAL_ERROR,
                reason=str(e)
            )

    async def update_connection_state(self, connection_id: str, new_state: str) -> None:
        """
        Update the state of an existing connection.
        
        Args:
            connection_id: The connection ID to update
            new_state: The new state to set
        """
        if connection_id in self._connections:
            self._connections[connection_id]['state'] = new_state
            logger.debug(f"Updated connection {connection_id} to state {new_state}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """
        Disconnect and clean up WebSocket connection.
        
        Args:
            websocket: The WebSocket to disconnect
        """
        connection_id = str(id(websocket))
        if connection_id not in self._connections:
            return
            
        connection = self._connections[connection_id]
        conversation_id = connection['conversation_id']
        user_id = connection['user_id']
        
        try:
            # Clean up indexes
            self._by_conversation[conversation_id].discard(connection_id)
            self._by_user[user_id].discard(connection_id)
            
            # Remove connection
            del self._connections[connection_id]
            
            # Close WebSocket if still connected
            if not self._is_connection_closed(websocket):
                try:
                    await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                except RuntimeError as e:
                    if "Unexpected ASGI message" not in str(e):
                        logger.warning(f"WebSocket close error: {str(e)}")
                except Exception as e:
                    logger.debug(f"Non-critical close error: {str(e)}")

            logger.info(
                f"WebSocket cleanup completed for conversation {conversation_id}, "
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
        if conversation_id not in self._by_conversation:
            return
            
        disconnected = []
        message_json = json.dumps(message) if not isinstance(message, str) else message
        
        for connection_id in self._by_conversation[conversation_id]:
            connection = self._connections[connection_id]
            try:
                await connection['websocket'].send_text(message_json)
            except Exception as e:
                logger.warning(f"Error sending message to WebSocket: {str(e)}")
                disconnected.append(connection['websocket'])
        
        # Clean up any disconnected WebSockets
        for websocket in disconnected:
            await self.disconnect(websocket)
            
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
            logger.warning(f"Error sending personal message: {str(e)}")
            await self.disconnect(websocket)

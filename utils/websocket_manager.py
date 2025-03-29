"""
websocket_manager.py
-------------------
Manages WebSocket connections for real-time chat functionality.
Handles connection state, message broadcasting, and connection cleanup.
"""
import logging
from fastapi import WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

class ConnectionManager:
    """Manages active WebSocket connections and message broadcasting."""
    
    def __init__(self):
        self.active_connections: dict[WebSocket, str] = {}  # Store WS and conversation ID
        self.ws_connection_active = False  # Track connection state

    async def connect(self, websocket: WebSocket) -> bool:
        """Accept connection and register it if slots are available."""
        if self.ws_connection_active:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return False
            
        await websocket.accept()
        self.ws_connection_active = True
        return True

    async def disconnect(self, websocket: WebSocket) -> None:
        """Unregister a connection and close it."""
        try:
            del self.active_connections[websocket]
            self.ws_connection_active = False
            await websocket.close()
        except KeyError:
            pass
            
    async def send_personal_message(self, message: str, websocket: WebSocket) -> None:
        """Send message to a specific connection."""
        try:
            await websocket.send_text(message)
        except RuntimeError as e:
            logger.warning(f"Error sending message to WebSocket: {str(e)}")
            await self.disconnect(websocket)

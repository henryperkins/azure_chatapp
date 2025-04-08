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
from fastapi import WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections with state tracking and conversation context."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ConnectionManager, cls).__new__(cls)
            cls._instance.active_connections = {}
            cls._instance.connection_state = {}
            cls._instance.conversation_participants = defaultdict(set)
            cls._instance.user_connections = defaultdict(set)
        return cls._instance

    def __init__(self):
        # Initialize only once - singleton pattern
        if not hasattr(self, 'active_connections'):
            self.active_connections = {}  # WebSocket instances by ID
            self.connection_state = {}  # State tracking for each connection
            self.conversation_participants = defaultdict(set)  # Conversation ID -> set of WebSocket IDs
            self.user_connections = defaultdict(set)  # User ID -> set of WebSocket IDs

    @property
    def connected_count(self) -> int:
        """Return the number of active connections"""
        return len(self.active_connections)

    async def connect_with_state(
        self, websocket: WebSocket, conversation_id: str, db: AsyncSession, user_id: Optional[str] = None
    ):
        """
        Register a new WebSocket connection with associated conversation and user IDs.
        Handles authentication state and session validation.
        """
        # Generate a unique connection ID
        connection_id = f"{user_id}_{conversation_id}_{id(websocket)}"
        
        # Store connection and its metadata
        self.active_connections[connection_id] = websocket
        self.connection_state[connection_id] = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "connected_at": None,  # Will be set after successful connect
            "db_session": db,
            "authenticated": user_id is not None
        }
        
        # Add to conversation and user mappings
        self.conversation_participants[conversation_id].add(connection_id)
        if user_id:
            self.user_connections[user_id].add(connection_id)
        
        logger.info(
            f"WebSocket connected: user={user_id}, conversation={conversation_id}, "
            f"total_connections={self.connected_count}"
        )
        return connection_id

    async def disconnect(self, websocket: WebSocket):
        """Remove a disconnected WebSocket and clean up all references"""
        # Find connection ID for this websocket
        connection_id = None
        for conn_id, ws in self.active_connections.items():
            if ws == websocket:
                connection_id = conn_id
                break
        
        if not connection_id:
            logger.warning("Attempted to disconnect unknown WebSocket")
            return
        
        # Get state before removal
        state = self.connection_state.get(connection_id, {})
        conversation_id = state.get("conversation_id")
        user_id = state.get("user_id")
        
        # Remove from all collections
        self.active_connections.pop(connection_id, None)
        self.connection_state.pop(connection_id, None)
        
        if conversation_id:
            self.conversation_participants[conversation_id].discard(connection_id)
            # Clean up empty conversation mappings
            if not self.conversation_participants[conversation_id]:
                self.conversation_participants.pop(conversation_id, None)
        
        if user_id:
            self.user_connections[user_id].discard(connection_id)
            # Clean up empty user mappings
            if not self.user_connections[user_id]:
                self.user_connections.pop(user_id, None)
        
        logger.info(
            f"WebSocket disconnected: user={user_id}, conversation={conversation_id}, "
            f"remaining={self.connected_count}"
        )

    async def send_personal_message(self, message: Any, websocket: WebSocket):
        """Send a message to a specific WebSocket connection"""
        if not isinstance(message, str):
            message = json.dumps(message)
        await websocket.send_text(message)

    async def broadcast_to_conversation(self, conversation_id: str, message: Any):
        """Broadcast a message to all connections in a specific conversation"""
        if not isinstance(message, str):
            message = json.dumps(message)
        
        # Get all connection IDs for this conversation
        connection_ids = self.conversation_participants.get(conversation_id, set())
        
        # Send message to each participant
        disconnected = []
        for conn_id in connection_ids:
            websocket = self.active_connections.get(conn_id)
            if websocket:
                try:
                    await websocket.send_text(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to {conn_id}: {str(e)}")
                    disconnected.append(conn_id)
        
        # Clean up any connections that failed during broadcast
        for conn_id in disconnected:
            websocket = self.active_connections.get(conn_id)
            if websocket:
                await self.disconnect(websocket)

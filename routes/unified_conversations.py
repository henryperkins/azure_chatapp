"""
unified_conversations.py
------------------------
Conversation management routes featuring:
- Full Sentry error monitoring
- Performance tracing
- AI-specific monitoring
- Distributed tracing support
"""

import logging
import random
import time
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select  # Add this import
from sqlalchemy.orm import selectinload  # Add this import
from models.project import Project  # ADDED
from sentry_sdk import (
    capture_exception,
    configure_scope,
    start_transaction,
    metrics,
    capture_message,
)

from db import get_async_session
from services.conversation_service import ConversationService, get_conversation_service
from services.token_service import estimate_input_tokens
from utils.auth_utils import get_current_user_and_token
from utils.sentry_utils import sentry_span_context, make_sentry_trace_response
from services.project_service import validate_project_access
from utils.serializers import serialize_conversation

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Project Conversations"])

# Sentry configuration
CONVERSATION_SAMPLE_RATE = 1.0  # Sample all conversations
AI_SAMPLE_RATE = 0.5  # Sample 50% of AI operations

# =============================================================================
# Pydantic Models
# =============================================================================


class ConversationCreate(BaseModel):
    """Model for creating a new conversation"""

    title: str = Field(..., min_length=1, max_length=100)
    model_id: str = Field("claude-3-sonnet-20240229")
    model_params: Optional[dict] = Field(
        default_factory=dict, alias="model_config"
    )  # ← NEW
    kb_enabled: Optional[bool] = False
    sentry_trace: Optional[str] = Field(None, description="Frontend trace ID")

    model_config = {"populate_by_name": True, "extra": "allow"}  # keep aliases working


class ConversationUpdate(BaseModel):
    """Model for updating a conversation"""

    title: Optional[str] = Field(None, min_length=1, max_length=100)
    model_id: Optional[str] = None
    model_params: Optional[dict] = Field(
        default_factory=dict, alias="model_config"
    )  # ← NEW
    kb_enabled: Optional[bool] = False
    sentry_trace: Optional[str] = Field(None, description="Frontend trace ID")

    model_config = {"populate_by_name": True, "extra": "allow"}


class MessageCreate(BaseModel):
    """Model for creating a message"""

    raw_text: str = Field(..., description="Markdown/plain text")
    role: str = Field("user", description="'user' or 'assistant'")
    image_data: Optional[str] = Field(None, description="Base64 image data")
    vision_detail: str = Field("auto", description="'low', 'high', or 'auto'")
    enable_thinking: bool = Field(False)
    thinking_budget: Optional[int] = Field(None, ge=1024, le=32000)
    reasoning_effort: Optional[str] = Field(None, description="'low', 'medium', 'high'")
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(None, ge=100, le=32000)
    enable_web_search: Optional[bool] = Field(False)
    sentry_trace: Optional[str] = Field(None, description="Frontend trace ID")


class BatchConversationIds(BaseModel):
    """Model for batch operations"""

    conversation_ids: List[UUID] = Field(...)


# =============================================================================
# Conversation CRUD with Monitoring
# =============================================================================


@router.get("/{project_id}/conversations", response_model=dict)
async def list_project_conversations(
    project_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """List all conversations for a project with full monitoring"""
    with sentry_span_context(
        op="conversation",
        description=f"List Project Conversations: List all conversations for project {project_id}",
    ) as span:
        try:
            current_user = current_user_tuple[0]
            span.set_tag("project.id", str(project_id))
            span.set_tag("user.id", str(current_user.id))
            span.set_data("pagination.skip", skip)
            span.set_data("pagination.limit", limit)

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get conversations
            start_time = time.time()
            conversations = await conv_service.list_conversations(
                user_id=current_user.id, project_id=project_id, skip=skip, limit=limit
            )
            duration = (time.time() - start_time) * 1000

            span.set_data("db_query_time_ms", duration)
            metrics.distribution(
                "conversation.list.duration", duration, unit="millisecond"
            )

            payload = {
                "status": "success",
                "conversations": [
                    {
                        **serialize_conversation(conv),
                        "project_id": str(getattr(conv, "project_id", "")),
                        "user_id": str(getattr(conv, "user_id", "")),
                    }
                    for conv in conversations
                ],
                "count": len(conversations),
            }
            return make_sentry_trace_response(payload, span)
        except HTTPException:
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("conversation.list.failure")
            logger.error(f"Failed to list conversations: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to retrieve conversations"
            ) from e


@router.post("/{project_id}/conversations", response_model=dict)
async def create_conversation(
    project_id: UUID,
    conversation_data: ConversationCreate,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Create conversation with full tracing"""
    transaction = start_transaction(
        op="conversation",
        name="Create Conversation",
        sampled=random.random() < CONVERSATION_SAMPLE_RATE,
    )

    try:
        with transaction:
            current_user = current_user_tuple[0]
            # Set context from frontend trace if available
            if conversation_data.sentry_trace:
                transaction.set_data("frontend_trace", conversation_data.sentry_trace)

            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_tag("model.id", conversation_data.model_id)

            # Validate project access
            with sentry_span_context(op="access.check", description="Validate project access"):
                await validate_project_access(project_id, current_user, db)

            # Fetch Project and eagerly load its knowledge_base
            stmt = (
                select(Project)
                .options(selectinload(Project.knowledge_base))
                .where(Project.id == project_id)
            )
            result = await db.execute(stmt)
            project = result.scalar_one_or_none()
            if not project:
                transaction.set_tag("error.type", "project_retrieval")
                metrics.incr(
                    "conversation.create.failure",
                    tags={"reason": "project_not_found_post_validation"},
                )
                logger.error(f"Project {project_id} not found after access validation.")
                raise HTTPException(
                    status_code=404,
                    detail="Project not found despite access validation.",
                )

            # Knowledge Base Validation
            if not project.knowledge_base:
                transaction.set_tag("error.type", "validation")
                metrics.incr(
                    "conversation.create.failure", tags={"reason": "kb_missing"}
                )
                raise HTTPException(
                    status_code=400, detail="Project has no knowledge base"
                )
            # Create conversation
            with sentry_span_context(op="db.create", description="Create conversation record"):
                from sqlalchemy.exc import IntegrityError

                try:
                    conv = await conv_service.create_conversation(
                        user_id=current_user.id,
                        title=conversation_data.title,
                        model_id=conversation_data.model_id,
                        project_id=project_id,
                        model_config=conversation_data.model_params,  # ← CHANGED
                        kb_enabled=conversation_data.kb_enabled or False,
                    )
                    transaction.set_tag("conversation.id", str(conv.id))
                except IntegrityError as db_exc:
                    logger.exception(
                        f"[create_conversation route] Database error with project_id={project_id}, user_id={current_user.id}"
                    )
                    metrics.incr(
                        "conversation.create.failure",
                        tags={"reason": "db_integrity_error"},
                    )
                    raise HTTPException(
                        status_code=500,
                        detail="Database error. Possibly a foreign key violation or concurrency issue.",
                    ) from db_exc

            # Set user context
            with configure_scope() as scope:
                scope.set_context(
                    "conversation",
                    {
                        "id": str(conv.id),
                        "title": conv.title,
                        "model": conversation_data.model_id,
                    },
                )
                scope.user = {
                    "id": str(current_user.id),
                    "username": current_user.username,
                }

            # Track metrics
            metrics.incr(
                "conversation.created",
                tags={
                    "model": conversation_data.model_id,
                    "project_id": str(project_id),
                },
            )

            logger.info(f"Created conversation {conv.id} in project {project_id}")
            payload = {
                "status": "success",
                "conversation": {
                    **serialize_conversation(conv),
                    "project_id": str(getattr(conv, "project_id", "")),
                    "user_id": str(getattr(conv, "user_id", "")),
                },
            }
            return make_sentry_trace_response(payload, transaction)

    except HTTPException as http_exc:
        transaction.set_tag("error.type", "http")
        transaction.set_data("status_code", http_exc.status_code)
        metrics.incr(
            "conversation.create.failure",
            tags={"reason": "http_error", "status_code": http_exc.status_code},
        )
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("conversation.create.failure", tags={"reason": "exception"})
        logger.error(f"Conversation creation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to create conversation"
        ) from e


@router.get("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def get_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Get conversation with performance tracing"""
    with sentry_span_context(
        op="conversation",
        description=f"Get Conversation: Get conversation {conversation_id}",
    ) as span:
        try:
            current_user = current_user_tuple[0]
            span.set_tag("project.id", str(project_id))
            span.set_tag("conversation.id", str(conversation_id))
            span.set_tag("user.id", str(current_user.id))

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get conversation
            conv_data = await conv_service.get_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )

            metrics.incr("conversation.viewed")
            payload = {
                "status": "success",
                "conversation": {
                    **conv_data,
                    "project_id": str(project_id),
                    # user_id usually in conv_data already
                },
            }
            return make_sentry_trace_response(payload, span)

        except HTTPException:
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("conversation.view.failure")
            logger.error(f"Failed to get conversation: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to retrieve conversation"
            ) from e


@router.patch("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def update_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    update_data: ConversationUpdate,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Update conversation with change tracking"""
    transaction = start_transaction(
        op="conversation",
        name="Update Conversation",
        sampled=random.random() < CONVERSATION_SAMPLE_RATE,
    )

    try:
        with transaction:
            current_user = current_user_tuple[0]
            if update_data.sentry_trace:
                transaction.set_data("frontend_trace", update_data.sentry_trace)

            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("conversation.id", str(conversation_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Validate access
            with sentry_span_context(op="access.check", description="Validate project access"):
                await validate_project_access(project_id, current_user, db)

            # Track changes
            changes = {}
            if update_data.title:
                changes["title"] = update_data.title
            if update_data.model_id:
                changes["model_id"] = update_data.model_id
            transaction.set_data("changes", changes)

            # Update conversation
            conv_dict = await conv_service.update_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
                title=update_data.title,
                model_id=update_data.model_id,
                model_config=update_data.model_params,  # ← CHANGED
                kb_enabled=update_data.kb_enabled,
            )

            # Record metrics
            if changes:
                metrics.incr(
                    "conversation.updated", tags={"fields_updated": len(changes)}
                )
                capture_message(
                    "Conversation updated",
                    level="info",
                    data={"conversation_id": str(conversation_id), "changes": changes},
                )

            logger.info(f"Updated conversation {conversation_id}")
            payload = {"status": "success", "conversation": conv_dict}
            return make_sentry_trace_response(payload, transaction)

    except HTTPException as http_exc:
        transaction.set_tag("error.type", "http")
        transaction.set_data("status_code", http_exc.status_code)
        metrics.incr(
            "conversation.update.failure",
            tags={"reason": "http_error", "status_code": http_exc.status_code},
        )
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("conversation.update.failure", tags={"reason": "exception"})
        logger.error(f"Conversation update failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to update conversation"
        ) from e


@router.delete("/{project_id}/conversations/{conversation_id}", response_model=dict)
async def delete_project_conversation(
    project_id: UUID,
    conversation_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Delete conversation with resource tracking"""
    transaction = start_transaction(
        op="conversation",
        name="Delete Conversation",
        sampled=random.random() < CONVERSATION_SAMPLE_RATE,
    )

    try:
        with transaction:
            current_user = current_user_tuple[0]
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("conversation.id", str(conversation_id))
            transaction.set_tag("user.id", str(current_user.id))

            # Delete conversation
            deleted_id = await conv_service.delete_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )

            # Record metrics
            metrics.incr("conversation.deleted")
            capture_message(
                "Conversation deleted",
                level="info",
                data={"conversation_id": str(conversation_id)},
            )

            logger.info(f"Deleted conversation {conversation_id}")
            payload = {"status": "success", "conversation_id": str(deleted_id)}
            return make_sentry_trace_response(payload, transaction)

    except HTTPException:
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("conversation.delete.failure")
        logger.error(f"Failed to delete conversation: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Failed to delete conversation"
        ) from e


# =============================================================================
# Message Operations with AI Monitoring
# =============================================================================


@router.post(
    "/{project_id}/conversations/{conversation_id}/messages",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_conversation_message(
    project_id: UUID,
    conversation_id: UUID,
    payload: dict = Body(...),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    conv_service: ConversationService = Depends(get_conversation_service),
    db: AsyncSession = Depends(get_async_session),
):
    """Process message with AI response tracing"""
    transaction = start_transaction(
        op="conversation",
        name="Process Message",
        sampled=random.random() < AI_SAMPLE_RATE,
    )

    try:
        with transaction:
            # ---- Extract/validate message payload (supports wrapper or flat) ----
            msg_dict = payload.get("new_msg") or payload

            # Merge top-level overrides into msg_dict before instantiation
            override_fields = (
                "vision_detail",
                "enable_web_search",
                "enable_thinking",
                "thinking_budget",
                "reasoning_effort",
                "temperature",
                "max_tokens",
            )
            merged_dict = dict(msg_dict)
            for fld in override_fields:
                if fld in payload:
                    merged_dict[fld] = payload[fld]

            # Defensive: Replace any FieldInfo values with their default or a safe fallback
            from pydantic.fields import FieldInfo

            for k, v in merged_dict.items():
                if isinstance(v, FieldInfo):
                    # Use default if available, else sensible fallback
                    merged_dict[k] = (
                        v.default
                        if v.default is not None
                        else (
                            ""
                            if k
                            in [
                                "raw_text",
                                "role",
                                "vision_detail",
                                "reasoning_effort",
                                "sentry_trace",
                                "image_data",
                            ]
                            else False
                        )
                    )

            try:
                new_msg = MessageCreate(**merged_dict)
            except ValidationError as ve:
                raise HTTPException(status_code=422, detail=ve.errors()) from ve

            current_user = current_user_tuple[0]
            # Set context from frontend if available
            if new_msg.sentry_trace:
                transaction.set_data("frontend_trace", new_msg.sentry_trace)

            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("conversation.id", str(conversation_id))
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_tag("message.role", new_msg.role)
            transaction.set_data("message_length", len(new_msg.raw_text))

            if new_msg.image_data:
                transaction.set_tag("has_image", True)
                transaction.set_data("vision_detail", new_msg.vision_detail)

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get conversation metadata
            conv_data = await conv_service.get_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )
            model_id = conv_data.get("model_id", "")
            transaction.set_tag("model.id", model_id)

            # Process message
            message_metrics = {}
            with sentry_span_context(
                op="message.process", description="Handle message"
            ) as span:
                start_time = time.time()

                # Defensive: ensure raw_text and role are strings before using .strip()/.lower()
                raw_text_val = new_msg.raw_text
                if not isinstance(raw_text_val, str):
                    raw_text_val = "" if raw_text_val is None else str(raw_text_val)
                role_val = new_msg.role
                if not isinstance(role_val, str):
                    role_val = "user" if role_val is None else str(role_val)

                response = await conv_service.create_message(
                    conversation_id=conversation_id,
                    user_id=current_user.id,
                    content=raw_text_val.strip(),
                    role=role_val.lower().strip(),
                    project_id=project_id,
                    image_data=new_msg.image_data,
                    vision_detail=new_msg.vision_detail,
                    enable_thinking=new_msg.enable_thinking,
                    thinking_budget=new_msg.thinking_budget,
                    reasoning_effort=new_msg.reasoning_effort,
                    temperature=new_msg.temperature,
                    max_tokens=new_msg.max_tokens,
                    enable_web_search=new_msg.enable_web_search,
                )

                duration = (time.time() - start_time) * 1000
                span.set_data("processing_time_ms", duration)
                message_metrics["processing_time_ms"] = duration

            # AI response processing
            role_val = new_msg.role
            if not isinstance(role_val, str):
                role_val = "user" if role_val is None else str(role_val)
            if role_val.lower() == "user":
                with sentry_span_context(
                    op="ai.response", description="Generate AI response"
                ) as ai_span:
                    ai_start = time.time()

                    # (Imaginary AI generation logic would go here)

                    ai_duration = (time.time() - ai_start) * 1000
                    ai_span.set_data("ai_response_time_ms", ai_duration)
                    message_metrics.update(
                        {
                            "ai_response_time_ms": ai_duration,
                            "response_length": len(response.get("content", "")),
                            "thinking_steps": len(response.get("thinking_steps", [])),
                        }
                    )

                    # Track model performance
                    metrics.distribution(
                        "ai.response.duration",
                        ai_duration,
                        unit="millisecond",
                        tags={"model": model_id},
                    )
                    if "thinking_steps" in response:
                        metrics.distribution(
                            "ai.thinking.steps",
                            len(response["thinking_steps"]),
                            tags={"model": model_id},
                        )

            # Track overall metrics
            for metric, value in message_metrics.items():
                metrics.distribution(
                    f"conversation.message.{metric}",
                    value,
                    unit="millisecond",
                    tags={"project_id": str(project_id), "model": model_id},
                )

            logger.info(f"Processed message in conversation {conversation_id}")
            payload = {"status": "success", "message": response}
            return make_sentry_trace_response(payload, transaction)

    except HTTPException as http_exc:
        transaction.set_tag("error.type", "http")
        transaction.set_data("status_code", http_exc.status_code)
        metrics.incr(
            "conversation.message.failure",
            tags={"reason": "http_error", "status_code": http_exc.status_code},
        )
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("conversation.message.failure", tags={"reason": "exception"})
        logger.error(f"Message processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Message processing failed") from e


# =============================================================================
# AI-Powered Features with Monitoring
# =============================================================================


@router.post(
    "/{project_id}/conversations/{conversation_id}/summarize", response_model=dict
)
async def summarize_conversation(
    project_id: UUID,
    conversation_id: UUID,
    max_length: int = Query(200, ge=50, le=500),
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Generate summary with AI performance tracking"""
    model_id = ""
    transaction = start_transaction(
        op="ai", name="Summarize Conversation", sampled=random.random() < AI_SAMPLE_RATE
    )

    try:
        with transaction:
            current_user = current_user_tuple[0]
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("conversation.id", str(conversation_id))
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_data("max_length", max_length)

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get conversation metadata
            conv_data = await conv_service.get_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )
            model_id = conv_data.get("model_id", "")
            transaction.set_tag("model.id", model_id)

            # Get messages
            messages = await conv_service.list_messages(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
                skip=0,
                limit=9999,
            )

            if not messages:
                return {"summary": "No messages to summarize", "message_count": 0}

            # Generate summary
            with sentry_span_context(op="ai.summarize", description="Generate summary") as span:
                start_time = time.time()

                summary = await conv_service.generate_conversation_summary(
                    conversation_id=conversation_id,
                    messages=messages,
                    model_id=model_id,
                    max_length=max_length,
                )

                duration = (time.time() - start_time) * 1000
                span.set_data("summary_time_ms", duration)
                span.set_data("summary_length", len(summary))
                span.set_data("source_messages", len(messages))

                # Track performance
                metrics.distribution(
                    "ai.summary.duration",
                    duration,
                    unit="millisecond",
                    tags={"model": model_id},
                )
                # Example ratio metric
                total_input_len = sum(len(m.get("content", "")) for m in messages)
                if total_input_len > 0:
                    metrics.distribution(
                        "ai.summary.compression_ratio",
                        len(summary) / total_input_len,
                        tags={"model": model_id},
                    )

            logger.info(f"Generated summary for conversation {conversation_id}")
            payload = {
                "summary": "success",
                "content": {
                    "summary": summary,
                    "title": conv_data["title"],
                    "message_count": len(messages),
                },
            }
            return make_sentry_trace_response(payload, transaction)

    except HTTPException:
        raise
    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("ai.summary.failure", tags={"model": model_id})
        logger.error(f"Summary generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Summary generation failed") from e


# =============================================================================
# Batch Operations with Tracing
# =============================================================================


@router.post("/{project_id}/conversations/batch-delete", response_model=dict)
async def batch_delete_conversations(
    project_id: UUID,
    batch_data: BatchConversationIds,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Batch delete with progress tracking"""
    transaction = start_transaction(
        op="conversation",
        name="Batch Delete Conversations",
        sampled=random.random() < CONVERSATION_SAMPLE_RATE,
    )

    try:
        with transaction:
            current_user = current_user_tuple[0]
            transaction.set_tag("project.id", str(project_id))
            transaction.set_tag("user.id", str(current_user.id))
            transaction.set_tag("batch_size", len(batch_data.conversation_ids))

            # Validate access
            await validate_project_access(project_id, current_user, db)

            deleted_ids = []
            failed_ids = []

            for conv_id in batch_data.conversation_ids:
                with sentry_span_context(
                    op="db.delete", description=f"Delete {conv_id}"
                ) as span:
                    try:
                        await conv_service.delete_conversation(
                            conversation_id=conv_id,
                            user_id=current_user.id,
                            project_id=project_id,
                        )
                        deleted_ids.append(str(conv_id))
                        span.set_tag("success", True)
                    except Exception as e:
                        failed_ids.append(str(conv_id))
                        span.set_tag("success", False)
                        span.set_tag("error", str(e))
                        logger.warning(
                            f"Failed to delete conversation {conv_id}: {str(e)}"
                        )

            # Record metrics
            metrics.incr(
                "conversation.batch_delete",
                tags={
                    "success_count": len(deleted_ids),
                    "failure_count": len(failed_ids),
                },
            )
            capture_message(
                "Batch conversation delete",
                level="info",
                data={
                    "project_id": str(project_id),
                    "deleted": deleted_ids,
                    "failed": failed_ids,
                },
            )

            payload = {
                "status": "success",
                "deleted": deleted_ids,
                "failed": failed_ids,
            }
            return make_sentry_trace_response(payload, transaction)

    except Exception as e:
        transaction.set_tag("error", True)
        capture_exception(e)
        metrics.incr("conversation.batch_delete.failure")
        logger.error(f"Batch delete failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Batch delete operation failed"
        ) from e


# =============================================================================
# Utility Endpoints
# =============================================================================

# --- Token Estimation Endpoint for Live Chat Input ---


class TokenEstimationRequest(BaseModel):
    current_input: str


class TokenEstimationResponse(BaseModel):
    estimated_tokens_for_input: int


@router.post(
    "/{project_id}/conversations/{conversation_id}/estimate-tokens",
    response_model=TokenEstimationResponse,
    summary="Estimate tokens for current input in a conversation",
    tags=["Conversations"],
)
async def estimate_tokens_for_input_in_conversation(
    project_id: UUID,
    conversation_id: UUID,
    request_data: TokenEstimationRequest,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Estimate token count for a chat input against a conversation/model context."""
    try:
        current_user = current_user_tuple[0]
        await validate_project_access(project_id, current_user, db)
        input_tokens = await estimate_input_tokens(
            conversation_id=conversation_id,
            input_text=request_data.current_input,
            db=db,
            user_id=current_user.id,
            project_id=project_id,
        )
        return TokenEstimationResponse(estimated_tokens_for_input=input_tokens)
    except Exception as e:
        logger.exception(f"Token estimation failed: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to estimate tokens: {str(e)}"
        )


class TokenStatsResponse(BaseModel):
    """Response model for token statistics API"""

    context_token_usage: int
    message_count: int
    user_msg_tokens: int
    ai_msg_tokens: int
    system_msg_tokens: int
    knowledge_tokens: int
    total_tokens: int


@router.get(
    "/{project_id}/conversations/{conversation_id}/token-stats",
    response_model=TokenStatsResponse,
    summary="Get detailed token statistics for a conversation",
    tags=["Conversations"],
)
async def get_conversation_token_stats(
    project_id: UUID,
    conversation_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Get detailed token usage statistics for a conversation"""
    with sentry_span_context(
        op="conversation",
        description=f"Get Token Stats: Get token stats for conversation {conversation_id}",
    ) as span:
        try:
            current_user = current_user_tuple[0]
            span.set_tag("project.id", str(project_id))
            span.set_tag("conversation.id", str(conversation_id))
            span.set_tag("user.id", str(current_user.id))

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get conversation data with context token usage
            conv_data = await conv_service.get_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )

            # Get messages to calculate token breakdowns
            messages = await conv_service.list_messages(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
                skip=0,
                limit=9999,
            )

            # Calculate token breakdowns - handle None values properly
            user_msg_tokens = sum(
                msg.get("token_count") or 0
                for msg in messages
                if msg.get("role") == "user"
            )
            ai_msg_tokens = sum(
                msg.get("token_count") or 0
                for msg in messages
                if msg.get("role") == "assistant"
            )
            system_msg_tokens = sum(
                msg.get("token_count") or 0
                for msg in messages
                if msg.get("role") == "system"
            )

            # Get knowledge tokens from metadata if available
            knowledge_tokens = 0
            for msg in messages:
                if msg.get("role") == "system" and msg.get("extra_data", {}).get(
                    "used_knowledge_context"
                ):
                    knowledge_tokens += msg.get("token_count") or 0

            # Calculate total tokens
            total_tokens = user_msg_tokens + ai_msg_tokens + system_msg_tokens

            # Return token stats
            return TokenStatsResponse(
                context_token_usage=conv_data.get("context_token_usage") or 0,
                message_count=len(messages),
                user_msg_tokens=user_msg_tokens,
                ai_msg_tokens=ai_msg_tokens,
                system_msg_tokens=system_msg_tokens,
                knowledge_tokens=knowledge_tokens,
                total_tokens=total_tokens,
            )

        except HTTPException:
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("conversation.token_stats.failure")
            logger.error(f"Failed to get token stats: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to retrieve token statistics"
            ) from e


@router.get(
    "/{project_id}/conversations/{conversation_id}/messages", response_model=dict
)
async def list_project_conversation_messages(
    project_id: UUID,
    conversation_id: UUID,
    current_user_tuple: tuple = Depends(get_current_user_and_token),
    db: AsyncSession = Depends(get_async_session),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """List messages with performance tracing"""
    with sentry_span_context(
        op="conversation",
        description=f"List Messages: List messages for {conversation_id}",
    ) as span:
        try:
            current_user = current_user_tuple[0]
            span.set_tag("project.id", str(project_id))
            span.set_tag("conversation.id", str(conversation_id))
            span.set_tag("user.id", str(current_user.id))
            span.set_data("pagination.skip", skip)
            span.set_data("pagination.limit", limit)

            # Validate access
            await validate_project_access(project_id, current_user, db)

            # Get messages
            start_time = time.time()
            messages = await conv_service.list_messages(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
                skip=skip,
                limit=limit,
            )
            duration = (time.time() - start_time) * 1000

            span.set_data("db_query_time_ms", duration)
            metrics.distribution(
                "conversation.message_list.duration", duration, unit="millisecond"
            )

            # Get conversation metadata
            conv_data = await conv_service.get_conversation(
                conversation_id=conversation_id,
                user_id=current_user.id,
                project_id=project_id,
            )

            payload = {
                "status": "success",
                "messages": messages,
                "metadata": {
                    "title": conv_data["title"],
                    "model_id": conv_data["model_id"],
                    "count": len(messages),
                },
            }
            return make_sentry_trace_response(payload, span)

        except HTTPException:
            raise
        except Exception as e:
            span.set_tag("error", True)
            capture_exception(e)
            metrics.incr("conversation.message_list.failure")
            logger.error(f"Failed to list messages: {str(e)}")
            raise HTTPException(
                status_code=500, detail="Failed to retrieve messages"
            ) from e

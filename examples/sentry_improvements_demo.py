#!/usr/bin/env python3
"""
examples/sentry_improvements_demo.py
─────────────────────────────────────────────────────────────────────────
Demonstration script showing the next-level Sentry and logging improvements.

This script demonstrates:
1. Enhanced logging with rate limiting and PII protection
2. Sentry span decorator with timing alerts
3. Custom measurements for performance tracking
4. Context-safe background tasks
5. Audit logging capabilities

Run this script to see the improvements in action.
"""

import asyncio
import logging
import os
import time
from typing import Dict, Any

# Set up environment for demo
os.environ.setdefault("LOG_LEVEL", "INFO")
os.environ.setdefault("SENTRY_ENABLED", "false")  # Disable for demo
os.environ.setdefault("APP_NAME", "sentry_demo")
os.environ.setdefault("APP_VERSION", "1.0.0")
os.environ.setdefault("GIT_SHA", "abc1234")

# Initialize telemetry
from utils.bootstrap import init_telemetry
init_telemetry()

# Import enhanced utilities
from utils.sentry_utils import (
    sentry_span,
    set_sentry_measurements,
    capture_custom_message,
    set_sentry_tag
)
from utils.context_manager import create_context_safe_task
from utils.logging_config import request_id_var, trace_id_var

logger = logging.getLogger(__name__)


@sentry_span(op="demo", desc="slow database operation", alert_ms=100)
async def slow_database_operation(query: str, delay: float = 0.2) -> Dict[str, Any]:
    """
    Simulated database operation that demonstrates the sentry_span decorator.
    Will trigger a slow-call warning if it takes longer than 100ms.
    """
    logger.info(f"Executing query: {query}")
    
    # Simulate database work
    await asyncio.sleep(delay)
    
    # Set custom measurements
    set_sentry_measurements(
        query_duration_ms=int(delay * 1000),
        rows_returned=42,
        db_connections_used=1
    )
    
    return {
        "query": query,
        "rows": 42,
        "duration_ms": int(delay * 1000)
    }


@sentry_span(op="ai", desc="token processing")
async def process_tokens(text: str) -> Dict[str, Any]:
    """
    Simulated AI token processing with measurements.
    """
    # Simulate token counting
    token_count = len(text.split()) * 1.3  # Rough estimate
    
    # Set measurements for Sentry Performance tab
    set_sentry_measurements(
        tokens_processed=int(token_count),
        text_length_chars=len(text),
        processing_time_ms=50
    )
    
    logger.info(f"Processed {token_count} tokens from {len(text)} characters")
    
    return {
        "token_count": int(token_count),
        "text_length": len(text)
    }


async def background_worker(task_id: str, data: Dict[str, Any]) -> None:
    """
    Background worker that demonstrates context preservation.
    The request_id and trace_id should be available here.
    """
    # These should be preserved from the calling context
    request_id = request_id_var.get()
    trace_id = trace_id_var.get()
    
    logger.info(
        f"Background worker {task_id} started",
        extra={
            "task_id": task_id,
            "request_id": request_id,
            "trace_id": trace_id,
            "data_keys": list(data.keys())
        }
    )
    
    # Simulate some work
    await asyncio.sleep(0.1)
    
    logger.info(f"Background worker {task_id} completed")


async def demonstrate_rate_limiting():
    """
    Demonstrate the rate limiting filter by generating many identical log messages.
    """
    logger.info("=== Demonstrating Rate Limiting Filter ===")
    
    # Generate many identical messages (should be rate limited after 50)
    for i in range(60):
        logger.info("This is a repeated message that should be rate limited")
    
    logger.info("Rate limiting demonstration complete")


def demonstrate_pii_protection():
    """
    Demonstrate PII protection by logging sensitive data that should be redacted.
    """
    logger.info("=== Demonstrating PII Protection ===")
    
    # These should be automatically redacted
    logger.info("User email: john.doe@example.com")
    logger.info("SSN: 123-45-6789")
    logger.info("Bearer token: Bearer abc123def456ghi789")
    logger.info("API key: api_key=sk-1234567890abcdef")
    logger.info("Password: password=secretpassword123")
    
    logger.info("PII protection demonstration complete")


async def demonstrate_context_preservation():
    """
    Demonstrate context preservation in background tasks.
    """
    logger.info("=== Demonstrating Context Preservation ===")
    
    # Set some context
    req_token = request_id_var.set("demo-request-123")
    trace_token = trace_id_var.set("demo-trace-abc")
    
    try:
        # Create background tasks that should preserve context
        tasks = []
        for i in range(3):
            task = create_context_safe_task(
                background_worker,
                f"worker-{i}",
                {"index": i, "timestamp": time.time()}
            )
            tasks.append(task)
        
        # Wait for all tasks to complete
        await asyncio.gather(*tasks)
        
    finally:
        # Reset context
        request_id_var.reset(req_token)
        trace_id_var.reset(trace_token)
    
    logger.info("Context preservation demonstration complete")


async def demonstrate_performance_tracking():
    """
    Demonstrate performance tracking with Sentry spans and measurements.
    """
    logger.info("=== Demonstrating Performance Tracking ===")
    
    # Fast operation (should not trigger slow-call warning)
    result1 = await slow_database_operation("SELECT * FROM users LIMIT 10", delay=0.05)
    logger.info(f"Fast query result: {result1}")
    
    # Slow operation (should trigger slow-call warning)
    result2 = await slow_database_operation("SELECT * FROM large_table", delay=0.15)
    logger.info(f"Slow query result: {result2}")
    
    # AI processing with token measurements
    text = "This is a sample text for token processing demonstration."
    token_result = await process_tokens(text)
    logger.info(f"Token processing result: {token_result}")
    
    logger.info("Performance tracking demonstration complete")


def demonstrate_audit_logging():
    """
    Demonstrate audit logging capabilities.
    """
    logger.info("=== Demonstrating Audit Logging ===")
    
    # Get the audit logger
    audit_logger = logging.getLogger("audit")
    
    # Log some audit events
    audit_logger.info("User login", extra={
        "user_id": "user123",
        "ip_address": "192.168.1.100",
        "action": "login",
        "timestamp": time.time()
    })
    
    audit_logger.warning("Failed login attempt", extra={
        "ip_address": "192.168.1.200",
        "action": "failed_login",
        "attempts": 3,
        "timestamp": time.time()
    })
    
    audit_logger.info("File uploaded", extra={
        "user_id": "user123",
        "file_name": "document.pdf",
        "file_size": 1024000,
        "action": "file_upload",
        "timestamp": time.time()
    })
    
    logger.info("Audit logging demonstration complete")


async def main():
    """
    Main demonstration function.
    """
    logger.info("🚀 Starting Sentry and Logging Improvements Demo")
    
    try:
        # Set some Sentry tags for the demo
        set_sentry_tag("demo_version", "1.0.0")
        set_sentry_tag("environment", "demo")
        
        # Run all demonstrations
        await demonstrate_performance_tracking()
        await demonstrate_context_preservation()
        demonstrate_rate_limiting()
        demonstrate_pii_protection()
        demonstrate_audit_logging()
        
        # Capture a custom message to Sentry
        capture_custom_message(
            "Demo completed successfully",
            level="info",
            extra={
                "demo_features": [
                    "rate_limiting",
                    "pii_protection", 
                    "context_preservation",
                    "performance_tracking",
                    "audit_logging"
                ]
            }
        )
        
        logger.info("✅ Demo completed successfully!")
        
    except Exception as e:
        logger.exception(f"Demo failed: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())

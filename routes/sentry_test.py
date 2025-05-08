"""
routes/sentry_test.py
-----
Test endpoints for Sentry integration verification.
These endpoints intentionally trigger errors to test Sentry error tracking
and demonstrate various Sentry features.
"""

import logging
import sentry_sdk
from fastapi import APIRouter, HTTPException, Response
from typing import Any, Optional
import random
import time
import uuid

from utils.sentry_utils import tag_transaction, sentry_span, inject_sentry_trace_headers
from utils.mcp_sentry import (
    get_issue_details,
    search_issues,
    enable_mcp_integrations,
    SentryMCPError,
    ServerConnectionError,
    ServerResponseError,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class SentryTestException(Exception):
    """Custom exception for testing Sentry integration."""


@router.get("/test-error", response_model=dict[str, str])
async def test_sentry_error():
    """
    Test endpoint that raises an exception to verify Sentry error tracking.

    This endpoint intentionally raises an exception that should be captured by Sentry.
    Check your Sentry dashboard to see if the error is reported.
    """
    # Log something first to add a breadcrumb
    logger.info("About to test Sentry error capturing")

    # Generate a random error ID to help identify this specific error in Sentry
    error_id = f"test-error-{random.randint(1000, 9999)}"

    # Add a tag to the transaction
    tag_transaction("test_error_id", error_id)
    tag_transaction("test_type", "manual_exception")

    # Raise a test exception
    try:
        logger.warning(f"Intentionally raising test exception with ID: {error_id}")
        raise SentryTestException(f"Intentional test error with ID: {error_id}")
    except SentryTestException as e:
        # Capture the exception with Sentry
        sentry_sdk.capture_exception(e)
        # Re-raise for FastAPI to handle
        raise HTTPException(
            status_code=500, detail=f"Test error raised with ID: {error_id}"
        ) from e


@router.get("/test-message", response_model=dict[str, str])
async def test_sentry_message():
    """
    Test endpoint that sends a custom message to Sentry.

    This endpoint captures a message with Sentry. Check your Sentry
    dashboard to see if the message is reported.
    """
    # Generate a random message ID to help identify this specific message in Sentry
    message_id = f"test-message-{random.randint(1000, 9999)}"

    # Add a tag to the transaction
    tag_transaction("test_message_id", message_id)
    tag_transaction("test_type", "manual_message")

    # Log an info message
    logger.info(f"Sending test message to Sentry with ID: {message_id}")

    # Send a message to Sentry
    sentry_sdk.capture_message(
        f"Test message from Sentry test endpoint with ID: {message_id}", level="info"
    )

    # Return success response
    return {"message": f"Test message sent to Sentry with ID: {message_id}"}


@router.get("/test-performance", response_model=dict[str, str])
async def test_sentry_performance(response: Response):
    """
    Test endpoint that creates spans to verify Sentry performance monitoring.

    This endpoint creates several spans to test Sentry performance tracking.
    Check your Sentry Performance dashboard to see the transaction and spans.
    """
    # Generate a random performance test ID
    perf_id = f"perf-{random.randint(1000, 9999)}"

    # Add transaction tags
    tag_transaction("test_perf_id", perf_id)
    tag_transaction("test_type", "performance")

    # Add trace headers to response for distributed tracing
    inject_sentry_trace_headers(response)

    # Create a span for a simulated database operation
    with sentry_span(op="db.query", description="Simulate database query") as span:
        # Add database query details
        span.set_tag("db.type", "postgresql")
        span.set_tag("db.operation", "SELECT")
        span.set_data(
            "db.statement", "SELECT * FROM users WHERE active = true LIMIT 100"
        )

        # Simulate a database operation
        time.sleep(0.1)  # 100ms simulated database query

    # Create a span for a simulated HTTP request
    with sentry_span(
        op="http.client", description="Simulate external API call"
    ) as span:
        # Add HTTP request details
        span.set_tag("http.method", "GET")
        span.set_tag("http.url", "https://api.example.com/data")
        span.set_data("http.request_content_length", 0)

        # Simulate an external API call
        time.sleep(0.2)  # 200ms simulated API call

        # Create a nested span
        with sentry_span(
            op="serialization", description="Process API response"
        ) as child_span:
            child_span.set_data("serialization.format", "json")
            child_span.set_data("response.size", 1240)
            time.sleep(0.05)  # 50ms simulated processing

    # Create a span for cache operations
    with sentry_span(op="cache.get", description="Check cache") as span:
        span.set_tag("cache.type", "redis")
        span.set_data("cache.key", f"user:preferences:{random.randint(1000, 9999)}")
        span.set_data("cache.hit", False)
        time.sleep(0.03)  # 30ms simulated cache check

    # Log the completion
    logger.info(f"Completed performance test with ID: {perf_id}")

    # Return success response
    return {
        "message": f"Performance test completed with ID: {perf_id}",
        "spans": "Created spans for DB query, HTTP request, serialization, and caching",
    }


@router.get("/test-profiling", response_model=dict[str, str])
async def test_sentry_profiling():
    """
    Test endpoint to verify Sentry profiling capabilities.

    This endpoint performs CPU-intensive operations to generate profiling data.
    Check your Sentry Performance dashboard to see the profiling results.
    """
    # Generate a test ID
    profile_id = f"profile-{random.randint(1000, 9999)}"

    # Add tags
    tag_transaction("test_profile_id", profile_id)
    tag_transaction("test_type", "profiling")

    # Log the start
    logger.info(f"Starting profiling test with ID: {profile_id}")

    # CPU-intensive operations to profile
    with sentry_span(op="cpu.intensive", description="Fibonacci calculation"):
        # Function that triggers a performance bottleneck
        def fibonacci(n):
            if n <= 1:
                return n
            return fibonacci(n - 1) + fibonacci(n - 2)

        # Calculate Fibonacci numbers
        results = []
        for i in range(10, 30):
            with sentry_span(op="fibonacci.calc", description=f"Calculate fib({i})"):
                result = fibonacci(i)
                results.append(result)

    # String manipulation operations
    with sentry_span(op="string.manipulation", description="String operations"):
        strings = []
        for i in range(1000):
            s = f"test-string-{i}-{uuid.uuid4()}"
            strings.append(s)

        # Sort and manipulate
        strings.sort()
        joined = "".join(strings[:100])
        # Reverse string for demonstration
        _ = joined[::-1]  # Result unused but operation preserved for profiling

    # Memory operations
    with sentry_span(op="memory.intensive", description="Memory operations"):
        # Create large list
        large_list = [random.random() for _ in range(100000)]

        # Sort and manipulate
        large_list.sort()
        # Calculate sum for demonstration
        _ = sum(large_list)  # Result unused but operation preserved for profiling

    logger.info(f"Completed profiling test with ID: {profile_id}")

    return {
        "message": f"Profiling test completed with ID: {profile_id}",
        "operations": "Performed CPU-intensive operations for profiling analysis",
    }


@router.get("/test-mcp", response_model=dict[str, Any])
async def test_sentry_mcp(issue_id: Optional[str] = None):
    """
    Test endpoint to verify Sentry MCP server integration.

    This endpoint attempts to retrieve issue details from Sentry using the MCP server.
    Provides optional issue_id parameter - if not provided, will attempt to search for recent issues.
    """
    # Generate a test ID
    mcp_test_id = f"mcp-test-{random.randint(1000, 9999)}"

    # Add tags
    tag_transaction("test_mcp_id", mcp_test_id)
    tag_transaction("test_type", "mcp_integration")

    # Log the start
    logger.info(f"Starting MCP integration test with ID: {mcp_test_id}")

    # Enable MCP integrations
    enable_result = enable_mcp_integrations()

    try:
        # If issue_id is provided, get details for that specific issue
        if issue_id:
            with sentry_span(
                op="mcp.issue_details", description=f"Get issue details for {issue_id}"
            ):
                issue_details = get_issue_details(issue_id)

                return {
                    "message": f"Successfully retrieved issue details for {issue_id}",
                    "test_id": mcp_test_id,
                    "mcp_enabled": enable_result,
                    "issue_details": {
                        "id": issue_details.get("id"),
                        "title": issue_details.get("title"),
                        "status": issue_details.get("status"),
                        "culprit": issue_details.get("culprit"),
                        "project": issue_details.get("project", {}).get("name"),
                        "count": issue_details.get("count"),
                        "firstSeen": issue_details.get("firstSeen"),
                        "lastSeen": issue_details.get("lastSeen"),
                    },
                }

        # Otherwise, search for recent issues
        else:
            with sentry_span(
                op="mcp.search_issues", description="Search for recent issues"
            ):
                issues = search_issues("is:unresolved", limit=5)

                # Format the results
                formatted_issues = []
                for issue in issues:
                    formatted_issues.append(
                        {
                            "id": issue.get("id"),
                            "title": issue.get("title"),
                            "status": issue.get("status"),
                            "project": issue.get("project", {}).get("name", "Unknown"),
                            "count": issue.get("count", 0),
                        }
                    )

                return {
                    "message": "Successfully searched for recent issues",
                    "test_id": mcp_test_id,
                    "mcp_enabled": enable_result,
                    "issues_found": len(formatted_issues),
                    "issues": formatted_issues,
                }

    except (SentryMCPError, ServerConnectionError, ServerResponseError) as e:
        # Handle MCP server errors
        logger.error(f"MCP server error during test: {str(e)}")
        raise HTTPException(
            status_code=503, detail=f"Sentry MCP server error: {str(e)}"
        ) from e
    except Exception as e:
        # Capture and handle other errors
        sentry_sdk.capture_exception(e)
        logger.error(f"Error during MCP test: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Unexpected error during MCP test: {str(e)}"
        ) from e


@router.get("/test-distributed-tracing")
async def test_distributed_tracing(response: Response):
    """
    Test endpoint for Sentry distributed tracing.

    This endpoint demonstrates propagating trace information across services.
    It will create spans and propagate trace headers to simulate a distributed system.
    """
    # Generate a test ID
    trace_id = f"trace-{random.randint(1000, 9999)}"

    # Add tags
    tag_transaction("test_trace_id", trace_id)
    tag_transaction("test_type", "distributed_tracing")

    # Add trace headers to response for distributed tracing
    inject_sentry_trace_headers(response)

    # Log the start
    logger.info(f"Starting distributed tracing test with ID: {trace_id}")

    # Simulate a complex distributed transaction
    with sentry_span(op="service.auth", description="Authentication Service") as span:
        span.set_data("service.name", "auth-service")
        span.set_tag("service.tier", "frontend")

        # Simulate auth service work
        time.sleep(0.05)

        # These headers would normally be sent to the next service
        # Trace headers would normally be sent to next service
        _ = {
            "sentry-trace": sentry_sdk.get_traceparent(),
            "baggage": sentry_sdk.get_baggage(),
        }  # Not used in this test but preserved for demonstration

    # Simulate next service in the chain
    with sentry_span(
        op="service.business_logic", description="Business Logic Service"
    ) as span:
        span.set_data("service.name", "logic-service")
        span.set_tag("service.tier", "middleware")

        # Simulate business logic work
        time.sleep(0.1)

        # Nested span for specific operation
        with sentry_span(op="business.validation", description="Validate Request"):
            time.sleep(0.03)

    # Simulate data service
    with sentry_span(op="service.data", description="Data Service") as span:
        span.set_data("service.name", "data-service")
        span.set_tag("service.tier", "backend")

        # Simulate data processing
        with sentry_span(op="db.read", description="Database Read"):
            span.set_tag("db.type", "postgresql")
            time.sleep(0.07)

        # Simulate data transform
        with sentry_span(op="data.transform", description="Transform Results"):
            time.sleep(0.04)

    logger.info(f"Completed distributed tracing test with ID: {trace_id}")

    return {
        "message": f"Distributed tracing test completed with ID: {trace_id}",
        "trace_headers": {
            "sentry-trace": sentry_sdk.get_traceparent(),
            "baggage": sentry_sdk.get_baggage(),
        },
        "services_simulated": [
            "Authentication Service",
            "Business Logic Service",
            "Data Service",
        ],
    }

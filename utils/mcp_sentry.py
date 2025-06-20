"""
utils/mcp_sentry.py
-----
Utilities for interacting with the Sentry MCP server.
This module bridges the gap between the MCP server and the main application
and provides enhanced Sentry functionality through the MCP server.
"""

import logging
import json
import os
import time
import importlib
from typing import Any, Optional, Union, List, Tuple

import sentry_sdk
from sentry_sdk import configure_scope
from config import settings as config_settings
from utils.retry import with_retry

logger = logging.getLogger(__name__)          # NEW – moved up

# Helper function to safely use MCP tools
def _safe_use_mcp_tool(server_name: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """
    Safely use an MCP tool by importing the mcp_client module and calling use_mcp_tool.
    Raises ServerConnectionError if the MCP client is not available.

    Args:
        server_name: Name of the MCP server
        tool_name: Name of the tool to call
        arguments: Arguments to pass to the tool

    Returns:
        The result from the MCP tool

    Raises:
        ServerConnectionError: If MCP tools are not available
    """
    try:
        try:
            mcp_client = importlib.import_module("mcp_client")
            return mcp_client.use_mcp_tool(server_name=server_name, tool_name=tool_name, arguments=arguments)
        except (ImportError, AttributeError) as exc:
            logger.warning(f"MCP tools not available for call to {tool_name}")
            raise ServerConnectionError(f"MCP tools not available for {tool_name}") from exc
    except Exception as e:
        logger.error(f"Error using MCP tool {tool_name}: {e}")
        raise ServerConnectionError(f"Failed to use MCP tool {tool_name}: {str(e)}") from e


# Constants for MCP server operations
DEFAULT_TIMEOUT = 10  # seconds
MAX_RETRIES = 3
RETRY_DELAY = 1.5  # seconds
AUTH_TOKEN_ENV = "SENTRY_AUTH_TOKEN"
MCP_SERVER_NAME = "github.com/modelcontextprotocol/servers/tree/main/src/sentry"


class SentryMCPError(Exception):
    """Base exception for Sentry MCP errors"""


class ServerConnectionError(SentryMCPError):
    """Raised when unable to connect to the Sentry MCP server"""


class ServerResponseError(SentryMCPError):
    """Raised when the Sentry MCP server returns an error response"""


class RateLimitError(SentryMCPError):
    """Raised when rate limited by the Sentry MCP server"""


class ConfigurationError(SentryMCPError):
    """Raised for invalid configuration"""


class CacheMissError(SentryMCPError):
    """Raised when requested data is not in cache"""


# Cache configuration
ISSUE_CACHE: dict[str, Tuple[dict[str, Any], float]] = {}
CACHE_TTL = 300  # 5 minutes


def _clear_expired_cache():
    """Clear expired cache entries"""
    current_time = time.time()
    expired_keys = [
        k for k, (_, expiry) in ISSUE_CACHE.items() if expiry < current_time
    ]
    for key in expired_keys:
        ISSUE_CACHE.pop(key, None)


@with_retry
def get_issue_details(
    issue_id_or_url: Union[str, List[str]], use_cache: bool = True
) -> List[dict[str, Any]]:
    """
    Get detailed information about a Sentry issue using the MCP server.
    Supports caching to reduce load on the MCP server.

    Args:
        issue_id_or_url: Sentry issue ID or URL
        use_cache: Whether to use cached results if available (default: True)

    Returns:
        List of dictionaries with issue details

    Raises:
        ServerConnectionError: If the MCP server is not running or unreachable
        ServerResponseError: If the MCP server returns an error
    """
    if isinstance(issue_id_or_url, list):
        # For a list, call the function recursively per element and flatten results to a flat list of dicts
        result_list = []
        for issue in issue_id_or_url:
            res = get_issue_details(issue, use_cache)
            if isinstance(res, list):
                result_list.extend(res)
            else:
                result_list.append(res)
        return result_list

    # Clear expired cache entries first
    _clear_expired_cache()

    # Check cache if enabled
    if use_cache and issue_id_or_url in ISSUE_CACHE:
        cached_data, _ = ISSUE_CACHE[issue_id_or_url]
        logger.debug(f"Returning cached data for issue: {issue_id_or_url}")
        return [cached_data]

    # Log the attempt
    logger.info(f"Fetching issue details for {issue_id_or_url}")

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Get Sentry Issue {issue_id_or_url}"
    ) as span:
        # Track the issue_id in span data
        span.set_data("issue_id", issue_id_or_url)

        try:
            # Call the MCP tool to get issue details
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="get_sentry_issue",
                arguments={
                    "issue_id_or_url": issue_id_or_url
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")

            # Cache the result
            ISSUE_CACHE[issue_id_or_url] = (result, time.time() + CACHE_TTL)
            return [result]

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error getting issue details: {e}")
            raise ServerResponseError(f"Failed to get issue details: {str(e)}") from e


@with_retry
def search_issues(query: str, limit: int = 10) -> List[dict[str, Any]]:
    """
    Search for Sentry issues using the MCP server.

    Args:
        query: Search query string
        limit: Maximum number of results to return

    Returns:
        List of issues matching the query

    Raises:
        ServerConnectionError: If the MCP server is not running or unreachable
        ServerResponseError: If the MCP server returns an error
    """
    logger.info("Searching issues with query: %s, limit: %s", query, limit)

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description="Search Sentry Issues"
    ) as span:
        span.set_data("query", query)
        span.set_data("limit", limit)

        try:
            # Use our helper function to safely call the MCP tool
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="search_sentry_issues",
                arguments={
                    "query": query,
                    "limit": limit
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")
            # Ensure always returns List[dict[str, Any]]
            if isinstance(result, dict):
                return [result]
            span.set_data("result_count", len(result))
            return result

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error searching issues: {e}")
            raise ServerResponseError(f"Failed to search issues: {str(e)}") from e


@with_retry
def get_issue_events(issue_id: str, limit: int = 10) -> List[dict[str, Any]]:
    """
    Get events for a specific issue using the MCP server.

    Args:
        issue_id: Sentry issue ID
        limit: Maximum number of events to return

    Returns:
        List of events for the issue

    Raises:
        ServerConnectionError: If the MCP server is not running or unreachable
        ServerResponseError: If the MCP server returns an error
    """
    logger.info("Fetching events for issue: %s, limit: %s", issue_id, limit)

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Get Events for Issue {issue_id}"
    ) as span:
        span.set_data("issue_id", issue_id)
        span.set_data("limit", limit)

        try:
            # Use our helper function to safely call the MCP tool
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="get_issue_events",
                arguments={
                    "issue_id": issue_id,
                    "limit": limit
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")
            # Ensure always returns List[dict[str, Any]]
            if isinstance(result, dict):
                return [result]
            span.set_data("event_count", len(result))
            return result

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error getting issue events: {e}")
            raise ServerResponseError(f"Failed to get issue events: {str(e)}") from e


def get_project_stats(
    project_id: str, stat_type: str = "error", days: int = 14
) -> dict[str, Any]:
    """
    Get project statistics from Sentry.

    Args:
        project_id: Sentry project ID
        stat_type: Type of stats to fetch ('error', 'transaction', 'session')
        days: Number of days of data to fetch

    Returns:
        Dictionary containing project statistics
    """
    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Get {stat_type.capitalize()} Stats"
    ) as span:
        span.set_data("project_id", project_id)
        span.set_data("stat_type", stat_type)
        span.set_data("days", days)

        try:
            # Use our helper function to safely call the MCP tool
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="get_project_stats",
                arguments={
                    "project_id": project_id,
                    "stat_type": stat_type,
                    "days": days
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")
            return result

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error getting project stats: {e}")
            raise ServerResponseError(f"Failed to get project stats: {str(e)}") from e


def resolve_issue(issue_id: str) -> dict[str, Any]:
    """
    Mark a Sentry issue as resolved.

    Args:
        issue_id: Sentry issue ID

    Returns:
        Dictionary containing the updated issue details
    """
    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description="Resolve Issue"
    ) as span:
        span.set_data("issue_id", issue_id)

        try:
            # Use our helper function to safely call the MCP tool
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="resolve_issue",
                arguments={
                    "issue_id": issue_id
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")
            return result

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error resolving issue: {e}")
            raise ServerResponseError(f"Failed to resolve issue: {str(e)}") from e


def get_breadcrumbs(event_id: str) -> dict[str, Any]:
    """
    Get breadcrumbs for a specific Sentry event.

    Args:
        event_id: Sentry event ID

    Returns:
        Dictionary containing breadcrumbs from the event
    """
    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description="Get Event Breadcrumbs"
    ) as span:
        span.set_data("event_id", event_id)

        try:
            # Use our helper function to safely call the MCP tool
            result = _safe_use_mcp_tool(
                server_name=MCP_SERVER_NAME,
                tool_name="get_breadcrumbs",
                arguments={
                    "event_id": event_id
                }
            )

            if not result or "error" in result:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.get('error', 'Unknown error')}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            span.set_status("ok")
            return result

        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            logger.error(f"Error getting breadcrumbs: {e}")
            raise ServerResponseError(f"Failed to get breadcrumbs: {str(e)}") from e


def enable_mcp_integrations() -> bool:
    """
    Configure the SDK to use the Sentry MCP server for enhanced functionality.
    Adds explicit, clear terminal output indicating whether the integration is ON and functional.

    Returns:
        True if configuration was successful, False otherwise
    """
    try:
        # Check environment variable/config before proceeding
        mcp_enabled = os.getenv("SENTRY_MCP_SERVER_ENABLED", "").lower() == "true"
        try:
            mcp_enabled = getattr(config_settings, "SENTRY_MCP_SERVER_ENABLED", mcp_enabled)
        except Exception:
            pass

        if not mcp_enabled:
            logger.info(
                "Sentry MCP integration is DISABLED. "
                "Set SENTRY_MCP_SERVER_ENABLED=true to activate MCP features."
            )
            return False

        # Verify MCP server is accessible by getting its status
        status = get_mcp_status()
        if not status:
            logger.error("Cannot enable MCP integrations: Server not available")
            return False

        # Configure the SDK to use the MCP server
        with configure_scope() as scope:
            scope.set_tag("using_mcp_server", "true")
            scope.set_context(
                "mcp_integration",
                {"enabled": True, "server_version": status.get("version", "unknown")},
            )

        logger.info("Sentry MCP integration is ENABLED. MCP Status: %s",
                    json.dumps(status) if status else "UNKNOWN")
        logger.info("Sentry MCP integrations enabled successfully")
        return True

    except Exception as e:
        logger.error("Failed to enable MCP integrations: %s", e)
        return False


def get_mcp_status() -> Optional[dict[str, Any]]:
    """
    Get the current status of the Sentry MCP server.

    Returns:
        Dictionary with server status information or None if the server is not available
    """
    try:
        # Create a span for this operation
        with sentry_sdk.start_span(
            op="mcp.request", description="Get MCP Server Status"
        ) as span:
            try:
                # Use our helper to safely call the MCP tool
                result = _safe_use_mcp_tool(
                    server_name=MCP_SERVER_NAME,
                    tool_name="get_server_status",
                    arguments={}
                )

                if not result:
                    span.set_status("internal_error")
                    logger.warning("Failed to get MCP server status")
                    return None

                span.set_status("ok")
                return result

            except Exception as e:
                span.set_status("internal_error")
                span.set_data("error", str(e))
                logger.error(f"Error getting MCP status: {e}")
                return None

    except Exception as e:
        logger.error(f"Error checking MCP status: {e}")
        return None

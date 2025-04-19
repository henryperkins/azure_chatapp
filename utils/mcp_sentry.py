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
import re
import time
import subprocess
from typing import Any, Dict, Optional, Union, List, Tuple, Callable

import sentry_sdk
from sentry_sdk import configure_scope

logger = logging.getLogger(__name__)

# Constants for MCP server operations
DEFAULT_TIMEOUT = 10  # seconds
MAX_RETRIES = 3
RETRY_DELAY = 1.5  # seconds
AUTH_TOKEN_ENV = "SENTRY_AUTH_TOKEN"
SERVER_CMD = "mcp_server_sentry"


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


def with_retry(func: Callable) -> Callable:
    """
    Decorator that adds retry logic to functions that interact with the MCP server.
    Will retry up to MAX_RETRIES times with exponential backoff.
    Handles rate limiting and specific error cases differently.
    """

    def wrapper(*args, **kwargs):
        retries = 0
        last_exception = None

        while retries < MAX_RETRIES:
            try:
                return func(*args, **kwargs)
            except RateLimitError as e:
                # For rate limits, use the Retry-After header if available
                retry_after = getattr(e, "retry_after", RETRY_DELAY * (2**retries))
                logger.warning(f"Rate limited, retrying after {retry_after}s")
                time.sleep(retry_after)
                retries += 1
                last_exception = e
            except (ServerConnectionError, ServerResponseError) as e:
                retries += 1
                if retries >= MAX_RETRIES:
                    logger.error(f"Failed after {MAX_RETRIES} retries: {e}")
                    raise

                # Exponential backoff with jitter
                delay = (
                    RETRY_DELAY * (2 ** (retries - 1)) * (0.9 + 0.2 * (time.time() % 1))
                )
                logger.warning(f"Retry {retries}/{MAX_RETRIES} after {delay:.2f}s: {e}")
                time.sleep(delay)
                last_exception = e
            except Exception as e:
                # Don't retry other types of exceptions
                logger.error(f"Unrecoverable error in {func.__name__}: {e}")
                raise

        if last_exception:
            raise last_exception
        raise SentryMCPError("Max retries reached without attempting")

    return wrapper


# Cache configuration
ISSUE_CACHE: Dict[str, Tuple[Dict[str, Any], float]] = {}
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
) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Get detailed information about a Sentry issue using the MCP server.
    Supports caching to reduce load on the MCP server.

    Args:
        issue_id_or_url: Sentry issue ID or URL
        use_cache: Whether to use cached results if available (default: True)

    Returns:
        Dictionary with issue details

    Raises:
        ServerConnectionError: If the MCP server is not running or unreachable
        ServerResponseError: If the MCP server returns an error
        CacheMissError: If use_cache is True but no cached data is available
    """
    if isinstance(issue_id_or_url, list):
        return [get_issue_details(issue, use_cache) for issue in issue_id_or_url]
    # Clear expired cache entries first
    _clear_expired_cache()

    # Check cache if enabled
    if use_cache and issue_id_or_url in ISSUE_CACHE:
        cached_data, _ = ISSUE_CACHE[issue_id_or_url]
        logger.debug(f"Returning cached data for issue: {issue_id_or_url}")
        return cached_data

    if use_cache:
        raise CacheMissError(f"No cached data available for issue: {issue_id_or_url}")

    # Log the attempt
    logger.info(f"Fetching issue details for {issue_id_or_url}")

    # First check if the MCP server for Sentry is running
    if not check_mcp_server():
        # Try to start it automatically
        if not start_mcp_server():
            raise ServerConnectionError(
                "Sentry MCP server is not running and could not be started"
            )

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Get Sentry Issue {issue_id_or_url}"
    ) as span:
        # Track the issue_id in span data
        span.set_data("issue_id", issue_id_or_url)

        try:
            # Use subprocess to call the MCP server CLI tool
            result = subprocess.run(
                ["python", "-m", SERVER_CMD, "--get-issue", issue_id_or_url],
                capture_output=True,
                text=True,
                timeout=DEFAULT_TIMEOUT,
                check=True
            )

            if result.returncode != 0:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.stderr}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            # Try to parse the JSON output
            try:
                data = json.loads(result.stdout)
                span.set_status("ok")

                # Cache the result
                ISSUE_CACHE[issue_id_or_url] = (data, time.time() + CACHE_TTL)
                return data
            except json.JSONDecodeError as e:
                span.set_status("internal_error")
                error_msg = (
                    f"Failed to parse MCP server output: {result.stdout[:200]}..."
                )
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg) from e

        except subprocess.TimeoutExpired as e:
            span.set_status("internal_error")
            span.set_data("error", "MCP server request timed out")
            raise ServerConnectionError("MCP server request timed out") from e
        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            raise


def check_mcp_server() -> bool:
    """
    Check if the Sentry MCP server is running.

    Returns:
        True if the server is running, False otherwise
    """
    try:
        # Try to get MCP server status
        result = subprocess.run(
            ["pgrep", "-f", SERVER_CMD],
            capture_output=True,
            text=True,
            timeout=5,
            check=False
        )

        return result.returncode == 0 and result.stdout.strip() != ""
    except Exception as e:
        logger.error(f"Error checking MCP server status: {e}")
        return False


def start_mcp_server() -> bool:
    """
    Attempt to start the Sentry MCP server if it's not running.

    Returns:
        True if the server was started successfully, False otherwise
    """
    if check_mcp_server():
        logger.info("Sentry MCP server is already running")
        return True

    auth_token = os.environ.get(AUTH_TOKEN_ENV, "")
    if not auth_token:
        logger.error(
            f"Cannot start MCP server: {AUTH_TOKEN_ENV} environment variable not set"
        )
        logger.error("Please set SENTRY_AUTH_TOKEN with a valid Sentry auth token")
        return False

    # Verify the server command exists
    try:
        subprocess.run(
            ["which", SERVER_CMD],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError:
        logger.error(f"MCP server command not found: {SERVER_CMD}")
        logger.error("Please install the sentry-mcp-server package")
        return False

    try:
        # Verify server command exists and is executable
        try:
            cmd_path = subprocess.run(
                ["which", SERVER_CMD],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            ).stdout.strip()

            if not os.access(cmd_path, os.X_OK):
                logger.error(f"MCP server command not executable: {cmd_path}")
                logger.error(
                    "Please check permissions on the sentry-mcp-server package"
                )
                return False

        except subprocess.CalledProcessError:
            logger.error(f"MCP server command not found: {SERVER_CMD}")
            logger.error("Please install the sentry-mcp-server package with:")
            logger.error("pip install sentry-mcp-server")
            return False

        # Verify auth token is valid
        if not auth_token or not re.match(r"^[a-f0-9]{32}$", auth_token):
            logger.error(
                "Invalid SENTRY_AUTH_TOKEN format - must be 32 character hex string"
            )
            return False

        # Start the MCP server with debug logging
        logger.info(f"Starting Sentry MCP server with command: python -m {SERVER_CMD}")
        process = subprocess.Popen(
            [
                "python",
                "-m",
                SERVER_CMD,
                "--auth-token",
                auth_token,
                "--log-level",
                "debug",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            text=True,
        )

        # Wait and capture output
        time.sleep(1)
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            logger.error(
                f"MCP server failed to start. Output:\n{stdout}\nError:\n{stderr}"
            )
            return False

        # Additional wait for full startup
        time.sleep(2)

        # Verify server is responding
        if not check_mcp_server():
            logger.error("MCP server process started but not responding")
            process.terminate()
            return False

        logger.info("Sentry MCP server started successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to start MCP server: {e}")
        return False


@with_retry
def search_issues(query: str, limit: int = 10) -> List[Dict[str, Any]]:
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

    # Check server and start if needed
    if not check_mcp_server() and not start_mcp_server():
        raise ServerConnectionError(
            "Sentry MCP server is not running and could not be started"
        )

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description="Search Sentry Issues"
    ) as span:
        span.set_data("query", query)
        span.set_data("limit", limit)

        try:
            result = subprocess.run(
                [
                    "python",
                    "-m",
                    SERVER_CMD,
                    "--search-issues",
                    query,
                    "--limit",
                    str(limit),
                ],
                capture_output=True,
                text=True,
                timeout=DEFAULT_TIMEOUT,
                check=True
            )

            if result.returncode != 0:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.stderr}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            try:
                data = json.loads(result.stdout)
                span.set_status("ok")
                span.set_data("result_count", len(data))
                return data
            except json.JSONDecodeError as e:
                span.set_status("internal_error")
                error_msg = (
                    f"Failed to parse MCP server output: {result.stdout[:200]}..."
                )
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg) from e

        except subprocess.TimeoutExpired as e:
            span.set_status("internal_error")
            span.set_data("error", "MCP server request timed out")
            raise ServerConnectionError("MCP server request timed out") from e
        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            raise


@with_retry
def get_issue_events(issue_id: str, limit: int = 10) -> List[Dict[str, Any]]:
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

    # Check server and start if needed
    if not check_mcp_server() and not start_mcp_server():
        raise ServerConnectionError(
            "Sentry MCP server is not running and could not be started"
        )

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Get Events for Issue {issue_id}"
    ) as span:
        span.set_data("issue_id", issue_id)
        span.set_data("limit", limit)

        try:
            result = subprocess.run(
                [
                    "python",
                    "-m",
                    SERVER_CMD,
                    "--get-issue-events",
                    issue_id,
                    "--limit",
                    str(limit),
                ],
                capture_output=True,
                text=True,
                timeout=DEFAULT_TIMEOUT,
                check=True
            )

            if result.returncode != 0:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.stderr}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            try:
                data = json.loads(result.stdout)
                span.set_status("ok")
                span.set_data("event_count", len(data))
                return data
            except json.JSONDecodeError as e:
                span.set_status("internal_error")
                error_msg = (
                    f"Failed to parse MCP server output: {result.stdout[:200]}..."
                )
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg) from e

        except subprocess.TimeoutExpired as e:
            span.set_status("internal_error")
            span.set_data("error", "MCP server request timed out")
            raise ServerConnectionError("MCP server request timed out") from e
        except Exception as e:
            span.set_status("internal_error")
            span.set_data("error", str(e))
            raise


def run_mcp_query(command_args: List[str], operation_name: str) -> Dict[str, Any]:
    """
    Run a generic query against the Sentry MCP server.

    Args:
        command_args: List of command arguments to pass to the MCP server
        operation_name: Name of the operation for logging and span naming

    Returns:
        Parsed response data from the MCP server

    Raises:
        ServerConnectionError: If the MCP server is not running or unreachable
        ServerResponseError: If the MCP server returns an error
    """
    logger.debug(f"Running MCP query: {operation_name} with args: {command_args}")

    # Check server and start if needed
    if not check_mcp_server() and not start_mcp_server():
        raise ServerConnectionError(
            "Sentry MCP server is not running and could not be started"
        )

    # Create a span for this operation
    with sentry_sdk.start_span(
        op="mcp.request", description=f"Sentry MCP: {operation_name}"
    ) as span:
        try:
            # Construct full command
            full_command = ["python", "-m", SERVER_CMD] + command_args

            # Execute command
            result = subprocess.run(
                full_command,
                capture_output=True,
                text=True,
                timeout=DEFAULT_TIMEOUT,
                check=True
            )

            if result.returncode != 0:
                span.set_status("internal_error")
                error_msg = f"MCP server returned error: {result.stderr}"
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg)

            # Try to parse the JSON output
            try:
                data = json.loads(result.stdout)
                span.set_status("ok")
                return data
            except json.JSONDecodeError as e:
                span.set_status("internal_error")
                error_msg = (
                    f"Failed to parse MCP server output: {result.stdout[:200]}..."
                )
                span.set_data("error", error_msg)
                raise ServerResponseError(error_msg) from e

        except subprocess.TimeoutExpired as e:
            span.set_status("internal_error")
            span.set_data("error", "MCP server request timed out")
            raise ServerConnectionError("MCP server request timed out") from e
        except Exception as exc:
            span.set_status("internal_error")
            span.set_data("error", str(exc))
            raise exc


def get_project_stats(
    project_id: str, stat_type: str = "error", days: int = 14
) -> Dict[str, Any]:
    """
    Get project statistics from Sentry.

    Args:
        project_id: Sentry project ID
        stat_type: Type of stats to fetch ('error', 'transaction', 'session')
        days: Number of days of data to fetch

    Returns:
        Dictionary containing project statistics
    """
    return run_mcp_query(
        ["--project-stats", project_id, "--type", stat_type, "--days", str(days)],
        f"Get {stat_type.capitalize()} Stats",
    )


def resolve_issue(issue_id: str) -> Dict[str, Any]:
    """
    Mark a Sentry issue as resolved.

    Args:
        issue_id: Sentry issue ID

    Returns:
        Dictionary containing the updated issue details
    """
    return run_mcp_query(["--resolve-issue", issue_id], "Resolve Issue")


def get_breadcrumbs(event_id: str) -> Dict[str, Any]:
    """
    Get breadcrumbs for a specific Sentry event.

    Args:
        event_id: Sentry event ID

    Returns:
        Dictionary containing breadcrumbs from the event
    """
    return run_mcp_query(["--get-breadcrumbs", event_id], "Get Event Breadcrumbs")


def enable_mcp_integrations() -> bool:
    """
    Configure the SDK to use the Sentry MCP server for enhanced functionality.

    This modifies the Sentry client configuration to ensure proper integration
    with the MCP server capabilities.

    Returns:
        True if configuration was successful, False otherwise
    """
    try:
        # First make sure the server is running
        if not check_mcp_server() and not start_mcp_server():
            logger.error("Cannot enable MCP integrations: Server not running")
            return False

        # Configure the SDK to use the MCP server
        with configure_scope() as scope:
            scope.set_tag("using_mcp_server", "true")
            scope.set_context(
                "mcp_integration",
                {"enabled": True, "server_version": get_server_version()},
            )

        logger.info("Sentry MCP integrations enabled successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to enable MCP integrations: {e}")
        return False


def get_server_version() -> str:
    """
    Get the version of the Sentry MCP server.

    Returns:
        Server version string or "unknown" if unable to determine
    """
    try:
        result = subprocess.run(
            ["python", "-m", SERVER_CMD, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False
        )

        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        return "unknown"
    except Exception:
        return "unknown"


def get_mcp_status() -> Optional[Dict[str, Any]]:
    """
    Get the current status of the Sentry MCP server.

    Returns:
        Dictionary with server status information or None if the server is not running
    """
    if not check_mcp_server():
        logger.debug("MCP server is not running")
        return None

    try:
        # Create a span for this operation
        with sentry_sdk.start_span(
            op="mcp.request", description="Get MCP Server Status"
        ) as span:
            result = subprocess.run(
                ["python", "-m", SERVER_CMD, "--status"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False
            )

            if result.returncode != 0:
                span.set_status("internal_error")
                logger.warning(f"Failed to get MCP server status: {result.stderr}")
                return {
                    "running": True,
                    "responsive": False,
                    "error": (
                        result.stderr.strip() if result.stderr else "Unknown error"
                    ),
                    "version": get_server_version(),
                }

            try:
                # Try to parse JSON output if available
                data = json.loads(result.stdout)
                span.set_status("ok")
                return data
            except json.JSONDecodeError:
                # If not JSON, return basic status
                span.set_status("ok")
                return {
                    "running": True,
                    "responsive": True,
                    "version": get_server_version(),
                    "message": (
                        result.stdout.strip() if result.stdout else "Server running"
                    ),
                }
    except Exception as e:
        logger.error(f"Error checking MCP status: {e}")
        return {
            "running": True,
            "responsive": False,
            "error": str(e),
            "version": "unknown",
        }

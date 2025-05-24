from datetime import datetime
import httpx
import logging
from uuid import uuid4
from config import settings
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy import MetaData
from utils.serializers import to_serialisable


logger = logging.getLogger(__name__)

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = settings.AZURE_OPENAI_ENDPOINT.rstrip("/")
AZURE_OPENAI_API_KEY = settings.AZURE_OPENAI_API_KEY
API_VERSION = "2025-03-01-preview"


async def create_standard_response(
    data=None, message="Success", success=True, status_code=200, headers=None, span_or_transaction=None
):
    """Ensure consistent response structure with support for headers and Sentry tracing"""
    # ---------- NEW: robust serialisation ----------
    safe_data = to_serialisable(data)

    # Let FastAPI handle standard types (datetime, UUID, etc.) and
    # explicitly tell it how to ignore any leftover MetaData objects.
    payload = {
        "status": "success" if success else "error",
        "message": message,
        "data": safe_data if safe_data is not None else ([] if isinstance(data, list) else {}),
        "timestamp": datetime.now().isoformat(),
        "request_id": str(uuid4()),
    }
    resp_headers = dict(headers) if headers else {}

    # Add Sentry trace headers if span_or_transaction provided
    if span_or_transaction:
        try:
            resp_headers["sentry-trace"] = span_or_transaction.to_traceparent()
            if hasattr(span_or_transaction, "containing_transaction"):
                containing_transaction = span_or_transaction.containing_transaction()
                if hasattr(containing_transaction, "_baggage") and hasattr(containing_transaction._baggage, "serialize"):
                    resp_headers["baggage"] = containing_transaction._baggage.serialize()
        except Exception:
            pass

    json_ready = jsonable_encoder(
        payload,
        custom_encoder={MetaData: lambda _x: None}
    )

    return JSONResponse(
        content=json_ready,
        status_code=status_code,
        headers=resp_headers
    )


async def azure_api_request(
    endpoint_path, method="GET", data=None, params=None, headers=None
):
    """
    Makes an HTTP request to the Azure OpenAI API.
    """
    url = f"{AZURE_OPENAI_ENDPOINT}/{endpoint_path}?api-version={API_VERSION}"

    # Set default headers
    request_headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_OPENAI_API_KEY,
    }

    # Add custom headers if provided
    if headers:
        request_headers.update(headers)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                json=data,
                params=params,
                headers=request_headers,
                timeout=60,
            )
            response.raise_for_status()
            return response.json()
    except httpx.RequestError as e:
        logger.error(f"Error calling Azure API: {e}")
        raise RuntimeError(f"Unable to reach Azure API endpoint: {str(e)}")
    except httpx.HTTPStatusError as e:
        logger.error(f"Azure API error: {e.response.text}")
        raise RuntimeError(
            f"Azure API request failed: {e.response.status_code} => "
            f"{e.response.text}"
        )

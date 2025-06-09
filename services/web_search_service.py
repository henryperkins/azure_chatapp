import logging
import os
from typing import List

import httpx

logger = logging.getLogger(__name__)

SERPAPI_ENDPOINT = "https://serpapi.com/search"


async def search(query: str, top_k: int = 5) -> List[str]:
    """
    Perform a web search via SerpAPI (Google engine) and return a list of result links.

    If the environment variable ``SERPAPI_KEY`` is not set, the function will fallback
    to an empty list rather than raising. This prevents runtime crashes in production
    environments where web-search is not yet configured.

    Parameters
    ----------
    query : str
        The search query.
    top_k : int, optional
        Maximum number of links to return (default is 5).

    Returns
    -------
    list[str]
        A list of result URLs (may be empty if the integration is disabled).
    """
    logger.info("[web_search] called", extra={"query": query, "top_k": top_k})

    api_key = os.getenv("SERPAPI_KEY")
    if not api_key:
        logger.warning(
            "SERPAPI_KEY not configured – web-search disabled. Returning empty list.",
            extra={"query": query},
        )
        return []

    params = {"engine": "google", "api_key": api_key, "q": query, "num": max(top_k, 1)}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(SERPAPI_ENDPOINT, params=params)
            response.raise_for_status()
            data: dict = response.json()
    except httpx.HTTPError as exc:
        logger.error("SerpAPI request failed", exc_info=exc)
        return []

    organic_results = data.get("organic_results", []) or []
    links: List[str] = [
        res.get("link") or res.get("url") or "" for res in organic_results[:top_k]
    ]
    # Filter out any empty entries that may occur
    return [link for link in links if link]

import logging
logger = logging.getLogger(__name__)

async def search(query: str, top_k: int = 5) -> list[str]:
    """
    Placeholder until Tavily / SerpAPI is wired-in.
    Raises so callers don’t silently believe search is working.
    """
    logger.info("[web_search] called", extra={"query": query, "top_k": top_k})
    raise NotImplementedError(
        "Web-search integration not implemented.  "
        "Wire Tavily / SerpAPI and remove this exception."
    )

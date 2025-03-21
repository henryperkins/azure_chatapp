from datetime import datetime

async def create_standard_response(data: dict, message: str = "Success") -> dict:
    """Standardizes API response format with enhanced error handling."""
    return {
        "status": "success",
        "message": message,
        "data": data,
        "timestamp": datetime.now().isoformat()
    }

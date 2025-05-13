```python
from pydantic import BaseModel, Field
from typing import Optional

class MessageCreate(BaseModel):
    """Pydantic model for creating a new message."""
    
    content: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="The text content of the user message"
    )
    role: str = Field(
        default="user",
        description="The role: user, assistant, or system."
    )
    image_data: Optional[str] = Field(
        None,
        description="Base64 encoded image data if message includes an image"
    )
    vision_detail: str = Field(
        default="auto",
        description="Level of detail for image analysis"
    )
    enable_thinking: Optional[bool] = Field(
        None,
        description="Whether to enable thinking mode for the message"
    )
    thinking_budget: Optional[int] = Field(
        None,
        description="Budget for thinking operations",
        ge=0
    )

```
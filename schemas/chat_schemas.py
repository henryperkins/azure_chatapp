from pydantic import BaseModel, Field

class MessageCreate(BaseModel):
    content: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Message content with 10k character limit"
    )

Below are the complete, ready-to-run backend files for your “GPT-image-1 + Responses API” playground. Place them under the backend/ directory.

⸻



# backend/requirements.txt
fastapi==0.110.2
uvicorn[standard]==0.29.0
python-multipart==0.0.9
pydantic-settings==2.2.1
openai==1.25.0
python-dotenv==1.0.1
sse-starlette==2.0.0
Pillow==10.3.0



⸻



# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Launch
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]



⸻



# backend/settings.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    azure_openai_endpoint: str
    azure_openai_key: str
    azure_openai_deployment: str
    azure_openai_api_version: str = "2025-03-01-preview"

    model_config = SettingsConfigDict(env_prefix="AZURE_OPENAI_", case_sensitive=False)

settings = Settings()



⸻



# backend/azure_openai.py
import base64
from typing import List, Dict, Any, Optional

from openai import AzureOpenAI
from .settings import settings

client = AzureOpenAI(
    api_key=settings.azure_openai_key,
    azure_endpoint=settings.azure_openai_endpoint,
    api_version=settings.azure_openai_api_version,
)

def generate_images(
    prompt: str,
    n: int = 1,
    size: str = "1024x1024",
    quality: str = "high",
    output_format: str = "PNG",
    user: Optional[str] = None,
) -> List[Dict[str, Any]]:
    response = client.images.generate(
        model=settings.azure_openai_deployment,
        prompt=prompt,
        n=n,
        size=size,
        quality=quality,
        output_format=output_format,
        user=user,
    )
    return [
        {
            "filename": f"gpt-img-{i+1}.{output_format.lower()}",
            "b64": img["b64_json"],
        }
        for i, img in enumerate(response.data)
    ]

def edit_image(
    img_bytes: bytes,
    prompt: str,
    mask_bytes: Optional[bytes] = None,
    size: str = "1024x1024",
    quality: str = "high",
    output_format: str = "PNG",
    user: Optional[str] = None,
) -> Dict[str, Any]:
    """
    In-paints or edits an existing image.
    `mask_bytes` must be a transparent PNG of identical size to `img_bytes`.
    """
    def to_b64(b: bytes) -> str:
        return base64.b64encode(b).decode()

    payload: Dict[str, Any] = {
        "image": to_b64(img_bytes),
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": quality,
        "output_format": output_format,
        "user": user,
    }
    if mask_bytes:
        payload["mask"] = to_b64(mask_bytes)

    # Direct REST call since SDK doesn't yet support images.edits
    url = f"{settings.azure_openai_endpoint}/openai/deployments/{settings.azure_openai_deployment}/images/edits?api-version={settings.azure_openai_api_version}"
    response = client._client.post(url, json=payload, headers={"Content-Type": "application/json"})
    response.raise_for_status()
    img_b64 = response.json()["data"][0]["b64_json"]
    return {
        "filename": f"gpt-img-edit.{output_format.lower()}",
        "b64": img_b64,
    }



⸻



# backend/responses_api.py
import os
import uuid
from typing import AsyncIterator, Dict, Any

from openai import AzureOpenAI
from pydantic import BaseModel, Field

# In-memory store for previous_response_id per conversation
_CONVERSATIONS: Dict[str, str] = {}

client = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2025-03-01-preview"),
)

class ChatInput(BaseModel):
    text: str = Field(..., max_length=4000)
    conversation_id: str | None = None
    model: str = Field("gpt-4o", description="Deployment name")
    temperature: float = 0.7
    top_p: float = 1.0
    stream: bool = True

async def stream_chat(inp: ChatInput) -> AsyncIterator[str]:
    """
    Yields text deltas from the Responses API as they arrive.
    Maintains conversation context with previous_response_id.
    """
    convo_key = inp.conversation_id or str(uuid.uuid4())
    prev_id = _CONVERSATIONS.get(convo_key)

    req_kwargs: Dict[str, Any] = dict(
        model=inp.model,
        stream=True,
        input=[{"role": "user", "content": inp.text}],
        temperature=inp.temperature,
        top_p=inp.top_p,
    )
    if prev_id:
        req_kwargs["previous_response_id"] = prev_id

    resp_stream = client.responses.create(**req_kwargs)  # type: ignore

    full = []
    async for event in resp_stream:
        if event.type == "response.output_text.delta":
            delta = event.delta
            full.append(delta)
            yield delta

    # store for next turn
    _CONVERSATIONS[convo_key] = resp_stream.response.id  # type: ignore[attr-defined]



⸻



# backend/main.py
import os
from pathlib import Path

from fastapi import FastAPI, Form, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .settings import settings
from .azure_openai import generate_images, edit_image
from .responses_api import ChatInput, stream_chat

app = FastAPI(title="GPT-image-1 + Responses Web UI")

# CORS (for local dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# Serve frontend/
frontend_dir = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="static")


@app.post("/api/generate")
async def api_generate(
    prompt: str = Form(..., max_length=4000),
    n: int = Form(1, ge=1, le=10),
    size: str = Form("1024x1024"),
    quality: str = Form("high"),
    output_format: str = Form("PNG"),
    user: str | None = Form(None),
):
    try:
        imgs = generate_images(prompt, n, size, quality, output_format, user)
        return JSONResponse({"images": imgs})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/edit")
async def api_edit(
    image: UploadFile = File(...),
    prompt: str = Form(..., max_length=4000),
    mask: UploadFile | None = File(None),
    size: str = Form("1024x1024"),
    quality: str = Form("high"),
    output_format: str = Form("PNG"),
    user: str | None = Form(None),
):
    try:
        orig = await image.read()
        m = await mask.read() if mask else None
        edited = edit_image(orig, prompt, m, size, quality, output_format, user)
        return JSONResponse({"image": edited})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat", response_class=EventSourceResponse)
async def chat_endpoint(body: ChatInput):
    """
    Streams assistant responses via SSE.  
    Client should send ChatInput as JSON.
    """
    async def event_gen():
        async for chunk in stream_chat(body):
            yield {"data": chunk}
        yield {"event": "done", "data": ""}
    return EventSourceResponse(event_gen())



⸻

With these in place, run:

cd gpt-image-ui/backend
docker build -t gpt-image-ui-backend .
docker run --env-file .env -p 8000:8000 gpt-image-ui-backend

—and your FastAPI backend will serve both the image-generation/editing endpoints and the streaming Responses-API chat endpoint.
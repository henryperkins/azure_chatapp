# [[Azure OpenAI Vision-Enabled Chats]]

**Path:** Azure OpenAI Vision-Enabled Chats.md

---

## Overview
Vision-enabled chat models are **large multimodal models (LMM)** developed by OpenAI that analyze images and provide textual responses. These models combine **natural language processing** and **visual understanding**. The current vision-enabled models include:  
- [o1](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning)  
- GPT-4o  
- GPT-4o-mini  
- GPT-4 Turbo with Vision  

These models answer general questions about the content of uploaded images.

**Tip:**  
To use these models, call the **Chat Completion API** on a supported deployed model. If unfamiliar with the API, refer to the [Vision-enabled chat how-to guide](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/chatgpt?tabs=python&pivots=programming-language-chat-completions).

---

## Call the Chat Completion APIs

Below is the basic process to use vision-enabled chat models programmatically. For first-time users, start with the [Chat with images quickstart](https://learn.microsoft.com/en-us/azure/ai-services/openai/gpt-v-quickstart).

### **Steps:**
1. **Define Azure OpenAI Resource Details:**  
   - Endpoint (e.g., `https://YOUR_RESOURCE_NAME.openai.azure.com/`)  
   - API Key  
   - Model Deployment Name  

2. **Create a Client Object:**  
   ```python
   api_base = '<your_azure_openai_endpoint>'  
   api_key = "<your_azure_openai_key>"  
   deployment_name = '<your_deployment_name>'  
   api_version = '2024-02-15-preview'  # Subject to change  

   client = AzureOpenAI(
       api_key=api_key,  
       api_version=api_version,
       base_url=f"{api_base}openai/deployments/{deployment_name}",
   )
   ```

3. **Call the `create` Method:**  
   Example request body:  
   ```python
   response = client.chat.completions.create(
       model=deployment_name,
       messages=[
           {"role": "system", "content": "You are a helpful assistant."},
           {"role": "user", "content": [
               {"type": "text", "text": "Describe this picture:"},
               {"type": "image_url", "image_url": {"url": "<image URL>"}}
           ]}
       ],
       max_tokens=2000  # Required to avoid truncated output
   )
   print(response)
   ```

**Tip:**  
For local images, convert them to base64 using Python:  
```python
import base64
from mimetypes import guess_type

def local_image_to_data_url(image_path):
    mime_type, _ = guess_type(image_path)
    if mime_type is None:
        mime_type = 'application/octet-stream'

    with open(image_path, "rb") as image_file:
        base64_encoded_data = base64.b64encode(image_file.read()).decode('utf-8')

    return f"data:{mime_type};base64,{base64_encoded_data}"

# Usage
image_path = '<path_to_image>'
data_url = local_image_to_data_url(image_path)
print("Data URL:", data_url)
```

Pass the base64 data to the API:  
```json
"image_url": {
   "url": "data:image/jpeg;base64,<your_image_data>"
}
```

### **Detail Parameter Settings**
Optionally set the `"detail"` parameter in `"image_url"` to control image processing:  
- **`auto`**: Default. Model decides between `low` or `high` based on image size.  
- **`low`**: Processes a 512x512 version for quicker responses and lower token usage.  
- **`high`**: Activates "high res" mode, generating detailed 512x512 segments (uses double the token budget).  

Example:  
```json
{
    "type": "image_url",
    "image_url": {
        "url": "<image URL>",
        "detail": "high"
    }
}
```

For token usage and pricing details, see [Azure OpenAI Image Tokens](https://learn.microsoft.com/en-us/azure/ai-services/openai/overview#image-tokens).

---

## Output
Example API response:  
```json
{
    "id": "chatcmpl-8VAVx58veW9RCm5K1ttmxU6Cm4XDX",
    "object": "chat.completion",
    "created": 1702439277,
    "model": "gpt-4",
    "prompt_filter_results": [
        {
            "prompt_index": 0,
            "content_filter_results": {
                "hate": {"filtered": false, "severity": "safe"},
                "self_harm": {"filtered": false, "severity": "safe"},
                "sexual": {"filtered": false, "severity": "safe"},
                "violence": {"filtered": false, "severity": "safe"}
            }
        }
    ],
    "choices": [
        {
            "finish_reason": "stop",
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "The picture shows an individual in formal attire...truncated for brevity."
            },
            "content_filter_results": {
                "hate": {"filtered": false, "severity": "safe"},
                "self_harm": {"filtered": false, "severity": "safe"},
                "sexual": {"filtered": false, "severity": "safe"},
                "violence": {"filtered": false, "severity": "safe"}
            }
        }
    ],
    "usage": {
        "prompt_tokens": 1156,
        "completion_tokens": 80,
        "total_tokens": 1236
    }
}
```

**Finish Reason:**  
- `stop`: Complete output returned.  
- `length`: Incomplete due to `max_tokens` or model limit.  
- `content_filter`: Content omitted due to filtering.

---

## GPT-4 Turbo Model Upgrade
**Latest GA Release:**  
- `gpt-4` **Version:** `turbo-2024-04-09`  

**Replaces Preview Models:**  
- `gpt-4` **Version:** `1106-Preview`  
- `gpt-4` **Version:** `0125-Preview`  
- `gpt-4` **Version:** `vision-preview`  

### Key Differences:
1. **OpenAI vs. Azure OpenAI:**  
   - OpenAI's `0409` supports JSON mode and function calling for all requests.  
   - Azure OpenAI's `turbo-2024-04-09` does **not** support JSON mode or function calling with image input (text-only requests do).  

2. **Differences from `vision-preview`:**  
   - Azure AI Vision enhancements (OCR, object grounding, video prompts) are **not supported** in `turbo-2024-04-09`.  
   **Important:** These preview features will be retired once `vision-preview` is upgraded.  

3. **Provisioned Models:**  
   - `turbo-2024-04-09` (provisioned) does **not** support image/vision requests (text-only).  
   - Standard deployments support both text and image requests.  

### Deployment:  
In the Azure AI Foundry portal:  
1. Select `GPT-4`.  
2. Choose `turbo-2024-04-09` from the dropdown.  
Quota remains the same as GPT-4 Turbo. See [regional quota limits](https://learn.microsoft.com/en-us/azure/ai-services/openai/quotas-limits).

---

## Next Steps
- [Learn more about Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/overview)  
- [Vision-enabled chats quickstart](https://learn.microsoft.com/en-us/azure/ai-services/openai/gpt-v-quickstart)  
- [GPT-4 Turbo with Vision FAQ](https://learn.microsoft.com/en-us/azure/ai-services/openai/faq#gpt-4-turbo-with-vision)  
- [GPT-4 Turbo with Vision API reference](https://aka.ms/gpt-v-api-ref)
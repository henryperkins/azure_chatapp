# [[Claude Vision]]

## Build with Claude

**Vision**  
The Claude 3 family of models comes with new vision capabilities that allow Claude to understand and analyze images, opening up exciting possibilities for multimodal interaction.  

This guide describes how to work with images in Claude, including best practices, code examples, and limitations to keep in mind.

## How to Use Vision
Use Claude’s vision capabilities via:  
- **claude.ai**: Upload an image like you would a file, or drag and drop an image directly into the chat window.  
- **Console Workbench**: If you select a model that accepts images (Claude 3 models only), a button to add images appears at the top right of every User message block.  
- **API request**: See the examples in this guide.  

## Before You Upload  

### Basics and Limits  
- Include up to **20 images** in a single request for claude.ai and **100 images** for API requests.  
- Claude analyzes all provided images when formulating its response, useful for comparing or contrasting images.  
- Images larger than **8000x8000 px** are rejected. For API requests with more than 20 images, the limit is **2000x2000 px**.  

### Evaluate Image Size  
- Resize images if the long edge exceeds **1568 pixels** or if the image is more than ~**1,600 tokens**.  
- Oversized images increase latency without improving performance.  
- Very small images (under **200 pixels** on any edge) may degrade performance.  
- Recommended: Resize images to **≤1.15 megapixels** and within **1568 pixels** in both dimensions.  

**Maximum Image Sizes (No Resizing):**  
| Aspect Ratio | Image Size       |  
|--------------|------------------|  
| 1:1          | 1092x1092 px     |  
| 3:4          | 951x1268 px      |  
| 2:3          | 896x1344 px      |  
| 9:16         | 819x1456 px      |  
| 1:2          | 784x1568 px      |  

### Calculate Image Costs  
- Each image counts toward token usage. Estimate tokens: `tokens = (width px * height px) / 750`.  
- Example costs (Claude 3.7 Sonnet, $3/million tokens):  
  | Image Size       | Tokens | Cost / Image | Cost / 1K Images |  
  |------------------|--------|--------------|------------------|  
  | 200x200 px       | ~54    | ~$0.00016    | ~$0.16           |  
  | 1000x1000 px     | ~1334  | ~$0.004      | ~$4.00           |  
  | 1092x1092 px     | ~1590  | ~$0.0048     | ~$4.80           |  

### Ensuring Image Quality  
- **Format**: Use JPEG, PNG, GIF, or WebP.  
- **Clarity**: Ensure images are clear, not blurry or pixelated.  
- **Text**: Make text legible and avoid cropping key visual context.  

## Prompt Examples  
Place images **before text** for best results. Examples below use **base64** or **URL** references.  

### Base64-Encoded Image Example  
```bash
# For URL-based images, use the URL directly in JSON requests.  
# For base64-encoded images, encode the image first:  
BASE64_IMAGE_DATA=$(curl -s "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg" | base64)  

curl https://api.anthropic.com/v1/messages \  
  -H "x-api-key: $ANTHROPIC_API_KEY" \  
  -H "anthropic-version: 2023-06-01" \  
  -H "content-type: application/json" \  
  -d '{  
    "model": "claude-3-7-sonnet-20250219",  
    "max_tokens": 1024,  
    "messages": [  
      {  
        "role": "user",  
        "content": [  
          {  
            "type": "image",  
            "source": {  
              "type": "base64",  
              "media_type": "image/jpeg",  
              "data": "'"$BASE64_IMAGE_DATA"'"  
            }  
          },  
          {  
            "type": "text",  
            "text": "Describe this image."  
          }  
        ]  
      }  
    ]  
  }'
```

### URL-Based Image Example  
```bash
curl https://api.anthropic.com/v1/messages \  
  -H "x-api-key: $ANTHROPIC_API_KEY" \  
  -H "anthropic-version: 2023-06-01" \  
  -H "content-type: application/json" \  
  -d '{  
    "model": "claude-3-7-sonnet-20250219",  
    "max_tokens": 1024,  
    "messages": [  
      {  
        "role": "user",  
        "content": [  
          {  
            "type": "image",  
            "source": {  
              "type": "url",  
              "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"  
            }  
          },  
          {  
            "type": "text",  
            "text": "Describe this image."  
          }  
        ]  
      }  
    ]  
  }'
```

### Example: One Image  
**Role**: User  
**Content**: `[Image] Describe this image.`  

**Python (Base64):**  
```python
message = client.messages.create(  
    model="claude-3-7-sonnet-20250219",  
    max_tokens=1024,  
    messages=[  
        {  
            "role": "user",  
            "content": [  
                {  
                    "type": "image",  
                    "source": {  
                        "type": "base64",  
                        "media_type": image1_media_type,  
                        "data": image1_data,  
                    },  
                },  
                {  
                    "type": "text",  
                    "text": "Describe this image."  
                }  
            ],  
        }  
    ],  
)
```

### Example: Multiple Images  
**Role**: User  
**Content**: `Image 1: [Image 1] Image 2: [Image 2] How are these images different?`  

**Python (URL):**  
```python
message = client.messages.create(  
    model="claude-3-7-sonnet-20250219",  
    max_tokens=1024,  
    messages=[  
        {  
            "role": "user",  
            "content": [  
                {"type": "text", "text": "Image 1:"},  
                {  
                    "type": "image",  
                    "source": {"type": "url", "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"},  
                },  
                {"type": "text", "text": "Image 2:"},  
                {  
                    "type": "image",  
                    "source": {"type": "url", "url": "https://upload.wikimedia.org/wikipedia/commons/b/b5/Iridescent.green.sweat.bee1.jpg"},  
                },  
                {"type": "text", "text": "How are these images different?"},  
            ],  
        }  
    ],  
)
```

### Example: Multiple Images with System Prompt  
**System**: Respond only in Spanish.  
**User**: `Image 1: [Image 1] Image 2: [Image 2] How are these images different?`  

**Python (Base64):**  
```python
message = client.messages.create(  
    model="claude-3-7-sonnet-20250219",  
    max_tokens=1024,  
    system="Respond only in Spanish.",  
    messages=[  
        {  
            "role": "user",  
            "content": [  
                {"type": "text", "text": "Image 1:"},  
                {  
                    "type": "image",  
                    "source": {  
                        "type": "base64",  
                        "media_type": image1_media_type,  
                        "data": image1_data,  
                    },  
                },  
                {"type": "text", "text": "Image 2:"},  
                {  
                    "type": "image",  
                    "source": {  
                        "type": "base64",  
                        "media_type": image2_media_type,  
                        "data": image2_data,  
                    },  
                },  
                {"type": "text", "text": "How are these images different?"},  
            ],  
        }  
    ],  
)
```

### Example: Four Images Across Two Conversation Turns  
**User**: `Image 1: [Image 1] Image 2: [Image 2] How are these images different?`  
**Assistant**: [Claude’s response]  
**User**: `Image 1: [Image 3] Image 2: [Image 4] Are these images similar to the first two?`  
**Assistant**: [Claude’s response]  

## Limitations  
- **People Identification**: Cannot name people in images.  
- **Accuracy**: May hallucinate with low-quality, rotated, or small images.  
- **Spatial Reasoning**: Limited ability for precise localization tasks.  
- **Counting**: Approximate counts, especially for small objects.  
- **AI-Generated Images**: Cannot detect if an image is AI-generated.  
- **Inappropriate Content**: Rejects explicit or policy-violating images.  
- **Healthcare**: Not for complex diagnostic scans; consult professionals.  

## FAQ  
**Supported Formats**: JPEG, PNG, GIF, WebP.  
**URL Support**: Yes, use `"type": "url"` in API requests.  
**File Size Limits**: API: 5MB, claude.ai: 10MB.  
**Image Limits**: API: 100/request, claude.ai: 20/turn.  
**Metadata**: Not parsed.  
**Deletion**: Images are ephemeral and auto-deleted after processing.  
**Privacy**: Refer to our privacy policy.  
**Incorrect Interpretations**: Ensure image quality, try prompt engineering, or contact support.  
**Image Generation**: Claude cannot generate or edit images.  

## Dive Deeper into Vision  
- **Multimodal Cookbook**: Tips for image-based tasks.  
- **API Reference**: Documentation for image-related API calls.  
- **Support**: Reach out to our team or join the developer community.
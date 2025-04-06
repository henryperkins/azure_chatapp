# [[Azure OpenAI Reasoning Models]]

**Path:** Azure OpenAI Reasoning Models.md  
**Last Updated:** 03/28/2025  
**Contributors:** 1  

---

## Overview
Azure OpenAI **o-series models** are designed to tackle **reasoning and problem-solving tasks** with increased focus and capability. These models spend more time processing and understanding user requests, excelling in areas like **science, coding, and math** compared to previous iterations.

### Key Capabilities
- **Complex Code Generation:** Generates algorithms and handles advanced coding tasks.  
- **Advanced Problem Solving:** Ideal for comprehensive brainstorming and addressing multifaceted challenges.  
- **Complex Document Comparison:** Analyzes contracts, case files, or legal documents to identify subtle differences.  
- **Instruction Following and Workflow Management:** Effective for managing workflows requiring shorter contexts.  

---

## Availability

### Region Availability
| **Model**       | **Region**          | **Limited Access**                                                                 |
|------------------|---------------------|-----------------------------------------------------------------------------------|
| `o3-mini`       | Model availability. | Access is no longer restricted for this model.                                    |
| `o1`            | Model availability. | Access is no longer restricted for this model.                                    |
| `o1-preview`    | Model availability. | Available only to customers granted access during the original limited release.   |
| `o1-mini`       | Model availability. | No access request needed for Global Standard deployments.                         |

**Note:** Standard (regional) deployments are available only to select customers who were part of the `o1-preview` release.

---

## API & Feature Support

| **Feature**               | **o3-mini (2025-01-31)** | **o1 (2024-12-17)** | **o1-preview (2024-09-12)** | **o1-mini (2024-09-12)** |
|---------------------------|--------------------------|---------------------|-----------------------------|--------------------------|
| **API Version**           | 2024-12-01-preview or later<br>2025-03-01-preview (Recommended) | 2024-12-01-preview or later<br>2025-03-01-preview (Recommended) | 2024-09-01-preview or later<br>2025-03-01-preview (Recommended) | 2024-09-01-preview or later<br>2025-03-01-preview (Recommended) |
| **Developer Messages**    | ✅                       | ✅                   | -                           | -                        |
| **Structured Outputs**    | ✅                       | ✅                   | -                           | -                        |
| **Context Window**        | Input: 200,000<br>Output: 100,000 | Input: 200,000<br>Output: 100,000 | Input: 128,000<br>Output: 32,768 | Input: 128,000<br>Output: 65,536 |
| **Reasoning Effort**      | ✅                       | ✅                   | -                           | -                        |
| **Vision Support**        | -                        | ✅                   | -                           | -                        |
| **Functions/Tools**       | ✅                       | ✅                   | -                           | -                        |
| **max_completion_tokens** | ✅                       | ✅                   | ✅                           | ✅                        |
| **System Messages**       | ✅                       | ✅                   | -                           | -                        |
| **Streaming**             | ✅                       | -                   | -                           | -                        |

**Notes:**  
- Reasoning models only work with the `max_completion_tokens` parameter.  
- System messages in `o3-mini` and `o1` are treated as developer messages. Avoid using both in the same API request.  

### Unsupported Features
- Parallel tool calling  
- `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logprobs`, `top_logprobs`, `logit_bias`, `max_tokens`  

---

## Usage
These models do not support all parameters available in the chat completions API. Below is an example usage in Python:

### Python Example (Microsoft Entra ID)
```python
from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-12-01-preview"
)

response = client.chat.completions.create(
    model="o1-new",  # Replace with your deployment name
    messages=[
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens=5000
)

print(response.model_dump_json(indent=2))
```

**Output Example:**
```json
{
  "id": "chatcmpl-AEj7pKFoiTqDPHuxOcirA9KIvf3yz",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "Writing your first Python API is an exciting step...truncated for brevity.",
        "role": "assistant"
      },
      "content_filter_results": {
        "hate": {
          "filtered": false,
          "severity": "safe"
        },
        "protected_material_code": {
          "filtered": false,
          "detected": false
        }
      }
    }
  ],
  "usage": {
    "completion_tokens": 1843,
    "prompt_tokens": 20,
    "total_tokens": 1863,
    "completion_tokens_details": {
      "reasoning_tokens": 448
    }
  }
}
```

---

## Reasoning Effort
Reasoning models include `reasoning_tokens` in `completion_tokens_details`. These tokens are used internally to generate responses but are not returned in the output. The `reasoning_effort` parameter (available in API version `2024-12-01-preview` and later) can be set to `low`, `medium`, or `high`. Higher effort increases processing time and the number of `reasoning_tokens`.

---

## Developer Messages
Developer messages (`role: "developer"`) function similarly to system messages. Example:

```python
response = client.chat.completions.create(
    model="o1-new",
    messages=[
        {"role": "developer", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What steps should I think about when writing my first Python API?"},
    ],
    max_completion_tokens=5000
)
```

---

## Markdown Output
By default, `o3-mini` and `o1` do not include markdown formatting in responses. To enable markdown for code blocks, add `Formatting re-enabled` to the developer message:

**Examples:**  
- `Formatting re-enabled - please enclose code blocks with appropriate markdown tags.`  
- `Formatting re-enabled - code output should be wrapped in markdown.`  

**Note:** This increases the likelihood of markdown formatting but does not guarantee it. Customize the message for specific use cases.
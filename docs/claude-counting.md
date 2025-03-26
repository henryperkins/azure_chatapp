# Messages API: Count Message Tokens

Count the number of tokens in a Message, including tools, images, and documents, without creating it.  

[Learn more about token counting in our user guide](https://docs.anthropic.com/en/api/messages-count-tokens)

## Endpoint

**POST**  
`/v1/messages/count_tokens`

## Request Examples

### cURL
```bash
curl https://api.anthropic.com/v1/messages/count_tokens \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data \
'{
    "model": "claude-3-7-sonnet-20250219",
    "messages": [
        {"role": "user", "content": "Hello, world"}
    ]
}'
```

### Python
```python
# Python example (requires requests library)
import requests

url = "https://api.anthropic.com/v1/messages/count_tokens"
headers = {
    "x-api-key": "$ANTHROPIC_API_KEY",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
}
data = {
    "model": "claude-3-7-sonnet-20250219",
    "messages": [{"role": "user", "content": "Hello, world"}]
}
response = requests.post(url, headers=headers, json=data)
print(response.json())
```

### JavaScript
```javascript
// JavaScript example (using fetch API)
const url = "https://api.anthropic.com/v1/messages/count_tokens";
const headers = {
    "x-api-key": "$ANTHROPIC_API_KEY",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
};
const data = {
    "model": "claude-3-7-sonnet-20250219",
    "messages": [{"role": "user", "content": "Hello, world"}]
};

fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(data)
})
.then(response => response.json())
.then(data => console.log(data));
```

## Response

**200 OK**  
```json
{
  "input_tokens": 2095
}
```

**4XX Errors**  
Details of specific error responses are not provided here.

## Headers

| **Header**            | **Type**     | **Required** | **Description**                                                                 |
|-----------------------|--------------|--------------|---------------------------------------------------------------------------------|
| `anthropic-beta`      | `string[]`   | Optional     | Specify beta version(s) to use (comma-separated or multiple headers).           |
| `anthropic-version`   | `string`     | Required     | The API version to use. [Version history](https://docs.anthropic.com/en/api/versioning). |
| `x-api-key`           | `string`     | Required     | Your API key for authentication. Get it from the [Console](https://console.anthropic.com). |

## Body Parameters

**Content-Type**: `application/json`

### `messages`
- **Type**: `object[]`  
- **Required**: Yes  
- **Description**: Input messages. Each message must have a `role` and `content`. Supports text, images, and tools.  
  - **Example with a single user message**:  
    ```json
    [{"role": "user", "content": "Hello, Claude"}]
    ```
  - **Example with multiple conversational turns**:  
    ```json
    [
      {"role": "user", "content": "Hello there."},
      {"role": "assistant", "content": "Hi, I'm Claude. How can I help you?"},
      {"role": "user", "content": "Can you explain LLMs in plain English?"}
    ]
    ```
  - **Example with a partially-filled response from Claude**:  
    ```json
    [
      {"role": "user", "content": "What's the Greek name for Sun? (A) Sol (B) Helios (C) Sun"},
      {"role": "assistant", "content": "The best answer is ("}
    ]
    ```
  - **Content format**:  
    Each message content can be a single string or an array of content blocks. For example:  
    ```json
    {"role": "user", "content": "Hello, Claude"}
    ```
    is equivalent to:  
    ```json
    {"role": "user", "content": [{"type": "text", "text": "Hello, Claude"}]}
    ```
  - **Image content blocks** (Claude 3+):  
    ```json
    {"role": "user", "content": [
      {
        "type": "image",
        "source": {
          "type": "base64",
          "media_type": "image/jpeg",
          "data": "/9j/4AAQSkZJRg..."
        }
      },
      {"type": "text", "text": "What is in this image?"}
    ]}
    ```
    Supported image types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

### `model`
- **Type**: `string`  
- **Required**: Yes  
- **Description**: The model to use. [See models](https://docs.anthropic.com/en/api/models).  
- **Length**: 1 - 256 characters.

### `system`
- **Type**: `string`  
- **Required**: No  
- **Description**: System prompt for context or instructions.  

### `thinking`
- **Type**: `object`  
- **Required**: No  
- **Description**: Enable Claude's extended thinking. Requires a minimum budget of 1,024 tokens.  

### `tool_choice`
- **Type**: `object`  
- **Required**: No  
- **Options**: `Auto`, `Any`, `Tool`, `ToolChoiceNone`  
- **Description**: Control how the model uses tools.  

### `tools`
- **Type**: `object[]`  
- **Required**: No  
- **Description**: Definitions of tools the model can use. Each tool includes:  
  - **`name`**: Tool name (1-64 characters).  
  - **`description`**: Optional tool description.  
  - **`input_schema`**: JSON schema for tool input.  
  - **Example**:  
    ```json
    [
      {
        "name": "get_stock_price",
        "description": "Get current stock price for a ticker symbol.",
        "input_schema": {
          "type": "object",
          "properties": {
            "ticker": {
              "type": "string",
              "description": "Stock ticker symbol, e.g., AAPL."
            }
          },
          "required": ["ticker"]
        }
      }
    ]
    ```
  - **Tool usage example**:  
    If the model uses the tool:  
    ```json
    [
      {
        "type": "tool_use",
        "id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV",
        "name": "get_stock_price",
        "input": {"ticker": "^GSPC"}
      }
    ]
    ```
    Return results to the model:  
    ```json
    [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV",
        "content": "259.75 USD"
      }
    ]
    ```
  - **Predefined tools**:  
    `Custom Tool`, `ComputerUseTool_20241022`, `BashTool_20241022`, `TextEditor_20241022`, `ComputerUseTool_20250124`, `BashTool_20250124`, `TextEditor_20250124`.

#### Child Attributes of `tools`
- **`input_schema`**:  
  - **Type**: `object`  
  - **Required**: Yes  
  - **Description**: JSON schema for tool input.  
- **`name`**:  
  - **Type**: `string`  
  - **Required**: Yes  
  - **Length**: 1 - 64 characters.  
- **`cache_control`**:  
  - **Type**: `object` or `null`  
- **`description`**:  
  - **Type**: `string`  
  - **Required**: No  
- **`type`**:  
  - **Type**: `enum<string>` or `null`  
  - **Options**: `custom`  

## Response Schema

**200 OK**  
```json
{
  "input_tokens": integer
}
```
- **`input_tokens`**: Total tokens in the request (messages, system prompt, tools).
```

This version includes **all details** from the original note, structured for clarity and readability. Let me know if further adjustments are needed!
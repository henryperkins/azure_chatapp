## Messages API Overview

Send a structured list of input messages with text and/or image content, and the model will generate the next message in the conversation. The Messages API can be used for either single queries or stateless multi-turn conversations.

**Learn more:** [Messages API User Guide](https://docs.anthropic.com/en/docs/initial-setup)

## API Endpoint

```
POST /v1/messages
```

## Example Request (cURL)

```bash
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-3-7-sonnet-20250219",
    "max_tokens": 1024,
    "messages": [
        {"role": "user", "content": "Hello, world"}
    ]
}'
```

## Example Response (200 OK)

```json
{
  "content": [
    {
      "text": "Hi! My name is Claude.",
      "type": "text"
    }
  ],
  "id": "msg_013Zva2CMHLNnXjNJJKqJ2EF",
  "model": "claude-3-7-sonnet-20250219",
  "role": "assistant",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "type": "message",
  "usage": {
    "input_tokens": 2095,
    "output_tokens": 503
  }
}
```

## Headers

### `anthropic-beta`
- **Type:** `string[]`
- **Description:** Optional header to specify beta versions. Use a comma-separated list or multiple headers.
  - **Example:** `beta1,beta2`

### `anthropic-version`
- **Type:** `string`
- **Required:** Yes
- **Description:** Specifies the API version. See [version history](https://docs.anthropic.com/en/api/versioning).
  - **Example:** `2023-06-01`

### `x-api-key`
- **Type:** `string`
- **Required:** Yes
- **Description:** Your unique API key for authentication. Get it from the [Console](https://console.anthropic.com/settings/keys).
  - **Example:** `sk-XXXXXX`

## Body Parameters

### `max_tokens`
- **Type:** `integer`
- **Required:** Yes
- **Description:** Maximum number of tokens to generate. Must be greater than 1.
  - **Range:** `x > 1`

### `messages`
- **Type:** `object[]`
- **Required:** Yes
- **Description:** Input messages with alternating `user` and `assistant` turns. Each message must have a `role` and `content`.

#### Example Messages
```json
[
  {"role": "user", "content": "Hello, Claude"},
  {"role": "assistant", "content": "Hi, how can I help?"}
]
```

### `model`
- **Type:** `string`
- **Required:** Yes
- **Description:** Model to use. See [models overview](https://docs.anthropic.com/en/docs/models-overview).
  - **Length:** `1 - 256`

### `metadata`
- **Type:** `object`
- **Description:** Metadata about the request, including `user_id`.

#### `metadata.user_id`
- **Type:** `string | null`
- **Description:** External identifier for the user. Should be a UUID, hash, or opaque identifier.
  - **Length:** Maximum `256`

### `stop_sequences`
- **Type:** `string[]`
- **Description:** Custom sequences to stop generation.

### `stream`
- **Type:** `boolean`
- **Description:** Enable streaming responses. See [streaming guide](https://docs.anthropic.com/en/api/messages-streaming).

### `system`
- **Type:** `string`
- **Description:** System prompt for context and instructions.

### `temperature`
- **Type:** `number`
- **Description:** Randomness in response. Range: `0.0` to `1.0`.
  - **Range:** `0 < x < 1`

### `thinking`
- **Type:** `object`
- **Description:** Enables extended thinking. Requires `budget_tokens` ≥ 1024.

#### `thinking.budget_tokens`
- **Type:** `integer`
- **Required:** Yes
- **Description:** Tokens for internal reasoning. Must be ≥1024 and less than `max_tokens`.
  - **Range:** `x > 1024`

#### `thinking.type`
- **Type:** `enum<string>`
- **Required:** Yes
- **Options:** `enabled`

### `tool_choice`
- **Type:** `object`
- **Description:** How the model uses tools. Options: Auto, Any, Tool, ToolChoiceNone.

#### `tool_choice.type`
- **Type:** `enum<string>`
- **Required:** Yes
- **Options:** `auto`

#### `tool_choice.disable_parallel_tool_use`
- **Type:** `boolean`
- **Description:** Disable parallel tool use. Defaults to `false`.

### `tools`
- **Type:** `object[]`
- **Description:** Definitions of tools the model can use.

#### `tools.name`
- **Type:** `string`
- **Required:** Yes
- **Description:** Name of the tool.
  - **Length:** `1 - 64`

#### `tools.description`
- **Type:** `string`
- **Description:** Detailed description of the tool.

#### `tools.input_schema`
- **Type:** `object`
- **Required:** Yes
- **Description:** [JSON schema](https://json-schema.org/draft/2020-12) for tool input.

#### `tools.type`
- **Type:** `enum<string> | null`
- **Options:** `custom`

### `top_k`
- **Type:** `integer`
- **Description:** Sample from top K options for each token.
  - **Range:** `x > 0`

### `top_p`
- **Type:** `number`
- **Description:** Use nucleus sampling. Range: `0.0` to `1.0`.
  - **Range:** `0 < x < 1`

## Response Parameters

### `content`
- **Type:** `object[]`
- **Description:** Generated content blocks (e.g., text, tool use).

### `id`
- **Type:** `string`
- **Description:** Unique message identifier.

### `model`
- **Type:** `string`
- **Description:** Model that handled the request.
  - **Length:** `1 - 256`

### `role`
- **Type:** `enum<string>`
- **Options:** `assistant`

### `stop_reason`
- **Type:** `enum<string> | null`
- **Options:** `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`

### `stop_sequence`
- **Type:** `string | null`
- **Description:** Custom stop sequence generated.

### `type`
- **Type:** `enum<string>`
- **Options:** `message`

### `usage`
- **Type:** `object`
- **Description:** Token usage details for billing and rate limits.

#### `usage.input_tokens`
- **Type:** `integer`
- **Range:** `x > 0`

#### `usage.output_tokens`
- **Type:** `integer`
- **Range:** `x > 0`

## Additional Examples

### Image Content Block
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

### Tool Definition Example
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

### Tool Use Response Example
```json
[
  {
    "type": "tool_use",
    "id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV",
    "name": "get_stock_price",
    "input": { "ticker": "^GSPC" }
  }
]
```

### Tool Result Example
```json
[
  {
    "type": "tool_result",
    "tool_use_id": "toolu_01D7FLrfh4GYq7yT1ULFeyMV",
    "content": "259.75 USD"
  }
]
```

## Notes
- Use `system` for system prompts (no `"system"` role needed).
- Supported image formats: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.
- See [Tool Use Guide](https://docs.anthropic.com/en/docs/tool-use) for more details.
```

This format ensures all details are included, properly structured, and easy to read.
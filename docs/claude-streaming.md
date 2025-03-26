## Streaming Messages Overview

To enable streaming, set `"stream": true` in your request. This allows the response to be delivered incrementally using [server-sent events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Streaming with SDKs

Our [Python](https://github.com/anthropics/anthropic-sdk-python) and [TypeScript](https://github.com/anthropics/anthropic-sdk-typescript) SDKs support streaming. The Python SDK offers both synchronous and asynchronous streaming options. Refer to the SDK documentation for detailed usage.

### Python Example

```python
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
    model="claude-3-7-sonnet-20250219",
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

## Event Types

Each server-sent event includes a named event type and associated JSON data. The stream follows this event flow:

1. **`message_start`**: Contains a `Message` object with empty `content`.
2. **Content Blocks**: Each block includes:
   - `content_block_start`
   - One or more `content_block_delta` events
   - `content_block_stop`
3. **`message_delta`**: Indicates top-level changes to the final `Message` object.
4. **`message_stop`**: Marks the end of the stream.

### Ping Events

Periodic `ping` events may be included to keep the connection alive.

### Error Events

Errors (e.g., `overloaded_error`) are sent as `error` events:

```json
event: error
data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
```

### Other Events

New event types may be added in the future. Ensure your code handles unknown events gracefully.

## Delta Types

`content_block_delta` events update content blocks incrementally.

### Text Delta

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}
```

### Input JSON Delta (Tool Use)

Partial JSON updates for tool inputs:

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"location\": \"San Francisco\""}}
```

### Thinking Delta

For [extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#streaming-extended-thinking):

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Step 1: Break down the problem..."}}
```

### Signature Delta

Verifies the integrity of thinking blocks:

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA..."}}
```

## Raw HTTP Stream Response

Direct API integration requires handling SSE events manually. Example flow:

1. `message_start`
2. Content blocks (start, deltas, stop)
3. `message_delta`
4. `message_stop`

## Basic Streaming Request

### Request

```bash
curl https://api.anthropic.com/v1/messages \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --data \
'{
  "model": "claude-3-7-sonnet-20250219",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 256,
  "stream": true
}'
```

### Response

```json
event: message_start
data: {"type": "message_start", "message": {"id": "msg_1nZdL29xx...", "role": "assistant", "content": []}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: message_stop
data: {"type": "message_stop"}
```

## Streaming with Tool Use

### Request

```bash
curl https://api.anthropic.com/v1/messages \
    -H "content-type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d '{
      "model": "claude-3-7-sonnet-20250219",
      "tools": [
        {
          "name": "get_weather",
          "input_schema": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            }
          }
        }
      ],
      "messages": [{"role": "user", "content": "Weather in San Francisco?"}],
      "stream": true
    }'
```

### Response

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"location\": \"San Francisco\""}}
```

## Streaming with Extended Thinking

### Request

```bash
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --data \
'{
    "model": "claude-3-7-sonnet-20250219",
    "stream": true,
    "thinking": {"type": "enabled", "budget_tokens": 16000},
    "messages": [{"role": "user", "content": "What is 27 * 453?"}]
}'
```

### Response

```json
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Step 1: Break down 27 * 453..."}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA..."}}
```

## Notes
- Use SDKs for easier streaming handling.
- Partial JSON deltas require accumulation and parsing.
- Thinking signatures verify block integrity.
- New event types may be added; handle unknown events gracefully.
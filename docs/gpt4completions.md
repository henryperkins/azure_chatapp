# Work with chat completions models

- Article
- 03/27/2025
- 3 contributors

## In this article

1. [Work with chat completion models](#work-with-chat-completion-models)
2. [Work with the Chat Completion API](#work-with-the-chat-completion-api)
3. [Create a basic conversation loop](#create-a-basic-conversation-loop)
4. [Manage conversations](#manage-conversations)

GPT-3.5-Turbo, GPT-4, and GPT-4o series models are language models optimized for conversational interfaces. These models differ from older GPT-3 models in their behavior. Previous models were text-in and text-out, accepting a prompt string and returning a completion to append to the prompt. In contrast, the latest models are conversation-in and message-out. They expect input formatted in a specific chat-like transcript format and return a completion representing a model-written message in the chat. This format is designed for multi-turn conversations but also works well for non-chat scenarios.

This article guides you through getting started with chat completions models. To achieve the best results, use the techniques described here. Avoid interacting with the models in the same way as with older series, as they can be verbose and provide less useful responses.

## Work with chat completion models

The following code snippet demonstrates the most basic way to interact with models using the Chat Completion API. If this is your first time using these models programmatically, start with the [chat completions quickstart](https://learn.microsoft.com/en-us/azure/ai-services/openai/chatgpt-quickstart).

**Python**

```python
import os
from openai import AzureOpenAI

client = AzureOpenAI(
  api_key = os.getenv("AZURE_OPENAI_API_KEY"),  
  api_version = "2024-10-21",
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
)

response = client.chat.completions.create(
    model="gpt-4o", # model = "deployment_name".
    messages=[
        {"role": "system", "content": "Assistant is a large language model trained by OpenAI."},
        {"role": "user", "content": "Who were the founders of Microsoft?"}
    ]
)

#print(response)
print(response.model_dump_json(indent=2))
print(response.choices[0].message.content)
```

**Output**

```json
{
  "id": "chatcmpl-8GHoQAJ3zN2DJYqOFiVysrMQJfe1P",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "Microsoft was founded by Bill Gates and Paul Allen. They established the company on April 4, 1975. Bill Gates served as the CEO of Microsoft until 2000 and later as Chairman and Chief Software Architect until his retirement in 2008, while Paul Allen left the company in 1983 but remained on the board of directors until 2000.",
        "role": "assistant",
        "function_call": null
      },
      "content_filter_results": {
        "hate": {
          "filtered": false,
          "severity": "safe"
        },
        "self_harm": {
          "filtered": false,
          "severity": "safe"
        },
        "sexual": {
          "filtered": false,
          "severity": "safe"
        },
        "violence": {
          "filtered": false,
          "severity": "safe"
        }
      }
    }
  ],
  "created": 1698892410,
  "model": "gpt-4o",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 73,
    "prompt_tokens": 29,
    "total_tokens": 102
  },
  "prompt_filter_results": [
    {
      "prompt_index": 0,
      "content_filter_results": {
        "hate": {
          "filtered": false,
          "severity": "safe"
        },
        "self_harm": {
          "filtered": false,
          "severity": "safe"
        },
        "sexual": {
          "filtered": false,
          "severity": "safe"
        },
        "violence": {
          "filtered": false,
          "severity": "safe"
        }
      }
    }
  ]
}
Microsoft was founded by Bill Gates and Paul Allen. They established the company on April 4, 1975. Bill Gates served as the CEO of Microsoft until 2000 and later as Chairman and Chief Software Architect until his retirement in 2008, while Paul Allen left the company in 1983 but remained on the board of directors until 2000.
```

Every response includes `finish_reason`. Possible values for `finish_reason` are:

- **stop**: API returned complete model output.
- **length**: Incomplete model output due to `max_tokens` parameter or token limit.
- **content_filter**: Omitted content due to a flag from content filters.
- **null**: API response still in progress or incomplete.

Consider setting `max_tokens` to a slightly higher value than normal to ensure the model doesn't stop generating text prematurely.

## Work with the Chat Completion API

OpenAI trained chat completion models to accept input formatted as a conversation. The `messages` parameter takes an array of message objects organized by role. In Python, this is a list of dictionaries.

The format of a basic chat completion is:

**Copy**

```json
{"role": "system", "content": "Provide context and/or instructions to the model"},
{"role": "user", "content": "User's message goes here"}
```

A conversation with one example answer followed by a question would look like:

**Copy**

```json
{"role": "system", "content": "Provide context and/or instructions to the model."},
{"role": "user", "content": "Example question goes here."},
{"role": "assistant", "content": "Example answer goes here."},
{"role": "user", "content": "First question/message for the model to respond to."}
```

### System role

The system role, or system message, is included at the beginning of the array. It provides initial instructions to the model. You can include various information in the system role, such as:

- A brief description of the assistant.
- Personality traits of the assistant.
- Instructions or rules for the assistant.
- Relevant data or information for the model.

While the system role is optional, it is recommended to include at least a basic one for best results.

### Messages

After the system role, include a series of messages between the `user` and the `assistant`.

**Copy**

```json
{"role": "user", "content": "What is thermodynamics?"}
```

End with a user message to trigger a response from the model. You can also include example messages for few-shot learning.

### Message prompt examples

The following section provides examples of different prompt styles for chat completions models. These are starting points, and you can experiment to customize behavior for your use cases.

#### Basic example

To mimic the behavior of chatgpt.com, use a basic system message like `Assistant is a large language model trained by OpenAI.`

**Copy**

```json
{"role": "system", "content": "Assistant is a large language model trained by OpenAI."},
{"role": "user", "content": "Who were the founders of Microsoft?"}
```

#### Example with instructions

For specific scenarios, provide more instructions to define guardrails for the model's responses.

**Copy**

```json
{"role": "system", "content": "Assistant is an intelligent chatbot for tax-related questions. Instructions: Only answer tax-related questions. If unsure, say 'I don't know' and recommend the IRS website."},
{"role": "user", "content": "When are my taxes due?"}
```

#### Use data for grounding

Include relevant data in the system message to provide context for the conversation. For large amounts of data, use embeddings or Azure AI Search to retrieve information at query time.

**Copy**

```json
{"role": "system", "content": "Assistant helps with Azure OpenAI Service questions. Use the context below; if unsure, say 'I don't know'. Context: Azure OpenAI Service provides REST API access to OpenAI's language models, including GPT-3, Codex, and Embeddings. It offers advanced language AI with security and enterprise promise."},
{"role": "user", "content": "What is Azure OpenAI Service?"}
```

#### Few-shot learning with chat completion

Include example messages for few-shot learning. This approach has evolved with the new prompt format, allowing you to seed answers and teach behaviors.

**Copy**

```json
{"role": "system", "content": "Assistant helps with tax-related questions."},
{"role": "user", "content": "When do I file taxes?"},
{"role": "assistant", "content": "In 2023, file by April 18th."},
{"role": "user", "content": "How to check tax refund status?"},
{"role": "assistant", "content": "Visit https://www.irs.gov/refunds"}
```

#### Use chat completion for non-chat scenarios

The Chat Completion API works for non-chat scenarios, such as entity extraction.

**Copy**

```json
{"role": "system", "content": "Extract entities as JSON: {name: '', company: '', phone_number: ''}"},
{"role": "user", "content": "My name is Robert Smith from Contoso Insurance. Call me at (555) 346-9322."}
```

## Create a basic conversation loop

This example creates a conversation loop that:

- Takes console input and formats it as user role content.
- Outputs responses, prints them, and adds them as assistant role content.

With each new question, the entire conversation transcript is sent to maintain context.

**Python**

```python
import os
from openai import AzureOpenAI

client = AzureOpenAI(
  api_key = os.getenv("AZURE_OPENAI_API_KEY"),  
  api_version = "2024-10-21",
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
)

conversation = [{"role": "system", "content": "You are a helpful assistant."}]

while True:
    user_input = input("Q:")      
    conversation.append({"role": "user", "content": user_input})

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=conversation
    )

    conversation.append({"role": "assistant", "content": response.choices[0].message.content})
    print("\n" + response.choices[0].message.content + "\n")
```

Running this code opens a console window for input. After each response, you can continue asking questions.

## Manage conversations

The previous example runs until the token limit is reached. As the conversation grows, the `messages` list increases in size. Token limits vary by model: `gpt-4` and `gpt-4-32k` have limits of 8,192 and 32,768, respectively. These limits include both the message list and the model response. Exceeding the limit results in an error.

It's your responsibility to ensure the prompt and completion stay within the token limit. For longer conversations, track the token count and send only prompts that fit within the limit. Alternatively, use the [responses API](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/responses) for automatic conversation history management.

**Note**: Stay within the documented input token limit for all models, even if you find you can exceed it.

The following code sample manages a 4,096-token count using OpenAI's tiktoken library.

**Python**

```python
import tiktoken
import os
from openai import AzureOpenAI

client = AzureOpenAI(
  api_key = os.getenv("AZURE_OPENAI_API_KEY"),  
  api_version = "2024-10-21",
  azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
)

system_message = {"role": "system", "content": "You are a helpful assistant."}
max_response_tokens = 250
token_limit = 4096
conversation = [system_message]

def num_tokens_from_messages(messages, model="gpt-3.5-turbo-0613"):
    encoding = tiktoken.encoding_for_model(model)
    tokens_per_message = 3
    num_tokens = 0
    for message in messages:
        num_tokens += tokens_per_message
        for key, value in message.items():
            num_tokens += len(encoding.encode(value))
    num_tokens += 3
    return num_tokens

while True:
    user_input = input("Q:")      
    conversation.append({"role": "user", "content": user_input})
    conv_history_tokens = num_tokens_from_messages(conversation)

    while conv_history_tokens + max_response_tokens >= token_limit:
        del conversation[1]
        conv_history_tokens = num_tokens_from_messages(conversation)

    response = client.chat.completions.create(
        model="gpt-35-turbo",
        messages=conversation,
        temperature=0.7,
        max_tokens=max_response_tokens
    )

    conversation.append({"role": "assistant", "content": response.choices[0].message.content})
    print("\n" + response.choices[0].message.content + "\n")
```

This example removes the oldest messages when the token count is reached, preserving the system message. Over time, conversation quality may degrade as context is lost.

Alternatively, limit the conversation duration to the maximum token length or a specific number of turns. After reaching the limit, start a new conversation to reset the token count.

The token counting code is a simplified version of an [OpenAI cookbook example](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_format_inputs_to_ChatGPT_models.ipynb).

## Troubleshooting

### Don't use ChatML syntax or special tokens with the chat completion endpoint

Using legacy ChatML syntax or special tokens with newer models and the chat completion endpoint can result in errors and unexpected behavior. This issue occurs when upgrading from legacy models.

| Error Code | Error Message | Solution |
|---|---|---|
| 400 | "Failed to generate output due to special tokens in the input." | Ensure the prompt/messages array does not contain legacy ChatML or special tokens. Exclude all special tokens when upgrading from legacy models. |

### Failed to create completion as the model generated invalid Unicode output

| Error Code | Error Message | Workaround |
|---|---|---|
| 500 | "Failed to create completion as the model generated invalid Unicode output" | Reduce temperature below 1 and use a client with retry logic. Reattempting the request often succeeds. |

## Next steps

- [Learn more about Azure OpenAI](https://learn.microsoft.com/en-us/azure/ai-services/openai/overview).
- Start with the [chat completion quickstart](https://learn.microsoft.com/en-us/azure/ai-services/openai/chatgpt-quickstart).
- Explore the [Azure OpenAI Samples GitHub repository](https://github.com/Azure-Samples/openai).
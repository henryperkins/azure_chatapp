# Azure OpenAI Provider Setup

This guide explains how to configure Codex CLI to use Azure OpenAI as a provider and leverage its models.

## 1. Set Azure OpenAI environment variables

```bash
export AZURE_OPENAI_API_KEY="your-azure-api-key-here"
# Optional: specify Azure OpenAI API version (defaults to 2025-03-01-preview)
export AZURE_OPENAI_API_VERSION="2025-03-01-preview"
```

## 2. Configure Codex CLI provider

Add or extend your Codex configuration file (`~/.codex/config.yaml` or `~/.codex/config.json`) to include the Azure provider:

```yaml
provider: azure
providers:
  azure:
    name: AzureOpenAI
    baseURL: "https://<YOUR_AZURE_RESOURCE_NAME>.openai.azure.com/openai"
    envKey: AZURE_OPENAI_API_KEY
```

```json
{
  "provider": "azure",
  "providers": {
    "azure": {
      "name": "AzureOpenAI",
      "baseURL": "https://<YOUR_AZURE_RESOURCE_NAME>.openai.azure.com/openai",
      "envKey": "AZURE_OPENAI_API_KEY"
    }
  }
}
```

## 3. (Optional) Set default model in configuration

Specify the default Azure OpenAI deployment in your config:

```yaml
model: gpt-35-turbo
provider: azure
```

## 4. Use Azure OpenAI provider with Codex CLI

Run Codex commands while specifying the provider (and optionally model) flags:

```bash
# Use Azure provider and default model from config
codex --provider azure

# Override the model on the command line
codex -p azure -m gpt-4.0 "Generate a unit test for my function"
```

That's it! Codex CLI will send requests to your Azure OpenAI endpoint as configured.
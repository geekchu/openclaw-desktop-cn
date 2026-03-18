---
summary: "Use Hugging Face Inference Providers with OpenClaw"
read_when:
  - You want to authenticate Hugging Face in OpenClaw
  - You want an OpenAI-compatible provider with routed backends
title: "Hugging Face"
---

# Hugging Face

OpenClaw supports **Hugging Face Inference Providers** through the OpenAI-compatible
router endpoint at `https://router.huggingface.co/v1`.

## CLI setup

```bash
openclaw onboard --auth-choice huggingface-api-key --token-provider huggingface
```

You can also provide the token non-interactively:

```bash
openclaw onboard --auth-choice huggingface-api-key --huggingface-api-key "$HUGGINGFACE_HUB_TOKEN"
```

## Token

Create a fine-grained token at:

- `https://huggingface.co/settings/tokens`

Grant the token permission to **Make calls to Inference Providers**.

OpenClaw looks for these env vars:

- `HUGGINGFACE_HUB_TOKEN`
- `HF_TOKEN`

## Config snippet

```json5
{
  env: { HUGGINGFACE_HUB_TOKEN: "hf_..." },
  agents: {
    defaults: {
      model: { primary: "huggingface/deepseek-ai/DeepSeek-R1" },
    },
  },
}
```

## Model refs

- Base format: `huggingface/<model-id>`
- Examples:
  - `huggingface/deepseek-ai/DeepSeek-R1`
  - `huggingface/meta-llama/Llama-3.3-70B-Instruct-Turbo`

OpenClaw also supports router policy suffixes:

- `:cheapest`
- `:fastest`

Examples:

- `huggingface/deepseek-ai/DeepSeek-R1:cheapest`
- `huggingface/deepseek-ai/DeepSeek-R1:fastest`

When you use one of these suffixes, Hugging Face chooses the backend provider for
cost or speed.

## Notes

- Hugging Face uses an OpenAI-compatible chat completions API.
- OpenClaw can discover available models from `GET /v1/models` when a valid token is present.
- If discovery fails, OpenClaw falls back to its built-in Hugging Face model catalog.

See also [Model providers](/concepts/model-providers).

# Pi GPT Provider Routing Design

## Goal

Ensure Pi uses the OpenAI Codex subscription for GPT models while retaining OpenRouter access only for DeepSeek models.

## Configuration

- Set Pi's default provider and model to `openai-codex/gpt-5.6-sol`.
- Scope Ctrl+P model cycling to `openai-codex/*` and `openrouter/deepseek/*`.
- Keep the built-in `openai-codex/gpt-5.6-sol`; do not restore the redundant custom model definition.

## OpenRouter Filtering

Add a global Pi extension loaded from the dotfiles configuration. During extension initialization it will:

1. Load Pi's built-in OpenRouter model metadata.
2. Retain only models whose IDs begin with `deepseek/`.
3. Re-register the built-in `openrouter` provider with that filtered model list before initial model selection.

The replacement continues to use Pi's normal `auth.json` resolution, so the extension never reads or stores the credential. Without OpenRouter authentication the filtered catalog remains in place, but requests to those DeepSeek models require login.

## Expected Behavior

- Fresh sessions default to `openai-codex/gpt-5.6-sol`.
- GPT models are available through `openai-codex`, not OpenRouter.
- OpenRouter exposes only `deepseek/*` models in Pi's effective registry and model selector.
- Resuming a session that previously used an OpenRouter GPT model cannot restore that model and falls back to an allowed model.

## Validation

- Resolve the default model and assert its API is `openai-codex-responses`.
- Inspect Pi's effective registry and assert every OpenRouter model ID starts with `deepseek/`.
- Assert at least one OpenRouter DeepSeek model remains available.
- Start Pi offline and check for extension or configuration errors.
- Confirm no unrelated files are staged.

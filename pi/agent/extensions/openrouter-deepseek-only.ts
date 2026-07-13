import { getModels } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const deepSeekModels = getModels("openrouter").filter((model) => model.id.startsWith("deepseek/"));
	if (deepSeekModels.length === 0) {
		throw new Error("OpenRouter DeepSeek filter found no built-in DeepSeek models");
	}

	pi.registerProvider("openrouter", {
		name: "OpenRouter (DeepSeek only)",
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey: "$OPENROUTER_API_KEY",
		api: "openai-completions",
		models: deepSeekModels.map((model) => ({
			id: model.id,
			name: model.name,
			baseUrl: model.baseUrl,
			reasoning: model.reasoning,
			thinkingLevelMap: model.thinkingLevelMap,
			input: model.input,
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			compat: model.compat,
		})),
	});
}

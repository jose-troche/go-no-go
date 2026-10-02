// Optional provider: Claude via the official SDK. Enable with LLM_PROVIDER=anthropic and the ANTHROPIC_API_KEY secret.
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./provider";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  }

  async complete(input: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      // Short answers: low effort keeps latency and cost down; the answer budget is enforced by the prompt.
      max_tokens: Math.max(1024, input.maxTokens * 4),
      output_config: { effort: "low" },
      // Server-side refusal fallbacks, routed by category.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    if (res.stop_reason === "refusal") throw new Error("LLM declined");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!text) throw new Error("empty LLM response");
    return text;
  }
}

import type { LLMProvider } from "./provider";

export class WorkersAiProvider implements LLMProvider {
  readonly name = "workers-ai";
  constructor(
    private ai: Ai,
    private model: string,
    private gatewayId: string,
  ) {}

  async complete(input: { system: string; user: string; maxTokens: number }): Promise<string> {
    const opts = this.gatewayId ? { gateway: { id: this.gatewayId } } : undefined;
    const res = (await this.ai.run(
      this.model as keyof AiModels,
      {
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        max_tokens: input.maxTokens,
      } as never,
      opts,
    )) as { response?: string } | string;
    const text = typeof res === "string" ? res : (res?.response ?? "");
    if (!text.trim()) throw new Error("empty LLM response");
    return text.trim();
  }
}

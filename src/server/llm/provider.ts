// LLM provider interface (implementation guide 7.8). The LLM only explains; it never decides.
export interface LLMProvider {
  readonly name: string;
  complete(input: { system: string; user: string; maxTokens: number }): Promise<string>;
}

export interface LlmEnv {
  LLM_PROVIDER: string;
  WORKERS_AI_MODEL: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  AI_GATEWAY_ID: string;
  AI: Ai;
}

import { WorkersAiProvider } from "./workersAi";
import { AnthropicProvider } from "./anthropic";

/** Returns null in template mode (no LLM calls at all). */
export function createProvider(env: LlmEnv): LLMProvider | null {
  switch (env.LLM_PROVIDER) {
    case "workers-ai":
      return new WorkersAiProvider(env.AI, env.WORKERS_AI_MODEL, env.AI_GATEWAY_ID);
    case "anthropic":
      return env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || "claude-opus-5-5") : null;
    default:
      return null;
  }
}

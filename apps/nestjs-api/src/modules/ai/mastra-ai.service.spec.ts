import { describe, expect, it, vi } from "vitest";
import type { InstanceConfigService } from "../../infra/config/instance-config.service";
import { MastraAiService } from "./mastra-ai.service";

// Stub InstanceConfigService.getConfigurationValues to return [LLM_API_KEY, LLM_PROVIDER, LLM_MODEL].
function makeService(values: (string | undefined)[]) {
  const instanceConfig = {
    getConfigurationValues: vi.fn().mockResolvedValue(values),
  } as unknown as InstanceConfigService;
  return new MastraAiService(instanceConfig);
}

describe("MastraAiService.getLlmConfig (Django get_llm_config parity)", () => {
  it("returns null for an unsupported provider", async () => {
    const svc = makeService(["key", "cohere", "some-model"]);
    expect(await svc.getLlmConfig()).toBeNull();
  });

  it("returns null when the API key is missing", async () => {
    const svc = makeService([undefined, "openai", "gpt-4o-mini"]);
    expect(await svc.getLlmConfig()).toBeNull();
  });

  it("returns null when the model is not supported by the provider", async () => {
    const svc = makeService(["key", "openai", "gpt-9-ultra"]);
    expect(await svc.getLlmConfig()).toBeNull();
  });

  it("falls back to the provider's default model when none is set", async () => {
    const svc = makeService(["key", "openai", undefined]);
    expect(await svc.getLlmConfig()).toEqual({ apiKey: "key", provider: "openai", model: "gpt-4o-mini" });
  });

  it("accepts a valid gemini provider/model (case-insensitive provider)", async () => {
    const svc = makeService(["key", "Gemini", "gemini-1.5-pro-latest"]);
    expect(await svc.getLlmConfig()).toEqual({ apiKey: "key", provider: "gemini", model: "gemini-1.5-pro-latest" });
  });

  it("accepts anthropic default when model omitted", async () => {
    const svc = makeService(["key", "anthropic", ""]);
    expect(await svc.getLlmConfig()).toEqual({
      apiKey: "key",
      provider: "anthropic",
      model: "claude-3-sonnet-20240229",
    });
  });
});

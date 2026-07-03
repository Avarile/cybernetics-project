import { Agent } from "@mastra/core/agent";
import { createOpenAI } from "@ai-sdk/openai";
import { Injectable, Logger } from "@nestjs/common";
import { InstanceConfigService } from "../../infra/config/instance-config.service";

interface ProviderSpec {
  name: string;
  models: string[];
  default: string;
}

// Byte-for-byte the same provider/model table as plane/app/views/external/base.py.
export const SUPPORTED_PROVIDERS: Record<string, ProviderSpec> = {
  openai: {
    name: "OpenAI",
    models: ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o", "o1-mini", "o1-preview"],
    default: "gpt-4o-mini",
  },
  anthropic: {
    name: "Anthropic",
    models: [
      "claude-3-5-sonnet-20240620",
      "claude-3-haiku-20240307",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-2.1",
      "claude-2",
      "claude-instant-1.2",
      "claude-instant-1",
    ],
    default: "claude-3-sonnet-20240229",
  },
  gemini: {
    name: "Gemini",
    models: ["gemini-pro", "gemini-1.5-pro-latest", "gemini-pro-vision"],
    default: "gemini-pro",
  },
};

export interface LlmConfig {
  apiKey: string;
  model: string;
  provider: string;
}

export interface LlmResult {
  response: string;
  response_html: string;
}

/**
 * Mastra-backed reimplementation of plane/app/views/external/base.py::get_llm_response.
 *
 * Mode A (drop-in, default): Django uses the OpenAI SDK (`OpenAI(api_key)`) whose base URL comes from
 * the environment (`OPENAI_BASE_URL`) — i.e. a LiteLLM/OpenAI-compatible gateway with the `gemini/`
 * model-prefix trick. We replicate that exactly via `createOpenAI({ apiKey, baseURL })` wrapped in a
 * Mastra `Agent`. When no gateway URL is set, `createOpenAI` targets the real OpenAI API — identical to
 * Django when `OPENAI_BASE_URL` is unset.
 */
@Injectable()
export class MastraAiService {
  private readonly logger = new Logger(MastraAiService.name);

  constructor(private readonly instanceConfig: InstanceConfigService) {}

  /** Mirror of get_llm_config(): resolve + validate provider/model, returning null on any failure. */
  async getLlmConfig(): Promise<LlmConfig | null> {
    const [apiKey, providerKeyRaw, modelRaw] = await this.instanceConfig.getConfigurationValues([
      { key: "LLM_API_KEY", default: process.env.LLM_API_KEY },
      { key: "LLM_PROVIDER", default: process.env.LLM_PROVIDER ?? "openai" },
      { key: "LLM_MODEL", default: process.env.LLM_MODEL },
    ]);

    const provider = SUPPORTED_PROVIDERS[(providerKeyRaw ?? "").toLowerCase()];
    if (!provider) {
      this.logger.error(`Unsupported provider: ${providerKeyRaw}`);
      return null;
    }
    if (!apiKey) {
      this.logger.error(`Missing API key for provider: ${provider.name}`);
      return null;
    }
    const model = modelRaw || provider.default;
    if (!provider.models.includes(model)) {
      this.logger.error(`Model ${model} not supported by ${provider.name}`);
      return null;
    }
    return { apiKey, model, provider: (providerKeyRaw ?? "").toLowerCase() };
  }

  /**
   * Mirror of get_llm_response(): single-shot user message, no system prompt / temperature / streaming.
   * Throws on provider error (→ caller returns generic 500). Config is resolved by the caller first so
   * the config-missing 400 precedes the task-missing 400 (Django's order).
   */
  async generate(cfg: LlmConfig, task: string, prompt: string | undefined): Promise<LlmResult> {
    const finalText = `${task}\n${prompt ?? ""}`;
    // Gemini routes as `gemini/<model>` through the gateway (exact Django behaviour); others pass bare.
    const modelId = cfg.provider === "gemini" ? `gemini/${cfg.model}` : cfg.model;
    const baseURL = process.env.LLM_GATEWAY_URL || process.env.OPENAI_BASE_URL || undefined;

    const openai = createOpenAI({ apiKey: cfg.apiKey, ...(baseURL ? { baseURL } : {}) });
    const agent = new Agent({
      id: "plane-ai-assistant",
      name: "plane-ai-assistant",
      instructions: "", // single-shot, no system prompt (matches Django)
      model: openai(modelId),
    });

    const { text } = await agent.generate([{ role: "user", content: finalText }]);
    const response = text ?? "";
    return { response, response_html: response.replace(/\n/g, "<br/>") };
  }
}

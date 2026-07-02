# 06 — AI Module (Mastra)

The entire AI surface is **one file** in Django (`plane/app/views/external/base.py`): a single
provider-configurable chat completion behind two endpoints, plus a co-located Unsplash proxy. No embeddings,
RAG, vector search, or streaming. This document specifies the Mastra reimplementation with **exact contract
parity**.

## 1. Endpoints to replicate

| Method + path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/workspaces/:slug/projects/:projectId/ai-assistant/` | session, `@Roles([ADMIN, MEMBER])` (PROJECT) | `{ task: string (required), prompt?: string }` | `{ response, response_html, project_detail, workspace_detail }` |
| `POST /api/workspaces/:slug/ai-assistant/` | session, `@Roles([ADMIN, MEMBER], level: WORKSPACE)` | `{ task, prompt? }` | `{ response, response_html }` |
| `GET /api/unsplash/` | session | `?query&page&per_page` | Unsplash API passthrough (or `[]` if unconfigured) |

Contract details (from source):
- `response_html = response.replace(/\n/g, '<br/>')`.
- Missing/false `task` → **400** `{ "error": "Task is required" }`.
- Missing/invalid LLM config → **400** `{ "error": "LLM provider API key and model are required" }`.
- Any provider error (auth/rate-limit/other) → **generic 500** `{ "error": "An internal error has occurred." }`
  (Django deliberately hides the provider-specific error from the client while logging it).
- The prompt sent to the model is exactly `task + "\n" + prompt` as a **single user message**, **no system
  prompt**, no temperature/max_tokens/streaming.

## 2. Config + decryption (Fernet parity — must be byte-exact)

LLM key/provider/model come from the encrypted `InstanceConfiguration` store (keys `LLM_API_KEY` [encrypted],
`LLM_PROVIDER` [default `openai`], `LLM_MODEL`), with env fallbacks. `get_configuration_value` reads the DB
when `SKIP_ENV_VAR=1` (default), else env. Encrypted values use **Fernet** with key
`base64url(PBKDF2-HMAC-SHA256(SECRET_KEY, salt=b"salt", iterations=100000, dklen=32))` — this must be
replicated exactly (both backends share the table and `SECRET_KEY`).

```ts
// infra/config/crypto.service.ts
import { pbkdf2Sync } from 'crypto';
import Fernet from 'fernet';   // npm 'fernet'
@Injectable()
export class CryptoService {
  private key: string;   // Fernet key = urlsafe-b64 of the 32-byte derived key
  constructor(cfg: ConfigService) {
    const dk = pbkdf2Sync(cfg.getOrThrow('SECRET_KEY'), 'salt', 100_000, 32, 'sha256');
    this.key = dk.toString('base64url');
  }
  decrypt(token: string): string {
    if (!token) return '';
    return new Fernet({ secret: this.key }).decode(token);   // matches Fernet(key).decrypt(...)
  }
  encrypt(plain: string): string { return new Fernet({ secret: this.key }).encode(plain); }
}
```

```ts
// infra/config/instance-config.service.ts
@Injectable()
export class InstanceConfigService {
  constructor(@Inject(DRIZZLE) private db, private crypto: CryptoService, private cfg: ConfigService) {}
  /** Mirror of get_configuration_value([{key, default}, ...]) preserving order + fallback */
  async getConfigurationValue(items: { key: string; default?: string }[]): Promise<(string | undefined)[]> {
    if (this.cfg.get('SKIP_ENV_VAR', '1') === '1') {
      const rows = await this.db.select().from(instanceConfigurations)
        .where(inArray(instanceConfigurations.key, items.map(i => i.key)));
      const byKey = new Map(rows.map(r => [r.key, r]));
      return items.map(i => {
        const r = byKey.get(i.key);
        if (!r || r.value == null || r.value === '') return i.default;
        return r.isEncrypted ? this.crypto.decrypt(r.value) : r.value;
      });
    }
    return items.map(i => process.env[i.key] ?? i.default);
  }
}
```

## 3. Provider resolution (same validation as Django)

```ts
const SUPPORTED = {
  openai:    { name: 'OpenAI',    models: ['gpt-3.5-turbo','gpt-4o-mini','gpt-4o','o1-mini','o1-preview'], default: 'gpt-4o-mini' },
  anthropic: { name: 'Anthropic', models: ['claude-3-5-sonnet-20240620','claude-3-haiku-20240307','claude-3-opus-20240229','claude-3-sonnet-20240229','claude-2.1','claude-2','claude-instant-1.2','claude-instant-1'], default: 'claude-3-sonnet-20240229' },
  gemini:    { name: 'Gemini',    models: ['gemini-pro','gemini-1.5-pro-latest','gemini-pro-vision'], default: 'gemini-pro' },
} as const;
```

`getLlmConfig()` reads `LLM_API_KEY`/`LLM_PROVIDER`/`LLM_MODEL` via `InstanceConfigService`, validates
`provider ∈ SUPPORTED` and `model ∈ provider.models` (falling back to `provider.default`), and returns
`null` on any failure (→ 400) — identical to Django's `get_llm_config`.

## 4. Mastra agent + the two routing modes

Because key/model come per-request from the DB, the model is built per request. Django always calls through
the **OpenAI SDK** (`OpenAI(api_key=...)`, `gemini/`-prefixed model), implying a **LiteLLM / OpenAI-compatible
gateway** with one key. Two supported modes:

```ts
// modules/ai/mastra-ai.service.ts
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

@Injectable()
export class MastraAiService {
  constructor(private cfg: InstanceConfigService) {}

  private modelFor(provider: string, model: string, apiKey: string) {
    // MODE A (faithful drop-in): single key routed via an OpenAI-compatible gateway (LiteLLM),
    // exactly like Django's OpenAI(api_key) + "gemini/"-prefix trick.
    if (process.env.LLM_GATEWAY_URL) {
      const gw = createOpenAI({ apiKey, baseURL: process.env.LLM_GATEWAY_URL });
      return gw(provider === 'gemini' ? `gemini/${model}` : model);
    }
    // MODE B (native providers): cleaner, provider-specific (requires the stored key be that provider's).
    switch (provider) {
      case 'openai':    return createOpenAI({ apiKey })(model);
      case 'anthropic': return createAnthropic({ apiKey })(model);
      case 'gemini':    return createGoogleGenerativeAI({ apiKey })(model);
      default: throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async complete(task: string, prompt: string) {
    const cfg = await this.getLlmConfig();                     // { apiKey, model, provider } | null
    if (!cfg) return null;                                     // → caller returns 400
    const finalText = `${task}\n${prompt ?? ''}`;              // exact Django concatenation
    const agent = new Agent({
      name: 'plane-ai-assistant',
      instructions: '',                                        // single-shot, no system prompt (matches Django)
      model: this.modelFor(cfg.provider, cfg.model, cfg.apiKey),
    });
    const { text } = await agent.generate([{ role: 'user', content: finalText }]);
    return { response: text, response_html: text.replace(/\n/g, '<br/>') };
  }
}
```

Controller preserves the response contract and error mapping:

```ts
// modules/ai/ai.controller.ts
@Post('workspaces/:slug/projects/:projectId/ai-assistant')
@UseGuards(SessionGuard, RbacGuard) @Roles({ roles: [ROLE.ADMIN, ROLE.MEMBER] })
async projectAssistant(@Param('slug') slug, @Param('projectId') projectId, @Body() body: AiAssistantDto) {
  if (!body.task) throw new BadRequestException({ error: 'Task is required' });
  let out;
  try { out = await this.ai.complete(body.task, body.prompt); }
  catch (e) { this.logger.error(e); throw new InternalServerErrorException({ error: 'An internal error has occurred.' }); }
  if (!out) throw new BadRequestException({ error: 'LLM provider API key and model are required' });
  const [project, workspace] = await Promise.all([this.projects.lite(projectId), this.workspaces.lite(slug)]);
  return { ...out, project_detail: project, workspace_detail: workspace };
}
```

The workspace-level endpoint is identical minus `project_detail`/`workspace_detail` expansion (returns just
`{ response, response_html }`).

## 5. Unsplash proxy (co-located, not AI)

```ts
@Get('unsplash')
@UseGuards(SessionGuard)
async unsplash(@Query('query') query, @Query('page') page = 1, @Query('per_page') perPage = 20) {
  const [accessKey] = await this.cfg.getConfigurationValue([{ key: 'UNSPLASH_ACCESS_KEY', default: process.env.UNSPLASH_ACCESS_KEY }]);
  if (!accessKey) return [];                                   // matches Django: return [] with 200
  const url = query
    ? `https://api.unsplash.com/search/photos/?client_id=${accessKey}&query=${query}&page=${page}&per_page=${perPage}`
    : `https://api.unsplash.com/photos/?client_id=${accessKey}&page=${page}&per_page=${perPage}`;
  const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  return new StreamableResponse(await resp.json(), resp.status);
}
```

> Django has a **literal `${page}` bug** in the search URL (`page=$${page}`). Recommendation: **fix it** in
> NestJS (as above) rather than replicate the bug; if strict bug-for-bug parity is required, reproduce the
> literal string. Flagged in [`09`](./09-risks-and-open-questions.md).

## 6. Why Mastra (given the AI is tiny)

The requester chose Mastra explicitly. It is used here as the **LLM abstraction layer** (`Agent` +
Vercel AI SDK providers), which:
- keeps provider/model swappable (openai/anthropic/gemini) as in Django;
- gives a clean seam to *extend* AI later (tools, memory, workflows) without touching controllers;
- centralizes the single completion call behind one service, matching Django's single `get_llm_response`.

No Mastra `Workflow`, tool-calling, or memory is needed to reach parity — only `Agent.generate` with a
per-request model.

## 7. What can't be perfectly replicated (flagged)

- The `gemini/`-prefix + single-key-for-all trick works **only** behind an OpenAI-compatible gateway
  (LiteLLM). If the deployment truly runs LiteLLM → **Mode A** (byte-faithful). If not, Django would already
  fail for native anthropic/gemini → **Mode B** is the correct native replacement but needs the stored key
  to be that provider's real key. **Default: Mode A** (drop-in); Mode B is opt-in via absence of `LLM_GATEWAY_URL`.
- Streaming is unused (single blocking completion) → no SSE parity needed.

## 8. Fidelity checklist

- [ ] `CryptoService.decrypt` reads a value Django encrypted in `InstanceConfiguration` (Fernet parity).
- [ ] Same provider/model validation → same 400 on misconfig.
- [ ] `{task, prompt}` → same prompt string → response shape `{response, response_html}` (+ details on project route).
- [ ] Missing task → 400 `Task is required`; provider error → 500 `An internal error has occurred.`
- [ ] Unsplash returns `[]` when unconfigured; passes through status + body when configured.

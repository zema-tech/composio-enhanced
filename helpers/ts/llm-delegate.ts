/**
 * Delega di sotto-compiti a provider LLM OpenAI-compatibili (Groq, OpenRouter, ...)
 * usando LA TUA chiave API, con budget per agente e whitelist di modelli.
 *
 * - Nessuna dipendenza: usa `fetch` globale (Node >= 18).
 * - La chiave non viene mai inclusa in errori, log o risultati.
 * - Espone SOLO le chat completions (niente batch, fine-tuning, gestione chiavi).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BudgetLimits {
  /** Numero massimo di chiamate per agente (conta anche i tentativi falliti a livello logico). */
  maxCalls?: number;
  /** Tetto "morbido" di token totali per agente: si ferma quando il consumato lo raggiunge. */
  maxTotalTokens?: number;
}

export type DelegateProvider = "groq" | "openrouter" | "custom";

export interface DelegateOptions {
  provider: DelegateProvider;
  /** Se omessa viene letta da GROQ_API_KEY / OPENROUTER_API_KEY (per "custom" è obbligatoria). */
  apiKey?: string;
  /** Obbligatoria solo per provider "custom". Esempio: https://host/v1 */
  baseUrl?: string;
  /** Per OpenRouter non c'è un default: scegli tu il modello. */
  defaultModel?: string;
  /** Se presente, sono ammessi solo questi modelli. */
  allowedModels?: string[];
  budget?: BudgetLimits;
  maxRetries?: number;
  timeoutMs?: number;
  /** Tetto di token in uscita per singola chiamata. */
  maxOutputTokens?: number;
  /** Per i test. */
  fetchImpl?: typeof fetch;
}

export interface ChatRequest {
  /** Identifica l'agente chiamante (per il budget). */
  agentId?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Chiede una risposta JSON (response_format: json_object). */
  json?: boolean;
}

export interface UsageSnapshot {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  text: string;
  model: string;
  provider: DelegateProvider;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; estimated: boolean };
}

export type DelegateErrorCode =
  | "missing_api_key"
  | "missing_base_url"
  | "model_not_allowed"
  | "no_model"
  | "budget_exceeded"
  | "http_error"
  | "timeout"
  | "bad_response";

export class DelegateError extends Error {
  code: DelegateErrorCode;
  status?: number;
  constructor(code: DelegateErrorCode, message: string, status?: number) {
    super(message);
    this.name = "DelegateError";
    this.code = code;
    this.status = status;
  }
}

const PRESETS: Record<
  Exclude<DelegateProvider, "custom">,
  { baseUrl: string; envKey: string; defaultModel?: string }
> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
  },
};

function readEnv(name: string): string | undefined {
  const env = (globalThis as any).process?.env;
  const v = env?.[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class LLMDelegate {
  readonly provider: DelegateProvider;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel?: string;
  private allowedModels?: string[];
  private budget: BudgetLimits;
  private maxRetries: number;
  private timeoutMs: number;
  private maxOutputTokens: number;
  private fetchImpl: typeof fetch;
  private usageByAgent = new Map<string, UsageSnapshot>();

  constructor(opts: DelegateOptions) {
    this.provider = opts.provider;
    const preset = opts.provider === "custom" ? undefined : PRESETS[opts.provider];

    const key = opts.apiKey?.trim() || (preset ? readEnv(preset.envKey) : undefined);
    if (!key) {
      const hint = preset ? ` (oppure imposta ${preset.envKey})` : "";
      throw new DelegateError("missing_api_key", `Chiave API mancante per il provider "${opts.provider}"${hint}.`);
    }
    this.apiKey = key;

    const base = opts.baseUrl ?? preset?.baseUrl;
    if (!base) throw new DelegateError("missing_base_url", 'Per il provider "custom" serve baseUrl.');
    this.baseUrl = base.replace(/\/+$/, "");

    this.defaultModel = opts.defaultModel ?? preset?.defaultModel;
    this.allowedModels = opts.allowedModels;
    this.budget = opts.budget ?? {};
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxOutputTokens = opts.maxOutputTokens ?? 2048;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Consumo registrato per un agente (o per tutti, sommato, se omesso). */
  usage(agentId?: string): UsageSnapshot {
    if (agentId) return { ...(this.usageByAgent.get(agentId) ?? this.empty()) };
    const total = this.empty();
    for (const u of this.usageByAgent.values()) {
      total.calls += u.calls;
      total.promptTokens += u.promptTokens;
      total.completionTokens += u.completionTokens;
      total.totalTokens += u.totalTokens;
    }
    return total;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const agent = req.agentId ?? "default";
    const model = req.model ?? this.defaultModel;
    if (!model) {
      throw new DelegateError("no_model", "Nessun modello specificato e nessun defaultModel configurato.");
    }
    if (this.allowedModels && !this.allowedModels.includes(model)) {
      throw new DelegateError(
        "model_not_allowed",
        `Modello "${model}" non ammesso. Ammessi: ${this.allowedModels.join(", ")}`
      );
    }
    if (!Array.isArray(req.messages) || req.messages.length === 0) {
      throw new DelegateError("bad_response", "messages è vuoto.");
    }

    const u = this.usageByAgent.get(agent) ?? this.empty();
    if (this.budget.maxCalls !== undefined && u.calls >= this.budget.maxCalls) {
      throw new DelegateError("budget_exceeded", `Budget chiamate esaurito per "${agent}" (${this.budget.maxCalls}).`);
    }
    if (this.budget.maxTotalTokens !== undefined && u.totalTokens >= this.budget.maxTotalTokens) {
      throw new DelegateError("budget_exceeded", `Budget token esaurito per "${agent}" (${this.budget.maxTotalTokens}).`);
    }
    u.calls += 1;
    this.usageByAgent.set(agent, u);

    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      max_tokens: Math.min(req.maxTokens ?? this.maxOutputTokens, this.maxOutputTokens),
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json) body.response_format = { type: "json_object" };

    const json = await this.post("/chat/completions", body);
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new DelegateError("bad_response", "Risposta del provider senza choices[0].message.content.");
    }

    let promptTokens = Number(json?.usage?.prompt_tokens);
    let completionTokens = Number(json?.usage?.completion_tokens);
    let estimated = false;
    if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
      estimated = true;
      promptTokens = Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4);
      completionTokens = Math.ceil(text.length / 4);
    }
    u.promptTokens += promptTokens;
    u.completionTokens += completionTokens;
    u.totalTokens += promptTokens + completionTokens;

    return {
      text,
      model: typeof json?.model === "string" ? json.model : model,
      provider: this.provider,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimated },
    };
  }

  private empty(): UsageSnapshot {
    return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  private redact(text: string): string {
    return text.split(this.apiKey).join("[REDACTED]");
  }

  private async post(path: string, body: unknown): Promise<any> {
    let lastErr: DelegateError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (res.ok) return await res.json();

        const detail = this.redact((await res.text().catch(() => "")).slice(0, 300));
        lastErr = new DelegateError("http_error", `Il provider ha risposto ${res.status}. ${detail}`.trim(), res.status);
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 400 * 2 ** attempt;
          if (attempt < this.maxRetries) {
            await sleep(wait);
            continue;
          }
        }
        throw lastErr;
      } catch (e: any) {
        if (e instanceof DelegateError) throw e;
        if (e?.name === "AbortError") {
          lastErr = new DelegateError("timeout", `Timeout dopo ${this.timeoutMs} ms.`);
        } else {
          lastErr = new DelegateError("http_error", this.redact(String(e?.message ?? e)));
        }
        if (attempt < this.maxRetries) {
          await sleep(400 * 2 ** attempt);
          continue;
        }
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new DelegateError("http_error", "Errore sconosciuto.");
  }
}

export function createLLMDelegate(opts: DelegateOptions): LLMDelegate {
  return new LLMDelegate(opts);
}

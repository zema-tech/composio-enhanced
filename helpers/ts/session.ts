/**
 * Helper TypeScript per sessioni Composio più robuste.
 * Compatibile con @composio/core
 */

export interface CreateSessionOptions {
  userId: string;
  toolkits?: string[];
  mcp?: boolean;
  maxRetries?: number;
}

/**
 * Crea una sessione con retry automatico su errori transienti.
 */
export async function createSessionWithRetry(
  composio: any,
  opts: CreateSessionOptions
) {
  const { userId, toolkits, mcp = false, maxRetries = 3 } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const session = await composio.create(userId, {
        toolkits,
        mcp,
      });
      return session;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = 400 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Riusa una sessione esistente in modo sicuro.
 */
export async function useSessionSafe(composio: any, sessionId: string) {
  if (!sessionId) throw new Error("sessionId is required");
  return composio.use(sessionId);
}

/**
 * Filtra i tool restituiti da session.tools() per toolkit.
 * Utile quando non puoi passare il filtro a create().
 */
export function filterToolsByToolkit(tools: any[], toolkitSlugs: string[]) {
  const set = new Set(toolkitSlugs.map((s) => s.toLowerCase()));
  return tools.filter((t) => {
    const name = (t.name || t.function?.name || "").toLowerCase();
    return [...set].some((slug) => name.includes(slug));
  });
}

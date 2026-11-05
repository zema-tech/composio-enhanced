/**
 * Wrapper che normalizza il risultato di un tool execution.
 * Gestisce success, error e input_required in modo uniforme.
 */

export type SafeResult<
  T = unknown
> =
  | { ok: true; data: T }
  | { ok: false; error: string; inputRequired?: any[]; status?: number };

export async function safeExecute<
  T = unknown
>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    // Alcuni provider restituiscono oggetti con campo error anche su HTTP 200
    if (data && typeof data === "object" && "error" in (data as any) && (data as any).error) {
      return {
        ok: false,
        error: String((data as any).error),
        inputRequired: (data as any).input_requests ?? (data as any).inputRequired,
      };
    }
    return { ok: true, data };
  } catch (err: any) {
    const message =
      err?.message ||
      err?.error ||
      (typeof err === "string" ? err : "Unknown error");
    return {
      ok: false,
      error: message,
      status: err?.status ?? err?.response?.status,
      inputRequired: err?.input_requests,
    };
  }
}

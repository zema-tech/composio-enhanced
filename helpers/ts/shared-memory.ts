/**
 * Memoria condivisa per agenti diversi (Claude, Grok, Codex, ...).
 *
 * - Spazi separati: "personal", "project:<nome>", "team:<nome>".
 * - Provenienza: ogni voce registra quale agente l'ha scritta e da che tipo di fonte.
 * - Quarantena: le voci derivate da contenuti esterni (email, pagine web, tool result)
 *   restano NON verificate e non vengono restituite finché un umano non le verifica.
 * - Rifiuta il salvataggio di segreti (chiavi API, token, chiavi private).
 * - Persistenza opzionale su file JSON condivisibile tra processi (lock + scrittura atomica).
 * - La ricerca è lessicale (senza dipendenze). Per la ricerca semantica sostituisci `search`.
 */

import { readFile, writeFile, rename, mkdir, open, unlink, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type Origin = "user" | "agent" | "external";

export interface MemoryEntry {
  id: string;
  space: string;
  text: string;
  tags: string[];
  /** Nome dell'agente che ha scritto la voce. */
  author: string;
  origin: Origin;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface WriteInput {
  space: string;
  text: string;
  tags?: string[];
  author: string;
  origin?: Origin;
  ttlDays?: number;
}

export interface SearchQuery {
  query: string;
  spaces?: string[];
  spaceFilter?: (space: string) => boolean;
  tags?: string[];
  limit?: number;
  includeUnverified?: boolean;
}

export interface SearchHit {
  entry: MemoryEntry;
  score: number;
}

export type MemoryErrorCode = "invalid_input" | "secret_detected" | "access_denied" | "not_found" | "lock_timeout";

export class MemoryError extends Error {
  code: MemoryErrorCode;
  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

const SPACE_RE = /^[a-z0-9][a-z0-9:_\-./]{0,63}$/i;
const MAX_TEXT = 4000;

const SECRET_PATTERNS: RegExp[] = [
  /gsk_[A-Za-z0-9]{20,}/, // Groq
  /sk-or-v1-[A-Za-z0-9]{20,}/, // OpenRouter
  /sk-[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic e simili
  /gh[pousr]_[A-Za-z0-9]{30,}/, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function matchSpace(pattern: string, space: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return space.startsWith(pattern.slice(0, -1));
  return pattern === space;
}

export class MemoryStore {
  private filePath?: string;
  private mem: MemoryEntry[] = [];
  private now: () => Date;

  constructor(opts: { filePath?: string; now?: () => Date } = {}) {
    this.filePath = opts.filePath;
    this.now = opts.now ?? (() => new Date());
  }

  async write(input: WriteInput): Promise<MemoryEntry> {
    const text = (input.text ?? "").trim();
    const space = (input.space ?? "").trim();
    const author = (input.author ?? "").trim();
    if (!text) throw new MemoryError("invalid_input", "text è vuoto.");
    if (text.length > MAX_TEXT) throw new MemoryError("invalid_input", `text supera ${MAX_TEXT} caratteri.`);
    if (!SPACE_RE.test(space)) throw new MemoryError("invalid_input", `Spazio non valido: "${space}".`);
    if (!author) throw new MemoryError("invalid_input", "author è obbligatorio.");
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (tags.length > 10 || tags.some((t) => t.length > 32)) {
      throw new MemoryError("invalid_input", "Massimo 10 tag, ciascuno di al più 32 caratteri.");
    }
    if (looksLikeSecret(text) || tags.some(looksLikeSecret)) {
      throw new MemoryError("secret_detected", "Il testo sembra contenere un segreto (chiave API, token): non salvato.");
    }
    const origin: Origin = input.origin ?? "agent";
    const nowIso = this.now().toISOString();

    return this.mutate((entries) => {
      const key = normalize(text);
      const dup = entries.find((e) => e.space === space && normalize(e.text) === key);
      if (dup) {
        dup.tags = [...new Set([...dup.tags, ...tags])];
        dup.updatedAt = nowIso;
        return { ...dup };
      }
      const entry: MemoryEntry = {
        id: randomUUID(),
        space,
        text,
        tags,
        author,
        origin,
        verified: origin !== "external",
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (input.ttlDays && input.ttlDays > 0) {
        entry.expiresAt = new Date(this.now().getTime() + input.ttlDays * 86_400_000).toISOString();
      }
      entries.push(entry);
      return { ...entry };
    });
  }

  async search(q: SearchQuery): Promise<SearchHit[]> {
    const entries = await this.loadLive();
    const qTokens = [...new Set(tokenize(q.query ?? ""))];
    if (qTokens.length === 0) return [];
    const wantTags = (q.tags ?? []).map((t) => t.toLowerCase());
    const hits: SearchHit[] = [];

    for (const e of entries) {
      if (!this.inScope(e, q)) continue;
      if (!e.verified && !q.includeUnverified) continue;
      if (wantTags.length && !wantTags.every((t) => e.tags.includes(t))) continue;

      const eTokens = tokenize(`${e.text} ${e.tags.join(" ")}`);
      const counts = new Map<string, number>();
      for (const t of eTokens) counts.set(t, (counts.get(t) ?? 0) + 1);

      let matched = 0;
      for (const t of qTokens) {
        const c = counts.get(t);
        if (c) matched += 1 + Math.log(1 + c) * 0.25;
        else if (t.length >= 4 && eTokens.some((x) => x.startsWith(t))) matched += 0.5;
      }
      if (matched === 0) continue;
      let score = matched / qTokens.length;
      for (const tg of e.tags) if (qTokens.includes(tg)) score += 0.25;
      hits.push({ entry: { ...e }, score });
    }

    hits.sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt));
    return hits.slice(0, Math.max(1, Math.min(q.limit ?? 5, 50)));
  }

  async list(opts: Omit<SearchQuery, "query"> = {}): Promise<MemoryEntry[]> {
    const entries = await this.loadLive();
    return entries
      .filter((e) => this.inScope(e, opts) && (e.verified || opts.includeUnverified))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(opts.limit ?? 20, 200)))
      .map((e) => ({ ...e }));
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const e = (await this.loadLive()).find((x) => x.id === id);
    return e ? { ...e } : undefined;
  }

  async update(id: string, patch: { text?: string; tags?: string[] }): Promise<MemoryEntry> {
    if (patch.text !== undefined) {
      const t = patch.text.trim();
      if (!t || t.length > MAX_TEXT) throw new MemoryError("invalid_input", "text non valido.");
      if (looksLikeSecret(t)) throw new MemoryError("secret_detected", "Il testo sembra contenere un segreto.");
    }
    return this.mutate((entries) => {
      const e = entries.find((x) => x.id === id);
      if (!e) throw new MemoryError("not_found", `Voce ${id} non trovata.`);
      if (patch.text !== undefined) e.text = patch.text.trim();
      if (patch.tags) e.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
      e.updatedAt = this.now().toISOString();
      return { ...e };
    });
  }

  /** Azione umana: rende visibile agli agenti una voce in quarantena. */
  async verify(id: string): Promise<MemoryEntry> {
    return this.mutate((entries) => {
      const e = entries.find((x) => x.id === id);
      if (!e) throw new MemoryError("not_found", `Voce ${id} non trovata.`);
      e.verified = true;
      e.updatedAt = this.now().toISOString();
      return { ...e };
    });
  }

  async forget(id: string): Promise<boolean> {
    return this.mutate((entries) => {
      const i = entries.findIndex((x) => x.id === id);
      if (i < 0) return false;
      entries.splice(i, 1);
      return true;
    });
  }

  // ---------- interni ----------

  private inScope(e: MemoryEntry, q: { spaces?: string[]; spaceFilter?: (s: string) => boolean }): boolean {
    if (q.spaces && q.spaces.length && !q.spaces.includes(e.space)) return false;
    if (q.spaceFilter && !q.spaceFilter(e.space)) return false;
    return true;
  }

  private isLive(e: MemoryEntry): boolean {
    return !e.expiresAt || new Date(e.expiresAt).getTime() > this.now().getTime();
  }

  private async loadRaw(): Promise<MemoryEntry[]> {
    if (!this.filePath) return this.mem;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const j = JSON.parse(raw);
      return Array.isArray(j?.entries) ? j.entries : [];
    } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
  }

  private async loadLive(): Promise<MemoryEntry[]> {
    return (await this.loadRaw()).filter((e) => this.isLive(e));
  }

  private async save(entries: MemoryEntry[]): Promise<void> {
    if (!this.filePath) {
      this.mem = entries;
      return;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }

  private async mutate<T>(fn: (entries: MemoryEntry[]) => T): Promise<T> {
    const release = await this.lock();
    try {
      const entries = (await this.loadRaw()).filter((e) => this.isLive(e));
      const result = fn(entries);
      await this.save(entries);
      return result;
    } finally {
      await release();
    }
  }

  private async lock(): Promise<() => Promise<void>> {
    if (!this.filePath) return async () => {};
    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        const fh = await open(lockPath, "wx");
        await fh.close();
        return async () => {
          await unlink(lockPath).catch(() => {});
        };
      } catch (e: any) {
        if (e?.code !== "EEXIST") throw e;
        const st = await stat(lockPath).catch(() => undefined);
        if (st && Date.now() - st.mtimeMs > 10_000) {
          await unlink(lockPath).catch(() => {}); // lock orfano
          continue;
        }
        if (Date.now() > deadline) throw new MemoryError("lock_timeout", "Impossibile ottenere il lock sulla memoria.");
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
      }
    }
  }
}

// ---------- accesso per agente ----------

export interface AccessPolicy {
  /** Nome dell'agente (finisce nel campo `author`). */
  agent: string;
  /** Spazi leggibili: "personal", "project:*", "*". */
  read: string[];
  /** Spazi scrivibili (e da cui si può cancellare). */
  write: string[];
}

/** Vista sulla memoria con i permessi di un singolo agente. */
export class ScopedMemory {
  readonly agent: string;
  private store: MemoryStore;
  private policy: AccessPolicy;

  constructor(store: MemoryStore, policy: AccessPolicy) {
    this.store = store;
    this.policy = policy;
    this.agent = policy.agent;
  }

  canRead(space: string): boolean {
    return this.policy.read.some((p) => matchSpace(p, space));
  }

  canWrite(space: string): boolean {
    return this.policy.write.some((p) => matchSpace(p, space));
  }

  async write(input: Omit<WriteInput, "author">): Promise<MemoryEntry> {
    if (!this.canWrite(input.space)) {
      throw new MemoryError("access_denied", `${this.agent} non può scrivere nello spazio "${input.space}".`);
    }
    return this.store.write({ ...input, author: this.agent });
  }

  async search(q: { query: string; spaces?: string[]; tags?: string[]; limit?: number }): Promise<SearchHit[]> {
    for (const s of q.spaces ?? []) {
      if (!this.canRead(s)) throw new MemoryError("access_denied", `${this.agent} non può leggere lo spazio "${s}".`);
    }
    // Gli agenti non vedono mai le voci in quarantena.
    return this.store.search({ ...q, spaceFilter: (s) => this.canRead(s), includeUnverified: false });
  }

  async forget(id: string): Promise<boolean> {
    const e = await this.store.get(id);
    if (!e) return false;
    if (!this.canWrite(e.space)) {
      throw new MemoryError("access_denied", `${this.agent} non può cancellare voci dello spazio "${e.space}".`);
    }
    return this.store.forget(id);
  }
}

/** Formatta i risultati per l'inserimento nel prompt di un agente. */
export function formatForPrompt(hits: SearchHit[]): string {
  if (hits.length === 0) return "(nessun ricordo trovato)";
  return hits
    .map(({ entry: e }) => {
      const flag = e.origin === "external" ? " [da contenuto esterno]" : "";
      return `- [${e.space}] ${e.text} (id ${e.id}, di ${e.author}, ${e.updatedAt.slice(0, 10)})${flag}`;
    })
    .join("\n");
}

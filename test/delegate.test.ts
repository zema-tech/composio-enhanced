import { test } from "node:test";
import assert from "node:assert/strict";
import { createLLMDelegate, DelegateError } from "../helpers/ts/llm-delegate.ts";

const KEY = "gsk_TESTKEY1234567890abcdefghij";

function okResponse(content = "ciao", usage: any = { prompt_tokens: 10, completion_tokens: 5 }) {
  return new Response(JSON.stringify({ model: "llama-3.3-70b-versatile", choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("chiamata ok: URL, header e body corretti", async () => {
  let seen: any;
  const d = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    fetchImpl: (async (url: any, init: any) => {
      seen = { url, init };
      return okResponse();
    }) as any,
  });
  const r = await d.chat({ agentId: "claude", messages: [{ role: "user", content: "ciao" }], json: true });
  assert.equal(r.text, "ciao");
  assert.equal(seen.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(seen.init.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "llama-3.3-70b-versatile");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(d.usage("claude"), { calls: 1, promptTokens: 10, completionTokens: 5, totalTokens: 15 });
});

test("budget per agente: chiamate e token", async () => {
  const d = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    budget: { maxCalls: 2 },
    fetchImpl: (async () => okResponse()) as any,
  });
  const msg = [{ role: "user" as const, content: "x" }];
  await d.chat({ agentId: "a", messages: msg });
  await d.chat({ agentId: "a", messages: msg });
  await assert.rejects(d.chat({ agentId: "a", messages: msg }), (e: any) => e.code === "budget_exceeded");
  await d.chat({ agentId: "b", messages: msg }); // altro agente: budget separato

  const d2 = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    budget: { maxTotalTokens: 15 },
    fetchImpl: (async () => okResponse()) as any,
  });
  await d2.chat({ messages: msg });
  await assert.rejects(d2.chat({ messages: msg }), (e: any) => e.code === "budget_exceeded");
});

test("whitelist modelli e modello obbligatorio su OpenRouter", async () => {
  const d = createLLMDelegate({ provider: "openrouter", apiKey: "sk-or-v1-abcdefghijklmnopqrstuv", fetchImpl: (async () => okResponse()) as any });
  await assert.rejects(d.chat({ messages: [{ role: "user", content: "x" }] }), (e: any) => e.code === "no_model");

  const d2 = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    allowedModels: ["llama-3.3-70b-versatile"],
    fetchImpl: (async () => okResponse()) as any,
  });
  await assert.rejects(
    d2.chat({ model: "altro-modello", messages: [{ role: "user", content: "x" }] }),
    (e: any) => e.code === "model_not_allowed"
  );
});

test("retry su 429 e poi successo", async () => {
  let n = 0;
  const d = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    fetchImpl: (async () => {
      n++;
      return n === 1 ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }) : okResponse();
    }) as any,
  });
  const r = await d.chat({ messages: [{ role: "user", content: "x" }] });
  assert.equal(r.text, "ciao");
  assert.equal(n, 2);
});

test("la chiave non compare mai negli errori", async () => {
  const d = createLLMDelegate({
    provider: "groq",
    apiKey: KEY,
    maxRetries: 0,
    fetchImpl: (async () => new Response(`invalid key ${KEY}`, { status: 401 })) as any,
  });
  await assert.rejects(d.chat({ messages: [{ role: "user", content: "x" }] }), (e: any) => {
    assert.ok(e instanceof DelegateError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes(KEY));
    assert.ok(e.message.includes("[REDACTED]"));
    return true;
  });
});

test("chiave mancante: errore chiaro", () => {
  const prev = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  assert.throws(() => createLLMDelegate({ provider: "groq" }), (e: any) => e.code === "missing_api_key");
  if (prev) process.env.GROQ_API_KEY = prev;
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentChannel } from "../server/http.js";
import { ensureInstance, instanceDir } from "../server/instance.js";
import { loadAgentSession, saveAgentSession } from "../server/state.js";

// Exercise ensure's reuse decisions without opening servers or spawning children.
async function registeredServer(t) {
  const cache = await mkdtemp(path.join(tmpdir(), "rv-instance-"));
  const previous = process.env.RV_CACHE_DIR;
  process.env.RV_CACHE_DIR = cache;
  t.after(async () => {
    if (previous === undefined) delete process.env.RV_CACHE_DIR;
    else process.env.RV_CACHE_DIR = previous;
    await rm(cache, { recursive: true, force: true });
  });
  const root = path.join(cache, "repo");
  const servers = new Map();
  const requests = [];
  const register = async (port, primary = false) => {
    const instance = { root, pid: 0x7fffffff, instanceId: randomUUID(), url: `http://localhost:${port}` };
    const server = { instance, agent: null };
    servers.set(port, server);
    await mkdir(instanceDir(root), { recursive: true });
    await writeFile(path.join(instanceDir(root), primary ? "instance.json" : `instance-${instance.instanceId}.json`), JSON.stringify(instance));
    return server;
  };
  const enable = async (server) => {
    if (!server.agent) {
      server.agent = createAgentChannel(randomUUID());
      await saveAgentSession(root, { url: server.instance.url, token: server.agent.token });
    }
    return server.agent;
  };
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    const server = servers.get(Number(url.port));
    requests.push({ port: Number(url.port), path: url.pathname, method: options.method || "GET" });
    assert.ok(server, "Only registered local servers may be contacted");
    assert.equal(options.headers["X-Rv"] || options.headers["X-RV"], "1");
    if (url.pathname === "/api/instance") return Response.json(server.instance);
    if (url.pathname === "/api/agent/status") {
      assert.equal(options.headers["X-Rv-Agent"], server.agent?.token);
      return Response.json({ ok: Boolean(server.agent) }, { status: server.agent ? 200 : 403 });
    }
    assert.equal(url.pathname, "/api/agent/connection");
    assert.equal(options.method, "POST");
    const agent = await enable(server);
    return Response.json({ enabled: true, connectable: true, ...agent.status() });
  });
  const server = await register(4444, true);
  return { root, server, requests, register, enable };
}

test("ensure reuses agent sessions, preserving queued feedback and pending waits", async (t) => {
  const { root, server, enable, requests } = await registeredServer(t);
  const agent = await enable(server);
  const session = await loadAgentSession(root);
  agent.submit("Queued review");
  assert.deepEqual(await ensureInstance(root), server.instance);
  assert.deepEqual(await ensureInstance(root, { agent: true }), server.instance);
  assert.deepEqual(await loadAgentSession(root), session);
  assert.ok(requests.every(({ method }) => method === "GET"));
  assert.equal(await agent.wait().promise, "Queued review");

  const pending = agent.wait();
  assert.deepEqual(await ensureInstance(root, { agent: true }), server.instance);
  assert.deepEqual(await ensureInstance(root), server.instance);
  assert.deepEqual(agent.status(), { waiting: true, queued: 0 });
  agent.submit("Next review");
  assert.equal(await pending.promise, "Next review");
});

test("concurrent ensure --agent calls enable handoff on the same running server", async (t) => {
  const { root, server, requests } = await registeredServer(t);
  assert.deepEqual(await ensureInstance(root), server.instance);
  assert.equal(await loadAgentSession(root), null, "Plain ensure must not enable handoff");
  const instances = await Promise.all([
    ensureInstance(root, { agent: true }),
    ensureInstance(root, { agent: true }),
  ]);
  assert.deepEqual(instances, [server.instance, server.instance]);
  const session = await loadAgentSession(root);
  assert.deepEqual(session, { url: server.instance.url, token: server.agent.token });
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
});

test("ensure prefers the active agent server over another foreground server", async (t) => {
  const { root, server, register, enable, requests } = await registeredServer(t);
  const owner = await register(5555);
  await enable(owner);
  assert.deepEqual(await ensureInstance(root), owner.instance);
  assert.deepEqual(await ensureInstance(root, { agent: true }), owner.instance);
  assert.equal(server.agent, null);
  assert.ok(requests.every(({ port }) => port === 5555));
});

test("ensure requires an explicit restart for conflicting ports", async (t) => {
  const { root, server, requests } = await registeredServer(t);
  assert.deepEqual(await ensureInstance(root, { port: 4444 }), server.instance);
  assert.deepEqual(await ensureInstance(root, { port: 0 }), server.instance);
  await assert.rejects(ensureInstance(root, { port: 5555, agent: true }), /--restart --port 5555/);
  assert.equal(await loadAgentSession(root), null);
  assert.ok(requests.every(({ path }) => path === "/api/instance"));
});

test("ensure reports connection failures without replacing the running server", async (t) => {
  const { root, server } = await registeredServer(t);
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input, options) => {
    if (new URL(input).pathname === "/api/agent/connection")
      return Promise.resolve(Response.json({ error: "Handoff unavailable" }, { status: 409 }));
    return fetch(input, options);
  });
  await assert.rejects(ensureInstance(root, { agent: true }), /Handoff unavailable/);
  assert.deepEqual(await ensureInstance(root), server.instance);
});

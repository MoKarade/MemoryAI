// tests/routeMcp.test.ts — la couche HTTP de /api/mcp, sans base : l'ordre des refus, et le
// 401 qui ENSEIGNE la découverte OAuth.

import { describe, it, expect, afterEach } from "vitest";
import { GET, POST } from "../app/api/mcp/route";

const VARS = ["MEMORYAI_GEL", "MCP_SIGNING_KEY", "MCP_ACCESS_KEY"] as const;
const sauvegarde = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
afterEach(() => {
  for (const v of VARS) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

const req = (jeton?: string) =>
  new Request("https://memoryai.hubperso.com/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });

describe("POST /api/mcp", () => {
  it("503 memoire_gelee avant tout", async () => {
    process.env.MEMORYAI_GEL = "1";
    const r = await POST(req());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("memoire_gelee");
  });

  it("503 mcp_desactive sans les deux clés OAuth", async () => {
    delete process.env.MEMORYAI_GEL;
    delete process.env.MCP_SIGNING_KEY;
    delete process.env.MCP_ACCESS_KEY;
    const r = await POST(req());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("mcp_desactive");
  });

  it("401 avec WWW-Authenticate quand le jeton manque ou est faux — jamais un jeton statique", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MCP_SIGNING_KEY = "s".repeat(48);
    process.env.MCP_ACCESS_KEY = "a".repeat(24);
    for (const j of [undefined, "ma1.faux.jeton", "a".repeat(24)]) {
      const r = await POST(req(j));
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
      expect(r.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("GET rend 405 et des booléens de configuration, jamais une valeur", async () => {
    delete process.env.MEMORYAI_GEL;
    process.env.MCP_SIGNING_KEY = "s".repeat(48);
    process.env.MCP_ACCESS_KEY = "a".repeat(24);
    const r = await GET(new Request("https://memoryai.hubperso.com/api/mcp"));
    expect(r.status).toBe(405);
    const c = await r.json();
    expect(c).toMatchObject({ configure: true, gele: false });
    expect(JSON.stringify(c)).not.toContain("s".repeat(48));
  });
});

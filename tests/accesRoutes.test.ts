import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "../app/login/page";
import { GET as GETMetaAs } from "../app/api/mcp/meta/as/route";
import { GET as GETMetaPr } from "../app/api/mcp/meta/pr/route";
import { POST as POSTRegister } from "../app/api/mcp/register/route";

type ClasseAcces =
  | "session-proprietaire"
  | "jeton-proprietaire"
  | "jeton-app"
  | "secret-cron"
  | "public-sans-donnee";

const CLASSIFICATIONS = {
  "app/api/agenda/route.ts": "jeton-app",
  "app/api/ask/route.ts": "jeton-app",
  "app/api/auth/[...nextauth]/route.ts": "public-sans-donnee",
  "app/api/avancement/route.ts": "jeton-app",
  "app/api/chat/route.ts": "session-proprietaire",
  "app/api/conversations/route.ts": "jeton-app",
  "app/api/cron/apprentissage/route.ts": "secret-cron",
  "app/api/cron/reseau/route.ts": "secret-cron",
  "app/api/demandes/route.ts": "jeton-app",
  "app/api/etat-lia/route.ts": "jeton-app",
  "app/api/etat/route.ts": "jeton-app",
  "app/api/evenements/route.ts": "jeton-app",
  "app/api/faits/route.ts": "jeton-app",
  "app/api/lia/ask/route.ts": "session-proprietaire",
  "app/api/lia/etat/route.ts": "session-proprietaire",
  "app/api/mcp/authorize/route.ts": "jeton-proprietaire",
  "app/api/mcp/meta/as/route.ts": "public-sans-donnee",
  "app/api/mcp/meta/pr/route.ts": "public-sans-donnee",
  "app/api/mcp/register/route.ts": "public-sans-donnee",
  "app/api/mcp/route.ts": "jeton-proprietaire",
  "app/api/mcp/token/route.ts": "jeton-proprietaire",
  "app/api/pieces/file/route.ts": "jeton-app",
  "app/api/pieces/relecture/route.ts": "jeton-app",
  "app/api/pieces/route.ts": "jeton-app",
  "app/api/sorties/route.ts": "jeton-app",
  "app/apps/actions.ts": "session-proprietaire",
  "app/apps/page.tsx": "session-proprietaire",
  "app/a-valider/actions.ts": "session-proprietaire",
  "app/a-valider/page.tsx": "session-proprietaire",
  "app/avancement/page.tsx": "session-proprietaire",
  "app/chat/actions.ts": "session-proprietaire",
  "app/chat/page.tsx": "session-proprietaire",
  "app/conversations/actions.ts": "session-proprietaire",
  "app/conversations/extraireAction.ts": "session-proprietaire",
  "app/conversations/page.tsx": "session-proprietaire",
  "app/depenses/actions.ts": "session-proprietaire",
  "app/depenses/page.tsx": "session-proprietaire",
  "app/fait/[id]/actions.ts": "session-proprietaire",
  "app/fait/[id]/page.tsx": "session-proprietaire",
  "app/graphe/actions.ts": "session-proprietaire",
  "app/graphe/page.tsx": "session-proprietaire",
  "app/hub/summary/route.ts": "jeton-app",
  "app/idees/actions.ts": "session-proprietaire",
  "app/login/page.tsx": "public-sans-donnee",
  "app/memoire/acces/page.tsx": "session-proprietaire",
  "app/memoire/apprentissage/page.tsx": "session-proprietaire",
  "app/memoire/historique/page.tsx": "session-proprietaire",
  "app/memoire/page.tsx": "session-proprietaire",
  "app/memoire/reseau/page.tsx": "session-proprietaire",
  "app/moi/actions.ts": "session-proprietaire",
  "app/moi/page.tsx": "session-proprietaire",
  "app/partage/page.tsx": "session-proprietaire",
  "app/pieces/[id]/page.tsx": "session-proprietaire",
  "app/pieces/actions.ts": "session-proprietaire",
  "app/pieces/page.tsx": "session-proprietaire",
  "app/questions/actions.ts": "session-proprietaire",
  "app/questions/page.tsx": "session-proprietaire",
  "app/regler/actions.ts": "session-proprietaire",
  "app/regler/page.tsx": "session-proprietaire",
  "app/regler/sauvetage/actions.ts": "session-proprietaire",
  "app/regler/sauvetage/page.tsx": "session-proprietaire",
  "app/page.tsx": "session-proprietaire",
  "app/widget/page.tsx": "session-proprietaire",
} satisfies Record<string, ClasseAcces>;

const fichiersApp = execSync("git ls-files --cached --others --exclude-standard app", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

function pointsEntree(fichiers: string[]): string[] {
  return fichiers.filter((chemin) => {
    if (/\/(?:route\.ts|page\.tsx)$/.test(chemin)) return true;
    return /(?:^|\n)\s*["']use server["'];?(?:\s|$)/.test(readFileSync(chemin, "utf8"));
  }).sort();
}

function erreursDeClassification(fichiers: string[], classes: Record<string, ClasseAcces>): string[] {
  const repertories = new Set(fichiers);
  return [
    ...fichiers.filter((chemin) => !(chemin in classes)).map((chemin) => `non classée : ${chemin}`),
    ...Object.keys(classes).filter((chemin) => !repertories.has(chemin)).map((chemin) => `absente : ${chemin}`),
  ];
}

function verifierSortiePublique(texte: string): void {
  expect(texte).not.toMatch(/"(?:faits?|papiers?|pieces?|nombreDeFaits|count|total)"\s*:/i);
  expect(texte).not.toMatch(/\b(?:fait|papier|piece|fact|paper)\b/i);
}

describe("accès aux routes", () => {
  it("classe tous les points d’entrée de l’application, sans entrée fantôme", () => {
    expect(erreursDeClassification(pointsEntree(fichiersApp), CLASSIFICATIONS)).toEqual([]);
  });

  it("rejette une route ajoutée en mémoire sans classe", () => {
    const fixture = ["app/api/fictive/route.ts"];
    expect(erreursDeClassification(fixture, {})).toEqual(["non classée : app/api/fictive/route.ts"]);
  });

  it("aucune surface publique ne lit la base, les faits ou les pièces", () => {
    const publiques = Object.entries(CLASSIFICATIONS)
      .filter(([, classe]) => classe === "public-sans-donnee")
      .map(([chemin]) => chemin);
    for (const chemin of publiques) {
      const source = readFileSync(chemin, "utf8");
      expect(source, chemin).not.toMatch(/from\s+["'][^"']*\/lib\/db(?:\/|["'])/);
      expect(source, chemin).not.toMatch(/\b(?:depotLecture|depotFaits|depotPieces|comptesParDomaine)\b/);
    }
  });

  it("compare les réponses réellement rendues par les routes publiques", async () => {
    vi.stubEnv("MCP_SIGNING_KEY", "s".repeat(32));
    vi.stubEnv("MCP_ACCESS_KEY", "a".repeat(16));
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("AUTHORIZED_EMAIL", "");

    try {
      const origine = "https://memoryai.test";
      for (const [type, get] of [["as", GETMetaAs], ["pr", GETMetaPr]] as const) {
        const reponse = await get(new Request(`${origine}/api/mcp/meta/${type}`));
        expect(reponse.status).toBe(200);
        expect(reponse.headers.get("cache-control")).toBe("no-store");
        const texte = await reponse.text();
        verifierSortiePublique(texte);
        const corps = JSON.parse(texte) as Record<string, unknown>;
        expect(JSON.stringify(corps)).toContain(origine);
        expect(corps).not.toHaveProperty("faits");
        expect(corps).not.toHaveProperty("papiers");
      }

      const inscription = await POSTRegister(new Request(`${origine}/api/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
      }));
      expect(inscription.status).toBe(201);
      const inscriptionTexte = await inscription.text();
      verifierSortiePublique(inscriptionTexte);
      expect(JSON.parse(inscriptionTexte)).toHaveProperty("client_id");

      const page = await LoginPage({ searchParams: Promise.resolve({ error: "refus" }) });
      const rendu = renderToStaticMarkup(page);
      expect(rendu).toContain("Connexion");
      verifierSortiePublique(rendu);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

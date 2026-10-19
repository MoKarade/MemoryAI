// tests/gardePages.test.ts — toute page, toute Server Action, toute route de `app/` est GARDÉE.
//
// Leçons Hubperso : une page ajoutée sans garde ne se découvre pas en production — elle
// s'affiche ; et un test d'exhaustivité ne couvre que la FORME de fichier qu'on lui a apprise
// (page.tsx, puis actions.ts, puis route.ts — trois formes, trois trous successifs). Ce test
// énumère les trois d'un coup, depuis les fichiers RÉELS, et chaque exception est NOMMÉE avec
// la preuve de son authentification de remplacement.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ROUTES_A_AUTH_PROPRE } from "../lib/authGuard";

const fichiers = execSync("git ls-files --cached --others --exclude-standard app", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/** Pages sans données : elles n'ont rien à garder, et le disent. */
const PAGES_EXEMPTEES: Record<string, string> = {
  "app/login/page.tsx": "la seule page publique : elle redirige vers le hub",
};

/** Routes à auth PROPRE : le marqueur est la preuve de l'authentification de remplacement. */
const ROUTES_A_MARQUEUR: Record<string, { route: string; marqueur: RegExp }> = {
  "app/hub/summary/route.ts": { route: "/hub/summary", marqueur: /serveSummary\(/ },
  "app/api/faits/route.ts": { route: "/api/faits", marqueur: /ecrivainAutorise\(/ },
  "app/api/conversations/route.ts": { route: "/api/conversations", marqueur: /ecrivainAutorise\(/ },
  "app/api/pieces/route.ts": { route: "/api/pieces", marqueur: /ecrivainAutorise\(/ },
  "app/api/pieces/file/route.ts": { route: "/api/pieces/file", marqueur: /ecrivainAutorise\(/ },
  "app/api/etat/route.ts": { route: "/api/etat", marqueur: /identifierEcrivain\(/ },
  "app/api/avancement/route.ts": { route: "/api/avancement", marqueur: /ecrivainAutorise\(/ },
  "app/api/mcp/route.ts": { route: "/api/mcp", marqueur: /verifyAccessToken\(/ },
  // Secret DÉDIÉ, comparé en temps CONSTANT : le marqueur vise `timingSafeEqual`, pas le nom
  // de la variable. Une route à jeton doit PROUVER son authentification de remplacement,
  // sinon la liste d'exceptions devient la porte de sortie du test (leçon Hubperso n° 6).
  "app/api/cron/apprentissage/route.ts": { route: "/api/cron/apprentissage", marqueur: /timingSafeEqual\(/ },
  "app/api/mcp/authorize/route.ts": { route: "/api/mcp/authorize", marqueur: /ctx\.auth\.authorize\(/ },
  "app/api/mcp/token/route.ts": { route: "/api/mcp/token", marqueur: /exchangeCode\(/ },
  "app/api/mcp/register/route.ts": { route: "/api/mcp/register", marqueur: /registerClient\(/ },
  "app/api/mcp/meta/as/route.ts": { route: "/api/mcp/meta/as", marqueur: /reponseMetadonnees\(/ },
  "app/api/mcp/meta/pr/route.ts": { route: "/api/mcp/meta/pr", marqueur: /reponseMetadonnees\(/ },
  "app/api/auth/[...nextauth]/route.ts": { route: "/api/auth/", marqueur: /handlers/ },
};

describe("gardePages", () => {
  it("chaque page.tsx appelle requireSession(), sauf les exemptions nommées", () => {
    const pages = fichiers.filter((f) => /\/page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const f of pages) {
      if (f in PAGES_EXEMPTEES) continue;
      expect(/\brequireSession\(\)/.test(readFileSync(f, "utf8")), `${f} n'appelle pas requireSession()`).toBe(true);
    }
    for (const f of Object.keys(PAGES_EXEMPTEES)) expect(pages, `exemption fantôme : ${f}`).toContain(f);
  });

  // [L26] Ajouté après un build CASSÉ, pas par précaution : `/chat/page.tsx` appelait
  // `requireSession()` sans déclarer `force-dynamic`, donc Next a tenté de la PRÉRENDRE et
  // l'export a levé `NonAutorisé`. Le défaut est bruyant — mais il n'apparaît qu'au bout de
  // trois minutes de build, après typecheck, lint et gardes ciblées tous VERTS. Une page
  // prérendue est aussi une page servie DEPUIS UN CACHE à tout le monde : pour une app dont
  // chaque page lit la mémoire d'une personne, c'est la pire des issues, et elle serait
  // silencieuse si le rendu statique réussissait.
  it("chaque page.tsx est force-dynamic — aucune page de cette app ne se prérend", () => {
    const pages = fichiers.filter((f) => /\/page\.tsx$/.test(f));
    expect(pages.length, "aucune page trouvée : le motif est cassé").toBeGreaterThanOrEqual(5);
    for (const f of pages) {
      expect(
        /export const dynamic = "force-dynamic";/.test(readFileSync(f, "utf8")),
        `${f} n'est pas force-dynamic : Next la prérendra au build`,
      ).toBe(true);
    }
  });

  it("chaque actions.ts est « use server » et chaque fonction exportée revérifie la session", () => {
    const actions = fichiers.filter((f) => /\/actions\.ts$/.test(f));
    expect(actions.length).toBeGreaterThanOrEqual(3);
    for (const f of actions) {
      const s = readFileSync(f, "utf8");
      expect(s.startsWith('"use server"'), `${f} sans "use server"`).toBe(true);
      const exportees = [...s.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(exportees.length, `${f} n'exporte rien`).toBeGreaterThan(0);
      for (const nom of exportees) {
        const corps = s.slice(s.indexOf(`export async function ${nom}`));
        const fin = corps.indexOf("\nexport ", 1);
        const bloc = fin === -1 ? corps : corps.slice(0, fin);
        expect(/await (requireSession|preparer)\(/.test(bloc), `${f}#${nom} ne revérifie pas la session`).toBe(true);
      }
      // `preparer` n'est un alibi que s'il appelle lui-même requireSession.
      if (/await preparer\(/.test(s)) expect(/async function preparer[\s\S]*?await requireSession\(\)/.test(s), `${f} : preparer sans requireSession`).toBe(true);
    }
  });

  it("chaque route.ts revérifie la session OU est une route à auth propre avec sa preuve", () => {
    const routes = fichiers.filter((f) => /\/route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const f of routes) {
      const s = readFileSync(f, "utf8");
      const propre = ROUTES_A_MARQUEUR[f];
      if (propre) {
        expect(propre.marqueur.test(s), `${f} : preuve d'auth propre absente (${propre.marqueur})`).toBe(true);
        if (!propre.route.endsWith("/")) expect(ROUTES_A_AUTH_PROPRE as readonly string[], `${f} hors de ROUTES_A_AUTH_PROPRE`).toContain(propre.route);
      } else {
        expect(/\brequireSession\(\)/.test(s), `${f} : ni requireSession() ni auth propre déclarée`).toBe(true);
      }
    }
    for (const f of Object.keys(ROUTES_A_MARQUEUR)) expect(routes, `route à marqueur fantôme : ${f}`).toContain(f);
  });

  it("aucune page ni action n'importe le client Anthropic ni ne lit une clé", () => {
    for (const f of fichiers.filter((x) => /\/(page|actions|ChatClient)\.tsx?$/.test(x))) {
      const s = readFileSync(f, "utf8");
      expect(s, `${f} importe le SDK`).not.toContain("@anthropic-ai/sdk");
      for (const cle of ["MEMORYAI_CHIFFREMENT", "MCP_SIGNING_KEY", "MCP_ACCESS_KEY", "ANTHROPIC_API_KEY", "MEMORYAI_JOURNAL_CLE"]) {
        // Lire `process.env.X` dans une page est le premier pas vers une prop, donc vers le navigateur.
        // `Boolean(process.env.ANTHROPIC_API_KEY?.trim())` est toléré : un booléen, jamais la valeur.
        const toutes = (s.match(new RegExp(`process\\.env\\.${cle}\\b`, "g")) ?? []).length;
        const booleennes = (s.match(new RegExp(`Boolean\\(process\\.env\\.${cle}\\?\\.trim\\(\\)\\)`, "g")) ?? []).length;
        expect(toutes, `${f} lit ${cle} autrement qu'en booléen`).toBe(booleennes);
      }
    }
  });
});

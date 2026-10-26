// tests/sortiesLecture.test.ts — l'outil MCP `memoryai_sorties` (ADR 0031 § 6) : ce qu'il lit, ce qu'il
// COMPTE sans le lire, et la trace qu'il laisse. Sur une vraie Postgres (PGlite) et les migrations
// committées. Données FICTIVES seulement.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotQuestionsDrizzle } from "../lib/depotQuestions";
import { depotConversationsDrizzle } from "../lib/conversations/depot";
import { depotLectureDrizzle } from "../lib/depotLecture";
import { depotPiecesLectureDrizzle } from "../lib/pieces/depotLecture";
import { lireEnvoiSorties } from "../lib/sorties/contrat";
import { ecrireSorties } from "../lib/sorties/depot";
import { baliserSorties, correspond, depotSortiesDrizzle, ENTETE_SORTIES, type SortieRendue } from "../lib/sorties/lecture";
import { OUTILS_MCP_SEULS, type ContexteOutils } from "../lib/mcp/outils";
import { traiterMessage } from "../lib/mcp/protocole";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const CLE_JOURNAL = "cle-de-journal-de-test-0123456789abcdef";
const MAINTENANT = new Date("2026-10-26T12:00:00Z");

async function ecrire(app: string, evenements: Record<string, unknown>[]) {
  const lu = lireEnvoiSorties({ source: "sorties", evenements }, MAINTENANT);
  if (!lu.ok) throw new Error(lu.code);
  return ecrireSorties(db as never, cle, app, lu.envoi.sorties);
}

const depot = () => depotSortiesDrizzle(db as never, cle);

/** Un envoi par niveau : BatchChef (1), CarAI (2), FinanceAI (3) — les planchers de l'ADR 0031. */
async function semer() {
  await pg.exec("delete from sorties");
  await ecrire("batchchef", [
    { type: "recette_ajoutee", date: "2026-10-24T12:00:00Z", titre: "Soupe aux légumes d'exemple", resume: "Ajoutée au catalogue fictif", ref: "r1" },
  ]);
  await ecrire("carai", [{ type: "recharge", date: "2026-10-23T12:00:00Z", titre: "Recharge fictive terminée", ref: "c1" }]);
  await ecrire("financeai", [{ type: "releve", date: "2026-10-22T12:00:00Z", titre: "Relevé fictif importé", ref: "f1" }]);
}

function ctx(env: Record<string, string | undefined> = {}, avecSorties = true): ContexteOutils {
  return {
    lecture: depotLectureDrizzle(db),
    ecriture: depotDrizzle(db),
    pieces: depotPiecesLectureDrizzle(db),
    questions: depotQuestionsDrizzle(db),
    conversations: depotConversationsDrizzle(db),
    ...(avecSorties ? { sorties: depot() } : {}),
    cle,
    env: { MEMORYAI_JOURNAL_CLE: CLE_JOURNAL, ...env },
    lecteur: "claude-ai",
    maintenant: () => MAINTENANT,
  };
}

async function appeler(args: Record<string, unknown> = {}, env?: Record<string, string | undefined>, avecSorties = true) {
  const r = await traiterMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memoryai_sorties", arguments: args } },
    ctx(env, avecSorties),
  );
  const res = r?.result as { content: { type: string; text: string }[]; isError?: boolean };
  return { texte: res.content[0]!.text, isError: res.isError === true };
}

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

beforeEach(semer);

afterAll(async () => {
  await pg?.close();
});

describe("correspond — les mots de la question, sans accent ni casse", () => {
  it("sans mot, tout passe ; avec des mots, tous doivent se trouver dans le titre ou le résumé", () => {
    expect(correspond(undefined, "Soupe", null)).toBe(true);
    expect(correspond("   ", "Soupe", null)).toBe(true);
    expect(correspond("SOUPE legumes", "Soupe aux légumes", null)).toBe(true);
    expect(correspond("légume", "Soupe aux legumes", null)).toBe(true);
    expect(correspond("catalogue", "Soupe", "Ajoutée au catalogue")).toBe(true);
    expect(correspond("soupe pizza", "Soupe aux légumes", null)).toBe(false);
    expect(correspond("pizza", "Soupe", "Ajoutée")).toBe(false);
  });
});

describe("depotSortiesDrizzle — lire par niveau", () => {
  it("niveau 1 : seul BatchChef est lu ; les niveaux 2 et 3 sont COMPTÉS, par niveau", async () => {
    const l = await depot().lire({ niveauMax: 1, limite: 20 });
    expect(l.sorties.map((s) => s.app)).toEqual(["batchchef"]);
    expect(l.correspondent).toBe(1);
    expect(l.masquees).toEqual([
      { niveau: 2, n: 1 },
      { niveau: 3, n: 1 },
    ]);
    expect(l.illisibles).toBe(0);
    expect(l.tronquee).toBe(false);
    expect(l.sorties[0]).toMatchObject({ type: "recette_ajoutee", niveau: 1, titre: "Soupe aux légumes d'exemple", resume: "Ajoutée au catalogue fictif" });
  });

  it("niveau 2 : les plus récentes d'abord, le niveau 3 reste compté", async () => {
    const l = await depot().lire({ niveauMax: 2, limite: 20 });
    expect(l.sorties.map((s) => s.app)).toEqual(["batchchef", "carai"]);
    expect(l.masquees).toEqual([{ niveau: 3, n: 1 }]);
  });

  it("niveau 3 : tout est lu, du plus récent au plus ancien, rien de masqué", async () => {
    const l = await depot().lire({ niveauMax: 3, limite: 20 });
    expect(l.sorties.map((s) => s.app)).toEqual(["batchchef", "carai", "financeai"]);
    expect(l.masquees).toEqual([]);
  });

  it("filtre par app, par type et par période — le décompte des masquées suit les mêmes filtres", async () => {
    expect((await depot().lire({ niveauMax: 3, limite: 20, app: "carai" })).sorties.map((s) => s.app)).toEqual(["carai"]);
    expect((await depot().lire({ niveauMax: 3, limite: 20, type: "releve" })).sorties.map((s) => s.app)).toEqual(["financeai"]);
    const depuis = await depot().lire({ niveauMax: 3, limite: 20, depuis: new Date("2026-10-23T00:00:00Z") });
    expect(depuis.sorties.map((s) => s.app)).toEqual(["batchchef", "carai"]);
    const jusqua = await depot().lire({ niveauMax: 3, limite: 20, jusqua: new Date("2026-10-22T23:59:59Z") });
    expect(jusqua.sorties.map((s) => s.app)).toEqual(["financeai"]);
    const masque = await depot().lire({ niveauMax: 1, limite: 20, app: "carai" });
    expect(masque.sorties).toEqual([]);
    expect(masque.masquees).toEqual([{ niveau: 2, n: 1 }]);
  });

  it("filtre par mots, sans accent ni casse, sur le texte déchiffré", async () => {
    const l = await depot().lire({ niveauMax: 3, limite: 20, question: "LEGUMES soupe" });
    expect(l.sorties.map((s) => s.app)).toEqual(["batchchef"]);
    expect(l.correspondent).toBe(1);
    expect((await depot().lire({ niveauMax: 3, limite: 20, question: "recharge" })).sorties.map((s) => s.app)).toEqual(["carai"]);
    expect((await depot().lire({ niveauMax: 3, limite: 20, question: "introuvable" })).sorties).toEqual([]);
  });

  it("la limite coupe l'affichage, pas le décompte des correspondantes", async () => {
    const l = await depot().lire({ niveauMax: 3, limite: 1 });
    expect(l.sorties).toHaveLength(1);
    expect(l.correspondent).toBe(3);
  });

  it("une ligne illisible est écartée et comptée, sans rien faire tomber", async () => {
    await pg.exec("update sorties set titre = 'v2:abime' where app = 'carai'");
    const l = await depot().lire({ niveauMax: 2, limite: 20 });
    expect(l.sorties.map((s) => s.app)).toEqual(["batchchef"]);
    expect(l.illisibles).toBe(1);
  });
});

describe("baliserSorties — une sortie est une DONNÉE", () => {
  const rendue: SortieRendue = {
    id: "s1",
    app: "batchchef",
    type: "recette_ajoutee",
    date: new Date("2026-10-24T12:00:00Z"),
    niveau: 1,
    titre: "Soupe <b>d'exemple</b>",
    resume: "Ajoutée <script>",
    recuLe: new Date("2026-10-24T12:05:00Z"),
  };

  it("l'en-tête dit que ce sont des données ; chaque sortie porte son app, son type, sa date et son niveau", () => {
    const t = baliserSorties([rendue]);
    expect(t.startsWith(ENTETE_SORTIES)).toBe(true);
    expect(ENTETE_SORTIES).toContain("DONNÉES");
    expect(t).toContain('<sortie id="s1" source="batchchef" type="recette_ajoutee" date="2026-10-24T12:00:00.000Z" niveau="1" recu_le="2026-10-24T12:05:00.000Z">');
    expect(t.match(/<sortie /g)).toHaveLength(1);
  });

  it("le texte ne peut pas ouvrir ni fermer une balise", () => {
    const t = baliserSorties([rendue]);
    expect(t).not.toContain("<b>");
    expect(t).not.toContain("</b>");
    expect(t).not.toContain("<script>");
  });

  it("sans sortie, le dit — et les notes passent après l'en-tête", () => {
    const t = baliserSorties([], "Une note.");
    expect(t).toContain("Aucune sortie à montrer.");
    expect(t.split("\n")[1]).toBe("Une note.");
  });
});

describe("l'outil memoryai_sorties", () => {
  it("est au catalogue du MCP, sans paramètre pour le niveau 3, et réservé au MCP", async () => {
    const l = await traiterMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx());
    const outils = (l?.result as { tools: { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[] }).tools;
    const o = outils.find((t) => t.name === "memoryai_sorties");
    expect(o).toBeDefined();
    expect(Object.keys(o!.inputSchema.properties)).not.toContain("inclure_n3");
    expect(o!.inputSchema.properties.app?.enum).toEqual(["batchchef", "carai", "driveai", "financeai", "jobai"]);
    expect(OUTILS_MCP_SEULS.has("memoryai_sorties")).toBe(true);
  });

  it("sans dépôt branché, le dit au lieu de répondre vide", async () => {
    const r = await appeler({}, undefined, false);
    expect(r.isError).toBe(false);
    expect(r.texte).toContain("non branchées");
  });

  it("par défaut : niveau 1 lu, niveaux 2 et 3 comptés sans qu'une ligne de leur texte sorte", async () => {
    const r = await appeler();
    expect(r.texte).toContain('source="batchchef"');
    expect(r.texte).toContain("Soupe aux légumes d'exemple");
    expect(r.texte).not.toContain("Recharge fictive");
    expect(r.texte).not.toContain("Relevé fictif");
    expect(r.texte).toContain("1 sortie(s) de niveau 2 massquée(s)".replace("massquée", "masquée"));
    expect(r.texte).toContain("1 sortie(s) de niveau 3 masquée(s)");
    expect(r.texte).toContain("inclure_n2");
  });

  it("inclure_n2 sans la variable : refusé, et le lecteur en est prévenu", async () => {
    const r = await appeler({ inclure_n2: true });
    expect(r.texte).toContain("MEMORYAI_N2_CHAT");
    expect(r.texte).not.toContain("Recharge fictive");
  });

  it("inclure_n2 avec la variable : le niveau 2 sort, le niveau 3 jamais — même en le demandant", async () => {
    const r = await appeler({ inclure_n2: true, inclure_n3: true }, { MEMORYAI_N2_CHAT: "1", MEMORYAI_N3_CHAT: "1" });
    expect(r.texte).toContain("Recharge fictive terminée");
    expect(r.texte).toContain('niveau="2"');
    expect(r.texte).not.toContain("Relevé fictif");
    expect(r.texte).toContain("1 sortie(s) de niveau 3 masquée(s)");
  });

  it("un filtre d'app ne compte que cette app", async () => {
    const r = await appeler({ app: "batchchef" });
    expect(r.texte).toContain("Soupe aux légumes");
    expect(r.texte).not.toContain("masquée");
  });

  it("une app inconnue ou un instant sans décalage est une erreur, pas un résultat vide", async () => {
    const a = await appeler({ app: "hubperso" });
    expect(a.isError).toBe(true);
    expect(a.texte).toContain("app");
    const i = await appeler({ depuis: "2026-10-24 12:00" });
    expect(i.isError).toBe(true);
    expect(i.texte).toContain("depuis");
  });

  it("journalise chaque appel, avec l'empreinte de la question — jamais le texte", async () => {
    await appeler({ question: "légumes" });
    await appeler({ inclure_n2: true }, { MEMORYAI_N2_CHAT: "1" });
    const rows = (await db.select().from(schema.accesJournal)).filter((r) => r.outil === "memoryai_sorties");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.questionEmpreinte !== null)).toBe(true);
    expect(rows.every((r) => r.usage === "conversation")).toBe(true);
    const brut = JSON.stringify(rows);
    for (const mot of ["Soupe", "légumes", "legumes", "Recharge", "Relevé"]) expect(brut).not.toContain(mot);
  });
});

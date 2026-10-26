// tests/autonomie.test.ts — LIA agit seule dans ses limites et tient le journal de ce qu'elle a fait (ADR 0032).
// Sur une vraie Postgres (PGlite) et les migrations committées. Données FICTIVES seulement.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ACTIONS, ligneJournal, RETENTION_JOURNAL_JOURS, type CleAction } from "../lib/lia/autonomie";
import { niveauDe } from "../lib/lia/catalogueOutils";
import { agirSeule, consigner, lireFrein, purgerJournal } from "../lib/lia/journal";

let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const MAINTENANT = new Date("2026-10-26T12:00:00Z");
const JOUR_MS = 86_400_000;

const source = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), "utf8");

beforeAll(async () => {
  pg = new PGlite();
  const dossier = resolve(process.cwd(), "drizzle");
  for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg);
});

beforeEach(async () => {
  await pg.exec("delete from actions_lia");
  await pg.exec("delete from lia_frein");
});

afterAll(async () => {
  await pg?.close();
});

const lignes = async () =>
  (await pg.query<{ action: string; issue: string; n: number; niveau: string }>("select action, issue, n, niveau from actions_lia order by instant, action")).rows;

describe("ACTIONS — une liste fermée, jamais une action qui sort de MemoryAI", () => {
  it("les trois actions de la passe, chacune à un niveau qui ne sort pas de MemoryAI", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(["deduction", "idees", "relecture"]);
    for (const a of Object.values(ACTIONS)) {
      expect(["lecture", "ecriture-interne"]).toContain(a.niveau);
      expect(a.raison.length).toBeGreaterThan(0);
      expect(a.raison.length).toBeLessThanOrEqual(200);
    }
  });

  it("le niveau du catalogue des outils n'est pas contredit : aucun outil de niveau `sort-de-memoryai` n'est une action", () => {
    // Le catalogue range les OUTILS ; les actions n'en sont pas. On verrouille le vocabulaire commun : si un jour
    // une action porte le nom d'un outil du catalogue, son niveau doit y être le même et ne pas sortir.
    for (const cle of Object.keys(ACTIONS)) {
      const n = niveauDe(cle);
      if (n !== undefined) expect(n).not.toBe("sort-de-memoryai");
    }
  });

  it("ligneJournal prend niveau et raison dans ACTIONS, et ramène `n` à un entier ≥ 0", () => {
    expect(ligneJournal("idees", "faite", 3)).toEqual({ action: "idees", niveau: ACTIONS.idees.niveau, raison: ACTIONS.idees.raison, n: 3, issue: "faite" });
    expect(ligneJournal("idees", "faite", 2.9).n).toBe(2);
    expect(ligneJournal("idees", "faite", -4).n).toBe(0);
    expect(ligneJournal("idees", "faite", Number.NaN).n).toBe(0);
    expect(ligneJournal("idees", "faite", Number.POSITIVE_INFINITY).n).toBe(0);
  });

  it("les limites tiennent dans le code : ni réseau, ni secret, ni suppression de contenu dans le module des actions", () => {
    const pur = source("lib/lia/autonomie.ts");
    expect(pur).not.toMatch(/fetch\(|process\.env|\.delete\(|\.insert\(|\.update\(/);
    const io = source("lib/lia/journal.ts");
    expect(io).not.toMatch(/fetch\(|process\.env/);
    // La seule suppression du module est celle de son PROPRE journal, après la rétention.
    expect((io.match(/\.delete\(/g) ?? []).length).toBe(1);
    expect(io).toMatch(/\.delete\(actionsLia\)/);
  });
});

describe("la base tient les limites elle-même", () => {
  const base = { id: "x", jour: "2026-10-26", action: "idees", niveau: "lecture", raison: "r", n: 0, issue: "faite" };
  const inserer = (c: Partial<typeof base>) => {
    const v = { ...base, ...c };
    return pg.query("insert into actions_lia (id, jour, action, niveau, raison, n, issue) values ($1,$2,$3,$4,$5,$6,$7)", [v.id, v.jour, v.action, v.niveau, v.raison, v.n, v.issue]);
  };

  it("accepte une ligne valide", async () => {
    await expect(inserer({})).resolves.toBeDefined();
  });

  it("REFUSE le niveau `sort-de-memoryai` — une action qui sort n'est jamais lancée seule", async () => {
    await expect(inserer({ niveau: "sort-de-memoryai" })).rejects.toThrow(/actions_lia_niveau/);
  });

  it("refuse une issue inconnue, une raison de plus de 200 caractères et un compte négatif", async () => {
    await expect(inserer({ issue: "supprimee" })).rejects.toThrow(/actions_lia_issue/);
    await expect(inserer({ id: "y", raison: "x".repeat(201) })).rejects.toThrow(/actions_lia_raison_200/);
    await expect(inserer({ id: "z", n: -1 })).rejects.toThrow(/actions_lia_n_positif/);
  });

  it("le frein est UNE ligne : un autre identifiant est refusé", async () => {
    await expect(pg.query("insert into lia_frein (id, en_pause) values ('autre', true)")).rejects.toThrow(/lia_frein_une_ligne/);
    await expect(pg.query("insert into lia_frein (en_pause) values (false)")).resolves.toBeDefined();
    await expect(pg.query("insert into lia_frein (en_pause) values (true)")).rejects.toThrow();
  });
});

describe("le frein", () => {
  it("sans ligne, LIA est en marche", async () => {
    expect(await lireFrein(db as never)).toBe(false);
  });

  it("posé, il se lit ; levé, il se relit", async () => {
    await pg.exec("insert into lia_frein (en_pause) values (true)");
    expect(await lireFrein(db as never)).toBe(true);
    await pg.exec("update lia_frein set en_pause = false");
    expect(await lireFrein(db as never)).toBe(false);
  });
});

describe("agirSeule — le frein d'abord, puis l'action, puis son journal", () => {
  it("en marche : l'action part et le journal dit combien éléments elle a touchés", async () => {
    const r = await agirSeule(db as never, MAINTENANT, "idees", async () => ({ creees: 2, majs: 1 }), (x) => x.creees + x.majs);
    expect(r).toEqual({ creees: 2, majs: 1 });
    expect(await lignes()).toEqual([{ action: "idees", issue: "faite", n: 3, niveau: "ecriture-interne" }]);
  });

  it("frein posé : l'action NE PART PAS et le journal le dit", async () => {
    await pg.exec("insert into lia_frein (en_pause) values (true)");
    let partie = false;
    const r = await agirSeule(db as never, MAINTENANT, "deduction", async () => ((partie = true), 1), () => 1);
    expect(r).toBe("frein");
    expect(partie).toBe(false);
    expect(await lignes()).toEqual([{ action: "deduction", issue: "frein", n: 0, niveau: "ecriture-interne" }]);
  });

  it("le frein se lit AVANT CHAQUE action : posé entre deux, la seconde ne part pas", async () => {
    const ordre: string[] = [];
    await agirSeule(db as never, MAINTENANT, "deduction", async () => (ordre.push("deduction"), 1), () => 1);
    await pg.exec("insert into lia_frein (en_pause) values (true)");
    const r = await agirSeule(db as never, MAINTENANT, "idees", async () => (ordre.push("idees"), 1), () => 1);
    expect(r).toBe("frein");
    expect(ordre).toEqual(["deduction"]);
    expect((await lignes()).map((l) => `${l.action}:${l.issue}`).sort()).toEqual(["deduction:faite", "idees:frein"]);
  });

  it("une action qui lève est notée en échec PUIS relancée — la passe la montre à sa façon", async () => {
    await expect(agirSeule(db as never, MAINTENANT, "idees", async () => { throw new Error("panne fictive"); }, () => 1)).rejects.toThrow("panne fictive");
    expect(await lignes()).toEqual([{ action: "idees", issue: "echec", n: 0, niveau: "ecriture-interne" }]);
  });

  it("un journal en panne ne bloque pas l'action", async () => {
    await pg.exec("drop table actions_lia");
    try {
      const r = await agirSeule(db as never, MAINTENANT, "idees", async () => 7, (x) => x);
      expect(r).toBe(7);
    } finally {
      // La table est recréée depuis la migration committée, pas à la main : le test suivant la retrouve telle quelle.
      const sql = readFileSync(resolve(process.cwd(), "drizzle/0037_actions_lia.sql"), "utf8").split("--> statement-breakpoint");
      for (const s of sql) if (s.trim()) await pg.exec(s);
    }
  });

  it("un frein illisible fait ÉCHOUER l'action : elle ne part pas faute de savoir", async () => {
    await pg.exec("drop table lia_frein");
    try {
      let partie = false;
      await expect(agirSeule(db as never, MAINTENANT, "idees", async () => ((partie = true), 1), () => 1)).rejects.toThrow();
      expect(partie).toBe(false);
    } finally {
      const sql = readFileSync(resolve(process.cwd(), "drizzle/0037_actions_lia.sql"), "utf8").split("--> statement-breakpoint");
      for (const s of sql) if (s.trim()) await pg.exec(s);
    }
  });
});

describe("le journal", () => {
  it("consigner écrit le jour de Québec, pas celui du serveur", async () => {
    // 02:30 UTC le 27/10 = 22:30 le 26/10 à Québec.
    await consigner(db as never, new Date("2026-10-27T02:30:00Z"), "relecture", "faite", 4);
    const r = await pg.query<{ jour: string }>("select jour from actions_lia");
    expect(r.rows[0]?.jour).toBe("2026-10-26");
  });

  it("purgerJournal efface ce qui a plus de 90 jours, et rien d'autre", async () => {
    const vieux = new Date(MAINTENANT.getTime() - (RETENTION_JOURNAL_JOURS + 1) * JOUR_MS).toISOString();
    const recent = new Date(MAINTENANT.getTime() - (RETENTION_JOURNAL_JOURS - 1) * JOUR_MS).toISOString();
    await consigner(db as never, MAINTENANT, "idees", "faite", 1);
    await consigner(db as never, MAINTENANT, "deduction", "faite", 1);
    await pg.query("update actions_lia set instant = $1::timestamptz where action = 'idees'", [vieux]);
    await pg.query("update actions_lia set instant = $1::timestamptz where action = 'deduction'", [recent]);
    expect(await purgerJournal(db as never, MAINTENANT)).toBe(1);
    expect((await lignes()).map((l) => l.action)).toEqual(["deduction"]);
    expect(RETENTION_JOURNAL_JOURS).toBe(90);
  });
});

describe("la passe quotidienne", () => {
  const route = source("app/api/cron/apprentissage/route.ts");

  it("lance déduction et idées par `agirSeule`, jamais en direct", () => {
    expect(route).toMatch(/agirSeule\(\s*acces\.db,\s*new Date\(\),\s*"deduction"/);
    expect(route).toMatch(/agirSeule\(acces\.db, new Date\(\), "idees"/);
    expect(route).not.toMatch(/=\s*await passeDeduction\(/);
    expect(route).not.toMatch(/=\s*await passeIdees\(/);
  });

  it("lit le frein AVANT la relecture, la retire quand il est posé et note le frein au journal", () => {
    expect(route.indexOf("lireFrein(acces.db)")).toBeGreaterThan(-1);
    expect(route.indexOf("lireFrein(acces.db)")).toBeLessThan(route.indexOf("passeApprentissage("));
    expect(route).toMatch(/relecture: freine \? undefined : depotRelectureDrizzle\(acces\.db\)/);
    expect(route).toMatch(/consigner\(acces\.db, new Date\(\), "relecture", "frein"/);
    // Un frein illisible suspend la relecture : la valeur de départ est « posé ».
    expect(route).toMatch(/let freine = true;/);
  });

  it("les clés d'action de la passe sont toutes au catalogue des actions", () => {
    for (const cle of ["relecture", "deduction", "idees"] satisfies CleAction[]) expect(Object.keys(ACTIONS)).toContain(cle);
  });
});

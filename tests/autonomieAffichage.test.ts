// tests/autonomieAffichage.test.ts — ce que LIA a fait seule se lit dans « Sa journée », et le frein se pose
// depuis Régler (ADR 0032, lot 3). Sur une vraie Postgres (PGlite) et les migrations committées.
// Données FICTIVES seulement.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ACTIONS, estAction, estIssue, LIBELLE_ACTION, LIBELLE_ISSUE } from "../lib/lia/autonomie";
import { consigner, lireEtatFrein, lireFrein, lireJournalDuJour, poserFrein } from "../lib/lia/journal";
import { tableauJournee } from "@/lib/accueil/tableaux";
import { avecJournalLia, type JournalLia } from "@/lib/accueil/tuileSeule";

let pg: PGlite;
let db: ReturnType<typeof drizzle>;

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

describe("les noms que Marc lit", () => {
  it("chaque action et chaque issue a son nom, et rien d'autre", () => {
    expect(Object.keys(LIBELLE_ACTION).sort()).toEqual(Object.keys(ACTIONS).sort());
    expect(Object.keys(LIBELLE_ISSUE).sort()).toEqual(["budget", "echec", "faite", "frein"]);
  });

  it("les gardes de lecture reconnaissent les clés connues et rien d'autre, prototype compris", () => {
    expect(estAction("relecture")).toBe(true);
    expect(estAction("constructor")).toBe(false);
    expect(estAction("inconnue")).toBe(false);
    expect(estIssue("faite")).toBe(true);
    expect(estIssue("toString")).toBe(false);
  });
});

describe("le frein, du côté de Marc", () => {
  it("sans ligne : en marche, et personne ne l'a touché", async () => {
    expect(await lireEtatFrein(db as never)).toEqual({ enPause: false, changeLe: null });
  });

  it("posé puis levé : une seule ligne, avec l'heure du dernier geste", async () => {
    const t1 = new Date("2026-10-26T14:00:00Z");
    const t2 = new Date("2026-10-26T15:30:00Z");
    await poserFrein(db as never, true, t1);
    let e = await lireEtatFrein(db as never);
    expect(e.enPause).toBe(true);
    expect(e.changeLe?.getTime()).toBe(t1.getTime());
    expect(await lireFrein(db as never)).toBe(true);

    await poserFrein(db as never, false, t2);
    e = await lireEtatFrein(db as never);
    expect(e.enPause).toBe(false);
    expect(e.changeLe?.getTime()).toBe(t2.getTime());
    expect(await lireFrein(db as never)).toBe(false);

    const n = await pg.query<{ n: number }>("select count(*)::int as n from lia_frein");
    expect(n.rows[0]?.n).toBe(1);
  });
});

describe("lireJournalDuJour", () => {
  it("rend les lignes du jour de Québec, la plus récente d'abord, et écarte ce qu'il ne sait pas nommer", async () => {
    await consigner(db as never, new Date("2026-10-26T15:00:00Z"), "relecture", "faite", 4);
    await consigner(db as never, new Date("2026-10-26T16:00:00Z"), "deduction", "frein", 0);
    await consigner(db as never, new Date("2026-10-25T15:00:00Z"), "idees", "faite", 1);
    // La base ne contraint pas `action` : une ligne inconnue du code n'est pas montrée.
    await pg.query("insert into actions_lia (id, jour, instant, action, niveau, raison, n, issue) values ('x', '2026-10-26', '2026-10-26T17:00:00Z', 'inconnue', 'lecture', 'r', 0, 'faite')");

    const lignes = await lireJournalDuJour(db as never, "2026-10-26");
    expect(lignes.map((l) => l.action)).toEqual(["deduction", "relecture"]);
    expect(lignes[1]).toMatchObject({ action: "relecture", n: 4, issue: "faite", raison: ACTIONS.relecture.raison });
    expect(lignes[0]).toMatchObject({ issue: "frein", n: 0 });
  });

  it("rien ce jour-là : une liste vide, pas une erreur", async () => {
    expect(await lireJournalDuJour(db as never, "2026-10-26")).toEqual([]);
  });
});

describe("la tuile « Ce qu'elle a fait seule »", () => {
  const JOUR = "2026-10-26";
  const journal = (c: Partial<JournalLia> = {}): JournalLia => ({ jour: JOUR, frein: { enPause: false, changeLe: null }, lignes: [], ...c });
  const seule = (t: ReturnType<typeof tableauJournee>) => {
    const u = t.tuiles.find((x) => x.cle === "seule");
    if (!u) throw new Error("tuile absente");
    return u;
  };

  it("journal non lu : le tableau reste tel quel", () => {
    const t = tableauJournee([]);
    expect(avecJournalLia(t, undefined)).toBe(t);
  });

  it("s'ajoute juste après « Journal », sans toucher aux autres tuiles", () => {
    const t = tableauJournee([]);
    const r = avecJournalLia(t, journal());
    expect(r.tuiles.map((u) => u.cle)).toEqual(["24h", "journal", "seule", "temps", "relances", "aujourdhui", "surveille"]);
    expect(r.tuiles.filter((u) => u.cle !== "seule")).toEqual(t.tuiles);
    expect(r.question).toBe(t.question);
  });

  it("rien fait et pas de frein : elle le dit, avec le lien qui pose le frein", () => {
    const u = seule(avecJournalLia(tableauJournee([]), journal()));
    expect(u.corps[0]).toMatchObject({ genre: "texte", lien: { href: "/regler", libelle: "Poser le frein" } });
    expect(u.corps[0]).toMatchObject({ texte: expect.stringContaining("Pas de frein") });
    expect(u.corps[1]).toEqual({ genre: "vide", texte: "Elle n'a rien fait seule aujourd'hui." });
  });

  it("frein posé : il le dit avec l'heure, et le lien le lève", () => {
    const u = seule(avecJournalLia(tableauJournee([]), journal({ frein: { enPause: true, changeLe: new Date("2026-10-26T14:05:00Z") } })));
    const c = u.corps[0];
    expect(c).toMatchObject({ genre: "texte", lien: { href: "/regler", libelle: "Lever le frein" } });
    expect(c.genre === "texte" ? c.texte : "").toMatch(/Frein posé \(aujourd'hui, 10\s*h\s*05\)/);
  });

  it("une ligne dit l'heure, l'action, l'issue, le compte et la raison écrite une fois", () => {
    const lignes = [
      { instant: new Date("2026-10-26T14:05:00Z"), action: "relecture" as const, raison: ACTIONS.relecture.raison, n: 4, issue: "faite" as const },
      { instant: new Date("2026-10-26T14:06:00Z"), action: "idees" as const, raison: ACTIONS.idees.raison, n: 1, issue: "faite" as const },
      { instant: new Date("2026-10-26T14:07:00Z"), action: "deduction" as const, raison: ACTIONS.deduction.raison, n: 0, issue: "frein" as const },
    ];
    const u = seule(avecJournalLia(tableauJournee([]), journal({ lignes })));
    const liste = u.corps[1];
    if (liste?.genre !== "liste") throw new Error("liste attendue");
    expect(liste.elements[0]?.libelle).toMatch(/^10\s*h\s*05 · Relire les faits proposés$/);
    expect(liste.elements[0]?.detail).toBe(`Faite, 4 éléments. ${ACTIONS.relecture.raison}`);
    expect(liste.elements[1]?.detail).toBe(`Faite, 1 élément. ${ACTIONS.idees.raison}`);
    expect(liste.elements[2]?.detail).toBe(`Retenue par le frein. ${ACTIONS.deduction.raison}`);
  });

  it("base muette : une seule ligne vide qui le dit", () => {
    const u = seule(avecJournalLia(tableauJournee([]), null));
    expect(u.corps).toHaveLength(1);
    expect(u.corps[0]).toMatchObject({ genre: "vide", texte: expect.stringContaining("La base ne répond pas") });
  });
});

describe("le câblage", () => {
  it("l'action du frein revérifie la session avant tout et n'accepte que « 0 » ou « 1 »", () => {
    const actions = source("app/regler/actions.ts");
    const corps = actions.slice(actions.indexOf("export async function freinLiaAction"));
    expect(corps.indexOf("requireSession()")).toBeGreaterThan(-1);
    expect(corps.indexOf("requireSession()")).toBeLessThan(corps.indexOf("accesDonnees()"));
    expect(corps).toMatch(/brut !== "0" && brut !== "1"/);
    expect(corps).toMatch(/poserFrein\(acces\.db, brut === "1"/);
  });

  it("Régler porte le formulaire du frein, la maison porte la tuile", () => {
    const regler = source("app/regler/page.tsx");
    expect(regler).toMatch(/action=\{freinLiaAction\}/);
    expect(regler).toMatch(/name="pause"/);
    expect(regler).toMatch(/lireEtatFrein\(acces\.db\)/);
    const maison = source("app/page.tsx");
    expect(maison).toMatch(/lireJournalDuJour\(acces\.db, jour\)/);
    expect(maison).toMatch(/avecJournalLia\(journee, journal\)/);
  });

  it("la tuile est pure : ni réseau, ni secret, ni base", () => {
    expect(source("lib/accueil/tuileSeule.ts")).not.toMatch(/fetch\(|process\.env|drizzle|\.insert\(|\.delete\(|\.update\(/);
  });
});

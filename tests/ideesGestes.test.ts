// tests/ideesGestes.test.ts — les gestes de Marc sur une idée de LIA (ADR 0027 §4 et §5, tâche
// MemoryAI 338) : retenir, écarter sur une VRAIE Postgres (PGlite), le lien « En faire une tâche »
// (pur), et le câblage de l'écran. Les tuiles ont leur fichier (`tests/ideesTuiles.test.ts`).
// Données FICTIVES : noms, apps et jours inventés.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { deriverCle } from "../lib/chiffrement";
import * as schema from "../lib/db/schema";
import { depotDemandesDrizzle } from "../lib/demandes";
import { appliquerGeste } from "../lib/idees/geste";
import { passeIdees } from "../lib/idees/depot";
import { urlNouvelleIssue } from "../lib/idees/issue";
import { idees } from "../lib/idees/table";

describe("les gestes sur une vraie Postgres", () => {
  let pg: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const cle = deriverCle(randomBytes(32).toString("base64"));
  const T0 = new Date("2026-10-26T16:00:00Z");
  const T1 = new Date("2026-10-26T17:00:00Z");

  beforeAll(async () => {
    pg = new PGlite();
    const dossier = resolve(process.cwd(), "drizzle");
    for (const f of readdirSync(dossier).filter((x) => x.endsWith(".sql")).sort()) {
      for (const s of readFileSync(resolve(dossier, f), "utf8").split("--> statement-breakpoint")) if (s.trim()) await pg.exec(s);
    }
    db = drizzle(pg, { schema });
  });
  afterAll(async () => pg?.close());
  beforeEach(async () => {
    await pg.exec("DELETE FROM idees; DELETE FROM demandes; DELETE FROM oublis;");
  });

  /** Une idée née de deux jours de demande, comme en production : on passe par la vraie passe. */
  const uneIdee = async () => {
    for (const jour of ["2026-10-24", "2026-10-25"]) await depotDemandesDrizzle(db, cle).ecrire({ type: "changer", app: "hub", genre: "tuile", nom: "Budget fictif", demandeLe: `${jour}T12:00:00-04:00` });
    await passeIdees(db, cle, T0);
    const [ligne] = await db.select().from(idees);
    if (!ligne) throw new Error("idée attendue");
    return ligne;
  };
  const etat = async (id: string) => (await db.select().from(idees).where(eq(idees.id, id)))[0];

  it("retenir : proposée devient retenue, et seuls l'état et la date de mise à jour bougent", async () => {
    const avant = await uneIdee();
    expect(avant.etat).toBe("proposee");
    expect(await appliquerGeste(db, avant.id, "retenir", T1)).toBe(true);
    const apres = await etat(avant.id);
    expect(apres).toMatchObject({ etat: "retenue", utilite: avant.utilite, raisons: avant.raisons, cible: avant.cible, empreinte: avant.empreinte });
    expect(apres?.majLe.getTime()).toBe(T1.getTime());
  });

  it("écarter : une proposée ou une retenue devient écartée", async () => {
    const a = await uneIdee();
    expect(await appliquerGeste(db, a.id, "ecarter", T1)).toBe(true);
    expect((await etat(a.id))?.etat).toBe("ecartee");

    await pg.exec("UPDATE idees SET etat = 'proposee'");
    await appliquerGeste(db, a.id, "retenir", T1);
    expect(await appliquerGeste(db, a.id, "ecarter", T1)).toBe(true);
    expect((await etat(a.id))?.etat).toBe("ecartee");
  });

  it("un geste rejoué ou hors de ses états de départ ne change rien et le dit", async () => {
    const a = await uneIdee();
    expect(await appliquerGeste(db, a.id, "retenir", T1)).toBe(true);
    // Déjà retenue : retenir encore ne fait rien.
    expect(await appliquerGeste(db, a.id, "retenir", new Date("2026-10-26T18:00:00Z"))).toBe(false);
    expect((await etat(a.id))?.majLe.getTime()).toBe(T1.getTime());
    // Écartée : plus aucun geste, et surtout pas « retenir » (elle ne revient pas).
    await appliquerGeste(db, a.id, "ecarter", T1);
    expect(await appliquerGeste(db, a.id, "retenir", T1)).toBe(false);
    expect(await appliquerGeste(db, a.id, "ecarter", T1)).toBe(false);
    expect((await etat(a.id))?.etat).toBe("ecartee");
    // Faite : seule l'issue la fait ; aucun geste ne la touche.
    await pg.exec("UPDATE idees SET etat = 'faite'");
    expect(await appliquerGeste(db, a.id, "ecarter", T1)).toBe(false);
    expect(await appliquerGeste(db, a.id, "retenir", T1)).toBe(false);
    expect((await etat(a.id))?.etat).toBe("faite");
  });

  it("une idée inconnue ne change rien", async () => {
    await uneIdee();
    expect(await appliquerGeste(db, "pas-une-idee", "ecarter", T1)).toBe(false);
    expect((await db.select().from(idees))[0]?.etat).toBe("proposee");
  });

  it("une idée écartée n'est pas reproposée par la passe suivante, même si la demande revient", async () => {
    const a = await uneIdee();
    await appliquerGeste(db, a.id, "ecarter", T1);
    await depotDemandesDrizzle(db, cle).ecrire({ type: "changer", app: "hub", genre: "tuile", nom: "Budget fictif", demandeLe: "2026-10-26T12:00:00-04:00" });
    expect(await passeIdees(db, cle, T1)).toMatchObject({ creees: 0, majs: 0 });
    const lignes = await db.select().from(idees);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.etat).toBe("ecartee");
  });
});

describe("« En faire une tâche » : l'adresse de la page « nouvelle issue » (pure)", () => {
  const e = { app: "hub", titre: "Revoir la tuile « Budget fictif » dans le hub", detail: "demandé 3 jours sur 30, la dernière fois le 24 oct.", utilite: 47 };

  it("vise le dépôt de l'app, avec un titre et un corps au gabarit des tâches, sans jeton", () => {
    const url = urlNouvelleIssue(e);
    if (url === null) throw new Error("adresse attendue");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/MoKarade/Hubperso/issues/new");
    expect(u.searchParams.get("title")).toBe("Idée de LIA : Revoir la tuile « Budget fictif » dans le hub");
    const corps = u.searchParams.get("body") ?? "";
    for (const rubrique of ["**Avant**", "**Après**", "**Fini quand**", "**Fichiers touchés**", "**Source**"]) expect(corps).toContain(rubrique);
    expect(corps).toContain("Budget fictif");
    expect(corps).toContain("≈ 47 / 100 (une estimation, pas une mesure)");
    expect(corps).not.toContain("..");
    expect([...u.searchParams.keys()].sort()).toEqual(["body", "title"]);
  });

  it("chaque app du parc a son dépôt, dont celui qui finit par un tiret", () => {
    const depot = (app: string) => new URL(urlNouvelleIssue({ ...e, app }) ?? "https://x.invalide/").pathname.split("/")[2];
    expect(["hub", "financeai", "driveai", "batchchef", "carai", "jobai", "memoryai"].map(depot)).toEqual(["Hubperso", "FinanceAI", "DriveAI", "batchchef-", "CarAI", "JobAI", "MemoryAI"]);
  });

  it("une app hors du parc n'a pas d'adresse : jamais un dépôt deviné", () => {
    expect(urlNouvelleIssue({ ...e, app: "inconnue" })).toBeNull();
    expect(urlNouvelleIssue({ ...e, app: "" })).toBeNull();
  });

  it("un titre trop long est coupé en caractères, sans casser une paire de substitution", () => {
    // « Idée de LIA : » fait 14 caractères : 103 « é » les portent à 117, et la coupe à 120 tombe
    // après le 3e emoji. Coupé en unités UTF-16, le titre finirait par une moitié d'emoji et
    // `encodeURIComponent` lèverait.
    const long = `${"é".repeat(103)}${"😀".repeat(5)}`;
    const url = urlNouvelleIssue({ ...e, titre: long });
    if (url === null) throw new Error("adresse attendue");
    const titre = new URL(url).searchParams.get("title") ?? "";
    expect([...titre]).toHaveLength(120);
    expect(titre.endsWith("😀")).toBe(true);
    expect([...titre].filter((c) => c === "😀")).toHaveLength(3);
  });

  it("les guillemets, les retours à la ligne et le & d'un nom passent intacts", () => {
    const url = urlNouvelleIssue({ ...e, titre: 'Revoir la tuile « A&B = "x" #1 » dans le hub' });
    if (url === null) throw new Error("adresse attendue");
    const u = new URL(url);
    expect(u.searchParams.get("title")).toContain('A&B = "x" #1');
    expect(u.searchParams.get("body")?.split("\n")).toHaveLength(5);
  });
});

describe("le câblage de l'écran", () => {
  const actions = readFileSync("app/idees/actions.ts", "utf8");
  const ecran = readFileSync("components/TableauEspace.tsx", "utf8");

  it("les deux gestes sont des Server Actions qui revérifient la session avant de lire le formulaire", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    for (const nom of ["retenirIdeeAction", "ecarterIdeeAction"]) {
      const bloc = actions.slice(actions.indexOf(`export async function ${nom}`));
      const avant = bloc.indexOf("await requireSession()");
      expect(avant, `${nom} ne revérifie pas la session`).toBeGreaterThan(-1);
      expect(avant, `${nom} lit le formulaire avant la session`).toBeLessThan(bloc.indexOf("appliquer("));
    }
    // Un seul chemin d'écriture : ni SQL à la main ni autre table que `appliquerGeste`.
    expect(actions).toContain("appliquerGeste(");
    expect(actions).not.toMatch(/\.(update|insert|delete)\(/);
  });

  it("l'écran branche chaque geste sur son formulaire, et le lien s'ouvre sans référent", () => {
    // Ancrés sur l'attribut JSX : le nom nu serait aussi satisfait par un import mort.
    expect(ecran.split("action={retenirIdeeAction}")).toHaveLength(2);
    expect(ecran.split("action={ecarterIdeeAction}")).toHaveLength(2);
    expect(ecran).toContain('rel="noreferrer noopener"');
  });
});

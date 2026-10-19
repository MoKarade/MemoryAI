// tests/perimetres.test.ts — les périmètres deviennent ÉCRITS (lot 11).
//
// ⚠️ POURQUOI CE LOT EXISTE. `depotFaits.perimetre()` consulte cette table avant CHAQUE
// écriture depuis le lot 3, et aucune page ne la remplissait : un champ lu par le moteur et
// qu'aucun producteur n'écrit. Le repli était sain (pas de ligne ⇒ le jeton décide seul),
// donc rien ne rougissait — et le périmètre restait inutilisable.
//
// Ce que ces cas défendent :
//   1. un périmètre RESTREINT, il n'élargit jamais — une app ne gagne rien à être réglée ;
//   2. un domaine hors vocabulaire est REFUSÉ, pas ignoré : l'ignorer laisserait Marc croire
//      qu'il a accordé quelque chose ;
//   3. aucune valeur de jeton ne sort de `appsConnues`, même tronquée ;
//   4. le niveau 3 ne s'accorde pas : il n'a aucun contenu, et l'offrir serait mentir.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { appsConnues, identifierEcrivain, LONGUEUR_MIN_JETON } from "../lib/jetons";
import { depotPerimetresDrizzle, lireReglage } from "../lib/depotPerimetres";
import { depotDrizzle } from "../lib/depotFaits";
import { ecrireLot, EcritureRetireeError } from "../lib/ecrireFaits";
import { BON } from "./fixtures/faits";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
const cle = deriverCle(randomBytes(32).toString("base64"));
const T0 = new Date("2026-09-15T22:50:00Z");
const JETON = "jeton-de-test-0123456789abcdef";

/** Un faux FormData, assez pour `lireReglage` — la fonction ne prend que ce qu'elle lit. */
function form(champs: Record<string, string | string[]>) {
  return {
    get: (n: string) => {
      const v = champs[n];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
    getAll: (n: string) => {
      const v = champs[n];
      return Array.isArray(v) ? v : v === undefined ? [] : [v];
    },
  };
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

afterAll(async () => {
  await pg?.close();
});

describe("appsConnues — les NOMS, jamais les valeurs", () => {
  it("déduit l'app et le rôle du nom de la variable", () => {
    const env = {
      MEMORYAI_TOKEN_DRIVEAI_ECRITURE: JETON,
      MEMORYAI_TOKEN_JOBAI_LECTURE: JETON,
      AUTRE_CHOSE: JETON,
    };
    expect(appsConnues(env)).toEqual([
      { appId: "driveai", role: "ecriture" },
      { appId: "jobai", role: "lecture" },
    ]);
  });

  it("ne rend AUCUNE valeur de jeton — la sérialisation entière ne la contient pas", () => {
    const secret = "un-secret-vraiment-long-0123456789";
    const rendu = JSON.stringify(appsConnues({ MEMORYAI_TOKEN_DRIVEAI_ECRITURE: secret }));
    expect(rendu).not.toContain(secret);
    // Pas même un préfixe : « juste les quatre premiers » est un jeton dont on publie quatre
    // caractères.
    expect(rendu).not.toContain(secret.slice(0, 4));
  });

  it("ignore une variable vide ou trop courte : elle n'ouvre aucune porte", () => {
    const court = "x".repeat(LONGUEUR_MIN_JETON - 1);
    expect(appsConnues({ MEMORYAI_TOKEN_DRIVEAI_ECRITURE: "", MEMORYAI_TOKEN_JOBAI_LECTURE: court })).toEqual([]);
  });

  it("l'ÉCRITURE l'emporte quand une app a les deux rôles : c'est le plus large qu'elle détient", () => {
    const env = { MEMORYAI_TOKEN_DRIVEAI_LECTURE: JETON, MEMORYAI_TOKEN_DRIVEAI_ECRITURE: JETON };
    expect(appsConnues(env)).toEqual([{ appId: "driveai", role: "ecriture" }]);
  });
});

describe("lireReglage — strict, et il le DIT", () => {
  it("accepte un réglage ordinaire, dédoublonne et trie les domaines", () => {
    const r = lireReglage(form({ domaine: ["vehicule", "emploi", "emploi"], niveauMax: "1", role: "lecture" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reglage.domaines).toEqual(["emploi", "vehicule"]);
  });

  it("REFUSE un domaine hors vocabulaire au lieu de l'ignorer", () => {
    const r = lireReglage(form({ domaine: ["emploi", "licorne"], niveauMax: "1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/licorne/);
  });

  it("refuse le niveau 3 : il n'a aucun contenu, l'accorder serait mentir", () => {
    const r = lireReglage(form({ niveauMax: "3" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/niveau 3/);
  });

  it("refuse un niveau hors bornes ou illisible", () => {
    for (const v of ["-1", "4", "deux", ""]) expect(lireReglage(form({ niveauMax: v })).ok, v).toBe(false);
  });

  it("le domicile n'est accordé que si le NIVEAU le permet aussi", () => {
    const bas = lireReglage(form({ niveauMax: "1", domicile: "on" }));
    expect(bas.ok && bas.reglage.domicile, "cocher la case sans monter le niveau n'ouvre rien").toBe(false);
    const haut = lireReglage(form({ niveauMax: "2", domicile: "on" }));
    expect(haut.ok && haut.reglage.domicile).toBe(true);
  });
});

describe("le périmètre RESTREINT, il n'élargit jamais", () => {
  it("sans ligne, le jeton décide seul : une écriture passe", async () => {
    const env = { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: JETON };
    const ecrivain = identifierEcrivain(JETON, env)!;
    const r = await ecrireLot([BON], ecrivain, cle, depotDrizzle(db));
    expect(r.acceptes).toBe(1);
  });

  it("une ligne en LECTURE coupe l'écriture, même avec un jeton d'écriture", async () => {
    const depot = depotPerimetresDrizzle(db);
    await depot.regler("driveai", { domaines: ["emploi"], niveauMax: 1, role: "lecture", admetInvites: false, domicile: false }, T0);
    const ecrivain = identifierEcrivain(JETON, { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: JETON })!;
    expect(ecrivain.role, "le jeton, lui, dit toujours écriture").toBe("ecriture");
    await expect(
      ecrireLot([{ ...BON, valeur: "Autre chose" }], ecrivain, cle, depotDrizzle(db)),
    ).rejects.toThrow(EcritureRetireeError);
  });

  it("retirer la ligne rend à l'app ce que son jeton permet — et rien de plus", async () => {
    const depot = depotPerimetresDrizzle(db);
    await depot.retirer("driveai");
    expect(await depot.parApp("driveai")).toBeNull();
    const ecrivain = identifierEcrivain(JETON, { MEMORYAI_TOKEN_DRIVEAI_ECRITURE: JETON })!;
    const r = await ecrireLot([{ ...BON, valeur: "Encore autre chose" }], ecrivain, cle, depotDrizzle(db));
    expect(r.acceptes).toBe(1);
  });

  it("régler deux fois la même app REMPLACE, jamais n'ajoute une seconde ligne", async () => {
    const depot = depotPerimetresDrizzle(db);
    await depot.regler("jobai", { domaines: ["emploi"], niveauMax: 0, role: "lecture", admetInvites: true, domicile: false }, T0);
    await depot.regler("jobai", { domaines: ["emploi", "vehicule"], niveauMax: 2, role: "lecture", admetInvites: false, domicile: true }, T0);
    const tous = (await depot.tous()).filter((p) => p.appId === "jobai");
    expect(tous).toHaveLength(1);
    expect(tous[0]!.niveauMax).toBe(2);
    expect(JSON.parse(tous[0]!.domaines)).toEqual(["emploi", "vehicule"]);
  });
});

describe("la page n'écrit rien elle-même", () => {
  it("le périmètre n'est écrit QUE depuis les actions de /apps — balayé, pas listé", () => {
    // Une app qui pourrait élargir son propre périmètre n'aurait pas de périmètre. La porte
    // d'écriture est donc UNE seule, et ce cas le vérifie.
    const src = readFileSync("app/apps/actions.ts", "utf8");
    expect(src).toMatch(/requireSession\(\)/);
    expect(src).toMatch(/depotPerimetresDrizzle/);

    // ⚠⚠ CETTE MOITIÉ ÉTAIT UNE LISTE DE DEUX FICHIERS ÉCRITE À LA MAIN (`lib/mcp/outils.ts`
    // et `app/api/faits/route.ts`). Elle était juste, et aveugle à tout fichier NEUF : quand
    // [L26b2] a fait LIRE les périmètres à `app/regler/page.tsx`, rien n'aurait empêché ce
    // même écran d'importer `reglerAction` et d'ouvrir une seconde porte d'écriture. Une
    // liste de deux exceptions ne protège que contre les deux qu'on avait sous les yeux —
    // même classe que les dix `revalidatePath` du même lot. On BALAYE, et on nomme l'unique
    // exemption.
    const PORTE = "app/apps/actions.ts";
    const balayes = execSync("git ls-files --cached --others --exclude-standard app lib", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => /\.tsx?$/.test(f));
    // Anti-vacuité : sans cette borne, un motif cassé rendrait « aucun écrivain » vrai d'un
    // scan mort, et la porte pourrait s'être multipliée sans rien de rouge.
    expect(balayes.length, "le scan ne voit aucun fichier").toBeGreaterThanOrEqual(30);
    expect(balayes, `la porte ${PORTE} n'est plus dans le scan`).toContain(PORTE);

    // Les MUTATEURS du dépôt de périmètres, et les Server Actions qui les enveloppent. ⚠️ Lire
    // (`\.tous\(`) n'est PAS écrire : `/regler` affiche l'état et doit le pouvoir.
    const ECRITURE = /\.regler\(|\.retirer\(|reglerAction|retirerAction/;
    for (const f of balayes) {
      if (f === PORTE || f === "app/apps/page.tsx") continue;
      expect(
        ECRITURE.test(readFileSync(f, "utf8")),
        `${f} peut écrire un périmètre : la porte d'écriture doit rester UNE`,
      ).toBe(false);
    }

    // ⚠⚠ ET LES DEUX SURFACES QUI N'ONT AUCUNE RAISON D'Y TOUCHER, même pour LIRE. Cette
    // moitié était la garde d'origine, et la généraliser l'avait AFFAIBLIE : le balayage
    // ci-dessus ne vise que les mutateurs, parce que `/regler` doit pouvoir LIRE l'état des
    // périmètres depuis [L26b2]. Mais un outil MCP et le contrat d'écriture, eux, n'ont
    // besoin ni de lire ni d'écrire : `ecrireLot` consulte le périmètre pour eux, à
    // l'intérieur. Une claim plus FORTE sur deux surfaces nommées ne se remplace pas par une
    // claim plus faible sur toutes — on garde les deux. (Trouvé par une perturbation MUETTE :
    // insérer `depotPerimetres` dans `outils.ts` ne rougissait plus.)
    for (const f of ["lib/mcp/outils.ts", "app/api/faits/route.ts"]) {
      expect(balayes, `${f} n'est plus dans le scan : cette exigence ne mesure rien`).toContain(f);
      expect(
        /depotPerimetres/.test(readFileSync(f, "utf8")),
        `${f} touche aux périmètres : ni lui ni le contrat d'écriture n'en ont besoin`,
      ).toBe(false);
    }
  });

  it("[L26b2] Régler LIT les périmètres et ne les écrit pas", () => {
    // Le fait du lot : l'INFORMATION monte dans le hub, l'ATELIER garde sa page. Mesuré avant
    // de le décider : le vocabulaire porte 23 domaines, donc le formulaire d'UNE app fait
    // ~29 contrôles — avec trois ou quatre apps, ~100 contrôles expédiés dans le HTML du hub
    // à chaque chargement, puisqu'un `<details>` masque à l'œil mais envoie son contenu.
    const regler = readFileSync("app/regler/page.tsx", "utf8");
    expect(regler, "Régler ne lit plus l'état des périmètres").toContain("depotPerimetresDrizzle(acces.db).tous()");
    expect(regler, "Régler ne lit plus les jetons posés").toContain("appsConnues()");
    // Et le FORMULAIRE n'y est pas : ni ses actions (couvert par le balayage ci-dessus), ni
    // ses 23 cases à cocher. L'ancre est l'attribut exact du champ, pas le mot « domaine » —
    // qui apparaît légitimement dans la prose de la page.
    expect(/name="domaine"/.test(regler), "le formulaire des domaines a été recopié dans le hub").toBe(false);
  });
});

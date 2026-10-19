// tests/corrigerFait.test.ts — [L33b] corriger un fait, sur une VRAIE base.
//
// Marc, le 18/09, a choisi « corriger le fait » comme premier geste manquant. Ce fichier
// garde ce que la correction AFFIRME, et surtout ce qu'elle ne détruit pas.
//
// Dans l'ordre d'importance :
//   1. l'ancienne valeur est GARDÉE, marquée `perime` — jamais effacée, jamais `rejete` ;
//   2. un prédicat `multi` ne se corrige pas tout seul : sans un geste explicite, la
//      « correction » AJOUTE une valeur au lieu de remplacer la mauvaise ;
//   3. un refus rend sa CAUSE, et ne touche PAS l'ancien fait ;
//   4. recliquer la même correction ne crée pas un second fait.
//
// ⚠️ Rien n'est simulé ici : PGlite, les vraies migrations, le vrai chemin d'écriture. La
// leçon de [L25c] est qu'une garde nourrie à la main teste le module et jamais son
// alimentation — et une correction est le geste le plus destructeur de cette app.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { corrigerFait } from "../lib/corrigerFait";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { depotDrizzle } from "../lib/depotFaits";
import { ecrireLot } from "../lib/ecrireFaits";
import { rendreLisible } from "../lib/lecture";
import { definition } from "../lib/vocabulaire";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(randomBytes(32).toString("base64"));
const DRIVEAI: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-officiel"] };
const T = new Date("2026-09-18T12:00:00Z");

/** Un prédicat NON `multi` : `valider` périme l'ancien tout seul. */
const SIMPLE = "emploi.employeur";
/** Un prédicat `multi` : une valeur de plus n'en remplace aucune. */
const MULTI = "emploi.ancien";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const deps = () => ({ admin: depotAdminDrizzle(db), faits: depotDrizzle(db), cle });

async function semer(predicat: string, valeur: string) {
  const r = await ecrireLot(
    [{ ...BON, predicat, valeur, provenance: { ...BON.provenance, source_ref: `drive|${predicat}` } }],
    DRIVEAI,
    cle,
    depotDrizzle(db),
  );
  const id = r.idsCrees[0];
  expect(id, `la fixture n'a rien écrit pour ${predicat} : ${JSON.stringify(r.refuses)}`).toBeTruthy();
  await depotAdminDrizzle(db).valider(id!, T);
  return id!;
}

async function statut(id: string) {
  const [l] = await db.select({ statut: schema.faits.statut }).from(schema.faits).where(eq(schema.faits.id, id));
  return l?.statut;
}

beforeEach(async () => {
  pg = new PGlite();
  for (const f of readdirSync(resolve(process.cwd(), "drizzle")).filter((x) => x.endsWith(".sql")).sort()) {
    for (const s of readFileSync(resolve(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) {
      if (s.trim()) await pg.exec(s);
    }
  }
  db = drizzle(pg, { schema });
});

afterEach(async () => {
  await pg?.close();
});

describe("la fixture mesure bien ce qu'elle croit — anti-vacuité", () => {
  it("les deux prédicats choisis ont bien des `multi` OPPOSÉS", () => {
    // Sans ce contrôle, les deux blocs plus bas pourraient tester deux fois le MÊME cas et
    // la branche `perimer` ne serait jamais exercée — verte par vacuité.
    expect(definition(SIMPLE)?.multi, `${SIMPLE} devrait être non-multi`).toBe(false);
    expect(definition(MULTI)?.multi, `${MULTI} devrait être multi`).toBe(true);
  });
});

describe("corriger un fait — ce qui est écrit, et ce qui est gardé", () => {
  it("écrit la nouvelle valeur, la valide, et GARDE l'ancienne en `perime`", async () => {
    const ancien = await semer(SIMPLE, "Entreprise Exemple");
    const r = await corrigerFait(ancien, "Ville Exemple", deps(), T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await statut(r.nouveauId)).toBe("valide");
    // ⚠️ L'assertion la plus importante du fichier : l'ancien est GARDÉ. `perime` et non
    // `rejete` — « remplacé par un plus récent », pas « faux ». Et surtout pas supprimé :
    // l'ancienne valeur était vraie à sa date.
    expect(await statut(ancien)).toBe("perime");
    const brut = await depotAdminDrizzle(db).parId(ancien);
    expect(brut, "l'ancien fait a été SUPPRIMÉ : une correction n'efface rien").toBeTruthy();
  });

  it("la nouvelle valeur est vraiment celle qu'on a tapée, et la provenance NOMME la correction", async () => {
    const ancien = await semer(SIMPLE, "Entreprise Exemple");
    const r = await corrigerFait(ancien, "  Ville Exemple  ", deps(), T);
    if (!r.ok) throw new Error("correction refusée");
    const lisible = rendreLisible((await depotAdminDrizzle(db).parId(r.nouveauId))!, cle);
    expect(lisible.valeur).toBe("Ville Exemple");
    // La chaîne est traçable : la source du nouveau fait DÉSIGNE celui qu'il corrige.
    expect(lisible.provenance?.sourceRef).toBe(`correction:${ancien}`);
    expect(lisible.provenance?.sourceType).toBe("marc");
    // ⚠️ La fiabilité est « marc », PAS celle du document corrigé (`document-officiel` dans
    // la fixture). Hériter de la fiabilité de l'ancien ferait entrer une fiabilité qu'aucune
    // source ne soutient.
    expect(lisible.fiabiliteSource).toBe("marc");
  });

  it("⚠️ un prédicat MULTI périme l'ancien EXPLICITEMENT (mutation : retirer l'appel à perimer)", async () => {
    // LA raison d'être de `perimer`. Sur un prédicat `multi`, `valider` ne périme RIEN — donc
    // sans ce geste les deux valeurs coexistent et la « correction » n'a rien corrigé : elle a
    // ajouté. Le défaut serait invisible sur un prédicat simple, c'est-à-dire sur la plupart.
    const ancien = await semer(MULTI, "Ancien employeur mal orthographié");
    const r = await corrigerFait(ancien, "Ancien employeur bien orthographié", deps(), T);
    if (!r.ok) throw new Error("correction refusée");
    expect(await statut(r.nouveauId)).toBe("valide");
    expect(await statut(ancien), "les deux valeurs coexistent : la correction a AJOUTÉ").toBe("perime");
  });

  it("recorriger avec la MÊME valeur ne crée pas un second fait", async () => {
    const ancien = await semer(SIMPLE, "Entreprise Exemple");
    const un = await corrigerFait(ancien, "Ville Exemple", deps(), T);
    if (!un.ok) throw new Error("première correction refusée");
    const deux = await corrigerFait(ancien, "Ville Exemple", deps(), T);
    // L'idempotence est par EMPREINTE (source + prédicat + valeur), donc rejouer la même
    // correction ne réécrit rien — et la cause est rendue, pas avalée.
    expect(deux.ok).toBe(false);
    if (deux.ok) return;
    expect(["deja-present", "doublon_valide"]).toContain(deux.code);
    const lignes = await db.select({ id: schema.faits.id }).from(schema.faits).where(eq(schema.faits.predicat, SIMPLE));
    expect(lignes.length, "un troisième fait a été créé pour la même correction").toBe(2);
  });
});

describe("les refus rendent leur CAUSE, et ne touchent pas l'ancien fait", () => {
  it("un champ vide", async () => {
    const ancien = await semer(SIMPLE, "Entreprise Exemple");
    const r = await corrigerFait(ancien, "   ", deps(), T);
    expect(r).toEqual({ ok: false, code: "vide" });
    expect(await statut(ancien), "l'ancien a été touché par un refus").toBe("valide");
  });

  it("un fait qui n'existe pas", async () => {
    const r = await corrigerFait("11111111-1111-1111-1111-111111111111", "peu importe", deps(), T);
    expect(r).toEqual({ ok: false, code: "introuvable" });
  });

  it("⚠️ un `ref_document` est REFUSÉ, pas abîmé", async () => {
    // La valeur d'un papier est un fileId Drive : le « corriger » au clavier voudrait dire
    // désigner un AUTRE document, ce qui n'est pas corriger un fait mais en créer un. Écraser
    // la référence casserait le lien Drive du papier — le seul lien fiable qu'il porte.
    const r0 = await ecrireLot(
      [
        {
          ...BON,
          predicat: "identite.document",
          valeur: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
          valeur_type: "ref_document",
          attributs: { type: "Passeport" },
          provenance: { ...BON.provenance, source_ref: "drive|passeport" },
        },
      ],
      DRIVEAI,
      cle,
      depotDrizzle(db),
    );
    const papier = r0.idsCrees[0];
    expect(papier, `la fixture du papier n'a rien écrit : ${JSON.stringify(r0.refuses)}`).toBeTruthy();
    const r = await corrigerFait(papier!, "Passeport", deps(), T);
    expect(r).toEqual({ ok: false, code: "type-non-corrigeable" });
    const lisible = rendreLisible((await depotAdminDrizzle(db).parId(papier!))!, cle);
    expect(lisible.valeur, "la référence Drive du papier a été écrasée").toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz");
  });

  it("une valeur que le CONTRAT refuse remonte son code, et laisse l'ancien intact", async () => {
    // Le contrat d'écriture juge la valeur (`CODES_REFUS`). Ce qui compte ici n'est pas
    // QUEL code — il appartient au contrat, pas à ce lot — mais qu'il remonte au lieu d'être
    // aplati en « ça n'a pas marché », et que l'ancien fait ne bouge pas.
    const ancien = await semer(SIMPLE, "Entreprise Exemple");
    const r = await corrigerFait(ancien, "x".repeat(5000), deps(), T);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code, "un refus sans cause : l'écran ne peut plus rien dire à Marc").not.toBe("refuse");
    expect(await statut(ancien)).toBe("valide");
  });
});

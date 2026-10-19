// tests/doublonValide.test.ts — un fait déjà validé ne se re-propose pas, et ce qu'on a
// remplacé se retrouve.
//
// ⚠️ Ce fichier a une DATE et un coût. Le 17/09 à 09:00 UTC, la première passe réelle du cron
// a proposé six faits, et les six étaient des doublons de faits déjà `valide` : les deux
// baux, le kilométrage, un fournisseur — **deux au caractère près**. Marc les a validés à
// 12:27 UTC. Comme cinq de ces prédicats sont `multi: false`, valider a fait passer `perime`
// cinq faits corrects, et remplacé une valeur LUE sur un document (`document-tiers`) par la
// déduction d'un modèle (`app`). L'arithmétique le ferme : 2 827 + 6 − 5 = 2 828 validés,
// 5 périmés — exactement ce que le MCP rendait.
//
// Deux trous, pas un :
//   1. rien n'empêchait un doublon d'entrer dans la file (l'idempotence est par SOURCE, et la
//      source était bien différente) ;
//   2. rien ne montrait ce qui avait été PÉRIMÉ, donc le retour en arrière était introuvable
//      — alors que le mutateur existait déjà (`valider` accepte un fait périmé).
//
// Les deux sont testés ici. Les mutations qui doivent rougir sont nommées dans les titres.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import { deriverCle } from "../lib/chiffrement";
import { depotDrizzle } from "../lib/depotFaits";
import { depotAdminDrizzle } from "../lib/depotAdmin";
import { ecrireLot } from "../lib/ecrireFaits";
import { BON } from "./fixtures/faits";
import type { Ecrivain } from "../lib/jetons";

const cle = deriverCle(Buffer.alloc(32, 3).toString("base64"));
// Deux écrivains, deux fiabilités : c'est la situation réelle du 17/09 — le document d'abord,
// la déduction du modèle ensuite.
const DOCUMENT: Ecrivain = { appId: "driveai", role: "ecriture", fiabilites: ["document-tiers"] };
const MODELE: Ecrivain = { appId: "memoryai", role: "ecriture", fiabilites: ["app"] };
const MAINTENANT = new Date("2026-09-17T12:27:00Z");

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

/** Le bail de logement, tel qu'il a été lu puis re-déduit. */
const bail = (valeur: string, sourceRef: string, extracteur: string) => ({
  ...BON,
  predicat: "logement.bail.fin",
  valeur,
  valeur_type: "date" as const,
  provenance: { ...BON.provenance, source_ref: sourceRef, extracteur },
});

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

/** Écrit le fait lu sur le document, et le valide — l'état d'avant la passe du cron. */
async function faitValideDepuisLeDocument(valeur = "2028-06-30") {
  await ecrireLot([bail(valeur, "drive|bail-2026", "moteur-document-v1")], DOCUMENT, cle, depotDrizzle(db));
  const [f] = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "logement.bail.fin"));
  await depotAdminDrizzle(db).valider(f!.id, MAINTENANT);
  return f!.id;
}

describe("un fait déjà validé ne se re-propose pas", () => {
  it("MUTATION — retirer la garde `doublon_valide` de ecrireLot fait rougir ce cas", async () => {
    await faitValideDepuisLeDocument("2028-06-30");

    // La passe du cron : même valeur, AUTRE source, AUTRE extracteur. L'empreinte diffère
    // donc, et c'est correct — la question n'est pas « est-ce le même enregistrement ? » mais
    // « y a-t-il quelque chose à décider ? ».
    const r = await ecrireLot([bail("2028-06-30", "conversation|42", "conversation-v1")], MODELE, cle, depotDrizzle(db));

    expect(r.acceptes).toBe(0);
    expect(r.dejaPresents).toBe(0);
    expect(r.refuses).toHaveLength(1);
    expect(r.refuses[0]?.code).toBe("doublon_valide");
    // Et rien n'est entré en base : la file reste vide, donc Marc n'a rien à cliquer.
    const tous = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "logement.bail.fin"));
    expect(tous).toHaveLength(1);
    expect(tous[0]?.statut).toBe("valide");
  });

  it("une valeur DIFFÉRENTE entre normalement — il y a quelque chose à décider", async () => {
    await faitValideDepuisLeDocument("2028-06-30");
    const r = await ecrireLot([bail("2027-12-31", "conversation|42", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    // LE contrôle négatif de la garde. Sans lui, « refuser tout ce qui ressemble » passerait
    // aussi — et la mémoire cesserait d'apprendre qu'une date a changé.
    expect(r.acceptes).toBe(1);
    expect(r.refuses).toHaveLength(0);
  });

  it("la casse et les espaces ne sont PAS normalisés — la garde n'attrape que ce qu'elle a mesuré", async () => {
    await ecrireLot(
      [{ ...BON, predicat: "contrat.fournisseur", valeur: "Marque Services Financiers", provenance: { ...BON.provenance, source_ref: "drive|bail", extracteur: "moteur-document-v1" } }],
      DOCUMENT,
      cle,
      depotDrizzle(db),
    );
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "contrat.fournisseur"));
    await depotAdminDrizzle(db).valider(f!.id, MAINTENANT);

    const r = await ecrireLot(
      [{ ...BON, predicat: "contrat.fournisseur", valeur: "marque services financiers", provenance: { ...BON.provenance, source_ref: "conv|1", extracteur: "conversation-v1" } }],
      MODELE,
      cle,
      depotDrizzle(db),
    );
    // Une différence de casse peut être une CORRECTION que Marc veut voir. Élargir la garde
    // ici lui refuserait des faits légitimes en silence.
    expect(r.acceptes).toBe(1);
  });

  it("MUTATION — retirer le filtre `aUneSeuleValeur` fait rougir ce cas", async () => {
    // `document.existe` est `multi: true`, et c'est le canal PRINCIPAL (~4 240 faits poussés
    // en continu par DriveAI). Un document re-annoncé sous une autre `source_ref` — un
    // reclassement, une clé d'Index qui change — doit rester `dejaPresents` ou passer, JAMAIS
    // devenir un refus : la garde n'a rien à prévenir ici, puisque valider un fait d'un
    // prédicat multiple ne périme personne.
    const doc = (sourceRef: string, extracteur: string) => ({
      ...BON,
      predicat: "document.existe",
      valeur: "1AbCdEfGhIjKlMnOpQrStUvWxYz01",
      valeur_type: "ref_document" as const,
      provenance: { source_type: "document", source_ref: sourceRef, extracteur },
    });
    // Le premier est MÉCANIQUE : il entre déjà `valide` (ADR 0003), sans passer par Marc.
    const r1 = await ecrireLot([doc("drive|f1", "moteur-inventaire-v1")], DOCUMENT, cle, depotDrizzle(db));
    expect(r1.acceptes).toBe(1);
    const [f] = await db.select().from(schema.faits).where(eq(schema.faits.predicat, "document.existe"));
    expect(f!.statut).toBe("valide");

    const r2 = await ecrireLot([doc("migre|f1", "moteur-inventaire-v1")], DOCUMENT, cle, depotDrizzle(db));
    expect(r2.refuses).toHaveLength(0);
    expect(r2.acceptes).toBe(1);
  });

  it("un fait PÉRIMÉ ne bloque pas : sa valeur peut revenir", async () => {
    const idDoc = await faitValideDepuisLeDocument("2028-06-30");
    // Le modèle propose autre chose, Marc valide : le fait du document passe `perime`.
    const r1 = await ecrireLot([bail("2027-12-31", "conversation|42", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    await depotAdminDrizzle(db).valider(r1.idsCrees[0]!, MAINTENANT);
    const [avant] = await db.select().from(schema.faits).where(eq(schema.faits.id, idDoc));
    expect(avant?.statut).toBe("perime");

    // Une source qui re-propose la valeur PÉRIMÉE apporte une information : Marc l'avait
    // remplacée parce qu'une autre semblait plus récente, pas parce qu'elle était fausse.
    const r2 = await ecrireLot([bail("2028-06-30", "drive|bail-2027", "moteur-document-v2")], DOCUMENT, cle, depotDrizzle(db));
    expect(r2.acceptes).toBe(1);
  });
});

describe("ce qu'on a remplacé se retrouve, et revient", () => {
  it("MUTATION — retirer `perimes()` du dépôt fait rougir ce cas", async () => {
    const idDoc = await faitValideDepuisLeDocument("2028-06-30");
    const admin = depotAdminDrizzle(db);
    const r1 = await ecrireLot([bail("2027-12-31", "conversation|42", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    const idModele = r1.idsCrees[0]!;
    await admin.valider(idModele, MAINTENANT);

    // Sans cette liste, le fait remplacé existe en base et n'est visible NULLE PART : c'est
    // exactement l'état du 17/09.
    const perimes = await admin.perimes(50);
    expect(perimes.map((p) => p.fait.id)).toEqual([idDoc]);
    // Sa provenance vient avec — sans elle, l'écran ne peut pas dire d'où venait la valeur
    // qu'on s'apprête à rétablir, donc le choix n'est pas informé.
    expect(perimes[0]?.provenance?.extracteur).toBe("moteur-document-v1");
  });

  it("« Remettre en service » rétablit le fait ET périme celui qui l'avait remplacé", async () => {
    const idDoc = await faitValideDepuisLeDocument("2028-06-30");
    const admin = depotAdminDrizzle(db);
    const r1 = await ecrireLot([bail("2027-12-31", "conversation|42", "conversation-v1")], MODELE, cle, depotDrizzle(db));
    const idModele = r1.idsCrees[0]!;
    await admin.valider(idModele, MAINTENANT);

    // Le mutateur de réparation est `valider` lui-même : il accepte un fait périmé. C'est ce
    // qui rend le retour en arrière EXACT, et c'est pour ça qu'aucun mutateur neuf n'a été
    // ajouté (il aurait fallu réécrire la règle du prédicat non-multi une seconde fois).
    expect(await admin.valider(idDoc, MAINTENANT)).toBe("ok");

    const [doc] = await db.select().from(schema.faits).where(eq(schema.faits.id, idDoc));
    const [modele] = await db.select().from(schema.faits).where(eq(schema.faits.id, idModele));
    expect(doc?.statut).toBe("valide");
    expect(modele?.statut).toBe("perime");
    // Et l'aller-retour est SYMÉTRIQUE : un seul fait validé à la fin, jamais deux.
    const valides = (await db.select().from(schema.faits).where(eq(schema.faits.predicat, "logement.bail.fin"))).filter(
      (f) => f.statut === "valide",
    );
    expect(valides).toHaveLength(1);
  });

  it("rien de périmé ⇒ la liste est vide, jamais une erreur — le contrôle négatif", async () => {
    await faitValideDepuisLeDocument("2028-06-30");
    expect(await depotAdminDrizzle(db).perimes(50)).toEqual([]);
  });
});

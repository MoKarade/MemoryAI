// lib/ecrireFaits.ts — écrire un LOT de faits : valider, oublier, dédoublonner, chiffrer.
//
// C'est l'orchestration de `POST /api/faits` (ADR 0001 §5.1), sans HTTP : la route ne fait
// que traduire. Ordre, pour CHAQUE fait du lot :
//   1. `validerFait` (pure) — un refus est nommé, un prédicat inconnu bien formé est COMPTÉ ;
//   2. l'empreinte d'oubli `HMAC(source_ref|predicat|sujet)` — un fait oublié ne revient
//      jamais, sur aucun chemin (celui-ci est le seul chemin d'écriture) ;
//   3. l'empreinte d'idempotence `HMAC(sujet|predicat|source_ref|extracteur|valeur)` —
//      déjà présente ⇒ `dejaPresents`, rien n'est réécrit ;
//   4. chiffrement de la valeur et des attributs dès N1 (AAD = `id|niveau`), puis insertion
//      avec la provenance ; le statut est `propose` — sauf pour un fait MÉCANIQUE, qu'aucun
//      modèle n'a touché (`lib/autoValidation.ts`, ADR 0003).
//
// Le lot est plafonné (`LOT_MAX`). Un lot au-dessus est refusé EN ENTIER, avant toute
// écriture : un écrivain qui découpe mal ne doit pas écrire la moitié de son lot.
//
// Le périmètre déclaré par Marc (`perimetres`) ne peut que RESTREINDRE : une ligne au rôle
// `lecture` retire l'écriture à une app sans toucher une variable Vercel. Pas de ligne ⇒ le
// jeton décide seul.

import { randomUUID } from "node:crypto";
import { chiffrer, dechiffrer, empreinte, type Cle } from "./chiffrement";
import type { DepotFaits } from "./depotFaits";
import type { Ecrivain } from "./jetons";
import { statutInitial } from "./autoValidation";
import { validerFait, type CodeRefus, type FaitValide } from "./validerFait";
import { definition } from "./vocabulaire";

export const LOT_MAX = 50;

export interface RefusDansLot {
  index: number;
  code: CodeRefus;
  raison: string;
}

export interface ResultatLot {
  recus: number;
  acceptes: number;
  dejaPresents: number;
  refuses: RefusDansLot[];
  /**
   * Les identifiants des faits RÉELLEMENT créés, dans l'ordre. Un appelant qui doit ensuite
   * agir sur ce qu'il vient d'écrire (la page de questions lie la réponse de Marc au fait
   * qu'elle a produit, puis la valide) n'a pas d'autre moyen de le retrouver : l'empreinte
   * est un HMAC keyé, elle ne se recalcule pas côté page.
   */
  idsCrees: string[];
  /**
   * Les prédicats NEUFS que ce lot a mis (ou laissés) en quarantaine : acceptés, stockés,
   * cherchables — et pas servis à un modèle tant que Marc ne les accepte pas ou que trois
   * extracteurs distincts ne les ont pas proposés (ADR 0004 §2.3).
   *
   * ⚠️ RENDUS à l'écrivain, comme `oubliees` l'est pour les pièces. Sans ça, DriveAI voit
   * « accepté » et croit le fait servi, alors qu'aucun Claude ne le verra : « accepté » et
   * « accepté ET utilisable » ne sont pas la même chose, et les confondre ferait chercher le
   * défaut du mauvais côté du canal.
   */
  enQuarantaine: string[];
  /** Ceux que CE lot a fait sortir de quarantaine, par la règle des trois sources. */
  sortisDeQuarantaine: string[];
}

export class LotTropGrandError extends Error {
  constructor(n: number) {
    super(`lot de ${n} faits : le maximum est ${LOT_MAX}`);
    this.name = "LotTropGrandError";
  }
}

export class EcritureRetireeError extends Error {
  constructor(appId: string) {
    super(`le périmètre de « ${appId} » ne permet plus l'écriture`);
    this.name = "EcritureRetireeError";
  }
}

export function empreinteOubli(cle: Cle, sourceRef: string, predicat: string, sujet: string): string {
  return empreinte(cle, "oubli", sourceRef, predicat, sujet);
}

/**
 * Ce prédicat ne tient qu'UNE valeur à la fois (`multi: false`) — c'est la condition sans
 * laquelle la garde ci-dessous n'a aucun dommage à prévenir.
 *
 * ⚠️ Ce filtre n'était PAS dans mon premier jet, et c'est une mutation qui l'a exigé : sans
 * lui, la garde refusait aussi les `document.existe`, qui est `multi: true` et qui est le
 * canal PRINCIPAL (~4 240 faits poussés en continu par DriveAI). Un document re-annoncé sous
 * une autre `source_ref` — un reclassement, une clé d'Index qui change — passait de
 * `dejaPresents` à un refus, ce qui aurait fait chercher une panne du côté de DriveAI.
 *
 * ⚠️ Et le raisonnement qui décide, plutôt que le symptôme : le dommage du 17/09 vient de la
 * PÉREMPTION (`valider` fait passer `perime` les autres faits validés du même prédicat), et
 * la péremption n'existe que pour un prédicat non-`multi`. Sur un prédicat multiple, valider
 * un doublon ne coûte qu'une ligne de plus dans une liste — visible, réversible, sans perte.
 * Une garde se borne à ce qu'elle a mesuré.
 *
 * ⚠️ Un prédicat HORS vocabulaire (quarantaine, ADR 0004 §2.3) n'a pas de définition : il est
 * traité comme MULTIPLE, donc la garde ne s'y applique pas. C'est le côté sûr — refuser une
 * écriture sur la foi d'une définition absente serait décider à partir de rien.
 */
function aUneSeuleValeur(fait: FaitValide): boolean {
  const def = definition(fait.predicat, fait.versionVocabulaire);
  return def ? !def.multi : false;
}

/**
 * Les valeurs DÉJÀ VALIDÉES, par prédicat, pour les faits de ce lot.
 *
 * ⚠️ Pourquoi cette garde existe, avec sa date. Le 17/09 à 09:00 UTC, la première passe
 * réelle du cron a proposé six faits — et les six étaient des doublons de faits déjà
 * `valide` (les deux baux, leur kilométrage, un fournisseur), **deux au caractère près**.
 * Marc les a validés à 12:27 UTC, ce qui a fait passer `perime` cinq faits corrects et
 * remplacé une valeur lue sur un document (`document-tiers`) par la déduction d'un modèle
 * (`app`), moins fiable. L'arithmétique le ferme : 2 827 + 6 − 5 = 2 828 validés, 5 périmés.
 *
 * ⚠️ Ce n'est PAS l'idempotence. `empreinteFait` est un HMAC de
 * `sujet|predicat|source_ref|extracteur|valeur` : la source et l'extracteur diffèrent ici, donc
 * l'empreinte diffère, et elle a laissé passer — correctement. Ce qui manquait est une
 * question distincte : « y a-t-il quelque chose à DÉCIDER ? ». La file `/a-valider` existe
 * pour décider ; une valeur identique à une valeur déjà validée ne pose aucune question.
 *
 * ⚠️ Égalité STRICTE, jamais normalisée (casse, accents, espaces). Le cas mesuré était
 * caractère pour caractère, et normaliser élargirait la garde à des cas où la nuance est
 * l'information : « Marque Services Financiers » contre « marque services financiers » peut
 * être une correction que Marc veut voir. Une garde qui attrape plus que ce qu'elle a mesuré
 * refuse des faits légitimes en silence.
 *
 * ⚠️ Seul le statut `valide` bloque. Un fait `perime` ne bloque PAS : Marc l'a remplacé parce
 * qu'un autre était plus récent, pas parce que la valeur était fausse — une source qui la
 * re-propose apporte une information. Et un fait migré en pièce ne bloque pas non plus : un
 * papier ne dit rien sur Marc.
 *
 * ⚠️ Une valeur ILLISIBLE est IGNORÉE, jamais traitée comme un doublon : un déchiffrement qui
 * échoue ne doit pas se mettre à refuser des écritures. Le côté sûr, ici, est de laisser
 * entrer — un doublon de trop se voit dans la file, une écriture refusée à tort est perdue.
 */
async function valeursDejaValidees(
  valides: readonly { fait: FaitValide }[],
  cle: Cle,
  depot: DepotFaits,
): Promise<Map<string, Set<string>>> {
  const parSujet = new Map<string, Set<string>>();
  for (const { fait } of valides) {
    if (!aUneSeuleValeur(fait)) continue;
    const p = parSujet.get(fait.sujet) ?? new Set<string>();
    p.add(fait.predicat);
    parSujet.set(fait.sujet, p);
  }
  const parPredicat = new Map<string, Set<string>>();
  for (const [sujet, predicats] of parSujet) {
    for (const r of await depot.valeursValidees(sujet, [...predicats])) {
      if (r.valeur === null) continue;
      let claire: string;
      try {
        claire = r.niveau >= 1 ? dechiffrer(cle, r.valeur, r.id, r.niveau) : r.valeur;
      } catch {
        continue;
      }
      const s = parPredicat.get(r.predicat) ?? new Set<string>();
      s.add(claire);
      parPredicat.set(r.predicat, s);
    }
  }
  return parPredicat;
}

export function empreinteFait(
  cle: Cle,
  parts: { sujet: string; predicat: string; sourceRef: string; extracteur: string; valeur: string },
): string {
  return empreinte(cle, "fait", parts.sujet, parts.predicat, parts.sourceRef, parts.extracteur, parts.valeur);
}

/**
 * Écrit un lot pour un écrivain identifié. `entrees` est le tableau brut reçu ; chaque
 * élément est validé séparément. Lève avant toute écriture si le lot dépasse `LOT_MAX`, si
 * l'écrivain n'a pas le rôle `ecriture`, ou si Marc le lui a retiré.
 */
export async function ecrireLot(
  entrees: readonly unknown[],
  ecrivain: Ecrivain,
  cle: Cle,
  depot: DepotFaits,
  maintenant: Date = new Date(),
): Promise<ResultatLot> {
  if (entrees.length > LOT_MAX) throw new LotTropGrandError(entrees.length);
  if (ecrivain.role !== "ecriture") throw new EcritureRetireeError(ecrivain.appId);
  const perimetre = await depot.perimetre(ecrivain.appId);
  if (perimetre && perimetre.role !== "ecriture") throw new EcritureRetireeError(ecrivain.appId);

  const resultat: ResultatLot = {
    recus: entrees.length, acceptes: 0, dejaPresents: 0, refuses: [], idsCrees: [],
    enQuarantaine: [], sortisDeQuarantaine: [],
  };
  const valides: { index: number; fait: FaitValide }[] = [];

  for (const [index, entree] of entrees.entries()) {
    const v = validerFait(entree, { fiabilites: ecrivain.fiabilites });
    if (!v.ok) {
      resultat.refuses.push({ index, code: v.code, raison: v.raison });
      // ⚠️ CE COMPTEUR A CHANGÉ D'OBJET (ADR 0004 §2.3). Il comptait les prédicats INCONNUS —
      // ils ne sont plus refusés, ils entrent en quarantaine, donc cette branche serait morte
      // si on l'y laissait. Ce qui reste utile à compter est ce qui n'entrera JAMAIS : un
      // écrivain qui pousse obstinément un numéro d'identité dans un fait est un signal, et
      // le taire laisserait le refus structurel invisible.
      if (v.predicat && v.code === "predicat_interdit") {
        await depot.compterRefus(v.predicat, ecrivain.appId, 1);
      }
      continue;
    }
    valides.push({ index, fait: v });
  }

  // Oublis d'abord, sur tout le lot : un fait oublié ne revient pas.
  const empOublis = valides.map(({ fait }) =>
    empreinteOubli(cle, fait.provenance.sourceRef, fait.predicat, fait.sujet),
  );
  const oublies = await depot.oubliesParmi(empOublis);
  const empFaits = valides.map(({ fait }) =>
    empreinteFait(cle, {
      sujet: fait.sujet,
      predicat: fait.predicat,
      sourceRef: fait.provenance.sourceRef,
      extracteur: fait.provenance.extracteur,
      valeur: fait.valeur,
    }),
  );
  const presentes = await depot.presentesParmi(empFaits);
  const vuesDansCeLot = new Set<string>();
  const dejaValidees = await valeursDejaValidees(valides, cle, depot);

  for (const [i, { index, fait }] of valides.entries()) {
    const eo = empOublis[i]!;
    const ef = empFaits[i]!;
    if (oublies.has(eo)) {
      resultat.refuses.push({ index, code: "oublie", raison: "ce fait a été oublié par Marc : il ne revient pas" });
      continue;
    }
    if (presentes.has(ef) || vuesDansCeLot.has(ef)) {
      resultat.dejaPresents++;
      continue;
    }
    // Un fait `valide` porte DÉJÀ cette valeur exacte, pour un prédicat qui n'en tient qu'une :
    // il n'y a rien à décider, donc rien à mettre dans la file (voir `valeursDejaValidees`).
    if (aUneSeuleValeur(fait) && dejaValidees.get(fait.predicat)?.has(fait.valeur)) {
      resultat.refuses.push({
        index,
        code: "doublon_valide",
        raison: `un fait validé porte déjà cette valeur pour « ${fait.predicat} » : rien à valider`,
      });
      continue;
    }
    vuesDansCeLot.add(ef);

    const id = randomUUID();
    const statut = statutInitial(fait);
    // Dès N1, valeur et attributs sont scellés au fait ET à son niveau (AAD `id|niveau`).
    const sceller = (v: string, suffixe = "") => (fait.niveau >= 1 ? chiffrer(cle, v, id + suffixe, fait.niveau) : v);
    await depot.inserer(
      {
        id,
        sujet: fait.sujet,
        predicat: fait.predicat,
        valeur: sceller(fait.valeur),
        valeurType: fait.valeurType,
        valideDe: fait.valideDe,
        valideA: fait.valideA,
        domaine: fait.domaine,
        niveau: fait.niveau,
        // ADR 0003 : `propose`, SAUF un fait mécanique (extracteur + prédicat en liste
        // fermée, jamais un canari) — celui-là n'a jamais vu de modèle, il n'y a rien à
        // relire. Même règle que le rattrapage de `drizzle/0007_…`, pour qu'ils ne divergent pas.
        statut,
        // `valide_le` dit QUAND le fait est devenu valide, pas « quand Marc l'a touché » :
        // le laisser nul ferait retomber le `dataAsOf` du hub à NULL (tri `DESC` = NULLS FIRST).
        valideLe: statut === "valide" ? maintenant : null,
        confiance: fait.confiance,
        fiabiliteSource: fait.fiabiliteSource,
        canari: fait.canari,
        versionVocabulaire: fait.versionVocabulaire,
        attributs: fait.attributs ? sceller(JSON.stringify(fait.attributs), "#attributs") : null,
        empreinte: ef,
      },
      fait.provenance,
    );
    resultat.acceptes++;
    resultat.idsCrees.push(id);

    // ⚠️ APRÈS l'insertion, jamais avant : même ordre que partout ailleurs ici — l'état « ce
    // prédicat a été proposé » ne doit exister que si le fait qui le propose existe. Une
    // coupure entre les deux rejoue au lieu de fabriquer une proposition sans fait.
    // Et jamais bloquant : un échec ici ne doit pas défaire un fait déjà écrit.
    if (fait.predicatHorsVocabulaire) {
      try {
        // ADR 0015 §2.2 : la source qui compte est l'app du JETON ; le nom déclaré n'est gardé que pour l'écran.
        const etat = await depot.proposerPredicat(
          fait.predicat,
          { extracteur: fait.provenance.extracteur, app: ecrivain.appId },
          maintenant,
        );
        if (etat.vientDeSortir) resultat.sortisDeQuarantaine.push(fait.predicat);
        else if (etat.statut !== "accepte") resultat.enQuarantaine.push(fait.predicat);
      } catch {
        // Le fait est écrit ; la proposition se re-tentera au prochain fait qui l'emploie.
        // ⚠️ Le côté sûr est bien celui-ci : sans ligne dans `predicats_proposes`, le
        // prédicat n'est PAS `accepte`, donc il n'est pas servi à un modèle.
        resultat.enQuarantaine.push(fait.predicat);
      }
    }
  }

  return resultat;
}

// lib/pieces/fileDeLecture.ts — [L35] « qu'est-ce que je lis ensuite ? » (ADR 0007).
//
// Marc, 18/09 : « je veux que ce soit lia qui lise tous mes fichiers ». DriveAI a les fichiers
// et l'extracteur ; ce qui lui manquait pour tourner à l'échelle est de SAVOIR QUOI LIRE sans
// tenir lui-même la liste de ce qui est fait — sa boucle de rattrapage gardait 200 `fileId`
// dans une Script Property et REFUSAIT une tranche plus grande, par conception.
//
// ⚠️⚠️ L'IDEMPOTENCE VIT ICI, ET ELLE NE COÛTE AUCUN ÉTAT NEUF POUR LE CAS NOMINAL. Depuis
// [L39], une vraie lecture REMPLACE la pièce d'inventaire : la file est donc simplement « les
// pièces actives dont l'extracteur est encore celui de la migration ». Un papier lu en sort
// TOUT SEUL, sans que personne ne le marque. Perdre un curseur, relancer une passe, changer de
// machine : rien de tout ça ne peut faire relire un document.
//
// ⚠️ LE CAS QUI EXIGE UN ÉTAT, ET C'EST LE SEUL : un document qui ne DONNE RIEN (photo sans
// texte, fichier disparu, extraction vide, pièce refusée). Il ne remplace rien, donc il
// resterait EN TÊTE de file pour toujours — et la boucle paierait son OCR, parfois son appel
// de modèle, à chaque passe, sans jamais avancer. C'est la panne que DriveAI a déjà nommée
// (« la marque se pose sur toute issue DÉFINITIVE »). D'où `lectures_tentees` : un verdict
// par (fichier, extracteur), posé par l'écrivain, qui sort le document de SA file.
//
// ⚠️ LA CLÉ PORTE L'EXTRACTEUR, et c'est le patron « le tag est DANS la valeur » : un
// extracteur neuf (`haiku-4.5-piece-v2`, un OCR réparé) ré-ouvre tout ce que l'ancien n'avait
// pas su lire, sans rien effacer. Un verdict dit « CE lecteur n'en a rien tiré », jamais « ce
// papier est illisible ».
//
// ⚠️ CE QUI SORT, ET À QUI : des `fileId`, rendus à l'app qui les a elle-même fournis. Aucun
// type, aucun émetteur, aucun résumé ne quitte la Mémoire par cette route — l'ORDRE est
// calculé ici, et seul son résultat voyage.

import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import type { Cle } from "../chiffrement";
import { cleFacette } from "./facettes";
import { EXTRACTEUR_MIGRATION } from "./migration";

/** Ce qu'une passe peut demander d'un coup. Aligné sur `LOT_PIECES_MAX` : même unité de travail. */
export const FILE_MAX = 50;
/** Sans `limite` explicite. Une passe DriveAI lit cinq documents par tick. */
export const FILE_DEFAUT = 10;

/**
 * L'ordre de lecture, choisi par Marc le 18/09 : « par valeur d'émetteur d'abord ».
 *
 * ⚠️ DES NOMS, comparés par leur clé KEYÉE (`cleFacette` normalise casse, accents et
 * ponctuation : « Revenu-Québec » et « revenu quebec » sont la même clé). La file ne
 * déchiffre donc RIEN pour s'ordonner.
 *
 * ⚠️ LA LISTE N'EST PAS DANS LE DÉPÔT (décision du 15/10 : aucune donnée personnelle en
 * ligne). Les émetteurs qu'un propriétaire veut lire en premier disent avec qui il a affaire ;
 * elle vit donc dans la variable `MEMORYAI_EMETTEURS_PRIORITAIRES`, noms séparés par `|`, dans
 * l'ordre voulu. Variable absente ou vide : seul « Revenu Québec » (un organisme public) passe
 * devant. Ce n'est pas une panne — l'ordre de lecture seul change, aucun papier n'est écarté.
 *
 * ⚠️ LA LIMITE CONNUE, dite plutôt que découverte : une graphie DIFFÉRENTE (« Caisse
 * Aurore » pour « Banque Aurore ») n'est pas en tête de file — elle tombe au milieu, et elle est lue
 * quand même. Un ordre de lecture imparfait coûte de l'attente ; un regroupement flou (« tout
 * ce qui contient Québec ») ferait passer n'importe quoi devant. Même arbitrage que
 * `familles.ts`.
 */
const EMETTEURS_PRIORITAIRES_DEFAUT = ["Revenu Québec"] as const;

export function emetteursPrioritaires(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const noms = (env.MEMORYAI_EMETTEURS_PRIORITAIRES ?? "")
    .split("|")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return noms.length > 0 ? noms : EMETTEURS_PRIORITAIRES_DEFAUT;
}

/**
 * Lus EN DERNIER — décision de Marc du 18/09 sur l'export Facebook : « Fichier HTML »,
 * « Fichier de configuration », tous du même jour ; c'est l'échafaudage d'un dump, pas sa vie.
 *
 * ⚠️ Les quatre graphies sont celles MESURÉES dans son corpus (`lib/pieces/familles.ts` :
 * 151 + 9 + 7 + 6), pas une liste imaginée. « Meta-Facebook » y figure justement parce que la
 * règle des familles (premier mot) ne le rattrape pas.
 */
export const EMETTEURS_EN_DERNIER = [
  "Facebook",
  "Facebook - Meta",
  "Meta-Facebook",
  "Facebook Marketplace",
] as const;

/**
 * Les verdicts qu'un écrivain peut poser. LISTE FERMÉE, et elle énumère des issues PROPRES AU
 * DOCUMENT — jamais une panne de canal.
 *
 * ⚠️ C'est la même frontière que `VERDICTS_DOCUMENT_RATTRAPAGE_` côté DriveAI, vue de l'autre
 * bout : « si cette cause est vraie, combien de documents échouent ? ». Un seul ⇒ verdict.
 * Tous (jeton refusé, réseau, budget) ⇒ PANNE, et une panne ne se marque pas : elle sortirait
 * de la file des papiers parfaitement lisibles, en silence, jusqu'au prochain extracteur.
 */
export const MOTIFS_VERDICT = [
  "sans-texte",
  "ocr-echec",
  "lecture-impossible",
  "introuvable",
  "extraction-vide",
  "piece-vide",
  "refusee",
  // ⚠⚠ LE VERDICT QUI PROTÈGE LA BOUCLE D'ELLE-MÊME : le document a été lu, la pièce envoyée,
  // et la Mémoire n'a RIEN changé (déjà présente, ou oubliée par Marc). Sans lui, ce papier
  // reviendrait en tête de file à chaque passe et coûterait un OCR ET un appel de modèle à
  // chaque fois — mot pour mot l'écriture inerte que l'ADR 0006 a corrigée, recommise par la
  // file. Ce n'est pas un verdict sur le papier, c'est un coupe-circuit sur la dépense.
  "sans-effet",
] as const;
export type MotifVerdict = (typeof MOTIFS_VERDICT)[number];

export interface Verdict {
  fileId: string;
  motif: MotifVerdict;
}

const LONGUEUR_MAX_EXTRACTEUR = 80;
const LONGUEUR_MAX_FILE_ID = 200;

/** Un nom d'extracteur lisible, ou `null`. PURE. */
export function extracteurValide(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const v = brut.trim();
  if (!v || v.length > LONGUEUR_MAX_EXTRACTEUR) return null;
  // ⚠️ La migration n'est PAS un lecteur : lui servir une file reviendrait à proposer de
  // « relire » des papiers avec ce qui ne lit rien, et ses verdicts sortiraient de la file
  // des documents que personne n'a ouverts.
  if (v === EXTRACTEUR_MIGRATION) return null;
  return v;
}

/** La limite demandée, bornée. Une valeur illisible vaut le défaut, jamais « tout ». PURE. */
export function limiteDeFile(brut: string | null): number {
  const n = Number(brut);
  if (!brut || !Number.isInteger(n) || n < 1) return FILE_DEFAUT;
  return Math.min(n, FILE_MAX);
}

export type ResultatVerdicts =
  | { ok: true; verdicts: Verdict[] }
  | { ok: false; message: string };

/**
 * Valide un lot de verdicts. PURE. Refuse le lot ENTIER sur la première forme invalide : un
 * lot à moitié accepté laisserait l'écrivain croire que tout est noté.
 */
export function validerVerdicts(brut: unknown): ResultatVerdicts {
  if (!Array.isArray(brut)) return { ok: false, message: "`verdicts` doit être une liste." };
  if (brut.length === 0) return { ok: false, message: "`verdicts` est vide." };
  if (brut.length > FILE_MAX) return { ok: false, message: `au plus ${FILE_MAX} verdicts par appel.` };
  const verdicts: Verdict[] = [];
  for (const [i, v] of brut.entries()) {
    const fileId = (v as { file_id?: unknown } | null)?.file_id;
    const motif = (v as { motif?: unknown } | null)?.motif;
    if (typeof fileId !== "string" || !fileId.trim() || fileId.length > LONGUEUR_MAX_FILE_ID) {
      return { ok: false, message: `verdicts[${i}].file_id est requis.` };
    }
    if (typeof motif !== "string" || !(MOTIFS_VERDICT as readonly string[]).includes(motif)) {
      return { ok: false, message: `verdicts[${i}].motif n'est pas un verdict de document connu.` };
    }
    verdicts.push({ fileId: fileId.trim(), motif: motif as MotifVerdict });
  }
  return { ok: true, verdicts };
}

export interface DepotFileDeLecture {
  /** Les prochains `fileId` à lire pour CET extracteur, dans l'ordre de Marc. */
  prochains(extracteur: string, limite: number): Promise<string[]>;
  /** Combien de papiers attendent encore CET extracteur (verdicts déduits). */
  restants(extracteur: string): Promise<number>;
  /**
   * Note les verdicts. Rend combien ont été NOTÉS et combien visaient un fichier que
   * l'inventaire ne connaît pas — ceux-là ne sont pas écrits : la table ne doit pas pouvoir
   * être remplie de lignes sans objet par un écrivain qui se trompe d'identifiants.
   */
  noterVerdicts(extracteur: string, verdicts: readonly Verdict[]): Promise<{ notes: number; inconnus: number }>;
  /** Combien de papiers ont été essayés SANS résultat, tous extracteurs confondus, par motif. */
  tentees(): Promise<{ total: number; parMotif: Record<string, number> }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Base = PgDatabase<PgQueryResultHKT, any>;

export function depotFileDeLectureDrizzle(
  db: Base,
  cle: Cle,
  nomsPrioritaires: readonly string[] = emetteursPrioritaires(),
): DepotFileDeLecture {
  const cles = (noms: readonly string[]) =>
    noms.map((n) => cleFacette(cle, "emetteur", n)).filter((k): k is string => k !== null);
  const prioritaires = cles(nomsPrioritaires);
  const enDernier = cles(EMETTEURS_EN_DERNIER);

  /**
   * Ce qui ATTEND un lecteur : une pièce vivante, encore d'inventaire, que CE lecteur n'a pas
   * déjà essayée. ⚠️ Écrit UNE fois et partagé par `prochains` et `restants` : deux copies
   * divergeraient au premier critère ajouté, et le compte cesserait de décrire la file.
   */
  const enAttente = (extracteur: string) =>
    and(
      isNull(schema.pieces.supprimeLe),
      eq(schema.pieces.statut, "active"),
      eq(schema.pieces.extracteur, EXTRACTEUR_MIGRATION),
      eq(schema.pieceExemplaires.principal, true),
      sql`NOT EXISTS (
        SELECT 1 FROM ${schema.lecturesTentees} t
        WHERE t.file_id = ${schema.pieceExemplaires.fileId} AND t.extracteur = ${extracteur}
      )`,
    );

  /** Le rang d'un émetteur : 0..n-1 pour les prioritaires, n pour le reste, n+1 en dernier. */
  const rang = () => {
    const n = prioritaires.length;
    const cas = prioritaires.map((k, i) => sql`WHEN ${schema.pieces.emetteurCle} = ${k} THEN ${i}`);
    const dernier = enDernier.length
      ? sql`WHEN ${schema.pieces.emetteurCle} IN (${sql.join(enDernier.map((k) => sql`${k}`), sql`, `)}) THEN ${n + 1}`
      : sql``;
    // Un `CASE` sans aucun `WHEN` est du SQL INVALIDE : si les deux listes sont vides (ou
    // qu'aucun nom ne donne de clé), tout le monde a le même rang, et on le dit sans `CASE`.
    if (cas.length === 0 && enDernier.length === 0) return sql`${n}`;
    return sql`CASE ${sql.join(cas, sql` `)} ${dernier} ELSE ${n} END`;
  };

  return {
    async prochains(extracteur, limite) {
      const rows = await db
        .select({ fileId: schema.pieceExemplaires.fileId })
        .from(schema.pieces)
        .innerJoin(schema.pieceExemplaires, eq(schema.pieceExemplaires.pieceId, schema.pieces.id))
        .where(enAttente(extracteur))
        // ⚠️ Le plus RÉCENT d'abord à rang égal : un avis de cotisation de cette année sert
        // Marc avant celui de 2014. Et `id` en dernier rend l'ordre TOTAL — sans lui, deux
        // passes pourraient se voir servir deux tranches qui se chevauchent.
        .orderBy(rang(), sql`${schema.pieces.annee} DESC NULLS LAST`, schema.pieces.id)
        .limit(limite);
      return rows.map((r) => r.fileId);
    },

    async restants(extracteur) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.pieces)
        .innerJoin(schema.pieceExemplaires, eq(schema.pieceExemplaires.pieceId, schema.pieces.id))
        .where(enAttente(extracteur));
      return Number(r?.n ?? 0);
    },

    async noterVerdicts(extracteur, verdicts) {
      if (verdicts.length === 0) return { notes: 0, inconnus: 0 };
      const connus = await db
        .select({ fileId: schema.pieceExemplaires.fileId })
        .from(schema.pieceExemplaires)
        .where(inArray(schema.pieceExemplaires.fileId, verdicts.map((v) => v.fileId)));
      const existe = new Set(connus.map((c) => c.fileId));
      // Un même fichier cité deux fois dans le lot : le DERNIER verdict gagne, et une seule
      // ligne part — sinon l'upsert lèverait sur sa propre clé.
      const aNoter = new Map<string, Verdict>();
      for (const v of verdicts) if (existe.has(v.fileId)) aNoter.set(v.fileId, v);
      if (aNoter.size > 0) {
        await db
          .insert(schema.lecturesTentees)
          .values([...aNoter.values()].map((v) => ({ fileId: v.fileId, extracteur, motif: v.motif })))
          .onConflictDoUpdate({
            target: [schema.lecturesTentees.fileId, schema.lecturesTentees.extracteur],
            set: { motif: sql`excluded.motif`, tenteLe: sql`now()` },
          });
      }
      const distincts = new Set(verdicts.map((v) => v.fileId)).size;
      return { notes: aNoter.size, inconnus: distincts - aNoter.size };
    },

    async tentees() {
      const rows = await db
        .select({ motif: schema.lecturesTentees.motif, n: sql<number>`count(distinct ${schema.lecturesTentees.fileId})::int` })
        .from(schema.lecturesTentees)
        .groupBy(schema.lecturesTentees.motif);
      const parMotif: Record<string, number> = {};
      for (const r of rows) parMotif[r.motif] = Number(r.n);
      const [t] = await db
        .select({ n: sql<number>`count(distinct ${schema.lecturesTentees.fileId})::int` })
        .from(schema.lecturesTentees);
      return { total: Number(t?.n ?? 0), parMotif };
    },
  };
}

// lib/avancement/contrat.ts — ce que DriveAI a le droit de pousser à `POST /api/avancement`
// (ADR 0009). PUR : aucune base, aucun réseau, aucune horloge.
//
// ⚠️ DES NOMBRES, ET AUCUNE CHAÎNE LIBRE. Les seules chaînes acceptées ont une FORME fermée :
// une date `AAAA-MM-JJ`, un code de dossier à deux chiffres, un horodatage ISO, un tag de
// campagne. Le libellé d'un dossier (« Carrière ») est posé par la Mémoire depuis sa propre
// table — un nom venu du réseau serait du texte non maîtrisé affiché tel quel.
//
// ⚠️ `.strict()` PARTOUT. Zod STRIPPE les clés inconnues par défaut : un producteur qui
// ajouterait `nomFichier` verrait son champ disparaître EN SILENCE et croirait qu'il passe.
// Ici il reçoit un 422 qui nomme la clé — un refus bruyant, au premier envoi, dans le dépôt
// qui l'a écrit.
//
// ⚠️ `null` VEUT DIRE « PAS MESURÉ », jamais zéro. Un compte de documents distincts absent
// (DriveAI pas encore redéployé) ou un reste inconnu restent `null` jusqu'à l'écran, qui dit
// « non mesuré ». Un zéro se lirait « rien n'a été classé ».

import { z } from "zod";

/** La seule version comprise. Une version plus récente est refusée AVEC son nom. */
const VERSION_AVANCEMENT = 1;
/** Au-delà, 413 : l'envoi légitime pèse ~3 Ko, et rien ne justifie de lire un corps sans fond. */
export const TAILLE_MAX_OCTETS = 32 * 1024;
export const JOURS_MAX = 60;
const DOSSIERS_MAX = 12;
/** Un compte plausible pour ce parc : au-delà, c'est une valeur corrompue, pas une mesure. */
const COMPTE_MAX = 10_000_000;

const compte = z.number().int().min(0).max(COMPTE_MAX);
const compteOuNull = compte.nullable();
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dossier = z.string().regex(/^\d{2}$/);
const tag = z.string().regex(/^[a-z0-9-]{1,32}$/);
// ⚠️ ISO complet avec fuseau : `Date.parse` accepte bien d'autres formes, et une date sans
// fuseau serait lue à l'heure du SERVEUR (UTC chez Vercel), donc décalée de 4 ou 5 h.
const horodatage = z.string().datetime({ offset: true });

const jourLuSchema = z
  .object({
    jour,
    /** Le reste de la tranche ce jour-là. `null` : DriveAI ne savait pas le compter. */
    restants: compteOuNull,
    extraits: compte,
    acceptes: compte,
    illisibles: compte,
    sansTexte: compte,
    echecs: compte,
    tag,
  })
  .strict();

const dossierSchema = z
  .object({
    code: dossier,
    lus: compte,
    restants: compte,
    enCours: z.boolean(),
  })
  .strict();

const avancementSchema = z
  .object({
    version: z.literal(VERSION_AVANCEMENT),
    mesureLe: horodatage,
    classes: z
      .object({
        /** Lignes de l'Index DriveAI : un document peut en porter plusieurs. */
        lignes: compte,
        /** Documents DISTINCTS. `null` tant que le recompte ne l'a pas mesuré. */
        distincts: compteOuNull,
        sansFileId: compte,
        candidats: compte,
      })
      .strict()
      .nullable(),
    envoi: z
      .object({
        /** Papiers acceptés par la Mémoire, cumul vu de DriveAI. */
        acceptes: compte,
      })
      .strict()
      .nullable(),
    fileLecture: z.array(dossierSchema).max(DOSSIERS_MAX),
    joursLus: z.array(jourLuSchema).max(JOURS_MAX),
  })
  .strict();

export type Avancement = z.infer<typeof avancementSchema>;
export type JourLuDriveai = z.infer<typeof jourLuSchema>;

export type Verdict =
  | { ok: true; avancement: Avancement }
  | { ok: false; code: "version_inconnue"; version: unknown }
  | { ok: false; code: "schema_refuse"; chemins: string[] };

/**
 * Valide un corps reçu. ⚠️ Le refus NOMME le champ (son chemin) et jamais sa valeur : c'est ce
 * qui permet de corriger au premier envoi, sans qu'une valeur inattendue soit renvoyée en écho
 * à qui que ce soit.
 */
export function validerAvancement(corps: unknown): Verdict {
  const version = (corps as { version?: unknown } | null)?.version;
  // ⚠️ La version d'abord, et à part : « je suis trop ancienne pour te lire » et « tu m'envoies
  // n'importe quoi » appellent deux corrections dans deux dépôts différents. Confondues, elles
  // enverraient corriger le producteur alors que c'est ce dépôt qui est en retard.
  if (typeof version === "number" && version !== VERSION_AVANCEMENT) {
    return { ok: false, code: "version_inconnue", version };
  }
  const r = avancementSchema.safeParse(corps);
  if (r.success) return { ok: true, avancement: r.data };
  const chemins = [
    ...new Set(
      r.error.issues.map((i) => {
        // Une clé inconnue a un chemin VIDE au niveau où elle apparaît : on nomme la clé.
        const base = i.path.join(".");
        if (i.code === "unrecognized_keys") return [base, ...i.keys].filter(Boolean).join(".");
        return base || "(racine)";
      }),
    ),
  ].slice(0, 20);
  return { ok: false, code: "schema_refuse", chemins };
}

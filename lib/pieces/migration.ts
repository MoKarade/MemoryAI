// lib/pieces/migration.ts — les `document.existe` deviennent des PIÈCES. PURE.
//
// ADR 0004 §6.2, décision n° 7. Le compteur du hub annonce « 2 827 faits » dont 96,5 % sont
// des noms de fichiers : ce ne sont pas des faits SUR Marc, ce sont des papiers. Une pièce
// n'affirme rien sur lui — elle rapporte ce qu'un papier contient — et c'est ce qui lui donne
// le droit à des champs libres sans rouvrir la porte d'injection des faits.
//
// ⚠️ CETTE MIGRATION N'INVENTE RIEN, ET C'EST LA SEULE CHOSE QUI COMPTE ICI. Elle n'appelle
// aucun modèle, ne lit aucun document, ne devine aucun résumé. Tout ce qu'elle écrit vient du
// fait : le `fileId` est sa valeur, le type / l'année / l'émetteur sont ses attributs, le
// domaine et le niveau sont les siens. Une pièce migrée n'a donc NI résumé NI champs — et
// c'est honnête : personne n'a lu ce papier. Elle en aura un le jour où DriveAI l'extraira,
// et ce jour-là c'est l'empreinte de l'exemplaire qui les réunira.
//
// ⚠️ CETTE DERNIÈRE PHRASE ÉTAIT UNE INTENTION, PAS UN MÉCANISME, jusqu'au 18/09 : les deux
// pièces se réunissaient bien sur la même empreinte, et le chemin d'écriture répondait
// `dejaPresentes` — donc la lecture ne remplaçait jamais l'inventaire. C'est l'ADR 0006 et
// `depot.remplacer` qui la rendent vraie ; `EXTRACTEUR_MIGRATION` ci-dessous est ce qui
// autorise ce remplacement, et c'est la SEULE chose qui l'autorise.
//
// ⚠️ LE NIVEAU NE BAISSE PAS. Il est repris tel quel du fait, puis `regimePiece` décide du
// régime de chiffrement à partir de LUI. Un `document.existe` de `04 · Immigration` est N3
// chez les faits ; il reste N3 en pièce, donc chiffré intégralement.

import { regimePiece, type Regime } from "./regime";
import type { Niveau } from "../vocabulaire";

/** Ce que la migration lit d'un fait — rien d'autre n'est disponible, et c'est voulu. */
export interface FaitAMigrer {
  id: string;
  predicat: string;
  valeurType: string;
  niveau: number;
  domaine: string | null;
  valideDe: string | null;
  creeLe: Date;
}

export interface PieceMigree {
  origineFaitId: string;
  sujet: "marc";
  type: string | null;
  emetteur: string | null;
  annee: number | null;
  domaine: string | null;
  dateDocument: string | null;
  niveau: Niveau;
  regime: Regime;
  fileId: string;
  extracteur: string;
}

/** L'extracteur des pièces MIGRÉES. Il DIT d'où vient le contenu : de l'inventaire, pas d'un modèle. */
export const EXTRACTEUR_MIGRATION = "moteur-inventaire-v1";

/** Le seul prédicat concerné. Élargir cette liste est une DÉCISION, pas une refacto. */
export const PREDICAT_MIGRE = "document.existe";

export type RefusMigration = "predicat" | "type_valeur" | "valeur_vide";

/**
 * Compose la pièce correspondant à un fait `document.existe`, ou dit pourquoi elle refuse.
 *
 * @param fait      la ligne, telle que la base la porte
 * @param fileId    la valeur DÉCHIFFRÉE du fait (l'appelant a la clé, pas ce module)
 * @param attributs les attributs DÉCHIFFRÉS (`type`, `annee`, `emetteur`), ou null
 */
export function pieceDepuisFait(
  fait: FaitAMigrer,
  fileId: string,
  attributs: Record<string, string> | null,
): { ok: true; piece: PieceMigree } | { ok: false; refus: RefusMigration } {
  // ⚠️ Trois refus NOMMÉS plutôt qu'un silence : une migration qui saute des lignes sans dire
  // lesquelles ni pourquoi laisse un écart qu'on découvre des mois plus tard en comptant.
  if (fait.predicat !== PREDICAT_MIGRE) return { ok: false, refus: "predicat" };
  if (fait.valeurType !== "ref_document") return { ok: false, refus: "type_valeur" };
  const id = fileId.trim();
  if (!id) return { ok: false, refus: "valeur_vide" };

  const a = attributs ?? {};
  const type = (a.type ?? "").trim() || null;
  const emetteur = (a.emetteur ?? "").trim() || null;
  const anneeBrute = Number.parseInt((a.annee ?? "").trim(), 10);
  const annee = Number.isInteger(anneeBrute) && anneeBrute >= 1900 && anneeBrute <= 2100 ? anneeBrute : null;
  const niveau = Math.min(3, Math.max(0, fait.niveau)) as Niveau;

  return {
    ok: true,
    piece: {
      origineFaitId: fait.id,
      sujet: "marc",
      type,
      emetteur,
      annee,
      domaine: fait.domaine,
      // `valide_de` d'un `document.existe` porte la date du DOCUMENT (DriveAI la tire du nom
      // classé). C'est la même grandeur que `date_document` : on la déplace, on ne la refait pas.
      dateDocument: fait.valideDe,
      niveau,
      // ⚠️ Le régime se DÉRIVE, il ne se choisit pas : même fonction que pour une pièce
      // extraite. Deux règles de chiffrement pour la même table divergeraient au premier
      // changement, et la divergence ne se verrait qu'en lisant une ligne déjà écrite.
      regime: regimePiece({ domaine: fait.domaine, type, niveauPropose: niveau }),
      fileId: id,
      extracteur: EXTRACTEUR_MIGRATION,
    },
  };
}

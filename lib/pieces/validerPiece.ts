// lib/pieces/validerPiece.ts — le contrat d'écriture d'une PIÈCE (ADR 0004 §6.2, lot S2).
//
// Jumeau de `validerFait`, avec une frontière déplacée : un fait passe par un vocabulaire
// FERMÉ, une pièce a des champs LIBRES. C'est voulu — « je veux vraiment toutes les infos »
// vit ici et nulle part ailleurs. Ce qui remplace le vocabulaire fermé :
//
//  1. des BORNES, parce que « libre » ne veut pas dire « sans limite » : une pièce ne peut
//     pas devenir le texte intégral du document (×20 à ×50 la taille, contre 0,5 Go de
//     plafond Neon — décision n° 9 de l'ADR) ;
//  2. le CANARI (`lib/canari.ts`, déjà écrit pour les faits) : un résumé qui ressemble à une
//     consigne ne se refuse pas — le refus apprendrait à l'attaquant ce qui passe — il se
//     MARQUE, et une pièce marquée n'est jamais servie à un modèle ;
//  3. le RÉGIME de chiffrement (`./regime.ts`), appliqué ICI, au point d'écriture. Une garde
//     n'existe qu'aux endroits qui la consultent : calculer le régime ailleurs et l'oublier
//     ici écrirait du niveau 3 en clair.
//
// ⚠️ LES BALISES SONT LE SEUL REFUS DE FORME. Une pièce peut contenir une URL, un numéro,
// une adresse — c'est ce qu'un papier contient. Elle ne peut pas contenir de balise de rôle
// (`<system>`, `</donnees>`) : le balisage à la lecture est ce qui dit à un modèle « ceci est
// une donnée », et une valeur qui peut fermer sa propre balise le défait.
//
// Module PUR : ni base, ni réseau, ni horloge, ni clé.

import { z } from "zod";
import { estCanari } from "../canari";
import { regimePiece, type Regime } from "./regime";

// ⚠️ 600 → 1 500 et 40 → 80 le 24/09/2026 (ADR 0010) : Marc voulait « vraiment détaillé, pas
// seulement un résumé foireux ». La décision n° 9 de l'ADR 0004 tient toujours — une pièce
// n'est pas le texte intégral — et ces bornes sont ce qui la tient : relevées, jamais retirées.
export const LONGUEUR_MAX_RESUME = 1500;
export const LONGUEUR_MAX_COURTE = 80;
export const LONGUEUR_MAX_VALEUR_LIBRE = 500;
export const LONGUEUR_MAX_CLE_LIBRE = 60;
export const MAX_CHAMPS_LIBRES = 80;
export const MAX_EXEMPLAIRES = 20;

/** Les familles de champs STRUCTURÉS (ADR §6.2). Fermée : ce qui n'y entre pas va en libre. */
export const FAMILLES_STRUCTUREES = ["montants", "numeros", "personnes", "lieux"] as const;
export type FamilleStructuree = (typeof FAMILLES_STRUCTUREES)[number];

export const CODES_REFUS_PIECE = [
  "schema",
  "balise",
  "trop-long",
  "trop-de-champs",
  "sans-exemplaire",
  "date-invalide",
  "titulaire-sans-confiance",
] as const;
export type CodeRefusPiece = (typeof CODES_REFUS_PIECE)[number];

export interface RefusPiece {
  readonly ok: false;
  readonly code: CodeRefusPiece;
  /** Ce qui cloche, et OÙ. Un refus qui ne nomme pas son champ coûte un aller-retour entier. */
  readonly message: string;
  readonly champ?: string;
}

/** Une entrée de champ structuré : ce que le papier dit, et sous quel libellé il le dit. */
const entreeStructureeSchema = z
  .object({
    libelle: z.string().min(1).max(LONGUEUR_MAX_COURTE),
    valeur: z.string().min(1).max(LONGUEUR_MAX_VALEUR_LIBRE),
  })
  .strict();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Les bornes d'une date de papier. Écrites UNE fois et employées par le schéma (`annee`) comme
 * par les dates : c'est leur divergence qui a laissé passer une échéance en 2125.
 *
 * ⚠️ Larges EXPRÈS. Un acte de naissance de 1920 est un papier légitime, et un bail peut courir
 * jusqu'en 2090. Ce qu'on refuse n'est pas une date « improbable » mais une date IMPOSSIBLE —
 * celles qui ne peuvent venir que d'un chiffre mal lu.
 */
const ANNEE_MIN = 1900;
const ANNEE_MAX = 2100;

/**
 * ⚠️ L'ENTRÉE EST EN `snake_case`, COMME CELLE DES FAITS — et ce n'est pas un détail de
 * style. DriveAI écrit vers les DEUX contrats du même dépôt ; deux conventions de nommage
 * pour un même émetteur, c'est une faute de frappe qui attend son tour, et elle arriverait
 * sous la forme la plus discrète qui soit : un `champ_inconnu` dans un HTTP 200, le lot
 * entier refusé en silence (vécu le 16/09, 4 000 faits).
 *
 * La SORTIE (`PieceValidee`) reste en `camelCase` : c'est du TypeScript interne, pas un
 * contrat. `validerFait` fait exactement la même chose.
 */
const pieceSchema = z
  .object({
    sujet: z.string().min(1).max(LONGUEUR_MAX_COURTE).default("marc"),
    type: z.string().min(1).max(LONGUEUR_MAX_COURTE).nullish(),
    emetteur: z.string().min(1).max(LONGUEUR_MAX_COURTE).nullish(),
    /**
     * À QUI le papier appartient (ADR-0061 de DriveAI). ⚠️ `null` veut dire INCONNU, jamais
     * « Marc » : un document au nom de deux personnes, un formulaire vierge ou un papier sans
     * nom n'attribue rien à personne. Le contrat n'invente donc AUCUN défaut ici.
     */
    titulaire: z.string().min(1).max(LONGUEUR_MAX_COURTE).nullish(),
    /** Ce que l'extracteur dit de sa propre certitude. Obligatoire dès qu'un titulaire est posé. */
    titulaire_confiance: z.number().min(0).max(1).nullish(),
    annee: z.number().int().min(ANNEE_MIN).max(ANNEE_MAX).nullish(),
    /** Le dossier DriveAI d'origine : c'est lui qui dérive le niveau. */
    domaine: z.string().max(120).nullish(),
    langue: z.string().min(2).max(5).nullish(),
    date_document: z.string().regex(DATE).nullish(),
    date_echeance: z.string().regex(DATE).nullish(),
    resume: z.string().max(LONGUEUR_MAX_RESUME).nullish(),
    // Zod 4 : `z.record` à clés d'énumération EXIGE toutes les clés (exhaustif) ; une pièce ne porte
    // que les familles qu'elle a. `z.partialRecord` garde le sens de Zod 3 (clés facultatives).
    champs_structures: z.partialRecord(z.enum(FAMILLES_STRUCTUREES), z.array(entreeStructureeSchema)).nullish(),
    champs_libres: z.record(z.string(), z.string()).nullish(),
    exemplaires: z.array(z.object({ file_id: z.string().min(1), chemin: z.string().max(500).nullish() }).strict()),
    niveau_propose: z.number().int().min(0).max(3).nullish(),
    confiance: z.number().min(0).max(1).default(1),
    extracteur: z.string().min(1).max(LONGUEUR_MAX_COURTE),
  })
  .strict();

export type EntreePiece = z.input<typeof pieceSchema>;

/**
 * Les champs que ce contrat ACCEPTE, DÉRIVÉS du schéma — jamais réécrits à la main.
 * DriveAI en garde une copie (`CHAMPS_ACCEPTES_PIECE_MEMOIRE`) parce qu'un moteur Apps Script
 * ne peut rien importer d'ici ; c'est son test à lui qui tient les deux ensemble.
 */
export const CHAMPS_ACCEPTES_PIECE: readonly string[] = Object.keys(pieceSchema.shape);

export interface PieceValidee {
  readonly ok: true;
  readonly sujet: string;
  readonly type: string | null;
  readonly emetteur: string | null;
  readonly titulaire: string | null;
  readonly titulaireConfiance: number | null;
  readonly annee: number | null;
  readonly domaine: string | null;
  readonly langue: string | null;
  readonly dateDocument: string | null;
  readonly dateEcheance: string | null;
  readonly resume: string | null;
  readonly champsStructures: Partial<Record<FamilleStructuree, { libelle: string; valeur: string }[]>> | null;
  readonly champsLibres: Record<string, string> | null;
  readonly exemplaires: readonly { fileId: string; chemin: string | null }[];
  readonly confiance: number;
  readonly extracteur: string;
  readonly regime: Regime;
  /** Le texte que `to_tsvector` indexera — `null` quand le régime est chiffré. */
  readonly recherche: string | null;
  /** La pièce ressemble-t-elle à une tentative ? Marquée, jamais refusée, jamais servie. */
  readonly canari: boolean;
}

/** `<system>`, `</donnees>`, `<|…|>` : ce qui casserait le balisage à la lecture. */
const BALISE = /<\/?\s*[a-z|][^>]*>|<\|[^|>]{0,40}\|>/i;

function porteUneBalise(...textes: (string | null | undefined)[]): string | null {
  for (const t of textes) if (t && BALISE.test(t)) return t;
  return null;
}

/** Espaces repliés, extrémités nettoyées. Une valeur de papier garde sa ponctuation. */
function normaliser(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Le texte de recherche, EN FRANÇAIS quelle que soit la langue du papier (ADR §6.2).
 * Composé de ce qui se cherche — jamais des champs structurés, qui portent les numéros.
 */
function texteRecherche(p: {
  type: string | null;
  emetteur: string | null;
  annee: number | null;
  resume: string | null;
  champsLibres: Record<string, string> | null;
}): string {
  const morceaux = [p.type, p.emetteur, p.annee ? String(p.annee) : null, p.resume];
  if (p.champsLibres) morceaux.push(...Object.keys(p.champsLibres), ...Object.values(p.champsLibres));
  return normaliser(morceaux.filter(Boolean).join(" "));
}

export function validerPiece(entree: unknown): PieceValidee | RefusPiece {
  const parse = pieceSchema.safeParse(entree);
  if (!parse.success) {
    const pb = parse.error.issues[0];
    return {
      ok: false,
      code: "schema",
      message: `${pb?.path.join(".") || "entrée"} : ${pb?.message ?? "forme invalide"}`,
      champ: pb?.path.join(".") || undefined,
    };
  }
  const e = parse.data;

  if (e.exemplaires.length === 0) {
    return { ok: false, code: "sans-exemplaire", message: "une pièce sans fichier ne se retrouve pas", champ: "exemplaires" };
  }
  if (e.exemplaires.length > MAX_EXEMPLAIRES) {
    return {
      ok: false,
      code: "trop-de-champs",
      message: `${e.exemplaires.length} exemplaires, ${MAX_EXEMPLAIRES} au plus`,
      champ: "exemplaires",
    };
  }

  const libres = e.champs_libres ?? null;
  if (libres) {
    const cles = Object.keys(libres);
    if (cles.length > MAX_CHAMPS_LIBRES) {
      return {
        ok: false,
        code: "trop-de-champs",
        message: `${cles.length} champs libres, ${MAX_CHAMPS_LIBRES} au plus — une pièce n'est pas le texte intégral`,
        champ: "champs_libres",
      };
    }
    for (const c of cles) {
      if (c.length > LONGUEUR_MAX_CLE_LIBRE) {
        return { ok: false, code: "trop-long", message: `clé « ${c.slice(0, 20)}… » trop longue`, champ: `champs_libres.${c}` };
      }
      const v = libres[c];
      if (v !== undefined && v.length > LONGUEUR_MAX_VALEUR_LIBRE) {
        return {
          ok: false,
          code: "trop-long",
          message: `champ libre « ${c} » : ${v.length} caractères, ${LONGUEUR_MAX_VALEUR_LIBRE} au plus`,
          champ: `champs_libres.${c}`,
        };
      }
    }
  }

  // Les balises se cherchent dans TOUT ce qui sera rendu à un modèle — résumé, facettes,
  // champs libres, champs structurés. En oublier un laisse la seule porte qui compte.
  const structures = e.champs_structures ?? null;
  const textesStructures = structures
    ? Object.values(structures).flatMap((l) => (l ?? []).flatMap((x) => [x.libelle, x.valeur]))
    : [];
  const fautif = porteUneBalise(
    e.resume,
    e.type,
    e.emetteur,
    e.titulaire,
    ...(libres ? [...Object.keys(libres), ...Object.values(libres)] : []),
    ...textesStructures,
  );
  if (fautif) {
    return {
      ok: false,
      code: "balise",
      message: `une balise de rôle défait le balisage à la lecture : « ${fautif.slice(0, 40)} »`,
    };
  }

  // ⚠️ Un titulaire est une LECTURE DE MODÈLE sur un sujet sensible — à qui ce papier
  // appartient. Sans le degré de certitude qui va avec, il serait cru sur parole, et rien ne
  // permettrait plus tard de distinguer « c'est sûrement sa sœur » de « c'est sa sœur ».
  if (e.titulaire && (e.titulaire_confiance === null || e.titulaire_confiance === undefined)) {
    return {
      ok: false,
      code: "titulaire-sans-confiance",
      message: "un titulaire sans sa confiance serait cru sur parole",
      champ: "titulaire_confiance",
    };
  }

  if (e.date_echeance && e.date_document && e.date_echeance < e.date_document) {
    return { ok: false, code: "date-invalide", message: "l'échéance précède la date du document", champ: "date_echeance" };
  }

  // ⚠️ LES DATES SONT BORNÉES, et pas seulement leur FORME. `DATE` ne vérifie que le gabarit
  // `AAAA-MM-JJ`, donc `2125-03-23` passait — et il est passé : une pièce du domaine `01`,
  // datée du 2026-03-24, porte une échéance dans un siècle. C'est une lecture ratée de Haiku
  // (`2025` lu `2125`), pas une information.
  //
  // Ce qu'une telle date COÛTE : la question n° 6 du socle est « qu'est-ce qui expire dans les
  // 90 prochains jours », donc elle COMPARE des échéances entre elles. Une valeur à un siècle
  // ne fait pas planter le tri — elle se range simplement en dernier, pour toujours, et le
  // papier qu'elle décrit n'expire jamais aux yeux de la mémoire.
  //
  // ⚠️ Le champ `annee` était déjà borné à [1900, 2100] au schéma ; les DATES, non. Deux
  // représentations de la même chose, une seule gardée : c'est le genre d'écart qu'on ne voit
  // qu'en lisant les deux côte à côte.
  for (const [champ, valeur] of [
    ["date_document", e.date_document],
    ["date_echeance", e.date_echeance],
  ] as const) {
    if (!valeur) continue;
    const annee = Number(valeur.slice(0, 4));
    if (annee < ANNEE_MIN || annee > ANNEE_MAX) {
      return {
        ok: false,
        code: "date-invalide",
        message: `${champ} hors de [${ANNEE_MIN}, ${ANNEE_MAX}] : ${valeur} — c'est une lecture ratée, pas une date`,
        champ,
      };
    }
  }

  const type = e.type ? normaliser(e.type) : null;
  const emetteur = e.emetteur ? normaliser(e.emetteur) : null;
  const resume = e.resume ? normaliser(e.resume) : null;
  const regime = regimePiece({ domaine: e.domaine, type, niveauPropose: e.niveau_propose });

  const recherche = texteRecherche({ type, emetteur, annee: e.annee ?? null, resume, champsLibres: libres });

  return {
    ok: true,
    sujet: e.sujet,
    type,
    emetteur,
    titulaire: e.titulaire ? normaliser(e.titulaire) : null,
    titulaireConfiance: e.titulaire ? (e.titulaire_confiance ?? null) : null,
    annee: e.annee ?? null,
    domaine: e.domaine ?? null,
    langue: e.langue ?? null,
    dateDocument: e.date_document ?? null,
    dateEcheance: e.date_echeance ?? null,
    resume,
    champsStructures: structures,
    champsLibres: libres,
    exemplaires: e.exemplaires.map((x) => ({ fileId: x.file_id, chemin: x.chemin ?? null })),
    confiance: e.confiance,
    extracteur: e.extracteur,
    regime,
    // ⚠️ Le texte de recherche n'est PRODUIT que si le régime l'autorise. C'est la même
    // règle que la contrainte SQL `pieces_chiffre_sans_recherche`, appliquée un cran plus
    // tôt : la base est le filet, pas le premier rempart.
    recherche: regime.resumeEnClair && recherche ? recherche : null,
    canari: estCanari(resume) || (libres ? Object.values(libres).some((v) => estCanari(v)) : false),
  };
}

// lib/validerFait.ts — LA garde d'écriture (ADR 0001 §3, menace n° 1, et §5.1).
//
// Fonction PURE : elle reçoit un objet inconnu et un contexte (version du vocabulaire,
// fiabilités que le jeton de l'appelant autorise), et rend soit un fait prêt à écrire,
// soit un refus NOMMÉ. Aucune base, aucun réseau, aucune horloge — c'est ce qui permet au
// corpus adversarial (`tests/adversarial.test.ts`) de la prendre en défaut sans rien
// monter.
//
// Chaque « jamais » de l'ADR a sa ligne ici, et son cas dans le corpus :
//   - un champ hors de la liste EXACTE ⇒ `champ_inconnu` (Zod `.strict()`) ;
//   - `valeur_type: "montant"` ⇒ `montant_interdit` — FinanceAI reste la source des chiffres ;
//   - un sujet autre que `marc` ⇒ `sujet_inconnu` (phase 0, Q10) ;
//   - un prédicat hors vocabulaire ⇒ `predicat_inconnu` AVEC le nom (pour le compter), refusé
//     STRUCTURELLEMENT (position, coordonnées, numéro d'identité) ⇒ `predicat_interdit` ;
//   - une valeur qui dépasse 200 caractères, porte un retour à la ligne, une URL, une balise
//     ou un caractère de contrôle ⇒ `valeur_interdite` ;
//   - un texte sur un fait de niveau 3 ⇒ `n3_texte` — même quand c'est le DOSSIER du
//     document qui a monté le niveau, pas le prédicat ;
//   - le niveau est le MAX de tout ce qui le propose, jamais le minimum (`lib/niveau.ts`) ;
//   - la fiabilité vient du JETON (un plafond) : le corps peut la déclarer plus basse, jamais
//     plus haute ; un `source_type: "mail"` la force à `mail-tiers` ;
//   - le statut est TOUJOURS `propose` : personne n'écrit un fait validé ;
//   - une valeur qui ressemble à une consigne n'est PAS refusée mais marquée `canari`
//     (refuser dirait à l'attaquant ce qui passe).

import { z } from "zod";
import { estCanari } from "./canari";
import { FIABILITES, SOURCES } from "./db/schema";
import { niveauFinal } from "./niveau";
import { definition, estRefuseStructurellement, VERSION_COURANTE, type Niveau, type TypeValeur } from "./vocabulaire";
import { NIVEAU_PLANCHER_QUARANTAINE } from "./vocabulaire/quarantaine";

export type Fiabilite = (typeof FIABILITES)[number];
export type SourceType = (typeof SOURCES)[number];

export const LONGUEUR_MAX_VALEUR = 200;
export const LONGUEUR_MAX_ATTRIBUT = 80;
/** Les SEULES clés qu'un bloc `attributs` peut porter : des métadonnées de document. */
export const CLES_ATTRIBUTS = ["type", "emetteur", "annee", "echeance"] as const;

export const CODES_REFUS = [
  "champ_inconnu",
  "corps_invalide",
  "sujet_inconnu",
  "montant_interdit",
  "predicat_interdit",
  "predicat_inconnu",
  "predicat_deprecie",
  "type_valeur_incompatible",
  "valeur_interdite",
  "date_invalide",
  "ref_document_invalide",
  "n3_texte",
  "attribut_invalide",
  "fiabilite_hors_plafond",
  "provenance_invalide",
  "oublie",
  // Un fait `valide` porte DÉJÀ cette valeur exacte pour ce sujet et ce prédicat : il n'y a
  // rien à décider, donc rien à mettre dans la file. Ce n'est pas l'idempotence (qui est par
  // SOURCE, `empreinteFait`) : ici la source est différente et elle CONFIRME. Vécu le
  // 17/09 — voir `lib/ecrireFaits.ts`.
  "doublon_valide",
] as const;
export type CodeRefus = (typeof CODES_REFUS)[number];

export interface Refus {
  ok: false;
  code: CodeRefus;
  raison: string;
  /** Le nom du prédicat refusé, SEULEMENT s'il est bien formé — c'est lui qu'on compte. */
  predicat?: string;
}

export interface ProvenanceValidee {
  sourceType: SourceType;
  sourceRef: string;
  extracteur: string;
  dateSource: string | null;
}

export type Attributs = Partial<Record<(typeof CLES_ATTRIBUTS)[number], string>>;

export interface FaitValide {
  ok: true;
  sujet: "marc";
  predicat: string;
  valeur: string;
  valeurType: TypeValeur;
  valideDe: string | null;
  valideA: string | null;
  domaine: string | null;
  niveau: Niveau;
  confiance: number;
  fiabiliteSource: Fiabilite;
  canari: boolean;
  versionVocabulaire: number;
  attributs: Attributs | null;
  provenance: ProvenanceValidee;
  /**
   * Le prédicat n'est PAS dans le vocabulaire fermé (ADR 0004 §2.3). Le fait entre quand
   * même — il n'est ni refusé ni perdu — et c'est `ecrireLot` qui l'inscrit à la file des
   * propositions. Champ REQUIS, jamais optionnel : un appelant qui l'oublierait ferait
   * entrer un prédicat neuf sans jamais le mettre en quarantaine, et le compilateur ne
   * dirait rien. Ici le défaut sûr n'existe pas, donc il n'y a pas de défaut.
   */
  predicatHorsVocabulaire: boolean;
}

export interface ContexteValidation {
  /** Les fiabilités que le jeton de l'appelant autorise ; la première est le défaut. */
  fiabilites: readonly Fiabilite[];
  version?: number;
}

// ── Les formes ─────────────────────────────────────────────────────────────────────────

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const ANNEE = /^\d{4}$/;
/** Un `fileId` Drive, ou un identifiant opaque du même gabarit. Jamais une URL. */
const REF_DOCUMENT = /^[A-Za-z0-9_-]{10,128}$/;
/** La forme d'un nom de prédicat. Ce qui ne l'a pas n'est pas compté (rien d'inconnu en base). */
const NOM_PREDICAT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
const URL = /(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/)/i;
const BALISE = /<\s*\/?\s*[a-z!?]/i;
/** Contrôles C0/C1 (dont retour à la ligne, tabulation) et séparateurs de ligne/paragraphe Unicode. */
const CONTROLE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/** Espaces exotiques (insécable, fine, idéographique, largeur nulle) ramenées à une espace. */
const ESPACES = /[\p{Zs}​⁠﻿]/gu;

const provenanceSchema = z
  .object({
    source_type: z.enum(SOURCES),
    source_ref: z.string().min(1).max(256),
    extracteur: z.string().min(1).max(128),
    date_source: z.string().regex(DATE_ISO).optional(),
    /** Le domaine DriveAI du document (`04 · Immigration`) — monte le niveau, jamais ne le baisse. */
    dossier: z.string().max(120).optional(),
    /** Le type de document reconnu par l'extracteur (`passeport`) — idem. */
    type_document: z.string().max(120).optional(),
  })
  .strict();

/** La liste EXACTE des champs acceptés. Un champ de plus ⇒ `champ_inconnu`. */
const faitSchema = z
  .object({
    sujet: z.string(),
    predicat: z.string().max(200),
    valeur: z.string().max(4000),
    valeur_type: z.string(),
    valide_de: z.string().optional(),
    valide_a: z.string().optional(),
    niveau_propose: z.number().int().min(0).max(3).optional(),
    confiance: z.number().min(0).max(1).optional(),
    fiabilite_source: z.string().optional(),
    attributs: z.record(z.string(), z.string()).optional(),
    provenance: provenanceSchema,
  })
  .strict();

export const CHAMPS_ACCEPTES: readonly string[] = Object.keys(faitSchema.shape);
export const CHAMPS_PROVENANCE: readonly string[] = Object.keys(provenanceSchema.shape);

function refus(code: CodeRefus, raison: string, predicat?: string): Refus {
  return predicat ? { ok: false, code, raison, predicat } : { ok: false, code, raison };
}

/**
 * Une chaîne de contenu : normalisée, bornée, sans ligne, URL, balise ni contrôle.
 *
 * ⚠️ EXPORTÉE, et c'est la SEULE définition de cette règle dans le dépôt. Une question posée
 * à Marc (`lib/questions.ts`) est du texte écrit par un modèle, exactement comme la valeur
 * d'un fait : la recopier ailleurs ferait diverger les deux au premier durcissement.
 */
export function nettoyerTexte(brut: string, max: number): { ok: true; valeur: string } | { ok: false; raison: string } {
  const v = brut.normalize("NFC").replace(ESPACES, " ").trim();
  if (v.length === 0) return { ok: false, raison: "vide" };
  if (v.length > max) return { ok: false, raison: `plus de ${max} caractères` };
  if (CONTROLE.test(v)) return { ok: false, raison: "retour à la ligne ou caractère de contrôle" };
  if (BALISE.test(v)) return { ok: false, raison: "balise" };
  if (URL.test(v)) return { ok: false, raison: "URL" };
  return { ok: true, valeur: v };
}

function dateValide(v: string): boolean {
  if (!DATE_ISO.test(v)) return false;
  const [a, m, j] = v.split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

function nettoyerAttributs(brut: Record<string, string> | undefined): { ok: true; attributs: Attributs | null } | Refus {
  if (!brut) return { ok: true, attributs: null };
  const out: Attributs = {};
  for (const [cle, val] of Object.entries(brut)) {
    if (!(CLES_ATTRIBUTS as readonly string[]).includes(cle)) {
      return refus(
        "attribut_invalide",
        `attribut « ${cle.slice(0, 40)} » : seuls ${CLES_ATTRIBUTS.join(", ")} sont acceptés`,
      );
    }
    const c = cle as (typeof CLES_ATTRIBUTS)[number];
    if (c === "annee") {
      if (!ANNEE.test(val)) return refus("attribut_invalide", "attribut « annee » : quatre chiffres attendus");
      out.annee = val;
      continue;
    }
    if (c === "echeance") {
      if (!dateValide(val)) return refus("attribut_invalide", "attribut « echeance » : date AAAA-MM-JJ attendue");
      out.echeance = val;
      continue;
    }
    const n = nettoyerTexte(val, LONGUEUR_MAX_ATTRIBUT);
    if (!n.ok) return refus("attribut_invalide", `attribut « ${c} » : ${n.raison}`);
    out[c] = n.valeur;
  }
  return { ok: true, attributs: Object.keys(out).length ? out : null };
}

/**
 * Valide UN fait tel qu'un écrivain l'envoie. Rend le fait prêt à chiffrer et écrire, ou un
 * refus nommé. Ne touche à rien.
 */
export function validerFait(entree: unknown, ctx: ContexteValidation): FaitValide | Refus {
  const version = ctx.version ?? VERSION_COURANTE;
  if (ctx.fiabilites.length === 0) return refus("fiabilite_hors_plafond", "cet écrivain ne peut rien écrire");

  const parse = faitSchema.safeParse(entree);
  if (!parse.success) {
    const issue = parse.error.issues[0];
    if (issue && issue.path[0] === "provenance") {
      return refus("provenance_invalide", `provenance.${issue.path.slice(1).join(".") || "?"} : ${issue.message}`);
    }
    if (issue?.code === "unrecognized_keys") {
      return refus("champ_inconnu", `champ inconnu : ${issue.keys.join(", ")}`);
    }
    return refus("corps_invalide", `${issue?.path.join(".") || "corps"} : ${issue?.message ?? "invalide"}`);
  }
  const f = parse.data;

  // ── Ce qui n'entre JAMAIS, dans l'ordre où ça se voit ──────────────────────────────
  if (f.valeur_type === "montant") {
    return refus("montant_interdit", "aucun montant n'entre dans la mémoire — FinanceAI reste la source des chiffres");
  }
  if (!["date", "texte", "ref_document"].includes(f.valeur_type)) {
    return refus("corps_invalide", `valeur_type « ${f.valeur_type.slice(0, 20)} » inconnu`);
  }
  const valeurType = f.valeur_type as TypeValeur;

  if (f.sujet !== "marc") return refus("sujet_inconnu", "phase 0 : le seul sujet est « marc »");

  const predicat = f.predicat.trim();
  if (!NOM_PREDICAT.test(predicat)) return refus("predicat_inconnu", "prédicat mal formé");
  if (estRefuseStructurellement(predicat)) {
    return refus("predicat_interdit", `« ${predicat} » n'entrera dans aucune version du vocabulaire`, predicat);
  }
  // ⚠️ LE VOCABULAIRE GRANDIT (ADR 0004 §2.3). Un prédicat bien formé, non structurellement
  // refusé, mais absent du vocabulaire n'est PLUS refusé : il entre, et il attend. Ce qui
  // remplace le refus n'est pas rien — c'est la quarantaine, qui l'empêche d'être servi à un
  // modèle tant que Marc ne l'a pas accepté ou que trois extracteurs distincts ne l'ont pas
  // proposé. Refuser était plus simple et faisait PERDRE le fait ; accepter sans quarantaine
  // serait la menace n° 1 de l'ADR 0001 (un fait inventé devient une instruction déguisée).
  const def = definition(predicat, version);
  const horsVocabulaire = !def;
  if (def?.deprecie) {
    return refus("predicat_deprecie", `« ${predicat} » est déprécié : utiliser « ${def.deprecie} »`, predicat);
  }
  // Un prédicat inconnu n'a AUCUN type déclaré : on accepte les trois types de valeur que le
  // contrat laisse passer (le montant est déjà refusé plus haut, et pour toujours).
  if (def && !def.types.includes(valeurType)) {
    return refus("type_valeur_incompatible", `« ${predicat} » attend ${def.types.join(" ou ")}, pas ${valeurType}`);
  }

  // ── La valeur ────────────────────────────────────────────────────────────────────────
  let valeur: string;
  if (valeurType === "date") {
    valeur = f.valeur.trim();
    if (!dateValide(valeur)) return refus("date_invalide", "valeur : date AAAA-MM-JJ attendue");
  } else if (valeurType === "ref_document") {
    valeur = f.valeur.trim();
    if (!REF_DOCUMENT.test(valeur)) {
      return refus("ref_document_invalide", "valeur : identifiant de document attendu, pas une URL");
    }
  } else {
    const n = nettoyerTexte(f.valeur, LONGUEUR_MAX_VALEUR);
    if (!n.ok) return refus("valeur_interdite", `valeur : ${n.raison}`);
    valeur = n.valeur;
  }

  for (const [nom, v] of [
    ["valide_de", f.valide_de],
    ["valide_a", f.valide_a],
  ] as const) {
    if (v !== undefined && !dateValide(v)) return refus("date_invalide", `${nom} : date AAAA-MM-JJ attendue`);
  }
  if (f.valide_de && f.valide_a && f.valide_a < f.valide_de) {
    return refus("date_invalide", "valide_a précède valide_de");
  }

  const attributs = nettoyerAttributs(f.attributs);
  if (!attributs.ok) return attributs;

  // ── Le niveau : MAX de tout, jamais le minimum ──────────────────────────────────────
  const niveau = niveauFinal({
    // Un prédicat inconnu n'a pas de `niveauMin` : il prend le PLANCHER de la quarantaine.
    // 0 serait un défaut de configuration lu comme une décision — un texte arbitraire, lu
    // dans un document arbitraire, sortirait en clair et sans bascule.
    predicat: def ? def.niveauMin : NIVEAU_PLANCHER_QUARANTAINE,
    dossier: f.provenance.dossier,
    typeDocument: f.provenance.type_document,
    propose: f.niveau_propose,
  });
  // Le dossier peut avoir monté un prédicat textuel en N3 : c'est ICI que ça se refuse,
  // et la base le refuse encore une fois (`faits_n3_sans_texte`).
  if (niveau === 3 && valeurType === "texte") {
    return refus(
      "n3_texte",
      `« ${predicat} » est de niveau 3 dans ce contexte : aucun texte, seulement une date ou un pointeur`,
    );
  }

  // ── La fiabilité : un plafond posé par le jeton ─────────────────────────────────────
  let fiabiliteSource: Fiabilite = ctx.fiabilites[0]!;
  if (f.fiabilite_source !== undefined) {
    if (!(ctx.fiabilites as readonly string[]).includes(f.fiabilite_source)) {
      return refus(
        "fiabilite_hors_plafond",
        `fiabilite_source « ${f.fiabilite_source.slice(0, 30)} » n'est pas permise à cet écrivain`,
      );
    }
    fiabiliteSource = f.fiabilite_source as Fiabilite;
  }
  if (f.provenance.source_type === "mail") {
    if (!ctx.fiabilites.includes("mail-tiers")) {
      return refus("fiabilite_hors_plafond", "cet écrivain ne peut pas écrire depuis un mail");
    }
    fiabiliteSource = "mail-tiers";
  }

  const domaine = f.provenance.dossier !== undefined ? nettoyerTexte(f.provenance.dossier, 120) : null;
  if (domaine && !domaine.ok) return refus("provenance_invalide", `provenance.dossier : ${domaine.raison}`);

  return {
    ok: true,
    sujet: "marc",
    predicat,
    valeur,
    valeurType,
    valideDe: f.valide_de ?? null,
    valideA: f.valide_a ?? null,
    domaine: domaine ? domaine.valeur : null,
    niveau,
    confiance: f.confiance ?? 1,
    fiabiliteSource,
    // Une valeur textuelle qui ressemble à une consigne : marquée, jamais refusée, jamais servie.
    canari: valeurType === "texte" && estCanari(valeur),
    versionVocabulaire: version,
    predicatHorsVocabulaire: horsVocabulaire,
    attributs: attributs.attributs,
    provenance: {
      sourceType: f.provenance.source_type,
      sourceRef: f.provenance.source_ref.trim(),
      extracteur: f.provenance.extracteur.trim(),
      dateSource: f.provenance.date_source ?? null,
    },
  };
}

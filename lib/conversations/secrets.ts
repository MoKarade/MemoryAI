// lib/conversations/secrets.ts — le scan qui tourne AVANT le chiffrement (ADR 0002 §3).
//
// POURQUOI IL EXISTE. Le lot 8 fait entrer dans la base le TEXTE INTÉGRAL des conversations.
// Une conversation est écrite à la main, souvent en travaillant : elle contiendra un jour une
// clé d'API collée, une URL de base de données avec son mot de passe, un jeton de session.
// Marc a choisi que Claude Code pousse ses sessions AUTOMATIQUEMENT (ADR 0002 §4, question C),
// contre ma recommandation — donc personne ne relit avant l'envoi, et ce fichier est la seule
// chose entre un secret collé et une base hors de son compte Google.
//
// ⚠️ CE N'EST QU'UNE HEURISTIQUE, ET C'EST DIT DANS L'ADR (§9 n° 1). Elle attrape les formes
// CONNUES et rate les autres. Ce qui la rend acceptable : les conversations ne sortent vers
// aucune app, et Marc peut oublier une conversation. Ce qui la rendrait inacceptable : servir
// les conversations à un lecteur tiers. On ne le fera pas.
//
// ══ L'ASYMÉTRIE QUI DÉCIDE DE CHAQUE MOTIF ═══════════════════════════════════════════════
// Un secret qui passe est GRAVE et IRRÉVERSIBLE (il faut faire tourner la clé). Un fragment
// masqué à tort coûte un bout de phrase illisible dans une vieille conversation. Devant un
// doute, on masque. C'est pourquoi un SHA-1 de commit (40 caractères hexadécimaux) est masqué
// lui aussi : il ressemble trop à une clé pour qu'on prenne le risque de les distinguer.

/** Ce qu'un masquage laisse à la place. Reconnaissable, et sans longueur qui trahisse. */
export const MARQUE = "[secret retiré]";

export interface ResultatMasquage {
  texte: string;
  /** Combien de fragments ont été remplacés. Compté, affiché — jamais leur contenu. */
  retires: number;
}

/**
 * Les formes NOMMÉES. Chacune a son cas dans `tests/secrets.test.ts`, et chacune a son
 * contrôle NÉGATIF : un motif sans contre-exemple masque du texte ordinaire sans qu'on le voie.
 */
const FORMES: readonly { nom: string; motif: RegExp }[] = [
  { nom: "cle-anthropic", motif: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { nom: "cle-openai", motif: /\bsk-[A-Za-z0-9]{32,}/g },
  { nom: "cle-aws", motif: /\bAKIA[0-9A-Z]{16}\b/g },
  { nom: "jeton-github", motif: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { nom: "jeton-slack", motif: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  // Une clé privée n'a pas besoin d'être complète pour être une fuite : l'en-tête suffit à
  // dire qu'elle est là, et le corps suit sur les lignes voisines.
  { nom: "cle-privee", motif: /-----BEGIN[ A-Z]*-----/g },
  { nom: "jwt", motif: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { nom: "porteur", motif: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi },
  // Un mot de passe DANS une URL : `postgres://user:motdepasse@hote/base`. Le `//` évite de
  // matcher un `http://` ordinaire, et l'absence d'espace dans les deux parties évite la prose.
  { nom: "url-avec-mot-de-passe", motif: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi },
  // `MEMORYAI_CHIFFREMENT=...`, `DATABASE_URL=...` : la forme d'une variable d'environnement
  // collée depuis un terminal. Le nom reste, la valeur part.
  { nom: "variable-d-environnement", motif: /\b[A-Z][A-Z0-9_]{5,}=\S{12,}/g },
];

/** Suite sans espace, dans l'alphabet d'un secret encodé, assez longue pour en être un. */
const CANDIDAT = /[A-Za-z0-9+/=_-]{32,}/g;

/** Entropie de Shannon par caractère. Un mot de langue tourne autour de 3 ; un secret, au-dessus de 4. */
export function entropie(s: string): number {
  if (s.length === 0) return 0;
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const k of n.values()) {
    const p = k / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Un candidat opaque est-il assez « mélangé » pour être un secret ?
 *
 * ⚠️ L'ENTROPIE SEULE NE DISCRIMINE RIEN : une phrase française de 32 caractères tourne aussi
 * autour de 4 bits. Ce qui distingue un secret, c'est la CONJONCTION — pas d'espace, alphabet
 * d'encodage, et les trois classes de caractères à la fois. `anticonstitutionnellement` n'a ni
 * chiffre ni majuscule ; un chemin de fichier a des barres obliques et des points.
 */
export function ressembleAUnSecret(s: string): boolean {
  if (s.length < 32) return false;
  const hex = /^[0-9a-fA-F]+$/.test(s);
  // Un hexadécimal long est masqué SANS condition de classes : un SHA n'a ni majuscule ni
  // symbole, et le distinguer d'une clé hexadécimale n'est pas possible de façon fiable.
  if (hex) return true;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(s)).length;
  if (classes < 3) return false;
  return entropie(s) >= 3.5;
}

/**
 * Masque ce qui ressemble à un secret. Rend le texte ET le compte — un compte à zéro sur une
 * session entière est une information (rien trouvé), pas un silence.
 */
export function masquerSecrets(texte: string): ResultatMasquage {
  let retires = 0;
  let sortie = texte;

  for (const { motif } of FORMES) {
    sortie = sortie.replace(new RegExp(motif.source, motif.flags), () => {
      retires++;
      return MARQUE;
    });
  }

  sortie = sortie.replace(CANDIDAT, (m) => {
    // Ce que les formes nommées ont déjà remplacé ne se recompte pas : la marque elle-même
    // n'est pas un candidat (elle porte des espaces et des crochets), mais un fragment resté
    // à côté peut l'être.
    if (!ressembleAUnSecret(m)) return m;
    retires++;
    return MARQUE;
  });

  return { texte: sortie, retires };
}

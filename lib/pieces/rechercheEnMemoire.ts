// lib/pieces/rechercheEnMemoire.ts — le plein texte des papiers CHIFFRÉS, fait en mémoire.
// ADR 0011 §2.4. PUR : ni base, ni clé, ni horloge — il reçoit des pièces déjà déchiffrées.
//
// ⚠️ POURQUOI EN MÉMOIRE ET PAS EN BASE. Un papier N3 est au régime chiffré (ADR 0004,
// `lib/pieces/regime.ts`) : pas de colonne `recherche`, donc `to_tsvector` n'y voit rien, et
// c'est voulu — écrire son texte en clair pour le rendre cherchable défairait ce régime dans
// toutes les sauvegardes. On déchiffre donc, pour le seul lecteur qui a le droit de lire, les
// papiers N3 que les AUTRES filtres désignent, et on compare ici. Rien n'est écrit.
//
// ⚠️ LA SÉMANTIQUE SUIT `plainto_tsquery` : TOUS les mots significatifs doivent apparaître
// (un ET, pas un OU). Un OU ferait remonter tout papier qui contient « de » ou « carte », et
// la liste servie au modèle ne répondrait plus à la question posée.

import type { PieceLisible } from "./lecture";

/** Les mots qui ne discriminent rien. Courte et fermée : c'est un filtre, pas un analyseur. */
const MOTS_VIDES = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou", "en", "mon", "ma",
  "mes", "ton", "ta", "tes", "son", "sa", "ses", "pour", "par", "sur", "dans", "avec", "est",
  "quel", "quelle", "quels", "quelles", "qui", "que", "quoi", "the", "of", "my",
]);

function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Les mots d'une question qui doivent tous apparaître. Un pluriel simple est ramené au
 * singulier (« passeports » → « passeport ») : sans ça, la question la plus naturelle ne
 * trouverait pas le papier dont le type est au singulier.
 */
export function motsDeLaQuestion(question: string): string[] {
  const vus = new Set<string>();
  for (const brut of normaliser(question).split(" ")) {
    if (brut.length < 2 || MOTS_VIDES.has(brut)) continue;
    vus.add(brut.length > 3 && /[sx]$/.test(brut) ? brut.slice(0, -1) : brut);
  }
  return [...vus];
}

/** Tout ce qu'un papier déchiffré DIT, à plat. Les clés des champs comptent aussi. */
function texteDeLaPiece(p: PieceLisible): string {
  const morceaux: string[] = [];
  const ajouter = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      morceaux.push(String(v));
      return;
    }
    if (Array.isArray(v)) return v.forEach(ajouter);
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        morceaux.push(k);
        ajouter(x);
      }
    }
  };
  ajouter([p.type, p.emetteur, p.titulaire, p.resume, p.domaine, p.dateDocument, p.dateEcheance, p.annee]);
  ajouter(p.champsStructures);
  ajouter(p.champsLibres);
  return normaliser(morceaux.join(" "));
}

/**
 * true si TOUS les mots significatifs de la question apparaissent dans le papier.
 * ⚠️ Une question sans mot significatif ne correspond à RIEN : « de la » ne doit pas rendre
 * tous les papiers d'identité d'un coup.
 */
export function pieceCorrespond(p: PieceLisible, question: string): boolean {
  const mots = motsDeLaQuestion(question);
  if (mots.length === 0) return false;
  const texte = ` ${texteDeLaPiece(p)} `;
  return mots.every((m) => texte.includes(m));
}

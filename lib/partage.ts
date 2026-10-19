// lib/partage.ts — ce que MemoryAI reçoit quand Android partage vers elle (Web Share Target).
//
// ⚠️ CE QUI EST VOLONTAIREMENT HORS DE PORTÉE : les FICHIERS. Partager un document dans
// MemoryAI reviendrait à lui faire ingérer un papier — c'est le travail de DriveAI, qui le
// classe, et la frontière de l'ADR-0061 passe par lui. Un second chemin d'entrée pour les
// documents créerait une seconde source de vérité, et personne ne penserait à la fermer le
// jour où on veut retirer un papier. Le manifeste ne déclare donc que `title`, `text`, `url`.
//
// ⚠️ ET LE TEXTE NE PASSE PAS PAR L'URL. Un partage porte du texte PERSONNEL ; le mettre en
// paramètre le dépose dans l'historique du navigateur, dans les journaux d'un proxy, et dans
// le `Referer` de la page suivante. Il transite par le Cache Storage, qui reste dans
// l'appareil, puis par `sessionStorage`, qui meurt avec l'onglet.
//
// ⚠️ Les constantes ci-dessous sont dupliquées dans `public/sw.js` — un service worker est un
// fichier statique, il ne peut rien importer d'ici. `tests/partage.test.ts` verrouille
// l'égalité : une divergence casserait le partage EN SILENCE (la page ne trouverait rien).

/** Nom du Cache Storage où le service worker dépose ce qui vient d'être partagé. */
export const CACHE_PARTAGE = "memoryai-partage";
/** Clé des métadonnées (titre, texte, url) dans ce cache. */
export const CLE_META = "/__partage/meta";
/** Chemin visé par la `share_target` du manifeste — donc le seul POST à intercepter. */
export const CHEMIN_PARTAGE = "/partage";
/** Où `/partage` dépose le texte pour que `/chat` le reprenne. Meurt avec l'onglet. */
export const CLE_BROUILLON_CHAT = "memoryai:brouillon-chat";

export interface RequeteInterceptable {
  method: string;
  pathname: string;
  /** `Request.mode` : « navigate » pour une navigation, autre chose pour un `fetch()`. */
  mode: string;
}

/**
 * Le service worker doit-il intercepter cette requête ?
 *
 * ⚠️ LE PIÈGE, ET IL A COÛTÉ UNE SESSION ENTIÈRE À BATCHCHEF (13/08/2026). Une Server Action
 * de Next POSTe vers l'URL de la PAGE COURANTE : depuis `/partage`, une action de cette page
 * poste donc elle aussi vers `/partage`. Un worker qui se contente de tester « POST + bon
 * chemin » l'avale et répond une redirection 303 à la place du résultat — le navigateur
 * affiche « An unexpected response was received from the server », rien n'atteint le serveur,
 * et les journaux sont VIDES puisque la réponse a été fabriquée dans le téléphone.
 *
 * Le discriminant est `mode` : le POST d'un Web Share Target est une NAVIGATION (spécification
 * Web Share Target), alors qu'une Server Action passe par `fetch()`. C'est une propriété
 * standard, pas un détail interne de Next.
 */
export function doitIntercepterPartage(requete: RequeteInterceptable): boolean {
  if (requete.method.toUpperCase() !== "POST") return false;
  if (requete.pathname !== CHEMIN_PARTAGE) return false;
  return requete.mode === "navigate";
}

export interface PartageRecu {
  titre?: string | null;
  texte?: string | null;
  url?: string | null;
}

export interface PartageNormalise {
  /** Lien http(s) trouvé, sinon null. */
  lien: string | null;
  /** Texte partagé, débarrassé du lien quand celui-ci y était noyé. */
  description: string;
}

const MOTIF_URL = /https?:\/\/[^\s]+/i;
/** Un partage n'est pas un document : on en garde de quoi poser une question, pas un corpus. */
export const LONGUEUR_MAX_PARTAGE = 4000;

function urlHttp(valeur: string | null | undefined): string | null {
  const brut = (valeur ?? "").trim();
  if (!brut) return null;
  try {
    const parsed = new URL(brut);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function joindre(titre: string, texte: string): string {
  if (!titre) return texte;
  if (!texte) return titre;
  if (texte.includes(titre)) return texte;
  return `${titre}\n${texte}`;
}

/**
 * Démêle un partage Android en { lien, description }. Les trois champs (`title`, `text`,
 * `url`) sont remplis DIFFÉREMMENT selon l'app source — certaines mettent tout dans `text`,
 * d'autres n'envoient qu'un titre. On ne jette jamais de texte : on en sort le lien.
 */
export function normaliserPartage(recu: PartageRecu): PartageNormalise {
  const texte = (recu.texte ?? "").trim();
  const titre = (recu.titre ?? "").trim();

  const lienDedie = urlHttp(recu.url);
  if (lienDedie) return { lien: lienDedie, description: joindre(titre, texte) };

  const trouve = texte.match(MOTIF_URL);
  const lienTexte = trouve ? urlHttp(trouve[0]) : null;
  if (lienTexte && trouve) {
    const i = trouve.index ?? 0;
    const reste = (texte.slice(0, i) + texte.slice(i + trouve[0].length)).trim();
    return { lien: lienTexte, description: joindre(titre, reste) };
  }
  return { lien: null, description: joindre(titre, texte) };
}

/**
 * Le brouillon que `/partage` dépose pour `/chat`. Borné, et le lien est REMIS à la fin :
 * le chat doit le voir, et le texte seul l'aurait perdu.
 */
export function brouillonDepuisPartage(p: PartageNormalise): string {
  const morceaux = [p.description.trim(), p.lien ?? ""].filter(Boolean);
  return morceaux.join("\n").slice(0, LONGUEUR_MAX_PARTAGE);
}

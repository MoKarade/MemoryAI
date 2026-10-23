// lib/sauvetage/extraire.ts — relire le CLAIR dans les pages de l'ancien déploiement (ADR 0019 §2).
//
// Le déploiement de 12:37Z est le seul qui déchiffre encore les scellés `v1`. Il n'a aucune route
// qui rende un fait ou un papier en JSON au propriétaire : ce qu'il sait, il l'écrit dans deux
// pages, `/fait/[id]` et `/pieces/[id]`. Ce module lit ce HTML-là, et rien d'autre.
//
// ── POURQUOI DES EXPRESSIONS ET PAS UN ANALYSEUR HTML ────────────────────────────────────
// Les deux pages sont rendues par React côté serveur, dont la sortie est très régulière : chaque
// texte et chaque attribut est ÉCHAPPÉ (`&`, `<`, `>`, `"`, `'`), donc aucun `<` ne figure jamais
// dans une valeur. `[^<]*` capture une valeur entière sans pouvoir déborder sur la balise
// suivante. Le seul intrus est `<!-- -->`, que React pose entre deux textes voisins.
//
// ⚠️ CE QUI EST LU EST UNE DONNÉE, PAS UNE PREUVE. Ce module ne décide pas qu'un clair est le
// bon : il le PROPOSE. C'est `reconstruire.ts` qui le confronte à la longueur du scellé `v1`, et
// qui refuse ce qui ne tombe pas juste.
//
// ⚠️ « — » n'est JAMAIS une valeur. Les pages l'écrivent pour « rien » ; le prendre pour un clair
// ferait passer un type de 3 octets pour sauvé (« — » fait 3 octets en UTF-8).
//
// Module PUR : du texte entre, des chaînes sortent. Rien n'est écrit, rien n'est journalisé.

/** Ce que les pages écrivent pour « pas de valeur ». */
const RIEN = "—";

const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Défait l'échappement de React (et toute entité numérique). Une entité inconnue reste telle quelle. */
export function decoderHtml(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (tout, nom: string) => {
    if (nom[0] === "#") {
      const code = nom[1] === "x" || nom[1] === "X" ? parseInt(nom.slice(2), 16) : parseInt(nom.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : tout;
    }
    return ENTITES[nom.toLowerCase()] ?? tout;
  });
}

/** Le texte d'un nœud tel que React l'a rendu : séparateurs retirés, entités défaites. */
function texteDe(brut: string): string {
  return decoderHtml(brut.replace(/<!-- -->/g, ""));
}

/** Un texte rendu, sans balise : des caractères qui ne sont pas `<`, ou des séparateurs React. */
const TEXTE = "((?:[^<]|<!-- -->)*)";

/**
 * Les paires `<dt>clé</dt><dd>valeur</dd>` d'un fragment, dans l'ordre de la page. Une paire dont
 * le `<dd>` porte une balise (un lien, du code) n'est pas une valeur nue : elle est sautée.
 */
export function pairesDl(fragment: string): [string, string][] {
  const out: [string, string][] = [];
  const motif = new RegExp(`<dt>${TEXTE}</dt><dd>${TEXTE}</dd>`, "g");
  for (const m of fragment.matchAll(motif)) out.push([texteDe(m[1] ?? ""), texteDe(m[2] ?? "")]);
  return out;
}

/**
 * La page sans ses `<script>`. Next.js y glisse la charge RSC, qui REDIT les mêmes textes sous une
 * autre forme (« D’où ça vient » y figure aussi) : un repère trouvé là ferait lire au mauvais
 * endroit. On ne lit que le HTML rendu.
 */
function sansScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/** Le premier `<dl class="attributs">…</dl>` qui suit `repere` (inclus), ou `null`. */
function dlApres(html: string, repere: string): string | null {
  const debut = html.indexOf(repere);
  if (debut < 0) return null;
  const ouverture = html.indexOf('<dl class="attributs">', debut);
  if (ouverture < 0) return null;
  const fin = html.indexOf("</dl>", ouverture);
  return fin < 0 ? null : html.slice(ouverture, fin);
}

/** La valeur de l'attribut `nom` dans une balise ouvrante, décodée. */
function attribut(balise: string, nom: string): string | null {
  const m = new RegExp(`\\s${nom}="([^"]*)"`).exec(balise);
  return m ? decoderHtml(m[1] ?? "") : null;
}

/** Un texte de page qui veut dire « rien » devient `null`. */
function valeurOuRien(v: string | undefined): string | null {
  return v === undefined || v === RIEN ? null : v;
}

/** Le `fileId` d'un lien `https://drive.google.com/file/d/<id>/view` (`lienDrive`), sinon `null`. */
export function fileIdDuLien(lien: string): string | null {
  const m = /^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)\/view$/.exec(lien);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? "");
  } catch {
    // Un `%` orphelin : ce n'est pas un lien que `lienDrive` a produit, donc pas un fileId.
    return null;
  }
}

// ── /fait/[id] ─────────────────────────────────────────────────────────────────────────────

export interface ClairFait {
  /** La valeur du champ « Corriger » (absent pour un `ref_document`). */
  valeur: string | null;
  /** Le fileId du bouton « Ouvrir le document » (seulement pour un `ref_document`). */
  refDocument: string | null;
  /** Les paires de « D’où ça vient », dans l'ordre de la page — rangement compris. */
  paires: [string, string][];
}

/**
 * Lit une page `/fait/[id]`. `null` si ce n'est pas la page de CE fait : une page de connexion,
 * une erreur, ou un autre fait. L'identifiant est écrit en bas de la fiche (`<code>{id}</code>`).
 */
export function extraireFait(page: string, id: string): ClairFait | null {
  const html = sansScripts(page);
  if (!html.includes(`<code>${id}</code>`)) return null;

  const input = /<input[^>]*\sid="correction-valeur"[^>]*>/.exec(html)?.[0];
  const valeur = input ? attribut(input, "value") : null;

  // Le bouton de la carte, pas celui de la page (« Ouvrir le document d’où ça vient ») : c'est
  // le TEXTE du lien qui les distingue, l'un pointant le fait, l'autre sa source.
  let refDocument: string | null = null;
  for (const m of html.matchAll(/<a([^>]*)>Ouvrir le document<\/a>/g)) {
    const href = attribut(m[1] ?? "", "href");
    refDocument = href ? fileIdDuLien(href) : null;
    if (refDocument) break;
  }

  const dl = dlApres(html, "D’où ça vient");
  return { valeur, refDocument, paires: dl ? pairesDl(dl) : [] };
}

// ── /pieces/[id] ───────────────────────────────────────────────────────────────────────────

export interface ClairPiece {
  /** Vrai quand la page rend le SOMMAIRE d'un N3 : rien n'y est un clair. */
  sommaire: boolean;
  type: string | null;
  emetteur: string | null;
  /** Tel qu'à l'écran, certitude comprise (« X (certitude 80 %) ») : `reconstruire` la retire. */
  titulaireAffiche: string | null;
  /** « Rangé dans » : le chemin de l'exemplaire principal, ou à défaut le DOMAINE. */
  rangeDans: string | null;
  /** Lien Drive → texte, pour chaque exemplaire listé (seulement quand il y en a plusieurs). */
  exemplaires: Map<string, string>;
  resume: string | null;
  champsStructures: [string, string][];
  champsLibres: [string, string][];
}

/** Lit une page `/pieces/[id]`. `null` si ce n'est pas la page de CE papier (formulaire de retrait). */
export function extrairePiece(page: string, id: string): ClairPiece | null {
  const html = sansScripts(page);
  if (!html.includes(`<input type="hidden" name="id" value="${id}"`)) return null;

  const sommaire = /<h1>Contenu protégé \(niveau 3\)<\/h1>/.test(html);
  const quoi = new Map(pairesDl(dlApres(html, 'id="quoi"') ?? ""));
  const arrive = new Map(pairesDl(dlApres(html, 'id="arrive"') ?? ""));

  const exemplaires = new Map<string, string>();
  const liste = /<ul class="liste-simple">([\s\S]*?)<\/ul>/.exec(html.slice(html.indexOf('id="arrive"')))?.[1] ?? "";
  for (const m of liste.matchAll(new RegExp(`<a([^>]*)>${TEXTE}</a>`, "g"))) {
    const href = attribut(m[1] ?? "", "href");
    if (href) exemplaires.set(href, texteDe(m[2] ?? ""));
  }

  // Le résumé est le `<p>` NU qui suit le titre « Ce qui a été retenu » ; sans résumé, c'est un
  // `<p class="hint">`, que le motif n'attrape pas.
  const resume = new RegExp(`id="retenu">[^<]*</h2><p>${TEXTE}</p>`).exec(html)?.[1];

  const champsStructures = pairesDl(dlApres(html, "<h3>Champs relevés</h3>") ?? "");
  const champsLibres = pairesDl(dlApres(html, "<h3>Autres informations du document</h3>") ?? "");

  return {
    sommaire,
    type: valeurOuRien(quoi.get("Type")),
    emetteur: valeurOuRien(quoi.get("Émetteur")),
    titulaireAffiche: valeurOuRien(quoi.get("Au nom de")),
    rangeDans: valeurOuRien(arrive.get("Rangé dans")),
    exemplaires,
    resume: resume === undefined ? null : texteDe(resume),
    champsStructures,
    champsLibres,
  };
}

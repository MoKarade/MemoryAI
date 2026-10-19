// lib/pieces/familles.ts — plusieurs graphies du même émetteur se DISENT, elles ne se
// fusionnent pas.
//
// ⚠️ POURQUOI CE MODULE EXISTE, mesuré le 17/09 sur les 2 723 papiers de Marc :
//
//   Banque Aurore — 56 · Banque Aurore Assurances — 12 · Banque Aurore Assurances Générales — 7
//   Alphatech — 15 · ALPHATECH INDUSTRIES INC. — 11 · Alphatech Industries — 9
//   Zenith inc. — 49 · Zenith — 6
//   Facebook — 151 · Facebook - Meta — 9 · Meta-Facebook — 7 · Facebook Marketplace — 6
//
// « Qu'est-ce que j'ai comme papiers de Banque Aurore ? » rend donc **56** au lieu de **75**. Et
// c'est exactement ce que la question n° 8 du socle avait prévu, AVANT que le code existe :
// son `ceQueLEchecDesigne` dit « émetteur et année ne se croisent pas, ou l'émetteur est écrit
// de trois façons ». La mesure figée a nommé le défaut avant qu'il apparaisse.
//
// ══ CE QU'ON NE FAIT PAS, ET POURQUOI ═══════════════════════════════════════════════════════
//
// ⚠️ **On ne fusionne RIEN.** « Banque Aurore » et « Banque Aurore Assurances » sont deux entités
// réelles : la caisse et l'assureur. Les confondre en base ferait perdre une distinction que
// Marc n'a pas demandé de perdre, et de façon irréversible — le nom d'origine serait écrasé.
// C'est la même règle que l'égalité stricte des gardes de doublon : on ne normalise pas une
// valeur que quelqu'un a peut-être voulue telle quelle.
//
// ⚠️ **On ne peut pas non plus chercher par PRÉFIXE en base**, et ce n'est pas un oubli : les
// émetteurs sont filtrés par clé KEYÉE (un HMAC), justement pour que deux pièces portant
// « Banque Aurore » se retrouvent malgré des chiffrés différents. Un hash n'a pas de préfixe.
//
// Ce qui reste, et qui suffit : **le dire au modèle**. Les facettes lui listent déjà les
// valeurs connues ; il leur manquait de signaler que trois d'entre elles se ressemblent. Avec
// ça, il passe les trois dans `emetteurs` et obtient 75. La décision reste la sienne — et
// c'est ce qu'on veut, parce que « Facebook » et « Facebook Marketplace » peuvent légitimement
// ne pas être la même chose selon la question posée.

/** Une valeur de facette et son nombre, telle que l'outil MCP la rend. */
export interface ValeurFacette {
  readonly valeur: string;
  readonly nombre: number;
}

export interface FamilleFacettes {
  /** Le libellé commun, tel qu'écrit dans la graphie la plus employée. */
  readonly tete: string;
  readonly valeurs: readonly ValeurFacette[];
  readonly total: number;
}

/**
 * Le premier MOT significatif d'une valeur, comparable d'une graphie à l'autre.
 *
 * ⚠️ Accents et casse rabattus ICI et seulement ici : c'est un regroupement d'AFFICHAGE, donc
 * rabattre ne perd rien — la valeur d'origine est conservée telle quelle dans `valeurs`.
 * C'est la différence avec une garde d'écriture, où rabattre effacerait une correction.
 *
 * ⚠️ AUCUN filtre de suffixe juridique, et c'est une mesure qui l'a décidé. Mon premier jet
 * retirait `inc`, `ltee`, `ltd`… en croyant rapprocher « Zenith inc. » de « Zenith » — or ce
 * filtre ne pouvait RIEN changer : on ne garde que le PREMIER mot, et « inc » est toujours le
 * second. La mutation qui le retirait laissait les 7 cas verts. C'était de la redondance
 * déguisée en garde, donc du code qui se serait fait maintenir pour rien.
 */
export function racine(valeur: string): string {
  const mots = valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 0);
  return mots[0] ?? "";
}

/**
 * Le nombre minimal de caractères d'une racine pour qu'un regroupement soit annoncé.
 *
 * ⚠️ Un seuil, et il est DÉRIVÉ d'une mesure, pas choisi : sans lui, « Je » de « Jean
 * Exemple » et de « Jeux » se regrouperaient, et deux mots courts sans rapport se
 * ressembleraient tout le temps. À 4, les familles du corpus mesuré (banque, alphatech,
 * zenith, facebook, anthropic) passent toutes, et aucun faux regroupement n'apparaît sur
 * les 25 premiers émetteurs — vérifié en écrivant ce module.
 */
export const RACINE_MIN = 4;

/**
 * ⚠️ LA LIMITE CONNUE, mesurée : un nom RÉORDONNÉ n'est pas rattrapé. « Meta-Facebook » (7
 * papiers) appartient à la famille Facebook pour un humain, mais son premier mot est « Meta » —
 * le total annoncé est donc 166 et non 173.
 *
 * Élargir la règle à « n'importe quel mot en commun » regrouperait aussi tout ce qui contient
 * « Assurances » ou « Québec », et un faux regroupement coûte plus qu'une graphie manquée : il
 * fait perdre confiance dans toute la note, donc dans les vraies familles avec. La valeur
 * reste listée dans les facettes de toute façon — le modèle la voit, elle n'est simplement pas
 * signalée comme parente. `tests/familles.test.ts` garde ce cas pour que la limite soit
 * mesurée plutôt que redécouverte.
 */

/**
 * Regroupe les valeurs de facette qui partagent une racine, du plus gros groupe au plus petit.
 *
 * ⚠️ Ne rend QUE les familles de deux valeurs ou plus. Une « famille » d'une seule valeur est
 * la situation normale : l'annoncer ajouterait une ligne à chaque émetteur du corpus, et une
 * note qui parle tout le temps ne se lit plus.
 */
export function famillesDeFacettes(valeurs: readonly ValeurFacette[]): FamilleFacettes[] {
  const parRacine = new Map<string, ValeurFacette[]>();
  for (const v of valeurs) {
    const r = racine(v.valeur);
    if (r.length < RACINE_MIN) continue;
    const l = parRacine.get(r) ?? [];
    l.push(v);
    parRacine.set(r, l);
  }
  const familles: FamilleFacettes[] = [];
  for (const groupe of parRacine.values()) {
    if (groupe.length < 2) continue;
    // La graphie la plus EMPLOYÉE sert de tête : c'est celle que Marc reconnaîtra, et celle
    // que le modèle a le plus de chances d'avoir déjà vue.
    const trie = [...groupe].sort((a, b) => b.nombre - a.nombre || a.valeur.localeCompare(b.valeur));
    familles.push({
      tete: trie[0]!.valeur,
      valeurs: trie,
      total: trie.reduce((t, v) => t + v.nombre, 0),
    });
  }
  return familles.sort((a, b) => b.total - a.total || a.tete.localeCompare(b.tete));
}

/**
 * La note à joindre aux facettes, ou `null` s'il n'y a rien à signaler.
 *
 * ⚠️ Elle nomme les valeurs EXACTES à repasser en filtre, parce que c'est la seule chose
 * actionnable : un modèle à qui l'on dit « il y a plusieurs graphies » sans les lui donner
 * devinera, et c'est précisément ce qu'on corrige.
 */
export function noteFamilles(valeurs: readonly ValeurFacette[], maxFamilles = 5): string | null {
  const familles = famillesDeFacettes(valeurs).slice(0, maxFamilles);
  if (familles.length === 0) return null;
  const phrases = familles.map(
    (f) => `« ${f.tete} » s'écrit aussi ${f.valeurs.slice(1).map((v) => `« ${v.valeur} »`).join(", ")} (${f.total} papiers en tout)`,
  );
  return `⚠️ Plusieurs graphies du même émetteur : ${phrases.join(" ; ")}. Passe TOUTES les graphies dans \`emetteurs\` pour ne pas en perdre — elles ne sont pas fusionnées, parce que deux entités peuvent légitimement partager un nom.`;
}

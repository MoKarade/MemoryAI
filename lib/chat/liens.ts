// lib/chat/liens.ts — [L25] la QUASI-CERTITUDE, garantie par du code et non par le prompt.
//
// Marc, le 17/09 : « je veux une quasi certitude sur ce qu'elle dit sur moi avec forcément
// des liens à chaque fois ». Un prompt qui dit « cite toujours » est respecté 95 % du temps.
// « Forcément » veut dire que les 5 % restants sont rattrapés par du CODE.
//
// Ce module est PUR et DÉTERMINISTE. Il tourne APRÈS la réponse du modèle, côté serveur, au
// moment où l'on connaît la liste EXACTE des faits que les outils ont servis pendant ce tour
// (ADR 0005 §3 A1.3). Il fait trois choses, dans cet ordre :
//
//   1. toute citation `[→/fait/<id>]` dont l'`id` n'a PAS été servi devient « (non sourcé) » —
//      le modèle a inventé une référence, et c'est le cas le plus grave ;
//   2. toute valeur servie qui apparaît dans la réponse sans son lien se voit AJOUTER le lien ;
//   3. un fait `propose` reçoit « (à confirmer) » à côté de son lien.
//
// ⚠️ Le point 3 est une DÉCISION DE MARC du 17/09, contre ma recommandation (ADR 0005 §9).
// Je proposais de ne pas servir les faits non validés ; il a choisi de les servir marqués. Ce
// que ça coûte, dit une fois : une déduction de modèle non relue peut apparaître dans une
// réponse — marquée. La marque EST la garde, et `tests/liensCites.test.ts` vérifie qu'elle ne
// peut pas manquer.
//
// ── CE QUE CE MODULE NE PEUT PAS FAIRE, dit franchement ────────────────────────────────────
//
// Une affirmation qui n'emploie AUCUNE valeur servie — une déduction, une reformulation, une
// synthèse — n'a rien à quoi être reliée. Le code ne peut pas la relier, et prétendre le
// contraire serait pire que la limite : `annoterReponse` ne la touche pas, et c'est le PROMPT
// qui demande au modèle de la marquer « (déduit) ». La différence est nette et vaut d'être
// tenue : les points 1 à 3 sont GARANTIS par le code, le « (déduit) » est DEMANDÉ au modèle.
//
// Et un modèle qui PARAPHRASE une valeur (« la fin de son bail » pour `2028-05-31`) ne
// déclenche aucun appariement. C'est la limite structurelle d'un appariement textuel : elle
// est visible plutôt que cachée, parce qu'une affirmation sans lien se voit à l'écran.

/** Un fait tel qu'un outil l'a SERVI pendant ce tour. Le minimum pour relier et marquer. */
export interface FaitServi {
  id: string;
  /**
   * CE QU'ON CHERCHE DANS LA RÉPONSE — et ce n'est pas toujours la valeur.
   *
   * ⚠️⚠️ Marc, le 18/09 : « j'ai pas les liens pour les documents ». Mesuré sur sa base : un
   * fait `type="ref_document"` a pour VALEUR un fileId Drive opaque
   * (`1FICTIFexemple0000000000000000000`), que le modèle n'écrit jamais. L'appariement par
   * valeur ne pouvait donc PAS tirer pour un document — et les documents sont la majorité de
   * sa donnée (2 729 papiers). Ce que le modèle écrit, c'est le LIBELLÉ : « Avis de
   * cotisation », « Passeport » — l'attribut `doc_type`.
   *
   * Donc : l'étiquette est le libellé du document quand il y en a un, la valeur sinon.
   * **Apparier sur ce que le modèle ÉCRIT, jamais sur ce que la base STOCKE.**
   */
  etiquette: string;
  statut: string;
  /**
   * Le lien Drive, quand le fait pointe un document. C'est ce que Marc veut ATTEINDRE : la
   * fiche dit ce que la mémoire sait, le lien ouvre le papier. Les deux sont offerts, parce
   * que « où est mon avis de cotisation » attend un document, pas une fiche.
   */
  lien: string | null;
}

/**
 * Un PAPIER tel qu'un outil l'a servi pendant ce tour (`memoryai_papiers_chercher`).
 *
 * ⚠️ Né le 24/09 d'un défaut vu par Marc : le chat a trouvé son passeport, l'a cité — et le
 * code a remplacé la citation par « (non sourcé) », parce que les outils de papiers ne
 * déclaraient RIEN comme servi. La réponse la plus sûre qu'il puisse donner, tirée de la photo
 * du document, était étiquetée comme une invention. Un papier servi est une source au même
 * titre qu'un fait : il se cite par sa fiche (`/pieces/<id>`) et par son lien Drive.
 *
 * ⚠️ Aucune ÉTIQUETTE ici, volontairement : un papier n'est pas relié par appariement de texte
 * (passe 2). « Passeport » désigne le tien ET celui de proches — relier le mot au premier
 * venu donnerait à une phrase la source d'un autre papier. On ne relie que ce que le modèle
 * cite lui-même, et on vérifie qu'il l'a bien reçu.
 */
export interface PieceServie {
  id: string;
  /** Le lien Drive de l'exemplaire principal — celui que la balise `<piece>` a montré. */
  lien: string | null;
  /**
   * BACKLOG (revue #72) : un papier N3 fermé est servi en SOMMAIRE (domaine, année, dates —
   * `lib/pieces/lecture.ts`, `sortDeLaPiece`), SANS type, émetteur ni résumé. Une citation qui
   * s'appuie dessus ne peut vouloir dire « ce détail vient de ce papier » : le sommaire ne le
   * contient pas. `"complete"` obligatoire plutôt qu'un défaut implicite — un appelant qui
   * oublie de le dire ne compile pas, au lieu de servir un sommaire pris pour du contenu.
   */
  forme: "complete" | "sommaire";
}

export interface Annotation {
  texte: string;
  /** Combien de valeurs servies ont reçu leur lien (ajouté par le code, pas par le modèle). */
  liensAjoutes: number;
  /** Combien de liens le modèle avait déjà posés correctement. */
  liensDejaPresents: number;
  /** Combien de citations inventées ont été remplacées par « (non sourcé) ». */
  refsInconnus: number;
  /** Combien de faits `propose` ont reçu leur « (à confirmer) ». */
  marquesAConfirmer: number;
  /** Combien de citations de papier ont reçu leur « (sommaire) » — BACKLOG, revue #72. */
  marquesSommaire: number;
  /** Les valeurs servies qui n'apparaissent pas du tout dans la réponse — ni reliées, ni citées. */
  valeursNonEmployees: number;
}

/**
 * La forme d'une citation. COURTE et STABLE : le client la reconnaît pour en faire un lien.
 * Deux cibles : la fiche d'un FAIT (`/fait/<id>`) et celle d'un PAPIER (`/pieces/<id>`).
 */
const MOTIF_CITATION = /\[→(\/(fait|pieces)\/([0-9a-fA-F-]{36}))\]/g;

/**
 * La citation d'un DOCUMENT par son lien Drive, en clair dans le marqueur.
 * Validé comme les autres : un lien que rien n'a servi est retiré.
 */
const MOTIF_DOC = /\[↗(https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view)\]/g;

/**
 * ⚠️ EN DESSOUS DE CETTE LONGUEUR, ON NE RELIE PAS — et ce seuil est un arbitrage, pas un
 * détail. Une valeur de trois caractères (« oui », « QC », un chiffre) apparaît dans de la
 * prose française par accident, et un lien FAUX est bien pire qu'un lien absent : il donne à
 * une phrase l'autorité d'une source qui ne dit pas ça.
 *
 * Mesuré sur les 27 faits N0/N1 réellement servis le 18/09 : la valeur la plus courte fait
 * **6 caractères** (« Musées », « Québec »), la médiane dépasse 30. Le seuil de 4 n'écarte donc
 * AUCUN fait réel aujourd'hui — il est là pour le jour où un prédicat à valeur courte entre au
 * vocabulaire (`preference.langue` pourrait porter « fr »).
 */
const LONGUEUR_MIN_APPARIEMENT = 4;

/** Combien de caractères après la valeur on regarde pour voir si son lien y est déjà. */
const FENETRE_LIEN_DEJA_LA = 64;

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Un appariement de MOT, pas de sous-chaîne. Sans les deux bornes, la valeur « Québec »
 * s'apparierait dans « Québecois » et le lien pointerait une affirmation voisine mais fausse.
 * `\b` de JavaScript est ASCII (leçon connue de l'écosystème : `/\bclé\b/` ne matche jamais),
 * donc les bornes sont écrites en classes Unicode explicites.
 */
function motifValeur(valeur: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${echapperRegex(valeur)}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * La citation d'un fait : la FICHE toujours, le DOCUMENT en plus quand il y en a un.
 *
 * ⚠️ Deux liens et non un, parce que les deux répondent à des questions différentes :
 * la fiche dit ce que la mémoire sait et d'où ça vient, le lien ouvre le papier. « Où
 * est mon avis de cotisation » attend le second. Renvoyer à la fiche seule ferait payer
 * un clic de plus pour la réponse que Marc a demandée.
 */
function citation(id: string, statut: string, lien: string | null): string {
  const marque = statut === "propose" ? " (à confirmer)" : "";
  const doc = lien ? ` [↗${lien}]` : "";
  return ` [→/fait/${id}]${doc}${marque}`;
}

/**
 * Annote la réponse du modèle avec les liens de ce qu'il a RÉELLEMENT reçu.
 *
 * L'ordre des trois passes n'est pas indifférent : les citations inventées sont neutralisées
 * AVANT d'ajouter les vraies, sinon une valeur suivie d'un `ref` faux compterait comme « déjà
 * reliée » et garderait sa fausse source.
 */
export function annoterReponse(
  texte: string,
  servis: readonly FaitServi[],
  piecesServies: readonly PieceServie[] = [],
): Annotation {
  const a: Annotation = {
    texte,
    liensAjoutes: 0,
    liensDejaPresents: 0,
    refsInconnus: 0,
    marquesAConfirmer: 0,
    marquesSommaire: 0,
    valeursNonEmployees: 0,
  };
  if (!texte) {
    a.valeursNonEmployees = servis.length;
    return a;
  }

  const refsServis = new Set(servis.map((f) => `/fait/${f.id}`));
  const piecesParId = new Set(piecesServies.map((x) => x.id));
  // BACKLOG (revue #72) : un papier servi en SOMMAIRE n'a ni type, ni émetteur, ni résumé —
  // une citation qui s'appuie dessus ne peut pas vouloir dire « ce détail vient de ce
  // papier ». `formeParId` porte cette distinction jusqu'à la marque posée sur la citation.
  const formeParId = new Map(piecesServies.map((x) => [x.id, x.forme]));
  // Le lien Drive de CHAQUE source servie, par identifiant : un `[↗…]` qui suit une citation
  // doit être le lien de CETTE source-là (voir la passe 1 bis).
  const lienParId = new Map<string, string | null>([
    ...servis.map((f): [string, string | null] => [f.id, f.lien]),
    ...piecesServies.map((x): [string, string | null] => [x.id, x.lien]),
  ]);
  // Les liens RÉELLEMENT servis. Un lien Drive inventé par le modèle est une source
  // fabriquée exactement comme un id inventé — et plus dangereux, parce qu'un lien a
  // l'air cliquable et vérifiable.
  const liensServis = new Set(
    [...servis.map((f) => f.lien), ...piecesServies.map((x) => x.lien)].filter((x): x is string => !!x),
  );

  // ── Passe 1 : les citations INVENTÉES ────────────────────────────────────────────────────
  // Un modèle qui cite un identifiant qu'aucun outil ne lui a donné a fabriqué une source.
  // On ne le corrige pas silencieusement : on retire le lien et on le DIT.
  a.texte = a.texte.replace(MOTIF_CITATION, (entier, ref: string, cible: string, id: string) => {
    // Revue #72 (BACKLOG) : un id en MAJUSCULES (le modèle n'est pas tenu à la casse d'un
    // UUID) doit être reconnu comme la MÊME source, pas glisser entre les mailles — ni
    // validé ni retiré, un texte qui ressemble à un lien sans en être un est pire qu'une
    // citation absente. On compare en minuscules et on RÉÉCRIT dans la casse canonique
    // (celle que la base sert), pour que le lien rendu pointe une fiche qui existe (les
    // routes `/fait/[id]` et `/pieces/[id]` valident un id en minuscules).
    const idBas = id.toLowerCase();
    const refFait = `/fait/${idBas}`;
    if (cible === "fait" && refsServis.has(refFait)) {
      a.liensDejaPresents++;
      return `[→${refFait}]`;
    }
    // Symétrique du cas suivant : un FAIT cité sous la forme d'un papier est ramené à sa fiche.
    if (cible === "pieces" && refsServis.has(refFait)) {
      a.liensDejaPresents++;
      return `[→${refFait}]`;
    }
    if (piecesParId.has(idBas)) {
      a.liensDejaPresents++;
      // ⚠️ Un papier cité sous la forme d'un FAIT (`/fait/<id d'un papier>`) est RAMENÉ à sa
      // vraie fiche au lieu d'être déclaré inventé : l'identifiant a bien été servi, seul le
      // chemin est faux — et une fiche `/fait/` de cet id n'existe pas.
      if (formeParId.get(idBas) === "sommaire") {
        a.marquesSommaire++;
        return `[→/pieces/${idBas}] (sommaire)`;
      }
      return `[→/pieces/${idBas}]`;
    }
    a.refsInconnus++;
    return " (non sourcé)";
  });

  // ⚠️ Revue #72 (sonde exécutée) : un lien servi n'est pas une source pour N'IMPORTE QUELLE
  // citation. « Ton passeport [→/pieces/P1] [↗<lien du passeport d'un proche>] » passait :
  // le lien était bien servi — mais pour un AUTRE papier. Quand un `[↗…]` suit immédiatement
  // une citation, il doit être le lien de CETTE source ; seul, il doit avoir été servi.
  a.texte = a.texte.replace(MOTIF_DOC, (entier, url: string, position: number, chaine: string) => {
    const suit = /\[→\/(?:fait|pieces)\/([0-9a-f-]{36})\]\s*$/.exec(chaine.slice(0, position));
    if (suit) {
      if (lienParId.get(suit[1]!) === url) {
        a.liensDejaPresents++;
        return entier;
      }
      a.refsInconnus++;
      return " (non sourcé)";
    }
    if (liensServis.has(url)) {
      a.liensDejaPresents++;
      return entier;
    }
    a.refsInconnus++;
    return " (non sourcé)";
  });

  // ── Passe 2 : relier les étiquettes servies ──────────────────────────────────────────────
  // Une valeur AMBIGUË — deux faits qui portent la même valeur, par exemple deux « Québec » —
  // reçoit TOUS ses liens, et la fiche dira lesquels (ADR 0005 §7, risque n° 1). Choisir
  // arbitrairement l'un des deux serait une affirmation que rien ne soutient.
  const parValeur = new Map<string, FaitServi[]>();
  for (const f of servis) {
    if (!f.etiquette || f.etiquette.length < LONGUEUR_MIN_APPARIEMENT) continue;
    const cle = f.etiquette.toLowerCase();
    const liste = parValeur.get(cle);
    if (liste) liste.push(f);
    else parValeur.set(cle, [f]);
  }

  // Les valeurs les plus LONGUES d'abord. Ce tri est NÉCESSAIRE mais PAS SUFFISANT : il
  // garantit que la longue est vue avant la courte, donc qu'elle peut réserver sa zone — mais
  // c'est le registre des zones prises, juste en dessous, qui empêche la courte d'aller
  // s'insérer dedans. Les deux vont ensemble ; le tri seul laissait le défaut.
  const groupes = [...parValeur.values()].sort((x, y) => y[0]!.etiquette.length - x[0]!.etiquette.length);

  // ⚠️⚠️ LES ZONES DÉJÀ CONSOMMÉES, et pourquoi le tri par longueur ne suffisait pas.
  // Trier les valeurs de la plus longue à la plus courte empêche la longue d'être COUPÉE en
  // deux ; ça ne l'empêche pas d'être POLLUÉE. Mesuré par `tests/liensCites.test.ts` : avec
  // « America/Toronto (heure du Québec) » et « Québec » servis ensemble, la courte s'appariait
  // À L'INTÉRIEUR de la longue et glissait son lien avant la parenthèse fermante — le texte
  // d'une valeur servie se retrouvait coupé par le lien d'une AUTRE.
  //
  // Une valeur déjà couverte par une plus longue n'est donc pas « employée » à son compte : on
  // cherche sa première occurrence LIBRE, et faute d'occurrence libre elle est comptée non
  // employée. C'est le test qui a trouvé ce défaut, pas la relecture.
  const pris: [number, number][] = [];
  const chevauche = (debut: number, fin: number) => pris.some(([d, f]) => debut < f && d < fin);

  // ⚠️ Les insertions sont COLLECTÉES puis appliquées, jamais posées au fil de l'eau : chaque
  // insertion décale tout ce qui suit, et le décalage se cumulerait sur les positions déjà
  // calculées. On les applique de la FIN vers le DÉBUT, ce qui rend le décalage impossible.
  const insertions: { position: number; texte: string }[] = [];

  for (const groupe of groupes) {
    const valeur = groupe[0]!.etiquette;
    let place: { debut: number; fin: number } | null = null;
    for (const m of a.texte.matchAll(motifValeur(valeur))) {
      if (m.index === undefined) continue;
      const debut = m.index;
      const fin = debut + m[0].length;
      if (chevauche(debut, fin)) continue;
      place = { debut, fin };
      break;
    }
    if (!place) {
      a.valeursNonEmployees += groupe.length;
      continue;
    }
    pris.push([place.debut, place.fin]);

    // Déjà suivie de SA citation ? Alors le modèle a bien fait son travail : on n'en ajoute
    // pas une seconde. C'est aussi ce qui rend la fonction sûre à rejouer.
    const suite = a.texte.slice(place.fin, place.fin + FENETRE_LIEN_DEJA_LA);
    const aRelier = groupe.filter((f) => !suite.includes(`/fait/${f.id}`));
    if (aRelier.length === 0) continue;

    insertions.push({ position: place.fin, texte: aRelier.map((f) => citation(f.id, f.statut, f.lien)).join("") });
    a.liensAjoutes += aRelier.length;
    a.marquesAConfirmer += aRelier.filter((f) => f.statut === "propose").length;
  }

  for (const ins of insertions.sort((x, y) => y.position - x.position)) {
    a.texte = a.texte.slice(0, ins.position) + ins.texte + a.texte.slice(ins.position);
  }

  return a;
}

/**
 * Ce que le PROMPT doit dire pour que la passe 2 ait quelque chose à rattraper, et pour que la
 * limite du module (une déduction n'est reliable à rien) soit portée par le modèle.
 *
 * ⚠️ Ces lignes appartiennent à la couche RÈGLES du prompt (ADR 0005 §3 A4) : ni Marc ni
 * l'apprentissage ne peuvent les modifier. Un test le vérifie.
 */
export const REGLES_CITATION = [
  "Chaque affirmation sur Marc cite sa source juste après, sous la forme [→/fait/<id>] — l'`id` est l'attribut `id` de la balise <fait> que l'outil t'a rendue. N'invente JAMAIS un id : une citation d'un id que tu n'as pas reçu est retirée et signalée.",
  "Une affirmation tirée d'un PAPIER (balise <piece>) cite ce papier sous la forme [→/pieces/<id>], suivie de [↗<lien>] quand la balise porte un attribut `lien`.",
  "Une affirmation qui ne vient d'aucun fait servi (une déduction, un recoupement, une impression) se termine par (déduit). Ne la présente jamais comme une donnée de la mémoire.",
  "Un fait `statut=\"propose\"` n'a pas encore été validé par Marc : sers-le, mais ne le présente pas comme acquis.",
  // BACKLOG (revue #72), garde active demandée par pole-securite (29/09) : la marque
  // « (sommaire) » posée par le code (voir plus haut) signale au lecteur qu'un détail n'est
  // pas garanti, mais ne contraint rien côté modèle — cette règle est le complément demandé.
  "Un papier cité qui reçoit la marque (sommaire) n'a montré que son domaine, son année et ses dates (échéance, document) — jamais son contenu (type, émetteur, titulaire, numéros). N'affirme jamais un détail hors de cette liste comme si tu l'avais lu sur le document : dis que le contenu n'est pas accessible ici.",
].join("\n");

// ── Le RENDU : découper l'annotation en segments ───────────────────────────────────────────
//
// ⚠️ Cette fonction existe pour que le JSX ne contienne AUCUNE expression régulière. Le
// découpage est une règle, il se teste ; un `dangerouslySetInnerHTML` sur une réponse de
// modèle serait par ailleurs exactement la porte que l'ADR 0001 ferme — le texte de la
// réponse contient de la donnée de tiers.

export type Segment =
  | { type: "document"; href: string }
  | { type: "texte"; texte: string }
  | { type: "lien"; href: string; id: string; cible: "fait" | "piece" }
  | { type: "marque"; texte: string };

/** Les marques que le code POSE (`à confirmer`, `non sourcé`, `sommaire`) et celle que le modèle pose (`déduit`). */
const MOTIF_SEGMENTS = /\[→(\/(?:fait|pieces)\/([0-9a-f-]{36}))\]|\[↗(https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view)\]|\((?:à confirmer|non sourcé|déduit|sommaire)\)/g;

/**
 * Découpe une réponse annotée en morceaux à rendre. Le texte reste du TEXTE — il n'est jamais
 * interprété comme du balisage.
 */
export function decouperAnnotation(texte: string): Segment[] {
  const segments: Segment[] = [];
  let curseur = 0;
  for (const m of texte.matchAll(MOTIF_SEGMENTS)) {
    if (m.index === undefined) continue;
    if (m.index > curseur) segments.push({ type: "texte", texte: texte.slice(curseur, m.index) });
    if (m[1] && m[2]) segments.push({ type: "lien", href: m[1], id: m[2], cible: m[1].startsWith("/pieces/") ? "piece" : "fait" });
    else if (m[3]) segments.push({ type: "document", href: m[3] });
    else segments.push({ type: "marque", texte: m[0] });
    curseur = m.index + m[0].length;
  }
  if (curseur < texte.length) segments.push({ type: "texte", texte: texte.slice(curseur) });
  return segments;
}

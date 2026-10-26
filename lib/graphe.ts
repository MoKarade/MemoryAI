// lib/graphe.ts — les liens entre faits (ADR 0002 §5.3). PURE : aucune base, aucun réseau,
// aucune horloge. On lui donne des faits et des questions, il rend des liens.
//
// ⚠️ LES NEUF RÈGLES SONT DÉTERMINISTES, ET C'EST LE POINT. Marc a tranché le 15/09 : « les
// liens se font par RÈGLES d'abord, par modèle ensuite ». Une règle est testable et
// EXPLICABLE — chaque lien porte la phrase qui dit pourquoi il existe, en clair, à l'écran.
// Un lien deviné par un modèle portera `origine: "modele"` et sera dessiné autrement : un
// graphe qui mélange ce qui est établi et ce qui est deviné n'apprend rien à personne.
//
// ⚠️ UNE RÈGLE DE LIAISON EST QUADRATIQUE PAR NATURE. Marc veut un réseau « beaucoup plus
// interconnecté, des centaines de liaisons » (24/10, tâche MemoryAI 186) : la borne des groupes
// passe de 8 à 150 faits, et deux PLAFONDS tiennent le volume à la place (par fait, puis au
// total), les liens les plus forts d'abord. Toute coupe, de groupe ou de plafond, est COMPTÉE
// et NOMMÉE (`abstentions`) : un graphe amputé en silence se présenterait comme complet.

import type { Attributs } from "./validerFait";

export const TAILLE_MAX_GROUPE = 150;
/** Au-delà, un fait garde ses liens les plus forts : des centaines, pas des milliers. */
export const LIENS_MAX_PAR_FAIT = 300;
/** Le recalcul réécrit tout par paquets de 200 : 40 000 lignes tiennent dans une action. */
export const LIENS_MAX = 40_000;
/** Deux dates à une semaine au plus sont « proches ». */
export const JOURS_PROCHES = 7;
/** Des valeurs trop courantes pour dire qu'on parle de la même chose. */
const VALEURS_BANALES = new Set(["oui", "non", "vrai", "faux", "aucun", "aucune", "inconnu", "autre"]);

/** Ce dont une règle a besoin. Volontairement plus petit que `FaitLisible`. */
export interface FaitPourGraphe {
  id: string;
  /** Le premier segment du prédicat (`emploi.employeur` devient `emploi`). */
  domaine: string;
  predicat: string;
  valeurType: string;
  /** Déchiffrée. Les règles ne comparent que des valeurs de POINTEUR et d'attribut. */
  valeur: string;
  attributs: Attributs | null;
  valideDe: string | null;
  valideA: string | null;
  remplaceId: string | null;
  /** Les `source_ref` de ses provenances (fichier Drive, empreinte de mail) : jamais affichées. */
  sources?: readonly string[];
}

/** Une question répondue peut expliquer d'où vient un fait. */
export interface QuestionPourGraphe {
  id: string;
  question: string;
  faitId: string | null;
}

export type TypeLien =
  | "meme-document"
  | "meme-periode"
  | "remplacement"
  | "meme-domaine-meme-entite"
  | "cause-declaree"
  | "meme-source"
  | "meme-valeur"
  | "meme-emetteur"
  | "dates-proches"
  /** Posé par un modèle, jamais par une règle d'ici : `lib/sensProche.ts`. */
  | "sens-proche";

export interface LienCalcule {
  faitA: string;
  faitB: string;
  cibleB: "fait" | "question";
  type: TypeLien;
  poids: number;
  regle: string;
  /** En clair, et sans jamais recopier une VALEUR de fait : rien ici n'est chiffré. */
  pourquoi: string;
}

export interface Abstention {
  /** `plafond` : des liens écartés parce qu'un fait, ou le total, avait atteint sa borne. */
  regle: TypeLien | "plafond";
  /** Ce que le groupe avait en commun, sans révéler la valeur elle-même. */
  motif: string;
  taille: number;
}

export interface ResultatGraphe {
  liens: LienCalcule[];
  abstentions: Abstention[];
}

/**
 * ⚠️ QUELLES RÈGLES SONT ORIENTÉES, ET POURQUOI ÇA COMPTE. Pour une règle SYMÉTRIQUE, la
 * paire est normalisée (`faitA < faitB`) : sans ça, la même paire entrerait deux fois selon
 * l'ordre de parcours, et l'index unique de la base ne la verrait pas passer. Pour une règle
 * ORIENTÉE, l'ordre PORTE le sens — `remplacement` va du NOUVEAU vers l'ANCIEN,
 * `cause-declaree` du fait vers la question qui l'a produit. Normaliser une paire orientée
 * l'inverserait, et le graphe dirait le contraire de ce qui s'est passé.
 */
export const REGLES_ORIENTEES: readonly TypeLien[] = ["remplacement", "cause-declaree"];

function paire(type: TypeLien, a: string, b: string): { faitA: string; faitB: string } {
  if (REGLES_ORIENTEES.includes(type)) return { faitA: a, faitB: b };
  return a < b ? { faitA: a, faitB: b } : { faitA: b, faitB: a };
}

/** Normalisation d'une valeur d'attribut : casse, accents, espaces. Jamais affichée. */
export function normaliserAttribut(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deux intervalles se chevauchent-ils ? Une borne absente signifie OUVERTE : `valideA: null`
 * veut dire « encore en cours », pas « fini aujourd'hui ». Deux faits SANS aucune date ne se
 * chevauchent pas — sinon la règle lierait toute la mémoire à elle-même.
 */
export function seChevauchent(
  a: { valideDe: string | null; valideA: string | null },
  b: { valideDe: string | null; valideA: string | null },
): boolean {
  if (a.valideDe === null && a.valideA === null) return false;
  if (b.valideDe === null && b.valideA === null) return false;
  const debutA = a.valideDe ?? "0000-01-01";
  const finA = a.valideA ?? "9999-12-31";
  const debutB = b.valideDe ?? "0000-01-01";
  const finB = b.valideA ?? "9999-12-31";
  return debutA <= finB && debutB <= finA;
}

/** Toutes les paires d'un groupe, ou RIEN si le groupe dépasse la borne (et on le dit). */
function cliqueBornee(
  ids: readonly string[],
  type: TypeLien,
  motif: string,
  faire: (a: string, b: string) => LienCalcule,
  abstentions: Abstention[],
): LienCalcule[] {
  if (ids.length < 2) return [];
  if (ids.length > TAILLE_MAX_GROUPE) {
    abstentions.push({ regle: type, motif, taille: ids.length });
    return [];
  }
  const out: LienCalcule[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      out.push(faire(ids[i] as string, ids[j] as string));
    }
  }
  return out;
}

function grouper<T>(items: readonly T[], cle: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = cle(it);
    if (k === null || k === "") continue;
    const liste = m.get(k);
    if (liste) liste.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function calculerLiens(
  faits: readonly FaitPourGraphe[],
  questions: readonly QuestionPourGraphe[] = [],
): ResultatGraphe {
  const liens: LienCalcule[] = [];
  const abstentions: Abstention[] = [];
  const connus = new Set(faits.map((f) => f.id));

  // 1. `meme-document` — deux faits qui pointent le même fichier. C'est la règle la plus
  //    sûre du lot : le pointeur est un identifiant, pas une ressemblance.
  for (const [ref, groupe] of grouper(faits, (f) => (f.valeurType === "ref_document" ? f.valeur : null))) {
    liens.push(
      ...cliqueBornee(
        groupe.map((f) => f.id),
        "meme-document",
        `${groupe.length} faits pointent le même document`,
        (a, b) => ({
          ...paire("meme-document", a, b),
          cibleB: "fait" as const,
          type: "meme-document" as const,
          poids: 1,
          regle: "meme-document",
          // `ref` est un identifiant Drive, pas un contenu : le nommer n'expose rien qu'un
          // lien Drive n'expose déjà dans `/moi`. Une VALEUR de fait, elle, ne s'écrirait
          // jamais ici — `pourquoi` n'est pas chiffré.
          pourquoi: `Les deux pointent le même document (${ref.slice(0, 12)}...).`,
        }),
        abstentions,
      ),
    );
  }

  // 2. `meme-periode` — deux faits dont les périodes se chevauchent.
  //    ⚠️ BORNÉE AUX DOMAINES DIFFÉRENTS, et ce n'est pas une optimisation : l'exemple de
  //    l'ADR est « un emploi et un logement de la même année ». Deux faits du MÊME domaine
  //    qui se chevauchent sont le cas ordinaire (trois faits sur le même emploi) — les lier
  //    n'apprendrait rien et noierait les rapprochements qui, eux, surprennent.
  const dates = faits.filter((f) => f.valideDe !== null || f.valideA !== null);
  if (dates.length > TAILLE_MAX_GROUPE * 4) {
    abstentions.push({
      regle: "meme-periode",
      motif: "trop de faits datés pour une comparaison deux à deux",
      taille: dates.length,
    });
  } else {
    for (let i = 0; i < dates.length; i++) {
      for (let j = i + 1; j < dates.length; j++) {
        const a = dates[i] as FaitPourGraphe;
        const b = dates[j] as FaitPourGraphe;
        if (a.domaine === b.domaine) continue;
        if (!seChevauchent(a, b)) continue;
        liens.push({
          ...paire("meme-periode", a.id, b.id),
          cibleB: "fait",
          type: "meme-periode",
          // Plus faible que les autres : un chevauchement est une COÏNCIDENCE de dates, pas
          // un rapport établi. Le poids le dit, et l'écran s'en sert pour trier.
          poids: 0.5,
          regle: "meme-periode",
          pourquoi: `Leurs périodes se chevauchent (${a.domaine} et ${b.domaine}).`,
        });
      }
    }
  }

  // 3. `remplacement` — ORIENTÉ, du nouveau vers l'ancien.
  for (const f of faits) {
    if (!f.remplaceId) continue;
    // Un remplacé absent de l'ensemble lu (supprimé, hors limite) ne produit pas de lien :
    // une extrémité manquante à l'écran ressemble à un défaut, pas à une information.
    if (!connus.has(f.remplaceId)) continue;
    liens.push({
      ...paire("remplacement", f.id, f.remplaceId),
      cibleB: "fait",
      type: "remplacement",
      poids: 1,
      regle: "remplacement",
      pourquoi: "Ce fait remplace l'autre : c'est la même chose a deux moments.",
    });
  }

  // 4. `meme-domaine-meme-entite` — même domaine, même valeur d'attribut normalisée.
  //    ⚠️ SEULS `emetteur` et `type` comptent. `annee` et `echeance` sont des DATES : deux
  //    documents de 2024 ne parlent pas de la même entité, et les inclure ferait de cette
  //    règle un doublon bruyant de `meme-periode`.
  for (const cle of ["emetteur", "type"] as const) {
    const groupes = grouper(faits, (f) => {
      const v = f.attributs?.[cle];
      return v ? JSON.stringify([f.domaine, normaliserAttribut(v)]) : null;
    });
    for (const [k, groupe] of groupes) {
      const domaine = (JSON.parse(k) as [string, string])[0];
      liens.push(
        ...cliqueBornee(
          groupe.map((f) => f.id),
          "meme-domaine-meme-entite",
          `${groupe.length} faits du domaine « ${domaine} » partagent le même ${cle}`,
          (a, b) => ({
            ...paire("meme-domaine-meme-entite", a, b),
            cibleB: "fait" as const,
            type: "meme-domaine-meme-entite" as const,
            poids: 0.8,
            regle: `meme-domaine-meme-entite:${cle}`,
            pourquoi: `Même domaine (${domaine}) et même ${cle}.`,
          }),
          abstentions,
        ),
      );
    }
  }

  // 5. `cause-declaree` — ORIENTÉ, du fait vers la question qui l'a produit.
  for (const q of questions) {
    if (!q.faitId || !connus.has(q.faitId)) continue;
    liens.push({
      faitA: q.faitId,
      faitB: q.id,
      cibleB: "question",
      type: "cause-declaree",
      poids: 1,
      regle: "cause-declaree",
      // La question est du texte que Marc a lu à l'écran, pas une valeur chiffrée.
      pourquoi: `Ce fait vient d'une question : « ${q.question.slice(0, 80)} »`,
    });
  }

  // 6. `meme-source` — deux faits tirés de la même source (même papier, même mail). Une
  //    provenance est un identifiant, pas une ressemblance : presque aussi sûre que la règle 1.
  const provenances = faits.flatMap((f) => [...new Set(f.sources ?? [])].map((s) => ({ id: f.id, s })));
  for (const [, groupe] of grouper(provenances, (x) => x.s)) {
    liens.push(
      ...cliqueBornee(
        groupe.map((x) => x.id),
        "meme-source",
        `${groupe.length} faits viennent de la même source`,
        (a, b) => ({
          ...paire("meme-source", a, b),
          cibleB: "fait" as const,
          type: "meme-source" as const,
          poids: 0.9,
          regle: "meme-source",
          pourquoi: "Les deux ont été tirés de la même source.",
        }),
        abstentions,
      ),
    );
  }

  // 7. `meme-valeur` — la même valeur de texte sous deux prédicats différents : une personne,
  //    un lieu, un montant qui reviennent ailleurs. ⚠️ Le `pourquoi` nomme les PRÉDICATS, jamais
  //    la valeur, qui est chiffrée en base. Même prédicat et même valeur, c'est un doublon ou un
  //    remplacement, pas une trouvaille : on ne lie pas.
  const parValeur = grouper(faits, (f) => {
    if (f.valeurType !== "texte") return null;
    const v = normaliserAttribut(f.valeur);
    return v.length >= 3 && !VALEURS_BANALES.has(v) ? v : null;
  });
  for (const groupe of parValeur.values()) {
    liens.push(
      ...pairesBornees(groupe, "meme-valeur", "faits portent la même valeur", abstentions, (a, b) =>
        a.predicat === b.predicat ? null : { poids: 0.7, pourquoi: `Même valeur sous « ${a.predicat} » et « ${b.predicat} ».` },
      ),
    );
  }

  // 8. `meme-emetteur` — le même émetteur dans deux DOMAINES différents (la règle 4 couvre le
  //    même domaine) : un même organisme dans `impots` et dans `logement` relie les deux.
  const parEmetteur = grouper(faits, (f) => (f.attributs?.emetteur ? normaliserAttribut(f.attributs.emetteur) : null));
  for (const groupe of parEmetteur.values()) {
    liens.push(
      ...pairesBornees(groupe, "meme-emetteur", "faits partagent le même émetteur", abstentions, (a, b) =>
        a.domaine === b.domaine ? null : { poids: 0.6, pourquoi: `Même émetteur (${a.domaine} et ${b.domaine}).` },
      ),
    );
  }

  // 9. `dates-proches` — deux faits de domaines différents datés à une semaine au plus. La date
  //    d'un fait est sa valeur s'il EST une date, sinon le début de sa validité. Balayage trié :
  //    on ne compare que des voisins, jamais toutes les paires.
  const dates9 = faits
    .map((f) => ({ f, t: Date.parse(`${(f.valeurType === "date" ? f.valeur : (f.valideDe ?? "")).slice(0, 10)}T00:00:00Z`) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((x, y) => x.t - y.t || (x.f.id < y.f.id ? -1 : 1));
  for (let i = 0; i < dates9.length; i++) {
    const a = dates9[i] as (typeof dates9)[number];
    for (let j = i + 1; j < dates9.length; j++) {
      const b = dates9[j] as (typeof dates9)[number];
      const jours = Math.round((b.t - a.t) / 86_400_000);
      if (jours > JOURS_PROCHES) break;
      if (a.f.domaine === b.f.domaine) continue;
      liens.push({
        ...paire("dates-proches", a.f.id, b.f.id),
        cibleB: "fait",
        type: "dates-proches",
        poids: 0.4,
        regle: "dates-proches",
        pourquoi: `Datés à ${jours} jour${jours > 1 ? "s" : ""} d'écart (${a.f.domaine} et ${b.f.domaine}).`,
      });
    }
  }

  // Dédoublonnage par (faitA, faitB, type). L'index unique de la base dit la même chose, et
  // le faire ICI évite qu'une écriture entière échoue sur un doublon qu'on pouvait voir.
  const vus = new Set<string>();
  const uniques: LienCalcule[] = [];
  for (const l of liens) {
    if (l.faitA === l.faitB) continue;
    const k = JSON.stringify([l.faitA, l.faitB, l.type]);
    if (vus.has(k)) continue;
    vus.add(k);
    uniques.push(l);
  }
  return { liens: plafonner(uniques, abstentions), abstentions };
}

/**
 * Les paires d'un groupe que `juger` retient (il rend `null` pour une paire sans intérêt), ou
 * RIEN si le groupe dépasse la borne, et on le dit.
 */
function pairesBornees(
  groupe: readonly FaitPourGraphe[],
  type: TypeLien,
  motif: string,
  abstentions: Abstention[],
  juger: (a: FaitPourGraphe, b: FaitPourGraphe) => { poids: number; pourquoi: string } | null,
): LienCalcule[] {
  if (groupe.length > TAILLE_MAX_GROUPE) {
    abstentions.push({ regle: type, motif: `${groupe.length} ${motif}`, taille: groupe.length });
    return [];
  }
  const out: LienCalcule[] = [];
  for (let i = 0; i < groupe.length; i++) {
    for (let j = i + 1; j < groupe.length; j++) {
      const a = groupe[i] as FaitPourGraphe;
      const b = groupe[j] as FaitPourGraphe;
      const v = juger(a, b);
      if (v) out.push({ ...paire(type, a.id, b.id), cibleB: "fait", type, regle: type, ...v });
    }
  }
  return out;
}

/**
 * Garde les liens les plus forts, au plus `LIENS_MAX_PAR_FAIT` par fait et `LIENS_MAX` en tout.
 * Tri total (poids, type, paire) : deux calculs sur la même mémoire gardent les MÊMES liens.
 * Une question n'a pas de plafond : ce n'est pas un fait.
 */
function plafonner(liens: readonly LienCalcule[], abstentions: Abstention[]): LienCalcule[] {
  const cle = (l: LienCalcule) => `${l.type}|${l.faitA}|${l.faitB}`;
  const tries = [...liens].sort((x, y) => y.poids - x.poids || (cle(x) < cle(y) ? -1 : 1));
  const parFait = new Map<string, number>();
  const satures = new Set<string>();
  const gardes: LienCalcule[] = [];
  for (const l of tries) {
    const nA = parFait.get(l.faitA) ?? 0;
    const nB = l.cibleB === "fait" ? (parFait.get(l.faitB) ?? 0) : 0;
    if (nA >= LIENS_MAX_PAR_FAIT) satures.add(l.faitA);
    if (nB >= LIENS_MAX_PAR_FAIT) satures.add(l.faitB);
    if (gardes.length >= LIENS_MAX || nA >= LIENS_MAX_PAR_FAIT || nB >= LIENS_MAX_PAR_FAIT) continue;
    parFait.set(l.faitA, nA + 1);
    if (l.cibleB === "fait") parFait.set(l.faitB, nB + 1);
    gardes.push(l);
  }
  const ecartes = liens.length - gardes.length;
  if (ecartes > 0) {
    abstentions.push({
      regle: "plafond",
      motif: `${ecartes} liens plus faibles écartés (au plus ${LIENS_MAX_PAR_FAIT} par fait, ${LIENS_MAX} en tout)`,
      taille: satures.size,
    });
  }
  return gardes;
}

/** Regroupe pour l'écran : un type de lien, ses liens, triés par poids décroissant. */
export function parType(liens: readonly LienCalcule[]): { type: TypeLien; liens: LienCalcule[] }[] {
  const m = new Map<TypeLien, LienCalcule[]>();
  for (const l of liens) {
    const liste = m.get(l.type);
    if (liste) liste.push(l);
    else m.set(l.type, [l]);
  }
  return [...m.entries()]
    .map(([type, ls]) => ({ type, liens: [...ls].sort((x, y) => y.poids - x.poids) }))
    .sort((a, b) => b.liens.length - a.liens.length);
}

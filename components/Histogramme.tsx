// components/Histogramme.tsx — [L38] une série par jour, dessinée au SERVEUR.
//
// Marc, 18/09 : « je veux des graphs voir ce qui reste ce qui a été traité depuis combien de
// temps etc ». Même patron que `GrapheSvg` : un SVG statique, zéro ligne de JavaScript
// envoyée au navigateur, et le texte se sélectionne et se lit à voix haute.
//
// ⚠️ AUCUNE COULEUR EN DUR. Tout passe par les jetons de `globals.css`, donc le dessin suit
// `prefers-color-scheme` sans que personne y pense — une couleur écrite ici serait parfaite
// dans le thème pour lequel on l'a écrite et fausse dans l'autre.
//
// ⚠️⚠️ LARGEUR FIXE + DÉFILEMENT, ET PAS `width: 100%` — C'EST UN CORRECTIF MESURÉ. Le premier
// jet mettait le SVG en `width: 100%`, donc trente barres se compressaient dans la largeur
// disponible. Mesuré : sur une tuile à ~250 px de large (téléphone, le plus petit palier de
// test), l'échelle tombe à 0,46 → **police rendue 4,2 px et barres de 6,5 px**. Les étiquettes
// de date devenaient décoratives, ce qui est pire qu'absent : elles occupent la place d'une
// information qu'on ne peut pas lire. Ici la barre garde ses 14 px RÉELS et la police ses 9,
// et c'est le conteneur qui défile — en CSS seul, sans une ligne de JavaScript.
//
// ⚠️ L'ALTERNATIVE TEXTUELLE EST UN RÉSUMÉ, PAS UN TABLEAU. Un histogramme de trente jours lu
// barre par barre est illisible ; ce qu'un lecteur d'écran doit entendre est ce que l'œil voit
// d'un coup — combien au total, sur combien de jours, le maximum. (Leçon FinanceAI : « la
// bonne alternative d'un graphe dépend du nombre de fois qu'il est rendu ».)
//
// ⚠️ Le `<title>` par barre est une infobulle de SOURIS et rien de plus : sous un `<svg
// role="img">`, le sous-arbre est présentationnel et les lecteurs d'écran ne l'annoncent pas.
// C'est documenté tel quel dans `GrapheSvg.tsx` ; on ne compte donc pas dessus pour l'accès
// non visuel, qui passe par `aria-label`.
//
// ⚠️ ET IL NE REND RIEN PLUTÔT QU'UN CADRE VIDE : une série vide n'est pas un graphe à zéro,
// c'est l'absence de graphe. Un axe tout seul laisserait croire qu'on a mesuré zéro.

/** Une barre. `valeur` peut être nulle — c'est un jour sans rien, pas un jour absent. */
export interface Barre {
  /**
   * Ce qui IDENTIFIE la barre — la date complète. ⚠⚠ Distinct de `etiquette`, et ce n'est pas
   * du zèle : la clé React était l'étiquette (`MM-JJ`, année tronquée), or les séries montrées
   * ne sont pas « les 30 derniers jours » mais « les 30 jours les plus récents PORTANT une
   * valeur ». Sur un import qui avance par à-coups — le cas même que cette page documente —
   * ces 30 jours peuvent s'étaler sur plus d'un an, et deux `MM-JJ` identiques à un an d'écart
   * donnaient deux barres avec la MÊME clé. C'est la leçon
   * `UNE-CLE-SE-DERIVE-DE-CE-QUI-IDENTIFIE-PAS-DE-CE-QU-ON-AFFICHE` de ce dépôt, recommise
   * ici et trouvée par la revue.
   */
  cle: string;
  /** L'étiquette de l'axe, courte (`AAAA-MM-JJ` est tronqué à `MM-JJ` par l'appelant). */
  etiquette: string;
  valeur: number;
  /**
   * La valeur TELLE QU'ELLE S'AFFICHE, quand elle ne s'écrit pas toute seule.
   *
   * ⚠️ Sans ça, une somme de flottants Postgres (`real`) arrive dans l'infobulle sous la forme
   * `3.1400000000000006` — un chiffre juste, écrit d'une façon qui a l'air d'un bug. Le
   * composant ne peut pas décider du format : il ne sait pas si la série compte des documents
   * (entiers) ou des dollars (deux décimales). C'est donc l'appelant qui le dit.
   */
  texte?: string;
}

const HAUTEUR = 120;
const LARGEUR_BARRE = 14;
const ECART = 4;
/** La place réservée sous les barres pour les étiquettes de l'axe. */
const MARGE_BASSE = 18;

export function Histogramme({
  barres,
  resume,
  unite,
}: {
  barres: readonly Barre[];
  /** Ce qu'un lecteur d'écran entend. L'appelant le compose : lui seul sait ce que ça MESURE. */
  resume: string;
  /** Pour les infobulles natives (`<title>`) : « document », « $ US »… */
  unite: string;
}) {
  if (barres.length === 0) return null;

  // ⚠️ `Math.max` sur des valeurs toutes nulles rend 0, et diviser par 0 donne `NaN` — donc
  // des barres à `NaN` de haut, c'est-à-dire pas de barres et aucune erreur. Le plancher à 1
  // fait qu'une série toute à zéro se dessine comme une série plate, ce qu'elle est.
  const maximum = Math.max(1, ...barres.map((b) => b.valeur));
  const largeur = barres.length * (LARGEUR_BARRE + ECART);
  // Une étiquette sur N, pour qu'elles ne se chevauchent pas. Calculé une fois : dans la
  // boucle, ça se recalculait à chaque barre pour le même résultat.
  const pasEtiquettes = Math.max(1, Math.ceil(barres.length / 8));

  return (
    // ⚠️ C'est LE CONTENEUR qui défile, pas le graphe qui se compresse. `maxWidth: 100%` le
    // garde dans la colonne ; `overflowX: auto` ne fait apparaître la barre de défilement que
    // s'il y a vraiment à défiler.
    //
    // ⚠⚠ `tabIndex={0}` N'EST PAS DU ZÈLE : une région qui défile et qu'on ne peut pas
    // atteindre au clavier rend son contenu INACCESSIBLE à qui n'a pas de souris (WCAG 2.1.1).
    // Trouvé par la revue — et c'est le défilement que je venais d'ajouter pour corriger la
    // lisibilité qui l'a introduit. La classe porte l'indicateur de focus, parce qu'un arrêt
    // de tabulation invisible est pire qu'un arrêt de trop.
    <div className="graphe-defilant" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
      <svg
        width={largeur}
        height={HAUTEUR + MARGE_BASSE}
        viewBox={`0 0 ${largeur} ${HAUTEUR + MARGE_BASSE}`}
        role="img"
        aria-label={resume}
        style={{ display: "block" }}
      >
        {barres.map((b, i) => {
          // Une valeur non nulle garde au moins 1 px : une barre de 0,4 px ne se voit pas, et
          // « invisible » se lit comme « zéro » alors que ce n'est pas la même chose.
          const h = b.valeur > 0 ? Math.max(1, (b.valeur / maximum) * HAUTEUR) : 0;
          const x = i * (LARGEUR_BARRE + ECART);
          return (
            <g key={b.cle}>
              <title>{`${b.etiquette} : ${b.texte ?? b.valeur} ${unite}`}</title>
              {/* Le fond de la colonne : il rend visible un jour à ZÉRO, qui sinon serait un
                  trou indistinguable d'un jour absent de la série. */}
              <rect x={x} y={0} width={LARGEUR_BARRE} height={HAUTEUR} fill="var(--surface-douce)" rx={2} />
              {h > 0 && (
                <rect x={x} y={HAUTEUR - h} width={LARGEUR_BARRE} height={h} fill="var(--accent)" rx={2} />
              )}
              {i % pasEtiquettes === 0 && (
                <text
                  x={x + LARGEUR_BARRE / 2}
                  y={HAUTEUR + 13}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--texte-doux)"
                >
                  {b.etiquette}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

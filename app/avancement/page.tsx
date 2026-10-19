// app/avancement/page.tsx — AVANCEMENT : où en sont tes papiers, de DriveAI jusqu'à la lecture.
//
// Marc, 23/09 : « je vais vouloir une interface similaire [à celle de DriveAI] pour dire
// l'avancement ». Arbitrages du même jour : un onglet DÉDIÉ ; l'entonnoir, la vitesse, le détail
// par dossier et ce qu'on tire des papiers ; et « DriveAI pousse ses comptes » (ADR 0009).
//
// ── CE QUE CETTE PAGE AFFIRME, ET D'OÙ ÇA VIENT ─────────────────────────────────────────────
//
// Chaque étage NOMME sa source (« selon DriveAI », « selon la Mémoire ») : deux apps qui comptent
// ne comptent pas la même chose, et un écart entre elles n'est pas une erreur. Tout ce qui se
// calcule vit dans `lib/avancement/vue.ts` et `lib/importEtat.ts`, PURS et testés — ici, on
// n'affiche que ce qu'ils rendent.
//
// ⚠️ « NON MESURÉ » N'EST JAMAIS ZÉRO : tant que DriveAI n'a rien poussé, ses étages le disent.
// ⚠️ LE SUIVI DE LA LECTURE A QUITTÉ « DÉPENSES » (décision annoncée à Marc) : un même compte
// affiché à deux endroits finit par dériver, et Dépenses redevient ce que dit son nom.
// ⚠️ LA LECTURE ÉCRIT DES PAPIERS, PAS DES FAITS : les faits validés s'affichent À CÔTÉ de
// l'entonnoir, avec la phrase qui le dit, et non comme un étage qui vaudrait zéro pour toujours.

import { Histogramme, type Barre } from "@/components/Histogramme";
import { Jauge } from "@/components/Jauge";
import { Nav } from "@/components/Nav";
import { depotAvancementDrizzle } from "@/lib/avancement/depot";
import { comptesParDossier, compterExtraits, lignesExtraits } from "@/lib/avancement/comptesMemoire";
import { composerDossiers, composerEntonnoir, etatSource, ilYa, serieReste } from "@/lib/avancement/vue";
import { dechiffrer } from "@/lib/chiffrement";
import { jourQuebec } from "@/lib/coutChat";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { n2Autorise, n3Autorise } from "@/lib/lecture";
import { etatImport } from "@/lib/importEtat";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { depotFileDeLectureDrizzle, type MotifVerdict } from "@/lib/pieces/fileDeLecture";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Combien de jours les histogrammes montrent. Au-delà, les barres deviennent illisibles. */
const JOURS_MONTRES = 30;
const jourCourt = (j: string) => j.slice(5);
const nombre = (n: number | null) => (n === null ? "non mesuré" : n.toLocaleString("fr-CA"));

/**
 * Ce que chaque verdict VEUT DIRE, en mots de Marc. ⚠️ `Record<MotifVerdict, …>` : un motif
 * ajouté à la liste fermée sans son libellé casse le typecheck au lieu d'afficher un code.
 */
const LIBELLES_VERDICT_TYPES: Record<MotifVerdict, string> = {
  "sans-texte": "aucun texte lisible",
  "ocr-echec": "lecture optique en échec",
  "lecture-impossible": "fichier inaccessible",
  introuvable: "fichier introuvable dans le Drive",
  "extraction-vide": "le modèle n’en a rien tiré",
  "piece-vide": "rien d’exploitable",
  refusee: "contenu refusé par la mémoire",
  "sans-effet": "lu, mais la mémoire n’a rien changé",
};
const LIBELLES_VERDICT: Record<string, string> = LIBELLES_VERDICT_TYPES;

export default async function AvancementPage() {
  await requireSession();
  const acces = await accesDonnees();

  if (!acces.ok) {
    return (
      <>
        <Nav active="avancement" />
        <main className="page">
          <h1>Avancement</h1>
          <p className="alerte bandeau">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  const pieces = depotPiecesLectureDrizzle(acces.db);
  const [driveaiLu, papiers, luesParJour, tentees, dossiersMemoire, lignes, faits] = await Promise.all([
    depotAvancementDrizzle(acces.db).lire("driveai"),
    pieces.comptesParExtracteur(),
    pieces.luesParJour(JOURS_MONTRES),
    depotFileDeLectureDrizzle(acces.db, acces.cle).tentees(),
    comptesParDossier(acces.db),
    lignesExtraits(acces.db),
    depotLectureDrizzle(acces.db).comptes(),
  ]);

  const maintenant = new Date();
  const source = etatSource(driveaiLu, maintenant);
  const driveai = driveaiLu.etat === "present" ? driveaiLu.avancement : null;
  const { etages, ecarts } = composerEntonnoir(driveai, {
    connus: papiers.lus + papiers.nonLus,
    lus: papiers.lus,
    tentees: tentees.total,
  });
  const maxEtage = Math.max(1, ...etages.map((e) => e.valeur ?? 0));
  const dossiers = composerDossiers(dossiersMemoire, driveai);
  // ⚠️ La MÊME politique que la liste et la fiche des papiers : un N3 ne s'ouvre pas ici tant que
  // `MEMORYAI_N3_CHAT` n'est pas posée (ADR 0007), même pour n'en tirer que des nombres.
  const politique = { inclureN2: true, n2Autorise: n2Autorise(), inclureN3: true, n3Autorise: n3Autorise(), inclureProposes: true };
  const extraits = compterExtraits(lignes, (scelle, id, niveau) => dechiffrer(acces.cle, scelle, id, niveau), politique);
  const etat = etatImport({ lus: papiers.lus, restants: papiers.nonLus, joursLus: luesParJour, aujourdhui: jourQuebec(maintenant) });
  const faitsValides = faits.parStatut.valide ?? 0;

  const barresLues: Barre[] = luesParJour.map((j) => ({ cle: j.jour, etiquette: jourCourt(j.jour), valeur: j.nombre }));
  const reste = serieReste(driveai?.joursLus ?? []).slice(-JOURS_MONTRES);
  const barresReste: Barre[] = reste.map((j) => ({ cle: j.jour, etiquette: jourCourt(j.jour), valeur: j.reste }));
  const luSurLaFenetre = luesParJour.reduce((n, j) => n + j.nombre, 0);

  return (
    <>
      <Nav active="avancement" />
      <main className="page">
        <h1>Avancement</h1>
        <p className="lead">
          Où en sont tes papiers, depuis leur classement dans ton Drive jusqu’à leur lecture. Chaque chiffre dit quelle
          application l’a compté.
        </p>

        {/* La fraîcheur de ce que DriveAI a dit, en premier : c'est elle qui dit si les trois premiers
            étages décrivent aujourd'hui ou une photo ancienne. */}
        {source.etat === "jamais" && (
          <p className="alerte bandeau">
            DriveAI n’a encore rien envoyé : les étages « classés » et « envoyés » restent non mesurés. Ils apparaîtront
            à son prochain envoi (au plus toutes les 30 minutes, une fois sa mise à jour déployée).
          </p>
        )}
        {source.etat === "illisible" && (
          <p className="alerte bandeau">
            DriveAI a envoyé ses comptes {ilYa(source.recuIlYaMin)}, mais cette version de la Mémoire ne sait pas les
            lire. C’est la Mémoire qui est en retard d’une mise à jour, pas DriveAI.
          </p>
        )}
        {source.etat === "present" && (
          <p className={source.enRetard ? "alerte bandeau" : "hint"}>
            {source.enRetard
              ? `DriveAI n’a rien envoyé depuis ${ilYa(source.recuIlYaMin).replace("il y a ", "")} : les chiffres « selon DriveAI » décrivent son dernier envoi, pas maintenant.`
              : `Comptes de DriveAI reçus ${ilYa(source.recuIlYaMin)}, mesurés ${ilYa(source.mesureIlYaMin)}.`}
          </p>
        )}

        <section className="carte tuile" aria-labelledby="entonnoir">
          <h2 id="entonnoir">Où en sont tes papiers</h2>
          <ol className="entonnoir">
            {etages.map((e, i) => (
              <li key={e.cle}>
                <p className="entonnoir-etage">
                  <strong>{nombre(e.valeur)}</strong> {e.libelle.toLowerCase()}{" "}
                  <span className="hint">— selon {e.source === "DriveAI" ? "DriveAI" : "la Mémoire"}</span>
                </p>
                {e.valeur !== null && (
                  <Jauge part={(e.valeur / maxEtage) * 100} resume={`${e.libelle} : ${e.valeur}.`} />
                )}
                {e.note && <p className="hint">{e.note}</p>}
                {ecarts[i] && <p className="entonnoir-ecart">{ecarts[i]!.explication}</p>}
              </li>
            ))}
          </ol>
        </section>

        <section className="carte tuile" aria-labelledby="vitesse">
          <h2 id="vitesse">La vitesse, et ce qui reste</h2>
          {etat.joursDepuisDernier === null ? (
            <p className="alerte bandeau">Aucun document n’a encore été lu par un modèle.</p>
          ) : (
            <p className={etat.joursDepuisDernier >= 2 ? "alerte bandeau" : "hint"}>
              {etat.joursDepuisDernier === 0
                ? "Des documents ont été lus aujourd’hui."
                : `Rien n’a été lu depuis ${etat.joursDepuisDernier} jour${etat.joursDepuisDernier > 1 ? "s" : ""} — dernière lecture le ${etat.dernierJour}.`}
            </p>
          )}
          <dl className="attributs">
            <div>
              <dt>rythme, les jours où ça tourne</dt>
              <dd>
                {etat.rythmeParJourActif === null
                  ? "— rien de mesurable encore"
                  : `${etat.rythmeParJourActif.toFixed(0)} document(s) par jour actif, sur ${etat.joursActifs} jour(s)`}
              </dd>
            </div>
            <div>
              <dt>il resterait</dt>
              <dd>
                {/* Des jours ACTIFS, pas des jours de calendrier : ça dépend du nombre de fois où
                    la lecture tournera, pas du nombre de nuits qui passent. */}
                {etat.restants === 0
                  ? "rien : tout est lu"
                  : etat.joursActifsRestants === null
                    ? "— pas de rythme mesuré, donc aucune estimation honnête"
                    : `environ ${etat.joursActifsRestants} jour(s) où la lecture tourne`}
              </dd>
            </div>
          </dl>

          {tentees.total > 0 && (
            <p className="hint">
              Déjà essayés sans résultat : <strong>{tentees.total}</strong> (
              {Object.entries(tentees.parMotif)
                .map(([motif, n]) => `${LIBELLES_VERDICT[motif] ?? motif} : ${n}`)
                .join(" · ")}
              ). La lecture ne les reprendra pas tant que le lecteur ne change pas : ils restent comptés
              « à lire », et la lecture ne montera pas jusqu’à 100 % à cause d’eux.
            </p>
          )}

          <h3>Papiers lus par jour — selon la Mémoire</h3>
          {barresLues.length === 0 ? (
            <p className="hint">Aucun jour de lecture à montrer.</p>
          ) : (
            <Histogramme
              barres={barresLues}
              unite="document(s)"
              resume={`${luSurLaFenetre} document(s) lu(s) sur ${barresLues.length} jour(s), du ${luesParJour[0]?.jour} au ${
                luesParJour[luesParJour.length - 1]?.jour
              }.`}
            />
          )}

          <h3>Reste à lire, jour par jour — selon DriveAI</h3>
          {barresReste.length === 0 ? (
            <p className="hint">
              {driveai === null
                ? "DriveAI n’a encore rien envoyé."
                : "DriveAI n’a pas encore de série pour la tranche en cours (un point par jour)."}
            </p>
          ) : (
            <Histogramme
              barres={barresReste}
              unite="document(s) restant(s)"
              resume={`Reste à lire sur ${barresReste.length} jour(s) : ${barresReste[0]!.valeur} le ${reste[0]!.jour}, ${
                barresReste[barresReste.length - 1]!.valeur
              } le ${reste[reste.length - 1]!.jour}.`}
            />
          )}
        </section>

        <section className="carte tuile" aria-labelledby="dossiers">
          <h2 id="dossiers">Par dossier</h2>
          {dossiers.length === 0 ? (
            <p className="hint">Aucun papier rangé dans un dossier numéroté.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Dossier</th>
                  <th>Lus / connus (Mémoire)</th>
                  <th>Reste à lire (DriveAI)</th>
                </tr>
              </thead>
              <tbody>
                {dossiers.map((d) => (
                  <tr key={d.code} aria-current={d.enCours ? "step" : undefined}>
                    <td>
                      {d.code} · {d.libelle}
                      {d.enCours && <strong> — en cours</strong>}
                    </td>
                    <td>
                      {d.lus} / {d.connus}
                    </td>
                    <td>{d.resteDriveai === null ? "—" : d.resteDriveai}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">
            Les deux colonnes ne viennent pas de la même application, et c’est voulu : la Mémoire sait ce qui est lu,
            DriveAI sait où il lit. Elles ne s’additionnent pas.
          </p>
        </section>

        <section className="carte tuile" aria-labelledby="tire">
          <h2 id="tire">Ce qu’on tire des papiers lus</h2>
          {extraits.papiers === 0 ? (
            <p className="hint">Aucun papier lu pour l’instant.</p>
          ) : (
            <dl className="attributs">
              <div>
                <dt>papiers lus</dt>
                <dd>{extraits.papiers}</dd>
              </div>
              <div>
                <dt>avec une date</dt>
                <dd>{extraits.avecDate}</dd>
              </div>
              <div>
                <dt>avec une échéance</dt>
                <dd>{extraits.avecEcheance}</dd>
              </div>
              <div>
                <dt>montants trouvés</dt>
                <dd>
                  {extraits.entrees.montants} dans {extraits.papiersAvec.montants} papier(s)
                </dd>
              </div>
              <div>
                <dt>numéros trouvés</dt>
                <dd>
                  {extraits.entrees.numeros} dans {extraits.papiersAvec.numeros} papier(s)
                </dd>
              </div>
              <div>
                <dt>personnes nommées</dt>
                <dd>
                  {extraits.entrees.personnes} dans {extraits.papiersAvec.personnes} papier(s)
                </dd>
              </div>
              <div>
                <dt>lieux</dt>
                <dd>
                  {extraits.entrees.lieux} dans {extraits.papiersAvec.lieux} papier(s)
                </dd>
              </div>
            </dl>
          )}
          {extraits.proteges > 0 && (
            <p className="hint">
              {extraits.proteges} papier(s) confidentiel(s) n’ont pas été ouverts pour ce compte : tes réglages ne
              laissent pas lire leur contenu. Leurs montants, numéros, personnes et lieux ne sont donc pas dans les
              totaux ci-dessus.
            </p>
          )}
          {extraits.illisibles > 0 && (
            <p className="alerte bandeau">
              {extraits.illisibles} papier(s) lu(s) n’ont pas pu être rouverts pour ce compte : ils ne sont pas comptés
              ci-dessus, et ce n’est pas parce qu’ils sont vides.
            </p>
          )}
          <p className="hint">
            Les faits que tu as confirmés sont une autre chose : <strong>{faitsValides}</strong> aujourd’hui. Lire un
            papier range son contenu dans le papier, pas dans un fait — ce nombre-là ne monte pas avec la lecture.
          </p>
        </section>

        <section className="carte tuile" aria-labelledby="par-extracteur">
          <h2 id="par-extracteur">Qui a lu quoi</h2>
          {Object.keys(papiers.parExtracteur).length === 0 ? (
            <p className="hint">Aucun papier en mémoire.</p>
          ) : (
            <dl className="attributs">
              {Object.entries(papiers.parExtracteur)
                .sort((a, b) => b[1] - a[1])
                .map(([extracteur, n]) => (
                  <div key={extracteur}>
                    <dt>
                      <code>{extracteur}</code>
                    </dt>
                    <dd>{n} papier(s)</dd>
                  </div>
                ))}
            </dl>
          )}
          <p className="hint">
            La lecture ne se lance pas d’ici : la Mémoire reçoit les papiers lus, c’est DriveAI qui a les fichiers.
          </p>
        </section>
      </main>
    </>
  );
}

// app/regler/page.tsx — [L26] RÉGLER : tout ce qui n'est ni parler ni chercher, replié.
//
// Marc, le 17/09 : « beaucoup trop d'onglets », « très épuré », « des informations cachées en
// cliquant sur certains boutons pour y avoir accès ». Cinq onglets deviennent cinq sections
// REPLIÉES : État (ex-Moi), À valider, Conversations, Apps, Liens.
//
// ── CE QUE CETTE PAGE FAIT, ET CE QU'ELLE NE FAIT PAS ─────────────────────────────────────
//
// Elle REGROUPE les entrées de navigation ; elle ne FUSIONNE pas encore le contenu des cinq
// pages. Chaque section porte le chiffre qui dit s'il y a quelque chose à y faire, puis un
// lien vers la page qui fait le travail.
//
// ── [L26b] LA FUSION COMMENCE PAR ÉTAT, ET S'ARRÊTE LÀ ───────────────────────────────────
//
// ⚠️ Le périmètre que L26a avait écrit ici était FAUX, et c'est moi qui l'avais écrit :
// « 16 actions serveur » comptait aussi celles de `/questions`, `/chat` et `/pieces`, qui ne
// sont pas dans Régler. Recensé sur les CINQ pages : **12** (`purger` · 7 pour la file ·
// `oublierConversation` · `regler` + `retirer` · `recalculer`). « Un périmètre cité n'est pas
// un périmètre recensé » — re-payé un lot plus tard, sur ma propre prose.
//
// **État est fusionné** parce que la mesure le rend presque gratuit : cette page FETCHAIT
// déjà **3 des 5** lectures de `/moi` pour n'en afficher qu'un compteur — les comptes, la
// répartition par domaine et la dépense du jour. Manquaient la dépense TOTALE et le
// vocabulaire.
//
// ⚠️ Cette ligne disait « **4** des 5 », chiffre que j'avais écrit SANS le mesurer ; la revue
// l'a recompté sur `origin/main`. Un chiffre faux dans un commentaire d'architecture sert
// à dimensionner le prochain lot — il se mesure comme n'importe quelle autre affirmation.
//
// ⚠⚠ **Conversations n'est PAS fusionnée, et c'est une mesure, pas un confort** : un
// `<details>` masque à l'œil mais **expédie son contenu** — le HTML est rendu, replié ou non.
// Inliner la liste des conversations mettrait leurs résumés dans la source de CETTE page à
// chaque chargement, alors qu'aujourd'hui ils ne sont lus que si Marc va les voir. Un repli
// est une commodité d'affichage, jamais une frontière de données.
//
// ── [L26b2] APPS : l'INFORMATION monte, l'ATELIER reste ──────────────────────────────────
//
// La section Apps affiche désormais l'ÉTAT de chaque périmètre — qui a un jeton, jusqu'à quel
// niveau, combien de domaines, invités, domicile — et renvoie à `/apps` pour le CHANGER.
//
// ⚠⚠ Le formulaire, lui, ne monté PAS, et c'est mesuré : le vocabulaire porte **23**
// domaines, donc le réglage d'une app fait ~29 contrôles (23 cases + 2 listes + 2 cases +
// 2 boutons). Avec trois ou quatre apps, ce sont **~100 contrôles** de formulaire expédiés
// dans le HTML de cette page à chaque chargement — un `<details>` masque à l'œil mais
// expédie son contenu. `/apps` n'est pas un panneau, c'est un ATELIER.
//
// **La règle qui en sort, et qui vaut pour les pages restantes** : dans chacune des cinq,
// séparer l'INFORMATION (ce que Marc veut voir sans cliquer — ça monte dans le hub) de
// l'ATELIER (ce avec quoi il travaille — ça garde sa page). État l'a suivie sans le dire :
// les compteurs sont montés, la purge est restée. Ce n'était pas une exception, c'est le
// critère.
//
// ⚠️ Et la contrainte de `/apps` voyage avec l'information, pas avec la page : AUCUNE valeur
// de jeton n'apparaît ici, ni tronquée ni hachée. On dit QUI peut écrire (déduit du NOM de la
// variable d'environnement), jamais avec quoi.
//
// ⚠️ **La purge non plus**, et pour la raison inverse : le ticket demande « purge plus
// difficile ». Elle exige déjà le mot exact **côté serveur** (`purgerAction`, atteignable sans
// la page) ; la rapprocher du hub la rendrait plus FACILE. Elle garde donc sa page à elle,
// `/moi`, atteinte depuis État par un lien qui dit ce qu'elle fait.
//
// ⚠️ **À valider** reste une page : c'est un plan de travail (7 des 12 actions), pas un
// panneau. **Liens** aussi, mais pour une autre raison : `L26c` le RETIRE après `L30`.
//
// ⚠️ Et la fusion a révélé trois DOUBLONS que la séparation cachait : `/moi` affichait « À
// valider », « Niveau 2 » et « claude.ai », que Régler porte déjà dans ses propres sections.
// Ils ne sont pas recopiés ici — chaque fait a UNE place, et `tests/reglerFusion.test.ts`
// vérifie les deux sens : rien de perdu, rien affiché deux fois.
//
// ⚠️ Et le CHIFFRE de chaque section n'est pas du décor : c'est lui qui remplace le clic
// exploratoire. Sans lui, replier cinq sections rendrait la file INVISIBLE au lieu de la
// rendre calme — et « 0 fait à valider » est une information, « ouvre pour voir » n'en est
// pas une.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { comptesParDomaine, depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotConversationsDrizzle } from "@/lib/conversations/depot";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { jourQuebec } from "@/lib/coutChat";
import { estGele } from "@/lib/gel";
import { appsConnues } from "@/lib/jetons";
import { n2Autorise } from "@/lib/lecture";
import { lireEnvMcp } from "@/lib/mcp/oauth";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { depotSauvetageDrizzle } from "@/lib/sauvetage/depot";
import { depotPerimetresDrizzle } from "@/lib/depotPerimetres";
import { depotPiecesLectureDrizzle } from "@/lib/pieces/depotLecture";
import { totalInformations, phraseInformations, type PostesInformations } from "@/lib/totalInformations";
import { requireSession } from "@/lib/session";
import { VOIX_MAX_CARACTERES } from "@/lib/chat/voix";
import { reglerVoixAction, type IssueVoix } from "./actions";
import { domaines as domainesDuVocabulaire, VERSION_COURANTE, vocabulaire } from "@/lib/vocabulaire";

export const dynamic = "force-dynamic";

/** Un montant en dollars US, d'un seul endroit — six sites d'appel dans État (comptés). */
const usd = (n: number) => `${n.toFixed(2)} $ US`;

/** Ce que la page dit après un enregistrement de la voix. Les motifs viennent d'une liste fermée. */
const MESSAGES_VOIX: Record<IssueVoix, { texte: string; ok: boolean }> = {
  ok: { texte: "Voix enregistrée : Lia s'en sert dès ton prochain message.", ok: true },
  efface: { texte: "Voix effacée : Lia reprend son ton par défaut.", ok: true },
  trop_long: { texte: `Voix trop longue : ${VOIX_MAX_CARACTERES} caractères au plus. Rien n'a été enregistré.`, ok: false },
  balise: { texte: "La voix ne peut pas contenir de balise (< >). Rien n'a été enregistré.", ok: false },
  url: { texte: "La voix ne peut pas contenir d'adresse web. Rien n'a été enregistré.", ok: false },
  refus: { texte: "Voix refusée. Rien n'a été enregistré.", ok: false },
};

export default async function ReglerPage({ searchParams }: { searchParams: Promise<{ voix?: string }> }) {
  await requireSession();
  const { voix: issueBrute } = await searchParams;
  const issueVoix = issueBrute !== undefined && issueBrute in MESSAGES_VOIX ? MESSAGES_VOIX[issueBrute as IssueVoix] : null;
  const acces = await accesDonnees();
  const gele = estGele();
  const mcp = lireEnvMcp() !== null;
  const chatConfigure = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const tousDomaines = domainesDuVocabulaire();

  // ADR 0019 : tant que le sauvetage n'est pas clos, la page le dit en premier.
  const sauvetageOuvert = acces.ok ? await depotSauvetageDrizzle(acces.db).ecrituresFermees() : false;
  const comptes = acces.ok ? await depotLectureDrizzle(acces.db).comptes() : null;
  const parDomaine = acces.ok ? await comptesParDomaine(acces.db) : {};
  const conversations = acces.ok ? await depotConversationsDrizzle(acces.db).mesure() : null;
  const papiers = acces.ok ? await depotPiecesLectureDrizzle(acces.db).comptes() : null;
  const admin = acces.ok ? depotAdminDrizzle(acces.db) : null;
  const depense = admin ? await admin.depenseDuJourParPoste(jourQuebec(new Date())) : null;
  // ⚠️ LA seule lecture que cette page n'avait pas et que `/moi` faisait. Les quatre autres
  // étaient déjà là depuis L26a, pour n'afficher qu'un compteur.
  const depenseTotale = admin ? await admin.depenseTotaleUsd() : null;
  // Les plafonds EFFECTIFS (réglés par Marc, ou le défaut du 16/09 à défaut) — [L34].
  const plafondsEffectifs = admin ? await admin.plafonds() : null;
  // [L27] La voix de Lia, telle que Marc l'a écrite : de la configuration, pas du contenu perso.
  const voixLia = admin ? await admin.voixLia() : null;
  // [L26b2] L'ÉTAT des périmètres, pas leur formulaire — voir l'en-tête.
  const perimetres = acces.ok ? await depotPerimetresDrizzle(acces.db).tous() : [];
  const avecJeton = appsConnues();
  // Une app peut avoir un jeton sans réglage (le cas NORMAL : le jeton décide seul), ou un
  // réglage sans jeton (une ligne restée après le retrait d'une variable — elle ne sert plus
  // à rien, et le dire vaut mieux que la cacher). L'union, donc, pas l'intersection.
  const appIds = [...new Set([...avecJeton.map((a) => a.appId), ...perimetres.map((x) => x.appId)])].sort();

  const valides = comptes?.parStatut.valide ?? 0;
  const aValider = comptes?.parStatut.propose ?? 0;

  // [L41] LE chiffre que Marc cherchait. Un poste NON MESURÉ reste `null` et fait disparaître
  // le total : afficher la somme des postes lisibles donnerait un nombre plus petit que la
  // réalité sous l'étiquette « en tout ». La décomposition est obligatoire — voir le module.
  const postes: PostesInformations = {
    faits: acces.ok && comptes ? (comptes.parStatut.valide ?? 0) : null,
    papiers: acces.ok && papiers ? papiers.total : null,
  };
  const total = totalInformations(postes);

  /** Un chiffre ou un tiret HONNÊTE : « — » dit « pas mesuré », jamais « zéro ». */
  const n = (x: number | null | undefined) => (acces.ok && x !== null && x !== undefined ? String(x) : "—");

  return (
    <>
      <Nav active="regler" />
      <main className="page">
        <h1>Régler</h1>
        {gele && (
          <p className="alerte bandeau">
            Mémoire gelée (<code>MEMORYAI_GEL=1</code>) : rien n’est servi ni écrit par les machines. Cette page reste lisible.
          </p>
        )}
        {!acces.ok && <p className="alerte bandeau">{MESSAGES_MANQUE[acces.manque]}</p>}
        {sauvetageOuvert && (
          <p className="alerte bandeau">
            Sauvetage en cours : les apps ne peuvent pas écrire dans la mémoire tant qu’il n’est pas clos.{" "}
            <Link href="/regler/sauvetage">Ouvrir le sauvetage</Link>
          </p>
        )}

        {/* ⚠️ Le total ne s'affiche JAMAIS sans sa décomposition : un fait (une phrase que Marc
            a confirmée) et un papier (un document dont on sait qu'il existe) ne sont pas la même
            chose, et un chiffre unique le ferait oublier. C'est la condition qui rend la somme
            honnête, pas une précaution d'affichage. */}
        <p className="total-infos">
          <strong className="total-infos-nombre">{total === null ? "—" : total}</strong>
          <span className="total-infos-quoi">informations sur toi</span>
          <span className="total-infos-detail">{phraseInformations(postes)}</span>
        </p>

        <details className="repli">
          <summary>
            {/* ⚠️ Les DEUX postes, jamais le seul « faits validés » : c'est en le lisant isolé que
                Marc a cru la mémoire à l'arrêt alors que la lecture des papiers avançait. */}
            État — <strong>{n(postes.faits)}</strong> fait(s) validé(s) · <strong>{n(postes.papiers)}</strong> papier(s)
          </summary>
          {/* Les compteurs vivent ici plutôt qu’en tête de l’accueil : un compteur ne fait
              décider personne (ADR 0004 n° 43). Ce qui est affiché est ce que `/moi` affichait,
              MOINS ses trois doublons — « À valider », « Niveau 2 » et « claude.ai » — que les
              sections suivantes de cette page portent déjà. */}
          <dl className="attributs">
            <div>
              <dt>faits validés</dt>
              <dd>
                {n(valides)}
                {acces.ok && comptes?.dernierValideLe
                  ? ` · dernier le ${comptes.dernierValideLe.slice(0, 10)}`
                  : acces.ok
                    ? " · aucune validation encore : la mémoire reste vide tant que tu ne valides rien"
                    : ""}
              </dd>
            </div>
            {/* ⚠️ Cette ligne existait dans `/moi` et elle doit SURVIVRE à la fusion : le compte
                ci-dessus exclut les faits devenus des PAPIERS (ADR 0004 §6.2), et un total qui
                baisse sans raison dite se lit comme une perte de données. */}
            {acces.ok && (comptes?.migresEnPiece ?? 0) > 0 && (
              <div>
                <dt>devenus des papiers</dt>
                <dd>
                  <Link href="/pieces">{comptes?.migresEnPiece} document(s)</Link> de l’inventaire : gardés,
                  réversibles, plus comptés comme des faits.
                </dd>
              </div>
            )}
            <div>
              <dt>par domaine</dt>
              <dd>
                {Object.keys(parDomaine).length === 0
                  ? "Aucun domaine ne porte encore de fait validé."
                  : Object.entries(parDomaine)
                      .sort((a, b) => b[1] - a[1])
                      .map(([d, k]) => `${d} ${k}`)
                      .join(" · ")}
              </dd>
            </div>
            <div>
              <dt>vocabulaire</dt>
              <dd>
                {vocabulaire().length} prédicats en v{VERSION_COURANTE} ·{" "}
                {comptes?.canaris ? `${comptes.canaris} canari(s) en attente` : "aucun canari"}
              </dd>
            </div>
            {/* Les deux postes côte à côte : un budget qu’on ne peut pas imputer est un budget
                qu’on ne sait pas régler. Le total est la borne décidée par Marc, pas une somme
                affichée pour elle-même. */}
            <div>
              <dt>dépenses du jour</dt>
              <dd>
                {depense
                  ? `chat ${usd(depense.chat)} sur ${usd(plafondsEffectifs?.chat ?? 0)} · apprentissage ${usd(depense.apprentissage)} sur ${usd(plafondsEffectifs?.apprentissage ?? 0)}`
                  : "—"}
                {depenseTotale ? ` · ${usd(depenseTotale.total)} depuis le début (${depenseTotale.appels} appel${depenseTotale.appels > 1 ? "s" : ""})` : ""}
                {chatConfigure ? "" : " · ANTHROPIC_API_KEY manquante : chat désactivé"}
              </dd>
            </div>
          </dl>
          {/* ⚠️ La purge garde sa PAGE. Le lien dit ce qu’elle fait plutôt que « ouvrir » :
              un bouton qui efface tout ne doit pas se cliquer par curiosité. */}
          {acces.ok && (
            <Link href="/moi" className="bouton bouton-danger">
              Effacer toute la mémoire…
            </Link>
          )}
        </details>

        {/* [L27] Lia — la VOIX. Marc écrit comment on lui parle ; ça entre dans le prompt BALISÉ
            comme donnée, jamais comme une règle (ADR 0005 A4). Le formulaire est de la
            configuration (600 caractères au plus), pas du contenu : le replier n'expédie rien
            de sensible. Ouvert quand on vient d'enregistrer, pour que le message se lise. */}
        <details className="repli" open={issueVoix !== null}>
          <summary>
            Comment Lia te parle — <strong>{voixLia === null ? "ton par défaut" : "voix réglée"}</strong>
          </summary>
          {issueVoix && <p className={`bandeau ${issueVoix.ok ? "succes" : "erreur"}`}>{issueVoix.texte}</p>}
          <p className="hint">
            Ton, longueur, humour : écris comment tu veux que Lia te parle. C’est une préférence de style, pas une
            règle : elle ne change ni les citations ni ce que Lia refuse de dire. Vide = ton par défaut.
          </p>
          {acces.ok ? (
            <form action={reglerVoixAction} className="pile">
              <textarea
                name="voix"
                className="champ"
                rows={4}
                maxLength={VOIX_MAX_CARACTERES}
                defaultValue={voixLia ?? ""}
                aria-label="Comment Lia te parle"
                placeholder="Ex. Tutoie-moi, va droit au but, pas d’emoji."
              />
              <button type="submit" className="bouton">
                Enregistrer la voix
              </button>
            </form>
          ) : (
            <p className="hint">Pas de base branchée : la voix n’est pas modifiable.</p>
          )}
        </details>

        <details className="repli">
          <summary>
            À valider — <strong>{n(aValider)}</strong> en attente
          </summary>
          <p className="hint">
            {acces.ok && aValider === 0
              ? "Rien n’attend. Le canal DriveAI entre directement en validé, donc cette file reste vide même à plein régime — ce n’est pas un signe d’inactivité."
              : "Ce que la mémoire propose et que tu n’as pas encore tranché, plus les prédicats en quarantaine."}
          </p>
          <Link href="/a-valider" className="bouton bouton-second">
            Ouvrir la file
          </Link>
        </details>

        <details className="repli">
          <summary>
            Conversations gardées — <strong>{n(conversations?.nombre)}</strong>
          </summary>
          <p className="hint">Ce que tu as demandé de garder, et de quoi l’oublier.</p>
          <Link href="/conversations" className="bouton bouton-second">
            Ouvrir les conversations
          </Link>
        </details>

        <details className="repli">
          <summary>
            Apps et périmètres — <strong>{acces.ok ? appIds.length : "—"}</strong> app(s)
            {mcp ? "" : " · connecteur non configuré"}
          </summary>
          <p className="hint">
            Quelle app lit quoi, et jusqu’à quel niveau. Niveau 2 vers un modèle :{" "}
            {n2Autorise() ? "autorisé" : "fermé"}. Le périmètre ne peut que RESTREINDRE ce que le jeton permet :
            sans réglage, l’app garde ce que son jeton lui donne.
          </p>
          {/* ⚠️ AUCUNE VALEUR DE JETON, ni tronquée ni hachée — même contrainte que `/apps`, et
              elle voyage avec l’information, pas avec la page. On dit QUI peut écrire (déduit du
              NOM de la variable), jamais avec quoi. */}
          {!acces.ok ? (
            <p className="hint">Pas de base branchée : les périmètres ne sont pas lisibles.</p>
          ) : appIds.length === 0 ? (
            <p className="hint">
              Aucune app ne parle encore à ta mémoire. Une app apparaît ici dès qu’une variable
              <code>MEMORYAI_TOKEN_&lt;APP&gt;_&lt;RÔLE&gt;</code> est posée.
            </p>
          ) : (
            <dl className="attributs">
              {appIds.map((appId) => {
                const jeton = avecJeton.find((a) => a.appId === appId);
                const per = perimetres.find((x) => x.appId === appId);
                // ⚠️ `domaines` est du JSON en base. Un `JSON.parse` sur une colonne peut lever
                // — et une page qui plante n’est pas un état dégradé, c’est une panne. On compte
                // ce qu’on sait lire et on DIT quand on ne sait pas, plutôt que de rendre 0.
                let accordes: string[] | null = null;
                if (per) {
                  try {
                    const brut: unknown = JSON.parse(per.domaines);
                    accordes = Array.isArray(brut) ? brut.filter((x): x is string => typeof x === "string") : null;
                  } catch {
                    accordes = null;
                  }
                }
                return (
                  <div key={appId}>
                    <dt>{appId}</dt>
                    <dd>
                      {jeton ? `jeton posé, rôle ${jeton.role}` : "aucun jeton posé : ce réglage ne sert plus à rien"}
                      {per
                        ? ` · réglée : niveau ≤ ${per.niveauMax}, ${
                            accordes === null
                              ? "domaines ILLISIBLES en base"
                              : accordes.length === 0
                                ? "aucun domaine"
                                : `${accordes.length} domaine(s) sur ${tousDomaines.length}`
                          }, ${per.role}${per.admetInvites ? "" : ", sans invités"}${per.domicile ? ", domicile inclus" : ""}`
                        : " · aucun réglage : le jeton décide seul"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <Link href="/apps" className="bouton bouton-second">
            Régler les périmètres…
          </Link>
        </details>

        <details className="repli">
          <summary>
            Liens entre faits — <strong>{n(comptes?.migresEnPiece)}</strong> papier(s) migré(s)
          </summary>
          <p className="hint">
            Les cinq règles de liaison, et le recalcul. ⚠️ Le DESSIN du graphe SERA retiré avec L30 (ADR 0005 §4 B3),
            quand la frise existera pour le remplacer : ce que les règles produisent se lira là et sur les fiches. Les
            règles, la table `liens` et le recalcul restent quoi qu’il arrive.
            {papiers ? ` ${papiers.total} papier(s) au total.` : ""}
          </p>
          <Link href="/graphe" className="bouton bouton-second">
            Ouvrir les liens
          </Link>
        </details>

        {/* ⚠️ La liste des domaines vivait ICI et dans `/moi`. Elle est entrée dans État, où
            elle porte aussi les COMPTES ; la garder en double dirait deux fois la même chose,
            une fois moins bien. */}
      </main>
    </>
  );
}

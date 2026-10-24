// app/memoire/page.tsx — LA PAGE MÉMOIRE : tout ce que LIA sait, en réseau 3D (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026, onglet « Mémoire »).
//
// ⚠️ LE RÉSEAU NE PORTE QUE DES PRÉDICATS, jamais une valeur (`lib/memoire/reseau.ts`) : la
// page montre la forme de la mémoire. Une valeur s'ouvre fait par fait, sur sa fiche, qui
// applique la politique des niveaux. Aucune donnée n'est donc déchiffrée pour dessiner.
//
// Les cinq onglets de la maquette sont dans la coque (`components/CoqueMemoire.tsx`) ; chacun est
// une page à part, avec ses propres lectures.

import { CoqueMemoire } from "@/components/CoqueMemoire";
import { CorpsTuile } from "@/components/TableauEspace";
import { Tuile, Vide } from "@/components/Tuile";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { depotMemoireDrizzle } from "@/lib/memoire/depotMemoire";
import { construireReseau } from "@/lib/memoire/reseau";
import { jourQuebec } from "@/lib/coutChat";
import { corpsAValider, corpsCroissance, corpsPapiers, corpsPlusRelies, corpsSources, corpsThemes } from "@/lib/memoire/tuilesMemoire";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { resteAJuger } from "@/lib/pile/charger";
import { requireSession } from "@/lib/session";
import { MemoireClient } from "./MemoireClient";

export const dynamic = "force-dynamic";
const LIMITE = 2000;
const LIMITE_LIENS = 20000;

export default async function MemoirePage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <CoqueMemoire actif="memoire">
        <Vide>{MESSAGES_MANQUE[acces.manque]}</Vide>
      </CoqueMemoire>
    );
  }

  // ⚠️ Les liens ENREGISTRÉS (`tous`), pas l'aperçu recalculé : l'aperçu déchiffre chaque fait
  // pour le comparer, et cette page n'a besoin d'aucune valeur.
  const memoire = depotMemoireDrizzle(acces.db);
  const [faitsBruts, liensEnBase, parSource, papiers, parDomaine, reste] = await Promise.all([
    depotLectureDrizzle(acces.db).faits({ statuts: ["valide"], limite: LIMITE }),
    depotLiensDrizzle(acces.db).tous(LIMITE_LIENS),
    memoire.faitsParSource(),
    memoire.nombrePapiers(),
    memoire.papiersParDomaine(),
    resteAJuger(acces.db, jourQuebec(new Date())),
  ]);
  const faits = faitsBruts.map((r) => ({ id: r.fait.id, predicat: r.fait.predicat, niveau: r.fait.niveau }));
  const ids = new Set(faits.map((f) => f.id));
  const liens = liensEnBase.filter((l) => l.cibleB === "fait" && ids.has(l.faitA) && ids.has(l.faitB));
  const reseau = construireReseau(faits, liens);

  return (
    <CoqueMemoire actif="memoire">
      <div className="tableau">
        <Tuile largeur={12} icone="net" titre="Tout ce qu’elle sait, relié">
          {faits.length === 0 ? (
            <Vide haute>
              En construction : aucun fait validé pour l&apos;instant. Le réseau se remplit à mesure que LIA apprend et
              que tu valides.
            </Vide>
          ) : (
            <MemoireClient reseau={reseau} totalLiens={liens.length} papiers={papiers} tronque={faitsBruts.length >= LIMITE} />
          )}
        </Tuile>
        <Tuile largeur={7} icone="target" titre="Thèmes">
          <CorpsTuile c={corpsThemes(faits)} />
        </Tuile>
        <Tuile largeur={5} icone="mail" titre="Sources">
          <CorpsTuile c={corpsSources(parSource, new Date())} />
        </Tuile>
        <Tuile largeur={6} icone="chart" titre="Croissance">
          <CorpsTuile c={corpsCroissance(faitsBruts.map((r) => r.fait), new Date())} />
        </Tuile>
        <Tuile largeur={6} icone="link" titre="Les plus reliés">
          <CorpsTuile c={corpsPlusRelies(faits, liens)} />
        </Tuile>
        <Tuile largeur={6} icone="alert" titre="À valider">
          {corpsAValider(reste).map((c, i) => (
            <CorpsTuile key={i} c={c} />
          ))}
        </Tuile>
        <Tuile largeur={6} icone="folder" titre="Papiers" repliee>
          <CorpsTuile c={corpsPapiers(parDomaine)} />
        </Tuile>
      </div>
    </CoqueMemoire>
  );
}

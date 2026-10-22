// app/memoire/page.tsx — LA PAGE MÉMOIRE : tout ce que LIA sait, en réseau 3D (MemoryAI#74,
// maquette v5 validée par Marc le 22/10/2026, onglet « Mémoire »).
//
// ⚠️ LE RÉSEAU NE PORTE QUE DES PRÉDICATS, jamais une valeur (`lib/memoire/reseau.ts`) : la
// page montre la forme de la mémoire. Une valeur s'ouvre fait par fait, sur sa fiche, qui
// applique la politique des niveaux. Aucune donnée n'est donc déchiffrée pour dessiner.
//
// Les autres onglets de la maquette (réseau de LIA, apprentissage, historique, accès) arrivent
// avec les lots qui produisent leurs données ; d'ici là la page ne les simule pas.

import { Nav } from "@/components/Nav";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { depotLiensDrizzle } from "@/lib/depotLiens";
import { construireReseau } from "@/lib/memoire/reseau";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
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
      <>
        <Nav active="memoire" />
        <main className="page">
          <h1>Mémoire</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }

  // ⚠️ Les liens ENREGISTRÉS (`tous`), pas l'aperçu recalculé : l'aperçu déchiffre chaque fait
  // pour le comparer, et cette page n'a besoin d'aucune valeur.
  const [faitsBruts, liensEnBase] = await Promise.all([
    depotLectureDrizzle(acces.db).faits({ statuts: ["valide"], limite: LIMITE }),
    depotLiensDrizzle(acces.db).tous(LIMITE_LIENS),
  ]);
  const faits = faitsBruts.map((r) => ({ id: r.fait.id, predicat: r.fait.predicat, niveau: r.fait.niveau }));
  const ids = new Set(faits.map((f) => f.id));
  const liens = liensEnBase.filter((l) => l.cibleB === "fait" && ids.has(l.faitA) && ids.has(l.faitB));
  const reseau = construireReseau(faits, liens);

  return (
    <>
      <Nav active="memoire" />
      <main className="page">
        <h1>Mémoire</h1>
        {faits.length === 0 ? (
          <p className="lead">
            En construction : aucun fait validé pour l&apos;instant. Le réseau se remplit à mesure que LIA apprend et
            que tu valides.
          </p>
        ) : (
          <MemoireClient reseau={reseau} totalFaits={faits.length} totalLiens={liens.length} tronque={faitsBruts.length >= LIMITE} />
        )}
      </main>
    </>
  );
}

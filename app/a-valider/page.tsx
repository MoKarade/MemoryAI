// app/a-valider/page.tsx — la file de validation, pensée pour un téléphone (Q20 b).
// Chaque fait proposé, déchiffré ici et nulle part ailleurs, avec ses trois gestes.

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { CarteFait, LIBELLES_FIABILITE } from "@/components/CarteFait";
import { depotAdminDrizzle } from "@/lib/depotAdmin";
import { depotLectureDrizzle } from "@/lib/depotLecture";
import { rendreLisible } from "@/lib/lecture";
import { DechiffrementError } from "@/lib/chiffrement";
import { accesDonnees, MESSAGES_MANQUE } from "@/lib/pageDonnees";
import { requireSession } from "@/lib/session";
import { depotMigrationDrizzle } from "@/lib/pieces/depotMigration";
import { LOT_MIGRATION } from "@/lib/pieces/migrerInventaire";
import { PREDICAT_MIGRE } from "@/lib/pieces/migration";
import {
  annulerMigrationAction,
  migrerLotAction,
  oublierAction,
  rejeterAction,
  restaurerAction,
  trancherPredicatAction,
  validerAction,
} from "./actions";

export const dynamic = "force-dynamic";
const LIMITE = 100;

export default async function AValiderPage() {
  await requireSession();
  const acces = await accesDonnees();
  if (!acces.ok) {
    return (
      <>
        <Nav active="a-valider" />
        <main className="page">
          <h1>À valider</h1>
          <p className="lead">{MESSAGES_MANQUE[acces.manque]}</p>
        </main>
      </>
    );
  }
  const admin = depotAdminDrizzle(acces.db);
  const rows = await admin.aValider(LIMITE);
  const comptes = await depotLectureDrizzle(acces.db).comptes();
  const total = comptes.parStatut.propose ?? 0;
  let illisibles = 0;
  const faits = rows.flatMap((r) => {
    try {
      return [{ f: rendreLisible(r, acces.cle), canari: r.fait.canari }];
    } catch (err) {
      if (err instanceof DechiffrementError) {
        illisibles++;
        return [];
      }
      throw err;
    }
  });
  const actions = { valider: validerAction, rejeter: rejeterAction, oublier: oublierAction };
  const enQuarantaine = await admin.predicatsEnQuarantaine(LIMITE);
  // Les faits remplacés, déchiffrés ici comme les proposés — et un illisible est COMPTÉ avec
  // les autres plutôt que de faire disparaître la section entière.
  const perimes = (await admin.perimes(LIMITE)).flatMap((r) => {
    try {
      return [{ f: rendreLisible(r, acces.cle), canari: r.fait.canari }];
    } catch (err) {
      if (err instanceof DechiffrementError) {
        illisibles++;
        return [];
      }
      throw err;
    }
  });
  const resteAMigrer = await depotMigrationDrizzle(acces.db).resteAMigrer(PREDICAT_MIGRE);

  return (
    <>
      <Nav active="a-valider" />
      <main className="page">
        <h1>À valider</h1>
        <p className="lead">
          {total === 0
            ? "Rien en attente. Un fait proposé par une app, par claude.ai ou par le chat apparaîtra ici."
            : `${total} fait(s) proposé(s)${total > LIMITE ? `, les ${LIMITE} plus récents ci-dessous` : ""}. Valider = servi comme sûr. Rejeter = gardé mais jamais servi. Oublier = supprimé, et il ne revient pas.`}
        </p>
        {illisibles > 0 && <p className="alerte bandeau">{illisibles} fait(s) illisibles (clé ou ligne altérée) — non affichés, non inventés.</p>}
        <section className="liste-faits" aria-label="Faits à valider">
          {faits.map(({ f, canari }) => (
            <CarteFait key={f.id} f={f} canari={canari} actions={actions} />
          ))}
        </section>
        {enQuarantaine.length > 0 && (
          <section className="carte tuile" aria-labelledby="quarantaine">
            <h2 id="quarantaine">Mots neufs, en attente</h2>
            <p className="hint">
              Des extracteurs ont employé ces mots — ils n’étaient pas dans le vocabulaire. Les faits
              sont gardés et cherchables, mais <strong>aucun Claude ne les voit</strong> tant que tu n’as
              pas tranché. Accepter = servi comme les autres. Refuser = gardé, jamais servi, et le volume
              ne l’annulera pas.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Mot</th>
                  <th>Fois</th>
                  <th>Proposé par</th>
                  <th>Depuis</th>
                  <th>Ton avis</th>
                </tr>
              </thead>
              <tbody>
                {enQuarantaine.map((q) => (
                  <tr key={q.predicat}>
                    <td>
                      <code>{q.predicat}</code>
                    </td>
                    <td>{q.nombre}</td>
                    <td>{q.extracteurs.length ? q.extracteurs.join(", ") : "—"}</td>
                    <td>{q.premiereVue.toISOString().slice(0, 10)}</td>
                    <td className="ligne">
                      <form action={trancherPredicatAction}>
                        <input type="hidden" name="predicat" value={q.predicat} />
                        <input type="hidden" name="verdict" value="accepte" />
                        <button type="submit" className="bouton bouton-principal">Accepter</button>
                      </form>
                      <form action={trancherPredicatAction}>
                        <input type="hidden" name="predicat" value={q.predicat} />
                        <input type="hidden" name="verdict" value="refuse" />
                        <button type="submit" className="bouton bouton-second">Refuser</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {resteAMigrer > 0 && (
          <section className="carte tuile" aria-labelledby="migration">
            <h2 id="migration">Inventaire des documents à déplacer</h2>
            <p className="hint">
              <strong>{resteAMigrer}</strong> fait(s) <code>{PREDICAT_MIGRE}</code> attendent de
              devenir des <em>pièces</em>. Ce ne sont pas des choses à valider : ils disent tous « ce
              document existe, il est là ». Ils encombrent cette file et cachent ce qui mérite
              vraiment ton avis. Un clic en déplace {LOT_MIGRATION} — rien n’est supprimé, et le
              bouton d’à côté défait tout.
            </p>
            <div className="ligne">
              <form action={migrerLotAction}>
                <button type="submit" className="bouton bouton-principal">Déplacer {LOT_MIGRATION} de plus</button>
              </form>
              <form action={annulerMigrationAction}>
                <button type="submit" className="bouton bouton-second">
                  Tout remettre comme avant
                </button>
              </form>
            </div>
          </section>
        )}
        {/* Les faits REMPLACÉS. Cette section n'existait pas, et son absence a coûté des
            données : valider un fait périme celui qu'il remplace, et rien ne montrait le
            remplacé. Voir `depotAdmin.perimes`. */}
        {perimes.length > 0 && (
          <section className="carte tuile" aria-labelledby="perimes">
            <h2 id="perimes">Faits remplacés</h2>
            <p className="hint">
              Ce que tu as remplacé en validant un autre fait du même prédicat. Rien n’est effacé. « Remettre en service »
              rétablit celui-ci <strong>et périme celui qui l’avait remplacé</strong> — c’est le retour en arrière exact.
            </p>
            <div className="liste-faits">
              {perimes.map(({ f, canari }) => (
                <article key={f.id} className={`carte tuile fait niveau-${f.niveau}${canari ? " canari" : ""}`}>
                  <p className="surtitre">
                    {f.domaine} · {f.predicat}
                  </p>
                  <p className="fait-valeur">{f.valeurType === "date" ? <time dateTime={f.valeur}>{f.valeur}</time> : f.valeur}</p>
                  <p className="hint">
                    source : {LIBELLES_FIABILITE[f.fiabiliteSource] ?? f.fiabiliteSource} · <Link href={`/fait/${f.id}`}>détail</Link>
                  </p>
                  <form action={restaurerAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className="bouton bouton-second">
                      Remettre en service
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </section>
        )}
        {comptes.refus.length > 0 && (
          <section className="carte tuile" aria-labelledby="refus">
            <h2 id="refus">Prédicats refusés</h2>
            <p className="hint">Ce que des écrivains ont tenté d’écrire hors du vocabulaire — le signal pour la version suivante. Jamais leur valeur.</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Prédicat</th>
                  <th>Par</th>
                  <th>Fois</th>
                </tr>
              </thead>
              <tbody>
                {comptes.refus.slice(0, 20).map((r) => (
                  <tr key={`${r.predicat}|${r.appelant}`}>
                    <td>
                      <code>{r.predicat}</code>
                    </td>
                    <td>{r.appelant}</td>
                    <td>{r.nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}

// components/OngletsMemoire.tsx — les onglets de la page Mémoire (maquette v5). Des liens, pas un
// état client : chaque onglet est une page, rendue au serveur avec ses propres lectures.
//
// ⚠️ Seuls les onglets qui EXISTENT sont listés. La maquette en montre cinq (Mémoire, Réseau,
// Apprentissage, Historique, Accès) ; un onglet sans page serait un bouton qui ment.

import Link from "next/link";

export const ONGLETS_MEMOIRE = [
  { cle: "memoire", href: "/memoire", libelle: "Mémoire" },
  { cle: "apprentissage", href: "/memoire/apprentissage", libelle: "Apprentissage" },
  { cle: "historique", href: "/memoire/historique", libelle: "Historique" },
  { cle: "acces", href: "/memoire/acces", libelle: "Accès" },
] as const;

export type OngletMemoire = (typeof ONGLETS_MEMOIRE)[number]["cle"];

export function OngletsMemoire({ actif }: { actif: OngletMemoire }) {
  return (
    <nav className="onglets-memoire" aria-label="Vues de la mémoire">
      {ONGLETS_MEMOIRE.map((o) => (
        <Link key={o.cle} href={o.href} className="onglet-memoire" aria-current={o.cle === actif ? "page" : undefined}>
          {o.libelle}
        </Link>
      ))}
    </nav>
  );
}

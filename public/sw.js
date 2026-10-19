// public/sw.js — service worker MINIMAL, avec un seul rôle : recevoir un partage Android.
//
// Ce qu'il ne fait PAS, volontairement : aucune mise en cache de pages ni de réponses d'API.
// MemoryAI affiche les données les plus personnelles de l'écosystème derrière une session ;
// un cache hors-ligne les laisserait sur l'appareil et servirait des écrans périmés.
//
// ⚠️ Les deux constantes ci-dessous DOIVENT rester identiques à celles de `lib/partage.ts`
// (un service worker ne peut rien importer). `tests/partage.test.ts` verrouille l'égalité.

const CACHE_PARTAGE = "memoryai-partage";
const CLE_META = "/__partage/meta";

// Prendre la main tout de suite : sans ça, le premier partage après l'installation tomberait
// sur un worker encore en attente et le POST partirait au serveur (405).
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // ⚠️ `mode === "navigate"` N'EST PAS UN DÉTAIL. Une Server Action de Next POSTe vers l'URL
  // de la PAGE COURANTE : sans ce test, ce worker l'avale et répond une redirection 303 au
  // lieu du résultat — « An unexpected response was received from the server », et des
  // journaux serveur VIDES puisque la réponse a été fabriquée dans le téléphone (vécu par
  // BatchChef le 13/08/2026). Logique identique à `doitIntercepterPartage`, verrouillée.
  if (event.request.method !== "POST") return;
  if (url.pathname !== "/partage") return;
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      const destination = new URL("/partage?recu=1", self.location.origin);
      try {
        const form = await event.request.formData();
        const cache = await caches.open(CACHE_PARTAGE);
        const meta = {
          titre: form.get("title") || "",
          texte: form.get("text") || "",
          url: form.get("url") || "",
        };
        // Un nouveau partage ÉCRASE le précédent : deux partages ne se mélangent pas, et
        // rien du précédent ne survit sur l'appareil une fois celui-ci consommé.
        await cache.put(
          CLE_META,
          new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }),
        );
      } catch (err) {
        // Échec honnête : la page dira « rien reçu » plutôt que d'afficher un écran vide qui
        // laisserait croire que le partage a marché.
        destination.searchParams.set("erreur", "1");
        console.error("[MemoryAI] partage non enregistré", err);
      }
      return Response.redirect(destination.toString(), 303);
    })(),
  );
});

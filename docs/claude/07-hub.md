<!-- Extrait de l'ancien CLAUDE.md (7. Intégration hub), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 7. Intégration hub

- **Identité publiée** : `id: "memoryai"`, `name: "MemoryAI"`, `url:
  "https://memoryai.hubperso.com"`. L'`id` doit rester identique à l'entrée de
  `Hubperso/lib/sources.ts` — c'est du code là-bas, donc un redéploiement du hub.
- **`HUB_TOKEN` sert dans UN SEUL sens ici** : entrant, le hub lit `/hub/summary`. Le sens
  sortant (`POST /api/acces`) n'existe pas : MemoryAI n'a pas d'invités.
- **`dataAsOf` ≠ `generatedAt`** : publier la date du dernier fait validé, pas « maintenant ».
- **Période des coûts** : `total`, comme les autres apps — le hub somme par période et ne
  fusionne jamais « cumulé » avec « ce mois-ci ».
- **Un champ additif optionnel ne casse rien** : les schémas strippent les clés inconnues.

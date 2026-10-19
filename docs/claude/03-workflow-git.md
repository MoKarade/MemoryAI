<!-- Extrait de l'ancien CLAUDE.md (3. Workflow git), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# 3. Workflow git

- Branches `claude/<slug>` pour le travail automatisé, `feature/<slug>` pour Marc.
- Commits en français, préfixés (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- **PR en brouillon** pour itérer. Un ADR « proposé » reste en brouillon jusqu'à l'OK de
  Marc ; tout le reste se fusionne dès que c'est vert et hors brouillon (règle de
  `claude-config`, confirmée par Marc le 15/09 pour ce dépôt).
- ❌ Jamais `--force` sur `main`. ❌ Jamais `--no-verify`.
- ⚠️ **`git fetch origin main` AVANT de committer.** Plusieurs sessions travaillent en
  parallèle sur l'écosystème.

# Contribuer

## Branches et commits
- `main` est toujours déployable ; travail sur des branches `feat/…`, `fix/…`, `chore/…` puis Pull Request (la CI doit être verte).
- Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/v1.0.0/) : `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`. Un changement cassant : `feat!:` ou `BREAKING CHANGE:` dans le corps.

## Versionnage (SemVer)
- `MAJOR` : changement cassant de l'API ou du schéma sans migration automatique. `MINOR` : nouvelle fonctionnalité compatible. `PATCH` : correction.
- Tant que la version est `0.x`, la plateforme n'est pas encore déclarée stable.

## Publier une version
1. Mettre à jour `CHANGELOG.md` : déplacer le contenu de `[Unreleased]` sous `## [X.Y.Z] - AAAA-MM-JJ`.
2. Mettre à jour `version` dans `package.json` (racine) **et** `apps/api/package.json`.
3. `git commit -am "chore(release): vX.Y.Z"` puis `git tag vX.Y.Z` puis `git push origin main vX.Y.Z`.
4. Le workflow `Release` vérifie la cohérence tag/version, rejoue les tests, publie l'image `ghcr.io/<owner>/<repo>/api:X.Y.Z` et crée la release GitHub avec les notes du CHANGELOG.

## Migrations
Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle (`002_…sql`).

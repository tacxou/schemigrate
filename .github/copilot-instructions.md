# GitHub Copilot — Schemigrate

## Contexte

Plugin Mongoose `@tacxou/schemigrate` pour versionner et migrer la structure des documents
MongoDB. Intégration NestJS via `@tacxou/schemigrate/nestjs`. Cahier des charges : `SPEC.md`.

## Messages de commit

Utiliser [Conventional Commits](https://www.conventionalcommits.org/) comme défini dans
[`docs/conventions/conventional-commits.md`](../docs/conventions/conventional-commits.md).

Format : `<type>(<scope>): <description>` — anglais, impératif, sujet ≤ 72 caractères.

Scopes : `core` · `nestjs` · `cli` · `deps` · `ci` · `root`.

Proposer des messages atomiques ; ne pas committer automatiquement.

## Versionnement

SemVer 2.0.0 **stricte** (`X.Y.Z`) : `fix` → PATCH, `feat` → MINOR, breaking → MAJOR.

## Invariants à respecter

- Pas de migration implicite au `find` — lever `OutdatedDocumentError` / `UnsupportedSchemaVersionError`.
- Champs réservés préfixés `__` ; ne pas utiliser `__v` pour Schemigrate.
- Le cœur ne dépend pas de NestJS.

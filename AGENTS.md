# Instructions agents IA — Schemigrate

Fichier lu par Cursor Agent, Codex, Copilot Agent et assistants similaires.

## Contexte

**Schemigrate** (`@tacxou/schemigrate`) est un plugin Mongoose pour versionner et migrer la structure des documents MongoDB. Cahier des charges : [`SPEC.md`](SPEC.md).

## Messages de commit

Suivre **Conventional Commits 1.0.0** — spécification complète :
[`docs/conventions/conventional-commits.md`](docs/conventions/conventional-commits.md)

Résumé :

```
<type>(<scope>): <description>
```

- Anglais, impératif, sujet ≤ 72 caractères, sans point final.
- Types : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Scopes : `core`, `nestjs`, `cli`, `deps`, `ci`, `root`.
- Proposer le message ; ne pas `git commit` / `git push` sans demande explicite.

## Versionnement

**SemVer 2.0.0 stricte** : format `X.Y.Z` ; `fix` → PATCH, `feat` → MINOR, breaking → MAJOR. Détails dans la spec ci-dessus.

## Règles métier essentielles

- **Jamais de migration implicite au `find`** — lever `OutdatedDocumentError` ou `UnsupportedSchemaVersionError`.
- Champs réservés Schemigrate préfixés par `__` ; ne pas détourner `__v`.
- Le cœur (`@tacxou/schemigrate`) **ne dépend pas de NestJS** ; l'intégration NestJS vit sous `@tacxou/schemigrate/nestjs`.
- Sync explicite uniquement (commande, `migrateMany`, démarrage opt-in).

## Enforcement

Génération assistée des messages : commande Cursor `/commit-message`.

Charte projet complète : [`CLAUDE.md`](CLAUDE.md).

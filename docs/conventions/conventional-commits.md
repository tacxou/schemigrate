# Conventions de messages de commit — Schemigrate

> Source de vérité partagée par Cursor, Claude Code, GitHub Copilot, Codex et tout agent IA du dépôt.
> Commits : [Conventional Commits 1.0.0](https://www.conventionalcommits.org/fr/v1.0.0/).
> Versions : [Semantic Versioning 2.0.0](https://semver.org/lang/fr/) (**stricte**).

## Format

```
<type>(<scope>): <description>

[corps optionnel — paragraphes séparés par une ligne vide]

[pied de page optionnel]
```

- **Langue** : anglais (sujet et corps).
- **Sujet** : impératif, minuscule après le `:`, sans point final, **≤ 72 caractères**.
- **Corps** : expliquer le *pourquoi*, pas seulement le *quoi* ; une ligne ≤ 100 caractères.
- **Pied de page** : références issues/PR, co-auteurs, breaking changes.

## Types autorisés

| Type | Usage |
|------|--------|
| `feat` | Nouvelle fonctionnalité (API publique, CLI, intégration NestJS) |
| `fix` | Correction de bug |
| `docs` | Documentation uniquement (SPEC, README, JSDoc) |
| `style` | Formatage, lint sans changement de logique |
| `refactor` | Restructuration sans feat ni fix |
| `perf` | Amélioration de performance |
| `test` | Ajout ou correction de tests |
| `build` | Build, bundling, scripts de publication |
| `ci` | GitHub Actions, hooks CI |
| `chore` | Maintenance diverse (config outillage) |
| `revert` | Annulation d'un commit précédent |

## Scopes

Utiliser **un seul scope** par commit, celui du périmètre principal touché :

| Scope | Périmètre |
|-------|-----------|
| `core` | Plugin Mongoose, moteur, erreurs, utils (`src/` hors `nestjs/` et `cli/`) |
| `nestjs` | Intégration NestJS (`src/nestjs/`) |
| `cli` | Interface en ligne de commande (`src/cli/`) |
| `deps` | Mises à jour de dépendances (`package.json`, lockfile) |
| `ci` | `.github/`, workflows |
| `root` | Racine (`SPEC.md`, `docs/`, règles IA, `vitest.config.ts`, config publish) |

Omettre le scope si le changement est réellement transversal et ne se rattache à aucun périmètre ci-dessus.

## Versionnement — SemVer stricte

Schemigrate applique **Semantic Versioning 2.0.0 sans dérogation** : toute version publiée
(tag Git, npm) est **`MAJOR.MINOR.PATCH`** (trois entiers non négatifs).

| Règle | Détail |
|-------|--------|
| Format | `X.Y.Z` uniquement — pas de `v1.2`, pas de quatrième segment libre |
| `MAJOR` | Incrément si changement **breaking** (API publique, contrat d'export) |
| `MINOR` | Incrément si **feat** rétrocompatible ; remise à zéro de `PATCH` |
| `PATCH` | Incrément si **fix** rétrocompatible |
| Pré-release | Suffixe explicite uniquement : `0.1.0-alpha.1`, `0.1.0-rc.1` |
| Phase `0.y.z` | Développement initial : `MINOR` peut introduire des breaks (SemVer §4) |

### Lien commits → bump de version

| Commit(s) depuis la dernière release | Bump |
|--------------------------------------|------|
| `fix` (seul ou dominant) | `PATCH` |
| `feat` (sans breaking) | `MINOR` |
| `BREAKING CHANGE` ou `type(scope)!:` | `MAJOR` |
| `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `build` | **Aucun** bump |

Les agents IA **signalent** le bump SemVer attendu lorsqu'ils proposent un message avec `feat`, `fix` ou breaking change.

## Breaking changes

- Sujet : `feat(core)!: remove migrateDocument from public API`
- Ou pied de page :
  ```
  BREAKING CHANGE: schemigratePlugin no longer accepts versionPath without __ prefix.
  ```

## Pieds de page courants

```
Refs: #42
Closes: #42
Co-authored-by: Name <email@example.com>
```

## Exemples (Schemigrate)

```
feat(core): add schemigratePlugin with __schemaVersion stamping
```

```
fix(core): raise OutdatedDocumentError on findOne with outdated document
```

```
feat(nestjs): add SchemigrateModule.forRootAsync with ConfigService
```

```
test(core): cover migration plan with missing down migration
```

```
docs(root): document conventional commit rules for AI assistants
```

## Règles pour les agents IA

1. **Proposer** un message conforme ; ne pas exécuter `git commit` ni `git push` sauf demande explicite (voir `CLAUDE.md` §0).
2. **Un commit = une intention** : ne pas mélanger feat core + refactor nestjs ; scinder en commits atomiques si nécessaire.
3. **Éviter** : `WIP`, `fix stuff`, `update`, sujets vagues sans type/scope.
4. **Revert** : `revert(<scope>): <sujet du commit annulé>` + corps avec hash court (`Refs: abc1234`).
5. **SemVer** : indiquer le bump attendu (`PATCH` / `MINOR` / `MAJOR`) quand le commit le justifie.

## Anti-exemples

```
❌ Add mongoose plugin
❌ fix bug
❌ feat(plugin): add migration engine
❌ WIP: schemigrate stuff
✅ feat(core): add schemigratePlugin with version guard on find
```

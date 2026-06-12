# CLAUDE.md — Règles du projet Schemigrate

Ce fichier fait foi pour toute contribution de Claude Code sur ce dépôt. Les règles
ci-dessous sont **impératives** et priment sur les habitudes par défaut.

Schemigrate est un plugin Mongoose permettant de gérer la version de structure des
documents MongoDB. Package npm `@tacxou/schemigrate`, avec intégration NestJS optionnelle
via le sous-chemin `@tacxou/schemigrate/nestjs`.

Source de vérité fonctionnelle : [`SPEC.md`](SPEC.md).

---

## 0. Règle absolue — Git

🚫 **Claude ne doit JAMAIS `git commit` ni `git push` de lui-même.**

- Préparer les modifications (édition de fichiers), proposer un message de commit si utile,
  puis **laisser l'utilisateur committer et pousser lui-même**.
- Cette règle s'applique même si l'utilisateur a précédemment approuvé un commit : chaque
  commit/push reste une action manuelle de l'utilisateur.
- **Format des messages** : Conventional Commits 1.0.0 — voir
  `docs/conventions/conventional-commits.md` (types, scopes, exemples).
  Sujet en anglais : `type(scope): description impérative`, ≤ 72 caractères, sans point final.
- **Versionnement** : SemVer 2.0.0 **stricte** (`MAJOR.MINOR.PATCH`) — même référence ;
  signaler le bump attendu (`PATCH` / `MINOR` / `MAJOR`) quand le commit le justifie.

---

## 1. Arborescence du dépôt

```
schemigrate/
├── src/
│   ├── index.ts           # Point d'entrée @tacxou/schemigrate (sans NestJS)
│   ├── plugin/              # Plugin Mongoose (schemigratePlugin)
│   ├── engine/              # Moteur de migration (up / down, plan, dry-run)
│   ├── errors/              # Erreurs typées
│   ├── utils/               # Helpers (createSchemaVersion, etc.)
│   └── nestjs/              # Intégration NestJS (sous-chemin séparé)
├── test/
│   ├── fixtures/            # Schemas, migrations et versions de test
│   ├── helpers/             # Mongo memory, create-test-model, Nest testing
│   ├── unit/                # Tests sans MongoDB
│   └── integration/         # Tests Mongoose + NestJS (mongodb-memory-server)
├── docs/
│   └── conventions/         # Conventions partagées (commits, etc.)
├── samples/                 # Exemples de référence (hors périmètre publishable)
├── SPEC.md                  # Cahier des charges
├── vitest.config.ts
└── package.json
```

### Exports npm

| Import | Contenu |
|--------|---------|
| `@tacxou/schemigrate` | Plugin, moteur, types, erreurs, batch, dry-run |
| `@tacxou/schemigrate/nestjs` | `SchemigrateModule`, `SchemigrateService`, helpers NestJS |

Le point d'entrée principal **ne réexporte pas** l'intégration NestJS.

---

## 2. Vérifications OBLIGATOIRES en fin de modification

À la fin de **toute** modification de code, avant de présenter le travail comme
terminé, lancer et faire passer au vert :

1. **Tests unitaires** :
   ```bash
   yarn test:unit
   ```
2. **Tests d'intégration** (si le changement touche le plugin, Mongoose ou NestJS) :
   ```bash
   yarn test:integration
   ```
3. **Suite complète** (recommandé avant de conclure) :
   ```bash
   yarn test
   ```
4. **Vérification TypeScript** (si script disponible) :
   ```bash
   yarn typecheck
   ```

Règles : ne jamais contourner un hook ni un échec (`--no-verify` interdit). Si un
check échoue, corriger la cause racine. Une feature n'est « terminée » que lorsque
les tests pertinents passent au vert.

Couverture cible (SPEC §45) : ≥ 80 % lignes/fonctions, ≥ 75 % branches.

---

## 3. Philosophie et invariants métier

Ces règles sont **non négociables** — toute implémentation doit les respecter :

| Invariant | Comportement |
|-----------|--------------|
| Lecture (`find`) | **Aucune migration implicite** ; lever une erreur typée si version incompatible |
| Sync | Explicite : `migrateMany`, `migrateById`, CLI, ou `autoRunOnBootstrap` opt-in |
| `__v` | Réservé à Mongoose — ne pas l'utiliser pour Schemigrate |
| Champs réservés | Préfixe `__` (`__schemaVersion`, `__migrationSnapshots`, etc.) |
| Versions | Timestamps ms UTC par défaut (`createSchemaVersion()`) |
| `toJSON` | Masquer les champs `__*` par défaut (`hideInToJSON: true`) |
| Bypass lecture | Par requête uniquement : `.setOptions({ schemigrateCheck: false })` |
| Snapshots | Conservés par défaut ; nettoyage uniquement sur action explicite |
| Downgrade | Possible si migrations `down` définies ; jamais silencieux |

---

## 4. Règles CORE (`src/` hors `nestjs/`)

**Nommage**
- Fonctions / méthodes / variables : `camelCase`
- Classes / types / interfaces / erreurs : `PascalCase`
- Fichiers : `kebab-case` avec suffixe de rôle :
  `*.plugin.ts`, `*.service.ts` (moteur interne), `*.error.ts`, `*.spec.ts`…

**Style**
- TypeScript strict, typage explicite des API publiques, pas de `any` implicite.
- Le cœur **ne doit pas importer** `@nestjs/*` ni dépendre de NestJS.
- Erreurs typées avec propriétés structurées (cf. SPEC §26).
- Logger injectable / configurable ; pas de `console.log` en production.

**Migrations**
- Fonctions `up` / `down` pures sur le document ; effets de bord limités et documentés.
- Valider la chaîne de migrations à l'initialisation du plugin.
- Chaque migration : `from`, `to`, `description`, `up` ; `down` optionnel mais requis pour le downgrade.

---

## 5. Règles NESTJS (`src/nestjs/`)

- Import explicite : `@tacxou/schemigrate/nestjs` — jamais depuis `index.ts`.
- `SchemigrateModule.forRoot()` / `forRootAsync()` pour la configuration globale.
- `SchemigrateModule.forFeature()` pour enregistrer les modèles migrables.
- `SchemigrateService` comme façade d'orchestration (bootstrap, status, migration batch).
- Exceptions NestJS dérivées des erreurs typées du cœur.
- Tests via `@nestjs/testing` + `mongodb-memory-server` pour l'intégration.

---

## 6. Tests

| Type | Cible | Outil |
|------|-------|-------|
| Unitaire | Moteur, validation, snapshots, versioning | Vitest, objets JS simples, pas de MongoDB |
| Intégration Mongoose | Plugin, hooks, `save`/`find`, batch | Vitest + mongodb-memory-server |
| Unitaire NestJS | Module, service, registre | Vitest + `@nestjs/testing` |
| Intégration NestJS | Module complet, bootstrap | Vitest + mongodb-memory-server |

Fixtures partagées dans `test/fixtures/` — réutiliser les timestamps de la SPEC
(`CONTAINER_SCHEMA_V1`, `V2`, `V3`).

Chaque erreur typée et chaque comportement critique listé en SPEC §45.7 doit avoir
au moins un test dédié.

---

## 7. Bibliothèques à privilégier

| Domaine | Stack imposée |
|---------|---------------|
| **Runtime** | Mongoose 8.x · TypeScript |
| **Tests** | Vitest · mongodb-memory-server · @vitest/coverage-v8 |
| **NestJS** | @nestjs/common · @nestjs/mongoose · @nestjs/testing 11.x |

Ne pas introduire d'ORM alternatif, de moteur de migration concurrent ou de dépendance
NestJS dans le cœur sans validation explicite de l'utilisateur.

---

## 8. Documentation

- Toute évolution d'API publique doit être reflétée dans `SPEC.md` ou la doc utilisateur.
- Les exemples Mongoose et NestJS de la SPEC (§28, §32, §54, §55) servent de référence.
- Ne pas créer de fichiers markdown non demandés ; privilégier la mise à jour de l'existant.

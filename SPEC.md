# Cahier des charges — Schemigrate

## 1. Présentation

**Schemigrate** est un plugin Mongoose permettant de gérer la version de structure des documents MongoDB.

Il permet à une application de faire évoluer ses documents dans le temps, en appliquant des migrations similaires aux migrations SQL, mais au niveau des documents MongoDB.

Schemigrate ne remplace pas `__v`.

Le champ `__v` reste réservé à Mongoose pour ses mécanismes internes. Schemigrate utilise ses propres champs réservés, préfixés par un double underscore, par exemple :

```ts
__schemaVersion: 1781251200000 // timestamp de création de la version (2026-06-12T08:00:00.000Z)
```

---

## 2. Nom du projet

Nom retenu :

```txt
Schemigrate
```

Package npm :

```txt
@tacxou/schemigrate
```

Intégration NestJS (sous-chemin d’export, pas un package séparé) :

```txt
@tacxou/schemigrate/nestjs
```

L’intégration NestJS n’est pas réexportée depuis `index.ts`. Elle doit être importée explicitement via le sous-chemin `@tacxou/schemigrate/nestjs`.

Exemple d’utilisation Mongoose :

```ts
import { schemigratePlugin } from '@tacxou/schemigrate';
```

Avec NestJS :

```ts
import { SchemigrateModule } from '@tacxou/schemigrate/nestjs';
```

---

## 3. Objectifs

Schemigrate doit permettre :

* d’utiliser des timestamps comme versions de structure par défaut ;
* d’ajouter automatiquement des champs réservés (préfixés `__`) sur les documents ;
* de masquer ces champs par défaut dans les réponses `toJSON` ;
* de détecter les documents trop anciens et lever une exception à la lecture ;
* de détecter les documents trop récents et lever une exception à la lecture ;
* de migrer un document vers une version supérieure ;
* de rétrograder un document vers une version inférieure si les migrations `down` existent ;
* de gérer les migrations document par document ;
* de gérer les migrations en masse ;
* de conserver des snapshots des données modifiées lors des migrations `up` et `down` ;
* de permettre un rollback explicite à partir d’un snapshot ;
* de proposer un nettoyage explicite des snapshots accumulés ;
* de proposer un mode `dry-run` ;
* de fonctionner en pur Mongoose ;
* de proposer une intégration officielle NestJS ;
* de synchroniser les documents obsolètes vers la version courante du schema, via commande ou au démarrage ;
* d’exposer le statut des migrations et le downgrade via commandes dédiées.

---

## 3.1 Flux opérationnel (récapitulatif)

Schemigrate suit un flux simple, centré sur la **version courante du schema** (`currentVersion`) et l’**état réel des documents** (`__schemaVersion`).

### Lecture (`find`) — aucune migration implicite

Lors d’un `find`, `findOne`, `findById` ou équivalent, Schemigrate **ne met jamais à jour** un document pour l’aligner sur le schema.

Si `__schemaVersion` du document ne correspond pas à la version attendue (`currentVersion` ou version cible de l’opération), Schemigrate doit **lever une exception** (`OutdatedDocumentError` ou `UnsupportedSchemaVersionError`).

```ts
const container = await Container.findById(id);
// ❌ lève OutdatedDocumentError si __schemaVersion < currentVersion
// ❌ lève UnsupportedSchemaVersionError si __schemaVersion > currentVersion
```

La migration d’un document obsolète reste une action **explicite** (commande, démarrage opt-in, ou appel API dédié). Elle ne se produit jamais en lecture.

#### Bypass explicite de la garde de lecture

Pour les besoins internes du moteur et les cas d’administration, la garde de lecture doit pouvoir être désactivée **au niveau de la requête**, jamais globalement :

```ts
const doc = await Container.findById(id).setOptions({ schemigrateCheck: false });
```

C’est ce mécanisme qu’utilisent en interne `migrateById`, `migrateMany`, `rollbackMigrationById`, `abortMigration*` et `findOutdatedDocuments` pour charger des documents obsolètes sans déclencher `OutdatedDocumentError`. Sans ce bypass, ces méthodes seraient inutilisables par construction.

### Upgrade — synchroniser les documents obsolètes

Si `__schemaVersion` d’un document est **inférieur** à `currentVersion`, le document est obsolète et doit être migré vers le haut.

Ce sync peut être déclenché de deux façons (jamais via `find`) :

1. **Au démarrage de l’application** (option `autoRunOnBootstrap`, désactivée par défaut) ;
2. **Via une commande explicite** :

```bash
schemigrate up Container
schemigrate up Container --to 1782460800000
schemigrate up --all
```

Équivalent programmatique :

```ts
await Container.migrateMany(
  { __schemaVersion: { $lt: currentVersion } },
  currentVersion,
);
```

### Status — inspecter l’état avant d’agir

Avant ou après une migration, on doit pouvoir consulter l’état :

```bash
schemigrate status
schemigrate status Container
```

Résultat attendu :

```ts
{
  model: 'Container',
  currentVersion: 1782460800000,
  outdatedDocuments: 42,
  currentDocuments: 1180,
  newerDocuments: 0,
  failedDocuments: 2,
  inProgressDocuments: 0,
}
```

### Downgrade — revenir à une version antérieure

Le downgrade est **toujours explicite** (jamais silencieux) :

```bash
schemigrate down Container --to 1781856000000
schemigrate down Container --id 64f... --to 1781856000000
```

Il nécessite des migrations `down` déclarées et `allowDowngrade: true`.

### Métadonnées de migration — toujours conservées

Pendant toute opération (`up`, `down`, `dry-run`, échec partiel), Schemigrate doit **conserver les métadonnées** des anciennes versions de schema dans des champs réservés `__*`, afin de pouvoir :

* **downgrader** un document vers une version antérieure ;
* **annuler une upgrade échouée** à mi-parcours ;
* **simuler** une migration en `dry-run` sans surprise (même logique, sans écriture).

Champs concernés :

```ts
__schemaVersion          // version actuelle du document
__migrationSnapshots     // données sauvegardées avant chaque étape
__migrationState         // état d’une migration en cours ou échouée
```

Par défaut, `storeSnapshots: 'both'` est activé. Les métadonnées ne sont supprimées que via une commande de nettoyage explicite.

### Dry-run — prévisualiser sans écrire

```bash
schemigrate dry-run Container
schemigrate dry-run Container --to 1782460800000
```

Le dry-run doit :

* calculer le même plan de migration que l’upgrade réel ;
* simuler les snapshots qui seraient créés ;
* retourner un rapport détaillé ;
* **ne jamais écrire** en base.

### Annulation après échec

Grâce au modèle d’exécution atomique (voir section 15.0), une migration qui échoue (ex. étape 2 sur 3) **n’écrit aucune donnée métier** : le plan est appliqué en mémoire et persisté en une seule écriture. En cas d’échec, seul un marqueur `__migrationState: { status: 'failed', ... }` est enregistré, à des fins de diagnostic et de comptage par `schemigrate status`. L’annulation consiste alors à nettoyer ce marqueur :

```bash
schemigrate rollback Container --id 64f... --step 1781856000000_to_1782460800000
schemigrate abort Container --id 64f...
```

```ts
await doc.abortMigration({ save: true });
await Container.abortMigrationMany({ '__migrationState.status': 'failed' });
```

`abortMigration` nettoie le marqueur d’échec et, si des écritures partielles existaient malgré tout (futur mode d’exécution par étape persistée), restaure le document via `__migrationSnapshots` et `__migrationState`.

### Schéma du flux

```txt
Démarrage app ──► autoRunOnBootstrap ? ──► migrateMany(up)
                         │
Commande CLI ──► status / dry-run / up / down / rollback / abort
                         │
              __schemaVersion < currentVersion ?
                    │ oui                │ non
                    ▼                    ▼
              migration up          document à jour
                    │
      plan appliqué en mémoire, snapshots calculés par étape
                    │
              succès ──► 1 écriture atomique
                         (champs migrés + __schemaVersion = target
                          + __migrationSnapshots)
              échec  ──► aucune écriture métier
                         __migrationState = failed ──► abort
```

---

## 4. Problème à résoudre

Dans une application MongoDB, la structure des documents peut évoluer entre plusieurs versions du logiciel.

Chaque version de structure est identifiée par un **timestamp de création** (millisecondes UTC), pas par un numéro séquentiel.

```ts
// Timestamps de référence pour les exemples de ce document
const CONTAINER_SCHEMA_V1 = 1781251200000; // 2026-06-12T08:00:00.000Z
const CONTAINER_SCHEMA_V2 = 1781856000000; // 2026-06-19T08:00:00.000Z
const CONTAINER_SCHEMA_V3 = 1782460800000; // 2026-06-26T08:00:00.000Z
```

Version initiale (`CONTAINER_SCHEMA_V1`) :

```ts
{
  name: "nginx",
  port: "80:80",
  __schemaVersion: 1781251200000
}
```

Version intermédiaire (`CONTAINER_SCHEMA_V2`) :

```ts
{
  name: "nginx",
  ports: ["80:80"],
  __schemaVersion: 1781856000000
}
```

Version courante (`CONTAINER_SCHEMA_V3`) :

```ts
{
  name: "nginx",
  ports: ["80:80"],
  network: {
    mode: "bridge"
  },
  __schemaVersion: 1782460800000
}
```

Le logiciel doit pouvoir :

* lire un ancien document ;
* savoir qu’il est obsolète ;
* appliquer les migrations nécessaires ;
* sauvegarder ou non le document migré ;
* refuser un document trop récent ;
* éventuellement rétrograder un document pour une ancienne version du logiciel.

---

## 5. Champs réservés et convention de nommage

### `__v` (Mongoose)

`__v` est un champ technique Mongoose.

Exemple :

```ts
{
  __v: 0
}
```

Il ne doit pas être utilisé pour gérer les versions métier ou les migrations applicatives.

### Champs réservés Schemigrate (`__*`)

Tous les champs gérés par Schemigrate doivent être préfixés par un double underscore (`__`). Cette convention les distingue des champs métier et évite les collisions avec les propriétés applicatives.

Champs réservés par défaut :

```ts
__schemaVersion: number;      // timestamp ms UTC — version de structure du document
__createdByVersion?: string;  // version applicative à la création (informatif)
__updatedByVersion?: string;  // version applicative à la dernière mise à jour (informatif)
__migrationSnapshots?: object; // snapshots des données modifiées/supprimées lors des migrations
__migrationState?: object;     // état d'une migration en cours, échouée ou interrompue
```

Exemple :

```ts
{
  __schemaVersion: 1782460800000
}
```

Le champ `__schemaVersion` représente la version de structure du document. Par défaut, c’est le **timestamp de création** de la version de schema concernée. Il sert de base aux migrations et se compare chronologiquement (`$lt`, `$gt`).

Les champs `__createdByVersion` et `__updatedByVersion` sont informatifs. Ils ne doivent pas servir de base principale aux migrations.

Aucun champ Schemigrate ne doit être déclaré sans le préfixe `__`.

---

## 6. Exemple de document cible

```ts
{
  _id: "...",
  name: "nginx",
  image: "nginx:latest",
  ports: ["80:80"],
  network: {
    mode: "bridge"
  },

  __schemaVersion: 1782460800000,

  __createdByVersion: "1.4.0",
  __updatedByVersion: "1.6.2",

  createdAt: "2026-06-12T10:00:00.000Z",
  updatedAt: "2026-06-12T10:00:00.000Z"
}
```

Champs recommandés :

```ts
__schemaVersion: number;
__createdByVersion?: string;
__updatedByVersion?: string;
```

Le champ `__schemaVersion` doit être utilisé pour les migrations.

Les champs `__createdByVersion` et `__updatedByVersion` peuvent être utilisés à titre informatif, mais ne doivent pas servir de base principale aux migrations.

---

## 7. Architecture du package

Un seul package npm est publié :

```txt
@tacxou/schemigrate
```

L’intégration NestJS est exposée via un sous-chemin d’export, pas via un package séparé :

```txt
@tacxou/schemigrate/nestjs
```

### Point d’entrée principal (`index.ts`)

Exporté depuis `@tacxou/schemigrate` :

* le plugin Mongoose ;
* le moteur de migration ;
* les types TypeScript ;
* les erreurs ;
* les méthodes de migration ;
* le support batch ;
* le mode dry-run.

Le point d’entrée principal ne doit pas dépendre de NestJS et ne doit pas réexporter l’intégration NestJS.

### Sous-chemin NestJS (`@tacxou/schemigrate/nestjs`)

Intégration optionnelle, importée explicitement via le sous-chemin. Non exportée depuis `index.ts`.

Elle contient :

* `SchemigrateModule` ;
* `SchemigrateService` ;
* l’intégration avec `ConfigService` ;
* l’intégration avec le logger NestJS ;
* les helpers d’exceptions NestJS ;
* éventuellement une CLI et un healthcheck dans une version future.

Configuration `package.json` attendue :

```json
{
  "name": "@tacxou/schemigrate",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./nestjs": {
      "types": "./dist/nestjs/index.d.ts",
      "import": "./dist/nestjs/index.js",
      "require": "./dist/nestjs/index.cjs"
    }
  }
}
```

---

## 8. Ajout automatique des champs réservés

Le plugin doit ajouter automatiquement les champs réservés Schemigrate sur le schema.

Par défaut :

```ts
__schemaVersion: number // timestamp ms UTC
```

Configuration :

```ts
schema.plugin(schemigratePlugin, {
  currentVersion: 1782460800000,
  versionPath: '__schemaVersion',
  migrations: [],
});
```

Le chemin du champ de version doit être configurable, mais tout champ réservé Schemigrate doit conserver le préfixe `__`.

Exemples :

```ts
versionPath: '__schemaVersion'
```

ou :

```ts
versionPath: '_metadata.__schemaVersion'
```

### 8.1 Masquage dans `toJSON`

Par défaut, le plugin doit masquer tous les champs réservés Schemigrate lors de la sérialisation `toJSON` (et `toObject` avec `transform`).

Comportement attendu :

```ts
const doc = await Container.findById(id);

doc.toJSON();
// => { name: "nginx", ports: ["80:80"], ... }
// les champs __schemaVersion, __createdByVersion, etc. sont absents
```

Le plugin doit configurer le schema pour exclure ces champs de la sortie JSON par défaut, sans empêcher leur lecture/écriture en base ni leur utilisation interne par le moteur de migration.

Configuration :

```ts
schema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V3,
  hideInToJSON: true, // valeur par défaut
});
```

Si `hideInToJSON` est à `false`, les champs réservés restent visibles dans `toJSON`.

Si un chemin imbriqué est utilisé (ex. `versionPath: '_metadata.__schemaVersion'`), seule la **feuille** réservée est masquée, jamais l’objet conteneur : `_metadata` reste visible s’il contient des champs métier, et est retiré s’il devient vide après masquage.

Le plugin doit composer proprement avec un `toJSON.transform` existant sur le schema, sans écraser la transformation applicative.

Champs masqués par défaut :

```ts
__schemaVersion
__createdByVersion
__updatedByVersion
__migrationSnapshots
__migrationState
```

---

## 9. Convention de versionnement par timestamp

Par défaut, les versions de structure sont des **timestamps Unix en millisecondes** (`number`), correspondant à la date de **création de la migration** qui introduit cette version.

### Pourquoi des timestamps ?

* pas de numérotation manuelle à maintenir (`1`, `2`, `3`…) ;
* ordre chronologique garanti : une version plus récente a toujours un timestamp plus élevé ;
* comparaisons MongoDB naturelles (`$lt`, `$gt`, `$lte`, `$gte`) ;
* traçabilité : la version indique quand la structure a été définie.

### Type

```ts
type SchemaVersion = number; // timestamp ms UTC
```

### Helper de création

Schemigrate doit fournir un helper pour créer des versions de manière explicite :

```ts
createSchemaVersion(isoDate?: string): SchemaVersion;

createSchemaVersion('2026-06-12T08:00:00.000Z'); // => 1781251200000
createSchemaVersion(); // => Date.now() — pour une nouvelle migration au moment de son ajout
```

### Déclaration d’une nouvelle version

Lors de l’ajout d’une migration, le développeur fixe `to` au timestamp de création de cette version :

```ts
{
  from: CONTAINER_SCHEMA_V2,
  to: createSchemaVersion('2026-06-26T08:00:00.000Z'),
  description: 'Add network configuration',
  up: async (doc) => { /* ... */ },
}
```

Le timestamp peut aussi être une constante nommée exportée :

```ts
export const CONTAINER_SCHEMA_V3 = 1782460800000;
```

### Conflits de branches Git

Deux branches développées en parallèle peuvent déclarer chacune une migration partant de la même version (`from` identique). Après merge, la chaîne devient ambiguë.

Règles :

* la validation (section 25) rejette deux migrations avec le même `from` (ou le même `to`) ;
* la branche mergée en second doit **rebaser sa migration** : son `from` devient le `to` de la migration mergée en premier, et son `to` est régénéré (`createSchemaVersion()`) s’il est antérieur au nouveau `from` ;
* cette procédure doit être documentée dans le README.

### Mode séquentiel (optionnel, hors MVP)

Pour les projets existants, un mode alternatif peut être proposé :

```ts
versionStrategy: 'sequential' // 'timestamp' par défaut
```

En mode `sequential`, les versions restent des entiers (`1`, `2`, `3`). Ce mode ne change que la **validation** (`to > from` reste exigé, mais aucune sémantique temporelle n’est attendue) ; le moteur compare les versions numériquement dans les deux modes. Ce mode n’est pas recommandé pour les nouveaux projets et n’est pas inclus dans le MVP.

---

## 10. Version courante et version par défaut

Chaque schema utilisant Schemigrate doit définir une version courante : le timestamp de la dernière migration déclarée.

```ts
currentVersion: CONTAINER_SCHEMA_V3 // 1782460800000
```

Cette version représente la structure de document attendue par la version actuelle du logiciel.

Si un document n’a pas encore de version, Schemigrate doit pouvoir appliquer une version par défaut : le timestamp de la version initiale du schema.

```ts
defaultVersion: CONTAINER_SCHEMA_V1 // 1781251200000
```

Comportement possible :

```ts
{
  name: "nginx"
}
```

Devient :

```ts
{
  name: "nginx",
  __schemaVersion: 1781251200000
}
```

Après chaque migration réussie, Schemigrate met automatiquement à jour `__schemaVersion` à `migration.to`. Les fonctions `up` et `down` ne doivent pas avoir à le faire manuellement.

Le comportement en cas d’absence de version doit être configurable :

```ts
unknownVersionStrategy: 'throw' | 'ignore' | 'setDefault'
```

Valeur recommandée par défaut :

```ts
unknownVersionStrategy: 'throw'
```

### 10.1 Version des nouveaux documents

À la **création** d’un document par l’application, Schemigrate doit stamper automatiquement la version courante, sauf si le champ a été renseigné explicitement (imports, fixtures de test) :

* `pre('save')` avec `isNew === true` et version absente → `__schemaVersion = currentVersion` ;
* hook `insertMany` → chaque document inséré sans version reçoit `currentVersion` ;
* `findOneAndUpdate` / `updateOne` avec `upsert: true` → `$setOnInsert: { __schemaVersion: currentVersion }`.

`defaultVersion` ne concerne que les documents **legacy** déjà présents en base sans champ de version (via `unknownVersionStrategy: 'setDefault'`). Un document créé par l’application reçoit toujours `currentVersion`, jamais `defaultVersion`. Sans ce stamping, tout nouveau document lèverait `MissingSchemaVersionError` à la relecture.

---

## 11. Déclaration des migrations

Une migration décrit un passage d’une version à une autre. Les versions `from` et `to` sont des timestamps (`SchemaVersion`).

```ts
type Migration = {
  from: SchemaVersion;
  to: SchemaVersion;
  up: (doc: any, context: MigrationContext) => any | Promise<any>;
  down?: (doc: any, context: MigrationContext) => any | Promise<any>;
  description?: string;
};
```

### Les migrations opèrent sur des objets bruts (POJO)

Les fonctions `up` et `down` reçoivent un **objet JavaScript brut** (lecture `lean()` ou driver natif), jamais un document Mongoose hydraté.

Raison : Mongoose est `strict: true` par défaut. Un champ legacy absent du schema courant (ex. `port` en V1 alors que le schema courant ne déclare que `ports`) n’est ni accessible sur un document hydraté, ni conservé par `save()`. Les migrations doivent donc lire et écrire **au niveau collection** (`updateOne` / `bulkWrite`), sans passer par l’hydratation ni la validation du schema courant pour les états intermédiaires.

Conséquence : il n’est pas nécessaire de conserver les champs legacy dans le schema courant pour que les migrations fonctionnent.

Exemple :

```ts
const CONTAINER_SCHEMA_V1 = 1781251200000; // 2026-06-12T08:00:00.000Z
const CONTAINER_SCHEMA_V2 = 1781856000000; // 2026-06-19T08:00:00.000Z
const CONTAINER_SCHEMA_V3 = 1782460800000; // 2026-06-26T08:00:00.000Z

const containerMigrations = [
  {
    from: CONTAINER_SCHEMA_V1,
    to: CONTAINER_SCHEMA_V2,
    description: 'Transform port string into ports array',
    up: async (doc) => {
      if (doc.port && !doc.ports) {
        doc.ports = [doc.port];
      }

      delete doc.port;
      return doc;
    },
    down: async (doc) => {
      if (Array.isArray(doc.ports)) {
        doc.port = doc.ports[0];
      }

      delete doc.ports;
      return doc;
    },
  },
  {
    from: CONTAINER_SCHEMA_V2,
    to: CONTAINER_SCHEMA_V3,
    description: 'Add network configuration',
    up: async (doc) => {
      doc.network ??= {
        mode: 'bridge',
      };

      return doc;
    },
    down: async (doc) => {
      delete doc.network;
      return doc;
    },
  },
];
```

Schemigrate met à jour `__schemaVersion` à `migration.to` après chaque étape réussie.

---

## 12. Contexte de migration

Chaque migration doit recevoir un contexte.

```ts
type MigrationContext = {
  modelName?: string;
  documentId?: string;
  fromVersion: SchemaVersion;
  toVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  direction: 'up' | 'down';
  dryRun: boolean;
  logger?: SchemigrateLogger;
};
```

Ce contexte permet de logger, tracer et diagnostiquer les migrations.

---

## 13. Migration ascendante

Si un document est en version inférieure à la version courante, Schemigrate doit appliquer les migrations `up`.

Exemple :

```txt
Document version: 1781251200000 (CONTAINER_SCHEMA_V1)
Target version: 1782460800000 (CONTAINER_SCHEMA_V3)
```

Plan de migration :

```txt
1781251200000 -> 1781856000000
1781856000000 -> 1782460800000
```

Le document doit être migré étape par étape.

Schemigrate ne doit pas sauter une version si des migrations intermédiaires existent.

---

## 14. Migration descendante

Si un document est dans une version supérieure à la version cible, Schemigrate peut appliquer les migrations `down`.

Exemple :

```txt
Document version: 1782460800000 (CONTAINER_SCHEMA_V3)
Target version: 1781251200000 (CONTAINER_SCHEMA_V1)
```

Plan de migration :

```txt
1782460800000 -> 1781856000000
1781856000000 -> 1781251200000
```

Les migrations descendantes doivent être optionnelles.

Par défaut :

```ts
allowDowngrade: false
```

Si le downgrade est demandé mais interdit, Schemigrate doit lever une erreur.

Si le downgrade est autorisé mais qu’une migration `down` manque, Schemigrate doit lever une erreur explicite.

---

## 15. Métadonnées de migration, snapshots et rollback

Une migration `up` ou `down` peut modifier ou supprimer des champs métier. Schemigrate doit **toujours conserver les métadonnées** nécessaires au downgrade, à l’annulation d’une upgrade échouée et au dry-run.

Ces métadonnées vivent dans des champs réservés `__*` et ne sont jamais exposées dans `toJSON` par défaut.

### 15.0 Modèle d’exécution : en mémoire, écriture atomique unique

Pour chaque document, une migration multi-étapes s’exécute ainsi :

1. lecture du document en POJO (`lean()`, bypass de la garde de lecture) ;
2. calcul du plan complet (`from` → … → `target`) ;
3. application de **toutes les étapes en mémoire**, sur une copie, avec calcul des snapshots à chaque étape ;
4. **une seule écriture** en base, conditionnée par la version de départ (verrou optimiste) :

```ts
await collection.updateOne(
  { _id, __schemaVersion: fromVersion },
  { $set: { ...champsMigrés, __schemaVersion: targetVersion, __migrationSnapshots } },
);
```

Garanties :

* un crash ou une erreur en cours de plan **n’écrit rien** : le document reste intact à `fromVersion` ;
* si `matchedCount === 0`, le document a été modifié ou migré par un autre processus entre la lecture et l’écriture — il est re-traité ou compté comme `skipped`, jamais écrasé ;
* en cas d’échec d’une fonction de migration, seule une écriture de diagnostic est effectuée : `__migrationState = { status: 'failed', ... }`, sans aucune modification des champs métier.

Un mode d’exécution **par étape persistée** (une écriture par étape du plan) pourra être proposé dans une version future pour les très gros documents ; il est hors MVP.

### 15.1 Principe

Avant d’appliquer une migration, Schemigrate capture les champs qui vont être modifiés ou supprimés, puis les stocke dans un champ réservé du document.

Champ réservé par défaut :

```ts
__migrationSnapshots: object
```

Structure recommandée :

```ts
{
  __schemaVersion: 1781856000000,

  name: "nginx",
  ports: ["80:80"],

  __migrationSnapshots: {
    "1781251200000_to_1781856000000": {
      direction: "up",
      fromVersion: 1781251200000,
      toVersion: 1781856000000,
      migratedAt: "2026-06-19T08:00:05.000Z",
      data: {
        port: "80:80"
      }
    },
    "1782460800000_to_1781856000000": {
      direction: "down",
      fromVersion: 1782460800000,
      toVersion: 1781856000000,
      migratedAt: "2026-06-26T09:15:00.000Z",
      data: {
        network: {
          mode: "bridge"
        }
      }
    }
  }
}
```

Chaque clé de snapshot correspond à une étape de migration (`{from}_to_{to}`), les valeurs étant des timestamps.

Le snapshot ne doit contenir que les données nécessaires au rollback de l’étape concernée, pas une copie complète du document.

#### Algorithme de capture

Les fonctions `up`/`down` étant arbitraires, Schemigrate ne peut pas savoir à l’avance quels champs seront touchés. La capture se fait par **diff avant/après** :

1. clone profond du POJO avant l’étape ;
2. exécution de la fonction de migration ;
3. comparaison clé par clé (chemins imbriqués inclus) ;
4. stockage dans `snapshot.data` des seules valeurs **modifiées ou supprimées** (valeur d’origine).

Règles :

* les types BSON (`Date`, `ObjectId`, `Buffer`, `Decimal128`) doivent être préservés tels quels dans le snapshot ;
* un champ passé à `undefined` est traité comme supprimé ;
* si une clé de snapshot existe déjà (ré-exécution de la même étape après rollback), elle est **écrasée** par la nouvelle capture — comportement documenté ;
* les champs réservés `__*` ne sont jamais inclus dans `snapshot.data`.

#### Taille des documents

Les snapshots vivent dans le document et comptent dans la limite MongoDB de 16 Mo. Pour des documents volumineux ou des historiques longs, un stockage en collection annexe (`snapshotStorage: 'collection'`) est prévu en roadmap (hors MVP). Le nettoyage explicite (section 15.9) reste la réponse MVP.

### 15.2 Cas upgrade (`up`)

Exemple : passage de `CONTAINER_SCHEMA_V1` à `CONTAINER_SCHEMA_V2`, la migration transforme `port` en `ports` puis supprime `port`.

Avant application :

```ts
{
  name: "nginx",
  port: "80:80",
  __schemaVersion: 1781251200000
}
```

Snapshot enregistré :

```ts
"1781251200000_to_1781856000000": {
  direction: "up",
  fromVersion: 1781251200000,
  toVersion: 1781856000000,
  migratedAt: "2026-06-19T08:00:05.000Z",
  data: {
    port: "80:80"
  }
}
```

Ce snapshot permet de restaurer `port` si un rollback de cette étape est demandé.

### 15.3 Cas downgrade (`down`)

Exemple : passage de `CONTAINER_SCHEMA_V3` à `CONTAINER_SCHEMA_V2`, la migration supprime `network`.

Avant application :

```ts
{
  name: "nginx",
  ports: ["80:80"],
  network: { mode: "bridge" },
  __schemaVersion: 1782460800000
}
```

Snapshot enregistré :

```ts
"1782460800000_to_1781856000000": {
  direction: "down",
  fromVersion: 1782460800000,
  toVersion: 1781856000000,
  migratedAt: "2026-06-26T09:15:00.000Z",
  data: {
    network: { mode: "bridge" }
  }
}
```

### 15.4 Configuration

```ts
schema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V3,
  migrations: containerMigrations,

  storeSnapshots: 'both', // 'up' | 'down' | 'both' | false
  snapshotsPath: '__migrationSnapshots',
});
```

Valeurs recommandées :

```ts
storeSnapshots: 'both'
snapshotsPath: '__migrationSnapshots'
```

Comportement :

* `storeSnapshots: 'both'` : snapshots avant chaque migration `up` et `down` ;
* `storeSnapshots: 'up'` : snapshots uniquement lors des upgrades ;
* `storeSnapshots: 'down'` : snapshots uniquement lors des downgrades ;
* `storeSnapshots: false` : aucun snapshot — **déconseillé**, rend le downgrade et l’annulation impossibles.

L’option historique `backupBeforeDowngrade` peut être conservée comme alias de `storeSnapshots: 'down'` pour compatibilité.

### 15.5 État de migration (`__migrationState`)

Pendant une migration, Schemigrate suit l’état du document :

```ts
__migrationState: {
  status: 'running' | 'failed' | 'completed';
  direction: 'up' | 'down';
  fromVersion: 1781251200000;
  targetVersion: 1782460800000;
  startedAt: '2026-06-26T08:00:00.000Z';
  failedAt?: '2026-06-26T08:00:03.000Z';
  lastCompletedStep?: '1781251200000_to_1781856000000';
  currentStep?: '1781856000000_to_1782460800000';
  error?: {
    name: string;
    message: string;
  };
}
```

Comportement (modèle atomique, section 15.0) :

* `failed` : une fonction de migration a échoué — **aucune donnée métier n’a été écrite**, le document est resté à `fromVersion` ; le marqueur sert au diagnostic et au comptage ;
* `completed` : migration terminée — `__migrationState` peut être nettoyé ou archivé ;
* `running` : réservé au futur mode d’exécution par étape persistée (hors MVP) ; dans le modèle atomique, aucun document ne persiste cet état et `inProgressDocuments` vaut normalement `0`.

Un état `running` ne doit jamais être considéré comme un verrou : la protection contre les écritures concurrentes repose sur le verrou optimiste (`__schemaVersion` dans le filtre d’écriture), voir section 16.5.

Ce champ permet à `schemigrate status` de compter les documents `failed` ou `inProgress`.

### 15.6 Dry-run et métadonnées

En mode `dry-run`, Schemigrate doit appliquer la **même logique** de planification et de snapshot, mais :

* ne pas appeler `save()` ;
* ne pas modifier la base ;
* retourner un rapport incluant les snapshots **qui auraient été** créés.

```ts
type SchemigrateDryRunResult = {
  documentId?: string;
  fromVersion: SchemaVersion;
  targetVersion: SchemaVersion;
  plan: SchemigratePlan;
  snapshotsPreview: Record<string, MigrationSnapshotInfo>;
  changesPreview: Record<string, unknown>;
};
```

### 15.7 Rollback d’une étape

Schemigrate doit permettre de restaurer un document à partir d’un snapshot existant.

Méthodes attendues sur le document :

```ts
doc.listMigrationSnapshots(): MigrationSnapshotInfo[];
doc.hasMigrationSnapshot(stepKey: string): boolean;
doc.rollbackMigration(stepKey: string, options?: SchemigrateRollbackOptions): Promise<this>;
```

Méthodes attendues sur le modèle :

```ts
Model.rollbackMigrationById(
  id: string,
  stepKey: string,
  options?: SchemigrateRollbackOptions,
): Promise<Document>;

Model.rollbackMany(
  filter: FilterQuery<any>,
  stepKey: string,
  options?: SchemigrateRollbackOptions,
): Promise<SchemigrateBatchResult>;
```

Exemple :

```ts
await container.rollbackMigration('1782460800000_to_1781856000000', { save: true });
```

Comportement attendu :

1. vérifier que le snapshot `1782460800000_to_1781856000000` existe ;
2. restaurer les champs présents dans `snapshot.data` ;
3. remettre `__schemaVersion` à `snapshot.fromVersion` ;
4. supprimer le snapshot concerné si le rollback réussit ;
5. lever une erreur explicite si le snapshot est absent ou incomplet.

Options de rollback :

```ts
type SchemigrateRollbackOptions = {
  save?: boolean;
  dryRun?: boolean;
  keepSnapshot?: boolean; // conserver le snapshot après rollback
};
```

Le rollback ne doit jamais modifier `__v`.

### 15.8 Annulation après échec (`abortMigration`)

Dans le modèle atomique (section 15.0), un échec n’écrit aucune donnée métier : `abortMigration` consiste essentiellement à **nettoyer le marqueur `__migrationState`**. La logique de restauration ci-dessous reste spécifiée pour couvrir le futur mode par étape persistée et d’éventuels états hérités.

Méthodes attendues :

```ts
doc.abortMigration(options?: SchemigrateAbortOptions): Promise<this>;
Model.abortMigrationById(id: string, options?: SchemigrateAbortOptions): Promise<Document>;
Model.abortMigrationMany(filter: FilterQuery<any>, options?: SchemigrateAbortOptions): Promise<SchemigrateBatchResult>;
```

Comportement :

1. lire `__migrationState` ;
2. si `status === 'failed'` ou `running`, identifier le point de restauration ;
3. restaurer les champs via `__migrationSnapshots` (dernière étape complétée ou ancre de run) ;
4. remettre `__schemaVersion` à la version cohérente ;
5. nettoyer `__migrationState` si l’annulation réussit.

```ts
type SchemigrateAbortOptions = {
  save?: boolean;
  dryRun?: boolean;
  targetVersion?: SchemaVersion; // optionnel, sinon restaure à fromVersion du run
};
```

### 15.9 Nettoyage des snapshots

Les snapshots peuvent s’accumuler et alourdir les documents. Schemigrate doit proposer des opérations de nettoyage explicites.

Méthodes attendues sur le modèle :

```ts
Model.cleanupMigrationSnapshots(
  filter: FilterQuery<any>,
  options?: SchemigrateCleanupOptions,
): Promise<SchemigrateCleanupResult>;

Model.cleanupMigrationSnapshotById(
  id: string,
  stepKey?: string,
  options?: SchemigrateCleanupOptions,
): Promise<void>;
```

Options de nettoyage :

```ts
type SchemigrateCleanupOptions = {
  stepKey?: string;          // nettoyer un snapshot précis
  olderThan?: Date | string; // Date, ou durée relative : '<n>d' (jours), '<n>h' (heures), '<n>m' (minutes)
  direction?: 'up' | 'down'; // filtrer par sens de migration
  dryRun?: boolean;
  batchSize?: number;
};

type SchemigrateCleanupResult = {
  matched: number;
  cleaned: number;
  skipped: number;
  dryRun: boolean;
};
```

Exemples :

```ts
// supprimer tous les snapshots de plus de 30 jours
await Container.cleanupMigrationSnapshots(
  { __migrationSnapshots: { $exists: true } },
  { olderThan: '30d' },
);

// supprimer un snapshot précis sur un document
await Container.cleanupMigrationSnapshotById(id, '1781251200000_to_1781856000000');

// simulation sans écriture
await Container.cleanupMigrationSnapshots(
  {},
  { olderThan: '7d', dryRun: true },
);
```

Le nettoyage ne doit jamais modifier les champs métier ni `__schemaVersion`.

### 15.10 Commandes CLI associées

```bash
schemigrate status Container
schemigrate dry-run Container
schemigrate up Container
schemigrate down Container --to 1781856000000

schemigrate snapshots Container
schemigrate rollback Container --id 64f... --step 1782460800000_to_1781856000000
schemigrate abort Container --id 64f...

schemigrate cleanup-snapshots Container --older-than 30d
```

Voir section 42 pour le détail complet des commandes.

---

## 16. Modes de fonctionnement

### 16.1 Comportement à la lecture (par défaut)

À chaque chargement de document depuis MongoDB (`post('init')` et hooks de lecture équivalents), Schemigrate vérifie `__schemaVersion` :

| Situation | Comportement |
|---|---|
| `__schemaVersion < currentVersion` | lève `OutdatedDocumentError` |
| `__schemaVersion > currentVersion` | lève `UnsupportedSchemaVersionError` |
| `__schemaVersion === currentVersion` | aucune action, document utilisable |
| champ de version absent | selon `unknownVersionStrategy` |

**Aucune migration implicite n’est autorisée lors d’un `find`.**

Le mode `lazy` (migration automatique à la lecture) est **hors périmètre** et ne doit pas être implémenté.

#### Requêtes multi-résultats

Sur un `find()` retournant plusieurs documents, la requête échoue **en bloc** (fail-fast) dès qu’au moins un document est hors version. L’erreur levée doit **agréger** les documents fautifs plutôt que de s’arrêter au premier :

```ts
{
  name: 'OutdatedDocumentError',
  modelName: 'Container',
  documents: [
    { documentId: '64f...', documentVersion: 1781251200000 },
    { documentId: '650...', documentVersion: 1781856000000 },
  ],
  currentVersion: 1782460800000,
}
```

#### Bypass au niveau requête

```ts
Container.find(filter).setOptions({ schemigrateCheck: false });
```

Désactive la garde pour cette requête uniquement (usage interne du moteur, outillage, administration). Aucune option globale de désactivation n’est proposée.

### 16.2 Migrations explicites uniquement

C’est le seul mode d’exécution : il n’existe pas d’option `mode` ni `onReadBehavior` (une option à valeur unique n’en est pas une — elles pourront être introduites si d’autres valeurs apparaissent un jour).

Les migrations ne s’exécutent que via des appels explicites :

```ts
await doc.migrateToCurrentVersion();
```

ou :

```ts
await Model.migrateMany(
  { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
);
```

ou via CLI / démarrage opt-in (`schemigrate up`, `autoRunOnBootstrap`).

### 16.3 Option `autoSave`

Ce n’est pas un mode principal, mais une option.

```ts
autoSave: true
```

La migration sauvegarde automatiquement le document.

Par défaut :

```ts
autoSave: false
```

### 16.4 Synchronisation au démarrage

Si la version du schema (`currentVersion`) est plus avancée que celle des documents, Schemigrate doit pouvoir migrer automatiquement les documents obsolètes au démarrage.

Configuration plugin :

```ts
schema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V3,
  migrations: containerMigrations,
  autoRunOnBootstrap: false, // désactivé par défaut — même nom côté plugin et côté NestJS
});
```

Configuration NestJS :

```ts
SchemigrateModule.forRoot({
  autoRunOnBootstrap: false, // désactivé par défaut
});
```

Comportement quand activé :

1. au démarrage, pour chaque modèle enregistré ;
2. compter les documents où `__schemaVersion < currentVersion` ;
3. exécuter `migrateMany()` vers `currentVersion` ;
4. conserver les métadonnées (`__migrationSnapshots`, `__migrationState`) ;
5. logger le résumé (migrés, échecs, ignorés).

Ce comportement est équivalent à :

```bash
schemigrate up --all
```

### 16.5 Concurrence multi-instances

Une application déployée en plusieurs réplicas (ex. Kubernetes) avec `autoRunOnBootstrap: true` lancera la même migration en parallèle sur chaque instance. Schemigrate doit rester correct dans ce scénario **sans verrou distribué** :

* chaque écriture de migration est conditionnée par la version de départ : `{ _id, __schemaVersion: fromVersion }` (verrou optimiste, section 15.0) ;
* si `matchedCount === 0`, une autre instance a déjà migré (ou modifié) le document : il est compté `skipped`, jamais écrasé ;
* le résultat est idempotent : N instances qui exécutent `migrateMany` simultanément produisent le même état final qu’une seule ;
* `__migrationState.status === 'running'` ne sert **jamais** de verrou. Si un futur mode par étape persiste cet état, il devra inclure un horodatage de péremption (`staleAfter`) pour distinguer un run actif d’un crash.

Recommandation opérationnelle à documenter : préférer `schemigrate up` (job unique, init container, hook de déploiement) à `autoRunOnBootstrap` quand il y a plusieurs réplicas.

### 16.6 Déploiements progressifs (rolling deploys)

Pendant un rolling deploy, anciennes et nouvelles versions du logiciel coexistent. Si la nouvelle version migre les documents, les anciens pods lisent des documents plus récents que leur `currentVersion` → `UnsupportedSchemaVersionError` en production.

Le README doit documenter le pattern **expand / contract** :

1. **Expand** : déployer une version du logiciel qui supporte la nouvelle structure (migration déclarée, `currentVersion` inchangé) sur 100 % des instances ;
2. **Migrate** : exécuter `schemigrate up` (commande ou job dédié) ;
3. **Contract** : déployer la version qui exige la nouvelle structure (`currentVersion` avancé) et retire le support de l’ancienne.

Une option de tolérance en lecture des versions plus récentes pourra être étudiée dans une version future (hors MVP).

---

## 17. Configuration du plugin

Configuration complète envisagée :

```ts
type SchemigratePluginOptions = {
  currentVersion: SchemaVersion;

  versionPath?: string;

  migrations: Migration[];

  defaultVersion?: SchemaVersion;

  versionStrategy?: 'timestamp' | 'sequential';

  autoSave?: boolean;

  allowDowngrade?: boolean;

  unknownVersionStrategy?: 'throw' | 'ignore' | 'setDefault';

  storeSnapshots?: 'up' | 'down' | 'both' | false;

  snapshotsPath?: string;

  /** @deprecated utiliser storeSnapshots */
  backupBeforeDowngrade?: boolean;

  /** @deprecated utiliser snapshotsPath */
  backupPath?: string;

  logger?: SchemigrateLogger;

  hideInToJSON?: boolean;

  autoRunOnBootstrap?: boolean;

  /** crée les index sur versionPath et __migrationState.status (status, bootstrap et migrateMany filtrent sur ces champs) */
  createIndexes?: boolean;
};
```

Valeurs par défaut recommandées :

```ts
{
  versionPath: '__schemaVersion',
  versionStrategy: 'timestamp',
  // defaultVersion : par défaut, le plus petit `from` des migrations déclarées
  autoSave: false,
  allowDowngrade: false,
  unknownVersionStrategy: 'throw',
  storeSnapshots: 'both',
  snapshotsPath: '__migrationSnapshots',
  hideInToJSON: true,
  autoRunOnBootstrap: false,
  createIndexes: true,
}
```

---

## 18. Logger

Schemigrate doit accepter un logger optionnel.

```ts
type SchemigrateLogger = {
  debug?: (message: string, meta?: any) => void;
  info?: (message: string, meta?: any) => void;
  warn?: (message: string, meta?: any) => void;
  error?: (message: string, meta?: any) => void;
};
```

Exemple de logs :

```txt
[Schemigrate] Container: migrating document 64f... from v1 to v3
[Schemigrate] Container: applied migration 1781251200000 -> 1781856000000
[Schemigrate] Container: applied migration 1781856000000 -> 1782460800000
[Schemigrate] Container: migration completed
```

---

## 19. Méthodes d’instance ajoutées aux documents

Schemigrate doit ajouter les méthodes suivantes aux documents Mongoose :

```ts
doc.getSchemaVersion()
doc.isOutdated()
doc.isCurrentVersion()
doc.isNewerThanSupported()
doc.canMigrateTo(targetVersion)
doc.migrateTo(targetVersion, options)
doc.migrateToCurrentVersion(options)
doc.listMigrationSnapshots()
doc.hasMigrationSnapshot(stepKey)
doc.rollbackMigration(stepKey, options)
doc.abortMigration(options)
doc.getMigrationState()
```

Note : `migrateTo` / `migrateToCurrentVersion` n’opèrent pas sur l’instance hydratée elle-même (voir section 11) : elles relisent le document en POJO, appliquent le plan, écrivent au niveau collection, puis rafraîchissent l’instance. Le document hydraté peut ne pas exposer les champs legacy ; c’est attendu.

Exemple — lecture et migration sont séparées :

```ts
// 1. Lecture : lève une exception si le document est obsolète
try {
  const container = await Container.findById(id);
} catch (error) {
  if (error instanceof OutdatedDocumentError) {
    // le document doit d'abord être migré explicitement
  }
}

// 2. Migration explicite (batch, CLI ou démarrage)
await Container.migrateMany(
  { _id: id, __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
);

// 3. Relecture après migration réussie
const container = await Container.findById(id);
```

---

## 20. Méthodes statiques ajoutées au modèle

Schemigrate doit ajouter les méthodes suivantes au modèle :

```ts
Model.getCurrentSchemaVersion()
Model.getMigrationPlan(fromVersion, toVersion)
Model.migrateDocument(rawDocument, targetVersion)
Model.migrateById(id, targetVersion, options)
Model.migrateMany(filter, targetVersion, options)
Model.findOutdatedDocuments()
Model.findNewerDocuments()
Model.rollbackMigrationById(id, stepKey, options)
Model.rollbackMany(filter, stepKey, options)
Model.cleanupMigrationSnapshots(filter, options)
Model.cleanupMigrationSnapshotById(id, stepKey, options)
Model.syncToCurrentVersion(options)
Model.getMigrationStatus()
Model.abortMigrationMany(filter, options)
```

Notes :

* `targetVersion` est optionnel partout où il apparaît : par défaut, `currentVersion` ;
* `findOutdatedDocuments()` et `findNewerDocuments()` utilisent en interne le bypass `schemigrateCheck: false` (section 16.1) et retournent des POJOs (`lean()`) — sinon leur simple exécution lèverait l’exception qu’elles servent à anticiper.

Exemple :

```ts
await Container.migrateMany(
  { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
  {
    batchSize: 100,
    dryRun: false,
  },
);
```

---

## 21. Options de migration

```ts
type SchemigrateMigrationOptions = {
  save?: boolean;
  dryRun?: boolean;
  allowDowngrade?: boolean;
  storeSnapshots?: 'up' | 'down' | 'both' | false;
};
```

Exemple :

```ts
await doc.migrateToCurrentVersion({
  save: true,
  dryRun: false,
});
```

---

## 22. Migration batch

Schemigrate doit permettre de migrer plusieurs documents.

```ts
await Container.migrateMany(
  { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
  {
    batchSize: 100,
    dryRun: false,
    continueOnError: true,
    saveStrategy: 'bulkWrite',
  },
);
```

Options :

```ts
type SchemigrateBatchOptions = {
  batchSize?: number;
  dryRun?: boolean;
  continueOnError?: boolean;
  saveStrategy?: 'updateOne' | 'bulkWrite'; // 'bulkWrite' par défaut
};
```

La stratégie `save` (hydratation + `doc.save()`) n’est pas proposée : elle validerait et filtrerait les états intermédiaires contre le schema courant (voir section 11) et perdrait les champs legacy. Toutes les écritures batch passent au niveau collection, chacune protégée par le verrou optimiste `{ _id, __schemaVersion: fromVersion }` (section 15.0).

Résultat attendu :

```ts
type SchemigrateBatchResult = {
  matched: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: SchemigrateError[];
};
```

---

## 23. Mode dry-run

Le mode `dry-run` permet de savoir ce qui serait migré sans modifier la base.

Exemple :

```ts
await Container.migrateMany(
  { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
  { dryRun: true },
);
```

Résultat attendu :

```ts
{
  documentId: "64f...",
  currentVersion: 1781251200000,
  targetVersion: 1782460800000,
  migrations: [
    "1781251200000 -> 1781856000000",
    "1781856000000 -> 1782460800000",
  ]
}
```

Le mode `dry-run` ne doit jamais sauvegarder en base.

---

## 24. Plan de migration

Schemigrate doit être capable de calculer un plan de migration.

```ts
Model.getMigrationPlan(CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3);
```

Résultat :

```ts
[
  {
    from: 1781251200000,
    to: 1781856000000,
    direction: 'up',
    description: 'Transform port string into ports array',
  },
  {
    from: 1781856000000,
    to: 1782460800000,
    direction: 'up',
    description: 'Add network configuration',
  },
]
```

Pour un downgrade :

```ts
Model.getMigrationPlan(CONTAINER_SCHEMA_V3, CONTAINER_SCHEMA_V1);
```

Résultat :

```ts
[
  {
    from: 1782460800000,
    to: 1781856000000,
    direction: 'down',
  },
  {
    from: 1781856000000,
    to: 1781251200000,
    direction: 'down',
  },
]
```

---

## 25. Validation des migrations

Au démarrage ou à l’application du plugin, Schemigrate doit valider les migrations.

À vérifier :

* `from` et `to` doivent être des nombres (`SchemaVersion`) ;
* `to` doit être strictement supérieur à `from` (dans les deux modes de versionnement) ;
* chaque `to` doit être unique dans la chaîne de migrations ;
* chaque `from` doit être unique dans la chaîne de migrations (sinon le chemin est ambigu — cas typique d’un merge de branches, voir section 9) ;
* `from` doit être différent de `to` ;
* une migration `up` doit exister ;
* deux migrations identiques ne doivent pas exister ;
* les versions ne doivent pas créer de boucle ;
* les migrations ne doivent pas avoir de trou si le chemin est requis ;
* les migrations descendantes doivent être cohérentes si `allowDowngrade` est activé.

Exemple d’erreur :

```txt
Missing migration from schema version 1781856000000 to 1782460800000.
```

---

## 26. Erreurs typées

Schemigrate doit fournir des erreurs typées.

### `MissingSchemaVersionError`

Le document n’a pas de champ de version.

### `UnsupportedSchemaVersionError`

Le document utilise une version plus récente que celle supportée par le logiciel. Levée à la lecture (`find`) et lors des opérations métier si le document est trop récent.

### `OutdatedDocumentError`

Le document est plus ancien que `currentVersion`. Levée à la lecture (`find`) — **aucune migration implicite**.

Exemple :

```ts
{
  name: 'OutdatedDocumentError',
  modelName: 'Container',
  documentId: '64f...',
  documentVersion: 1781251200000,
  currentVersion: 1782460800000,
}
```

Sur une requête multi-résultats, l’erreur agrège tous les documents fautifs dans un champ `documents` (voir section 16.1).

### `MissingMigrationError`

Une migration nécessaire n’existe pas.

### `MissingDowngradeMigrationError`

Une migration descendante est nécessaire mais absente.

### `MigrationExecutionError`

Une migration a échoué pendant son exécution.

### `InvalidMigrationConfigurationError`

La configuration du plugin ou la liste des migrations est invalide.

### `MissingMigrationSnapshotError`

Un rollback a été demandé mais le snapshot de l’étape ciblée est absent.

### `RollbackExecutionError`

La restauration d’un snapshot a échoué pendant son exécution.

Exemple d’erreur enrichie :

```ts
{
  name: 'MigrationExecutionError',
  modelName: 'Container',
  documentId: '64f...',
  fromVersion: 1781251200000,
  toVersion: 1781856000000,
  migrationDescription: 'Transform port string into ports array',
  cause: error
}
```

---

## 27. Hooks Mongoose

Le plugin utilise les middlewares Mongoose pour **valider** la version à la lecture, pas pour migrer.

Hooks utilisés :

```ts
post('init')              // après find / findOne / findById — vérifie __schemaVersion
post('find')              // optionnel, pour les résultats tableaux
post('findOne')
```

Comportement de `post('init')` :

* si `__schemaVersion < currentVersion` → lève `OutdatedDocumentError` ;
* si `__schemaVersion > currentVersion` → lève `UnsupportedSchemaVersionError` ;
* **ne jamais** appeler `migrateTo()` ou modifier le document.

Hooks non utilisés pour la migration :

```ts
pre('save')               // ne déclenche pas de migration automatique
pre('findOneAndUpdate')   // ne migre pas silencieusement
```

Hooks de création (stamping de version, section 10.1) :

```ts
pre('save')             // isNew === true et version absente → __schemaVersion = currentVersion
pre('insertMany')       // stampe chaque document inséré sans version
pre('findOneAndUpdate') // upsert: true → $setOnInsert: { __schemaVersion: currentVersion }
```

### Périmètre exact de la garde de lecture

Couvert :

* `find`, `findOne`, `findById` (documents hydratés, via `post('init')`) ;
* `find().lean()` et variantes `lean()` (via middleware `post` de query) ;
* curseurs issus de `find().cursor()`.

**Non couvert** (limites assumées, à documenter dans le README) :

* `aggregate()` — les pipelines contournent l’hydratation et la garde ;
* `distinct()`, `countDocuments()`, `estimatedDocumentCount()` ;
* tout accès direct au driver natif (`collection.find()`).

Contraintes :

* le plugin doit être appliqué avant la compilation du modèle ;
* les migrations passent uniquement par les méthodes explicites (`migrateTo`, `migrateMany`, CLI, démarrage) ;
* la garde est désactivable par requête via `setOptions({ schemigrateCheck: false })` (section 16.1), jamais globalement ;
* le comportement doit être documenté et testé.

---

## 28. Utilisation Mongoose simple

Exemple sans NestJS :

```ts
import mongoose, { Schema } from 'mongoose';
import { schemigratePlugin } from '@tacxou/schemigrate';

const containerSchema = new Schema({
  name: String,
  image: String,
  port: String,
  ports: [String],
  network: {
    mode: String,
  },
});

const CONTAINER_SCHEMA_V1 = 1781251200000;
const CONTAINER_SCHEMA_V2 = 1781856000000;
const CONTAINER_SCHEMA_V3 = 1782460800000;

containerSchema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V3,
  versionPath: '__schemaVersion',
  migrations: [
    {
      from: CONTAINER_SCHEMA_V1,
      to: CONTAINER_SCHEMA_V2,
      up: async (doc) => {
        if (doc.port && !doc.ports) {
          doc.ports = [doc.port];
        }

        delete doc.port;
        return doc;
      },
    },
    {
      from: CONTAINER_SCHEMA_V2,
      to: CONTAINER_SCHEMA_V3,
      up: async (doc) => {
        doc.network ??= {
          mode: 'bridge',
        };

        return doc;
      },
    },
  ],
});

const Container = mongoose.model('Container', containerSchema);
```

Migration explicite d’un document (sans passer par `find`) :

```ts
await Container.migrateById(id, CONTAINER_SCHEMA_V3, { save: true });
```

Migration batch :

```ts
await Container.migrateMany(
  { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
  CONTAINER_SCHEMA_V3,
  {
    batchSize: 100,
    dryRun: false,
  },
);
```

---

## 29. Support TypeScript

Schemigrate doit être écrit en TypeScript.

Types à fournir :

```ts
SchemaVersion
createSchemaVersion
Migration
MigrationContext
SchemigratePluginOptions
SchemigrateMigrationOptions
SchemigrateBatchOptions
SchemigrateBatchResult
SchemigratePlan
SchemigrateLogger
SchemigrateError
MigrationSnapshotInfo
SchemigrateRollbackOptions
SchemigrateCleanupOptions
SchemigrateCleanupResult
SchemigrateDryRunResult
SchemigrateAbortOptions
MigrationState
MigrationStatus
SchemaVersionedDocument
SchemaVersionedModel
```

Exemple :

```ts
interface SchemaVersionedDocument {
  __schemaVersion: SchemaVersion;

  getSchemaVersion(): SchemaVersion;

  isOutdated(): boolean;

  isCurrentVersion(): boolean;

  isNewerThanSupported(): boolean;

  canMigrateTo(targetVersion: SchemaVersion): boolean;

  migrateTo(
    targetVersion: SchemaVersion,
    options?: SchemigrateMigrationOptions,
  ): Promise<this>;

  migrateToCurrentVersion(
    options?: SchemigrateMigrationOptions,
  ): Promise<this>;
}
```

Exemple modèle :

```ts
interface SchemaVersionedModel<T> {
  getCurrentSchemaVersion(): SchemaVersion;

  getMigrationPlan(
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
  ): SchemigratePlan;

  migrateMany(
    filter: any,
    targetVersion?: SchemaVersion,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult>;
}
```

---

## 30. Support NestJS

Schemigrate doit proposer une intégration officielle NestJS via un sous-chemin d’export du package principal :

```txt
@tacxou/schemigrate/nestjs
```

Ce sous-chemin n’est pas un package npm distinct et n’est pas réexporté depuis `index.ts`. Les consommateurs NestJS doivent importer explicitement depuis `@tacxou/schemigrate/nestjs`.

Le cœur du plugin (`@tacxou/schemigrate`) doit rester indépendant de NestJS.

---

## 31. Objectifs de l’intégration NestJS

L’intégration NestJS doit permettre :

* d’utiliser Schemigrate avec `@nestjs/mongoose` ;
* d’appliquer le plugin sur des schemas créés avec `SchemaFactory.createForClass()` ;
* de fonctionner avec `MongooseModule.forFeatureAsync()` ;
* d’utiliser `ConfigService` pour configurer la version courante ;
* d’injecter un service de migration ;
* d’exécuter des migrations manuelles depuis un service métier ;
* de migrer des documents au démarrage si demandé ;
* d’utiliser le logger NestJS ;
* de convertir les erreurs Schemigrate en exceptions NestJS.

---

## 32. Exemple de schema NestJS

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContainerDocument = HydratedDocument<Container>;

@Schema({ timestamps: true })
export class Container {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  image: string;

  @Prop({ type: [String], default: [] })
  ports: string[];

  @Prop({
    type: {
      mode: String,
    },
    default: {
      mode: 'bridge',
    },
  })
  network: {
    mode: string;
  };
}

export const ContainerSchema = SchemaFactory.createForClass(Container);
```

Les champs réservés Schemigrate (`__schemaVersion`, etc.) sont ajoutés automatiquement par le plugin. Ils ne doivent pas être déclarés dans la classe NestJS.

---

## 33. Utilisation NestJS avec `forFeatureAsync`

Utilisation recommandée :

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { schemigratePlugin } from '@tacxou/schemigrate';

import { Container, ContainerSchema } from './schemas/container.schema';
import { containerMigrations } from './migrations/container.migrations';

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: Container.name,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const schema = ContainerSchema;

          schema.plugin(schemigratePlugin, {
            currentVersion: configService.get<SchemaVersion>(
              'CONTAINER_SCHEMA_VERSION',
              CONTAINER_SCHEMA_V3,
            ),
            versionPath: '__schemaVersion',
            migrations: containerMigrations,
          });

          return schema;
        },
      },
    ]),
  ],
})
export class ContainerModule {}
```

---

## 34. Module NestJS

Le sous-chemin `@tacxou/schemigrate/nestjs` doit exposer :

```ts
SchemigrateModule
```

Utilisation simple :

```ts
import { Module } from '@nestjs/common';
import { SchemigrateModule } from '@tacxou/schemigrate/nestjs';

@Module({
  imports: [
    SchemigrateModule.forRoot({
      logger: true,
    }),
  ],
})
export class AppModule {}
```

Utilisation asynchrone :

```ts
SchemigrateModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    autoRunOnBootstrap: configService.get('SCHEMIGRATE_AUTO_RUN', false),
    logger: true,
  }),
});
```

---

## 35. Service NestJS

Le sous-chemin `@tacxou/schemigrate/nestjs` doit exposer un service injectable.

```ts
@Injectable()
export class SchemigrateService {
  migrateDocument<T>(
    model: Model<T>,
    document: T,
    targetVersion?: SchemaVersion,
  ): Promise<T>;

  migrateById<T>(
    model: Model<T>,
    id: string,
    targetVersion?: SchemaVersion,
  ): Promise<T>;

  migrateMany<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    targetVersion?: SchemaVersion,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult>;

  getMigrationPlan(
    modelName: string,
    fromVersion: SchemaVersion,
    toVersion: SchemaVersion,
  ): SchemigratePlan;

  getMigrationStatus(model: Model<any>): Promise<MigrationStatus>;

  syncToCurrentVersion<T>(
    model: Model<T>,
    options?: SchemigrateBatchOptions,
  ): Promise<SchemigrateBatchResult>;

  syncAllToCurrentVersion(
    options?: SchemigrateBatchOptions,
  ): Promise<Record<string, SchemigrateBatchResult>>;

  dryRun<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    targetVersion?: SchemaVersion,
  ): Promise<SchemigrateDryRunResult[]>;

  abortMigrationMany<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    options?: SchemigrateAbortOptions,
  ): Promise<SchemigrateBatchResult>;
}
```

Exemple d’utilisation :

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SchemigrateService } from '@tacxou/schemigrate/nestjs';

import { Container } from './schemas/container.schema';

@Injectable()
export class ContainerService {
  constructor(
    @InjectModel(Container.name)
    private readonly containerModel: Model<Container>,

    private readonly schemigrateService: SchemigrateService,
  ) {}

  async migrateAllContainers() {
    return this.schemigrateService.migrateMany(
      this.containerModel,
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      {
        batchSize: 100,
        dryRun: false,
      },
    );
  }
}
```

---

## 36. Registre NestJS des migrations

Le module NestJS peut proposer une méthode `forFeature`.

```ts
SchemigrateModule.forFeature([
  {
    modelName: Container.name,
    currentVersion: CONTAINER_SCHEMA_V3,
    versionPath: '__schemaVersion',
    migrations: containerMigrations,
  },
]);
```

Ce registre doit permettre de :

* stocker les migrations par modèle ;
* retrouver la version courante d’un modèle ;
* calculer un plan de migration ;
* valider les migrations au démarrage ;
* détecter les migrations manquantes.

Nom proposé :

```ts
SchemigrateRegistry
```

---

## 37. Migration au démarrage NestJS

Si `currentVersion` du schema est plus avancé que `__schemaVersion` des documents, Schemigrate doit pouvoir les synchroniser **au démarrage** de l’application.

C’est l’équivalent programmatique de `schemigrate up --all` (voir section 3.1).

### Mode recommandé : manuel

Le développeur crée un service dédié.

```ts
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

@Injectable()
export class DatabaseMigrationBootstrapService
  implements OnApplicationBootstrap
{
  constructor(
    private readonly schemigrateService: SchemigrateService,
  ) {}

  async onApplicationBootstrap() {
    await this.schemigrateService.syncAllToCurrentVersion({
      dryRun: false,
      storeSnapshots: 'both',
    });
  }
}
```

### Mode automatique optionnel

Configuration :

```ts
SchemigrateModule.forRoot({
  autoRunOnBootstrap: true, // désactivé par défaut
});
```

Comportement :

* détecter les documents obsolètes pour chaque modèle enregistré ;
* migrer vers `currentVersion` ;
* conserver `__migrationSnapshots` et `__migrationState` ;
* logger le résumé ;
* ne pas bloquer le démarrage si `dryRun: true`.

---

## 38. Logger NestJS

Schemigrate doit pouvoir utiliser le logger NestJS.

Configuration :

```ts
SchemigrateModule.forRoot({
  logger: true,
});
```

Ou :

```ts
SchemigrateModule.forRoot({
  logger: new Logger('Schemigrate'),
});
```

---

## 39. Exceptions NestJS

Le sous-chemin `@tacxou/schemigrate/nestjs` doit pouvoir convertir les erreurs Schemigrate en exceptions NestJS.

Exemples :

```ts
OutdatedDocumentException extends ConflictException
UnsupportedSchemaVersionException extends ConflictException
MissingMigrationException extends InternalServerErrorException
MigrationExecutionException extends InternalServerErrorException
```

`OutdatedDocumentException` est levée quand un service NestJS tente de lire un document dont `__schemaVersion` est inférieur à `currentVersion`. Aucune migration implicite n’est effectuée.

Helper attendu :

```ts
toNestSchemigrateException(error: unknown): HttpException;
```

Le package principal `@tacxou/schemigrate` doit rester indépendant de NestJS et exposer uniquement des erreurs JavaScript classiques.

---

## 40. Décorateur NestJS optionnel

Une version future peut proposer un décorateur.

```ts
@Schemigrate({
  currentVersion: CONTAINER_SCHEMA_V3,
  versionPath: '__schemaVersion',
  migrations: containerMigrations,
})
@Schema({ timestamps: true })
export class Container {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  image: string;
}
```

Ce décorateur est hors MVP.

---

## 41. Healthcheck NestJS optionnel

Une version future peut proposer une intégration avec `@nestjs/terminus`.

Objectif :

* détecter les documents obsolètes ;
* détecter les documents trop récents ;
* détecter les migrations manquantes ;
* exposer un statut pour le monitoring.

Exemple :

```ts
{
  status: 'ok',
  models: {
    Container: {
      currentVersion: 1782460800000,
      outdatedDocuments: 12,
      newerDocuments: 0,
    },
  },
}
```

Ce point est hors MVP.

---

## 42. CLI

La CLI est l’interface opérationnelle principale de Schemigrate. Elle reprend le flux décrit en section 3.1.

### 42.1 `status` — inspecter l’état

```bash
schemigrate status
schemigrate status Container
schemigrate status Container --verbose
```

Affiche, par modèle :

* `currentVersion` du schema ;
* nombre de documents obsolètes (`__schemaVersion < currentVersion`) ;
* nombre de documents à jour ;
* nombre de documents trop récents ;
* documents en échec (`__migrationState.status === 'failed'`) ;
* documents en cours (`__migrationState.status === 'running'`).

### 42.2 `up` — synchroniser vers la version courante

Équivalent de la migration au démarrage, mais déclenché manuellement.

```bash
schemigrate up Container
schemigrate up Container --to 1782460800000
schemigrate up --all
schemigrate up Container --batch-size 100
```

Comportement :

1. sélectionner les documents où `__schemaVersion < targetVersion` ;
2. créer les métadonnées (`__migrationSnapshots`, `__migrationState`) ;
3. appliquer les migrations `up` étape par étape ;
4. mettre à jour `__schemaVersion` ;
5. afficher un résumé.

### 42.3 `down` — rétrograder explicitement

```bash
schemigrate down Container --to 1781856000000
schemigrate down Container --id 64f... --to 1781856000000
```

Nécessite `allowDowngrade: true` et des migrations `down` déclarées.

### 42.4 `dry-run` — prévisualiser sans écrire

```bash
schemigrate dry-run Container
schemigrate dry-run Container --to 1782460800000
schemigrate dry-run --all
```

Retourne le plan, les changements prévus et les snapshots qui seraient créés, sans modification en base.

### 42.5 `rollback` / `abort` — annuler une migration

```bash
schemigrate rollback Container --id 64f... --step 1782460800000_to_1781856000000
schemigrate abort Container --id 64f...
schemigrate abort Container --filter '{"__migrationState.status":"failed"}'
```

* `rollback` : restaure une étape précise via son snapshot ;
* `abort` : annule une migration interrompue ou échouée à mi-parcours.

### 42.6 `snapshots` / `cleanup-snapshots`

```bash
schemigrate snapshots Container
schemigrate snapshots Container --id 64f...

schemigrate cleanup-snapshots Container --older-than 30d
schemigrate cleanup-snapshots Container --step 1781251200000_to_1781856000000
schemigrate cleanup-snapshots Container --all --dry-run
```

Le nettoyage des métadonnées reste **toujours explicite**.

### 42.7 Découverte des modèles et configuration

La CLI s’exécute hors du contexte applicatif : elle doit savoir se connecter à MongoDB et retrouver les modèles, leurs migrations et leur `currentVersion`. Cette découverte passe par un fichier de configuration à la racine du projet :

```ts
// schemigrate.config.ts
import { defineSchemigrateConfig } from '@tacxou/schemigrate';
import { containerMigrations } from './src/migrations/container.migrations';
import { CONTAINER_SCHEMA_V3 } from './src/migrations/versions';

export default defineSchemigrateConfig({
  uri: process.env.MONGODB_URI,
  models: [
    {
      name: 'Container',
      collection: 'containers',
      currentVersion: CONTAINER_SCHEMA_V3,
      migrations: containerMigrations,
    },
  ],
});
```

La CLI opère au niveau collection (POJOs, section 11) : elle n’a pas besoin des schemas Mongoose applicatifs.

### 42.8 Exécution NestJS

```bash
nest start --entryFile schemigrate-cli
```

La CLI complète est hors MVP, mais `status`, `dry-run` et `up` — ainsi que le format de `schemigrate.config.ts` — doivent être prévus dès l’architecture (voir section 3.1).

---

## 43. Contraintes de sécurité

Schemigrate doit respecter les règles suivantes :

* ne jamais modifier `__v` directement ;
* ne jamais utiliser de champs réservés Schemigrate sans le préfixe `__` ;
* ne jamais supprimer de données inconnues par défaut ;
* ne jamais exécuter un downgrade sans autorisation explicite ;
* ne jamais migrer ni mettre à jour un document lors d’un `find` ;
* lever `OutdatedDocumentError` si un document lu n’est pas à la version courante ;
* ne jamais sauvegarder automatiquement sans configuration explicite ;
* ne jamais ignorer silencieusement une migration manquante ;
* fournir un mode `dry-run` ;
* fournir des erreurs explicites ;
* toujours conserver les métadonnées de migration (`__migrationSnapshots`, `__migrationState`) par défaut ;
* permettre un rollback explicite à partir d’un snapshot ;
* permettre l’annulation d’une upgrade échouée à mi-parcours (`abortMigration`) ;
* permettre un nettoyage explicite des métadonnées ;
* ne jamais supprimer les métadonnées automatiquement après une migration ;
* logger les migrations si un logger est fourni.

---

## 44. Règles de conception des migrations

Les migrations doivent être :

* simples ;
* lisibles ;
* testables ;
* idéalement idempotentes ;
* ordonnées ;
* explicites.

Exemple de migration idempotente :

```ts
up: async (doc) => {
  if (!Array.isArray(doc.ports)) {
    doc.ports = doc.port ? [doc.port] : [];
  }

  delete doc.port;
  return doc;
}
```

Une migration ne doit pas dépendre d’un état externe instable sauf nécessité.

---

## 45. Stratégie de tests et outillage

### 45.1 Objectifs

La suite de tests doit garantir :

* le comportement du moteur de migration sans dépendre de MongoDB quand c’est possible ;
* le comportement réel du plugin Mongoose contre une base en mémoire ;
* l’intégration NestJS via `@nestjs/testing` ;
* une exécution rapide en local et reproductible en CI.

### 45.2 Stack recommandée

```txt
Vitest              — runner de tests
mongodb-memory-server — MongoDB éphémère pour l’intégration
@nestjs/testing     — tests NestJS
@vitest/coverage-v8 — couverture de code
```

Dépendances de développement attendues :

```json
{
  "devDependencies": {
    "vitest": "^3.x",
    "@vitest/coverage-v8": "^3.x",
    "mongodb-memory-server": "^10.x",
    "@nestjs/testing": "^11.x",
    "@nestjs/mongoose": "^11.x",
    "mongoose": "^8.x"
  }
}
```

### 45.3 Organisation du dépôt

```txt
src/
  index.ts
  plugin/
  engine/
  errors/
  utils/
  nestjs/

test/
  fixtures/
    versions.ts
    container.migrations.ts
    container.schema.ts
  helpers/
    create-test-model.ts
    create-nest-testing-module.ts
    mongo-memory.ts
  unit/
    engine/
    plugin/
    snapshots/
    versioning/
  integration/
    mongoose/
    nestjs/

vitest.config.ts
```

### 45.4 Scripts npm

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 45.5 Configuration Vitest

Deux projets de tests distincts :

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts'],
          environment: 'node',
          globalSetup: ['test/helpers/mongo-global-setup.ts'],
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // src/nestjs/** est inclus : il a sa propre suite de tests (sections 48-49)
      exclude: ['**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
```

### 45.6 Fixtures partagées

Les fixtures de test doivent réutiliser les mêmes timestamps que la spec :

```ts
// test/fixtures/versions.ts
export const CONTAINER_SCHEMA_V1 = 1781251200000;
export const CONTAINER_SCHEMA_V2 = 1781856000000;
export const CONTAINER_SCHEMA_V3 = 1782460800000;
```

```ts
// test/fixtures/container.migrations.ts
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V2, CONTAINER_SCHEMA_V3 } from './versions';

export const containerMigrations = [
  {
    from: CONTAINER_SCHEMA_V1,
    to: CONTAINER_SCHEMA_V2,
    description: 'Transform port string into ports array',
    up: async (doc: any) => {
      if (doc.port && !doc.ports) doc.ports = [doc.port];
      delete doc.port;
      return doc;
    },
    down: async (doc: any) => {
      if (Array.isArray(doc.ports)) doc.port = doc.ports[0];
      delete doc.ports;
      return doc;
    },
  },
  {
    from: CONTAINER_SCHEMA_V2,
    to: CONTAINER_SCHEMA_V3,
    description: 'Add network configuration',
    up: async (doc: any) => {
      doc.network ??= { mode: 'bridge' };
      return doc;
    },
    down: async (doc: any) => {
      delete doc.network;
      return doc;
    },
  },
];
```

### 45.7 Périmètre fonctionnel à couvrir

| Domaine | Type de test | Fichiers cibles |
|---|---|---|
| `createSchemaVersion()` | unitaire | `test/unit/versioning/create-schema-version.spec.ts` |
| validation des migrations | unitaire | `test/unit/engine/validate-migrations.spec.ts` |
| plan de migration | unitaire | `test/unit/engine/migration-plan.spec.ts` |
| moteur `up` / `down` | unitaire | `test/unit/engine/migrate-document.spec.ts` |
| snapshots / rollback | unitaire | `test/unit/snapshots/*.spec.ts` |
| plugin + schema | intégration Mongoose | `test/integration/mongoose/plugin.spec.ts` |
| `save` / `find` / batch | intégration Mongoose | `test/integration/mongoose/*.spec.ts` |
| `SchemigrateModule` | unitaire NestJS | `test/unit/nestjs/schemigrate.module.spec.ts` |
| `SchemigrateService` | unitaire NestJS | `test/unit/nestjs/schemigrate.service.spec.ts` |
| module complet | intégration NestJS | `test/integration/nestjs/*.spec.ts` |

---

## 46. Implémentation des tests unitaires Mongoose

Les tests unitaires Mongoose testent le **cœur Schemigrate sans MongoDB**. Ils ciblent le moteur, les helpers, la validation et la logique de snapshots sur des objets JavaScript simples.

### 46.1 Principes

* aucune connexion MongoDB ;
* objets document représentés par de simples `Record<string, unknown>` ;
* logger mocké via `vi.fn()` ;
* chaque cas d’erreur typée doit avoir un test dédié ;
* les migrations de test vivent dans `test/fixtures/`.

### 46.2 Exemple — `createSchemaVersion()`

```ts
// test/unit/versioning/create-schema-version.spec.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSchemaVersion } from '../../../src/utils/create-schema-version';

describe('createSchemaVersion', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('convertit une date ISO en timestamp', () => {
    expect(createSchemaVersion('2026-06-12T08:00:00.000Z')).toBe(1781251200000);
  });

  it('utilise Date.now() si aucune date n’est fournie', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T08:00:00.000Z'));

    expect(createSchemaVersion()).toBe(1782460800000);
  });
});
```

### 46.3 Exemple — plan de migration

```ts
// test/unit/engine/migration-plan.spec.ts
import { describe, it, expect } from 'vitest';
import { buildMigrationPlan } from '../../../src/engine/build-migration-plan';
import { MissingMigrationError } from '../../../src/errors';
import { containerMigrations } from '../../fixtures/container.migrations';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('buildMigrationPlan', () => {
  it('construit un plan up sur plusieurs étapes', () => {
    const plan = buildMigrationPlan(
      containerMigrations,
      CONTAINER_SCHEMA_V1,
      CONTAINER_SCHEMA_V3,
    );

    expect(plan).toHaveLength(2);
    expect(plan[0].from).toBe(CONTAINER_SCHEMA_V1);
    expect(plan[1].to).toBe(CONTAINER_SCHEMA_V3);
  });

  it('lève MissingMigrationError si une étape manque', () => {
    expect(() =>
      buildMigrationPlan(containerMigrations, CONTAINER_SCHEMA_V1, 9999999999999),
    ).toThrowError(MissingMigrationError);
  });
});
```

### 46.4 Exemple — migration documentaire

```ts
// test/unit/engine/migrate-document.spec.ts
import { describe, it, expect } from 'vitest';
import { migrateDocument } from '../../../src/engine/migrate-document';
import { containerMigrations } from '../../fixtures/container.migrations';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('migrateDocument', () => {
  it('migre un document de V1 à V3', async () => {
    const input = {
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    };

    const result = await migrateDocument({
      document: input,
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
    });

    expect(result.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(result.ports).toEqual(['80:80']);
    expect(result.port).toBeUndefined();
    expect(result.network).toEqual({ mode: 'bridge' });
  });

  it('respecte le dry-run', async () => {
    const input = {
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    };

    const result = await migrateDocument({
      document: structuredClone(input),
      migrations: containerMigrations,
      targetVersion: CONTAINER_SCHEMA_V3,
      dryRun: true,
    });

    expect(result.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(input.__schemaVersion).toBe(CONTAINER_SCHEMA_V1);
  });
});
```

### 46.5 Exemple — masquage `toJSON`

```ts
// test/unit/plugin/to-json.spec.ts
import { describe, it, expect } from 'vitest';
import { stripReservedFields } from '../../../src/plugin/to-json';

describe('stripReservedFields', () => {
  it('masque les champs réservés __* par défaut', () => {
    const output = stripReservedFields({
      name: 'nginx',
      __schemaVersion: 1782460800000,
      __migrationSnapshots: {},
      __createdByVersion: '1.4.0',
    });

    expect(output).toEqual({ name: 'nginx' });
  });

  it('compose avec une transform applicative existante', () => {
    const output = stripReservedFields(
      { name: 'nginx', secret: 'hidden', __schemaVersion: 1782460800000 },
      (doc) => {
        const { secret, ...rest } = doc;
        return rest;
      },
    );

    expect(output).toEqual({ name: 'nginx' });
  });
});
```

### 46.6 Cas unitaires obligatoires

* ajout logique du champ `__schemaVersion` ;
* masquage `toJSON` / `toObject` ;
* `unknownVersionStrategy` (`throw`, `ignore`, `setDefault`) ;
* `post('init')` lève `OutdatedDocumentError` si document obsolète ;
* `post('init')` lève `UnsupportedSchemaVersionError` si document trop récent ;
* aucune migration déclenchée par un `find` ;
* migration sur une ou plusieurs étapes (appels explicites uniquement) ;
* downgrade interdit / migration `down` manquante ;
* snapshot avant `up` et `down` ;
* rollback et erreur `MissingMigrationSnapshotError` ;
* nettoyage des snapshots (`olderThan`, `stepKey`, `dryRun`) ;
* validation des migrations au démarrage ;
* logger appelé aux bons moments.

---

## 47. Implémentation des tests d’intégration Mongoose

Les tests d’intégration Mongoose utilisent **`mongodb-memory-server`** pour valider le plugin, les méthodes de document et les opérations batch contre une vraie base MongoDB éphémère.

### 47.1 Helper MongoDB mémoire

```ts
// test/helpers/mongo-memory.ts
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer;

export async function startMongoMemoryServer() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}

export async function stopMongoMemoryServer() {
  await mongoose.disconnect();
  await mongo?.stop();
}

export function getMongoUri() {
  if (!mongo) {
    throw new Error('MongoMemoryServer is not started');
  }
  return mongo.getUri();
}

export async function clearDatabase() {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
}
```

```ts
// test/helpers/mongo-global-setup.ts
import { startMongoMemoryServer, stopMongoMemoryServer } from './mongo-memory';

export async function setup() {
  await startMongoMemoryServer();
}

export async function teardown() {
  await stopMongoMemoryServer();
}
```

### 47.2 Helper modèle de test

```ts
// test/helpers/create-test-model.ts
import mongoose, { Schema } from 'mongoose';
import { schemigratePlugin } from '../../src/plugin/schemigrate-plugin';
import { containerMigrations } from '../fixtures/container.migrations';
import { CONTAINER_SCHEMA_V3 } from '../fixtures/versions';

export function createContainerTestModel() {
  const schema = new Schema({
    name: String,
    image: String,
    port: String,
    ports: [String],
    network: { mode: String },
  });

  schema.plugin(schemigratePlugin, {
    currentVersion: CONTAINER_SCHEMA_V3,
    migrations: containerMigrations,
  });

  return (
    mongoose.models.ContainerTest ||
    mongoose.model('ContainerTest', schema)
  );
}
```

### 47.3 Exemple — migration persistée

```ts
// test/integration/mongoose/migrate-document.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-memory';
import { createContainerTestModel } from '../../helpers/create-test-model';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('Mongoose integration — migrate document', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('migre et persiste un document via save()', async () => {
    const Container = createContainerTestModel();

    const container = await Container.create({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    await container.migrateToCurrentVersion({ save: true });

    const reloaded = await Container.findById(container._id).lean();
    expect(reloaded?.__schemaVersion).toBe(CONTAINER_SCHEMA_V3);
    expect(reloaded?.ports).toEqual(['80:80']);
  });
});
```

### 47.4 Exemple — `migrateMany()`

```ts
// test/integration/mongoose/migrate-many.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { clearDatabase } from '../../helpers/mongo-memory';
import { createContainerTestModel } from '../../helpers/create-test-model';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('Mongoose integration — migrateMany', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('migre un lot de documents obsolètes', async () => {
    const Container = createContainerTestModel();

    await Container.insertMany([
      { name: 'a', port: '80:80', __schemaVersion: CONTAINER_SCHEMA_V1 },
      { name: 'b', port: '443:443', __schemaVersion: CONTAINER_SCHEMA_V1 },
    ]);

    const result = await Container.migrateMany(
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
      { batchSize: 10 },
    );

    expect(result.migrated).toBe(2);
    expect(result.errors).toHaveLength(0);

    const count = await Container.countDocuments({
      __schemaVersion: CONTAINER_SCHEMA_V3,
    });
    expect(count).toBe(2);
  });
});
```

### 47.5 Cas d’intégration Mongoose obligatoires

* `save()` après migration explicite ;
* `findById()` lève `OutdatedDocumentError` sur document obsolète ;
* `findById()` réussit après `migrateMany()` explicite ;
* `find().lean()` lève la même exception ;
* `findOneAndUpdate()` / `updateOne()` / `updateMany()` ;
* `migrateMany()` avec `batchSize` et `continueOnError` ;
* stratégies batch `updateOne` et `bulkWrite` ;
* dry-run sans écriture en base ;
* snapshots persistés dans `__migrationSnapshots` ;
* rollback persisté ;
* `toJSON()` sur document chargé depuis MongoDB.

---

## 48. Implémentation des tests unitaires NestJS

Les tests unitaires NestJS valident le **sous-chemin `@tacxou/schemigrate/nestjs`** sans MongoDB réelle. Le moteur Schemigrate et les modèles Mongoose sont mockés.

### 48.1 Principes

* utiliser `Test.createTestingModule()` de `@nestjs/testing` ;
* mocker `SchemigrateService` ou le moteur selon le composant testé ;
* ne pas importer `MongooseModule.forRoot()` dans les tests unitaires NestJS ;
* tester la configuration `forRoot`, `forRootAsync`, `forFeature` ;
* vérifier la conversion d’erreurs vers exceptions NestJS.

### 48.2 Exemple — `SchemigrateModule`

```ts
// test/unit/nestjs/schemigrate.module.spec.ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service';

describe('SchemigrateModule', () => {
  it('expose SchemigrateService avec forRoot()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SchemigrateModule.forRoot({
          logger: false,
        }),
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    expect(service).toBeDefined();
  });

  it('charge la config via forRootAsync()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ SCHEMIGRATE_AUTO_RUN: false })],
        }),
        SchemigrateModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            autoRunOnBootstrap: config.get('SCHEMIGRATE_AUTO_RUN'),
            logger: false,
          }),
        }),
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    expect(service).toBeDefined();
  });
});
```

### 48.3 Exemple — `SchemigrateService` mocké

```ts
// test/unit/nestjs/schemigrate.service.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('SchemigrateService', () => {
  it('délègue migrateMany au modèle', async () => {
    const migrateMany = vi.fn().mockResolvedValue({ migrated: 2, errors: [] });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SchemigrateService,
        {
          provide: getModelToken('Container'),
          useValue: { migrateMany },
        },
      ],
    }).compile();

    const service = moduleRef.get(SchemigrateService);
    const model = moduleRef.get(getModelToken('Container'));

    await service.migrateMany(
      model,
      { __schemaVersion: { $lt: CONTAINER_SCHEMA_V3 } },
      CONTAINER_SCHEMA_V3,
    );

    expect(migrateMany).toHaveBeenCalledOnce();
  });
});
```

### 48.4 Exemple — conversion d’exception

```ts
// test/unit/nestjs/exceptions.spec.ts
import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { toNestSchemigrateException } from '../../../src/nestjs/exceptions';
import { UnsupportedSchemaVersionError } from '../../../src/errors';

describe('toNestSchemigrateException', () => {
  it('convertit UnsupportedSchemaVersionError en ConflictException', () => {
    const error = new UnsupportedSchemaVersionError({
      modelName: 'Container',
      documentVersion: 9999999999999,
      supportedVersion: 1782460800000,
    });

    const exception = toNestSchemigrateException(error);
    expect(exception).toBeInstanceOf(ConflictException);
  });
});
```

### 48.5 Cas unitaires NestJS obligatoires

* `SchemigrateModule.forRoot()` ;
* `SchemigrateModule.forRootAsync()` avec `ConfigService` ;
* `SchemigrateModule.forFeature()` et registre des migrations ;
* injection de `SchemigrateService` ;
* délégation vers les méthodes du modèle ;
* conversion des erreurs Schemigrate en exceptions NestJS ;
* logger NestJS activable / désactivable ;
* absence de fuite du module NestJS dans l’export principal `@tacxou/schemigrate`.

---

## 49. Implémentation des tests d’intégration NestJS

Les tests d’intégration NestJS combinent **`@nestjs/testing`**, **`MongooseModule`** et **`mongodb-memory-server`** pour valider le flux complet dans un contexte applicatif NestJS.

### 49.1 Helper module de test

```ts
// test/helpers/create-nest-testing-module.ts
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemigrateModule } from '../../src/nestjs/schemigrate.module';
import { schemigratePlugin } from '../../src/plugin/schemigrate-plugin';
import { containerMigrations } from '../fixtures/container.migrations';
import { Container, ContainerSchema } from '../fixtures/container.schema';
import { CONTAINER_SCHEMA_V3 } from '../fixtures/versions';
import { getMongoUri } from './mongo-memory';

export async function createNestTestingModule() {
  const schema = ContainerSchema;
  schema.plugin(schemigratePlugin, {
    currentVersion: CONTAINER_SCHEMA_V3,
    migrations: containerMigrations,
  });

  return Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(getMongoUri()),
      MongooseModule.forFeature([{ name: Container.name, schema }]),
      SchemigrateModule.forRoot({ logger: false }),
    ],
  }).compile();
}
```

### 49.2 Exemple — service métier NestJS

```ts
// test/integration/nestjs/container.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { clearDatabase } from '../../helpers/mongo-memory';
import { createNestTestingModule } from '../../helpers/create-nest-testing-module';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service';
import { ContainerService } from '../fixtures/container.service';
import { Container } from '../fixtures/container.schema';
import { CONTAINER_SCHEMA_V1, CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('NestJS integration — ContainerService', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('migre des containers via SchemigrateService injecté', async () => {
    const moduleRef = await createNestTestingModule();

    const service = new ContainerService(
      moduleRef.get<Model<Container>>(getModelToken(Container.name)),
      moduleRef.get(SchemigrateService),
    );

    const model = moduleRef.get<Model<Container>>(getModelToken(Container.name));
    await model.create({
      name: 'nginx',
      port: '80:80',
      __schemaVersion: CONTAINER_SCHEMA_V1,
    });

    const result = await service.migrateAllContainers();

    expect(result.migrated).toBe(1);
    expect(
      await model.countDocuments({ __schemaVersion: CONTAINER_SCHEMA_V3 }),
    ).toBe(1);
  });
});
```

### 49.3 Exemple — `forFeatureAsync` + `ConfigService`

```ts
// test/integration/nestjs/for-feature-async.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SchemigrateModule } from '../../../src/nestjs/schemigrate.module';
import { SchemigrateService } from '../../../src/nestjs/schemigrate.service';
import { schemigratePlugin } from '../../../src/plugin/schemigrate-plugin';
import { clearDatabase, getMongoUri } from '../../helpers/mongo-memory';
import { containerMigrations } from '../../fixtures/container.migrations';
import { Container, ContainerSchema } from '../../fixtures/container.schema';
import { CONTAINER_SCHEMA_V3 } from '../../fixtures/versions';

describe('NestJS integration — forFeatureAsync', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  it('applique le plugin via ConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ CONTAINER_SCHEMA_VERSION: CONTAINER_SCHEMA_V3 })],
        }),
        MongooseModule.forRoot(getMongoUri()),
        MongooseModule.forFeatureAsync([
          {
            name: Container.name,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
              const schema = ContainerSchema;
              schema.plugin(schemigratePlugin, {
                currentVersion: config.get('CONTAINER_SCHEMA_VERSION'),
                migrations: containerMigrations,
              });
              return schema;
            },
          },
        ]),
        SchemigrateModule.forRoot({ logger: false }),
      ],
    }).compile();

    expect(moduleRef.get(SchemigrateService)).toBeDefined();
  });
});
```

### 49.4 Cas d’intégration NestJS obligatoires

* compilation d’un `TestingModule` complet ;
* injection de `SchemigrateService` et `@InjectModel()` ;
* migration d’un document via un service métier ;
* migration batch ;
* dry-run sans modification en base ;
* erreurs NestJS (`ConflictException`, etc.) ;
* configuration via `ConfigService` ;
* `forFeatureAsync` avec plugin Schemigrate ;
* bootstrap optionnel (`OnApplicationBootstrap`) désactivé par défaut en test.

### 49.5 CI

La CI doit exécuter :

```bash
npm run test:unit
npm run test:integration
npm run test:coverage
```

Pipeline minimal GitHub Actions :

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run test:coverage
```

---

## 50. Critères d’acceptation

Schemigrate sera considéré comme fonctionnel si :

* un schema Mongoose peut recevoir le plugin simplement ;
* un champ `__schemaVersion` est ajouté automatiquement (timestamp ms UTC) ;
* les versions de structure sont des timestamps croissants par défaut ;
* les champs réservés `__*` sont masqués dans `toJSON` par défaut ;
* un document ancien peut être migré vers la version courante ;
* un `find` sur un document obsolète lève `OutdatedDocumentError` ;
* un `find` sur un document trop récent lève `UnsupportedSchemaVersionError` ;
* aucune migration implicite n’a lieu lors d’un `find` ;
* un document créé par l’application reçoit `__schemaVersion = currentVersion` (`save`, `insertMany`, upsert) ;
* la garde de lecture est désactivable par requête (`schemigrateCheck: false`), jamais globalement ;
* une migration échouée n’écrit aucune donnée métier (exécution en mémoire, écriture atomique unique) ;
* deux instances exécutant la même migration en parallèle produisent le même état final, sans écrasement (verrou optimiste) ;
* une migration manquante génère une erreur claire ;
* le mode dry-run ne modifie jamais la base ;
* les migrations batch fonctionnent ;
* TypeScript reconnaît les méthodes ajoutées ;
* le plugin fonctionne sans NestJS ;
* l’intégration NestJS fonctionne avec `@nestjs/mongoose` ;
* le plugin ne touche jamais à `__v` ;
* si `currentVersion > __schemaVersion`, les documents peuvent être synchronisés via commande ou au démarrage ;
* les métadonnées de migration sont conservées par défaut (`storeSnapshots: 'both'`) ;
* un rollback restaure les données d’un snapshot et remet la version du document ;
* une upgrade échouée à mi-parcours peut être annulée via `abortMigration` ;
* le dry-run calcule le même plan sans écrire en base ;
* le nettoyage des métadonnées n’altère pas les champs métier et reste explicite ;
* la suite de tests unitaires et d’intégration Mongoose/NestJS passe en CI avec la couverture minimale définie.

---

## 51. Hors périmètre initial

La première version ne gérera pas :

* les migrations multi-collections complexes ;
* les transactions avancées multi-modèles ;
* les rollbacks automatiques silencieux après échec (l’annulation reste explicite via `abort` / `rollback`) ;
* le nettoyage automatique des snapshots sans action explicite ;
* la génération automatique de migrations ;
* l’analyse automatique de différences entre schemas ;
* l’interface graphique ;
* la CLI complète (la version MVP n’inclut que le cœur programmatique) ;
* le healthcheck Terminus ;
* l’auto-discovery des migrations ;
* le support d’autres ODM que Mongoose ;
* le mode `lazy` (migration automatique à la lecture) ;
* le stockage des snapshots en collection annexe (`snapshotStorage: 'collection'`) ;
* le mode d’exécution par étape persistée (une écriture par étape du plan) ;
* la garde de lecture sur `aggregate()` et les accès driver natif (limite documentée).

---

## 52. MVP

La version MVP doit contenir :

```txt
Package @tacxou/schemigrate
Plugin Mongoose
Champ __schemaVersion (timestamp ms UTC)
Versionnement par timestamp par défaut
Helper createSchemaVersion()
Masquage toJSON des champs __*
Exception OutdatedDocumentError au find si document obsolète
Aucune migration implicite au find
currentVersion (timestamp de la dernière migration)
Stamping __schemaVersion à la création (save, insertMany, upsert)
Bypass de lecture par requête (schemigrateCheck: false)
Exécution en mémoire + écriture atomique unique (verrou optimiste)
Migrations up
Model.migrateMany()
Model.migrateById()
Mode dry-run
Erreurs typées
Support TypeScript
Documentation Mongoose simple
Tests unitaires Mongoose (Vitest)
Tests d'intégration Mongoose (mongodb-memory-server)
```

Le support NestJS MVP doit contenir :

```txt
Sous-chemin @tacxou/schemigrate/nestjs (non exporté depuis index.ts)
SchemigrateModule.forRoot()
SchemigrateModule.forRootAsync()
SchemigrateService
Documentation avec MongooseModule.forFeatureAsync()
Exemple avec ConfigService
Exemple avec @InjectModel()
Tests unitaires NestJS (@nestjs/testing)
Tests d'intégration NestJS (mongodb-memory-server)
```

---

## 53. Roadmap

### Version 0.1.0

* Plugin Mongoose core.
* Champ `__schemaVersion` (timestamp).
* Versionnement par timestamp par défaut.
* Helper `createSchemaVersion()`.
* Masquage `toJSON` des champs réservés.
* Migrations `up`.
* Migration manuelle d’un document.
* TypeScript.
* Tests unitaires Mongoose (moteur, validation, snapshots).
* Tests d’intégration Mongoose de base.

### Version 0.2.0

* Migration batch.
* Mode dry-run.
* Résumé détaillé des migrations.
* Validation des migrations.

### Version 0.3.0

* Migrations `down`.
* Snapshots de migration (`up` et `down`).
* Rollback à partir d’un snapshot.
* Nettoyage des snapshots (`cleanupMigrationSnapshots`).
* Gestion avancée des erreurs.

### Version 0.4.0

* Support NestJS MVP.
* `SchemigrateModule`.
* `SchemigrateService`.
* Documentation NestJS.
* Tests unitaires NestJS.
* Tests d’intégration NestJS.

### Version 0.5.0

* Registre NestJS des migrations.
* Logger NestJS.
* Exceptions NestJS.
* Migration au démarrage optionnelle.

### Version 1.0.0

* API stable.
* CLI complète (migration, snapshots, rollback, nettoyage).
* Documentation complète.
* Exemples complets Mongoose et NestJS.
* Tests d’intégration complets.
* Publication npm.

---

## 54. Exemple final d’utilisation Mongoose

```ts
import { Schema, model } from 'mongoose';
import { schemigratePlugin } from '@tacxou/schemigrate';

const containerSchema = new Schema({
  name: String,
  image: String,
  port: String,
  ports: [String],
  network: {
    mode: String,
  },
});

containerSchema.plugin(schemigratePlugin, {
  currentVersion: CONTAINER_SCHEMA_V3,
  versionPath: '__schemaVersion',
  migrations: containerMigrations,
});

export const Container = model('Container', containerSchema);
```

---

## 55. Exemple final d’utilisation NestJS

```ts
@Module({
  imports: [
    SchemigrateModule.forRoot({
      logger: true,
    }),

    MongooseModule.forFeatureAsync([
      {
        name: Container.name,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const schema = ContainerSchema;

          schema.plugin(schemigratePlugin, {
            currentVersion: configService.get<SchemaVersion>(
              'CONTAINER_SCHEMA_VERSION',
              CONTAINER_SCHEMA_V3,
            ),
            versionPath: '__schemaVersion',
            migrations: containerMigrations,
          });

          return schema;
        },
      },
    ]),
  ],
  providers: [ContainerService],
})
export class ContainerModule {}
```

---

## 56. Philosophie du projet

Schemigrate doit être :

* explicite plutôt que magique ;
* sécurisé par défaut ;
* indépendant de NestJS dans son cœur ;
* agréable à utiliser avec NestJS ;
* compatible TypeScript ;
* prévisible en production ;
* adapté aux projets MongoDB qui évoluent dans le temps.

Comportement recommandé :

```txt
Sync explicite : commande ou démarrage opt-in, jamais silencieux par défaut.
Jamais de migration implicite au find : exception si document obsolète.
Si currentVersion > __schemaVersion, migrer via commande ou démarrage opt-in uniquement.
Status, downgrade et dry-run toujours disponibles via commande.
Métadonnées __migrationSnapshots et __migrationState conservées par défaut.
Downgrade, annulation d'échec et dry-run s'appuient sur ces métadonnées.
Pas de suppression de données implicite.
Pas de détournement de __v.
Champs réservés Schemigrate préfixés par __.
Versions de structure identifiées par timestamp de création.
Champs techniques masqués dans les réponses API par défaut.
Nettoyage des métadonnées uniquement sur action explicite.
Des migrations claires, testées et traçables.
```

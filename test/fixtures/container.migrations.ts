import type { Migration } from '../../src/types.js';
import {
  CONTAINER_SCHEMA_V1,
  CONTAINER_SCHEMA_V2,
  CONTAINER_SCHEMA_V3,
} from './versions.js';

export const containerMigrations: Migration[] = [
  {
    from: CONTAINER_SCHEMA_V1,
    to: CONTAINER_SCHEMA_V2,
    description: 'Transform port string into ports array',
    up: async (doc) => {
      // Idempotent (SPEC §44): Mongoose defaults array paths to [], so an
      // empty `ports` must still be filled from the legacy `port` field.
      if (doc.port && (!Array.isArray(doc.ports) || doc.ports.length === 0)) {
        doc.ports = [doc.port];
      }
      delete doc.port;
      return doc;
    },
    down: async (doc) => {
      if (Array.isArray(doc.ports)) doc.port = doc.ports[0];
      delete doc.ports;
      return doc;
    },
  },
  {
    from: CONTAINER_SCHEMA_V2,
    to: CONTAINER_SCHEMA_V3,
    description: 'Add network configuration',
    up: async (doc) => {
      doc.network ??= { mode: 'bridge' };
      return doc;
    },
    down: async (doc) => {
      delete doc.network;
      return doc;
    },
  },
];

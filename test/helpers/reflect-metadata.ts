// Polyfill required by NestJS decorators. The library itself never imports
// it (that's the consumer application's responsibility) — tests do.
import 'reflect-metadata';

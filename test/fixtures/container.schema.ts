import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ContainerDocument = HydratedDocument<Container>;

// Types are explicit in @Prop because the test runner (esbuild) does not emit
// design:type metadata. The legacy `port` field is kept for seeding fixtures.
@Schema()
export class Container {
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  image?: string;

  @Prop({ type: String })
  port?: string;

  @Prop({ type: [String], default: [] })
  ports?: string[];

  @Prop({ type: { mode: String }, _id: false })
  network?: { mode?: string };
}

export const ContainerSchema = SchemaFactory.createForClass(Container);

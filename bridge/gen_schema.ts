/**
 * gen_schema.ts — emit the canonical JSON Schema for the wire protocol.
 *
 * Usage: npm run gen:schema   (writes bridge/protocol.schema.json)
 *
 * The JSON Schema is derived directly from the Zod `Frame` union in
 * protocol.ts, so it can never drift from the contract. The Python side
 * consumes this file (see gen_pydantic.py) to validate frames identically.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Frame, PROTOCOL_VERSION } from "./protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));

const schema = zodToJsonSchema(Frame, {
  name: "Frame",
  $refStrategy: "none",
  target: "jsonSchema7",
});

const out = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Hermes Mobile Gateway wire protocol",
  protocolVersion: PROTOCOL_VERSION,
  ...schema,
};

const dest = join(here, "protocol.schema.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${dest}`);

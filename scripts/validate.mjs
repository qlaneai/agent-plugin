import { readFileSync, existsSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020.js"
import Ajv07 from "ajv"
import addFormats from "ajv-formats"

const read = (p) => JSON.parse(readFileSync(p, "utf8"))

const CHECKS = [
  {
    doc: "plugin.json",
    schema: "schemas/agent-plugins-1.0.0-plugin.schema.json",
    draft: "2020",
    id: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  },
  {
    doc: "mcp.json",
    schema: "schemas/agent-plugins-1.0.0-mcp.schema.json",
    draft: "2020",
    id: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  },
]

let failed = false
for (const { doc, schema, draft, id } of CHECKS) {
  if (!existsSync(doc)) {
    console.error(`✗ ${doc} — missing`)
    failed = true
    continue
  }
  if (!existsSync(schema)) {
    console.error(`✗ ${schema} — missing`)
    failed = true
    continue
  }
  const schemaDoc = read(schema)
  // A vendored schema is only worth compiling if it IS the schema we think it is.
  // An empty object, a fetch-error body, or a truncated file all compile fine and
  // then accept every document, so the run reports green while checking nothing.
  // The $id is what makes that failure loud instead of silent.
  if (schemaDoc.$id !== id) {
    console.error(`✗ ${schema} — not the expected schema ($id mismatch)`)
    console.error(`    expected ${id}`)
    console.error(`    found    ${schemaDoc.$id ?? "(no $id)"}`)
    failed = true
    continue
  }
  const Ajv = draft === "2020" ? (Ajv2020.default ?? Ajv2020) : (Ajv07.default ?? Ajv07)
  // strict: true so a mistyped keyword (e.g. "additionalProperies") is a hard
  // error rather than a silently ignored no-op that weakens the schema.
  const ajv = new Ajv({ allErrors: true, strict: true })
  addFormats.default ? addFormats.default(ajv) : addFormats(ajv)
  const validate = ajv.compile(schemaDoc)
  if (validate(read(doc))) {
    console.log(`✓ ${doc}`)
  } else {
    console.error(`✗ ${doc}`)
    for (const e of validate.errors) console.error(`    ${e.instancePath || "/"} ${e.message}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)

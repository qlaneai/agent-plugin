import { readFileSync, existsSync } from "node:fs"
import Ajv2020 from "ajv/dist/2020.js"
import Ajv07 from "ajv"
import addFormats from "ajv-formats"

const read = (p) => JSON.parse(readFileSync(p, "utf8"))

const CHECKS = [
  { doc: "plugin.json", schema: "schemas/agent-plugins-1.0.0-plugin.schema.json", draft: "2020" },
  { doc: "mcp.json", schema: "schemas/agent-plugins-1.0.0-mcp.schema.json", draft: "2020" },
]

let failed = false
for (const { doc, schema, draft } of CHECKS) {
  if (!existsSync(doc)) {
    console.error(`✗ ${doc} — missing`)
    failed = true
    continue
  }
  const Ajv = draft === "2020" ? (Ajv2020.default ?? Ajv2020) : (Ajv07.default ?? Ajv07)
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats.default ? addFormats.default(ajv) : addFormats(ajv)
  const validate = ajv.compile(read(schema))
  if (validate(read(doc))) {
    console.log(`✓ ${doc}`)
  } else {
    console.error(`✗ ${doc}`)
    for (const e of validate.errors) console.error(`    ${e.instancePath || "/"} ${e.message}`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)

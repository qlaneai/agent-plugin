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
  {
    // The MCP Registry entry. Its `version` is the SERVER's, not the plugin
    // package's — the schema calls it "Equivalent of Implementation.version".
    // The two are meant to differ; see scripts/version-audit.mjs. (Neither
    // literal is written out here: scripts/version-audit.mjs fails any tracked
    // file that carries the plugin version and is not on its declared list,
    // and prose counts.)
    doc: "server.json",
    schema: "schemas/mcp-registry-2025-12-11-server.schema.json",
    // Upstream publishes this one against draft-07, not 2020-12. Compiling a
    // draft-07 schema with the 2020-12 Ajv build silently changes what `$ref`
    // and `items` mean, so the draft is per-check rather than global.
    draft: "07",
    id: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    // Upstream generates this schema from an OpenAPI document, which leaves
    // `example` (singular — the OpenAPI spelling, not JSON Schema's `examples`)
    // on ~30 subschemas. Under `strict: true` an undeclared keyword is a hard
    // compile error, so it is declared here as the annotation it is. Declaring
    // it per-check rather than turning strict off keeps a genuine typo in OUR
    // two schemas loud.
    annotations: ["example"],
    // `strictRequired` is OFF by default in Ajv and only switched on by
    // `strict: true`. Upstream's Argument/Input definitions `require` a property
    // that a sibling allOf branch declares — legal JSON Schema, rejected only by
    // this one opinionated sub-option. Relaxing the single sub-option keeps the
    // rest of strict mode (unknown keywords, bad types, ignored `$ref` siblings)
    // enforced on this schema; `strict: false` would not.
    ajvOptions: { strictRequired: false },
  },
]

let failed = false
for (const { doc, schema, draft, id, annotations = [], ajvOptions = {} } of CHECKS) {
  // `strict` itself is NOT overridable per check: an entry may relax a NAMED
  // sub-option, never the mode that gives the others their meaning. Enforced
  // rather than merely documented — an ordering convention permits the override
  // it means to forbid, and reads as a guarantee to whoever comes next.
  if ("strict" in ajvOptions) {
    console.error(`✗ ${doc} — CHECKS may not set \`strict\`; relax a named sub-option instead`)
    failed = true
    continue
  }
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
  // Tracks which file a throw should be blamed on. A malformed schema and a
  // malformed document both surface as a JSON.parse/compile throw, and the
  // message alone does not say which file was being read.
  let reading = schema
  try {
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
    // Every relaxation is a named sub-option, visible in CHECKS next to its
    // reason; `strict` itself was rejected above.
    const ajv = new Ajv({ allErrors: true, strict: true, ...ajvOptions })
    addFormats.default ? addFormats.default(ajv) : addFormats(ajv)
    // Annotation-only: no `code`/`validate`, so it constrains nothing and only
    // stops strict mode from rejecting the vendored schema at compile time.
    for (const keyword of annotations) ajv.addKeyword({ keyword })
    const validate = ajv.compile(schemaDoc)
    reading = doc
    if (validate(read(doc))) {
      console.log(`✓ ${doc}`)
    } else {
      console.error(`✗ ${doc}`)
      for (const e of validate.errors) console.error(`    ${e.instancePath || "/"} ${e.message}`)
      failed = true
    }
  } catch (err) {
    // Reached when a file is not valid JSON at all (e.g. an HTML error page from
    // a failed fetch) or when ajv rejects the schema itself. Report it as a ✗
    // line rather than letting a raw stack trace escape.
    console.error(`✗ ${reading} — unreadable or invalid (${err.message})`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)

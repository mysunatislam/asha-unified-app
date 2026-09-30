import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { guides } from "../server/knowledge.js";

const MODULES = [
  "companion",
  "assessment",
  "facespeak",
  "fingerspeak",
  "senseassist",
  "vitalsense",
  "posture",
  "caregiver",
];

function requiredField(frontmatter, name) {
  const value = frontmatter.match(new RegExp(`^${name}:\\s+(.+)$`, "m"))?.[1];
  if (!value) throw new Error(`OKF concept missing ${name}`);
  return value.trim();
}

function concept(module) {
  const raw = readFileSync(new URL(`./${module}.md`, import.meta.url), "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u);
  if (!match) throw new Error(`Invalid OKF frontmatter: ${module}`);
  const [, frontmatter, body] = match;
  const type = requiredField(frontmatter, "type");
  const title = requiredField(frontmatter, "title");
  const description = requiredField(frontmatter, "description");
  const status = requiredField(frontmatter, "status");
  const resource = frontmatter.match(/^\s+resource:\s+(https:\/\/\S+)$/m)?.[1];
  if (type !== "App Guide" || !resource || status !== "draft") {
    throw new Error(`Unsupported OKF guidance metadata: ${module}`);
  }
  if (
    !/^generated: \{ by: codex\/[^,]+, at: \d{4}-\d{2}-\d{2}T[^}]+ \}$/m.test(
      frontmatter,
    ) ||
    !/^verified: \{ by: process:okf-source-parity-test, at: \d{4}-\d{2}-\d{2}T[^}]+ \}$/m.test(
      frontmatter,
    ) ||
    !frontmatter.includes("verification_scope: Exact guide-text match only;")
  ) {
    throw new Error(
      `OKF provenance or verification metadata missing: ${module}`,
    );
  }
  const guidance = body.replace(/^\s*# Guidance\s*\r?\n/u, "").trim();
  if (guidance !== guides[module]) {
    throw new Error(`OKF text differs from versioned app guide: ${module}`);
  }
  return {
    id: `guide:${module}`,
    module,
    type,
    title,
    description,
    status,
    text: guidance,
    provenance: resource,
    verification: "source-text-parity",
  };
}

export function compileOkf() {
  const index = readFileSync(new URL("./index.md", import.meta.url), "utf8");
  if (!/^---\r?\nokf_version: "0\.2"\r?\n---/u.test(index)) {
    throw new Error("OKF root index must declare version 0.2");
  }
  const documents = MODULES.map(concept);
  return `// Generated from okf/*.md by node okf/compile.mjs. Do not edit by hand.\nexport const okfDocuments = ${JSON.stringify(documents, null, 2)};\n`;
}

const invokedAsScript =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  writeFileSync(
    new URL("./generated.js", import.meta.url),
    compileOkf(),
    "utf8",
  );
}

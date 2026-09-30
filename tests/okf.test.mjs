import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileOkf } from "../okf/compile.mjs";
import { okfDocuments } from "../okf/generated.js";
import { guides } from "../server/knowledge.js";
import { retrieveKnowledge } from "../server/retrieval.js";

test("the OKF bundle, generated corpus, and versioned app guides agree", () => {
  const checkedIn = readFileSync(
    new URL("../okf/generated.js", import.meta.url),
    "utf8",
  );
  assert.equal(checkedIn, compileOkf());
  assert.deepEqual(
    okfDocuments.map((doc) => doc.module),
    Object.keys(guides),
  );
  for (const document of okfDocuments) {
    assert.equal(document.type, "App Guide");
    assert.equal(document.status, "draft");
    assert.equal(document.text, guides[document.module]);
    assert.match(document.provenance, /^https:\/\/github\.com\/mysunatislam\//);
    assert.equal(document.verification, "source-text-parity");
  }
});

test("retrieval returns the OKF source and the scope of its verification", () => {
  const [match] = retrieveKnowledge({
    query: "Can the camera measure blood pressure?",
  });
  assert.ok(match.id.startsWith("guide:vitalsense:"));
  assert.match(match.provenance, /\/server\/knowledge\.js$/);
  assert.equal(match.verification, "source-text-parity");
  assert.match(match.text, /cannot measure blood pressure/i);
});

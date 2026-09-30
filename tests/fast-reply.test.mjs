import assert from "node:assert/strict";
import test from "node:test";
import { instantGreeting } from "../app/fast-reply.js";

test("simple greetings return an immediate contextual reply", () => {
  assert.match(
    instantGreeting("Hi!", { view: "patient" }),
    /don't need to type/i,
  );
  assert.match(
    instantGreeting("hello asha", { view: "details", moduleName: "FaceSpeak" }),
    /viewing FaceSpeak/,
  );
  assert.match(
    instantGreeting("HEY", { view: "caregiver" }),
    /acknowledge patient requests/,
  );
});

test("Bangla greeting and selected Bangla language receive a Bangla reply", () => {
  assert.match(instantGreeting("হ্যালো", { language: "auto" }), /আমি আশা/);
  assert.match(instantGreeting("hi", { language: "bn" }), /আমি আশা/);
});

test("a greeting attached to a need or question never bypasses cloud verification", () => {
  for (const input of [
    "hi, I need water",
    "hello, can you call my caregiver?",
    "হ্যালো পানি চাই",
    "hi what can you do?",
    "I need help",
  ])
    assert.equal(instantGreeting(input), null, input);
});

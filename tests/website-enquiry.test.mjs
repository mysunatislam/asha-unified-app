import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEnquiryDraft,
  CONTACT_EMAIL,
  CONTACT_PHONE,
} from "../website/enquiry.js";
const input = {
  name: "Demo Visitor",
  email: "demo@example.com",
  organisation: "Test Care Team",
  interest: "kit",
  message: "I would like to discuss a bedside setup.",
  consent: true,
};
test("business enquiry drafts use only the confirmed owner contacts and never claim a sent or booked request", () => {
  const d = buildEnquiryDraft(input),
    mail = new URL(d.emailUrl),
    wa = new URL(d.whatsappUrl);
  assert.equal(mail.pathname, CONTACT_EMAIL);
  assert.equal(
    mail.searchParams.get("subject"),
    "Asha enquiry — Optional Asha Kit enquiry",
  );
  assert.equal(mail.searchParams.get("body"), d.body);
  assert.equal(wa.origin, "https://wa.me");
  assert.equal(wa.pathname, "/" + CONTACT_PHONE);
  assert.equal(wa.searchParams.get("text"), d.body);
  assert.match(d.body, /not a confirmed booking/);
  assert.doesNotMatch(d.emailUrl, /api-key|project-key/i);
});
test("business enquiry requires explicit contact consent and valid bounded fields", () => {
  for (const change of [
    { consent: false },
    { email: "bad" },
    { email: "evil@example.com\nBcc:other@example.com" },
    { name: "" },
    { message: "" },
  ])
    assert.throws(() => buildEnquiryDraft({ ...input, ...change }));
  const d = buildEnquiryDraft({
    ...input,
    name: "x".repeat(1000),
    message: "y".repeat(5000),
    interest: "bad\nBcc:other@example.com",
  });
  assert.equal(d.interest, "demo");
  assert.equal(d.subject, "Asha enquiry — Book a guided demo");
  assert.ok(d.body.length < 1400);
});
test("drafts preserve Bangla and special characters without creating extra email headers", () => {
  const message = "আমি একটি ডেমো চাই। & subject=Hi + ? #";
  const d = buildEnquiryDraft({ ...input, message });
  const mail = new URL(d.emailUrl);
  assert.ok(mail.searchParams.get("body").includes(message));
  assert.deepEqual([...mail.searchParams.keys()], ["subject", "body"]);
  assert.doesNotMatch(d.emailUrl, /\s/);
});

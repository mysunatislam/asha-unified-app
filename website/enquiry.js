// Public business contacts supplied by the owner. No enquiry is stored or sent
// by this static site; these helpers prepare an external email/WhatsApp draft.
export const CONTACT_EMAIL = "mysunatislam@gmail.com";
export const CONTACT_PHONE = "8801641576801";
export const INTERESTS = Object.freeze({
  demo: "Book a guided demo",
  kit: "Optional Asha Kit enquiry",
  hospital: "Hospital / care-provider pilot",
  homecare: "Home and family support",
});
const text = (value, max) =>
  String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
export function buildEnquiryDraft(input = {}) {
  const name = text(input.name, 100),
    email = text(input.email, 160),
    organisation = text(input.organisation, 120),
    message = text(input.message, 1000);
  if (
    !name ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !message ||
    input.consent !== true
  )
    throw new Error(
      "Please complete your name, email, enquiry and contact consent.",
    );
  const interest = Object.hasOwn(INTERESTS, input.interest)
    ? input.interest
    : "demo";
  const subject = "Asha enquiry — " + INTERESTS[interest];
  const body = [
    INTERESTS[interest],
    "",
    "Name: " + name,
    "Reply email: " + email,
    ...(organisation ? ["Organisation: " + organisation] : []),
    "",
    "Enquiry:",
    message,
    "",
    "I agree to be contacted about this enquiry.",
    "Please reply to discuss availability; this is not a confirmed booking.",
  ].join("\n");
  return {
    interest,
    subject,
    body,
    emailUrl:
      "mailto:" +
      CONTACT_EMAIL +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body),
    whatsappUrl:
      "https://wa.me/" + CONTACT_PHONE + "?text=" + encodeURIComponent(body),
  };
}

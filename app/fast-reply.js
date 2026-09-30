const ENGLISH_GREETINGS = new Set([
  "hi",
  "hello",
  "hey",
  "hi asha",
  "hello asha",
  "hey asha",
]);
const BANGLA_GREETINGS = new Set([
  "হাই",
  "হ্যালো",
  "নমস্কার",
  "সালাম",
  "আসসালামু আলাইকুম",
]);

export function instantGreeting(
  text,
  { language = "auto", view = "patient", moduleName = "this module" } = {},
) {
  if (typeof text !== "string") return null;
  const greeting = text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[!?.,।！？،]+$/gu, "")
    .trim()
    .replace(/\s+/gu, " ");
  const isEnglish = ENGLISH_GREETINGS.has(greeting);
  const isBangla = BANGLA_GREETINGS.has(greeting);
  if (!isEnglish && !isBangla) return null;

  const bangla = language === "bn" || isBangla;
  if (bangla) {
    if (view === "caregiver")
      return "হ্যালো, আমি আশা। এখানে রোগীর অনুরোধ দেখতে ও প্রাপ্তি নিশ্চিত করতে পারবেন।";
    if (view === "settings")
      return "হ্যালো, আমি আশা। এখানে আমার কণ্ঠ ও নিয়মিত খোঁজ নেওয়ার সেটিংস বদলাতে পারবেন।";
    if (view === "setup")
      return "হ্যালো, আমি আশা। পরিচর্যাকারী এখানে রোগীর সক্ষমতা অনুযায়ী ব্যবস্থা ঠিক করতে পারবেন।";
    if (view === "welcome")
      return "হ্যালো, আমি আশা। ডেমো দেখতে পারেন, অথবা পরিচর্যাকারীর সঙ্গে ব্যক্তিগত সেটআপ করতে পারেন।";
    if (view === "details")
      return `হ্যালো, আমি আশা। এখন ${moduleName} দেখছেন। আমি এই অংশটি ব্যবহার করতে সাহায্য করব।`;
    return "হ্যালো, আমি আশা। আমি আপনার সঙ্গে আছি। আপনার জন্য ঠিক করা মুখ, হাত বা কণ্ঠের প্রতিক্রিয়া ব্যবহার করতে পারেন; টাইপ করার দরকার নেই।";
  }

  if (view === "caregiver")
    return "Hi, I'm Asha. This is the caregiver page. You can review and acknowledge patient requests here.";
  if (view === "settings")
    return "Hi, I'm Asha. A caregiver can choose my voice and check-ins in Settings.";
  if (view === "setup")
    return "Hi, I'm Asha. A caregiver can set up the movements and senses you can use here.";
  if (view === "welcome")
    return "Hi, I'm Asha. You can explore the demo or set up a private care circle.";
  if (view === "details")
    return `Hi, I'm Asha. You're viewing ${moduleName}. I'll guide you through this module.`;
  return "Hi, I'm Asha. I'm here with you. You don't need to type; use the face, hand, or voice responses set up for you.";
}

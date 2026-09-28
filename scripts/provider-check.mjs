import fs from "node:fs/promises";
const k = JSON.parse(await fs.readFile("D:/mairaapi.json", "utf8"));
for (const endpoint of ["voice-typing/session", "realtime/sessions"]) {
  const r = await fetch("https://api.recommender.gigalogy.com/v1/" + endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": k.api_key,
      "project-key": k.project_key,
    },
    body: JSON.stringify({ user_id: "asha-live-connection-check" }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  console.log(
    endpoint,
    r.status,
    "response fields",
    Object.keys(d),
    "detail fields",
    d.detail && typeof d.detail === "object"
      ? Object.keys(d.detail)
      : typeof d.detail,
  );
  // Never print tickets, tokens, URLs or account secrets.
  if (r.ok && endpoint === "voice-typing/session") {
    const t = d.slot_token || d.detail?.slot_token;
    if (t)
      await fetch("https://api.recommender.gigalogy.com/v1/" + endpoint, {
        method: "DELETE",
        headers: {
          "api-key": k.api_key,
          "project-key": k.project_key,
          "slot-token": t,
        },
      });
  }
}

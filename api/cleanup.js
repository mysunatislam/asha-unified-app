import { store, base } from "../server/common.js";
import { hash, equal } from "../server/logic.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (
    !process.env.CRON_SECRET ||
    !equal(
      hash(String(req.headers.authorization || "")),
      hash("Bearer " + process.env.CRON_SECRET),
    )
  )
    return res.status(401).json({ error: "Unauthorized" });
  try {
    const keys = await store.list("asha-live/v1/", 5000),
      profiles = keys.filter((k) => k.endsWith("/profile.json"));
    let removed = 0;
    for (const key of profiles) {
      const p = await store.read(key);
      if (p && Date.parse(p.expiresAt) < Date.now()) {
        const group = keys.filter((k) => k.startsWith(base(p.patientId) + "/"));
        await store.remove(group);
        removed++;
      }
    }
    const limits = await store.list("asha-live/limits/", 5000),
      today = new Date().toISOString().slice(0, 10);
    const old = limits.filter((k) => k.split("/")[2] < today);
    await store.remove(old);
    res.json({ expiredSessionsRemoved: removed });
  } catch {
    res.status(503).json({ error: "Cleanup unavailable" });
  }
}

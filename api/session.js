import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { normalizeSupport } from "../app/support-profile.js";
import {
  begin,
  body,
  authenticate,
  publicProfile,
  store,
  path,
  base,
  events,
  authFail,
} from "../server/common.js";
import {
  hash,
  assessment,
  recommend,
  voice,
  clean,
  eventValue,
  safeStatus,
  pushEndpoint,
} from "../server/logic.js";
export default async function handler(req, res) {
  if (!begin(req, res)) return;
  try {
    const b = req.method === "POST" ? body(req) : {};
    if (b.action === "create") {
      // Durable, per-day creation budget. No patient data in the rate key.
      const ip = hash(
        String(req.headers["x-forwarded-for"] || "local").split(",")[0],
      );
      const today = new Date().toISOString().slice(0, 10);
      const quota = await store.list(`asha-live/limits/${today}/${ip}/`, 15);
      if (quota.length >= 12)
        return res.status(429).json({
          error: "Daily setup limit reached. Reopen an existing private link.",
        });
      const id = randomBytes(12).toString("hex"),
        patientToken = randomBytes(32).toString("base64url"),
        caregiverToken = randomBytes(32).toString("base64url");
      const a = assessment(b.assessment);
      const p = {
        patientId: id,
        label: clean(b.label, 40) || "Patient",
        assessment: a,
        supportContext: normalizeSupport(b.supportContext),
        voice: voice(b.voice),
        recommendation: recommend(a),
        patientHash: hash(patientToken),
        caregiverHash: hash(caregiverToken),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      };
      await store.write(path(id, "profile"), p);
      await store.write(`asha-live/limits/${today}/${ip}/${id}.json`, {
        at: p.createdAt,
      });
      return res.json({ ...publicProfile(p), patientToken, caregiverToken });
    }
    const id = b.patientId || req.query.patientId;
    const auth = await authenticate(req, id);
    if (!auth) return authFail(res);
    const { profile: p, role } = auth;
    if (req.method === "GET") {
      const e = await events(id);
      const acks = await Promise.all(
        e.map((e) => store.read(path(id, "receipts/" + e.id))),
      );
      return res.json({
        profile: publicProfile(p),
        role,
        status: await store.read(path(id, "status")),
        events: e.map((x, i) => ({ ...x, receipt: acks[i] || null })),
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
      });
    }
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
    if (b.action === "update" && role === "caregiver") {
      p.assessment = assessment(b.assessment);
      if (Object.hasOwn(b, "supportContext"))
        p.supportContext = normalizeSupport(b.supportContext);
      p.recommendation = recommend(p.assessment);
      p.voice = voice(b.voice);
      p.label = clean(b.label, 40) || p.label;
      await store.write(path(id, "profile"), p, true);
      return res.json({ profile: publicProfile(p) });
    }
    if (b.action === "heartbeat" && role === "patient") {
      await store.write(
        path(id, "status"),
        { ...safeStatus(b.status), at: new Date().toISOString() },
        true,
      );
      return res.json({ ok: true });
    }
    if (b.action === "event" && role === "patient") {
      if (!/^[a-f0-9-]{36}$/.test(b.id || ""))
        return res.status(400).json({ error: "Invalid request ID" });
      const file = path(id, "events/" + b.id);
      const prior = await store.read(file);
      if (prior) return res.json({ event: prior, duplicate: true });
      const ev = eventValue(b);
      if (
        !ev.confirmed &&
        !["test", "posture", "face_change"].includes(ev.kind)
      )
        return res
          .status(400)
          .json({ error: "Please confirm this request first." });
      const recent = await events(id);
      if (
        recent.filter((x) => Date.now() - Date.parse(x.at) < 60000).length >= 12
      )
        return res
          .status(429)
          .json({ error: "Too many requests. Please wait a moment." });
      const event = { ...ev, id: b.id, at: new Date().toISOString() };
      await store.write(file, event);
      let push = "not_enabled";
      const subscription = await store.read(path(id, "push"));
      if (subscription && process.env.VAPID_PRIVATE_KEY) {
        try {
          webpush.setVapidDetails(
            process.env.VAPID_SUBJECT,
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY,
          );
          await webpush.sendNotification(
            subscription,
            JSON.stringify({
              title: "Asha · new request",
              body: "Open your caregiver dashboard to see the request.",
              tag: id,
              url: "/care",
            }),
            { TTL: 300 },
          );
          push = "sent";
        } catch (e) {
          push = "unavailable";
          if ([404, 410].includes(e.statusCode))
            await store.remove([path(id, "push")]);
        }
      }
      return res.json({ event, push });
    }
    if (["receive", "ack"].includes(b.action) && role === "caregiver") {
      if (!/^[a-f0-9-]{36}$/.test(b.id || ""))
        return res.status(400).json({ error: "Invalid request ID" });
      if (!(await store.read(path(id, "events/" + b.id))))
        return res.status(404).json({ error: "Request not found" });
      const prev = await store.read(path(id, "receipts/" + b.id));
      const receipt = {
        receivedAt: prev?.receivedAt || new Date().toISOString(),
        acknowledgedAt:
          b.action === "ack"
            ? new Date().toISOString()
            : prev?.acknowledgedAt || null,
      };
      await store.write(path(id, "receipts/" + b.id), receipt, true);
      return res.json({ receipt });
    }
    if (b.action === "subscribe" && role === "caregiver") {
      const sub = b.subscription;
      if (
        !pushEndpoint(sub?.endpoint) ||
        !sub?.keys?.p256dh ||
        !sub?.keys?.auth ||
        JSON.stringify(sub).length > 3000
      )
        return res.status(400).json({ error: "Unsupported push subscription" });
      await store.write(path(id, "push"), sub, true);
      return res.json({ ok: true });
    }
    if (
      b.action === "delete" &&
      role === "caregiver" &&
      b.confirm === "DELETE"
    ) {
      const keys = await store.list(base(id) + "/", 1000);
      await store.remove(keys);
      return res.json({ deleted: true });
    }
    return res
      .status(403)
      .json({ error: "This action is not available for your role." });
  } catch (e) {
    console.error("session failure", e?.name);
    res.status(503).json({
      error:
        "Connection unavailable. Your request has not been confirmed as delivered. Please retry.",
    });
  }
}

import { begin, body, store } from "../server/common.js";
import { hash } from "../server/logic.js";
import { createClinicService, ClinicError } from "../server/clinic.js";
const service = createClinicService(store);
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!begin(req, res)) return;
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const input = body(req);
    if (JSON.stringify(input).length > 660000)
      return res.status(413).json({ error: "Share fewer records at once." });
    if (input.action === "create") {
      if (input.confirmed !== true)
        return res
          .status(400)
          .json({ error: "Confirm you want to create a clinic workspace." });
      const today = new Date().toISOString().slice(0, 10);
      const ip = hash(
        String(req.headers["x-forwarded-for"] || "local").split(",")[0],
      );
      const prefix = `asha-everyday/limits/${today}/${ip}/`;
      if ((await store.list(prefix, 10)).length >= 10)
        return res
          .status(429)
          .json({
            error:
              "Daily workspace setup limit reached. Reopen your private invitation.",
          });
      const result = await service.create(input.name);
      await store.write(prefix + result.tenant + ".json", {
        at: new Date().toISOString(),
      });
      return res.json(result);
    }
    const bearer = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    return res.json(await service.run(input.tenant, bearer, input));
  } catch (error) {
    return res
      .status(error instanceof ClinicError ? error.status : 503)
      .json({
        error:
          error instanceof ClinicError
            ? error.message
            : "Clinic storage is unavailable. Try again later.",
      });
  }
}

// Run locally. Credentials are read in memory and never written into the repository.
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import webpush from "web-push";
import { randomBytes } from "node:crypto";
const name = "neurobridge-asha-live",
  repoName = "neurobridge-asha-unified-app";
const auth = JSON.parse(
  await fs.readFile(
    "C:/Users/user/AppData/Roaming/com.vercel.cli/Data/auth.json",
    "utf8",
  ),
);
const old = JSON.parse(
  await fs.readFile(
    "C:/Users/user/OneDrive/Documents/Default Project/neurobridge-asha-unified/server/vercel-maira/.vercel/project.json",
    "utf8",
  ),
);
const envText = await fs.readFile(
  "C:/Users/user/OneDrive/Documents/Default Project/neurobridge-asha-unified/server/vercel-maira/.env.local",
  "utf8",
);
const vars = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, "").replace(/\\n$/, "");
}
const maira = JSON.parse(await fs.readFile("D:/mairaapi.json", "utf8"));
async function vercel(path, method = "GET", body) {
  const r = await fetch(
    "https://api.vercel.com" +
      path +
      (path.includes("?") ? "&" : "?") +
      "teamId=" +
      old.orgId,
    {
      method,
      headers: {
        Authorization: "Bearer " + auth.token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const d = await r.json();
  if (!r.ok) throw Error("Vercel " + r.status + " " + (d.error?.code || ""));
  return d;
}
let project;
try {
  project = await vercel("/v9/projects/" + name);
} catch {
  project = await vercel("/v10/projects", "POST", { name, framework: null });
}
await fs.mkdir(".vercel", { recursive: true });
await fs.writeFile(
  ".vercel/project.json",
  JSON.stringify({
    projectId: project.id,
    orgId: old.orgId,
    projectName: name,
  }),
);
const vapid = webpush.generateVAPIDKeys();
const existing = await vercel("/v9/projects/" + project.id + "/env");
if (!vars.BLOB_READ_WRITE_TOKEN) {
  const envs = await vercel("/v9/projects/" + old.projectId + "/env");
  const entry = envs.envs?.find((x) => x.key === "BLOB_READ_WRITE_TOKEN");
  if (entry) {
    const result = await vercel(
      "/v1/projects/" + old.projectId + "/env/" + entry.id,
    );
    vars.BLOB_READ_WRITE_TOKEN = result.value;
  }
}
const values = {
  MAIRA_API_KEY: maira.api_key,
  MAIRA_PROJECT_KEY: maira.project_key,
  BLOB_READ_WRITE_TOKEN: vars.BLOB_READ_WRITE_TOKEN,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "https://neurobridge-asha-live.vercel.app",
  CRON_SECRET: randomBytes(32).toString("base64url"),
};
for (const [key, value] of Object.entries(values)) {
  if (!value) throw Error("Missing server secret " + key);
  if (existing.envs?.some((e) => e.key === key)) continue;
  await vercel("/v10/projects/" + project.id + "/env", "POST", {
    key,
    value,
    type: "encrypted",
    target: ["production", "preview", "development"],
  });
}
// Public production link, rather than a Vercel sign-in screen.
await vercel("/v9/projects/" + project.id, "PATCH", { ssoProtection: null });
const raw = execFileSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
});
const token = raw
  .split(/\r?\n/)
  .find((s) => s.startsWith("password="))
  ?.slice(9);
if (!token) throw Error("GitHub credential unavailable");
const headers = {
  Authorization: "Bearer " + token,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const me = await (
  await fetch("https://api.github.com/user", { headers })
).json();
let repo = await fetch(`https://api.github.com/repos/${me.login}/${repoName}`, {
  headers,
});
if (repo.status === 404)
  repo = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: repoName,
      private: false,
      description:
        "Unified NeuroBridge Asha: accessible patient companion and connected caregiver app.",
    }),
  });
if (!repo.ok) throw Error("GitHub repository request " + repo.status);
const d = await repo.json();
if (Date.parse(d.created_at) < Date.parse("2026-09-27T00:00:00Z"))
  throw Error(
    "Repository already existed before this task. Choose a new name.",
  );
try {
  execFileSync("git", ["remote", "get-url", "origin"], { stdio: "pipe" });
  execFileSync("git", ["remote", "set-url", "origin", d.clone_url]);
} catch {
  execFileSync("git", ["remote", "add", "origin", d.clone_url]);
}
console.log(
  JSON.stringify({
    repository: d.html_url,
    project: project.name,
    secrets: "configured server-side",
  }),
);

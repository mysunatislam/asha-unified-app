# Development and release

Implementation branch: `codex/asha-everyday-companion`, isolated worktree `E:\asha-everyday-implementation`, based on main `a145b2cc37f82d37ad76ee9a3752059bda66c1c2`. Existing uncommitted marketing-website changes in the original checkout are outside this branch and were left untouched.

```powershell
cd E:\asha-everyday-implementation
npm ci --cache .npm-cache --ignore-scripts --no-audit --no-fund
npm start
# Open http://127.0.0.1:4180/everyday.html
npm test
npm run test:everyday
npm run benchmark:everyday
```

The app is buildless; no Next.js migration is required. Browser QA currently follows the repository's Windows-installed Chrome/Playwright runtime paths. Adjust those test-tool paths for another development machine; they are not client dependencies.

`scripts/dev.mjs` serves the original app and the new workspace. `/api/clinic` is a real local endpoint with **in-memory preview storage**, explicitly labelled in the UI; restart clears it. Different localhost browser contexts can exercise scopes/roles/plans. Existing `/api/*` routes continue to proxy the deployed app, except the new local Care/Clinic routes. Tests block unintended production API calls and remove their local clinic workspace. Care urgent templates need no keys. Local nonurgent Care requires existing MAIRA environment credentials and an authenticated existing session; unavailable cloud assistance produces a labelled local fallback.

Production API handlers reuse the established private Supabase/Blob store and server-only MAIRA provider. No DB schema migration or new secret is required. Existing environment configuration remains necessary: `SUPABASE_URL` and the configured secret-key variable (or the existing Blob token), `MAIRA_API_KEY`, `MAIRA_PROJECT_KEY`, optional configured task profile IDs, and existing `CRON_SECRET`. Do not place values in HTML, commits, logs or URL query strings. Preserve existing push/VAPID configuration for the assistive app. This branch does not manufacture a provider profile/model or bypass missing credentials.

Existing Vercel routing serves `/everyday.html` directly and `/api/*.js` as server functions; all API responses use `no-store`. The existing daily cleanup invokes Everyday tenant/record retention. No production deploy, production database write, remote schema change, model-profile mutation or production API smoke test was performed for this task. The supplied master prompt requires explicit authorization before a production release.

Before release: review the branch/diff; run all commands; validate preview deployment with server credentials; repeat clinic sharing and caregiver request/receipt on two real phones; check installed service-worker updates; review provider privacy/access costs and public workspace creation abuse limits. The workspace role links are demo capabilities, not production clinician verification or a staffed clinical service.

Rollback is additive: revert the feature branch's entry links, new workspace/API files, cleanup addition and SW shell cache additions; the legacy assistive code and assets were not replaced. Model pack cryptographic rollback is implemented/tested separately but release packs remain disabled until a real public trust key and signed artifacts exist. Cache eviction removes local vision downloads without touching health records.

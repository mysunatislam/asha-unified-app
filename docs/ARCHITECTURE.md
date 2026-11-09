# Everyday companion architecture

The existing buildless HTML/ES-module app is preserved at `/` and `/app`. The additive workspace is `/everyday.html`. It uses the same MediaPipe assets, browser speech infrastructure, MAIRA provider and private server store. No framework, database, auth provider or trained checkpoint was added.

```mermaid
flowchart LR
  Input[Camera / photo / voice / touch] --> Consent[Module consent and quality gates]
  Consent --> Local[One task model and deterministic algorithms]
  Local --> Confirm[User review and confirmation]
  Confirm --> Evidence[Provenance records in memory]
  Evidence --> Vault[Optional AES-GCM IndexedDB vault]
  Evidence --> Clinic[Explicit scoped clinic sharing]
  Input --> Safety[Versioned local symptom rules]
  Safety -->|urgent| Template[Offline urgent template / user-operated call link]
  Safety -->|nonurgent and cloud consent| API[Authenticated Care API]
  API --> Provider[Existing MAIRA task routes]
  Provider --> Verify[Bounded JSON response and output checks]
  Verify --> UI[Educational explanation]
  Clinic --> Store[Existing private Supabase or Blob adapter]
```

`contracts.js` defines the JSDoc evidence contract and runtime validation. `EvidenceStore` owns local saving consent, encryption, retention and deletion. `CameraManager` owns a single stream/model and cancels late startup on navigation, backgrounding or model failure. `ModelManager` validates weight bytes before the existing MediaPipe runtime loads them; it tries GPU then CPU/WASM. WebGPU is detected as a device capability, not claimed as a separately implemented runtime.

Nutrition uses attributed ingredient records and deterministic gram arithmetic. Move uses aspect-correct camera-plane joint geometry, One Euro filtering and complete-cycle state machines. EyeSpeak fits personal iris/head regression, then requires held-out target checks before dwell selection. Care evaluates local rules before cloud authorization or generation. The existing assistive app retains its own established camera lifecycle; leaving it for Everyday is full navigation, and Everyday stops its camera before any module transition.

`/api/clinic` uses random capability credentials, hashed at rest, tenant-prefixed keys, server-enforced roles, per-patient sharing grants and audited actions. This is a demo access mechanism matching the existing private-link design, not identity verification or a clinical account system. Billing is a future tenant-scoped concern; no payment integration exists.

The local preview routes new Clinic requests to explicitly labelled in-memory storage. Production handlers reuse `server/common.js` and its existing private store. They were not deployed or migrated as part of this change. Care's live provider requires the existing server MAIRA credentials and session store; an unavailable provider falls back to local educational guidance. No private key appears in a client bundle.

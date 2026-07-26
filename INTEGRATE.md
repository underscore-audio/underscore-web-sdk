# Integrate Underscore into a host app (for agents & humans)

Underscore generates and plays **audio inside your app**. You describe
what you want; the API produces a playable artifact; the browser SDK
renders it with WebAssembly. You do **not** need to know SuperCollider.

The install wizard (`npx @underscore-audio/wizard`) only does
**plumbing**: deps, WASM assets, COOP/COEP headers, API keys, and a
throwaway demo. It does **not** decide how music fits your product.

This document is the product half. Use it after the wizard (or a manual
install) when wiring real UX. Published with the SDK repo; also linked
from the wizard outro and from
[install-with-ai](https://docs.underscore.audio) docs.

> **Game-state adaptive music** (score follows level, mood, streak, etc.)
> is a natural next step via synth parameters and re-generation, but is
> **not** required for a first integration. Most apps start with a fixed
> aesthetic brief and a warm ambient bed.

---

## Glossary (60 seconds)

| Term                            | Meaning                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| **Composition**                 | A container (`cmp_…`) that owns generated artifacts for your app/project.         |
| **Synth**                       | One playable sound instrument (optional short score). Fast to generate.           |
| **Program**                     | A multi-synth arranged piece (ambient beds, longer forms). Use `kind: "program"`. |
| **Publishable key** (`us_pub_`) | Safe in the browser. Load + play only.                                            |
| **Secret key** (`us_sec_`)      | Server only. Starts generation jobs.                                              |
| **Complexity**                  | Stable dial: `fast` \| `balanced` \| `rich`. Prefer this over pinning `model`.    |

---

## Non-negotiables

1. **`init()` inside a user gesture** (click / tap / keydown). Otherwise
   the browser keeps `AudioContext` suspended.
2. **Secret key never in the browser.** Your server calls
   `startGeneration` (or raw `POST …/generate`) and returns
   `{ streamUrl, host }` to the client — see `examples/backend-proxy/`.
3. **COOP `same-origin` + COEP `require-corp`** on every origin that
   serves the page (dev and prod). Needed for SharedArrayBuffer / WASM.
4. **Do not ship the wizard demo as product UX.**
5. **Prefer `complexity` over pinning `model`** unless you explicitly
   need a specific backend model.
6. **Fail soft.** Music outages must not brick core product flows.

---

## Minimal end-to-end (copy this shape)

```ts
// Browser (publishable key) — on Play click:
await underscore.init();

// Your server (secret key) — proxy returns streamUrl + host
const { streamUrl, host } = await fetch("/api/underscore/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Slow ambient bed for a casual puzzle game, ~2 minutes, loopable.",
    kind: "program", // or omit for single synth
    complexity: "rich", // prefer over model pins
  }),
}).then((r) => r.json());

const absolute = streamUrl.startsWith("http") ? streamUrl : `${host}${streamUrl}`;

for await (const event of underscore.subscribeToGeneration(absolute, {
  compositionId, // enables auto-load on ready
  kind: "program", // hint if a ready event omits kind
})) {
  if (event.type === "ready" && event.program) {
    await event.program.play();
    break;
  }
  if (event.type === "ready" && event.synth) {
    await event.synth.play();
    break;
  }
  if (event.type === "error") throw new Error(event.error);
}
```

Server-side generation details:
[server-side generation](https://docs.underscore.audio/web-sdk/server-side-generation)
(or `examples/backend-proxy/` in this repo).

---

## Interview the host app first

Ask or infer answers before choosing a pattern.

### Product intent

| Question                                        | Why it matters                            |
| ----------------------------------------------- | ----------------------------------------- |
| Ambient bed, interactive instrument, or both?   | Program vs Synth vs param modulation      |
| New piece per session/level, or one shared bed? | Generate-per-entry vs load once           |
| Content-adaptive music feasible?                | Often **no** at first — use a fixed brief |
| Mute / volume UI already exists?                | Reuse it; persist preference              |

### Lifecycle & latency

| Question                                       | Why it matters                                |
| ---------------------------------------------- | --------------------------------------------- |
| What gesture starts real use?                  | Call `init()` there, **before** long awaits   |
| How long can users wait before interactive UI? | Gate vs overlap vs warm pool                  |
| Program gen can take minutes                   | Almost always needs a warm backup or pre-seed |
| Does navigation unmount often?                 | Abort SSE on teardown                         |

### Artifact type

| Choice                     | Default                                                  |
| -------------------------- | -------------------------------------------------------- |
| Single pad (`Synth`)       | Reactive / lower latency (`complexity: "fast"`)          |
| Arranged piece (`Program`) | Ambient beds; `kind: "program"`                          |
| Both                       | Exclusive playback — synth and program don’t double-play |

Stop and ask the human if **latency budget** or **secret-key home** is unclear.

---

## Integration patterns

Pick **one** primary pattern.

### A — Load a known starter (fastest path)

Wizard / discover / curated composition. `init` → `loadSynth` or
`loadProgram` → `play`. No generation in the hot path.

### B — Generate on demand (accept wait)

Proxy `startGeneration` → SSE → auto-load → play. Show a loading state.
Fine when users expect a wait.

### C — Warm backup + gate (recommended for games)

Keep **one** ready Program (or Synth) ahead of the player. On Play:
claim → load → play (gate UI until audible or soft-fail), then refill
in the background. Overlap music prepare with other loading work on the
**same gesture turn** (critical on iOS Safari).

Reference consumer: [Makespell](https://github.com/po/makespell) dogfood
integration (`web/src/audio/`, Rust `/api/underscore/generate` proxy).

### D — Parametric / reactive (later)

Drive `setParam` from game state. Does not replace a bed; layers on A–C.

### E — Playlist / sections

`Program` sections + `seek` / `seekToSection`. Good for structured scores.

---

## Suggested module layout

```
src/audio/
  client.ts          # Underscore singleton (publishable key)
  generateProxy.ts   # POST your /api/.../generate → { streamUrl, host }
  session.ts         # init/unlock, current artifact, mute, optional loop
  backupQueue.ts     # pattern C only
```

Server: secret key + composition id → Underscore
`POST /api/v1/compositions/:id/generate` with `{ description, kind?, complexity?, model? }`.

---

## Checklist before shipping

- [ ] `init()` only from a user gesture; verified on iOS Safari
- [ ] Secret key only on server; publishable key in client env
- [ ] COOP/COEP on dev and prod; fonts/CDNs don’t break COEP
- [ ] Wizard demo removed or unreachable in production
- [ ] Soft-fail path: music down → product still works
- [ ] Mute persists; volume sane for mobile speakers
- [ ] Abort generation SSE on navigation / unmount
- [ ] If using Programs: `kind: "program"` on generate + handle `event.program`

---

## Anti-patterns

- Calling `init()` / `play()` from `useEffect` with no gesture
- Putting `us_sec_` in Vite/`NEXT_PUBLIC_` env
- Pinning a model string when `complexity` would do
- Blocking the whole app forever on a failed generate (no timeout)
- Auto-loading a refill Program into the live engine while another piece
  is playing (subscribe **without** `compositionId` if you only need the name)
- Re-implementing SuperCollider in the host app

---

## References

- SDK README — client API surface
- `examples/backend-proxy/` — secret-key proxy + browser subscribe
- `examples/hello-world/` — minimal play
- Server-side generation docs — proxy contract
- Makespell README § Underscore — full local dogfood runbook (pattern C)

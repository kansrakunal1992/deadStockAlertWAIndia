# Context Ingestion (Elite) — v1 delivery manifest

Verified: `npx tsc --noEmit` clean across the full project (the only remaining
errors are a pre-existing `TS2802` iteration-target pattern already present
in ~15 other shipped files, e.g. `lib/rate-limit.ts` — unrelated to this work
and not introduced by it).

Entire feature is OFF until you set one env var (see "Deploy steps" below).

## New files

| File | Purpose |
|---|---|
| `supabase/add_context_ingestion.sql` | `context_ingestion` + `user_memory_facts` tables, pgvector, RLS |
| `supabase/add_context_ingestion_kpi.sql` | `sessions.had_context_ingestion` — cold-start KPI column |
| `lib/embeddings.ts` | OpenAI embeddings wrapper + cosine similarity (new vendor dep — see below) |
| `lib/context-export-parser.ts` | Client-side ChatGPT/Claude/.zip/.json/plaintext parsing — runs in the browser, before anything is sent to the server |
| `lib/context-extractor.ts` | Server-side extraction (`extractMemoryFacts`) + reanalyze (`reanalyzeFacts`) LLM calls |
| `lib/context-dedup.ts` | Cosine-similarity dedup against existing facts + structured profile picks |
| `lib/foundational-context.ts` | Third Council prompt layer — sibling to Decision History and Mirror |
| `app/api/context-ingestion/route.ts` | GET status, POST ingest, DELETE ("Forget imported context") |
| `app/api/context-ingestion/confirm/route.ts` | POST — accept/edit/reject review, returns retained count |
| `app/api/context-ingestion/reanalyze/route.ts` | POST — refresh existing facts with the current model, no raw text involved |
| `components/ContextIngestionPanel.tsx` | Self-contained UI: locked teaser → upload/paste → 4-step progress → review → saved+manage |

## Modified files

| File | Change |
|---|---|
| `lib/types.ts` | All Context Ingestion types |
| `lib/feature-flags.ts` | **`isContextIngestionEnabled()`** — the master gate — plus `contextIngestionCanOverrideProfile()` |
| `lib/encryption.ts` | Documented `user_memory_facts.insight_text` as an encrypted-column exception |
| `lib/audit.ts` | `context_ingestion.upload / .save / .reanalyze / .forget` actions |
| `lib/rate-limit.ts` | `LIMITS.contextIngestion` (10 / 15 min per IP) |
| `lib/council-context.ts` | Added `userProfile` to the shared `CouncilContext` shape, so the new foundational-context layer can reuse the profile fetch already done for SB-3 instead of a duplicate query |
| `app/api/persona/route.ts` | Wires `fetchFoundationalContext()` in as a new parallel promise + a new labeled prompt layer, gated by the flag |
| `app/api/account/export/route.ts` | Added `context_ingestion` + decrypted `user_memory_facts` to the GDPR export payload |
| `components/ProfileCaptureOverlay.tsx` | One gated, non-interactive teaser line — no new state, no new step |
| `app/mirror/page.tsx` | Mounts `<ContextIngestionPanel>` |
| `app/settings/privacy/page.tsx` | Tracks `authToken`, mounts the same panel for status/reanalyze/forget |
| `package.json` | Added `jszip` (client-side export unzipping) |

## Deploy steps

1. Run both new SQL migrations against Supabase, in order.
2. `npm install` (pulls in `jszip`).
3. **New required env var:** `OPENAI_API_KEY` — embeddings (dedup + future semantic retrieval) degrade gracefully to "skipped" without it, but dedup won't work until it's set.
4. **Optional env var:** `CONTEXT_INGESTION_ALLOW_PROFILE_OVERRIDE=true` — leave unset for the default (imported facts stay supplementary to explicit profile picks).
5. **The master switch — feature stays fully off until you set:**
   ```
   NEXT_PUBLIC_CONTEXT_INGESTION_ENABLED=true
   ```
   on the Railway service, then redeploy. Every route, the onboarding teaser line, and both UI mount points check this — with it unset/false, nothing new is visible or reachable anywhere in the product.

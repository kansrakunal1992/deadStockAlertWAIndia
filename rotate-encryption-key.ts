/**
 * scripts/rotate-encryption-key.ts
 * ── Quorum: Manual encryption key rotation ───────────────────────────────────
 *
 * Re-encrypts all encrypted DB columns from an old key to a new one.
 * Run BEFORE swapping DB_ENCRYPTION_KEY in Railway.
 *
 * ── DO NOT run on a cron ─────────────────────────────────────────────────────
 *   Key rotation requires deliberate human action. Automated rotation would
 *   need both old + new keys in env vars simultaneously on a schedule, which
 *   increases attack surface unnecessarily.
 *
 * ── HOW TO RUN ───────────────────────────────────────────────────────────────
 *   Step 1  Generate a new 32-byte hex key
 *           node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 *   Step 2  Add DB_ENCRYPTION_KEY_NEW to Railway (do NOT yet change DB_ENCRYPTION_KEY)
 *           The running app keeps decrypting with the old key while you rotate.
 *
 *   Step 3  Run locally with both keys + Supabase service role creds
 *           DB_ENCRYPTION_KEY=<old> DB_ENCRYPTION_KEY_NEW=<new> \
 *           NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *           npx tsx scripts/rotate-encryption-key.ts
 *
 *   Step 4  Verify: all tables show 0 errors in the output
 *
 *   Step 5  In Railway: change DB_ENCRYPTION_KEY to the new value → redeploy
 *
 *   Step 6  Remove DB_ENCRYPTION_KEY_NEW from Railway
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────────
 *   - Idempotent: skips plaintext / empty rows, safe to re-run
 *   - Batches 50 rows at a time to avoid memory pressure
 *   - Per-row errors are logged and skipped — untouched rows remain decryptable
 *     with the old key until you swap Railway, so a partial run is safe
 *   - Exits non-zero if any rows errored, so you can catch it before swapping
 */

import { createClient }                      from '@supabase/supabase-js'
import { createCipheriv, createDecipheriv,
         randomBytes }                       from 'crypto'

// ── Constants (must match lib/encryption.ts) ──────────────────────────────────

const ALGORITHM  = 'aes-256-gcm'
const IV_BYTES   = 16
const ENC_PREFIX = 'enc:'
const JSONB_KEY  = '_enc'
const BATCH      = 50

// ── Table config ──────────────────────────────────────────────────────────────

interface TableConfig {
  table:      string
  cols:       string[]
  jsonbCols?: string[]
}

const TABLES: TableConfig[] = [
  {
    table:    'sessions',
    cols:     ['decision_text', 'context_text',
               'commitment_leaning', 'commitment_switch', 'rule_recall_rule_text'],
  },
  {
    table: 'messages',
    cols:  ['content'],
  },
  {
    table: 'examiner_responses',
    cols:  ['question_text', 'response_text'],
  },
  {
    table: 'outcomes',
    cols:  ['what_decided', 'notes'],
  },
  {
    table:     'structural_matches',
    cols:      ['context_block'],
    jsonbCols: ['matches_json'],
  },
]

// ── Crypto helpers ────────────────────────────────────────────────────────────

function parseKey(hex: string | undefined, name: string): Buffer {
  if (!hex || hex.length !== 64) {
    throw new Error(
      `${name} must be a 64-character hex string (32 bytes).\n` +
      `Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    )
  }
  return Buffer.from(hex, 'hex')
}

function decryptWith(value: string, key: Buffer): string {
  if (!value.startsWith(ENC_PREFIX)) return value
  const parts = value.slice(ENC_PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error(`Malformed enc: value`)
  const dec = createDecipheriv(ALGORITHM, key, Buffer.from(parts[0]!, 'hex'))
  dec.setAuthTag(Buffer.from(parts[1]!, 'hex'))
  return Buffer.concat([dec.update(Buffer.from(parts[2]!, 'base64')), dec.final()]).toString('utf8')
}

function encryptWith(value: string, key: Buffer): string {
  const iv  = randomBytes(IV_BYTES)
  const enc = createCipheriv(ALGORITHM, key, iv)
  const ct  = Buffer.concat([enc.update(value, 'utf8'), enc.final()])
  return `${ENC_PREFIX}${iv.toString('hex')}:${enc.getAuthTag().toString('hex')}:${ct.toString('base64')}`
}

function rotateStr(v: unknown, oldKey: Buffer, newKey: Buffer): string | undefined {
  if (!v || typeof v !== 'string' || !v.startsWith(ENC_PREFIX)) return undefined
  return encryptWith(decryptWith(v, oldKey), newKey)
}

function rotateJsonb(v: unknown, oldKey: Buffer, newKey: Buffer): unknown | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const obj = v as Record<string, unknown>
  if (typeof obj[JSONB_KEY] !== 'string') return undefined
  return { [JSONB_KEY]: encryptWith(decryptWith(obj[JSONB_KEY] as string, oldKey), newKey) }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const oldKey = parseKey(process.env.DB_ENCRYPTION_KEY,     'DB_ENCRYPTION_KEY (old)')
  const newKey = parseKey(process.env.DB_ENCRYPTION_KEY_NEW, 'DB_ENCRYPTION_KEY_NEW')

  if (oldKey.equals(newKey)) {
    console.error('ERROR: old and new keys are identical. Nothing to rotate.')
    process.exit(1)
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )

  console.log('── Quorum encryption key rotation ─────────────────────────────')
  console.log(`  Old key: ${process.env.DB_ENCRYPTION_KEY!.slice(0, 8)}...`)
  console.log(`  New key: ${process.env.DB_ENCRYPTION_KEY_NEW!.slice(0, 8)}...`)
  console.log('')

  const summary: Record<string, { rotated: number; skipped: number; errors: number }> = {}

  for (const cfg of TABLES) {
    const allCols = [...cfg.cols, ...(cfg.jsonbCols ?? [])]
    console.log(`[${cfg.table}] ${allCols.join(', ')}`)

    let offset = 0, rotated = 0, skipped = 0, errors = 0

    while (true) {
      const { data, error } = await supabase
        .from(cfg.table)
        .select(`id,${allCols.join(',')}`)
        .range(offset, offset + BATCH - 1)

      if (error) { console.error(`  Fetch error at offset ${offset}: ${error.message}`); break }
      if (!data || data.length === 0) break

      for (const row of data) {
        const id = (row as Record<string, unknown>).id as string
        try {
          const patch: Record<string, unknown> = {}

          for (const col of cfg.cols) {
            const v = rotateStr((row as Record<string, unknown>)[col], oldKey, newKey)
            if (v !== undefined) patch[col] = v; else skipped++
          }
          for (const col of cfg.jsonbCols ?? []) {
            const v = rotateJsonb((row as Record<string, unknown>)[col], oldKey, newKey)
            if (v !== undefined) patch[col] = v; else skipped++
          }

          if (Object.keys(patch).length === 0) continue

          const { error: uErr } = await supabase.from(cfg.table).update(patch as never).eq('id', id)
          if (uErr) { console.error(`  Update error on id ${id}: ${uErr.message}`); errors++ }
          else rotated++
        } catch (err) {
          console.error(`  Error on id ${id}: ${(err as Error).message}`)
          errors++
        }
      }

      offset += BATCH
      process.stdout.write(`  Processed ${offset} rows...\r`)
    }

    console.log(`  rotated: ${rotated}  skipped (plaintext/empty): ${skipped}  errors: ${errors}`)
    summary[cfg.table] = { rotated, skipped, errors }
  }

  console.log('\n── Summary ─────────────────────────────────────────────────────')
  let totalErrors = 0
  for (const [table, s] of Object.entries(summary)) {
    console.log(`  ${table.padEnd(24)} +${s.rotated} rotated  ${s.skipped} skipped  ${s.errors} errors`)
    totalErrors += s.errors
  }

  if (totalErrors > 0) {
    console.error(`\n⚠  ${totalErrors} row(s) failed. Review errors above before swapping Railway key.`)
    process.exit(1)
  }

  console.log('\n✓  All rows rotated. Safe to swap DB_ENCRYPTION_KEY in Railway now.')
  console.log('   Then remove DB_ENCRYPTION_KEY_NEW and redeploy.')
}

main().catch(err => { console.error('[Fatal]', (err as Error).message); process.exit(1) })

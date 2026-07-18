import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSimStore, type CreateAgentInput } from '../store/useSimStore'
import type { AuthorityLevel } from '../engine/types'
import { applyColdStartPolicy, type ColdStartResult } from '../engine/coldStartPolicy'
import { fonts, colors } from '../styles/tokens'
import { authorityLabel } from '../engine/trustEngine'

const AUTHORITY_OPTIONS: { value: AuthorityLevel; label: string }[] = [
  { value: 0, label: 'Observer' },
  { value: 1, label: 'Assistant' },
  { value: 2, label: 'Operator' },
  { value: 3, label: 'Autonomous' },
  { value: 4, label: 'Strategic' },
]

async function fetchPersonalityBlurb(input: {
  name: string
  role: string
  objective: string
}): Promise<string | undefined> {
  try {
    const res = await fetch('/api/agent-reasoning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'personality',
        name: input.name,
        role: input.role,
        objective: input.objective,
      }),
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as { text?: string }
    return data.text
  } catch {
    return undefined
  }
}

export function CreateAgentModal() {
  const open = useSimStore((s) => s.createModalOpen)
  const setOpen = useSimStore((s) => s.setCreateModalOpen)
  const createAgent = useSimStore((s) => s.createAgent)
  const [submitting, setSubmitting] = useState(false)
  const [overrideNotice, setOverrideNotice] = useState<ColdStartResult | null>(null)
  const [pendingInput, setPendingInput] = useState<CreateAgentInput | null>(null)
  const [form, setForm] = useState({
    name: '',
    role: '',
    objective: '',
    spendingLimit: 5000,
    authorityLevel: 2 as AuthorityLevel,
    riskTolerance: 'moderate' as CreateAgentInput['riskTolerance'],
    requiredApprovals: '',
  })

  const resetForm = () => {
    setForm({
      name: '',
      role: '',
      objective: '',
      spendingLimit: 5000,
      authorityLevel: 2,
      riskTolerance: 'moderate',
      requiredApprovals: '',
    })
    setOverrideNotice(null)
    setPendingInput(null)
    setSubmitting(false)
  }

  const finalizeCreate = (input: CreateAgentInput) => {
    createAgent(input)
    resetForm()
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.role.trim() || submitting) return
    setSubmitting(true)

    const policy = applyColdStartPolicy(form.authorityLevel, form.spendingLimit)

    const blurbPromise = fetchPersonalityBlurb({
      name: form.name,
      role: form.role,
      objective: form.objective,
    })
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 800))
    const personalityBlurb =
      (await Promise.race([blurbPromise, timeout])) ??
      `${form.name} operates as ${form.role} with a mandate to ${form.objective || 'support organizational objectives'}.`

    const approvalText =
      form.requiredApprovals.trim() ||
      `All transactions require approval until reputation is established (threshold $${policy.requiresApprovalBelow.toLocaleString()})`

    const input: CreateAgentInput = {
      name: form.name,
      role: form.role,
      objective: form.objective,
      spendingLimit: form.spendingLimit,
      authorityLevel: policy.effectiveAuthorityLevel,
      riskTolerance: form.riskTolerance,
      requiredApprovals: approvalText,
      personalityBlurb,
    }

    if (policy.effectiveAuthorityLevel < form.authorityLevel) {
      setPendingInput(input)
      setOverrideNotice(policy)
      setSubmitting(false)
      // Hold override notice ~2s then deploy with capped authority
      window.setTimeout(() => {
        if (pendingInput || input) {
          finalizeCreate(input)
        }
      }, 2000)
      return
    }

    finalizeCreate(input)
  }

  const onDismissOverride = () => {
    if (pendingInput) finalizeCreate(pendingInput)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.form
            onSubmit={onSubmit}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-md rounded-lg border p-5"
            style={{
              background: colors.bgPanel,
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                className="text-lg font-bold tracking-wide"
                style={{ fontFamily: fonts.display }}
              >
                Create Agent
              </h2>
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setOpen(false)
                }}
                className="text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <AnimatePresence>
              {overrideNotice && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mb-4 rounded-md border px-3 py-2.5"
                  style={{
                    borderColor: 'rgba(255,184,77,0.55)',
                    background: 'rgba(255,184,77,0.1)',
                  }}
                >
                  <div
                    className="mb-1 text-[10px] font-semibold tracking-[0.18em] uppercase"
                    style={{ color: colors.amber, fontFamily: fonts.mono }}
                  >
                    Cold-start override
                  </div>
                  <p className="text-xs leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {overrideNotice.reason}
                  </p>
                  <p
                    className="mt-1.5 text-[11px] tabular-nums"
                    style={{ color: colors.amber, fontFamily: fonts.mono }}
                  >
                    Effective authority: {authorityLabel(overrideNotice.effectiveAuthorityLevel)}{' '}
                    (capped)
                  </p>
                  <button
                    type="button"
                    onClick={onDismissOverride}
                    className="mt-2 text-[10px] tracking-wide uppercase underline"
                    style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
                  >
                    Continue
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-3">
              <Field label="Name">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="field"
                  placeholder="e.g. MERCURY"
                  disabled={!!overrideNotice}
                />
              </Field>
              <Field label="Role">
                <input
                  required
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="field"
                  placeholder="e.g. Vendor Research"
                  disabled={!!overrideNotice}
                />
              </Field>
              <Field label="Objective">
                <input
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                  className="field"
                  placeholder="Single-sentence objective"
                  disabled={!!overrideNotice}
                />
              </Field>
              <Field label="Initial Budget ($)">
                <input
                  type="number"
                  min={0}
                  value={form.spendingLimit}
                  onChange={(e) =>
                    setForm({ ...form, spendingLimit: Number(e.target.value) })
                  }
                  className="field"
                  disabled={!!overrideNotice}
                />
              </Field>
              <Field label="Initial Authority">
                <select
                  value={form.authorityLevel}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      authorityLevel: Number(e.target.value) as AuthorityLevel,
                    })
                  }
                  className="field"
                  disabled={!!overrideNotice}
                >
                  {AUTHORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risk Tolerance">
                <select
                  value={form.riskTolerance}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      riskTolerance: e.target
                        .value as CreateAgentInput['riskTolerance'],
                    })
                  }
                  className="field"
                  disabled={!!overrideNotice}
                >
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </select>
              </Field>
              <Field label="Required Approvals">
                <input
                  value={form.requiredApprovals}
                  onChange={(e) =>
                    setForm({ ...form, requiredApprovals: e.target.value })
                  }
                  className="field"
                  placeholder='e.g. Purchases above $500'
                  disabled={!!overrideNotice}
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={submitting || !!overrideNotice}
              className="mt-5 w-full rounded-md px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: colors.cyan, color: '#0A0B0F' }}
            >
              {submitting ? 'Creating…' : overrideNotice ? 'Applying override…' : 'Deploy Agent'}
            </button>
          </motion.form>

          <style>{`
            .field {
              width: 100%;
              background: #121c2a;
              border: 1px solid rgba(148,163,184,0.18);
              border-radius: 6px;
              padding: 8px 10px;
              color: #E4E7EB;
              font-size: 13px;
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-[10px] tracking-[0.16em] uppercase"
        style={{ color: 'var(--text-muted)', fontFamily: fonts.mono }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

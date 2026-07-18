import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSimStore, type CreateAgentInput } from '../store/useSimStore'
import type { AuthorityLevel } from '../engine/types'
import { fonts, colors } from '../styles/tokens'

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
  const [form, setForm] = useState({
    name: '',
    role: '',
    objective: '',
    spendingLimit: 5000,
    authorityLevel: 2 as AuthorityLevel,
    riskTolerance: 'moderate' as CreateAgentInput['riskTolerance'],
    requiredApprovals: '',
  })

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.role.trim()) return
    setSubmitting(true)
    // OpenAI is non-blocking: try briefly, fall back to local template
    const blurbPromise = fetchPersonalityBlurb({
      name: form.name,
      role: form.role,
      objective: form.objective,
    })
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 800))
    const personalityBlurb =
      (await Promise.race([blurbPromise, timeout])) ??
      `${form.name} operates as ${form.role} with a mandate to ${form.objective || 'support organizational objectives'}.`

    createAgent({
      ...form,
      personalityBlurb,
    })
    setSubmitting(false)
    setForm({
      name: '',
      role: '',
      objective: '',
      spendingLimit: 5000,
      authorityLevel: 2,
      riskTolerance: 'moderate',
      requiredApprovals: '',
    })
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
                onClick={() => setOpen(false)}
                className="text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <Field label="Name">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="field"
                  placeholder="e.g. ORION"
                />
              </Field>
              <Field label="Role">
                <input
                  required
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="field"
                  placeholder="e.g. Vendor Research"
                />
              </Field>
              <Field label="Objective">
                <input
                  value={form.objective}
                  onChange={(e) => setForm({ ...form, objective: e.target.value })}
                  className="field"
                  placeholder="Single-sentence objective"
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
                />
              </Field>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 w-full rounded-md px-3 py-2.5 text-sm font-semibold"
              style={{ background: colors.cyan, color: '#0A0B0F' }}
            >
              {submitting ? 'Creating…' : 'Deploy Agent'}
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

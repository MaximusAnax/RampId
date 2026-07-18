import type { AuthorityLevel } from './types'

export interface ColdStartResult {
  effectiveAuthorityLevel: AuthorityLevel
  requiresApprovalBelow: number
  reason: string
}

/**
 * Brand-new agents (no reputation history) are capped at Assistant (1)
 * regardless of requested configuration — reputation must be earned.
 * Pure function; no UI imports (arXiv 2605.00073 cold-start handling).
 */
export function applyColdStartPolicy(
  requestedAuthorityLevel: AuthorityLevel,
  requestedBudget: number,
): ColdStartResult {
  return {
    effectiveAuthorityLevel: Math.min(requestedAuthorityLevel, 1) as AuthorityLevel,
    requiresApprovalBelow: requestedBudget,
    reason:
      'New agents start at capped authority regardless of requested configuration — reputation must be earned through demonstrated task history before higher autonomy is granted.',
  }
}

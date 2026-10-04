// Helpers compartidos del cliente: parsing tolerante de JSON y normalización de payloads

import type { OpportunityData, ProposalData } from './client-types'

export function parseJsonArraySafe<T = unknown>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback
  if (Array.isArray(raw)) return raw as T[]
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

/** Normaliza una oportunidad desde la API: parsea los campos JSON serializados. */
export function normalizeOpp(o: Record<string, unknown>): OpportunityData {
  const process = o.process as Record<string, unknown> | undefined
  const proposals = (o.proposals || []) as Record<string, unknown>[]
  return {
    id: String(o.id),
    status: o.status as OpportunityData['status'],
    score: Number(o.score ?? 0),
    reasons: parseJsonArraySafe(o.reasonsJson as string).length
      ? parseJsonArraySafe(o.reasonsJson as string)
      : ((o.reasons as OpportunityData['reasons']) || []),
    missingDocs: parseJsonArraySafe(o.missingDocsJson as string).length
      ? parseJsonArraySafe<string>(o.missingDocsJson as string)
      : ((o.missingDocs as string[]) || []),
    risks: parseJsonArraySafe(o.risksJson as string).length
      ? parseJsonArraySafe<string>(o.risksJson as string)
      : ((o.risks as string[]) || []),
    nextAction: (o.nextAction as string) ?? null,
    analysisSummary: (o.analysisSummary as string) ?? null,
    discardReason: (o.discardReason as string) ?? null,
    rank: (o.rank as number) ?? null,
    createdAt: String(o.createdAt),
    updatedAt: String(o.updatedAt),
    process: {
      id: String(process?.id ?? ''),
      entity: String(process?.entity ?? ''),
      department: (process?.department as string) ?? null,
      city: (process?.city as string) ?? null,
      objectName: String(process?.objectName ?? ''),
      description: (process?.description as string) ?? null,
      phase: (process?.phase as string) ?? null,
      state: (process?.state as string) ?? null,
      basePrice: (process?.basePrice as number) ?? null,
      modality: (process?.modality as string) ?? null,
      contractType: (process?.contractType as string) ?? null,
      duration: (process?.duration as string) ?? null,
      durationUnit: (process?.durationUnit as string) ?? null,
      unitName: (process?.unitName as string) ?? null,
      categoryCode: (process?.categoryCode as string) ?? null,
      publishDate: (process?.publishDate as string) ?? null,
      lastPubDate: (process?.lastPubDate as string) ?? null,
      receptionDate: (process?.receptionDate as string) ?? null,
      url: (process?.url as string) ?? null,
      source: (process?.source as string) ?? undefined,
    },
    requirements: (o.requirements as OpportunityData['requirements']) || [],
    proposals: proposals.map(normalizeProposal),
    messages: ((o.messages || []) as Record<string, unknown>[]).map((m) => ({
      id: String(m.id),
      role: m.role as 'USUARIO' | 'AGENTE',
      content: String(m.content || ''),
      versionBefore: (m.versionBefore as number) ?? null,
      versionAfter: (m.versionAfter as number) ?? null,
      sectionsAffected: (m.sectionsAffected as string) ?? null,
      createdAt: String(m.createdAt),
    })),
  }
}

export function normalizeProposal(p: Record<string, unknown>): ProposalData {
  return {
    id: String(p.id),
    version: Number(p.version ?? 1),
    status: p.status as ProposalData['status'],
    sections: parseJsonArraySafe(p.sectionsJson as string).length
      ? parseJsonArraySafe(p.sectionsJson as string)
      : ((p.sections as ProposalData['sections']) || []),
    checklists: parseJsonArraySafe(p.checklistsJson as string).length
      ? parseJsonArraySafe(p.checklistsJson as string)
      : ((p.checklists as ProposalData['checklists']) || []),
    unconfirmedCount: Number(p.unconfirmedCount ?? 0),
    approvedBy: (p.approvedBy as string) ?? null,
    approvedAt: (p.approvedAt as string) ?? null,
    createdAt: String(p.createdAt),
    approvals: (p.approvals as ProposalData['approvals']) || [],
  }
}

'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge, ScoreBadge, DimIcon, ReqStatusBadge, UnconfirmedWarn, Spinner } from './shared'
import {
  fmtCOP, fmtDate, fmtDateTime, daysUntil,
  DIM_COLORS,
  type OpportunityData, type ProposalData, type ProposalMessageData,
} from './client-types'
import {
  ArrowLeft, ExternalLink, Landmark, Calendar, Tag, Clock,
  FilePlus2, Ban, CheckCircle2, Building2, UserCheck, FileCheck2, ShieldAlert, FileText,
  MessagesSquare, Send, Bot, User,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export function OpportunityDetailView({
  opportunity,
  loading,
  onBack,
  onAnalyze,
  onDiscard,
  onApprovePrep,
  onGenerateProposal,
  onApproveProposal,
  onRefineProposal,
  analyzing,
  generating,
  refining,
}: {
  opportunity: OpportunityData | null
  loading: boolean
  onBack: () => void
  onAnalyze: (id: string) => void
  onDiscard: (id: string, reason: string) => void
  onApprovePrep: (id: string) => void
  onGenerateProposal: (opportunityId: string) => void
  onApproveProposal: (proposalId: string, decision: 'APROBADA' | 'RECHAZADA', approver: string, notes: string) => void
  onRefineProposal: (proposalId: string, instruction: string) => void
  analyzing: boolean
  generating: boolean
  refining: boolean
}) {
  const { toast } = useToast()
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardReason, setDiscardReason] = useState('')
  const [approveOpen, setApproveOpen] = useState<ProposalData | null>(null)
  const [approver, setApprover] = useState('')
  const [approverNotes, setApproverNotes] = useState('')

  if (loading) return <Spinner label="Cargando expediente…" />
  if (!opportunity) return <p className="py-10 text-center text-muted-foreground">No se encontró la oportunidad.</p>

  const o = opportunity
  const p = o.process
  const dDeadline = daysUntil(p.receptionDate)
  const latestProposal = o.proposals && o.proposals.length > 0 ? o.proposals[0] : null
  const active = o.status !== 'DESCARTADA'

  const submitDiscard = () => {
    if (!discardReason.trim()) {
      toast({ title: 'El motivo del descarte es obligatorio', variant: 'destructive' })
      return
    }
    setDiscardOpen(false)
    onDiscard(o.id, discardReason.trim())
    setDiscardReason('')
  }

  const submitApproval = () => {
    if (!approveOpen) return
    if (!approver.trim()) {
      toast({ title: 'Registra el nombre del aprobador', variant: 'destructive' })
      return
    }
    onApproveProposal(approveOpen.id, 'APROBADA', approver.trim(), approverNotes.trim())
    setApproveOpen(null)
    setApprover('')
    setApproverNotes('')
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 min-h-9">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden /> Volver a oportunidades
        </Button>
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex gap-3 items-start shrink-0">
                <ScoreBadge score={o.score} size="lg" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">{p.id}</span>
                  <StatusBadge status={o.status} />
                  {p.reference && <span className="text-xs text-muted-foreground">Ref.: {p.reference}</span>}
                </div>
                <h2 className="text-lg font-semibold mt-1.5 leading-snug">{p.objectName}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-sm">
                  <InfoItem icon={Landmark} label="Entidad" value={p.entity} />
                  <InfoItem icon={Building2} label="Ubicación" value={`${p.city || '—'} / ${p.department || '—'}`} />
                  <InfoItem icon={Tag} label="Valor base" value={fmtCOP(p.basePrice)} strong />
                  <InfoItem icon={Calendar} label="Publicación" value={fmtDate(p.publishDate)} />
                  <InfoItem icon={Clock} label="Duración" value={p.duration ? `${p.duration} ${p.durationUnit || ''}` : 'No publicada'} />
                  <InfoItem icon={FileCheck2} label="Modalidad" value={p.modality || '—'} />
                  <InfoItem icon={FileCheck2} label="Tipo de contrato" value={p.contractType || '—'} />
                  <InfoItem
                    icon={ShieldAlert}
                    label="Recepción de respuestas"
                    value={
                      p.receptionDate
                        ? `${fmtDate(p.receptionDate)}${dDeadline != null ? ` (${dDeadline} día(s))` : ''}`
                        : 'No publicada — verificar en SECOP'
                    }
                    strong={dDeadline != null && dDeadline <= 7}
                  />
                </div>
                {p.description && (
                  <div className="mt-3">
                    <Separator className="mb-3" />
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" tabIndex={0}>
                      <Button size="sm" variant="outline" className="min-h-9">
                        <ExternalLink className="w-4 h-4 mr-1.5" aria-hidden /> Ver en SECOP
                      </Button>
                    </a>
                  )}
                  {active && (o.status === 'NUEVA' || o.status === 'COMPATIBLE' || o.status === 'EN_ANALISIS') && (
                    <Button size="sm" onClick={() => onAnalyze(o.id)} disabled={analyzing} className="bg-emerald-600 hover:bg-emerald-700 min-h-9">
                      <FilePlus2 className="w-4 h-4 mr-1.5" aria-hidden />
                      {analyzing ? 'Analizando con IA…' : o.requirements && o.requirements.length > 0 ? 'Re-analizar con IA' : 'Analizar con IA'}
                    </Button>
                  )}
                  {active && o.status === 'COMPATIBLE' && (
                    <Button size="sm" variant="outline" onClick={() => onApprovePrep(o.id)} className="border-lime-500 text-lime-700 hover:bg-lime-50 min-h-9">
                      <CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden /> Aprobar para preparación
                    </Button>
                  )}
                  {active && o.status === 'APROBADA_PREPARACION' && (
                    <Button size="sm" onClick={() => onGenerateProposal(o.id)} disabled={generating} className="bg-lime-600 hover:bg-lime-700 min-h-9">
                      <FileText className={`w-4 h-4 mr-1.5 ${generating ? 'animate-pulse' : ''}`} aria-hidden />
                      {generating ? 'Generando borrador…' : latestProposal ? 'Generar nueva versión' : 'Generar borrador de propuesta'}
                    </Button>
                  )}
                  {active && (
                    <Button size="sm" variant="outline" onClick={() => setDiscardOpen(true)} className="border-rose-300 text-rose-700 hover:bg-rose-50 min-h-9">
                      <Ban className="w-4 h-4 mr-1.5" aria-hidden /> Descartar
                    </Button>
                  )}
                </div>
                {o.status === 'DESCARTADA' && o.discardReason && (
                  <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mt-3">
                    Descartada: {o.discardReason}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="compatibilidad">
        <TabsList className="w-full sm:w-auto flex-wrap h-auto">
          <TabsTrigger value="compatibilidad">Compatibilidad explicada</TabsTrigger>
          <TabsTrigger value="matriz">Matriz de requisitos</TabsTrigger>
          <TabsTrigger value="riesgos">Riesgos y faltantes</TabsTrigger>
          <TabsTrigger value="propuesta">Propuesta {latestProposal ? `· v${latestProposal.version}` : ''}</TabsTrigger>
        </TabsList>

        {/* Compatibilidad */}
        <TabsContent value="compatibilidad" className="mt-4 space-y-4">
          {o.analysisSummary && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm leading-relaxed">{o.analysisSummary}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">¿Por qué esta oportunidad es (o no) compatible?</CardTitle>
              <p className="text-sm text-muted-foreground">Cada dimensión se evalúa contra el perfil registrado de la empresa. El sistema muestra las razones, no solo el porcentaje.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {o.reasons.length === 0 && <p className="text-sm text-muted-foreground">Ejecuta una sincronización para recalcular la compatibilidad.</p>}
              {o.reasons.map((d) => (
                <div key={d.key} className="flex items-start gap-3 rounded-lg border p-3">
                  <DimIcon result={d.result} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-sm">{d.label}</p>
                      <Badge variant="secondary" className="text-[11px]">
                        peso {Math.round(d.weight * 100)}% · {Math.round(d.score * 100)}%
                      </Badge>
                    </div>
                    <p className={`text-sm mt-0.5 ${DIM_COLORS[d.result]}`}>{d.reason}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Matriz de requisitos */}
        <TabsContent value="matriz" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Matriz de cumplimiento</CardTitle>
              <p className="text-sm text-muted-foreground">
                REQUISITO | ESTADO | EVIDENCIA | ACCIÓN — construida con la evidencia registrada de la empresa. Nada se marca «Cumple» sin sustento.
              </p>
            </CardHeader>
            <CardContent>
              {!o.requirements || o.requirements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  Aún no hay matriz. Usa «Analizar con IA» para generarla.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3 font-medium">Requisito</th>
                        <th className="py-2 pr-3 font-medium">Estado</th>
                        <th className="py-2 pr-3 font-medium">Evidencia</th>
                        <th className="py-2 font-medium">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.requirements.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 align-top">
                          <td className="py-3 pr-3">
                            <span className="font-mono text-xs text-muted-foreground mr-1.5">{r.code}</span>
                            {r.description}
                            <Badge variant="secondary" className="ml-2 text-[10px]">{r.source === 'IA' ? 'IA' : 'Reglas'}</Badge>
                          </td>
                          <td className="py-3 pr-3"><ReqStatusBadge status={r.status} /></td>
                          <td className="py-3 pr-3 text-muted-foreground">{r.evidence || '—'}</td>
                          <td className="py-3 text-muted-foreground">{r.action || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Riesgos */}
        <TabsContent value="riesgos" className="mt-4 grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-600" aria-hidden /> Riesgos identificados</CardTitle>
            </CardHeader>
            <CardContent>
              {o.risks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin riesgos registrados en el último análisis.</p>
              ) : (
                <ul className="space-y-2">
                  {o.risks.map((r, i) => (
                    <li key={i} className="text-sm rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">{r}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><FileCheck2 className="w-4 h-4 text-amber-600" aria-hidden /> Documentos faltantes</CardTitle>
            </CardHeader>
            <CardContent>
              {o.missingDocs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No se detectaron documentos faltantes en el expediente de la empresa.</p>
              ) : (
                <ul className="space-y-2">
                  {o.missingDocs.map((d, i) => (
                    <li key={i} className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{d}</li>
                  ))}
                </ul>
              )}
              {o.nextAction && (
                <>
                  <Separator className="my-3" />
                  <p className="text-sm"><strong>Siguiente acción:</strong> {o.nextAction}</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Propuesta */}
        <TabsContent value="propuesta" className="mt-4 space-y-4">
          {o.status !== 'APROBADA_PREPARACION' ? (
            <Card>
              <CardContent className="p-6 text-center">
                <FileText className="w-8 h-8 mx-auto text-muted-foreground" aria-hidden />
                <p className="mt-2 font-medium">La propuesta se genera después de la aprobación humana</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-lg mx-auto">
                  Cuando la oportunidad esté analizada y quieras prepararla, apruébala para preparación (Módulo H). Así queda trazabilidad de quién autorizó cada paso.
                </p>
              </CardContent>
            </Card>
          ) : !latestProposal ? (
            <Card>
              <CardContent className="p-6 text-center">
                <FileText className="w-8 h-8 mx-auto text-muted-foreground" aria-hidden />
                <p className="mt-2 font-medium">Oportunidad aprobada — lista para preparar</p>
                <p className="text-sm text-muted-foreground mt-1">Genera el borrador: el agente usará únicamente la información registrada de la empresa y marcará lo pendiente.</p>
                <Button onClick={() => onGenerateProposal(o.id)} disabled={generating} className="mt-4 bg-lime-600 hover:bg-lime-700 min-h-11">
                  <FileText className="w-4 h-4 mr-2" aria-hidden /> {generating ? 'Generando…' : 'Generar borrador'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <ProposalPanel
              proposal={latestProposal}
              messages={o.messages || []}
              generating={generating}
              refining={refining}
              onGenerate={() => onGenerateProposal(o.id)}
              onApprove={() => setApproveOpen(latestProposal)}
              onReject={(notes) => onApproveProposal(latestProposal.id, 'RECHAZADA', approver || 'Responsable', notes)}
              onRefine={(instruction) => onRefineProposal(latestProposal.id, instruction)}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Diálogo descarte */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar oportunidad</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo del descarte (obligatorio, queda en auditoría)</Label>
            <Textarea id="motivo" value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} placeholder="Ej.: fuera de la cobertura geográfica del área operativa…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={submitDiscard}>Descartar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo aprobación */}
      <Dialog open={!!approveOpen} onOpenChange={(open) => !open && setApproveOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobación de la propuesta (Módulo H)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Al aprobar declaras que revisaste la matriz de requisitos, los documentos y el borrador. La decisión queda registrada con fecha y responsable.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="aprobador">Nombre del responsable que aprueba</Label>
              <Input id="aprobador" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Ej.: María Gómez — Gerente" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notas">Notas (opcional)</Label>
              <Textarea id="notas" value={approverNotes} onChange={(e) => setApproverNotes(e.target.value)} rows={2} placeholder="Condiciones confirmadas, precio aprobado, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(null)}>Cancelar</Button>
            <Button onClick={submitApproval} className="bg-emerald-600 hover:bg-emerald-700">
              <UserCheck className="w-4 h-4 mr-1.5" aria-hidden /> Aprobar propuesta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoItem({ icon: Icon, label, value, strong }: { icon: typeof Landmark; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm leading-snug ${strong ? 'font-semibold' : 'font-medium'} break-words`}>{value}</p>
      </div>
    </div>
  )
}

function ProposalPanel({
  proposal,
  messages,
  generating,
  refining,
  onGenerate,
  onApprove,
  onReject,
  onRefine,
}: {
  proposal: ProposalData
  messages: ProposalMessageData[]
  generating: boolean
  refining: boolean
  onGenerate: () => void
  onApprove: () => void
  onReject: (notes: string) => void
  onRefine: (instruction: string) => void
}) {
  const { toast } = useToast()
  const [chatInput, setChatInput] = useState('')

  const sendInstruction = () => {
    const text = chatInput.trim()
    if (!text) {
      toast({ title: 'Escribe una instrucción para el agente', variant: 'destructive' })
      return
    }
    onRefine(text)
    setChatInput('')
  }

  const quickIdeas = [
    'Haz el cronograma más agresivo sin perder realismo',
    'Enfatiza la experiencia registrada más pertinente para el objeto',
    'Ajusta la metodología a una ejecución con entregables por quincena',
    'Refuerza el resumen ejecutivo con un gancho de valor más directo',
  ]
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5 text-lime-600" aria-hidden />
                Borrador de propuesta — versión {proposal.version}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Generada {fmtDateTime(proposal.createdAt)}
                {proposal.status === 'APROBADA' && ` · Aprobada por ${proposal.approvedBy} el ${fmtDate(proposal.approvedAt)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onGenerate} disabled={generating} className="min-h-9">
                <FilePlus2 className={`w-4 h-4 mr-1.5 ${generating ? 'animate-pulse' : ''}`} aria-hidden /> {generating ? 'Generando…' : 'Nueva versión'}
              </Button>
              {proposal.status === 'BORRADOR' && (
                <Button size="sm" onClick={onApprove} className="bg-emerald-600 hover:bg-emerald-700 min-h-9">
                  <UserCheck className="w-4 h-4 mr-1.5" aria-hidden /> Revisar y aprobar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <UnconfirmedWarn count={proposal.unconfirmedCount} />
          {proposal.sections.map((s) => (
            <section key={s.key} className={`rounded-lg border p-4 ${s.unconfirmed ? 'border-amber-300 bg-amber-50/50' : ''}`}>
              <h4 className="font-semibold text-sm flex items-center gap-2">
                {s.title}
                {s.unconfirmed && <Badge variant="outline" className="border-amber-400 text-amber-800 text-[10px]">Contiene datos por confirmar</Badge>}
              </h4>
              <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{s.content}</p>
            </section>
          ))}
        </CardContent>
      </Card>

      {proposal.checklists.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Checklist de presentación</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-4">
            {proposal.checklists.map((g) => (
              <div key={g.group}>
                <h4 className="font-medium text-sm mb-2">{g.group}</h4>
                <ul className="space-y-1.5">
                  {g.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 ${it.required ? 'border-emerald-600' : 'border-muted-foreground'}`} aria-hidden />
                      <span>
                        {it.label}
                        {it.required && <span className="text-rose-600 ml-1" title="Obligatorio">*</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Refinamiento conversacional con el agente (Módulo G+) */}
      {proposal.status === 'BORRADOR' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessagesSquare className="w-5 h-5 text-emerald-600" aria-hidden />
              Refina el proyecto con el agente
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Habla con el agente en lenguaje natural: ajusta metodología, cronograma, enfoque o énfasis. Cada instrucción genera una nueva versión trazable, siempre sin inventar datos de la empresa.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-72 overflow-y-auto space-y-2.5 rounded-lg border bg-muted/30 p-3" aria-live="polite">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Aún no hay conversación. Pídele al agente el primer ajuste del borrador.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-2 ${m.role === 'USUARIO' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'AGENTE' && (
                    <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white grid place-items-center mt-0.5" aria-hidden>
                      <Bot className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                      m.role === 'USUARIO' ? 'bg-emerald-600 text-white' : 'bg-background border'
                    }`}
                  >
                    {m.role === 'AGENTE' && m.versionAfter != null && (
                      <p className="text-[11px] opacity-80 mb-1 flex flex-wrap items-center gap-1">
                        v{m.versionBefore} → v{m.versionAfter}
                        {(() => {
                          try {
                            const keys = JSON.parse(m.sectionsAffected || '[]') as string[]
                            return keys.length > 0 ? ` · ${keys.join(', ')}` : ''
                          } catch {
                            return ''
                          }
                        })()}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    <p className={`text-[10px] mt-1 ${m.role === 'USUARIO' ? 'text-emerald-100' : 'text-muted-foreground'}`}>
                      {fmtDateTime(m.createdAt)}
                    </p>
                  </div>
                  {m.role === 'USUARIO' && (
                    <span className="shrink-0 w-6 h-6 rounded-full bg-muted text-muted-foreground grid place-items-center mt-0.5" aria-hidden>
                      <User className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              ))}
              {refining && (
                <div className="flex gap-2 justify-start">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white grid place-items-center mt-0.5 animate-pulse" aria-hidden>
                    <Bot className="w-3.5 h-3.5" />
                  </span>
                  <div className="bg-background border rounded-lg px-3 py-2 text-sm text-muted-foreground">
                    El agente está rediseñando el proyecto…
                  </div>
                </div>
              )}
            </div>

            {!refining && messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {quickIdeas.map((idea) => (
                  <button
                    key={idea}
                    onClick={() => onRefine(idea)}
                    className="text-xs rounded-full border px-3 py-1.5 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendInstruction()
                  }
                }}
                placeholder="Ej.: adapta la propuesta al sector salud y refuerza los indicadores de atención…"
                aria-label="Instrucción para el agente"
                disabled={refining}
                className="min-h-11"
              />
              <Button onClick={sendInstruction} disabled={refining} className="bg-emerald-600 hover:bg-emerald-700 min-h-11 shrink-0">
                <Send className="w-4 h-4 mr-1.5" aria-hidden /> {refining ? 'Refinando…' : 'Enviar'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {proposal.approvals && proposal.approvals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trazabilidad de aprobación</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {proposal.approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm rounded-md border px-3 py-2">
                  <Badge variant="outline" className={a.decision === 'APROBADA' ? 'border-emerald-300 text-emerald-800 bg-emerald-50' : 'border-rose-300 text-rose-700 bg-rose-50'}>
                    {a.decision === 'APROBADA' ? 'Aprobada' : 'Devuelta'}
                  </Badge>
                  <span><strong>{a.approver}</strong></span>
                  <span className="text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                  {a.notes && <span className="text-muted-foreground w-full">Notas: {a.notes}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  )
}

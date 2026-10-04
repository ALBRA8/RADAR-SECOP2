'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { DashboardView } from '@/components/app/dashboard'
import { OpportunitiesView } from '@/components/app/opportunities'
import { OpportunityDetailView } from '@/components/app/detail'
import { CompanyView } from '@/components/app/company'
import { AlertsView } from '@/components/app/alerts'
import {
  type OpportunityData,
  type CompanyProfile,
  type NotificationData,
  parseJsonArraySafe,
  normalizeOpp,
} from '@/components/app/client-helpers'

interface DashboardPayload {
  company: { id: string; name: string } | null
  stats: { nuevas: number; enAnalisis: number; compatibles: number; aprobadas: number; enPreparacion: number; descartadas: number; propuestas: number }
  topOpportunities: OpportunityData[]
  expiring: { id: string; processId: string; entity: string; objectName: string; receptionDate: string | null; score: number }[]
  alerts: NotificationData[]
  lastSync: { at: string; detail: string } | null
}
import { Radar, LayoutDashboard, Inbox, Building2, Bell, ShieldCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type View = 'dashboard' | 'oportunidades' | 'detalle' | 'empresa' | 'alertas'

export default function Home() {
  const { toast } = useToast()
  const [view, setView] = useState<View>('dashboard')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [opportunities, setOpportunities] = useState<OpportunityData[]>([])
  const [detail, setDetail] = useState<OpportunityData | null>(null)
  const [notifications, setNotifications] = useState<NotificationData[]>([])
  const [unread, setUnread] = useState(0)
  const [dash, setDash] = useState<DashboardPayload | null>(null)

  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [loadingOpps, setLoadingOpps] = useState(true)
  const [loadingCompany, setLoadingCompany] = useState(true)
  const [loadingAlerts, setLoadingAlerts] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // ─── Cargadores ─────────────────────────────────────────────
  const loadCompany = useCallback(async () => {
    setLoadingCompany(true)
    try {
      const res = await fetch('/api/company')
      const data = await res.json()
      const c = data.company
      if (c) {
        setCompany({
          ...c,
          departmentsAllowed: parseJsonArraySafe(c.departmentsAllowed),
          modalitiesAllowed: parseJsonArraySafe(c.modalitiesAllowed),
          contractTypesAllowed: parseJsonArraySafe(c.contractTypesAllowed),
          phasesAllowed: parseJsonArraySafe(c.phasesAllowed, ['Presentación de oferta', 'Selección']),
          products: (c.products || []).map((p: Record<string, unknown>) => ({ ...p, keywords: parseJsonArraySafe(p.keywords as string) })),
        })
      } else {
        setCompany(null)
      }
    } catch {
      setCompany(null)
    } finally {
      setLoadingCompany(false)
    }
  }, [])

  const loadOpportunities = useCallback(async () => {
    setLoadingOpps(true)
    try {
      const res = await fetch('/api/opportunities')
      const data = await res.json()
      setOpportunities((data.opportunities || []).map(normalizeOpp))
    } catch {
      setOpportunities([])
    } finally {
      setLoadingOpps(false)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true)
    try {
      const res = await fetch('/api/dashboard')
      const data = await res.json()
      data.topOpportunities = (data.topOpportunities || []).map(normalizeOpp)
      setDash(data)
    } catch {
      setDash(null)
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  const loadAlerts = useCallback(async () => {
    setLoadingAlerts(true)
    try {
      const res = await fetch('/api/alerts')
      const data = await res.json()
      setNotifications(data.notifications || [])
      setUnread(data.unread || 0)
    } catch {
      setNotifications([])
    } finally {
      setLoadingAlerts(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/opportunities/${id}`)
      const data = await res.json()
      if (data.opportunity) setDetail(normalizeOpp(data.opportunity, true))
      else setDetail(null)
    } catch {
      setDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    loadCompany()
    loadDashboard()
    loadOpportunities()
    loadAlerts()
  }, [loadCompany, loadDashboard, loadOpportunities, loadAlerts])

  // ─── Acciones ───────────────────────────────────────────────
  const openOpportunity = (id: string) => {
    setSelectedId(id)
    setView('detalle')
    loadDetail(id)
  }

  const refreshAll = () => {
    loadDashboard()
    loadOpportunities()
    loadAlerts()
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/secop/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 45, limit: 300 }) })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || 'Error de sincronización')
      toast({ title: 'Sincronización completada', description: data.message })
      refreshAll()
      loadCompany()
    } catch (e) {
      toast({ title: 'La sincronización falló', description: e instanceof Error ? e.message : 'Intenta de nuevo', variant: 'destructive' })
    } finally {
      setSyncing(false)
    }
  }

  const handleAnalyze = async (id: string) => {
    setAnalyzingId(id)
    try {
      const res = await fetch(`/api/opportunities/${id}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error de análisis')
      toast({ title: 'Análisis completado', description: `Motor: ${data.analysisEngine}. Matriz de requisitos actualizada.` })
      if (view === 'detalle' && selectedId === id) loadDetail(id)
      else refreshAll()
    } catch (e) {
      toast({ title: 'No se pudo analizar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setAnalyzingId(null)
    }
  }

  const handleDiscard = async (id: string, reason: string) => {
    try {
      const res = await fetch(`/api/opportunities/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DESCARTADA', reason }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast({ title: 'Oportunidad descartada', description: 'El motivo quedó registrado en la auditoría.' })
      if (view === 'detalle' && selectedId === id) loadDetail(id)
      else refreshAll()
    } catch (e) {
      toast({ title: 'No se pudo descartar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const handleApprovePrep = async (id: string) => {
    try {
      const res = await fetch(`/api/opportunities/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'APROBADA_PREPARACION' }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast({ title: 'Aprobada para preparación', description: 'Ya puedes generar el borrador de propuesta desde el detalle.' })
      if (view === 'detalle' && selectedId === id) loadDetail(id)
      else refreshAll()
    } catch (e) {
      toast({ title: 'No se pudo aprobar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const handleGenerateProposal = async (opportunityId: string) => {
    setGenerating(true)
    try {
      const res = await fetch('/api/proposals/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opportunityId }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast({ title: `Borrador v${data.proposal.version} generado`, description: data.engine === 'IA' ? 'Generado con IA — revisa los marcadores [POR CONFIRMAR].' : 'Generado con plantilla de respaldo.' })
      loadDetail(opportunityId)
    } catch (e) {
      toast({ title: 'No se pudo generar la propuesta', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const handleApproveProposal = async (proposalId: string, decision: 'APROBADA' | 'RECHAZADA', approver: string, notes: string) => {
    try {
      const res = await fetch(`/api/proposals/${proposalId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, approver, notes }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast({
        title: decision === 'APROBADA' ? 'Propuesta aprobada' : 'Propuesta devuelta',
        description: decision === 'APROBADA' ? 'La decisión quedó registrada con trazabilidad. Presentación manual en SECOP para este MVP.' : 'Ajusta el borrador y genera una nueva versión.',
      })
      if (selectedId) loadDetail(selectedId)
    } catch (e) {
      toast({ title: 'No se pudo registrar la decisión', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const handleMarkAllRead = async () => {
    await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markAllRead' }) })
    loadAlerts()
  }

  const handleMarkRead = async (id: string) => {
    await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'markRead', id }) })
    loadAlerts()
  }

  // ─── Navegación ─────────────────────────────────────────────
  const navItems: { key: View; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { key: 'dashboard', label: 'Panel', icon: LayoutDashboard },
    { key: 'oportunidades', label: 'Oportunidades', icon: Inbox, badge: opportunities.filter((o) => o.status !== 'DESCARTADA').length },
    { key: 'empresa', label: 'Mi Empresa', icon: Building2 },
    { key: 'alertas', label: 'Alertas', icon: Bell, badge: unread },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Encabezado */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center justify-between gap-3">
            <button onClick={() => setView('dashboard')} className="flex items-center gap-2.5 min-w-0 focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded-lg px-1 py-1" aria-label="Ir al panel">
              <span className="rounded-lg bg-emerald-600 p-2 text-white shrink-0" aria-hidden>
                <Radar className="w-5 h-5" />
              </span>
              <span className="leading-tight text-left min-w-0 flex-1 hidden sm:block">
                <span className="block font-bold truncate">SECOP Radar</span>
                <span className="hidden md:block text-[11px] text-muted-foreground truncate">Agente de oportunidades SECOP II</span>
              </span>
            </button>

            <nav aria-label="Navegación principal" className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              {navItems.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setView(n.key)}
                  className={`relative flex items-center gap-1.5 rounded-lg px-2 sm:px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 min-h-11 min-w-11 ${
                    view === n.key || (n.key === 'oportunidades' && view === 'detalle')
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  aria-current={view === n.key ? 'page' : undefined}
                >
                  <n.icon className="w-4 h-4" aria-hidden />
                  <span className="hidden md:inline">{n.label}</span>
                  {typeof n.badge === 'number' && n.badge > 0 && (
                    <Badge className="ml-0.5 bg-emerald-600 text-white text-[10px] px-1.5 min-w-4 h-4">{n.badge > 99 ? '99+' : n.badge}</Badge>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {view === 'dashboard' && (
          <DashboardView payload={dash} loading={loadingDashboard} onOpenOpportunity={openOpportunity} onSync={handleSync} syncing={syncing} onGoTo={setView} />
        )}
        {view === 'oportunidades' && (
          <OpportunitiesView
            opportunities={opportunities}
            loading={loadingOpps}
            onOpenOpportunity={openOpportunity}
            onAnalyze={handleAnalyze}
            onDiscard={handleDiscard}
            onApprovePrep={handleApprovePrep}
            analyzingId={analyzingId}
          />
        )}
        {view === 'detalle' && (
          <OpportunityDetailView
            opportunity={detail}
            loading={loadingDetail}
            onBack={() => setView('oportunidades')}
            onAnalyze={handleAnalyze}
            onDiscard={handleDiscard}
            onApprovePrep={handleApprovePrep}
            onGenerateProposal={handleGenerateProposal}
            onApproveProposal={handleApproveProposal}
            analyzing={analyzingId === selectedId}
            generating={generating}
          />
        )}
        {view === 'empresa' && <CompanyView company={company} loading={loadingCompany} onSaved={() => { loadCompany(); refreshAll() }} />}
        {view === 'alertas' && (
          <AlertsView
            notifications={notifications}
            unread={unread}
            loading={loadingAlerts}
            onOpenOpportunity={openOpportunity}
            onMarkAllRead={handleMarkAllRead}
            onMarkRead={handleMarkRead}
          />
        )}
      </main>

      {/* Pie pegado al fondo */}
      <footer className="mt-auto border-t bg-background">
        <div className="mx-auto max-w-7xl px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden />
              MVP — La presentación en SECOP II se mantiene manual y sujeta a aprobación humana explícita.
            </p>
            <p>Fuente de datos: datos.gov.co · SECOP II — Procesos de Contratación</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

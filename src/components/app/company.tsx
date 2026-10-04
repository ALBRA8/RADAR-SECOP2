'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Building2, Save, Plus, Trash2, Briefcase, History, FolderOpen, X } from 'lucide-react'
import { fmtCOP, type CompanyProfile } from './client-types'
import { Spinner } from './shared'
import { useToast } from '@/hooks/use-toast'

const MODALIDADES = ['Licitación pública', 'Subasta', 'Contratación directa', 'Selección Abreviada', 'Mínima cuantía', 'Acuerdo Marco', 'Contratación régimen especial']
const TIPOS_CONTRATO = ['Servicios', 'Prestación de servicios', 'Compra y venta de bienes', 'Suministros', 'Obra', 'Consultoría', 'Interventoría', 'Arrendamiento']
const FASES = ['Presentación de oferta', 'Selección', 'Planeación', 'Borrador', 'Evaluación']
const DEPARTAMENTOS = ['Distrito Capital de Bogotá', 'Antioquia', 'Valle del Cauca', 'Cundinamarca', 'Atlántico', 'Santander', 'Risaralda', 'Caldas', 'Tolima', 'Norte de Santander', 'Bolívar', 'Magdalena', 'Nariño', 'Córdoba', 'Meta', 'Huila', 'Quindío', 'Cauca', 'Boyacá', 'Eje Cafetero']

export function CompanyView({
  company,
  loading,
  onSaved,
}: {
  company: CompanyProfile | null
  loading: boolean
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<Partial<CompanyProfile>>({})
  const [saving, setSaving] = useState(false)
  const [selDept, setSelDept] = useState('')
  const [selMod, setSelMod] = useState('')
  const [selTip, setSelTip] = useState('')
  const [selFase, setSelFase] = useState('')

  // Formularios de ítems
  const [prod, setProd] = useState({ name: '', description: '', keywords: '' })
  const [exp, setExp] = useState({ title: '', entity: '', year: '', value: '', description: '' })
  const [doc, setDoc] = useState({ name: '', docType: '', status: 'DISPONIBLE' })

  useEffect(() => {
    if (company) setForm({ ...company })
  }, [company])

  if (loading) return <Spinner label="Cargando perfil…" />

  if (!company) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Building2 className="w-10 h-10 mx-auto text-muted-foreground" aria-hidden />
          <h3 className="font-semibold mt-3">Sin empresa registrada</h3>
          <p className="text-sm text-muted-foreground mt-1">El MVP permite configurar una o varias empresas. Registra la primera.</p>
        </CardContent>
      </Card>
    )
  }

  const set = (k: keyof CompanyProfile, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  const saveProfile = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: company.id,
          name: form.name,
          nit: form.nit,
          description: form.description,
          city: form.city,
          department: form.department,
          minBudget: Number(form.minBudget),
          maxBudget: Number(form.maxBudget),
          departmentsAllowed: form.departmentsAllowed,
          modalitiesAllowed: form.modalitiesAllowed,
          contractTypesAllowed: form.contractTypesAllowed,
          phasesAllowed: form.phasesAllowed,
          requireKeywordHit: form.requireKeywordHit,
          capacity: form.capacity,
          approverName: form.approverName,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Error al guardar')
      toast({ title: 'Perfil actualizado', description: 'Los filtros determinísticos usarán estos parámetros en la próxima sincronización.' })
      onSaved()
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const addItem = async (payload: object) => {
    try {
      const res = await fetch('/api/company/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company.id, ...payload }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Error')
      onSaved()
    } catch (e) {
      toast({ title: 'No se pudo agregar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const removeItem = async (kind: string, id: string) => {
    try {
      const res = await fetch(`/api/company/items?kind=${kind}&id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Error al eliminar')
      onSaved()
    } catch (e) {
      toast({ title: 'No se pudo eliminar', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const ChipList = ({ items, onRemove, empty }: { items: string[]; onRemove: (v: string) => void; empty: string }) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <Badge key={it} variant="secondary" className="gap-1 pr-1">
            {it}
            <button onClick={() => onRemove(it)} className="rounded-full hover:bg-foreground/10 p-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-600" aria-label={`Quitar ${it}`}>
              <X className="w-3 h-3" aria-hidden />
            </button>
          </Badge>
        ))}
      </div>
    )

  return (
    <Tabs defaultValue="datos" className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="datos">Datos y filtros</TabsTrigger>
        <TabsTrigger value="productos">Productos/Servicios ({company.products.length})</TabsTrigger>
        <TabsTrigger value="experiencia">Experiencia ({company.experiences.length})</TabsTrigger>
        <TabsTrigger value="documentos">Documentos ({company.documents.length})</TabsTrigger>
      </TabsList>

      {/* Datos y filtros */}
      <TabsContent value="datos" className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-600" aria-hidden /> Datos básicos</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Nombre de la empresa *</Label>
              <Input id="c-name" value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-nit">NIT</Label>
              <Input id="c-nit" value={form.nit || ''} onChange={(e) => set('nit', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-desc">Descripción / a qué se dedica</Label>
              <Textarea id="c-desc" rows={2} value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-city">Ciudad</Label>
              <Input id="c-city" value={form.city || ''} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-dept">Departamento</Label>
              <Input id="c-dept" value={form.department || ''} onChange={(e) => set('department', e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="c-cap">Capacidad operativa</Label>
              <Textarea id="c-cap" rows={2} value={form.capacity || ''} onChange={(e) => set('capacity', e.target.value)} placeholder="Ej.: hasta 3 proyectos simultáneos, equipo de 12 personas, cobertura de ciudades principales…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-appr">Responsable de aprobar ofertas</Label>
              <Input id="c-appr" value={form.approverName || ''} onChange={(e) => set('approverName', e.target.value)} placeholder="Nombre del aprobador (Módulo H)" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Filtros determinísticos configurables (Módulo B)</CardTitle>
            <p className="text-sm text-muted-foreground">Estos parámetros NO están programados de forma rígida: aplícanse en cada sincronización.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-min">Rango mínimo (COP)</Label>
                <Input id="c-min" type="number" min={0} step={100000} value={form.minBudget ?? 0} onChange={(e) => set('minBudget', Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">{fmtCOP(Number(form.minBudget) || 0)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-max">Rango máximo (COP)</Label>
                <Input id="c-max" type="number" min={0} step={100000} value={form.maxBudget ?? 0} onChange={(e) => set('maxBudget', Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">{fmtCOP(Number(form.maxBudget) || 0)}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Cobertura geográfica (departamentos)</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selDept}
                  onChange={(e) => setSelDept(e.target.value)}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-11"
                  aria-label="Agregar departamento a la cobertura"
                >
                  <option value="">Selecciona un departamento…</option>
                  {DEPARTAMENTOS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <Button variant="outline" onClick={() => { if (selDept) { set('departmentsAllowed', [...(form.departmentsAllowed || []), selDept]); setSelDept('') } }} className="min-h-11">
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar
                </Button>
              </div>
              <ChipList items={form.departmentsAllowed || []} empty="Sin selección = cobertura nacional." onRemove={(v) => set('departmentsAllowed', (form.departmentsAllowed || []).filter((x) => x !== v))} />
            </div>

            <div className="space-y-2">
              <Label>Modalidades de interés</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={selMod} onChange={(e) => setSelMod(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-11" aria-label="Agregar modalidad">
                  <option value="">Selecciona una modalidad…</option>
                  {MODALIDADES.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
                <Button variant="outline" onClick={() => { if (selMod) { set('modalitiesAllowed', [...(form.modalitiesAllowed || []), selMod]); setSelMod('') } }} className="min-h-11">
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar
                </Button>
              </div>
              <ChipList items={form.modalitiesAllowed || []} empty="Sin selección = todas las modalidades." onRemove={(v) => set('modalitiesAllowed', (form.modalitiesAllowed || []).filter((x) => x !== v))} />
            </div>

            <div className="space-y-2">
              <Label>Tipos de contrato de interés</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={selTip} onChange={(e) => setSelTip(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-11" aria-label="Agregar tipo de contrato">
                  <option value="">Selecciona un tipo…</option>
                  {TIPOS_CONTRATO.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
                <Button variant="outline" onClick={() => { if (selTip) { set('contractTypesAllowed', [...(form.contractTypesAllowed || []), selTip]); setSelTip('') } }} className="min-h-11">
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar
                </Button>
              </div>
              <ChipList items={form.contractTypesAllowed || []} empty="Sin selección = todos los tipos." onRemove={(v) => set('contractTypesAllowed', (form.contractTypesAllowed || []).filter((x) => x !== v))} />
            </div>

            <div className="space-y-2">
              <Label>Fases de interés</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={selFase} onChange={(e) => setSelFase(e.target.value)} className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-11" aria-label="Agregar fase">
                  <option value="">Selecciona una fase…</option>
                  {FASES.map((f) => (<option key={f} value={f}>{f}</option>))}
                </select>
                <Button variant="outline" onClick={() => { if (selFase) { set('phasesAllowed', [...(form.phasesAllowed || []), selFase]); setSelFase('') } }} className="min-h-11">
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar
                </Button>
              </div>
              <ChipList items={form.phasesAllowed || []} empty="Sin selección = sin filtro de fase." onRemove={(v) => set('phasesAllowed', (form.phasesAllowed || []).filter((x) => x !== v))} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Exigir coincidencia de palabras clave</p>
                <p className="text-xs text-muted-foreground">Descarta procesos sin ninguna coincidencia con tus productos/servicios registrados.</p>
              </div>
              <Switch checked={!!form.requireKeywordHit} onCheckedChange={(v) => set('requireKeywordHit', v)} aria-label="Exigir coincidencia de palabras clave" />
            </div>

            <Button onClick={saveProfile} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 min-h-11 w-full sm:w-auto">
              <Save className={`w-4 h-4 mr-2 ${saving ? 'animate-pulse' : ''}`} aria-hidden /> {saving ? 'Guardando…' : 'Guardar perfil'}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Productos / servicios */}
      <TabsContent value="productos">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><Briefcase className="w-5 h-5 text-emerald-600" aria-hidden /> Productos y servicios</CardTitle>
            <p className="text-sm text-muted-foreground">Única fuente válida para evaluar la relación con el objeto de un proceso. Si no está aquí, no existe para el agente.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Nombre *</Label>
                <Input id="p-name" value={prod.name} onChange={(e) => setProd({ ...prod, name: e.target.value })} placeholder="Ej.: Aseo y limpieza de instalaciones" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-kw">Palabras clave (separadas por coma)</Label>
                <Input id="p-kw" value={prod.keywords} onChange={(e) => setProd({ ...prod, keywords: e.target.value })} placeholder="aseo, limpieza, sanitización" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="p-desc">Descripción</Label>
                <Textarea id="p-desc" rows={2} value={prod.description} onChange={(e) => setProd({ ...prod, description: e.target.value })} />
              </div>
            </div>
            <Button
              onClick={() => {
                if (!prod.name.trim()) return toast({ title: 'El nombre es obligatorio', variant: 'destructive' })
                addItem({ kind: 'product', name: prod.name.trim(), description: prod.description.trim() || null, keywords: prod.keywords.split(',').map((k) => k.trim()).filter(Boolean) })
                setProd({ name: '', description: '', keywords: '' })
              }}
              className="bg-emerald-600 hover:bg-emerald-700 min-h-11"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar producto/servicio
            </Button>
            <Separator />
            {company.products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay productos/servicios registrados.</p>
            ) : (
              <ul className="space-y-2.5">
                {company.products.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{p.name}</p>
                      {p.description && <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>}
                      {p.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {p.keywords.map((k) => (<Badge key={k} variant="secondary" className="text-[10px]">{k}</Badge>))}
                        </div>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeItem('product', p.id)} aria-label={`Eliminar ${p.name}`} className="shrink-0 min-h-9 min-w-9">
                      <Trash2 className="w-4 h-4 text-rose-600" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Experiencia */}
      <TabsContent value="experiencia">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><History className="w-5 h-5 text-emerald-600" aria-hidden /> Experiencia y contratos anteriores</CardTitle>
            <p className="text-sm text-muted-foreground">Solo se registrará lo que ingreses aquí. El agente jamás inferirá experiencia no registrada.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="e-title">Título del contrato/proyecto *</Label>
                <Input id="e-title" value={exp.title} onChange={(e) => setExp({ ...exp, title: e.target.value })} placeholder="Ej.: Mantenimiento de zonas verdes 2023" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-entity">Entidad / cliente</Label>
                <Input id="e-entity" value={exp.entity} onChange={(e) => setExp({ ...exp, entity: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-year">Año</Label>
                <Input id="e-year" type="number" value={exp.year} onChange={(e) => setExp({ ...exp, year: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-value">Valor del contrato (COP)</Label>
                <Input id="e-value" type="number" value={exp.value} onChange={(e) => setExp({ ...exp, value: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="e-desc">Descripción</Label>
                <Textarea id="e-desc" rows={2} value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} />
              </div>
            </div>
            <Button
              onClick={() => {
                if (!exp.title.trim()) return toast({ title: 'El título es obligatorio', variant: 'destructive' })
                addItem({
                  kind: 'experience',
                  title: exp.title.trim(),
                  entity: exp.entity.trim() || null,
                  year: exp.year ? Number(exp.year) : null,
                  value: exp.value ? Number(exp.value) : null,
                  description: exp.description.trim() || null,
                })
                setExp({ title: '', entity: '', year: '', value: '', description: '' })
              }}
              className="bg-emerald-600 hover:bg-emerald-700 min-h-11"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar experiencia
            </Button>
            <Separator />
            {company.experiences.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay experiencia registrada.</p>
            ) : (
              <ul className="space-y-2.5">
                {company.experiences.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{e.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {e.entity || 'Cliente no registrado'}{e.year ? ` · ${e.year}` : ''}{e.value ? ` · ${fmtCOP(e.value)}` : ''}
                      </p>
                      {e.description && <p className="text-sm text-muted-foreground mt-1">{e.description}</p>}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeItem('experience', e.id)} aria-label={`Eliminar ${e.title}`} className="shrink-0 min-h-9 min-w-9">
                      <Trash2 className="w-4 h-4 text-rose-600" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Documentos */}
      <TabsContent value="documentos">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><FolderOpen className="w-5 h-5 text-emerald-600" aria-hidden /> Documentos corporativos</CardTitle>
            <p className="text-sm text-muted-foreground">Registra qué documentos tiene disponibles la empresa. Los pendientes generan alertas de faltantes.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="d-name">Nombre del documento *</Label>
                <Input id="d-name" value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} placeholder="Ej.: RUT vigente" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-type">Tipo</Label>
                <Input id="d-type" value={doc.docType} onChange={(e) => setDoc({ ...doc, docType: e.target.value })} placeholder="Ej.: Jurídico, Financiero…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-status">Estado</Label>
                <select id="d-status" value={doc.status} onChange={(e) => setDoc({ ...doc, status: e.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-11" aria-label="Estado del documento">
                  <option value="DISPONIBLE">Disponible</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="VENCIDO">Vencido</option>
                </select>
              </div>
            </div>
            <Button
              onClick={() => {
                if (!doc.name.trim()) return toast({ title: 'El nombre es obligatorio', variant: 'destructive' })
                addItem({ kind: 'document', name: doc.name.trim(), docType: doc.docType.trim() || null, status: doc.status })
                setDoc({ name: '', docType: '', status: 'DISPONIBLE' })
              }}
              className="bg-emerald-600 hover:bg-emerald-700 min-h-11"
            >
              <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Agregar documento
            </Button>
            <Separator />
            {company.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay documentos registrados.</p>
            ) : (
              <ul className="space-y-2.5">
                {company.documents.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{d.name}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {d.docType && <span className="text-xs text-muted-foreground">{d.docType}</span>}
                        <Badge variant="outline" className={`text-[10px] ${d.status === 'DISPONIBLE' ? 'border-emerald-300 text-emerald-800' : d.status === 'PENDIENTE' ? 'border-amber-300 text-amber-800' : 'border-rose-300 text-rose-700'}`}>
                          {d.status}
                        </Badge>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeItem('document', d.id)} aria-label={`Eliminar ${d.name}`} className="shrink-0 min-h-9 min-w-9">
                      <Trash2 className="w-4 h-4 text-rose-600" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

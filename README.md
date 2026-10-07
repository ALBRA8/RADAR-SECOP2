# RADAR-SECOP2 🎯

**Agente Inteligente de Detección y Preparación de Oportunidades en SECOP II** (Colombia).

La plataforma monitorea en tiempo real los procesos de contratación publicados en [datos.gov.co](https://www.datos.gov.co/) (dataset SECOP II — Procesos de Contratación `p6dx-8zbt`), los filtra contra el perfil de tu empresa con reglas explicables, calcula compatibilidad en 7 dimensiones, analiza los pliegos con IA y **redacta proyectos completos** alineados a los requisitos de la oferta — incluida la especialidad en **Marco Lógico** (matriz fin / propósito / resultados / actividades con indicadores, medios de verificación y supuestos).

## ✨ Capacidades

| Módulo | Descripción |
|---|---|
| **Ingesta SECOP II** | Consulta programática vía API Socrata con mapeo adaptativo, deduplicación por `id_del_proceso` y detección de modificaciones por hash SHA-256 |
| **Filtro determinístico** | Reglas configurables por empresa (rango económico, fase, modalidad, tipo de contrato, cobertura, palabras clave) con **motivos de descarte explícitos** |
| **Compatibilidad explicable** | 7 dimensiones ponderadas (objeto↔productos 35%, valor 20%, ubicación 15%, etc.) — devuelve razones, no solo porcentaje |
| **Análisis IA de pliegos** | Matriz REQUISITO / ESTADO / EVIDENCIA / ACCIÓN con política anti-invención (estados CUMPLE / NO_CUMPLE / PENDIENTE / REQUIERE_REVISION) |
| **Modo Agente Proyectista** | Redacción profunda de proyectos completos (resumen, objetivos, metodología, cronograma, equipo, entregables, riesgos, métricas) + **chat de refinamiento por sección** |
| **Especialidad Marco Lógico** | Generación y validación de la matriz de marco lógico exigida en muchas licitaciones públicas (MGA / SGR), persistida como JSON consultable |
| **Canales Telegram y WhatsApp** | Comunicación bidireccional con el agente: texto, **notas de voz (STT)**, imágenes, documentos y video. Lee pliegos y analiza fotos de contratos |
| **Multimodalidad** | Análisis de PDF/imágenes/audio con validación de magic bytes y límite de 25 MB |
| **Servidor MCP** | Model Context Protocol para que **otros proyectos** consulten oportunidades, propuestas y marco lógico vía JSON-RPC — 17 tools, fail-closed en producción sin `MCP_API_KEY` |
| **Evidence Contract** | Toda afirmación clave es una fila `Evidence` con fuente, tipo, timestamp, hecho extraído, confianza, **TruthLevel** (VERIFIED/OBSERVED/INFERRED/ESTIMATED/UNKNOWN), estado de verificación y provenance — siempre responde "¿de dónde salió este dato?" |
| **Regla de oro (Truth)** | `INFERRED + CUMPLE` es inválido: el cumplimiento sin evidencia verificable se degrada a PENDIENTE y bloquea aprobaciones (422), con override `force` auditado |
| **Detección de modificaciones** | Diff real valor-a-valor (old→new) sobre 9 campos del proceso, persistido en `ProcessChange` con impacto ALTA/MEDIA/BAJA y ventana de ingesta en hora Colombia |
| **MemoryDV** | Memoria aislada por `agent_id` y dominio: EPISODIC/SEMANTIC/FACTUAL/PROCEDURAL con consolidación, decay y regla dura: la memoria FACTUAL exige evidencia |
| **Skills (11 contratos)** | Skill Contracts versionados con procedimiento, verificación, pitfalls, política de evidencia y regresiones — validados y con successRate |
| **Doctor** | Autodiagnóstico en 10 checks (SECOP, DB, canales, MCP, memoria, skills, provenance, deadlines…) con fixes seguros auditados |
| **Autonomía L0-L5** | Techo explícito (`L2_EXECUTE_SAFE` por defecto); L4/L5 requieren bandera manual; acciones externas sin aprobación humana quedan bloqueadas |
| **Observability** | Cada operación clave queda en `Execution` (correlación, latencia, proveedores, I/O, errores) + `ProviderMetric` — una evaluación es reconstruible |
| **Control y trazabilidad** | Aprobación humana con snapshot completo (versión, requisitos, score), eventos de auditoría y notificaciones; exportación a Word |

## 🧭 Principios de datos

- **Nunca se inventan datos.** La persuasión viene de la narrativa estructurada sobre información real registrada en el perfil.
- Los vacíos se marcan con `[POR CONFIRMAR]` y se contabilizan.
- **El precio siempre lo define el usuario** — la estructura económica se genera como plantilla.

## 🛠 Stack

- **Next.js (App Router)** + TypeScript + Tailwind CSS + shadcn/ui
- **Prisma ORM** sobre SQLite (`db/custom.db`, base demo incluida con oportunidades reales)
- **z-ai-web-dev-sdk** para IA (solo backend, con fallback a reglas)
- **Bun test** para unit tests; suite E2E en Python; fuente de datos: API Socrata de datos.gov.co

## 🧪 Tests

```bash
bun test tests/unit              # unit: regla de oro, memoria, skills, seguridad, filtros
python3 scripts/e2e_test.py ALL  # fases A-J: canales, multimodal, Marco Lógico, MCP, evidencia, memoria, doctor, flujo integral
bash scripts/test_security.sh    # 12 asserts de seguridad
python3 scripts/test_sync.py     # dedup, diff y idempotencia de ingesta
```

## ⚙️ Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Ruta absoluta de la BD SQLite (`file:/ruta/absoluta/db/custom.db` recomendado: las relativas se resuelven distinto entre CLI Prisma y runtime standalone) |
| `MCP_API_KEY` | Prod | Si está definida exige Bearer en `/api/mcp`; en producción sin key el MCP es fail-closed (503) |
| `TELEGRAM_WEBHOOK_SECRET` | No | Valida `x-telegram-bot-api-secret-token` del webhook |
| `WHATSAPP_APP_SECRET` | No | Valida firma `X-Hub-Signature-256` del webhook |
| `SOCRATA_APP_TOKEN` | No | Token Socrata para evitar throttling en sincronizaciones masivas |
| `RADAR_ALLOW_L4_L5` | No | Bandera manual para habilitar autonomía L4/L5 (nunca por defecto) |

## 🚀 Puesta en marcha

```bash
bun install                 # o npm install
npx prisma generate         # genera el cliente Prisma
bun run dev                 # desarrollo en http://localhost:3000
```

La base demo (`db/custom.db`) ya viene sembrada con una empresa de ejemplo, procesos de SECOP II reales y oportunidades vigentes. Para volver a sincronizar: **Mi Empresa → Sincronizar SECOP** (o `POST /api/secop/sync`).

## 📡 Canales de mensajería

Configura en la vista **Canales** de la app:

- **Telegram**: crea el bot con @BotFather, pega el token y usa *polling* (recomendado, no requiere HTTPS público).
- **WhatsApp Cloud API**: token de acceso permanente + `phone_number_id` + verify token del webhook.
- Opcionales vía variables de entorno: `TELEGRAM_WEBHOOK_SECRET` y `WHATSAPP_APP_SECRET` (validación de firma `X-Hub-Signature-256`).

## 🔌 MCP (comunicación entre proyectos)

Endpoint `POST /api/mcp` (JSON-RPC 2.0). Herramientas disponibles incluyen `list_opportunities`, `get_opportunity`, `list_proposals`, `get_marco_logico`, `refine_proposal`, entre otras. Descubre el catálogo con `tools/list`.

## 📁 Estructura

```
src/app/api/          # Rutas API (secop, opportunities, proposals, channels, media, mcp…)
src/lib/              # secop.ts, filters.ts, compat.ts, ai.ts (IA + Marco Lógico)
src/components/app/   # UI (Panel, Oportunidades, Detalle, Mi Empresa, Canales, Bandeja)
prisma/schema.prisma  # Modelo de datos
scripts/              # Utilidades, semilla y suite E2E (e2e_test.py)
db/custom.db          # Base demo lista para usar
```

## ⚠️ Aviso

Los datos provienen de la fuente pública oficial de SECOP II; las fechas límite se muestran como "verificar en SECOP" cuando la fuente no las publica. La presentación de ofertas se realiza manualmente en la plataforma SECOP (el sistema no oferta automáticamente).

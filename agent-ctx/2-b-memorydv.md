# Task 2-b — Agente MemoryDV (memoria aislada RADAR-SECOP2)

Fecha: 2026-10-06 · Ownership respetado: solo `src/lib/memory.ts`, `src/app/api/memory/route.ts`, `src/app/api/memory/[id]/route.ts`.

## Qué se implementó

**src/lib/memory.ts** — núcleo MemoryDV (PROMPT 05 §13-14):
- Constantes `AGENT_ID="RADAR-SECOP2"`, `DOMAIN="procurement-secop2"`, `MEMORY_TYPES`, `TRUTH_LEVELS`, `MemoryValidationError`.
- `remember()`: valida type/truthLevel/confidence(0..1)/expiresAt; **regla dura**: FACTUAL sin evidenceIds → rechaza con `"memoria FACTUAL exige evidenceIds (PROMPT 05 §14)..."`; con `allowDemote=true` demora a SEMANTIC dejando traza en summary. **Aislamiento**: siempre escribe agentId+domain del RADAR; si llegan agentId Y domain explícitos apuntando a otro agente → rechaza (400). decayWeight inicial 1.0.
- `recall(query, opts)`: tokens (≥2 chars) sobre key(+2)/tags(+1.5)/summary(+1)/content(+1), query completa en key +3; score = coincidencia × decayWeight × confidence; cada retrieval incrementa accessCount, setea lastAccessAt y empuja decayWeight hacia 1.0 (+0.15, cap 1.0). Filtro agentId+domain SIEMPRE.
- `consolidate()`: EPISODIC con createdAt < 7 días y accessCount ≥ 2 → SEMANTIC con summary por reglas simples (primera oración, 180 chars, prefijo "[Consolidada de EPISODIC]") — sin LLM; marca consolidatedAt; dedup por key: content idéntico → merge (borra duplicado), distinto → promueve anotando la fusión.
- `decay()`: decayWeight × 0.95^díasSinAcceso (lastAccessAt ?? createdAt), piso 0.05; elimina entradas con expiresAt pasado.
- `stats()`, `list()`, `getById()`, `remove()` — todos con aislamiento (memoria ajena = no encontrada).
- `seedIfEmpty()`: si el agente no tiene memoria, siembra 4 entradas vía remember() (mismas validaciones): FACTUAL Jardín Botánico (evidenceIds ["seed-evidence-1"], OBSERVED, "origin SEED" en summary), SEMANTIC patrón aseo/3 años, PROCEDURAL respuesta a preguntas de pliego, EPISODIC sync inicial.

**Rutas API** (con ok/bad/safe, safe respeta 4xx desde Task 8):
- `GET /api/memory` sin params → seed idempotente + stats + últimos 20; con `?q=&type=&limit=` → recall; con type/limit sin q → listado.
- `POST /api/memory` → remember (201; MemoryValidationError → 400).
- `PUT /api/memory?action=consolidate|decay|both` → resumen de la operación.
- `GET/DELETE /api/memory/[id]` → 200 / 404 (params Promise según Next 16).

## Hallazgo crítico resuelto: cliente Prisma obsoleto en el proceso vivo

El dev server arrancó 23:18:43 pero el cliente Prisma se regeneró 23:28:23 (cuando se desplegó MemoryEntry): `src/lib/db.ts` cachea la instancia en globalThis → en el proceso vivo `db.memoryEntry` era `undefined` (500 en el primer GET). Sin reiniciar el server (no hay supervisor confirmado en start.sh) y sin tocar db.ts ni correr `prisma generate`, se añadió en **mi propio archivo** un fallback acotado `mdb()`: si el `db` cacheado no expone `memoryEntry`, hace cache-busting de require (`createRequire` + delete de claves `@prisma/client` y `.prisma/client`) e instancia una vez el cliente regenerado. En un proceso nuevo la rama nunca se ejecuta (verificado: tras los reinicios espontáneos del dev server, el cliente actual ya trae memoryEntry y se usa el `db` estándar). NOTA para el agente principal: el fallback es eliminable en cuanto se reinicie el dev server de forma controlada.

## Verificación

- `bunx tsc --noEmit`: **0 errores en src/** (solo los 4 preexistentes conocidos en examples/ y skills/). `bun run lint`: limpio (0 problemas).
- curl: GET sin params → seed `{seeded:true,created:4}` + stats (4 por tipo; factualWithEvidence 1/1); repetido → `{seeded:false}` (idempotente).
- POST FACTUAL sin evidenceIds → **400** con mensaje §14. POST FACTUAL con `["evid-invias-001"]` → **201**. POST allowDemote → SEMANTIC con summary "DEMOVIDA de FACTUAL a SEMANTIC...". POST agentId CRM-ALBRA → **400 aislamiento**.
- GET `?q=póliza` → FACTUAL Jardín Botánico, score 2.25 (= match 2.5 × decay 1.0 × conf 0.9), accessCount 0→1.
- PUT decay con fixture retrocedido 3 días → weight 1.0 → **0.8574** (0.95³). PUT consolidate con EPISODIC retrocedido 8 días y accessCount 3 → **PROMOTED 1** con summary por reglas. PUT both → resúmenes combinados.
- GET [id] 200; GET/DELETE inexistente → 404; DELETE pruebas → 200 y luego 404 en repetido.
- Estado final de la memoria: 6 entradas — 2 FACTUAL (ambas con evidencia), 2 SEMANTIC, 1 PROCEDURAL, 1 EPISODIC; avgConfidence 0.8833.
- Dev server se reinició dos veces de forma espontánea durante las pruebas (entorno/plataforma); el estado persistió y el módulo siguió operativo tras cada reinicio (prueba de resiliencia incidental).

## Pendiente / recomendaciones

- Consolidación y decay son periódicos bajo demanda (PUT); quien automatice tareas debería invocar `?action=both` a diario (cron/pipeline del agente principal).
- El recall es escaneo en memoria sobre el agente+dominio (adeCuado para volúmenes de memoria de agente); si crece a decenas de miles, migrar a FTS5.

#!/usr/bin/env python3
"""E2E propio del Agente SECOP Radar — Fases A-D (humo/multimodal/Marco Lógico/MCP)
+ Fases nuevas (Task 3-a): E Evidence/Truth, F MemoryDV, G Skills/Doctor,
J Flujo RADAR Integral (§27). Menú: A|B|C|D|E|F|G|J|ALL y --ONLY<x>."""
import json
import os
import subprocess
import sys
import time
import requests

BASE = "http://localhost:3000"
S = requests.Session()
results = []
USED_OPPS = []  # oportunidades ya consumidas por otras fases (evitar pisarlas)

def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    results.append((name, status, detail))
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))

def wait_server():
    for _ in range(30):
        try:
            if S.get(f"{BASE}/", timeout=5).status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False

def list_opportunities():
    r = S.get(f"{BASE}/api/opportunities?limit=100", timeout=60)
    return r.json().get("opportunities", [])

def detail_opportunity(opp_id):
    r = S.get(f"{BASE}/api/opportunities/{opp_id}", timeout=60)
    return (r.json() or {}).get("opportunity") or {}

def approve_proposal(pid, approver="QA-E2E"):
    """Aprobación con regla de oro §19: si 422 → force+notes (queda auditada). Devuelve (status_code, body)."""
    r = S.post(f"{BASE}/api/proposals/{pid}/approve",
               json={"decision": "APROBADA", "approver": approver}, timeout=120)
    if r.status_code == 422:
        r = S.post(f"{BASE}/api/proposals/{pid}/approve",
                   json={"decision": "APROBADA", "approver": approver, "force": True,
                         "notes": "Aprobación de prueba E2E (QA-E2E): regla de oro §19 forzada y auditada como APPROVAL_FORZADA."},
                   timeout=120)
    return r.status_code, (r.json() if 'application/json' in r.headers.get('Content-Type', '') else {})

def ensure_aprobada_preparacion(opps):
    """C0/J: garantiza (o crea vía API) una oportunidad APROBADA_PREPARACION. Devuelve (opp, creada)."""
    opp = next((o for o in opps if o.get("status") == "APROBADA_PREPARACION"), None)
    if opp:
        return opp, False
    cand = next((o for o in opps if o.get("status") == "COMPATIBLE"), None) \
        or next((o for o in opps if o.get("status") not in ("DESCARTADA", "APROBADA_PREPARACION")), None)
    if not cand:
        return None, False
    opp_id = cand["id"]
    if opp_id not in USED_OPPS:
        USED_OPPS.append(opp_id)
    S.post(f"{BASE}/api/opportunities/{opp_id}/status", json={"status": "APROBADA_PREPARACION"}, timeout=60)
    return detail_opportunity(opp_id), True

# ════ Selección de fases ══════════════════════════════════════
FROM = (sys.argv[1] if len(sys.argv) > 1 else "A").upper()
ONLY = FROM.startswith("--ONLY")
if ONLY:
    FROM = FROM.replace("--ONLY", "").strip() or "A"
PHASES = ["A", "B", "C", "D", "E", "F", "G", "J"]
def skip(phase):
    if FROM == "ALL":
        return False
    if ONLY:
        return phase != FROM
    if phase not in PHASES or FROM not in PHASES:
        return True
    return PHASES.index(phase) < PHASES.index(FROM)

print("\n── FASE A: API smoke ──")
assert wait_server(), "server no respondió"

if not skip("A"):
    r = S.get(f"{BASE}/api/channels/config", timeout=30)
    check("A1 channels/config GET 200", r.status_code == 200, r.text[:120])

    r = S.get(f"{BASE}/api/channels/telegram/webhook", timeout=30)
    d = r.json()
    check("A2 telegram webhook info", r.status_code == 200 and d.get("channel") == "TELEGRAM")

    r = S.get(f"{BASE}/api/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123", timeout=30)
    check("A3 whatsapp verify rechaza token malo (403)", r.status_code == 403)

    r = S.get(f"{BASE}/api/channels/messages", timeout=30)
    d = r.json()
    check("A4 inbox GET 200", r.status_code == 200 and "messages" in d)

# ════ FASE B: multimodal ═════════════════════════════════════
print("\n── FASE B: análisis multimodal (PDF pliego, voz, imagen) ──")

if not skip("B"):
    # B1: Pliego PDF
    with open("/home/z/my-project/scripts/pliego_prueba.pdf", "rb") as f:
        r = S.post(f"{BASE}/api/media/analyze", files={"file": ("pliego_prueba.pdf", f, "application/pdf")},
                   data={"note": "revisa los requisitos habilitantes"}, timeout=300)
    d = r.json()
    ok = r.status_code == 200 and d.get("ok") and "Marco" in (d.get("reply") or "")
    check("B1 PDF pliego → análisis (extrae requisitos + marco lógico)", ok, (d.get("reply") or r.text)[:150].replace("\n", " "))

    # B2: Nota de voz
    try:
        with open("/home/z/my-project/scripts/nota_voz.mp3", "rb") as f:
            r = S.post(f"{BASE}/api/media/analyze", files={"file": ("nota_voz.mp3", f, "audio/mpeg")},
                       data={"note": "voz"}, timeout=300)
        d = r.json()
        ok = r.status_code == 200 and d.get("ok")
        check("B2 voz mp3 → ASR + respuesta del agente", ok, (d.get("reply") or r.text)[:150].replace("\n", " "))
    except Exception as e:
        check("B2 voz mp3 → ASR + respuesta del agente", False, str(e)[:150])

    # B3: Imagen (foto de contrato/screenshot)
    try:
        with open("/home/z/my-project/scripts/verify_01_dashboard.png", "rb") as f:
            r = S.post(f"{BASE}/api/media/analyze", files={"file": ("captura.png", f, "image/png")},
                       data={"note": "¿qué documento es y qué datos clave ves?"}, timeout=300)
        d = r.json()
        ok = r.status_code == 200 and d.get("ok")
        check("B3 imagen → visión", ok, (d.get("reply") or r.text)[:150].replace("\n", " "))
    except Exception as e:
        check("B3 imagen → visión", False, str(e)[:150])

# ════ FASE C: propuesta con Marco Lógico + export ════════════
print("\n── FASE C: Marco Lógico + export Word ──")

if not skip("C"):
    opps = list_opportunities()
    aprobada = next((o for o in opps if o.get("status") == "APROBADA_PREPARACION"), None)

    # ── FIX C0 (Task 3-a): si no existe APROBADA_PREPARACION con propuesta, crearla vía API ──
    if aprobada is None:
        aprobada, creada = ensure_aprobada_preparacion(opps)
        check("C0-pre oportunidad llevada a APROBADA_PREPARACION vía API", aprobada is not None,
              f"total opps: {len(opps)}")
    else:
        check("C0-pre oportunidad APROBADA_PREPARACION existente", True, aprobada["id"])
    if aprobada is not None and aprobada["id"] not in USED_OPPS:
        USED_OPPS.append(aprobada["id"])

    # C0-núcleo (misión 3-a): oportunidad con propuesta BORRADOR → aprobarla (422 → force+notes auditado)
    if aprobada:
        det = detail_opportunity(aprobada["id"])
        borrador = next((p for p in (det.get("proposals") or []) if p.get("status") == "BORRADOR"), None)
        if borrador is None:
            r = S.post(f"{BASE}/api/proposals/generate", json={"opportunityId": aprobada["id"]}, timeout=400)
            borrador = (r.json() or {}).get("proposal") if r.status_code == 200 else None
        if borrador:
            code, body = approve_proposal(borrador["id"])
            check("C0 propuesta BORRADOR aprobada (QA-E2E; 422→force auditado)",
                  code == 200 and (body.get("snapshot") is not None),
                  f"pid={borrador['id']} http={code} snapshot={'sí' if body.get('snapshot') else 'no'}")
        else:
            check("C0 propuesta BORRADOR aprobada (QA-E2E; 422→force auditado)", False,
                  "no se pudo obtener propuesta BORRADOR para aprobar")
    else:
        check("C0 hay oportunidad aprobada para preparación", False, f"total opps: {len(opps)}")

    if aprobada:
        opp_id = aprobada["id"]
        # C1: refinar la BORRADOR más reciente si la hay; si no, generar versión nueva
        det = detail_opportunity(opp_id)
        borrador = next((p for p in (det.get("proposals") or []) if p.get("status") == "BORRADOR"), None)
        if borrador:
            instruccion_ml = "Construye el marco lógico completo del proyecto: árbol de problemas (causas y efectos), árbol de objetivos y la matriz Fin/Propósito/Componentes/Actividades con indicadores, medios de verificación y supuestos, alineada con la metodología."
            intentos = 2  # reintento: un fallback transitorio a REGLAS (timeout IA) no debe tumbar la fase
            for intento in range(intentos):
                r = S.post(f"{BASE}/api/proposals/{borrador['id']}/refine",
                           json={"opportunityId": opp_id, "instruction": instruccion_ml},
                           headers={"Content-Type": "application/json"}, timeout=400)
                d = r.json()
                ml_probe = (d.get("proposal") or {}).get("marcoLogico") or d.get("marcoLogico")
                if r.status_code == 200 and d.get("engine") == "IA" and ml_probe:
                    break
                if intento < intentos - 1:
                    print(f"  [info] C1 intento {intento + 1}: engine={d.get('engine')} — reintentando refine (fallback transitorio)")
        else:
            r = S.post(f"{BASE}/api/proposals/generate",
                       json={"opportunityId": opp_id, "instruction": "Construye el marco lógico completo del proyecto: árbol de problemas (causas y efectos), árbol de objetivos y la matriz Fin/Propósito/Componentes/Actividades con indicadores, medios de verificación y supuestos, alineada con la metodología."},
                       headers={"Content-Type": "application/json"}, timeout=400)
        d = r.json()
        ml = (d.get("proposal") or {}).get("marcoLogico") or d.get("marcoLogico")
        ok = r.status_code == 200 and ml and len(ml.get("filas", [])) >= 4
        check("C1 refine genera marco lógico (matriz ≥4 filas)", ok,
              f"v{(d.get('proposal') or {}).get('version')} filas={len(ml.get('filas', [])) if ml else 0}" if isinstance(d, dict) else r.text[:150])

        engine = d.get("engine") if isinstance(d, dict) else None
        causas_reales = bool(ml) and all("POR CONFIRMAR" not in c for c in ml.get("causas", []))
        check("C1b motor IA real (engine=IA y causas sin marcadores)", engine == "IA" and causas_reales,
              f"engine={engine} causas_ok={causas_reales}")

        if ml:
            check("C2 árbol de problemas poblado", bool(ml.get("problemaCentral")) and len(ml.get("causas", [])) > 0,
                  f"causas={len(ml.get('causas', []))} efectos={len(ml.get('efectos', []))}")

        # Export docx de la propuesta de trabajo (BORRADOR recién usada o la última generada)
        pid = (d.get("proposal") or {}).get("id") if isinstance(d, dict) and d.get("proposal") else (borrador or {}).get("id") if borrador else None
        if pid:
            r = S.get(f"{BASE}/api/proposals/{pid}/export", timeout=120)
            ct = r.headers.get("Content-Type", "")
            check("C3 export .docx", r.status_code == 200 and "wordprocessingml" in ct and len(r.content) > 10000,
                  f"{len(r.content)} bytes, {ct[:60]}")
        else:
            check("C3 export .docx", False, "sin proposal id para exportar")

# ════ FASE D: MCP ════════════════════════════════════════════
print("\n── FASE D: MCP (JSON-RPC 2.0) ──")
if not skip("D"):
    r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1.0"}}}, timeout=60)
    d = r.json()
    check("D1 initialize MCP", r.status_code == 200 and d.get("result", {}).get("serverInfo", {}).get("name") == "secop-radar-mcp")

    r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, timeout=60)
    tools = r.json().get("result", {}).get("tools", [])
    # FIX D2 (Task 3-a): el registro creció a 17 tools (12 originales + 5 de observabilidad/memoria/skills/doctor).
    check("D2 tools/list >= 12 tools", len(tools) >= 12, f"got {len(tools)}: {[t['name'] for t in tools]}")

    r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                        "params": {"name": "get_inbox", "arguments": {"limit": 5}}}, timeout=60)
    d = r.json()
    total = d.get("result", {}).get("structuredContent", {}).get("total", 0)
    check("D3 tools/call get_inbox", r.status_code == 200 and total > 0, f"{total} mensajes")

    r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                                        "params": {"name": "analyze_pliego_text", "arguments": {"text": "PLIEGO DE CONDICIONES. Objeto: dotación de laboratorios escolares. Presupuesto: $320.000.000 COP. El oferente debe presentar la Matriz de Marco Logico con arbol de problemas. Garantía de seriedad 2%."}}}, timeout=120)
    d = r.json()
    sc = d.get("result", {}).get("structuredContent", {})
    check("D4 tools/call analyze_pliego_text detecta marco lógico", r.status_code == 200 and sc.get("exigeMarcoLogico") is True,
          f"tipo={sc.get('tipoDocumento')} ml={sc.get('exigeMarcoLogico')}")

# ════ FASE E: Evidence Contract / Truth (Task 2-a) ═══════════
print("\n── FASE E: contrato de evidencia y regla de oro ──")
if not skip("E"):
    opps = list_opportunities()
    cand = next((o for o in opps if o["id"] not in USED_OPPS and o.get("status") not in ("DESCARTADA", "APROBADA_PREPARACION")), None) \
        or next((o for o in opps if o.get("status") not in ("DESCARTADA",)), None)
    if cand:
        opp_id = cand["id"]
        USED_OPPS.append(opp_id)
        r = S.post(f"{BASE}/api/opportunities/{opp_id}/analyze", json={}, timeout=300)
        d = r.json()
        evid_count = d.get("evidences", 0) if isinstance(d, dict) else 0
        check("E1 analyze produce evidencias (≥1 fila Evidence)", r.status_code == 200 and evid_count >= 1,
              f"opp={opp_id} evidences={evid_count} engine={d.get('analysisEngine') if isinstance(d, dict) else '?'}")

        reqs = ((d.get("opportunity") or {}).get("requirements") or []) if isinstance(d, dict) else []
        sin_truth = [q.get("code") for q in reqs if not q.get("truthLevel")]
        check("E2 todo requisito lleva truthLevel", r.status_code == 200 and len(reqs) > 0 and not sin_truth,
              f"requisitos={len(reqs)} sin_truthLevel={sin_truth[:5]}")

        violaciones = [f"{q.get('code')}:{q.get('truthLevel')}" for q in reqs
                       if q.get("status") == "CUMPLE" and q.get("truthLevel") in ("INFERRED", "ESTIMATED", "UNKNOWN")]
        check("E3 regla de oro en datos reales: ningún CUMPLE con truthLevel INFERRED/ESTIMATED/UNKNOWN",
              r.status_code == 200 and not violaciones, f"violaciones={violaciones[:5]}")

        det = detail_opportunity(opp_id)
        evids = det.get("evidences") or []
        con_prov = [e for e in evids if (e.get("provenanceJson") or "").strip()]
        check("E4 evidencias embebidas con provenanceJson no vacío", len(evids) >= 1 and len(con_prov) >= 1,
              f"evidencias={len(evids)} con_provenance={len(con_prov)}")
    else:
        check("E1 analyze produce evidencias (≥1 fila Evidence)", False, "sin oportunidad candidata")

# ════ FASE F: MemoryDV (Task 2-b, §13-14) ════════════════════
print("\n── FASE F: MemoryDV (FACTUAL exige evidencia + aislamiento) ──")
if not skip("F"):
    r = S.get(f"{BASE}/api/memory", timeout=60)
    d = r.json()
    stats_ = d.get("stats") or {}
    check("F1 GET /api/memory → seed presente (≥4 entradas)", r.status_code == 200 and stats_.get("total", 0) >= 4,
          f"total={stats_.get('total')} factual={stats_.get('factual')} conEvidencia={stats_.get('factualWithEvidence')}")

    token = f"unit-e2e-{int(time.time())}"
    r = S.post(f"{BASE}/api/memory", json={"type": "FACTUAL", "key": token, "content": "hecho sin respaldo"}, timeout=60)
    check("F2 POST FACTUAL sin evidenceIds → 400 (§14)", r.status_code == 400, f"http={r.status_code} {r.text[:100]}")

    r = S.post(f"{BASE}/api/memory", json={"type": "FACTUAL", "key": token, "content": "hecho observado en pliego",
                                           "evidenceIds": [f"e2e-evidence-{token}"], "truthLevel": "OBSERVED", "confidence": 0.9}, timeout=60)
    created = (r.json() or {}).get("created") or {}
    check("F3 POST FACTUAL con evidenceIds → 201", r.status_code == 201 and created.get("type") == "FACTUAL",
          f"http={r.status_code} id={created.get('id')}")

    r = S.get(f"{BASE}/api/memory?q={token}", timeout=60)
    entries = (r.json() or {}).get("entries") or []
    top_score = entries[0].get("score", 0) if entries else 0
    check("F4 GET ?q= recall con score > 0", r.status_code == 200 and entries and top_score > 0,
          f"count={len(entries)} top_score={top_score}")

    r = S.post(f"{BASE}/api/memory", json={"type": "SEMANTIC", "key": f"{token}-ajena", "content": "memoria ajena",
                                           "agentId": "CRM-ALBRA", "domain": "crm"}, timeout=60)
    check("F5 POST con agentId foráneo → 400 (aislamiento §13)", r.status_code == 400, f"http={r.status_code}")

    # Higiene: la memoria creada por la prueba se elimina (la DB es compartida).
    if created.get("id"):
        r = S.delete(f"{BASE}/api/memory/{created['id']}", timeout=60)
        check("F6 limpieza de memoria de prueba (DELETE → 200)", r.status_code == 200, f"http={r.status_code}")
    else:
        check("F6 limpieza de memoria de prueba (DELETE → 200)", False, "sin id creado para limpiar")

# ════ FASE G: Skills + Doctor + Health ═══════════════════════
print("\n── FASE G: Skill Contracts, health y doctor ──")
if not skip("G"):
    r = S.get(f"{BASE}/api/skills", timeout=60)
    d = r.json()
    check("G1 GET /api/skills → 11 contratos, allValid true",
          r.status_code == 200 and d.get("count") == 11 and d.get("allValid") is True,
          f"count={d.get('count')} allValid={d.get('allValid')}")

    r = S.get(f"{BASE}/api/health", timeout=60)
    d = r.json()
    check("G2 GET /api/health → ok true y db true", r.status_code == 200 and d.get("ok") is True and d.get("db") is True,
          f"ok={d.get('ok')} db={d.get('db')} secop={d.get('secop')} uptime={d.get('uptime')}")

    r = S.get(f"{BASE}/api/doctor", timeout=120)
    d = r.json()
    status = d.get("status")
    checks = d.get("checks") or []
    fallas = [c.get("id") for c in checks if c.get("status") == "FAIL"]
    check("G3 GET /api/doctor → status != UNHEALTHY (con detalle de 10 checks)",
          r.status_code == 200 and status in ("HEALTHY", "DEGRADED") and len(checks) == 10,
          f"status={status} checks={len(checks)} FAILs={fallas}")

# ════ FASE J: FLUJO RADAR INTEGRAL (§27) ═════════════════════
print("\n── FASE J: flujo RADAR integral (ingesta→dedup→análisis→evidencia→compat→aprobación→salida) ──")
if not skip("J"):
    # J1 SEARCH/INGEST: sincronización con la fuente oficial SECOP II
    r = S.post(f"{BASE}/api/secop/sync", json={"days": 45, "limit": 300}, timeout=240)
    d = r.json()
    check("J1 SEARCH/INGEST POST /api/secop/sync ok", r.status_code == 200 and d.get("ok") is True and d.get("fetched", 0) > 0,
          f"fetched={d.get('fetched')} created={d.get('processesCreated')} changes={d.get('changes')} opps+={d.get('opportunitiesCreated')} pages={d.get('pages')}")

    # J2 DEDUP: segundo sync inmediato → idempotente (0 nuevos)
    r = S.post(f"{BASE}/api/secop/sync", json={"days": 45, "limit": 300}, timeout=240)
    d2 = r.json()
    check("J2 DEDUP segundo sync → processesCreated 0", r.status_code == 200 and d2.get("ok") is True and d2.get("processesCreated") == 0,
          f"created={d2.get('processesCreated')} updated={d2.get('processesUpdated')} fetched={d2.get('fetched')}")

    # J3 DOCUMENT ANALYSIS: mini pliego .txt (fixture del audit 7c; se regenera si falta)
    fixture = "/home/z/my-project/scripts/audit_7c_mini_pliego.txt"
    if not os.path.exists(fixture):
        subprocess.run(["python3", "/home/z/my-project/scripts/make_test_files.py"], capture_output=True, timeout=120)
    if os.path.exists(fixture):
        with open(fixture, "rb") as f:
            r = S.post(f"{BASE}/api/media/analyze", files={"file": ("audit_7c_mini_pliego.txt", f, "text/plain")},
                       data={"note": "analiza el documento"}, timeout=300)
        d = r.json()
        check("J3 DOCUMENT ANALYSIS /api/media/analyze (.txt mini pliego)", r.status_code == 200 and d.get("ok") is True,
              (d.get("reply") or r.text)[:140].replace("\n", " "))
    else:
        check("J3 DOCUMENT ANALYSIS /api/media/analyze (.txt mini pliego)", False, "fixture inexistente y no regenerable")

    # J4 REQUIREMENTS: análisis de una oportunidad compatible no consumida por otras fases
    opps = list_opportunities()
    jop = next((o for o in opps if o["id"] not in USED_OPPS and o.get("status") not in ("DESCARTADA", "APROBADA_PREPARACION")), None) \
        or next((o for o in opps if o.get("status") not in ("DESCARTADA",)), None)
    if jop:
        jid = jop["id"]
        USED_OPPS.append(jid)
        r = S.post(f"{BASE}/api/opportunities/{jid}/analyze", json={}, timeout=300)
        d = r.json()
        check("J4 REQUIREMENTS analyze de oportunidad → matriz con requisitos", r.status_code == 200 and (d.get("evidences", 0) >= 1),
              f"opp={jid} engine={d.get('analysisEngine') if isinstance(d, dict) else '?'} evidences={d.get('evidences') if isinstance(d, dict) else '?'}")

        # J5 EVIDENCE: evidencias con provenanceJson no vacío
        det = detail_opportunity(jid)
        evids = det.get("evidences") or []
        con_prov = [e for e in evids if (e.get("provenanceJson") or "").strip()]
        check("J5 EVIDENCE evidences>0 con provenanceJson", len(evids) > 0 and len(con_prov) > 0,
              f"evidencias={len(evids)} con_provenance={len(con_prov)} ejemplo={json.loads(con_prov[0]['provenanceJson']).get('method') if con_prov else '—'}")

        # J6 COMPATIBILITY: score > 0 y 7 dimensiones explicables en el detalle
        score = det.get("score", 0)
        dims = det.get("reasons") or []
        check("J6 COMPATIBILITY score>0 con 7 dimensiones", score > 0 and len(dims) == 7,
              f"score={score} dims={[x.get('key') for x in dims]}")

        # J7 APPROVAL: APROBADA_PREPARACION → propuesta → aprobar con snapshot (422 → force+notes)
        r = S.post(f"{BASE}/api/opportunities/{jid}/status", json={"status": "APROBADA_PREPARACION"}, timeout=60)
        borrador = next((p for p in (det.get("proposals") or []) if p.get("status") == "BORRADOR"), None)
        if borrador is None:
            r = S.post(f"{BASE}/api/proposals/generate", json={"opportunityId": jid}, timeout=400)
            borrador = (r.json() or {}).get("proposal") if r.status_code == 200 else None
        if borrador:
            code, body = approve_proposal(borrador["id"])
            snap = body.get("snapshot") or {}
            check("J7 APPROVAL approve con snapshot (422→force auditado)", code == 200 and bool(snap),
                  f"pid={borrador['id']} http={code} snapshot={list(snap.keys()) if snap else '—'} executionId={body.get('executionId')}")
            jpid = borrador["id"]
        else:
            check("J7 APPROVAL approve con snapshot (422→force auditado)", False, "sin propuesta BORRADOR para aprobar")
            jpid = None

        # J8 OUTPUT: export .docx >10KB + MCP tools/call get_opportunity
        if jpid:
            r = S.get(f"{BASE}/api/proposals/{jpid}/export", timeout=120)
            ct = r.headers.get("Content-Type", "")
            check("J8 OUTPUT export .docx >10KB", r.status_code == 200 and "wordprocessingml" in ct and len(r.content) > 10000,
                  f"{len(r.content)} bytes, {ct[:60]}")
        else:
            check("J8 OUTPUT export .docx >10KB", False, "sin proposal id")

        r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 90, "method": "tools/call",
                                            "params": {"name": "get_opportunity", "arguments": {"opportunityId": jid}}}, timeout=60)
        d = r.json()
        sc = d.get("result", {}).get("structuredContent") or {}
        check("J8 OUTPUT MCP tools/call get_opportunity", r.status_code == 200 and sc.get("opportunityId") == jid,
              f"estado={sc.get('estado')} compatibilidad={sc.get('compatibilidad')} requisitos={len(sc.get('matriz_requisitos') or [])}")
    else:
        for name in ["J4 REQUIREMENTS analyze de oportunidad → matriz con requisitos",
                     "J5 EVIDENCE evidences>0 con provenanceJson",
                     "J6 COMPATIBILITY score>0 con 7 dimensiones",
                     "J7 APPROVAL approve con snapshot (422→force auditado)",
                     "J8 OUTPUT export .docx >10KB",
                     "J8 OUTPUT MCP tools/call get_opportunity"]:
            check(name, False, "sin oportunidad candidata")

# ════ Resumen ════════════════════════════════════════════════
print("\n════ RESUMEN E2E ════")
fails = [x for x in results if x[1] == "FAIL"]
for name, status, detail in results:
    print(f"  {status}  {name}")
print(f"\n{len(results) - len(fails)}/{len(results)} pruebas OK")
sys.exit(1 if fails else 0)

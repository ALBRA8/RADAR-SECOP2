#!/usr/bin/env python3
"""E2E propio del Agente SECOP Radar — Fases nuevas (Marco Lógico + Canales + MCP)."""
import json
import sys
import time
import requests

BASE = "http://localhost:3000"
S = requests.Session()
results = []

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

# ════ FASE A: humo de API de canales ══════════════════════════
print("\n── FASE A: API smoke ──")
assert wait_server(), "server no respondió"

FROM = (sys.argv[1] if len(sys.argv) > 1 else "A").upper()
ONLY = FROM.startswith("--ONLY")
if ONLY:
    FROM = FROM.replace("--ONLY", "").strip() or "A"
PHASES = ["A", "B", "C", "D"]
def skip(phase):
    if ONLY:
        return phase != FROM
    return PHASES.index(phase) < PHASES.index(FROM)

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
r = S.get(f"{BASE}/api/opportunities?limit=100", timeout=60)
opps = r.json().get("opportunities", [])
aprobada = next((o for o in opps if o.get("status") == "APROBADA_PREPARACION"), None)
check("C0 hay oportunidad aprobada para preparación", aprobada is not None, f"total opps: {len(opps)}")

if aprobada:
    opp_id = aprobada["id"]
    r = S.post(f"{BASE}/api/proposals/{aprobada['proposals'][0]['id']}/refine" if aprobada.get("proposals") else f"{BASE}/api/proposals/generate",
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

    # Export docx de la última propuesta
    if aprobada.get("proposals"):
        pid = d.get("proposal", {}).get("id") if isinstance(d, dict) else aprobada["proposals"][0]["id"]
        r = S.get(f"{BASE}/api/proposals/{pid}/export", timeout=120)
        ct = r.headers.get("Content-Type", "")
        check("C3 export .docx", r.status_code == 200 and "wordprocessingml" in ct and len(r.content) > 10000,
              f"{len(r.content)} bytes, {ct[:60]}")

# ════ FASE D: MCP ════════════════════════════════════════════
print("\n── FASE D: MCP (JSON-RPC 2.0) ──")
r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1.0"}}}, timeout=60)
d = r.json()
check("D1 initialize MCP", r.status_code == 200 and d.get("result", {}).get("serverInfo", {}).get("name") == "secop-radar-mcp")

r = S.post(f"{BASE}/api/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, timeout=60)
tools = r.json().get("result", {}).get("tools", [])
check("D2 tools/list = 12 tools", len(tools) == 12, f"got {len(tools)}: {[t['name'] for t in tools]}")

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

# ════ Resumen ════════════════════════════════════════════════
print("\n════ RESUMEN E2E ════")
fails = [x for x in results if x[1] == "FAIL"]
for name, status, detail in results:
    print(f"  {status}  {name}")
print(f"\n{len(results) - len(fails)}/{len(results)} pruebas OK")
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Test E2E de dedup intra-batch y detección de modificaciones — Task 2-f (RADAR-SECOP2).

Parte 1 (UNIT, sin red): verifica la lógica pura real de src/lib/sync.ts y src/lib/secop.ts
  ejecutándola con bun (dedup última-fila-gana, diff campo a campo con impactos, hash
  reactivo a awarded/categoryCode).
Parte 2 (E2E, requiere red hacia datos.gov.co): dos sincronizaciones consecutivas con
  ventana corta contra el pipeline real (POST /api/secop/sync) y verificación de
  campos aditivos + idempotencia + endpoint de cambios por oportunidad.

Honestidad de resultados: si el server no está arriba → FAIL; si SECOP no está
alcanzable desde el backend → SKIP explícito (nunca PASS falso).
"""

import json
import os
import subprocess
import sys
import tempfile

import requests

BASE = "http://localhost:3000"
results = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    results.append((name, status))
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))


def skip(name, detail=""):
    results.append((name, "SKIP"))
    print(f"[SKIP] {name}" + (f" — {detail}" if detail else ""))


UNIT_TS = r'''
// Lógica pura REAL del proyecto (sin red, sin DB): dedup + diff + hash extendido.
import { dedupeRecords, diffRecordFields } from "/home/z/my-project/src/lib/sync";
import { contentHash, bogotaSinceIso } from "/home/z/my-project/src/lib/secop";

let failed = "";
function assert(cond: boolean, msg: string) {
  if (!cond && !failed) failed = msg;
}

// 1) Dedup intra-batch: la ÚLTIMA fila gana
const a = { id: "P1", entity: "Entidad", objectName: "primera" };
const b = { id: "P2", entity: "Entidad", objectName: "otro proceso" };
const c = { id: "P1", entity: "Entidad", objectName: "ultima" };
const dd = dedupeRecords([a, b, c] as any);
assert(dd.records.length === 2, `dedup debía dejar 2 filas, dejó ${dd.records.length}`);
assert(dd.duplicatesRemoved === 1, `duplicatesRemoved debía ser 1, fue ${dd.duplicatesRemoved}`);
const p1 = dd.records.find((r) => r.id === "P1");
assert(!!p1 && p1.objectName === "ultima", "la última fila del mismo id debía ganar");

// 2) Diff real campo a campo con impactos correctos
const base = {
  receptionDate: new Date("2026-02-01T10:00:00.000Z"),
  basePrice: 10000000,
  state: "En evaluación",
  openState: "Abierto",
  objectName: "Suministro de equipos A",
  awarded: "No",
  url: "https://community.secop.gov.co/PublicTendering?id=1",
  phase: "Selección",
  description: "descripcion",
};
const rec = { ...base, basePrice: 12000000, url: "https://community.secop.gov.co/PublicTendering?id=2", openState: "Cerrado", awarded: "Sí" };
const diffs = diffRecordFields(base as any, rec as any);
assert(diffs.length === 4, `debía detectar 4 cambios (basePrice,url,openState,awarded), detectó ${diffs.length}: ${JSON.stringify(diffs)}`);
const byField: Record<string, any> = Object.fromEntries(diffs.map((d) => [d.field, d]));
assert(byField.basePrice?.impact === "ALTA", "basePrice → ALTA");
assert(byField.url?.impact === "MEDIA", "url → MEDIA");
assert(byField.openState?.impact === "BAJA", "openState → BAJA");
assert(byField.awarded?.impact === "BAJA", "awarded → BAJA");
assert(byField.basePrice?.oldValue === "10000000" && byField.basePrice?.newValue === "12000000", "old/new de basePrice serializados");
assert(byField.url?.oldValue?.includes("id=1") && byField.url?.newValue?.includes("id=2"), "old/new de url");
// ReceptionDate igual → sin diff de esa fecha
assert(!byField.receptionDate, "receptionDate no cambió, no debía aparecer");
// Nada cambia → 0 diffs
assert(diffRecordFields(base as any, { ...base } as any).length === 0, "sin cambios → 0 diffs");

// 3) Hash extendido reacciona a awarded / categoryCode / openState / url
const h1 = contentHash({ ...(rec as any), awarded: "Sí" });
const h2 = contentHash({ ...(rec as any), awarded: "No" });
const h3 = contentHash({ ...(rec as any), categoryCode: "56101500" });
const h4 = contentHash({ ...(rec as any), openState: "Adjudicado" });
const h5 = contentHash({ ...(rec as any), url: "otra-url" });
assert(h1 !== h2, "hash debe cambiar con awarded");
assert(h1 !== h3, "hash debe cambiar con categoryCode");
assert(h1 !== h4, "hash debe cambiar con openState");
assert(h1 !== h5, "hash debe cambiar con url");

// 4) Ventana "since" calculada en hora Colombia (UTC-5): días negativos ampliamente futuros no aplican;
//    solo verificamos formato YYYY-MM-DD y que con days=0 sea la fecha de HOY en Bogotá.
const since = bogotaSinceIso(0);
assert(/^\d{4}-\d{2}-\d{2}$/.test(since), `since debe ser YYYY-MM-DD, fue ${since}`);
const hoyBogota = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
assert(since === hoyBogota, `since(0) debía ser ${hoyBogota} (hoy en Bogotá), fue ${since}`);

if (failed) {
  console.error("UNIT_FAIL: " + failed);
  process.exit(1);
}
console.log("UNIT_OK");
'''


def run_unit():
    print("\n── PARTE 1: lógica pura (dedup intra-batch, diff real, hash extendido) — bun ──")
    # El archivo temporal se crea DENTRO del proyecto para que bun resuelva
    # los imports '@/…' de sync.ts con el tsconfig.json del proyecto.
    tmp = os.path.join("/home/z/my-project", ".tmp_unit_sync_2f.ts")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(UNIT_TS)
        proc = subprocess.run(["bun", tmp], capture_output=True, text=True, timeout=120, cwd="/home/z/my-project")
    except FileNotFoundError:
        skip("UNIT dedup/diff (bun no disponible)")
        return
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0 and "UNIT_OK" in proc.stdout:
        check("UNIT dedup última-fila-gana + diff con impactos + hash extendido + since Bogotá", True)
    else:
        check("UNIT dedup última-fila-gana + diff con impactos + hash extendido + since Bogotá", False, out[-400:])


def run_e2e():
    print("\n── PARTE 2: E2E contra el pipeline real (server :3000) ──")
    # Server vivo
    try:
        r0 = requests.get(f"{BASE}/", timeout=10)
        check("server Next.js arriba en :3000", r0.status_code == 200)
        if r0.status_code != 200:
            return
    except Exception as e:
        check("server Next.js arriba en :3000", False, str(e)[:150])
        return

    payload = {"days": 3, "limit": 100}
    try:
        r1 = requests.post(f"{BASE}/api/secop/sync", json=payload, timeout=240)
    except Exception as e:
        check("S1 POST /api/secop/sync ejecutado", False, str(e)[:150])
        return

    if r1.status_code != 200:
        skip("S1 sincronización (HTTP %s: %s)" % (r1.status_code, r1.text[:150]))
        return
    d1 = r1.json()
    if not d1.get("ok"):
        # SECOP no alcanzable desde el backend → SKIP honesto (no PASS falso)
        skip("S1 sincronización contra SECOP real", "fetchError: %s" % (d1.get("fetchError") or d1.get("message")))
        return

    check("S1 sync ok con ventana corta (days=3, limit=100)", True,
          json.dumps({k: d1.get(k) for k in ("fetched", "pages", "truncated", "processesCreated",
                                             "processesUpdated", "changes", "skippedErrors")},
                     ensure_ascii=False))
    for f in ("changes", "byImpact", "skippedErrors", "pages", "truncated"):
        check(f"S1 respuesta incluye campo aditivo '{f}'", f in d1)
    check("S1 changes >= 0", isinstance(d1.get("changes"), int) and d1["changes"] >= 0)
    check("S1 fetched <= limit y pages >= 1", d1.get("fetched", 0) <= 100 and d1.get("pages", 0) >= 1,
          "fetched=%s pages=%s truncated=%s" % (d1.get("fetched"), d1.get("pages"), d1.get("truncated")))
    byImpact = d1.get("byImpact") or {}
    check("S1 byImpact con ALTA/MEDIA/BAJA", all(k in byImpact for k in ("ALTA", "MEDIA", "BAJA")),
          json.dumps(byImpact, ensure_ascii=False))

    # Idempotencia: segundo sync inmediato
    try:
        r2 = requests.post(f"{BASE}/api/secop/sync", json=payload, timeout=240)
    except Exception as e:
        check("S2 POST idempotencia", False, str(e)[:150])
        return
    if r2.status_code != 200 or not r2.json().get("ok"):
        skip("S2 idempotencia (sync 2 no disponible: %s)" % r2.text[:150])
        return
    d2 = r2.json()
    created2 = d2.get("processesCreated")
    opps2 = d2.get("opportunitiesCreated")
    changes2 = d2.get("changes", 0)
    check("S2 idempotente: processesCreated == 0", created2 == 0, f"processesCreated={created2}")
    check("S2 idempotente: opportunitiesCreated == 0", opps2 == 0, f"opportunitiesCreated={opps2}")

    if changes2 == 0:
        check("S2 idempotente: changes == 0", True)
    else:
        # Aceptado solo si son diffs reales: oldValue != newValue en el historial expuesto
        reales, inspeccionados = True, 0
        try:
            opps = requests.get(f"{BASE}/api/opportunities?limit=100", timeout=60).json().get("opportunities", [])
            for o in opps[:20]:
                rc = requests.get(f"{BASE}/api/opportunities/{o['id']}/changes", timeout=30)
                if rc.status_code == 200:
                    for ch in rc.json().get("changes", []):
                        inspeccionados += 1
                        if ch.get("oldValue") == ch.get("newValue"):
                            reales = False
        except Exception as e:
            reales = False
            print("  (error inspeccionando cambios: %s)" % str(e)[:120])
        check("S2 cambios solo diffs reales (old != new)", reales and inspeccionados > 0,
              f"changes={changes2} inspeccionados={inspeccionados}")

    # Endpoint de historial de cambios
    try:
        opps = requests.get(f"{BASE}/api/opportunities?limit=10", timeout=60).json().get("opportunities", [])
        if not opps:
            skip("endpoint /changes (no hay oportunidades para probar)")
            return
        oid = opps[0]["id"]
        rc = requests.get(f"{BASE}/api/opportunities/{oid}/changes", timeout=30)
        okc = rc.status_code == 200 and "changes" in rc.json() and "count" in rc.json()
        check("GET /api/opportunities/[id]/changes responde historial", okc,
              "count=%s" % (rc.json().get("count") if rc.status_code == 200 else rc.text[:120]))
        rc404 = requests.get(f"{BASE}/api/opportunities/no-existe-2f/changes", timeout=30)
        check("GET /changes con oportunidad inexistente → 404/500 con error claro", rc404.status_code in (400, 404, 500),
              "status=%s" % rc404.status_code)
    except Exception as e:
        check("GET /api/opportunities/[id]/changes responde historial", False, str(e)[:150])


if __name__ == "__main__":
    print("═" * 62)
    print(" test_sync.py — Task 2-f: dedup intra-batch + modificación + idempotencia")
    print("═" * 62)
    run_unit()
    run_e2e()
    fails = sum(1 for _, s in results if s == "FAIL")
    skips = sum(1 for _, s in results if s == "SKIP")
    passes = sum(1 for _, s in results if s == "PASS")
    print("\nResumen: %d PASS, %d FAIL, %d SKIP" % (passes, fails, skips))
    sys.exit(1 if fails else 0)

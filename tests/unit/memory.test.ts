// ─── UNIT TESTS: MEMORYDV (Task 2-b, PROMPT 05 §13-14) — RADAR-SECOP2 ────────
// Usa la DB real del proyecto (db/custom.db) SOLO con registros de prueba con
// prefijo reservado "unit-test-" (key) / "UNIT-TEST-FOREIGN" (agentId ajeno).
// Limpieza total en afterAll: la DB es compartida — cero residuos.

import { describe, it, expect, afterAll } from "bun:test";
import {
  remember,
  recall,
  getById,
  list,
  remove,
  stats,
  MemoryValidationError,
  AGENT_ID,
  DOMAIN,
} from "@/lib/memory";
import { db } from "@/lib/db";

const RUN = `unit-test-${Date.now()}`; // único por corrida
const TOKEN = `zzqxunit${Date.now()}`; // token sin separadores: nunca coincide con datos reales
const TOKEN2 = `qqxyscore${Date.now()}`; // segundo token exclusivo para el test de scoring

afterAll(async () => {
  // Limpieza cuidadosa: solo filas creadas por esta suite.
  await db.memoryEntry
    .deleteMany({ where: { OR: [{ key: { startsWith: "unit-test-" } }, { agentId: "UNIT-TEST-FOREIGN" }] } })
    .catch(() => undefined);
});

describe("regla dura: FACTUAL exige evidenceIds (PROMPT 05 §14)", () => {
  it("rechaza FACTUAL sin evidencia", async () => {
    let msg = "";
    try {
      await remember({
        type: "FACTUAL",
        key: `${RUN}-factual-sin-ev`,
        content: "inferencia del LLM sin respaldo",
        confidence: 0.9,
      });
    } catch (err) {
      expect(err instanceof MemoryValidationError).toBe(true);
      msg = err instanceof Error ? err.message : "";
    }
    expect(msg).toContain("evidenceIds");
  });

  it("con allowDemote demueve a SEMANTIC dejando traza, jamás promueve a hecho", async () => {
    const dto = await remember({
      type: "FACTUAL",
      key: `${RUN}-factual-demote`,
      content: "inferencia demovible",
      allowDemote: true,
    });
    expect(dto.type).toBe("SEMANTIC");
    expect(dto.summary ?? "").toContain("DEMOVIDA");
  });

  it("acepta FACTUAL CON evidencia y la guarda", async () => {
    const dto = await remember({
      type: "FACTUAL",
      key: `${RUN}-factual-con-ev`,
      content: "hecho observado con respaldo",
      evidenceIds: ["unit-test-evidence-1"],
      truthLevel: "OBSERVED",
      confidence: 0.9,
    });
    expect(dto.type).toBe("FACTUAL");
    expect(dto.evidenceIds).toEqual(["unit-test-evidence-1"]);
    expect(dto.agentId).toBe(AGENT_ID);
    expect(dto.domain).toBe(DOMAIN);
  });
});

describe("aislamiento duro por agentId+domain (PROMPT 05 §13)", () => {
  it("rechaza ESCRIBIR en un agentId/domain foráneo", async () => {
    let msg = "";
    try {
      await remember({
        type: "SEMANTIC",
        key: `${RUN}-ajena`,
        content: "intento de escribir memoria ajena",
        agentId: "CRM-ALBRA",
        domain: "crm",
      });
    } catch (err) {
      expect(err instanceof MemoryValidationError).toBe(true);
      msg = err instanceof Error ? err.message : "";
    }
    expect(msg).toContain("Aislamiento");
  });

  it("no LEE memoria ajena: getById de otra identidad → null (404 honesto)", async () => {
    const foreign = await db.memoryEntry.create({
      data: {
        agentId: "UNIT-TEST-FOREIGN",
        domain: "crm",
        type: "SEMANTIC",
        key: `${RUN}-foreign`,
        content: "memoria de otro agente",
        truthLevel: "UNKNOWN",
        confidence: 0.5,
      },
    });
    try {
      expect(await getById(foreign.id)).toBeNull();
      expect(await remove(foreign.id)).toBe(false); // remove tampoco toca lo ajeno
      const all = await list({ limit: 100 });
      expect(all.some((e) => e.id === foreign.id)).toBe(false);
    } finally {
      await db.memoryEntry.delete({ where: { id: foreign.id } }).catch(() => undefined);
    }
  });

  it("recall SIEMPRE filtra por agentId+domain del RADAR", async () => {
    const foreign = await db.memoryEntry.create({
      data: {
        agentId: "UNIT-TEST-FOREIGN",
        domain: "crm",
        type: "SEMANTIC",
        key: `clave-con-${TOKEN}`,
        content: `contenido ajeno con ${TOKEN}`,
        truthLevel: "UNKNOWN",
        confidence: 0.5,
      },
    });
    const mine = await remember({
      type: "SEMANTIC",
      key: `${RUN}-recall`,
      content: `recuerdo propio con ${TOKEN}`,
      tags: [TOKEN],
      confidence: 0.9,
    });
    try {
      const hits = await recall(TOKEN, { limit: 10 });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.agentId).toBe(AGENT_ID);
        expect(h.domain).toBe(DOMAIN);
      }
      expect(hits.some((h) => h.id === foreign.id)).toBe(false);
      expect(hits.some((h) => h.id === mine.id)).toBe(true);
    } finally {
      await db.memoryEntry.delete({ where: { id: foreign.id } }).catch(() => undefined);
    }
  });
});

describe("recall(): scoring básico y refresco por uso", () => {
  it("coincidencia produce score > 0, ordenado, y accessCount/lastAccessAt se refrescan", async () => {
    const before = await stats();
    const mine = await remember({
      type: "SEMANTIC",
      key: `${RUN}-scoring`,
      content: `contenido searchable con ${TOKEN2}`,
      confidence: 0.9,
    });
    const hits = await recall(TOKEN2, { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    const top = hits[0];
    expect(top.id).toBe(mine.id);
    expect(top.score).toBeGreaterThan(0);
    expect(top.accessCount).toBe(1); // 0 + 1 por este recall
    expect(top.lastAccessAt).not.toBeNull();
    // scores ordenados desc
    for (let i = 1; i < hits.length; i++) {
      expect((hits[i - 1].score ?? 0) >= (hits[i].score ?? 0)).toBe(true);
    }
    const after = await stats();
    expect(after.total).toBe(before.total + 1);
  });

  it("query sin coincidencias → lista vacía (no inventa)", async () => {
    // Token único SIN separadores (tokenize corta por -,_ / espacio): garantizado sin match.
    const hits = await recall(`qxqnada${Date.now()}zzqx`, { limit: 5 });
    expect(hits).toEqual([]);
  });

  it("type inválido en recall → validación honesta", async () => {
    let rejected = false;
    try {
      await recall(TOKEN, { type: "TELEPATICO" });
    } catch (err) {
      rejected = err instanceof MemoryValidationError;
    }
    expect(rejected).toBe(true);
  });
});

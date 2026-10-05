#!/usr/bin/env python3
"""Genera archivos de prueba para el E2E multimodal del Agente SECOP Radar:
- pliego_prueba.pdf (pliego de condiciones con marco lógico exigido)
- nota_voz.mp3 (nota de voz TTS en español preguntando por oportunidades)
- foto_contrato.png se toma de scripts/verify_01_dashboard.png (imagen real ya existente)
"""
import os

OUT = "/home/z/my-project/scripts"

# ── 1. Pliego PDF ─────────────────────────────────────────────
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas

pdf_path = os.path.join(OUT, "pliego_prueba.pdf")
c = canvas.Canvas(pdf_path, pagesize=letter)
w, h = letter
y = h - 2 * cm

def line(text, bold=False, size=11):
    global y
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(2 * cm, y, text)
    y -= 0.7 * cm if size >= 11 else 0.55 * cm

line("MUNICIPIO DE BARRANQUILLA - SECRETARIA DE INFRAESTRUCTURA", bold=True, size=13)
line("PLIEGO DE CONDICIONES DEFINITIVO", bold=True, size=12)
line("Proceso CP-2026-045: Suministro e instalacion de mobiliario urbano", size=11)
y -= 0.4 * cm
line("1. OBJETO", bold=True)
line("El Municipio requiere la suministro, transporte e instalacion de 450 modulos de", size=10)
line("mobiliario urbano para parques del suroccidente, incluyendo garantias y repuestos.", size=10)
line("2. PRESUPUESTO OFICIAL", bold=True)
line("Valor estimado: $1.480.000.000 COP (impuestos incluidos).", size=10)
line("3. PLAZOS", bold=True)
line("Plazo de ejecucion: 6 meses contados desde el acta de inicio. Fecha limite de", size=10)
line("entrega de ofertas: 30 de octubre de 2026, 4:00 p.m. hora local.", size=10)
line("4. REQUISITOS HABILITANTES", bold=True)
line("a) Experiencia general: al menos 2 contratos de suministro de mobiliario en los", size=10)
line("   ultimos 8 anos, por valores superiores a $400.000.000 COP cada uno.", size=10)
line("b) Capacidad financiera: indice de liquidez no inferior a 1.10.", size=10)
line("c) RUP vigente en Actividad 3 (Adquisicion y suministro de bienes muebles).", size=10)
line("d) Declaracion juramentada de no encontrarse en causales de inhabilidad.", size=10)
line("5. GARANTIAS", bold=True)
line("Seriedad de la propuesta: 3% del valor ofertado. Cumplimiento: 10% del valor del", size=10)
line("contrato. Calidad del producto: 5% del valor facturado por 24 meses.", size=10)
line("6. CRITERIOS DE EVALUACION", bold=True)
line("Ponderacion: Oferta tecnica 45%, Oferta economica 40%, Experiencia 15%.", size=10)
line("7. MARCO LOGICO (OBLIGATORIO)", bold=True)
line("El oferente debe presentar la Matriz de Marco Logico del proyecto: arbol de", size=10)
line("problemas, arbol de objetivos y matriz Fin-Proposito-Componentes-Actividades", size=10)
line("con indicadores verificables, medios de verificacion y supuestos. La ausencia", size=10)
line("de este documento generara rechazo de la oferta tecnica.", size=10)
c.save()
print(f"OK {pdf_path}")

# ── 2. Nota de voz (TTS) ──────────────────────────────────────
import subprocess
voice_path = os.path.join(OUT, "nota_voz.mp3")
texto = "Hola agente. Soy Pacho. Que oportunidades nuevas hay esta semana para la empresa, y que requisitos tiene la del jardin botanico? Es para saber si vale la pena participar."
res = subprocess.run(["z-ai", "tts", "-i", texto, "-o", voice_path], capture_output=True, text=True, timeout=120)
if os.path.exists(voice_path) and os.path.getsize(voice_path) > 1000:
    print(f"OK {voice_path} ({os.path.getsize(voice_path)} bytes)")
else:
    print("TTS fallo:", res.stdout[-300:], res.stderr[-300:])

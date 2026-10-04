#!/usr/bin/env python3
"""Siembra la empresa demo del MVP SECOP Radar vía la API del proyecto."""
import json
import urllib.request

BASE = "http://localhost:3000/api"


def call(path: str, method: str = "GET", body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode())


def main():
    # ¿Ya existe empresa?
    current = call("/company")
    if current.get("company"):
        print(f"Empresa ya registrada: {current['company']['name']} — no se duplica")
        return

    # 1. Empresa demo (perfil Módulo C)
    company = call("/company", "POST", {
        "name": "Suministros y Servicios Logísticos Andina SAS",
        "nit": "901.452.789-1",
        "description": "Empresa de servicios generales especializada en aseo y limpieza de instalaciones, dotación y suministros de oficina, y logística ligera de mercancías.",
        "city": "Bogotá",
        "department": "Distrito Capital de Bogotá",
        "minBudget": 5000000,
        "maxBudget": 20000000,
        "departmentsAllowed": ["Distrito Capital de Bogotá", "Cundinamarca"],
        "modalitiesAllowed": ["Contratación directa", "Selección Abreviada", "Mínima cuantía"],
        "contractTypesAllowed": ["Prestación de servicios", "Suministros", "Compra y venta de bienes"],
        "phasesAllowed": ["Presentación de oferta", "Selección"],
        "requireKeywordHit": False,
        "capacity": "Hasta 3 contratos simultáneos en el rango configurado, equipo operativo de 15 personas y cobertura en Bogotá y municipios cercanos de Cundinamarca.",
        "approverName": "Gerencia Comercial — Ana María Restrepo",
    })
    cid = company["company"]["id"]
    print(f"Empresa creada: {cid}")

    # 2. Productos y servicios
    products = [
        {"name": "Aseo y limpieza de instalaciones", "description": "Servicios de aseo, desinfección y manejo de residuos para edificios e instituciones.", "keywords": ["aseo", "limpieza", "sanitización", "desinfección", "residuos", "mantenimiento de aseo"]},
        {"name": "Dotación y suministros de oficina", "description": "Suministro de papelería, útiles de oficina y elementos de dotación para el personal.", "keywords": ["dotación", "suministros", "papelería", "útiles de oficina", "adquisición de elementos"]},
        {"name": "Logística y distribución ligera", "description": "Transporte y distribución de mercancías de bajo volumen dentro del área metropolitana.", "keywords": ["transporte", "distribución", "logística", "almacenamiento", "mensajería"]},
    ]
    for p in products:
        call("/company/items", "POST", {"companyId": cid, "kind": "product", **p})
    print(f"Productos creados: {len(products)}")

    # 3. Experiencia comprobada
    experience = [
        {"title": "Servicio de aseo institucional sede administrativa", "entity": "Institución Educativa Distrital — Bogotá", "year": 2024, "value": 18600000, "description": "Aseo general de 2 sedes, 10 meses, con cuadrilla de 6 personas."},
        {"title": "Suministro de papelería y útiles de oficina", "entity": "Congregación Religiosa — Bogotá", "year": 2023, "value": 9500000, "description": "Suministro mensual de papelería y útiles bajo pedido consolidado."},
    ]
    for e in experience:
        call("/company/items", "POST", {"companyId": cid, "kind": "experience", **e})
    print(f"Experiencias creadas: {len(experience)}")

    # 4. Documentos corporativos (algunos pendientes para generar alertas)
    documents = [
        {"name": "RUT vigente", "docType": "Jurídico", "status": "DISPONIBLE"},
        {"name": "Certificado de existencia y representación legal", "docType": "Jurídico", "status": "DISPONIBLE"},
        {"name": "RUP — Registro Único de Proponentes", "docType": "Jurídico", "status": "DISPONIBLE"},
        {"name": "Estados financieros certificados", "docType": "Financiero", "status": "PENDIENTE"},
        {"name": "Certificación bancaria", "docType": "Financiero", "status": "PENDIENTE"},
        {"name": "Póliza de responsabilidad civil", "docType": "Garantías", "status": "VENCIDO"},
    ]
    for d in documents:
        call("/company/items", "POST", {"companyId": cid, "kind": "document", **d})
    print(f"Documentos creados: {len(documents)}")

    print("Siembra completa.")


if __name__ == "__main__":
    main()

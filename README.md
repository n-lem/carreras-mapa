# carreras-unpaz
Mapa de correlatividades para carreras UNPAZ.

## Características principales

- Validación estricta de correlatividades (`Regular` y `Aprobada`).
- Persistencia con `localStorage` versionada y migración automática.
- Exportar/importar progreso por carrera (`JSON`).
- Click en cuatrimestre con ciclo rápido de estados para todas sus materias.
- Resaltado de camino de correlativas al pasar/focar una materia.
- Si intentás activar una materia bloqueada, se resaltan sus correlativas faltantes hasta hacer clic fuera.
- Panel flotante de progreso con:
  - nombre de carrera
  - contadores `Pendiente/Regular/Aprobada`
  - acceso rápido a `Herramientas` y `Reiniciar progreso`
- Exportación del mapa a PNG desde `Herramientas -> Guardar como PNG`.
- Modo impresión en claro.
- Catálogo dinámico de carreras (`data/planes/catalog.json`).
- Selector de vistas: `Diagrama`, `Lista`, `Programas`, `Enlaces`.
- En `Programas` se listan materias por cuatrimestre y cada una puede tener link a su PDF/programa.
- En `Enlaces` se muestran links útiles de la carrera (si no hay metadata, se muestran ejemplos por defecto).

## Catálogo incluido en el repo

El `catalog.json` del repositorio está preparado con 3 carreras de ejemplo:

- Licenciatura en Gestión de Tecnologías de la Información
- Ingeniería en Informática
- Licenciatura en Producción y Desarrollo de Videojuegos

Nota para despliegue (GitHub Pages/Vercel/Netlify):
- Estos 7 archivos deben estar versionados en Git para que la web no caiga en `Demo mínima`:
  - `data/planes/catalog.json`
  - `data/planes/ingenieria-en-informatica.json`
  - `data/planes/ingenieria-en-informatica.materias.json`
  - `data/planes/licenciatura-en-gestion-de-tecnologias-de-la-informacion.json`
  - `data/planes/licenciatura-en-gestion-de-tecnologias-de-la-informacion.materias.json`
  - `data/planes/licenciatura-en-produccion-y-desarrollo-de-videojuegos.json`
  - `data/planes/licenciatura-en-produccion-y-desarrollo-de-videojuegos.materias.json`

## Estructura principal del proyecto

```text
index.html
assets/
  css/
    style.css
  js/
    core.js
    script.js
  vendor/
    html2canvas.min.js
data/
  planes/
tools/
tests/
```

- `index.html`: punto de entrada; layout base, CSP y carga de assets.
- `assets/css/style.css`: estilos globales, layout responsive, estados visuales, print.
- `assets/js/core.js`: reglas de dominio puras (validación de esquema, correlatividades, normalización).
- `assets/js/script.js`: UI, render, eventos, almacenamiento local, import/export, onboarding y vistas.
- `assets/vendor/html2canvas.min.js`: dependencia local para exportar PNG (sin CDN).
- `data/planes/*.materias.json`: materias consumidas por la UI.
- `data/planes/*.json`: metadata por carrera (hitos, programas, enlaces).
- `data/planes/catalog.json`: carreras disponibles en el selector.
- `tools/pdf_to_plan_json.py`: generación de JSON desde PDFs.
- `tests/`: pruebas de reglas y E2E.

## Flujo para agregar carreras desde PDF

1. Copiar PDFs a `data/pdfs/`.
2. Instalar dependencias Python:

```bash
python -m pip install -r tools/requirements.txt
```

3. Ejecutar parser + limpieza automática de JSON obsoletos:

```bash
python tools/pdf_to_plan_json.py --input "data/pdfs" --output "data/planes" --split "1:5,2:5,3:4,4:5,5:5" --prune --verbose
```

4. Levantar la web con Live Server o servidor estático.

## Uso rápido de la UI

- `1 clic` en materia: `Pendiente -> Regular`.
- `2 clics`: `Regular -> Aprobada`.
- `3 clics`: `Aprobada -> Pendiente` (si no rompe dependencias).
- Click en el título del cuatrimestre: ciclo rápido sobre el bloque.
- `Herramientas` (ícono engranaje en panel flotante):
  - cambiar tema claro/oscuro
  - exportar progreso
  - importar progreso
  - imprimir en modo claro

## Testing

Instalar dependencias JS:

```bash
npm install
```

Tests de reglas de negocio:

```bash
npm run test:rules
```

Tests E2E responsive (Playwright):

```bash
npx playwright install chromium
npm run test:e2e
```

## Seguridad

- `assets/js/core.js` valida schema de materias/metadata antes de usar datos.
- `assets/js/script.js` valida catálogo y rechaza estructuras inválidas.
- Dependencia de PNG (`html2canvas`) vendorizada en `assets/vendor/` para evitar carga remota de scripts.
- Importación de progreso endurecida:
  - acepta solo JSON (por extensión/tipo)
  - límite de tamaño (`1 MB`)
  - validación estricta de estructura (`progress` debe ser objeto)
- Carga de planes/catalog restringida a `same-origin` y archivos `.json`.
- CSP y headers de seguridad:
  - `index.html` incluye CSP por `meta` para entornos simples.
  - `_headers` para Netlify.
  - `vercel.json` para Vercel.

## Estructura de archivos de planes

Por carrera:
- `<slug>.json`: metadata + hitos.
- `<slug>.materias.json`: materias para la UI.
  - En metadata también podés definir:
    - `programas` o `programas_por_materia` (links por materia)
    - `programas_base_url` (base para autogenerar `<id>.pdf`)
    - `enlaces` o `links` (sitios de interés)
    - `programasOcultarNoDisponibles` (`true/false`)

Global:
- `catalog.json`: lista de carreras disponibles en el selector.

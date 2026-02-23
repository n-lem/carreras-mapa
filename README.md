# carreras-unpaz
Mapa de correlatividades para carreras UNPAZ.

## Características principales

- Validación estricta de correlatividades (`Regular` y `Aprobada`).
- Persistencia con `localStorage` versionada y migración automática.
- Exportar/importar progreso por carrera (`JSON`).
- Acciones masivas por cuatrimestre (`Regular`, `Aprobada`, `Pendiente`, `Ciclo`).
- Resaltado visual de materias bloqueadas en acciones masivas.
- Catálogo dinámico de carreras (`data/planes/catalog.json`).

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

- `core.js` valida schema de materias/metadata antes de usar datos.
- `script.js` valida catálogo y rechaza estructuras inválidas.
- CSP y headers de seguridad:
  - `index.html` incluye CSP por `meta` para entornos simples.
  - `_headers` para Netlify.
  - `vercel.json` para Vercel.

## Estructura de archivos de planes

Por carrera:
- `<slug>.json`: metadata + hitos.
- `<slug>.materias.json`: materias para la UI.

Global:
- `catalog.json`: lista de carreras disponibles en el selector.

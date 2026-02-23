/**
 * Mapa de Correlatividades – UNPAZ
 * Vanilla JS (ES6+) | LocalStorage | SVG arrows
 *
 * States:
 *   0 – Pendiente  (gray)
 *   1 – Regular    (yellow)  → cursada aprobada, final pendiente
 *   2 – Aprobada   (green)   → final aprobado
 */

// ── Course data ────────────────────────────────────────────────────────────────
// Agrega o modifica materias aquí. 'correlativas' es un array de IDs.
const MATERIAS = [
  /* Primer año */
  { "id": "6001", "nombre": "Análisis Matemático I", "correlativas": [] },
  { "id": "6002", "nombre": "Arquitectura de Computadoras I", "correlativas": [] },
  { "id": "6003", "nombre": "Introducción a la Programación", "correlativas": [] },
  { "id": "6004", "nombre": "Estructuras Discretas", "correlativas": [] },
  { "id": "6005", "nombre": "Ciencia, Tecnología y Sociedad", "correlativas": [] },
  { "id": "6006", "nombre": "Análisis Matemático II", "correlativas": ["6001"] },
  { "id": "6007", "nombre": "Álgebra y Geometría Analítica", "correlativas": ["6001"] },
  { "id": "6008", "nombre": "Algoritmos y Programación", "correlativas": ["6003", "6004"] },
  { "id": "6009", "nombre": "Arquitectura de Computadoras II", "correlativas": ["6002", "6005"] },
  { "id": "6010", "nombre": "Inglés I", "correlativas": ["6005"] },
  /* Segundo año */
  { "id": "6011", "nombre": "Sistemas Operativos I", "correlativas": ["6002", "6010"] },
  { "id": "6012", "nombre": "Economía General", "correlativas": ["6001"] },
  { "id": "6013", "nombre": "Inglés II", "correlativas": ["6010"] },
  { "id": "6014", "nombre": "Ingeniería de Software I", "correlativas": ["6003", "6004", "6005"] },
  { "id": "6015", "nombre": "Paradigmas de Programación", "correlativas": ["6003"] },
  { "id": "6016", "nombre": "Sistemas Operativos II", "correlativas": ["6011"] },
  { "id": "6017", "nombre": "Laboratorio de Programación y Lenguajes", "correlativas": ["6015"] },
  { "id": "6018", "nombre": "Programación Orientada a Objetos", "correlativas": ["6008"] },
  { "id": "6019", "nombre": "Base de Datos I", "correlativas": ["6004", "6007"] },
  { "id": "6020", "nombre": "Administración I", "correlativas": [] },
  /* Tercer año */
  { "id": "6021", "nombre": "Probabilidad y Estadísticas", "correlativas": ["6006", "6007"] },
  { "id": "6022", "nombre": "Comunicaciones y Redes", "correlativas": ["6004", "6011"] },
  { "id": "6023", "nombre": "Ingeniería de Software II", "correlativas": ["6014"] },
  { "id": "6024", "nombre": "Administración II", "correlativas": ["6020"] },
  { "id": "6025", "nombre": "Laboratorio de Software", "correlativas": ["6014", "6018", "6019"] },
  { "id": "6026", "nombre": "Base de Datos II", "correlativas": ["6019"] },
  { "id": "6027", "nombre": "Contabilidad I", "correlativas": ["6020"] },
  { "id": "6028", "nombre": "Trabajo de Campo", "correlativas": ["6018", "6022", "6023"] },
  /* Cuarto año */
  { "id": "6029", "nombre": "Investigación Operativa", "correlativas": ["6021"] },
  { "id": "6030", "nombre": "Arquitectura Web", "correlativas": ["6022"] },
  { "id": "6031", "nombre": "Seguridad Informática", "correlativas": ["6017", "6018", "6022", "6023"] },
  { "id": "6032", "nombre": "Administración de Recursos Humanos", "correlativas": ["6020", "6024"] },
  { "id": "6033", "nombre": "Contabilidad Avanzada", "correlativas": ["6027"] },
  { "id": "6034", "nombre": "Sistemas Inteligentes", "correlativas": ["6021", "6023"] },
  { "id": "6035", "nombre": "Gestión de la Tecnología", "correlativas": ["6022", "6023"] },
  { "id": "6036", "nombre": "Comercialización", "correlativas": ["6020", "6024"] },
  { "id": "6037", "nombre": "Planificación Financiera y Proyecto de Inversión", "correlativas": ["6006", "6012", "6020", "6027"] },
  { "id": "6038", "nombre": "Optativa I", "correlativas": [] },
  /* Quinto año */
  { "id": "6039", "nombre": "Gestión de Proyectos", "correlativas": ["6012", "6021"] },
  { "id": "6040", "nombre": "Inteligencia de los Negocios", "correlativas": ["6023", "6029"] },
  { "id": "6041", "nombre": "Optativa II", "correlativas": ["6023", "6025", "6026"] },
  { "id": "6042", "nombre": "Dirección Estratégica", "correlativas": ["6036"] },
  { "id": "6043", "nombre": "Trabajo Final de Grado", "correlativas": [] }
];

// ── State keys ─────────────────────────────────────────────────────────────────
const STORAGE_KEY   = "unpaz_progress";
const STATE_LABELS  = ["Pendiente", "Regular", "Aprobada"];
const STATE_CLASSES = ["", "state-1", "state-2"];

// ── Runtime state ──────────────────────────────────────────────────────────────
/** @type {Object.<string, number>} maps materia id → 0|1|2 */
let progress = {};

// ── LocalStorage helpers ───────────────────────────────────────────────────────
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* storage quota exceeded – fail silently */
  }
}

// ── Prerequisite validation ────────────────────────────────────────────────────
/**
 * Returns whether the materia can advance to targetState.
 * @param {string} id
 * @param {number} targetState  1 = regular, 2 = approved
 */
function canAdvanceTo(id, targetState) {
  const materia = MATERIAS.find(m => m.id === id);
  if (!materia) return false;

  if (targetState === 1) {
    // To become Regular: all correlativas must be at least Regular (≥1)
    return materia.correlativas.every(cid => (progress[cid] ?? 0) >= 1);
  }
  if (targetState === 2) {
    // To become Approved: all correlativas must be Approved (=2)
    return materia.correlativas.every(cid => (progress[cid] ?? 0) === 2);
  }
  return true; // targetState === 0, always allowed
}

function isLocked(id) {
  const current = progress[id] ?? 0;
  if (current === 0) return !canAdvanceTo(id, 1);
  return false; // already regular or approved – can always regress
}

// ── Toast notification ─────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

// ── SVG arrow helpers ──────────────────────────────────────────────────────────
function buildDefs(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  [
    { id: "arrowhead-default",  color: "#cbd5e1" },
    { id: "arrowhead-regular",  color: "#eab308" },
    { id: "arrowhead-approved", color: "#22c55e" },
  ].forEach(({ id, color }) => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0,0 L0,6 L8,3 z");
    path.setAttribute("fill", color);
    marker.appendChild(path);
    defs.appendChild(marker);
  });

  svg.appendChild(defs);
}

function getCardCenter(id) {
  const el = document.querySelector(`[data-id="${id}"]`);
  if (!el) return null;
  const container = document.getElementById("diagram-container");
  const eRect = el.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  return {
    top:    eRect.top    - cRect.top,
    bottom: eRect.bottom - cRect.top,
    left:   eRect.left   - cRect.left,
    right:  eRect.right  - cRect.left,
    cx:     eRect.left   - cRect.left + eRect.width / 2,
    cy:     eRect.top    - cRect.top  + eRect.height / 2,
  };
}

function arrowClass(fromId, toId) {
  const fromState = progress[fromId] ?? 0;
  const toState   = progress[toId]   ?? 0;
  if (fromState === 2 && toState === 2) return "arrow-line state-approved";
  if (fromState >= 1)                   return "arrow-line state-regular";
  return "arrow-line";
}

function drawArrows() {
  const svg = document.getElementById("arrows-svg");

  // Clear existing lines (keep defs)
  [...svg.querySelectorAll("path.arrow-line")].forEach(el => el.remove());

  MATERIAS.forEach(materia => {
    materia.correlativas.forEach(corrId => {
      const from = getCardCenter(corrId);   // prerequisite → top
      const to   = getCardCenter(materia.id); // current subject → bottom
      if (!from || !to) return;

      // Start at bottom-center of prerequisite card
      const x1 = from.cx;
      const y1 = from.bottom + 2;
      // End at top-center of current subject card
      const x2 = to.cx;
      const y2 = to.top - 2;

      const midY = (y1 + y2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
      );
      path.setAttribute("class", arrowClass(corrId, materia.id));
      path.dataset.from = corrId;
      path.dataset.to   = materia.id;
      svg.appendChild(path);
    });
  });
}

// ── Render ─────────────────────────────────────────────────────────────────────
function renderSemesters() {
  const container = document.getElementById("semesters");
  container.innerHTML = "";

  const grouped = {};
  MATERIAS.forEach(m => {
    if (!grouped[m.cuatrimestre]) grouped[m.cuatrimestre] = [];
    grouped[m.cuatrimestre].push(m);
  });

  Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(cuatrimestreNum => {
      const block = document.createElement("div");
      block.className = "semester-block";

      const label = document.createElement("div");
      label.className = "semester-label";
      label.textContent = `${cuatrimestreNum}° Cuatrimestre`;
      block.appendChild(label);

      const row = document.createElement("div");
      row.className = "subjects-row";

      grouped[cuatrimestreNum].forEach(m => {
        row.appendChild(buildCard(m));
      });

      block.appendChild(row);
      container.appendChild(block);
    });
}

function buildCard(materia) {
  const state   = progress[materia.id] ?? 0;
  const locked  = isLocked(materia.id);

  const card = document.createElement("div");
  card.className = "subject-card" +
    (locked ? " locked" : "") +
    (state > 0 ? ` ${STATE_CLASSES[state]}` : "");
  card.dataset.id = materia.id;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", locked ? "-1" : "0");
  card.setAttribute("aria-label",
    `${materia.nombre} – ${STATE_LABELS[state]}${locked ? " (bloqueada)" : ""}`);

  if (locked) {
    const lock = document.createElement("span");
    lock.className = "lock-icon";
    lock.textContent = "🔒";
    lock.setAttribute("aria-hidden", "true");
    card.appendChild(lock);
  }

  const name = document.createElement("div");
  name.className = "subject-name";
  name.textContent = materia.nombre;
  card.appendChild(name);

  const status = document.createElement("div");
  status.className = "subject-status";
  status.textContent = STATE_LABELS[state];
  card.appendChild(status);

  card.addEventListener("click",  () => handleCardClick(materia.id));
  card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick(materia.id);
    }
  });

  return card;
}

// ── Interaction ────────────────────────────────────────────────────────────────
function handleCardClick(id) {
  const current    = progress[id] ?? 0;
  const nextState  = (current + 1) % 3;

  if (nextState === 0) {
    // Regressing to Pending: check no other subject depends on this being ≥ regular/approved
    const dependents = MATERIAS.filter(m => m.correlativas.includes(id) && (progress[m.id] ?? 0) > 0);
    if (dependents.length > 0) {
      const names = dependents.map(m => m.nombre).join(", ");
      showToast(`No podés desregularizar: estas materias dependen de esta: ${names}.`);
      return;
    }
  }

  if (!canAdvanceTo(id, nextState)) {
    const materia = MATERIAS.find(m => m.id === id);
    const missing = materia.correlativas
      .filter(cid => (progress[cid] ?? 0) < nextState)
      .map(cid => MATERIAS.find(m => m.id === cid)?.nombre ?? cid);

    if (nextState === 1) {
      showToast(`Para regularizar necesitás tener regular/aprobada: ${missing.join(", ")}`);
    } else {
      showToast(`Para aprobar necesitás tener aprobada: ${missing.join(", ")}`);
    }
    return;
  }

  progress[id] = nextState;
  saveProgress();
  updateCard(id);
  updateDependentCards(id);
  drawArrows();
}

/** Efficiently update a single card without full re-render */
function updateCard(id) {
  const card    = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  const state   = progress[id] ?? 0;
  const locked  = isLocked(id);
  const materia = MATERIAS.find(m => m.id === id);

  card.className = "subject-card" +
    (locked ? " locked" : "") +
    (state > 0 ? ` ${STATE_CLASSES[state]}` : "");
  card.setAttribute("tabindex", locked ? "-1" : "0");
  card.setAttribute("aria-label",
    `${materia.nombre} – ${STATE_LABELS[state]}${locked ? " (bloqueada)" : ""}`);

  const lock = card.querySelector(".lock-icon");
  if (locked && !lock) {
    const newLock = document.createElement("span");
    newLock.className = "lock-icon";
    newLock.textContent = "🔒";
    newLock.setAttribute("aria-hidden", "true");
    card.insertBefore(newLock, card.firstChild);
  } else if (!locked && lock) {
    lock.remove();
  }

  const statusEl = card.querySelector(".subject-status");
  if (statusEl) statusEl.textContent = STATE_LABELS[state];
}

/** When a materia changes state, update all subjects that list it as a prerequisite */
function updateDependentCards(changedId) {
  MATERIAS
    .filter(m => m.correlativas.includes(changedId))
    .forEach(m => updateCard(m.id));
}

// ── Reset ──────────────────────────────────────────────────────────────────────
document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("¿Seguro que querés borrar todo el progreso guardado?")) return;
  progress = {};
  saveProgress();
  renderSemesters();
  drawArrows();
});

// ── Init ───────────────────────────────────────────────────────────────────────
function init() {
  progress = loadProgress();

  const svg = document.getElementById("arrows-svg");
  buildDefs(svg);

  renderSemesters();

  // Draw arrows after layout is painted
  requestAnimationFrame(() => {
    requestAnimationFrame(drawArrows);
  });

  // Redraw arrows on resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawArrows, 80);
  });
}

init();

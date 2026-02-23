/**
 * Mapa de Correlatividades
 * Vanilla JS (ES6+) + LocalStorage + carga de plan desde JSON.
 *
 * Estados:
 * 0 = Pendiente
 * 1 = Regular
 * 2 = Aprobada
 */

const DEFAULT_PLAN_URL = "data/planes/gestion-de-tecnologias-de-la-informacion.materias.json";
const STATE_LABELS = ["Pendiente", "Regular", "Aprobada"];
const STATE_CLASSES = ["", "state-1", "state-2"];
const FALLBACK_MATERIAS = [
  { id: "6001", nombre: "Análisis Matemático I", cuatrimestre: 1, correlativas: [] },
  { id: "6006", nombre: "Análisis Matemático II", cuatrimestre: 2, correlativas: ["6001"] }
];

let STORAGE_KEY = "unpaz_progress:demo";
let MATERIAS = [];
let MATERIAS_BY_ID = {};
let DEPENDENTS = {};

/** @type {Record<string, 0|1|2>} */
let progress = {};
let toastTimer = null;

function toPlanSlug(planUrl) {
  const filename = (planUrl.split("/").pop() || "plan").toLowerCase();
  const withoutExt = filename.replace(/\.materias\.json$/, "").replace(/\.json$/, "");
  const slug = withoutExt.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "plan";
}

function setStorageKey(planUrl) {
  STORAGE_KEY = `unpaz_progress:${toPlanSlug(planUrl)}`;
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeMateria(raw) {
  const id = String(raw?.id ?? "").trim();
  const nombre = String(raw?.nombre ?? "").trim();
  const cuatrimestre = Number(raw?.cuatrimestre);

  if (!id || !nombre || !Number.isFinite(cuatrimestre)) return null;

  const correlativasRaw = Array.isArray(raw?.correlativas) ? raw.correlativas : [];
  const correlativas = unique(
    correlativasRaw
      .map((value) => String(value).trim())
      .filter(Boolean)
      .filter((correlativaId) => correlativaId !== id)
  );

  return {
    id,
    nombre,
    cuatrimestre: Math.max(1, Math.trunc(cuatrimestre)),
    correlativas
  };
}

function setMaterias(materias) {
  MATERIAS = materias;
  MATERIAS_BY_ID = Object.fromEntries(MATERIAS.map((materia) => [materia.id, materia]));
  DEPENDENTS = MATERIAS.reduce((acc, materia) => {
    materia.correlativas.forEach((correlativaId) => {
      if (!acc[correlativaId]) acc[correlativaId] = [];
      acc[correlativaId].push(materia.id);
    });
    return acc;
  }, {});
}

function resolvePlanUrl() {
  return document.body?.dataset.plan || DEFAULT_PLAN_URL;
}

async function loadPlanFromJson() {
  const planUrl = resolvePlanUrl();
  setStorageKey(planUrl);

  const response = await fetch(planUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${planUrl} (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("El plan debe ser un array JSON de materias.");
  }

  const materias = data
    .map(normalizeMateria)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.cuatrimestre !== b.cuatrimestre) return a.cuatrimestre - b.cuatrimestre;
      return a.id.localeCompare(b.id);
    });

  if (materias.length === 0) {
    throw new Error("El plan JSON no contiene materias válidas.");
  }

  setMaterias(materias);
  return { planUrl, count: materias.length };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    const valid = {};

    Object.entries(parsed).forEach(([id, state]) => {
      if (!MATERIAS_BY_ID[id]) return;
      if (state === 0 || state === 1 || state === 2) valid[id] = state;
    });

    return valid;
  } catch {
    return {};
  }
}

function normalizeProgressState() {
  let changed = false;
  let keepFixing = true;

  while (keepFixing) {
    keepFixing = false;

    MATERIAS.forEach((materia) => {
      const state = getState(materia.id);
      if (state === 0) return;

      if (state === 1 && !canAdvanceTo(materia.id, 1)) {
        progress[materia.id] = 0;
        changed = true;
        keepFixing = true;
        return;
      }

      if (state === 2 && !canAdvanceTo(materia.id, 2)) {
        progress[materia.id] = canAdvanceTo(materia.id, 1) ? 1 : 0;
        changed = true;
        keepFixing = true;
      }
    });
  }

  return changed;
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignora errores de cuota/privacidad del navegador.
  }
}

function getState(id) {
  return progress[id] ?? 0;
}

function canAdvanceTo(id, targetState) {
  const materia = MATERIAS_BY_ID[id];
  if (!materia) return false;

  if (targetState === 1) {
    return materia.correlativas.every((cid) => getState(cid) >= 1);
  }

  if (targetState === 2) {
    return materia.correlativas.every((cid) => getState(cid) === 2);
  }

  return true;
}

function isLocked(id) {
  return getState(id) === 0 && !canAdvanceTo(id, 1);
}

function getBlockingDependents(id) {
  const dependentIds = DEPENDENTS[id] ?? [];
  return dependentIds
    .map((dependentId) => MATERIAS_BY_ID[dependentId])
    .filter((materia) => getState(materia.id) > 0);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function setSubtitle(message) {
  const subtitle = document.querySelector(".subtitle");
  if (subtitle) subtitle.textContent = message;
}

function buildDefs(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const markers = [
    { id: "arrowhead-default", color: "#cbd5e1" },
    { id: "arrowhead-regular", color: "#eab308" },
    { id: "arrowhead-approved", color: "#22c55e" }
  ];

  markers.forEach(({ id, color }) => {
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

function getCardRectRelative(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  const container = document.getElementById("diagram-container");
  if (!card || !container) return null;

  const cardRect = card.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    top: cardRect.top - containerRect.top,
    bottom: cardRect.bottom - containerRect.top,
    cx: cardRect.left - containerRect.left + cardRect.width / 2
  };
}

function arrowClass(fromId, toId) {
  const fromState = getState(fromId);
  const toState = getState(toId);

  if (fromState === 2 && toState === 2) return "arrow-line state-approved";
  if (fromState >= 1) return "arrow-line state-regular";
  return "arrow-line";
}

function drawArrows() {
  const svg = document.getElementById("arrows-svg");
  if (!svg) return;

  [...svg.querySelectorAll("path.arrow-line")].forEach((line) => line.remove());

  MATERIAS.forEach((materia) => {
    materia.correlativas.forEach((correlativaId) => {
      const from = getCardRectRelative(correlativaId);
      const to = getCardRectRelative(materia.id);
      if (!from || !to) return;

      const x1 = from.cx;
      const y1 = from.bottom + 2;
      const x2 = to.cx;
      const y2 = to.top - 2;
      const midY = (y1 + y2) / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute("class", arrowClass(correlativaId, materia.id));
      svg.appendChild(path);
    });
  });
}

function buildCard(materia) {
  const state = getState(materia.id);
  const locked = isLocked(materia.id);

  const card = document.createElement("div");
  card.className = `subject-card${locked ? " locked" : ""}${state ? ` ${STATE_CLASSES[state]}` : ""}`;
  card.dataset.id = materia.id;
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", locked ? "-1" : "0");
  card.setAttribute("aria-label", `${materia.nombre} - ${STATE_LABELS[state]}${locked ? " (bloqueada)" : ""}`);

  if (locked) {
    const lockIcon = document.createElement("span");
    lockIcon.className = "lock-icon";
    lockIcon.textContent = "🔒";
    lockIcon.setAttribute("aria-hidden", "true");
    card.appendChild(lockIcon);
  }

  const name = document.createElement("div");
  name.className = "subject-name";
  name.textContent = materia.nombre;
  card.appendChild(name);

  const status = document.createElement("div");
  status.className = "subject-status";
  status.textContent = STATE_LABELS[state];
  card.appendChild(status);

  card.addEventListener("click", () => handleCardClick(materia.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardClick(materia.id);
    }
  });

  return card;
}

function renderSemesters() {
  const container = document.getElementById("semesters");
  if (!container) return;

  container.innerHTML = "";

  const grouped = MATERIAS.reduce((acc, materia) => {
    if (!acc[materia.cuatrimestre]) acc[materia.cuatrimestre] = [];
    acc[materia.cuatrimestre].push(materia);
    return acc;
  }, {});

  Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((cuatrimestre) => {
      const block = document.createElement("section");
      block.className = "semester-block";

      const label = document.createElement("h2");
      label.className = "semester-label";
      label.textContent = `${cuatrimestre}° Cuatrimestre`;
      block.appendChild(label);

      const row = document.createElement("div");
      row.className = "subjects-row";
      grouped[cuatrimestre].forEach((materia) => row.appendChild(buildCard(materia)));

      block.appendChild(row);
      container.appendChild(block);
    });
}

function updateCard(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  const materia = MATERIAS_BY_ID[id];
  if (!card || !materia) return;

  const state = getState(id);
  const locked = isLocked(id);

  card.className = `subject-card${locked ? " locked" : ""}${state ? ` ${STATE_CLASSES[state]}` : ""}`;
  card.setAttribute("tabindex", locked ? "-1" : "0");
  card.setAttribute("aria-label", `${materia.nombre} - ${STATE_LABELS[state]}${locked ? " (bloqueada)" : ""}`);

  const currentLock = card.querySelector(".lock-icon");
  if (locked && !currentLock) {
    const lockIcon = document.createElement("span");
    lockIcon.className = "lock-icon";
    lockIcon.textContent = "🔒";
    lockIcon.setAttribute("aria-hidden", "true");
    card.insertBefore(lockIcon, card.firstChild);
  } else if (!locked && currentLock) {
    currentLock.remove();
  }

  const status = card.querySelector(".subject-status");
  if (status) status.textContent = STATE_LABELS[state];
}

function updateDependents(changedId) {
  const dependentIds = DEPENDENTS[changedId] ?? [];
  dependentIds.forEach((dependentId) => updateCard(dependentId));
}

function getMissingCorrelativas(id, targetState) {
  const materia = MATERIAS_BY_ID[id];
  if (!materia) return [];

  return materia.correlativas
    .filter((correlativaId) => getState(correlativaId) < targetState)
    .map((correlativaId) => MATERIAS_BY_ID[correlativaId]?.nombre || correlativaId);
}

function handleCardClick(id) {
  const currentState = getState(id);
  const nextState = (currentState + 1) % 3;

  if (nextState === 0) {
    const blockingDependents = getBlockingDependents(id);
    if (blockingDependents.length > 0) {
      const names = blockingDependents.map((m) => m.nombre).join(", ");
      showToast(`No podés volver a Pendiente: dependen de esta materia ${names}.`);
      return;
    }
  }

  if (!canAdvanceTo(id, nextState)) {
    const missing = getMissingCorrelativas(id, nextState).join(", ");
    if (nextState === 1) {
      showToast(`Para pasar a Regular necesitás correlativas en Regular/Aprobada: ${missing}.`);
    } else {
      showToast(`Para pasar a Aprobada necesitás correlativas Aprobadas: ${missing}.`);
    }
    return;
  }

  progress[id] = nextState;
  saveProgress();
  updateCard(id);
  updateDependents(id);
  drawArrows();
}

function resetProgress() {
  if (!confirm("¿Seguro que querés borrar todo el progreso guardado?")) return;
  progress = {};
  saveProgress();
  renderSemesters();
  drawArrows();
}

function bindUiEvents() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawArrows, 80);
  });

  const resetButton = document.getElementById("btn-reset");
  if (resetButton) resetButton.addEventListener("click", resetProgress);
}

async function init() {
  const svg = document.getElementById("arrows-svg");
  if (svg) buildDefs(svg);
  bindUiEvents();

  let loadInfo = null;
  try {
    loadInfo = await loadPlanFromJson();
    setSubtitle(`Plan cargado (${loadInfo.count} materias). Hacé clic en cada materia para registrar tu progreso.`);
  } catch (error) {
    console.error(error);
    setStorageKey("demo");
    setMaterias(FALLBACK_MATERIAS);
    setSubtitle("No se pudo cargar el JSON del plan. Se muestra la demo mínima.");
    showToast("Error cargando plan JSON. Revisá la ruta data-plan en index.html.");
  }

  progress = loadProgress();
  if (normalizeProgressState()) saveProgress();
  renderSemesters();

  requestAnimationFrame(() => {
    requestAnimationFrame(drawArrows);
  });
}

init();

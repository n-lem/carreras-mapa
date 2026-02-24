/**
 * Mapa de Correlatividades
 * Vanilla JS (ES6+) + LocalStorage + carga dinámica de carreras.
 *
 * Estados:
 * 0 = Pendiente
 * 1 = Regular
 * 2 = Aprobada
 */

const DEFAULT_PLAN_URL = "data/planes/licenciatura-en-gestion-de-tecnologias-de-la-informacion.materias.json";
const DEFAULT_CATALOG_URL = "data/planes/catalog.json";
const SELECTED_PLAN_KEY = "unpaz_selected_plan";
const MILESTONES_HIDDEN_PREFIX = "unpaz_milestones_hidden:";
const THEME_KEY = "unpaz_theme";
const PROGRESS_SCHEMA_VERSION = 2;
const ONBOARDING_DISMISSED_KEY = "unpaz_onboarding_dismissed";
const MAX_IMPORT_FILE_BYTES = 1024 * 1024; // 1 MB
const MAX_IMPORT_TEXT_CHARS = 2 * 1024 * 1024; // 2 MB (UTF-16 chars)
const STATE_LABELS = ["Pendiente", "Regular", "Aprobada"];
const STATE_CLASSES = ["", "state-1", "state-2"];
const EDGE_COLORS = [
  "#3b82f6", "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f59e0b",
  "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#14b8a6"
];
const FALLBACK_MATERIAS = [
  { id: "6001", nombre: "Análisis Matemático I", cuatrimestre: 1, correlativas: [] },
  { id: "6006", nombre: "Análisis Matemático II", cuatrimestre: 2, correlativas: ["6001"] }
];
const Core = window.UnpazCore;

let STORAGE_KEY = "unpaz_progress:demo";
let PLAN_CATALOG = [];
let ACTIVE_PLAN = null;
let ACTIVE_PLAN_META = null;

let MATERIAS = [];
let MATERIAS_BY_ID = {};
let DEPENDENTS = {};
let milestoneStateByKey = {};
let milestonesPanelHidden = false;
let careerFabOpen = false;
let blockedHighlightTimer = null;
let toolsMenuOpen = false;
let suppressAchievementNotifications = true;
let activePathTargetId = null;
let activeRequirementHighlight = null;

/** @type {Record<string, 0|1|2>} */
let progress = {};
let toastTimer = null;

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function unique(items) {
  return [...new Set(items)];
}

function sanitizeFilenameSegment(value, fallback = "plan") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isLikelyJsonImportFile(file) {
  if (!file) return false;
  const name = String(file.name || "");
  const type = String(file.type || "").toLowerCase();
  const byExt = /\.json$/i.test(name);
  const byType = type === "" || type.includes("json");
  return byExt || byType;
}

function toPlanSlug(planRef) {
  const filename = (String(planRef || "").split("/").pop() || "plan").toLowerCase();
  const withoutExt = filename.replace(/\.materias\.json$/, "").replace(/\.json$/, "");
  const slug = withoutExt.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "plan";
}

function humanizeSlug(slug) {
  return String(slug || "plan")
    .split("-")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function setStorageKeyForSlug(slug) {
  STORAGE_KEY = `unpaz_progress:${slug || "plan"}`;
}

function milestonesHiddenKey() {
  return `${MILESTONES_HIDDEN_PREFIX}${ACTIVE_PLAN?.slug || "demo"}`;
}

function setMilestonesHidden(hidden) {
  milestonesPanelHidden = Boolean(hidden);
  safeStorageSet(milestonesHiddenKey(), hidden ? "1" : "0");
}

function areMilestonesHidden() {
  return safeStorageGet(milestonesHiddenKey()) === "1";
}

function setCareerTitle(name) {
  const careerName = document.getElementById("career-name");
  if (careerName) {
    const text = name ? `Carrera: ${name}` : "";
    careerName.textContent = text;
    careerName.title = text;
  }

  const heroContainer = document.getElementById("career-hero");
  if (heroContainer) {
    const total = MATERIAS.length;
    heroContainer.innerHTML = "";

    const box = document.createElement("div");
    box.className = "career-hero-box";

    const title = document.createElement("h2");
    title.className = "career-hero-title";
    title.textContent = name || "Carrera";
    box.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "career-hero-meta";
    meta.textContent = total > 0 ? `Plan cargado (${total} materias)` : "Plan sin materias cargadas";
    box.appendChild(meta);

    heroContainer.appendChild(box);
  }
}

function setSubtitle(message) {
  const subtitle = document.querySelector(".subtitle");
  if (subtitle) subtitle.textContent = message;
}

function configureAuthorFooter() {
  const link = document.getElementById("author-link");
  if (!link) return;

  const authorName = String(document.body?.dataset.authorName || "Nahuel").trim() || "Autor";
  const authorGithub = String(document.body?.dataset.authorGithub || "https://github.com/n-lem").trim();
  link.textContent = authorName;
  link.href = authorGithub || "https://github.com";
}

function getCareerSelectElements() {
  const headerSelect = document.getElementById("career-select");
  const floatingSelect = document.getElementById("career-select-floating");
  return [headerSelect, floatingSelect].filter(Boolean);
}

function setCareerSelectionValue(slug) {
  getCareerSelectElements().forEach((select) => {
    const hasOption = [...select.options].some((option) => option.value === slug);
    if (hasOption) select.value = slug;
  });
}

function ensureDemoOptionInSelects() {
  const label = "Demo mínima (sin plan cargado)";
  getCareerSelectElements().forEach((select) => {
    let option = [...select.options].find((item) => item.value === "demo");
    if (!option) {
      option = document.createElement("option");
      option.value = "demo";
      select.prepend(option);
    }
    option.textContent = label;
  });
}

function setCareerFabOpen(open) {
  const panel = document.getElementById("career-fab-panel");
  const button = document.getElementById("btn-career-fab");
  if (!panel || !button) return;

  const nextOpen = Boolean(open);
  if (button.hidden && nextOpen) return;
  careerFabOpen = nextOpen;
  panel.hidden = !nextOpen;
  button.setAttribute("aria-expanded", String(nextOpen));
}

function positionToolsMenu(button, menu) {
  if (!button || !menu) return;

  menu.style.position = "fixed";
  menu.style.top = "0px";
  menu.style.left = "0px";

  const btnRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let left = btnRect.right - menuRect.width;
  left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));

  let top = btnRect.bottom + 8;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, btnRect.top - menuRect.height - 8);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function setToolsMenuOpen(open) {
  const menu = document.getElementById("tools-menu");
  const button = document.getElementById("btn-tools");
  if (!menu) return;

  toolsMenuOpen = Boolean(open && button);
  menu.hidden = !toolsMenuOpen;
  if (button) {
    button.setAttribute("aria-expanded", String(toolsMenuOpen));
  }

  if (toolsMenuOpen && button) {
    positionToolsMenu(button, menu);
  }
}

function isOnboardingDismissed() {
  return safeStorageGet(ONBOARDING_DISMISSED_KEY) === "1";
}

function setOnboardingDismissed(value) {
  safeStorageSet(ONBOARDING_DISMISSED_KEY, value ? "1" : "0");
}

function showOnboardingGuide() {
  const guide = document.getElementById("onboarding-guide");
  if (!guide) return;
  guide.hidden = false;
}

function hideOnboardingGuide(rememberDismiss = false) {
  const guide = document.getElementById("onboarding-guide");
  if (guide) guide.hidden = true;
  if (rememberDismiss) setOnboardingDismissed(true);
}

function achievementDomKey(key) {
  return encodeURIComponent(String(key || ""));
}

function clearAchievementNotifications() {
  const container = document.getElementById("achievement-stack");
  if (!container) return;
  container.innerHTML = "";
}

function removeAchievementNotification(key) {
  const container = document.getElementById("achievement-stack");
  if (!container) return;

  const encoded = achievementDomKey(key);
  const card = container.querySelector(`[data-achievement-key="${encoded}"]`);
  if (card) card.remove();
}

function showAchievementNotification(milestone, progressInfo, key) {
  const container = document.getElementById("achievement-stack");
  if (!container) return;

  const encoded = achievementDomKey(key);
  if (container.querySelector(`[data-achievement-key="${encoded}"]`)) return;

  const card = document.createElement("article");
  card.className = "achievement-toast";
  card.dataset.achievementKey = encoded;

  const head = document.createElement("header");
  head.className = "achievement-head";

  const title = document.createElement("div");
  title.className = "achievement-title";
  const suffix = milestone.nombre ? `: ${milestone.nombre}` : "";
  title.textContent = `${milestoneLabel(milestone)} alcanzado${suffix}`;
  head.appendChild(title);

  const close = document.createElement("button");
  close.className = "achievement-close";
  close.type = "button";
  close.setAttribute("aria-label", "Cerrar notificación");
  close.textContent = "×";
  close.addEventListener("click", () => {
    card.remove();
  });
  head.appendChild(close);

  const body = document.createElement("div");
  body.className = "achievement-body";
  body.textContent = `Aprobadas ${progressInfo.approved}/${progressInfo.total} (${progressInfo.percentage}%).`;

  card.appendChild(head);
  card.appendChild(body);
  container.appendChild(card);
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

function resolvePreferredTheme() {
  const persisted = safeStorageGet(THEME_KEY);
  if (persisted === "dark" || persisted === "light") return persisted;

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function updateThemeButtonLabel(theme) {
  const themeButton = document.getElementById("btn-theme");
  if (!themeButton) return;
  const isDark = theme === "dark";
  themeButton.textContent = isDark ? "Modo claro" : "Modo oscuro";
  themeButton.setAttribute("aria-label", isDark ? "Activar modo claro" : "Activar modo oscuro");
}

function setTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = normalized;
  safeStorageSet(THEME_KEY, normalized);
  updateThemeButtonLabel(normalized);
}

function toggleTheme() {
  const current = document.body.dataset.theme === "dark" ? "dark" : "light";
  setTheme(current === "dark" ? "light" : "dark");
}

function setMaterias(materias) {
  MATERIAS = materias;
  const indexes = Core.buildIndexes(MATERIAS);
  MATERIAS_BY_ID = indexes.byId;
  DEPENDENTS = indexes.dependents;
}

function serializeProgressPayload() {
  return {
    version: PROGRESS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    progress
  };
}

function migrateLegacyProgressPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  if (typeof parsed.version === "number" && parsed.progress && typeof parsed.progress === "object") {
    return parsed;
  }

  return {
    version: 1,
    updatedAt: null,
    progress: parsed
  };
}

function loadProgress() {
  try {
    const raw = safeStorageGet(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    const migrated = migrateLegacyProgressPayload(parsed);
    if (!migrated) return {};

    const nextProgress = Core.coerceProgressMap(migrated.progress, MATERIAS_BY_ID);
    const originalSerialized = JSON.stringify(migrated.progress || {});
    const normalizedSerialized = JSON.stringify(nextProgress);
    if (migrated.version !== PROGRESS_SCHEMA_VERSION || originalSerialized !== normalizedSerialized) {
      progress = nextProgress;
      saveProgress();
    }
    return nextProgress;
  } catch {
    return {};
  }
}

function saveProgress() {
  safeStorageSet(STORAGE_KEY, JSON.stringify(serializeProgressPayload()));
}

function getState(id) {
  return progress[id] ?? 0;
}

function canAdvanceTo(id, targetState) {
  return Core.canAdvanceTo(id, targetState, progress, MATERIAS_BY_ID);
}

function normalizeProgressState() {
  const normalized = Core.normalizeProgressMap(progress, MATERIAS, MATERIAS_BY_ID);
  progress = normalized.progress;
  return normalized.changed;
}

function isLocked(id) {
  return getState(id) === 0 && !canAdvanceTo(id, 1);
}

function getBlockingDependents(id) {
  return Core.getBlockingDependents(id, progress, DEPENDENTS, MATERIAS_BY_ID);
}

function getMissingCorrelativas(id, targetState) {
  return Core.getMissingCorrelativas(id, targetState, progress, MATERIAS_BY_ID);
}

function getMissingCorrelativaIds(id, targetState) {
  const materia = MATERIAS_BY_ID[id];
  if (!materia) return [];
  return materia.correlativas.filter((correlativaId) => {
    const currentState = getState(correlativaId);
    if (targetState === 1) return currentState < 1;
    if (targetState === 2) return currentState !== 2;
    return false;
  });
}

function buildDefs(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");

  EDGE_COLORS.forEach((color, index) => {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", `arrowhead-${index}`);
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

function edgeColorIndexForMateria(materiaId) {
  const cuatrimestre = MATERIAS_BY_ID[materiaId]?.cuatrimestre ?? 1;
  return (Math.max(1, cuatrimestre) - 1) % EDGE_COLORS.length;
}

function getUpstreamGraph(targetId) {
  const nodes = new Set([targetId]);
  const edges = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);

    const materia = MATERIAS_BY_ID[id];
    if (!materia) return;

    materia.correlativas.forEach((prevId) => {
      nodes.add(prevId);
      edges.add(`${prevId}->${id}`);
      visit(prevId);
    });
  };

  visit(targetId);
  return { nodes, edges };
}

function clearPathHighlightsDom() {
  document.querySelectorAll(".subject-card.path-target, .subject-card.path-prereq").forEach((card) => {
    card.classList.remove("path-target", "path-prereq");
  });

  document.querySelectorAll("#arrows-svg .arrow-line.path-active, #arrows-svg .arrow-line.path-muted").forEach((line) => {
    line.classList.remove("path-active", "path-muted");
  });
}

function applyPathHighlights(targetId) {
  if (!targetId || !MATERIAS_BY_ID[targetId]) {
    activePathTargetId = null;
    clearPathHighlightsDom();
    return;
  }

  activePathTargetId = targetId;
  clearPathHighlightsDom();

  const { nodes, edges } = getUpstreamGraph(targetId);

  document.querySelectorAll(".subject-card").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (!id) return;
    if (id === targetId) card.classList.add("path-target");
    else if (nodes.has(id)) card.classList.add("path-prereq");
  });

  document.querySelectorAll("#arrows-svg .arrow-line").forEach((line) => {
    const edgeKey = line.getAttribute("data-edge-key") || "";
    if (edges.has(edgeKey)) {
      line.classList.add("path-active");
    } else {
      line.classList.add("path-muted");
    }
  });
}

function clearPathHighlights() {
  activePathTargetId = null;
  clearPathHighlightsDom();
}

function paintRequirementHighlights() {
  if (!activeRequirementHighlight) return;

  const targetCard = document.querySelector(`.subject-card[data-id="${activeRequirementHighlight.targetId}"]`);
  if (targetCard) targetCard.classList.add("unlock-target");

  activeRequirementHighlight.missingIds.forEach((missingId) => {
    const card = document.querySelector(`.subject-card[data-id="${missingId}"]`);
    if (card) card.classList.add("required-for-unlock");
  });
}

function clearRequirementHighlights() {
  document.querySelectorAll(".subject-card.unlock-target, .subject-card.required-for-unlock").forEach((card) => {
    card.classList.remove("unlock-target", "required-for-unlock");
  });
  activeRequirementHighlight = null;
}

function setRequirementHighlights(targetId, missingIds) {
  clearRequirementHighlights();
  if (!targetId || !Array.isArray(missingIds) || missingIds.length === 0) return;
  activeRequirementHighlight = {
    targetId,
    missingIds: new Set(missingIds)
  };
  paintRequirementHighlights();
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
      const colorIndex = edgeColorIndexForMateria(materia.id);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute("class", arrowClass(correlativaId, materia.id));
      path.setAttribute("data-edge-key", `${correlativaId}->${materia.id}`);
      path.style.setProperty("--edge-color", EDGE_COLORS[colorIndex]);
      path.setAttribute("marker-end", `url(#arrowhead-${colorIndex})`);
      svg.appendChild(path);
    });
  });

  if (activePathTargetId) {
    applyPathHighlights(activePathTargetId);
  }
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
  card.addEventListener("mouseenter", () => applyPathHighlights(materia.id));
  card.addEventListener("mouseleave", clearPathHighlights);
  card.addEventListener("focus", () => applyPathHighlights(materia.id));
  card.addEventListener("blur", clearPathHighlights);
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
      label.setAttribute("role", "button");
      label.setAttribute("tabindex", "0");
      label.setAttribute(
        "aria-label",
        `${cuatrimestre}° cuatrimestre. Ciclo rápido de estados para todas sus materias.`
      );
      label.title = "Ciclo rápido: Pendiente -> Regular -> Aprobada -> Pendiente";
      label.addEventListener("click", () => applySemesterCycleQuick(cuatrimestre));
      label.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          applySemesterCycleQuick(cuatrimestre);
        }
      });
      block.appendChild(label);

      const row = document.createElement("div");
      row.className = "subjects-row";
      grouped[cuatrimestre].forEach((materia) => row.appendChild(buildCard(materia)));

      block.appendChild(row);
      container.appendChild(block);
    });
}

function highlightBlockedCards(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;

  if (blockedHighlightTimer) {
    clearTimeout(blockedHighlightTimer);
    blockedHighlightTimer = null;
  }

  ids.forEach((id) => {
    const card = document.querySelector(`.subject-card[data-id="${id}"]`);
    if (!card) return;
    card.classList.remove("bulk-blocked");
    // Force reflow to restart animation in repeated attempts.
    void card.offsetWidth; // eslint-disable-line no-unused-expressions
    card.classList.add("bulk-blocked");
  });

  blockedHighlightTimer = setTimeout(() => {
    ids.forEach((id) => {
      const card = document.querySelector(`.subject-card[data-id="${id}"]`);
      if (card) card.classList.remove("bulk-blocked");
    });
    blockedHighlightTimer = null;
  }, 760);
}

function applySemesterCycleQuick(cuatrimestre) {
  const result = Core.applySemesterCycleAction({
    cuatrimestre,
    progressMap: progress,
    materias: MATERIAS,
    materiasById: MATERIAS_BY_ID,
    dependents: DEPENDENTS
  });

  if (result.changedIds.length === 0) {
    showToast(`Cuatrimestre ${cuatrimestre}: no se pudo avanzar a ${STATE_LABELS[result.targetState]}.`);
    highlightBlockedCards(result.blocked.map((item) => item.id));
    return;
  }

  progress = { ...progress, ...result.progress };
  normalizeProgressState();
  saveProgress();
  renderSemesters();
  drawArrows();
  updateCareerProgress();
  updateMilestones();

  const blockedIds = result.blocked.map((item) => item.id);
  highlightBlockedCards(blockedIds);

  if (blockedIds.length > 0) {
    showToast(
      `Cuatrimestre ${cuatrimestre}: ${result.changedIds.length}/${result.semesterIds.length} en ` +
      `${STATE_LABELS[result.targetState]}. ${blockedIds.length} bloqueadas por correlativas/dependencias.`
    );
    return;
  }

  showToast(
    `Cuatrimestre ${cuatrimestre}: ${result.changedIds.length}/${result.semesterIds.length} en ${STATE_LABELS[result.targetState]}.`
  );
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

  if (activeRequirementHighlight) {
    if (activeRequirementHighlight.targetId === id) card.classList.add("unlock-target");
    if (activeRequirementHighlight.missingIds.has(id)) card.classList.add("required-for-unlock");
  }
}

function updateDependents(changedId) {
  const dependentIds = DEPENDENTS[changedId] ?? [];
  dependentIds.forEach((dependentId) => updateCard(dependentId));
}

function normalizeMilestones(meta) {
  const rawMilestones = Array.isArray(meta?.hitos) ? meta.hitos : [];
  const milestones = rawMilestones
    .map((item) => {
      const tipo = String(item?.tipo ?? "").trim();
      const nombre = String(item?.nombre ?? "").trim();

      let criterio = item?.criterio ?? null;
      if (!criterio && tipo === "titulo_intermedio" && Number.isFinite(Number(item?.anio_estimado))) {
        criterio = { tipo: "cuatrimestre_max", valor: Number(item.anio_estimado) * 2 };
      }
      if (!criterio && tipo === "titulo_final") {
        criterio = { tipo: "plan_completo" };
      }

      if (!tipo) return null;
      return { tipo, nombre, criterio };
    })
    .filter(Boolean);

  if (!milestones.some((item) => item.tipo === "titulo_final")) {
    milestones.push({
      tipo: "titulo_final",
      nombre: "Plan completo",
      criterio: { tipo: "plan_completo" }
    });
  }

  return milestones;
}

function isMilestoneAchieved(milestone) {
  const progressInfo = milestoneProgress(milestone);
  return progressInfo.total > 0 && progressInfo.approved === progressInfo.total;
}

function milestoneLabel(milestone) {
  return milestone.tipo === "titulo_intermedio" ? "Título intermedio" : "Título final";
}

function milestoneKey(milestone) {
  const criterio = milestone?.criterio ? JSON.stringify(milestone.criterio) : "";
  return `${milestone?.tipo || "hito"}|${milestone?.nombre || ""}|${criterio}`;
}

function milestoneScopeMateriaIds(milestone) {
  const criterionType = milestone?.criterio?.tipo;

  if (criterionType === "cuatrimestre_max") {
    const maxCuatrimestre = Number(milestone?.criterio?.valor);
    if (!Number.isFinite(maxCuatrimestre)) return [];
    return MATERIAS
      .filter((materia) => materia.cuatrimestre <= maxCuatrimestre)
      .map((materia) => materia.id);
  }

  if (criterionType === "ids_exactas" && Array.isArray(milestone?.criterio?.ids)) {
    return unique(
      milestone.criterio.ids
        .map((id) => String(id))
        .filter((id) => Boolean(MATERIAS_BY_ID[id]))
    );
  }

  return MATERIAS.map((materia) => materia.id);
}

function milestoneProgress(milestone) {
  const ids = milestoneScopeMateriaIds(milestone);
  const total = ids.length;
  const approved = ids.filter((id) => getState(id) === 2).length;
  const percentage = total > 0 ? Math.round((approved / total) * 100) : 0;
  return { total, approved, percentage };
}

function careerProgressInfo() {
  const total = MATERIAS.length;
  const approved = MATERIAS.filter((materia) => getState(materia.id) === 2).length;
  const regular = MATERIAS.filter((materia) => getState(materia.id) === 1).length;
  const pending = Math.max(0, total - approved - regular);
  const percentage = total > 0 ? Math.round((approved / total) * 100) : 0;
  return { total, approved, regular, pending, percentage };
}

function updateCareerProgress() {
  const container = document.getElementById("career-progress-floating");
  if (!container) return;

  const { total, approved, regular, pending, percentage } = careerProgressInfo();
  if (total === 0) {
    container.innerHTML = "";
    setToolsMenuOpen(false);
    return;
  }

  container.innerHTML = "";

  const box = document.createElement("div");
  box.className = "career-progress-box";

  const topRow = document.createElement("div");
  topRow.className = "career-progress-top";

  const careerTitle = document.createElement("h3");
  careerTitle.className = "career-progress-career";
  careerTitle.textContent = ACTIVE_PLAN_META?.carrera || ACTIVE_PLAN?.carrera || "Carrera";
  topRow.appendChild(careerTitle);

  const toolbar = document.createElement("div");
  toolbar.className = "career-progress-toolbar";

  const toolsButton = document.createElement("button");
  toolsButton.id = "btn-tools";
  toolsButton.type = "button";
  toolsButton.className = "progress-icon-btn";
  toolsButton.title = "Herramientas";
  toolsButton.setAttribute("aria-label", "Abrir herramientas");
  toolsButton.setAttribute("aria-controls", "tools-menu");
  toolsButton.setAttribute("aria-expanded", String(toolsMenuOpen));
  toolsButton.textContent = "⚙";
  toolsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setToolsMenuOpen(!toolsMenuOpen);
  });
  toolbar.appendChild(toolsButton);

  const resetButton = document.createElement("button");
  resetButton.id = "btn-reset";
  resetButton.type = "button";
  resetButton.className = "progress-icon-btn danger";
  resetButton.title = "Reiniciar progreso";
  resetButton.setAttribute("aria-label", "Reiniciar progreso");
  resetButton.textContent = "↺";
  resetButton.addEventListener("click", resetProgress);
  toolbar.appendChild(resetButton);

  topRow.appendChild(toolbar);
  box.appendChild(topRow);

  const head = document.createElement("div");
  head.className = "career-progress-head";

  const title = document.createElement("span");
  title.className = "career-progress-title";
  title.textContent = "Progreso de carrera";
  head.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "career-progress-meta";
  meta.textContent = `Aprobadas ${approved}/${total} (${percentage}%)`;
  head.appendChild(meta);

  box.appendChild(head);

  const states = document.createElement("div");
  states.className = "career-progress-states";

  const pendingBadge = document.createElement("span");
  pendingBadge.className = "state-pill pending";
  pendingBadge.textContent = `Pendiente ${pending}`;
  states.appendChild(pendingBadge);

  const regularBadge = document.createElement("span");
  regularBadge.className = "state-pill regular";
  regularBadge.textContent = `Regular ${regular}`;
  states.appendChild(regularBadge);

  const approvedBadge = document.createElement("span");
  approvedBadge.className = "state-pill approved";
  approvedBadge.textContent = `Aprobada ${approved}`;
  states.appendChild(approvedBadge);

  box.appendChild(states);

  const track = document.createElement("div");
  track.className = "career-progress-track";

  const fill = document.createElement("div");
  fill.className = "career-progress-fill";
  fill.style.width = `${percentage}%`;
  fill.setAttribute("aria-hidden", "true");

  track.appendChild(fill);
  box.appendChild(track);
  container.appendChild(box);

  if (toolsMenuOpen) {
    setToolsMenuOpen(true);
  }
}

function updateMilestones(options = {}) {
  const notify = options.notify ?? !suppressAchievementNotifications;
  const container = document.getElementById("milestones");
  const showButton = document.getElementById("btn-show-milestones");
  if (!container) return;

  const milestones = normalizeMilestones(ACTIVE_PLAN_META);
  if (milestones.length === 0) {
    container.hidden = true;
    container.innerHTML = "";
    if (showButton) showButton.hidden = true;
    milestoneStateByKey = {};
    clearAchievementNotifications();
    return;
  }

  const nextStateByKey = {};
  const hidden = milestonesPanelHidden;
  container.innerHTML = "";

  milestones.forEach((milestone) => {
    const key = milestoneKey(milestone);
    nextStateByKey[key] = isMilestoneAchieved(milestone);
  });

  const header = document.createElement("div");
  header.className = "milestone-floating-header";

  const headerTitle = document.createElement("span");
  headerTitle.className = "milestone-floating-title";
  headerTitle.textContent = "Progreso de títulos";
  header.appendChild(headerTitle);

  const hideButton = document.createElement("button");
  hideButton.id = "btn-hide-milestones";
  hideButton.type = "button";
  hideButton.textContent = "Ocultar";
  hideButton.addEventListener("click", () => {
    setMilestonesHidden(true);
    updateMilestones();
  });
  header.appendChild(hideButton);
  container.appendChild(header);

  milestones.forEach((milestone) => {
    const key = milestoneKey(milestone);
    const achieved = nextStateByKey[key];
    const isNew = achieved && !milestoneStateByKey[key];
    const progressInfo = milestoneProgress(milestone);
    if (notify && isNew) {
      showAchievementNotification(milestone, progressInfo, key);
    }
    if (!achieved) {
      removeAchievementNotification(key);
    }

    const card = document.createElement("div");
    card.className = `milestone-float-card${achieved ? " achieved" : ""}${isNew ? " new-achievement" : ""}`;

    const title = document.createElement("span");
    title.className = "milestone-float-title";
    const suffix = milestone.nombre ? `: ${milestone.nombre}` : "";
    title.textContent = `${achieved ? "✓" : "•"} ${milestoneLabel(milestone)}${suffix}`;
    card.appendChild(title);

    const progressText = document.createElement("span");
    progressText.className = "milestone-float-progress";
    progressText.textContent = `Aprobadas ${progressInfo.approved}/${progressInfo.total} (${progressInfo.percentage}%)`;
    card.appendChild(progressText);

    container.appendChild(card);
  });

  if (hidden) {
    container.hidden = true;
    if (showButton) showButton.hidden = false;
  } else {
    container.hidden = false;
    if (showButton) showButton.hidden = true;
  }

  milestoneStateByKey = nextStateByKey;
}

function handleCardClick(id) {
  if (!activeRequirementHighlight || activeRequirementHighlight.targetId !== id) {
    clearRequirementHighlights();
  }

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
    const missingIds = getMissingCorrelativaIds(id, nextState);
    if (nextState === 1) {
      showToast(`Para pasar a Regular necesitás correlativas en Regular/Aprobada: ${missing}.`);
    } else {
      showToast(`Para pasar a Aprobada necesitás correlativas Aprobadas: ${missing}.`);
    }
    setRequirementHighlights(id, missingIds);
    return;
  }

  clearRequirementHighlights();
  progress[id] = nextState;
  saveProgress();
  updateCard(id);
  updateDependents(id);
  drawArrows();
  updateCareerProgress();
  updateMilestones();
}

function resetProgress() {
  setToolsMenuOpen(false);
  if (!confirm("¿Seguro que querés borrar todo el progreso guardado?")) return;
  progress = {};
  clearAchievementNotifications();
  clearRequirementHighlights();
  saveProgress();
  renderSemesters();
  drawArrows();
  updateCareerProgress();
  updateMilestones();
}

function exportProgress() {
  setToolsMenuOpen(false);
  const payload = {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    planSlug: ACTIVE_PLAN?.slug || "demo",
    carrera: ACTIVE_PLAN_META?.carrera || ACTIVE_PLAN?.carrera || "Sin carrera",
    exportedAt: new Date().toISOString(),
    progress
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `progreso-${payload.planSlug}-${date}.json`;
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportAsPng() {
  setToolsMenuOpen(false);
  const diagram = document.getElementById("diagram-container");
  if (!diagram || typeof html2canvas !== "function") {
    showToast("No se pudo exportar a PNG. La librería no está disponible.");
    return;
  }

  const width = Math.ceil(diagram.scrollWidth || diagram.getBoundingClientRect().width);
  const height = Math.ceil(diagram.scrollHeight || diagram.getBoundingClientRect().height);
  if (width < 20 || height < 20) {
    showToast("No se pudo exportar: el diagrama está vacío.");
    return;
  }

  const sandbox = document.createElement("div");
  sandbox.className = "png-export-sandbox";
  const clone = diagram.cloneNode(true);
  clone.classList.add("png-export-target");
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  sandbox.appendChild(clone);
  document.body.appendChild(sandbox);

  const maxPixels = 16_000_000;
  let scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const requiredPixels = width * height * scale * scale;
  if (requiredPixels > maxPixels) {
    scale = Math.max(1, Math.sqrt(maxPixels / (width * height)));
  }

  showToast("Generando PNG... por favor esperá.");

  try {
    const canvas = await html2canvas(clone, {
      logging: false,
      useCORS: false,
      backgroundColor: "#ffffff",
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scale,
      removeContainer: true
    });

    const date = new Date().toISOString().slice(0, 10);
    const slug = sanitizeFilenameSegment(ACTIVE_PLAN?.slug || "demo", "plan");
    const filename = `mapa-de-carrera-${slug}-${date}.png`;

    if (typeof canvas.toBlob === "function") {
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("No se pudo serializar la imagen."));
            return;
          }
          downloadBlob(blob, filename);
          resolve();
        }, "image/png");
      });
    } else {
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    showToast("PNG exportado correctamente.");
  } catch (err) {
    console.error("Error al generar PNG:", err);
    showToast("Hubo un error al generar la imagen.");
  } finally {
    sandbox.remove();
  }
}

async function importProgressFromFile(file) {
  setToolsMenuOpen(false);
  if (!file) return;

  if (!isLikelyJsonImportFile(file)) {
    showToast("Archivo inválido: seleccioná un archivo .json.");
    return;
  }

  if (Number(file.size || 0) > MAX_IMPORT_FILE_BYTES) {
    showToast("Archivo demasiado grande. Máximo permitido: 1 MB.");
    return;
  }

  const rawText = await file.text();
  if (rawText.length > MAX_IMPORT_TEXT_CHARS) {
    showToast("Archivo demasiado grande para procesar de forma segura.");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    showToast("Archivo inválido: no es un JSON válido.");
    return;
  }

  if (!isPlainObject(parsed)) {
    showToast("Archivo inválido: estructura incorrecta.");
    return;
  }

  const importSlug = String(parsed.planSlug || parsed.slug || "").trim();
  if (importSlug && ACTIVE_PLAN?.slug !== importSlug) {
    const matchingPlan = PLAN_CATALOG.find((plan) => plan.slug === importSlug);
    if (!matchingPlan) {
      showToast("El archivo corresponde a una carrera no disponible en este catálogo.");
      return;
    }

    const shouldSwitch = confirm(
      `El archivo corresponde a "${matchingPlan.carrera}". ¿Querés cambiar de carrera e importar?`
    );
    if (!shouldSwitch) return;

    const switched = await activatePlan(matchingPlan, false);
    if (!switched) {
      showToast("No se pudo cambiar de carrera para importar el progreso.");
      return;
    }
  }

  if ("progress" in parsed && !isPlainObject(parsed.progress)) {
    showToast("Archivo inválido: 'progress' debe ser un objeto.");
    return;
  }

  const rawProgress = parsed.progress ?? parsed;
  if (!isPlainObject(rawProgress)) {
    showToast("Archivo inválido: progreso incompatible.");
    return;
  }

  const nextProgress = Core.coerceProgressMap(rawProgress, MATERIAS_BY_ID);
  if (Object.keys(nextProgress).length === 0) {
    showToast("El archivo no contiene progreso válido para esta carrera.");
    return;
  }

  progress = nextProgress;
  normalizeProgressState();
  saveProgress();
  renderSemesters();
  drawArrows();
  updateCareerProgress();
  updateMilestones();
  showToast(`Progreso importado: ${Object.keys(nextProgress).length} materias cargadas.`);
}

function printInLightMode() {
  setToolsMenuOpen(false);
  const previousTheme = document.body.dataset.theme === "dark" ? "dark" : "light";
  setTheme("light");

  // Crear el encabezado de impresión dinámicamente
  const mainContainer = document.querySelector("main");
  const printHeader = document.createElement("div");
  printHeader.className = "print-header";
  printHeader.style.display = "none"; // Oculto por defecto, visible solo en print

  const { approved, total, percentage } = careerProgressInfo();
  const careerName = ACTIVE_PLAN_META?.carrera || ACTIVE_PLAN?.carrera || "Carrera";

  const title = document.createElement("h1");
  title.textContent = careerName;
  printHeader.appendChild(title);

  const summary = document.createElement("p");
  summary.textContent = `Progreso: ${approved} de ${total} materias aprobadas (${percentage}%)`;
  printHeader.appendChild(summary);

  if (mainContainer) {
    mainContainer.prepend(printHeader);
  }

  const restore = () => {
    setTheme(previousTheme);
    if (printHeader) {
      printHeader.remove();
    }
    window.removeEventListener("afterprint", restore);
  };

  window.addEventListener("afterprint", restore);
  window.print();
}

function getBasePath(url) {
  const normalized = String(url || "").replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index === -1) return "";
  return normalized.slice(0, index + 1);
}

function joinPath(basePath, file) {
  if (!file) return "";
  if (/^https?:\/\//i.test(file) || file.startsWith("/")) return file;
  return `${basePath}${file}`;
}

function resolveCatalogUrl() {
  return document.body?.dataset.catalog || DEFAULT_CATALOG_URL;
}

function resolveFallbackPlanUrl() {
  return document.body?.dataset.plan || DEFAULT_PLAN_URL;
}

function normalizeCatalogEntry(raw, basePath) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Entrada de catálogo inválida: se esperaba objeto.");
  }

  const materiasUrl = String(raw.materias || raw.materiasUrl || raw.plan || "").trim();
  const metadataUrl = String(raw.metadata || raw.metadataUrl || "").trim();
  if (!materiasUrl) {
    throw new Error("Entrada de catálogo inválida: falta ruta de materias.");
  }

  const slug = String(raw.slug || toPlanSlug(materiasUrl)).trim() || toPlanSlug(materiasUrl);
  const carrera = String(raw.carrera || raw.nombre || humanizeSlug(slug)).trim();
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error(`Entrada de catálogo inválida: slug incorrecto (${slug || "vacío"}).`);
  }
  if (!carrera) {
    throw new Error(`Entrada de catálogo inválida: carrera vacía para slug ${slug}.`);
  }
  if (!/\.json$/i.test(materiasUrl)) {
    throw new Error(`Entrada de catálogo inválida: materias debe ser .json (${materiasUrl}).`);
  }

  return {
    slug,
    carrera,
    materiasUrl: joinPath(basePath, materiasUrl),
    metadataUrl: metadataUrl ? joinPath(basePath, metadataUrl) : ""
  };
}

function fallbackCatalogFromPlanUrl(planUrl) {
  const slug = toPlanSlug(planUrl);
  return [
    {
      slug,
      carrera: humanizeSlug(slug),
      materiasUrl: planUrl,
      metadataUrl: planUrl.replace(/\.materias\.json$/i, ".json")
    }
  ];
}

async function fetchJson(url, label) {
  const resolvedUrl = new URL(String(url || ""), window.location.href);
  if (resolvedUrl.origin !== window.location.origin) {
    throw new Error(`Bloqueado por seguridad: ${label} no pertenece al mismo origen.`);
  }
  if (!/\.json$/i.test(resolvedUrl.pathname)) {
    throw new Error(`Bloqueado por seguridad: ${label} debe ser un archivo .json.`);
  }

  const response = await fetch(resolvedUrl.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.1" }
  });
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${label}: ${resolvedUrl.toString()} (HTTP ${response.status}).`);
  }
  return response.json();
}

async function loadPlanCatalog() {
  const catalogUrl = resolveCatalogUrl();
  const fallback = fallbackCatalogFromPlanUrl(resolveFallbackPlanUrl());

  try {
    const payload = await fetchJson(catalogUrl, "catálogo de carreras");
    const rawEntries = Array.isArray(payload) ? payload : Array.isArray(payload?.carreras) ? payload.carreras : [];
    if (!Array.isArray(rawEntries)) {
      throw new Error("Formato de catálogo inválido: se esperaba array de carreras.");
    }
    const basePath = getBasePath(catalogUrl);

    const catalog = rawEntries.map((entry) => normalizeCatalogEntry(entry, basePath));
    const slugSet = new Set();
    catalog.forEach((entry) => {
      if (slugSet.has(entry.slug)) {
        throw new Error(`Slug duplicado en catálogo: ${entry.slug}`);
      }
      slugSet.add(entry.slug);
    });

    return catalog.length > 0 ? catalog : fallback;
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function populateCareerSelect(catalog, selectedSlug) {
  const selects = getCareerSelectElements();
  if (selects.length === 0) return;

  const fallbackSlug = selectedSlug || catalog[0]?.slug || "";

  selects.forEach((select) => {
    select.innerHTML = "";
    catalog.forEach((plan) => {
      const option = document.createElement("option");
      option.value = plan.slug;
      option.textContent = plan.carrera;
      select.appendChild(option);
    });
    select.value = fallbackSlug;
    select.disabled = catalog.length <= 1;
  });

  const fabButton = document.getElementById("btn-career-fab");
  if (fabButton) {
    fabButton.hidden = catalog.length <= 1;
    if (fabButton.hidden) setCareerFabOpen(false);
  }
}

async function loadPlanData(plan) {
  const rawMaterias = await fetchJson(plan.materiasUrl, "plan de materias");
  const materias = Core.validateMateriasSchema(rawMaterias);

  let metadata = null;
  if (plan.metadataUrl) {
    try {
      const rawMetadata = await fetchJson(plan.metadataUrl, "metadata de carrera");
      metadata = Core.validateMetadataSchema(rawMetadata);
    } catch (error) {
      console.warn("Metadata inválida, se usará fallback:", error);
      metadata = null;
    }
  }

  return { materias, metadata };
}

async function activatePlan(plan, allowDemoFallback = false) {
  try {
    const { materias, metadata } = await loadPlanData(plan);

    ACTIVE_PLAN = plan;
    ACTIVE_PLAN_META = metadata || { carrera: plan.carrera, hitos: [] };

    setStorageKeyForSlug(plan.slug);
    milestonesPanelHidden = areMilestonesHidden();
    setMaterias(materias);
    progress = loadProgress();
    milestoneStateByKey = {};
    clearAchievementNotifications();
    clearRequirementHighlights();
    if (normalizeProgressState()) saveProgress();

    setCareerTitle(ACTIVE_PLAN_META.carrera || plan.carrera);
    setSubtitle(`Plan cargado (${MATERIAS.length} materias). Hacé clic en cada materia para registrar tu progreso.`);
    safeStorageSet(SELECTED_PLAN_KEY, plan.slug);
    setCareerSelectionValue(plan.slug);
    setCareerFabOpen(false);

    renderSemesters();
    drawArrows();
    updateCareerProgress();
    updateMilestones({ notify: false });

    return true;
  } catch (error) {
    console.error(error);

    if (!allowDemoFallback) {
      showToast("No se pudo cargar la carrera seleccionada.");
      return false;
    }

    ACTIVE_PLAN = {
      slug: "demo",
      carrera: "Demo mínima",
      materiasUrl: "",
      metadataUrl: ""
    };
    ACTIVE_PLAN_META = {
      carrera: "Demo mínima",
      hitos: [
        {
          tipo: "titulo_final",
          nombre: "Plan completo",
          criterio: { tipo: "plan_completo" }
        }
      ]
    };
    setStorageKeyForSlug("demo");
    milestonesPanelHidden = areMilestonesHidden();
    setMaterias(FALLBACK_MATERIAS);
    progress = loadProgress();
    milestoneStateByKey = {};
    clearAchievementNotifications();
    clearRequirementHighlights();
    if (normalizeProgressState()) saveProgress();

    setCareerTitle("Demo mínima");
    setSubtitle("No se pudo cargar el catálogo/plan. Se muestra la demo mínima.");
    showToast("Error cargando archivos JSON. Revisá data/planes/catalog.json.");
    ensureDemoOptionInSelects();
    setCareerSelectionValue("demo");
    setCareerFabOpen(false);

    renderSemesters();
    drawArrows();
    updateCareerProgress();
    updateMilestones({ notify: false });
    return false;
  }
}

function bindUiEvents() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawArrows();
      if (window.innerWidth > 768) setCareerFabOpen(false);
      if (toolsMenuOpen) setToolsMenuOpen(true);
    }, 80);
  });

  const themeButton = document.getElementById("btn-theme");
  if (themeButton) {
    themeButton.addEventListener("click", () => {
      toggleTheme();
      setToolsMenuOpen(false);
    });
  }

  const exportButton = document.getElementById("btn-export");
  if (exportButton) exportButton.addEventListener("click", exportProgress);

  const exportPngButton = document.getElementById("btn-export-png");
  if (exportPngButton) exportPngButton.addEventListener("click", exportAsPng);

  const importButton = document.getElementById("btn-import");
  const printButton = document.getElementById("btn-print");
  const importInput = document.getElementById("input-import-progress");
  if (printButton) printButton.addEventListener("click", printInLightMode);
  if (importButton && importInput) {
    importButton.addEventListener("click", () => {
      setToolsMenuOpen(false);
      importInput.click();
    });
    importInput.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const file = target.files?.[0];
      await importProgressFromFile(file);
      target.value = "";
    });
  }

  const showMilestonesButton = document.getElementById("btn-show-milestones");
  if (showMilestonesButton) {
    showMilestonesButton.addEventListener("click", () => {
      setMilestonesHidden(false);
      updateMilestones();
    });
  }

  const handleCareerChange = async (nextSlug) => {
    const selected = PLAN_CATALOG.find((item) => item.slug === nextSlug);
    if (!selected) return;

    const currentSlug = ACTIVE_PLAN?.slug || "";
    if (nextSlug === currentSlug) {
      setCareerFabOpen(false);
      return;
    }

    const ok = await activatePlan(selected, false);
    if (!ok) {
      setCareerSelectionValue(currentSlug);
    }
    setCareerFabOpen(false);
  };

  getCareerSelectElements().forEach((careerSelect) => {
    careerSelect.addEventListener("change", async (event) => {
      const nextSlug = String(event.target.value);
      await handleCareerChange(nextSlug);
    });
  });

  const careerFabButton = document.getElementById("btn-career-fab");
  if (careerFabButton) {
    careerFabButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setCareerFabOpen(!careerFabOpen);
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!(target instanceof Element) || !target.closest(".subject-card")) {
      clearRequirementHighlights();
    }
    const toolsMenu = document.getElementById("tools-menu");
    const toolsBtn = target instanceof Element ? target.closest("#btn-tools") : null;
    if (toolsMenuOpen && toolsMenu && !toolsMenu.contains(target) && !toolsBtn) {
      setToolsMenuOpen(false);
    }

    if (careerFabOpen) {
      const panel = document.getElementById("career-fab-panel");
      const button = document.getElementById("btn-career-fab");
      if (panel && button && !panel.contains(target) && !button.contains(target)) {
        setCareerFabOpen(false);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    clearRequirementHighlights();
    setToolsMenuOpen(false);
    setCareerFabOpen(false);
  });

  const floatingSelect = document.getElementById("career-select-floating");
  if (floatingSelect) {
    floatingSelect.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setCareerFabOpen(false);
    });
  }

  const onboardingOkButton = document.getElementById("btn-onboarding-ok");
  if (onboardingOkButton) {
    onboardingOkButton.addEventListener("click", () => hideOnboardingGuide(false));
  }

  const onboardingNeverButton = document.getElementById("btn-onboarding-never");
  if (onboardingNeverButton) {
    onboardingNeverButton.addEventListener("click", () => hideOnboardingGuide(true));
  }
}

async function init() {
  if (!Core) {
    console.error("No se pudo inicializar la app: core.js no está cargado.");
    return;
  }

  setTheme(resolvePreferredTheme());
  configureAuthorFooter();
  setToolsMenuOpen(false);

  const svg = document.getElementById("arrows-svg");
  if (svg) buildDefs(svg);
  bindUiEvents();

  PLAN_CATALOG = await loadPlanCatalog();

  const savedSlug = safeStorageGet(SELECTED_PLAN_KEY);
  const selectedPlan =
    PLAN_CATALOG.find((plan) => plan.slug === savedSlug) ||
    PLAN_CATALOG[0];

  populateCareerSelect(PLAN_CATALOG, selectedPlan?.slug);
  await activatePlan(selectedPlan, true);
  suppressAchievementNotifications = false;

  if (!isOnboardingDismissed()) {
    showOnboardingGuide();
  }
}

init();

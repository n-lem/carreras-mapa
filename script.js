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
const VIEW_MODE_KEY = "unpaz_view_mode";
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
let currentViewMode = "diagram";
let onboardingTourState = { active: false, stepIndex: 0, steps: [] };
let onboardingFocusedElement = null;
let accordionOpenBySemester = {};

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

function resolveSavedViewMode() {
  const mode = safeStorageGet(VIEW_MODE_KEY);
  return ["diagram", "list", "programs", "links"].includes(mode) ? mode : "diagram";
}

function updateViewModeControls() {
  const toggle = document.getElementById("view-mode-toggle");
  const diagramButton = document.getElementById("btn-view-diagram");
  const listButton = document.getElementById("btn-view-list");
  const programsButton = document.getElementById("btn-view-programs");
  const linksButton = document.getElementById("btn-view-links");
  if (!toggle || !diagramButton || !listButton || !programsButton || !linksButton) return;

  toggle.hidden = false;
  const states = [
    { button: diagramButton, active: currentViewMode === "diagram" },
    { button: listButton, active: currentViewMode === "list" },
    { button: programsButton, active: currentViewMode === "programs" },
    { button: linksButton, active: currentViewMode === "links" }
  ];

  states.forEach(({ button, active }) => {
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setViewMode(mode, options = {}) {
  const persist = options.persist !== false;
  const showMessage = options.showMessage === true;
  const nextMode = ["diagram", "list", "programs", "links"].includes(mode) ? mode : "diagram";
  if (nextMode === currentViewMode) {
    updateViewModeControls();
    return;
  }

  currentViewMode = nextMode;
  if (persist) safeStorageSet(VIEW_MODE_KEY, currentViewMode);
  updateViewModeControls();
  renderPlanView();
  if (onboardingTourState.active) renderOnboardingStep();

  if (showMessage) {
    const modeLabel = {
      diagram: "Vista diagrama activada.",
      list: "Vista lista activada.",
      programs: "Vista programas activada.",
      links: "Vista enlaces activada."
    };
    showToast(modeLabel[currentViewMode] || "Vista activada.");
  }
}

function isOnboardingDismissed() {
  if (navigator.webdriver) return true;
  return safeStorageGet(ONBOARDING_DISMISSED_KEY) === "1";
}

function setOnboardingDismissed(value) {
  safeStorageSet(ONBOARDING_DISMISSED_KEY, value ? "1" : "0");
}

function buildOnboardingSteps() {
  return [
    {
      title: "Bienvenido al mapa",
      body: "Este es un seguimiento no oficial de correlatividades de UNPAZ. Tus cambios se guardan en tu navegador.",
      getTarget: null
    },
    {
      title: "Cambiar estado de materia",
      body: "Tocá una materia para ciclar: Pendiente -> Regular -> Aprobada -> Pendiente.",
      getTarget: () => document.querySelector(".subject-card")
    },
    {
      title: "Cambio por cuatrimestre",
      body: "Tocá el título del cuatrimestre para cambiar todas las materias de ese bloque.",
      getTarget: () => document.querySelector(".semester-block, .semester-accordion-summary")
    },
    {
      title: "Herramientas",
      body: "Desde el engranaje podés exportar/importar progreso, imprimir y guardar PNG.",
      getTarget: () => document.getElementById("btn-tools")
    },
    {
      title: "Vista móvil alternativa",
      body: "Podés alternar entre Diagrama y Lista para navegar más cómodo.",
      getTarget: () => document.getElementById("view-mode-toggle")
    }
  ];
}

function setOnboardingBackdropVisible(visible) {
  const backdrop = document.getElementById("onboarding-backdrop");
  if (backdrop) backdrop.hidden = !visible;
  document.body.classList.toggle("onboarding-open", Boolean(visible));
}

function clearOnboardingFocus() {
  const focus = document.getElementById("onboarding-focus");
  if (focus) focus.hidden = true;
  if (onboardingFocusedElement) {
    onboardingFocusedElement.classList.remove("onboarding-target");
    onboardingFocusedElement = null;
  }
}

function placeOnboardingGuide(target) {
  const guide = document.getElementById("onboarding-guide");
  if (!guide) return;

  const margin = 12;
  guide.style.top = "";
  guide.style.left = "";
  guide.style.right = "";
  guide.style.bottom = "";
  guide.style.transform = "none";

  if (!target) {
    guide.style.top = "50%";
    guide.style.left = "50%";
    guide.style.transform = "translate(-50%, -50%)";
    return;
  }

  const rect = target.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const clamp = (value, min, max) => {
    if (max < min) return min;
    return Math.min(max, Math.max(min, value));
  };
  const overlapArea = (a, b) => {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  };

  if (viewportWidth <= 768) {
    const centeredLeft = clamp(
      (viewportWidth - guideRect.width) / 2,
      margin,
      viewportWidth - guideRect.width - margin
    );
    let top = viewportHeight - guideRect.height - margin;
    const overlapsBottom = rect.bottom >= top - margin;
    if (overlapsBottom) {
      top = margin;
    }

    guide.style.left = `${Math.round(centeredLeft)}px`;
    guide.style.top = `${Math.round(clamp(top, margin, viewportHeight - guideRect.height - margin))}px`;
    return;
  }

  const candidates = [
    {
      top: rect.bottom + margin,
      left: rect.left + (rect.width - guideRect.width) / 2
    },
    {
      top: rect.top - guideRect.height - margin,
      left: rect.left + (rect.width - guideRect.width) / 2
    },
    {
      top: rect.top + (rect.height - guideRect.height) / 2,
      left: rect.right + margin
    },
    {
      top: rect.top + (rect.height - guideRect.height) / 2,
      left: rect.left - guideRect.width - margin
    },
    {
      top: viewportHeight - guideRect.height - margin,
      left: (viewportWidth - guideRect.width) / 2
    },
    {
      top: margin,
      left: (viewportWidth - guideRect.width) / 2
    }
  ];

  let best = null;
  candidates.forEach((candidate, index) => {
    const left = clamp(candidate.left, margin, viewportWidth - guideRect.width - margin);
    const top = clamp(candidate.top, margin, viewportHeight - guideRect.height - margin);
    const box = {
      left,
      top,
      right: left + guideRect.width,
      bottom: top + guideRect.height
    };
    const overlap = overlapArea(box, rect);
    const centerDistance = Math.hypot(
      (box.left + box.right) / 2 - (rect.left + rect.right) / 2,
      (box.top + box.bottom) / 2 - (rect.top + rect.bottom) / 2
    );
    const score = overlap * 100000 + centerDistance + index * 0.001;
    if (!best || score < best.score) {
      best = { score, top, left };
    }
  });

  guide.style.top = `${Math.round(best?.top ?? margin)}px`;
  guide.style.left = `${Math.round(best?.left ?? margin)}px`;
}

function paintOnboardingFocus(target) {
  clearOnboardingFocus();
  if (!target) return;

  onboardingFocusedElement = target;
  onboardingFocusedElement.classList.add("onboarding-target");

  const focus = document.getElementById("onboarding-focus");
  if (!focus) return;

  const rect = target.getBoundingClientRect();
  const pad = 6;
  focus.style.top = `${Math.max(6, rect.top - pad)}px`;
  focus.style.left = `${Math.max(6, rect.left - pad)}px`;
  focus.style.width = `${Math.max(10, rect.width + pad * 2)}px`;
  focus.style.height = `${Math.max(10, rect.height + pad * 2)}px`;
  focus.hidden = false;
}

function renderOnboardingStep() {
  if (!onboardingTourState.active) return;

  const guide = document.getElementById("onboarding-guide");
  const title = document.getElementById("onboarding-title");
  const body = document.getElementById("onboarding-body");
  const counter = document.getElementById("onboarding-step-counter");
  const prevButton = document.getElementById("btn-onboarding-prev");
  const nextButton = document.getElementById("btn-onboarding-next");
  if (!guide || !title || !body || !counter || !prevButton || !nextButton) return;

  const { stepIndex, steps } = onboardingTourState;
  const step = steps[stepIndex];
  if (!step) return;

  title.textContent = step.title;
  body.textContent = step.body;
  counter.textContent = `Paso ${stepIndex + 1} de ${steps.length}`;
  prevButton.disabled = stepIndex === 0;
  nextButton.textContent = stepIndex >= steps.length - 1 ? "Finalizar" : "Siguiente";
  guide.hidden = false;
  setOnboardingBackdropVisible(true);

  const target = typeof step.getTarget === "function" ? step.getTarget() : null;
  if (target) {
    const targetRect = target.getBoundingClientRect();
    const edgeMargin = 72;
    const outOfView =
      targetRect.top < edgeMargin ||
      targetRect.bottom > window.innerHeight - edgeMargin ||
      targetRect.left < edgeMargin ||
      targetRect.right > window.innerWidth - edgeMargin;
    if (outOfView) {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    }
  }
  paintOnboardingFocus(target);
  placeOnboardingGuide(target);
}

function startOnboardingTour() {
  onboardingTourState = {
    active: true,
    stepIndex: 0,
    steps: buildOnboardingSteps()
  };
  renderOnboardingStep();
}

function showOnboardingGuide() {
  startOnboardingTour();
}

function hideOnboardingGuide(rememberDismiss = false) {
  const guide = document.getElementById("onboarding-guide");
  if (guide) guide.hidden = true;
  onboardingTourState.active = false;
  setOnboardingBackdropVisible(false);
  clearOnboardingFocus();
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

function getMissingCorrelativaGraph(id, targetState) {
  const requiredState = targetState === 2 ? 2 : 1;
  const missingIds = new Set();
  const edgeKeys = new Set();
  const visited = new Set();

  const visit = (materiaId) => {
    if (visited.has(materiaId)) return;
    visited.add(materiaId);

    const materia = MATERIAS_BY_ID[materiaId];
    if (!materia) return;

    materia.correlativas.forEach((correlativaId) => {
      const correlativaState = getState(correlativaId);
      if (correlativaState < requiredState) {
        missingIds.add(correlativaId);
        edgeKeys.add(`${correlativaId}->${materiaId}`);
        visit(correlativaId);
      }
    });
  };

  visit(id);
  return {
    missingIds: [...missingIds],
    edgeKeys: [...edgeKeys]
  };
}

function buildDefs(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const markerStates = [
    { key: "default", opacity: "0.22" },
    { key: "regular", opacity: "0.44" },
    { key: "approved", opacity: "0.82" }
  ];

  EDGE_COLORS.forEach((color, index) => {
    markerStates.forEach((state) => {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      marker.setAttribute("id", `arrowhead-${state.key}-${index}`);
      marker.setAttribute("markerWidth", "8");
      marker.setAttribute("markerHeight", "8");
      marker.setAttribute("refX", "6");
      marker.setAttribute("refY", "3");
      marker.setAttribute("orient", "auto");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M0,0 L0,6 L8,3 z");
      path.setAttribute("fill", color);
      path.setAttribute("fill-opacity", state.opacity);
      marker.appendChild(path);
      defs.appendChild(marker);
    });
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

function edgeVisualState(fromId, toId) {
  const fromState = getState(fromId);
  const toState = getState(toId);

  if (fromState === 2 && toState === 2) return "approved";
  if (fromState >= 1 && toState >= 1) return "regular";
  return "default";
}

function arrowClass(fromId, toId) {
  const visualState = edgeVisualState(fromId, toId);
  if (visualState === "approved") return "arrow-line state-approved";
  if (visualState === "regular") return "arrow-line state-regular";
  return "arrow-line";
}

function markerIdForEdge(toId, fromId) {
  const colorIndex = edgeColorIndexForMateria(toId);
  const visualState = edgeVisualState(fromId, toId);
  return `arrowhead-${visualState}-${colorIndex}`;
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

  document.querySelectorAll("#arrows-svg .arrow-line").forEach((line) => {
    const edgeKey = line.getAttribute("data-edge-key") || "";
    if (activeRequirementHighlight.edgeKeys.has(edgeKey)) {
      line.classList.add("requirement-active");
    }
  });
}

function clearRequirementHighlights() {
  document.querySelectorAll(".subject-card.unlock-target, .subject-card.required-for-unlock").forEach((card) => {
    card.classList.remove("unlock-target", "required-for-unlock");
  });
  document.querySelectorAll("#arrows-svg .arrow-line.requirement-active").forEach((line) => {
    line.classList.remove("requirement-active");
  });
  activeRequirementHighlight = null;
}

function setRequirementHighlights(targetId, missingIds, edgeKeys = []) {
  clearRequirementHighlights();
  if (!targetId || !Array.isArray(missingIds) || missingIds.length === 0) return;
  activeRequirementHighlight = {
    targetId,
    missingIds: new Set(missingIds),
    edgeKeys: new Set(edgeKeys)
  };
  paintRequirementHighlights();
}

function drawArrows() {
  const svg = document.getElementById("arrows-svg");
  if (!svg) return;
  if (currentViewMode !== "diagram") {
    [...svg.querySelectorAll("path.arrow-line")].forEach((line) => line.remove());
    return;
  }

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
      const markerId = markerIdForEdge(materia.id, correlativaId);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute("class", arrowClass(correlativaId, materia.id));
      path.setAttribute("data-edge-key", `${correlativaId}->${materia.id}`);
      path.style.setProperty("--edge-color", EDGE_COLORS[colorIndex]);
      path.setAttribute("marker-end", `url(#${markerId})`);
      svg.appendChild(path);
    });
  });

  if (activePathTargetId) {
    applyPathHighlights(activePathTargetId);
  }
  if (activeRequirementHighlight) {
    paintRequirementHighlights();
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
        `${cuatrimestre}° cuatrimestre. Cambiar todas las materias de este bloque.`
      );
      label.title = "Cambiar bloque: Pendiente -> Regular -> Aprobada -> Pendiente";
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

function renderSemestersAccordion() {
  const container = document.getElementById("semesters-accordion");
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
      const details = document.createElement("details");
      details.className = "semester-accordion";
      details.dataset.cuatrimestre = String(cuatrimestre);
      const stateKey = String(cuatrimestre);
      details.open = Object.prototype.hasOwnProperty.call(accordionOpenBySemester, stateKey)
        ? Boolean(accordionOpenBySemester[stateKey])
        : cuatrimestre <= 2;
      details.addEventListener("toggle", () => {
        accordionOpenBySemester[stateKey] = details.open;
      });

      const summary = document.createElement("summary");
      summary.className = "semester-accordion-summary";
      summary.textContent = `${cuatrimestre}° Cuatrimestre`;
      details.appendChild(summary);

      const actions = document.createElement("div");
      actions.className = "semester-accordion-actions";

      const quickCycleButton = document.createElement("button");
      quickCycleButton.type = "button";
      quickCycleButton.className = "semester-accordion-cycle";
      quickCycleButton.textContent = "Cambiar todo";
      quickCycleButton.setAttribute(
        "aria-label",
        `Cambiar todas las materias del ${cuatrimestre}° cuatrimestre`
      );
      quickCycleButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applySemesterCycleQuick(cuatrimestre);
      });
      actions.appendChild(quickCycleButton);
      details.appendChild(actions);

      const list = document.createElement("div");
      list.className = "subjects-accordion-list";
      grouped[cuatrimestre].forEach((materia) => list.appendChild(buildCard(materia)));
      details.appendChild(list);

      container.appendChild(details);
    });
}

function resolveProgramLinkEntry(materiaId) {
  const source = ACTIVE_PLAN_META?.programas || ACTIVE_PLAN_META?.programas_por_materia || null;
  const baseUrl = String(
    ACTIVE_PLAN_META?.programasBaseUrl ||
    ACTIVE_PLAN_META?.programas_base_url ||
    ""
  ).trim();

  if (Array.isArray(source)) {
    const match = source.find((item) => String(item?.id || item?.materiaId || "").trim() === materiaId);
    if (match) {
      const url = String(match.url || match.href || match.link || "").trim();
      const label = String(match.label || match.titulo || match.nombre || "Abrir programa").trim();
      if (url) return { url, label };
    }
  } else if (source && typeof source === "object") {
    const value = source[materiaId];
    if (typeof value === "string" && value.trim()) {
      return { url: value.trim(), label: "Abrir programa" };
    }
    if (value && typeof value === "object") {
      const url = String(value.url || value.href || value.link || "").trim();
      const label = String(value.label || value.titulo || value.nombre || "Abrir programa").trim();
      if (url) return { url, label };
    }
  }

  if (baseUrl) {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return {
      url: `${normalizedBase}${materiaId}.pdf`,
      label: "Abrir programa"
    };
  }

  return null;
}

function shouldHideUnavailablePrograms() {
  if (Object.prototype.hasOwnProperty.call(ACTIVE_PLAN_META || {}, "programasOcultarNoDisponibles")) {
    return Boolean(ACTIVE_PLAN_META.programasOcultarNoDisponibles);
  }
  return false;
}

function renderProgramsView() {
  const container = document.getElementById("programs-view");
  if (!container) return;

  container.innerHTML = "";
  container.className = "aux-view";
  const hideUnavailable = shouldHideUnavailablePrograms();
  let hiddenCount = 0;
  let renderedCount = 0;

  const grouped = MATERIAS.reduce((acc, materia) => {
    if (!acc[materia.cuatrimestre]) acc[materia.cuatrimestre] = [];
    acc[materia.cuatrimestre].push(materia);
    return acc;
  }, {});

  const cuatrimestres = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  if (cuatrimestres.length === 0) {
    const empty = document.createElement("p");
    empty.className = "aux-empty";
    empty.textContent = "No hay materias cargadas para esta carrera.";
    container.appendChild(empty);
    return;
  }

  cuatrimestres.forEach((cuatrimestre) => {
    const block = document.createElement("section");
    block.className = "aux-block";

    const title = document.createElement("h3");
    title.className = "aux-block-title";
    title.textContent = `${cuatrimestre}° Cuatrimestre`;
    block.appendChild(title);

    const list = document.createElement("ul");
    list.className = "programs-list";

    grouped[cuatrimestre].forEach((materia) => {
      const item = document.createElement("li");
      item.className = "program-item";

      const name = document.createElement("span");
      name.className = "program-item-name";
      name.textContent = `${materia.id} - ${materia.nombre}`;
      item.appendChild(name);

      const linkEntry = resolveProgramLinkEntry(materia.id);
      if (linkEntry?.url) {
        const link = document.createElement("a");
        link.className = "program-item-link";
        link.href = linkEntry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
        link.referrerPolicy = "no-referrer";
        link.textContent = "Abrir programa";
        item.appendChild(link);
        renderedCount += 1;
      } else {
        if (hideUnavailable) {
          hiddenCount += 1;
          return;
        }
        const missing = document.createElement("span");
        missing.className = "program-item-missing";
        missing.textContent = "Próximamente";
        item.appendChild(missing);
        renderedCount += 1;
      }

      list.appendChild(item);
    });

    if (list.children.length === 0) return;
    block.appendChild(list);
    container.appendChild(block);
  });

  if (renderedCount === 0) {
    const empty = document.createElement("p");
    empty.className = "aux-empty";
    empty.textContent = "No hay programas publicados para esta carrera.";
    container.appendChild(empty);
  } else if (hiddenCount > 0) {
    const note = document.createElement("p");
    note.className = "aux-note";
    note.textContent = `${hiddenCount} programas aún no publicados.`;
    container.appendChild(note);
  }
}

function normalizeInterestLinks() {
  const source = ACTIVE_PLAN_META?.enlaces || ACTIVE_PLAN_META?.links || [];
  if (!source) return [];

  if (Array.isArray(source)) {
    return source
      .map((item) => {
        const url = String(item?.url || item?.href || item?.link || "").trim();
        const titulo = String(item?.titulo || item?.title || item?.nombre || url).trim();
        const descripcion = String(item?.descripcion || item?.description || "").trim();
        if (!url) return null;
        return { url, titulo, descripcion };
      })
      .filter(Boolean);
  }

  if (source && typeof source === "object") {
    return Object.entries(source)
      .map(([titulo, value]) => {
        if (typeof value === "string" && value.trim()) {
          return { url: value.trim(), titulo: String(titulo).trim(), descripcion: "" };
        }
        if (value && typeof value === "object") {
          const url = String(value.url || value.href || value.link || "").trim();
          const label = String(value.titulo || value.title || value.nombre || titulo).trim();
          const descripcion = String(value.descripcion || value.description || "").trim();
          if (url) return { url, titulo: label, descripcion };
        }
        return null;
      })
      .filter(Boolean);
  }

  return [];
}

function renderLinksView() {
  const container = document.getElementById("links-view");
  if (!container) return;

  container.innerHTML = "";
  container.className = "aux-view";

  const links = normalizeInterestLinks();
  const fallbackLinks = [
    {
      titulo: "Sitio institucional UNPAZ",
      url: "https://www.unpaz.edu.ar/",
      descripcion: "Portal principal de la universidad."
    },
    {
      titulo: "Calendario académico",
      url: "https://www.unpaz.edu.ar/calendario-academico",
      descripcion: "Fechas de cursada, exámenes y recesos."
    },
    {
      titulo: "Campus virtual",
      url: "https://campus.unpaz.edu.ar/",
      descripcion: "Acceso a aulas y material de cursada."
    },
    {
      titulo: "Biblioteca UNPAZ",
      url: "https://www.unpaz.edu.ar/biblioteca",
      descripcion: "Catálogo y recursos de biblioteca."
    }
  ];
  const effectiveLinks = links.length > 0 ? links : fallbackLinks;

  const list = document.createElement("div");
  list.className = "links-list";

  effectiveLinks.forEach((item) => {
    const card = document.createElement("article");
    card.className = "link-card";

    const title = document.createElement("a");
    title.className = "link-card-title";
    title.href = item.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = item.titulo;
    card.appendChild(title);

    if (item.descripcion) {
      const description = document.createElement("p");
      description.className = "link-card-description";
      description.textContent = item.descripcion;
      card.appendChild(description);
    }

    list.appendChild(card);
  });

  container.appendChild(list);
}

function renderPlanView() {
  const diagramContainer = document.getElementById("semesters");
  const accordionContainer = document.getElementById("semesters-accordion");
  const programsContainer = document.getElementById("programs-view");
  const linksContainer = document.getElementById("links-view");
  const svg = document.getElementById("arrows-svg");
  if (!diagramContainer || !accordionContainer || !programsContainer || !linksContainer || !svg) return;

  clearPathHighlights();
  if (currentViewMode === "list") {
    const currentOpenState = {};
    accordionContainer.querySelectorAll(".semester-accordion[data-cuatrimestre]").forEach((details) => {
      const key = details.getAttribute("data-cuatrimestre");
      if (key) currentOpenState[key] = details.open;
    });
    accordionOpenBySemester = { ...accordionOpenBySemester, ...currentOpenState };
  }
  programsContainer.hidden = true;
  programsContainer.innerHTML = "";
  linksContainer.hidden = true;
  linksContainer.innerHTML = "";

  if (currentViewMode === "list") {
    diagramContainer.hidden = true;
    diagramContainer.innerHTML = "";
    accordionContainer.hidden = false;
    renderSemestersAccordion();
    svg.style.display = "none";
    drawArrows();
    paintRequirementHighlights();
    return;
  }

  if (currentViewMode === "programs") {
    diagramContainer.hidden = true;
    diagramContainer.innerHTML = "";
    accordionContainer.hidden = true;
    accordionContainer.innerHTML = "";
    svg.style.display = "none";
    programsContainer.hidden = false;
    renderProgramsView();
    drawArrows();
    return;
  }

  if (currentViewMode === "links") {
    diagramContainer.hidden = true;
    diagramContainer.innerHTML = "";
    accordionContainer.hidden = true;
    accordionContainer.innerHTML = "";
    svg.style.display = "none";
    linksContainer.hidden = false;
    renderLinksView();
    drawArrows();
    return;
  }

  diagramContainer.hidden = false;
  accordionContainer.hidden = true;
  accordionContainer.innerHTML = "";
  svg.style.display = "";
  renderSemesters();
  drawArrows();
  paintRequirementHighlights();
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
  renderPlanView();
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

  if (onboardingTourState.active) {
    renderOnboardingStep();
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
    const missingGraph = getMissingCorrelativaGraph(id, nextState);
    if (nextState === 1) {
      showToast(`Para pasar a Regular necesitás correlativas en Regular/Aprobada: ${missing}.`);
    } else {
      showToast(`Para pasar a Aprobada necesitás correlativas Aprobadas: ${missing}.`);
    }
    setRequirementHighlights(id, missingGraph.missingIds, missingGraph.edgeKeys);
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
  renderPlanView();
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
  renderPlanView();
  updateCareerProgress();
  updateMilestones();
  showToast(`Progreso importado: ${Object.keys(nextProgress).length} materias cargadas.`);
}

function printInLightMode() {
  setToolsMenuOpen(false);
  const previousTheme = document.body.dataset.theme === "dark" ? "dark" : "light";
  const previousViewMode = currentViewMode;
  if (currentViewMode !== "diagram") {
    setViewMode("diagram", { persist: false, showMessage: false });
  }
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
    if (currentViewMode !== previousViewMode) {
      currentViewMode = previousViewMode;
      updateViewModeControls();
      renderPlanView();
    }
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
    accordionOpenBySemester = {};
    clearAchievementNotifications();
    clearRequirementHighlights();
    if (normalizeProgressState()) saveProgress();

    setCareerTitle(ACTIVE_PLAN_META.carrera || plan.carrera);
    setSubtitle(`Plan cargado (${MATERIAS.length} materias). Hacé clic en cada materia para registrar tu progreso.`);
    safeStorageSet(SELECTED_PLAN_KEY, plan.slug);
    setCareerSelectionValue(plan.slug);
    setCareerFabOpen(false);

    renderPlanView();
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
    accordionOpenBySemester = {};
    clearAchievementNotifications();
    clearRequirementHighlights();
    if (normalizeProgressState()) saveProgress();

    setCareerTitle("Demo mínima");
    setSubtitle("No se pudo cargar el catálogo/plan. Se muestra la demo mínima.");
    showToast("Error cargando archivos JSON. Revisá data/planes/catalog.json.");
    ensureDemoOptionInSelects();
    setCareerSelectionValue("demo");
    setCareerFabOpen(false);

    renderPlanView();
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
      if (onboardingTourState.active) renderOnboardingStep();
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

  const viewDiagramButton = document.getElementById("btn-view-diagram");
  if (viewDiagramButton) {
    viewDiagramButton.addEventListener("click", () => {
      setViewMode("diagram", { persist: true, showMessage: true });
    });
  }

  const viewListButton = document.getElementById("btn-view-list");
  if (viewListButton) {
    viewListButton.addEventListener("click", () => {
      setViewMode("list", { persist: true, showMessage: true });
    });
  }

  const viewProgramsButton = document.getElementById("btn-view-programs");
  if (viewProgramsButton) {
    viewProgramsButton.addEventListener("click", () => {
      setViewMode("programs", { persist: true, showMessage: true });
    });
  }

  const viewLinksButton = document.getElementById("btn-view-links");
  if (viewLinksButton) {
    viewLinksButton.addEventListener("click", () => {
      setViewMode("links", { persist: true, showMessage: true });
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
    if (onboardingTourState.active) hideOnboardingGuide(false);
  });

  const floatingSelect = document.getElementById("career-select-floating");
  if (floatingSelect) {
    floatingSelect.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setCareerFabOpen(false);
    });
  }

  const onboardingPrevButton = document.getElementById("btn-onboarding-prev");
  if (onboardingPrevButton) {
    onboardingPrevButton.addEventListener("click", () => {
      if (!onboardingTourState.active) return;
      onboardingTourState.stepIndex = Math.max(0, onboardingTourState.stepIndex - 1);
      renderOnboardingStep();
    });
  }

  const onboardingNextButton = document.getElementById("btn-onboarding-next");
  if (onboardingNextButton) {
    onboardingNextButton.addEventListener("click", () => {
      if (!onboardingTourState.active) return;
      if (onboardingTourState.stepIndex >= onboardingTourState.steps.length - 1) {
        hideOnboardingGuide(false);
        return;
      }
      onboardingTourState.stepIndex += 1;
      renderOnboardingStep();
    });
  }

  const onboardingCloseButton = document.getElementById("btn-onboarding-close");
  if (onboardingCloseButton) {
    onboardingCloseButton.addEventListener("click", () => hideOnboardingGuide(false));
  }

  const onboardingNeverButton = document.getElementById("btn-onboarding-never");
  if (onboardingNeverButton) {
    onboardingNeverButton.addEventListener("click", () => hideOnboardingGuide(true));
  }

  window.addEventListener("scroll", () => {
    if (onboardingTourState.active) renderOnboardingStep();
  }, { passive: true });
}

async function init() {
  if (!Core) {
    console.error("No se pudo inicializar la app: core.js no está cargado.");
    return;
  }

  setTheme(resolvePreferredTheme());
  configureAuthorFooter();
  setToolsMenuOpen(false);
  currentViewMode = resolveSavedViewMode();
  updateViewModeControls();

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

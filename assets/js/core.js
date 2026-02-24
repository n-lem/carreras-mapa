(function initUnpazCore(globalScope) {
  "use strict";

  const VALID_STATES = new Set([0, 1, 2]);

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

  function validateMateriasSchema(rawMaterias) {
    if (!Array.isArray(rawMaterias)) {
      throw new Error("El JSON de materias debe ser un array.");
    }

    const materias = rawMaterias.map((raw, index) => {
      if (!isPlainObject(raw)) {
        throw new Error(`Materia inválida en índice ${index}: se esperaba un objeto.`);
      }

      const normalized = normalizeMateria(raw);
      if (!normalized) {
        throw new Error(
          `Materia inválida en índice ${index}: requiere id, nombre, cuatrimestre y correlativas válidas.`
        );
      }
      return normalized;
    });

    if (materias.length === 0) {
      throw new Error("El plan JSON no contiene materias válidas.");
    }

    const ids = materias.map((materia) => materia.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      const uniqueDuplicates = unique(duplicates).slice(0, 10).join(", ");
      throw new Error(`Hay IDs de materias duplicados: ${uniqueDuplicates}.`);
    }

    const idSet = new Set(ids);
    const missingCorrelativas = [];
    materias.forEach((materia) => {
      materia.correlativas.forEach((correlativaId) => {
        if (!idSet.has(correlativaId)) {
          missingCorrelativas.push(`${materia.id}->${correlativaId}`);
        }
      });
    });
    if (missingCorrelativas.length > 0) {
      throw new Error(
        `Hay correlativas que no existen en el plan: ${missingCorrelativas.slice(0, 12).join(", ")}.`
      );
    }

    return materias.sort((a, b) => {
      if (a.cuatrimestre !== b.cuatrimestre) return a.cuatrimestre - b.cuatrimestre;
      return a.id.localeCompare(b.id);
    });
  }

  function validateMetadataSchema(rawMetadata) {
    if (rawMetadata == null) {
      return null;
    }
    if (!isPlainObject(rawMetadata)) {
      throw new Error("La metadata de carrera debe ser un objeto JSON.");
    }

    const metadata = { ...rawMetadata };
    if ("carrera" in metadata && typeof metadata.carrera !== "string") {
      throw new Error("metadata.carrera debe ser string.");
    }

    if ("hitos" in metadata && !Array.isArray(metadata.hitos)) {
      throw new Error("metadata.hitos debe ser un array.");
    }

    if (Array.isArray(metadata.hitos)) {
      metadata.hitos = metadata.hitos.filter((item) => isPlainObject(item)).map((item) => {
        const normalized = { ...item };
        if ("tipo" in normalized) normalized.tipo = String(normalized.tipo || "").trim();
        if ("nombre" in normalized) normalized.nombre = String(normalized.nombre || "").trim();
        return normalized;
      });
    }

    return metadata;
  }

  function buildIndexes(materias) {
    const byId = Object.fromEntries(materias.map((materia) => [materia.id, materia]));
    const dependents = materias.reduce((acc, materia) => {
      materia.correlativas.forEach((correlativaId) => {
        if (!acc[correlativaId]) acc[correlativaId] = [];
        acc[correlativaId].push(materia.id);
      });
      return acc;
    }, {});
    return { byId, dependents };
  }

  function getState(progressMap, id) {
    return progressMap[id] ?? 0;
  }

  function canAdvanceTo(id, targetState, progressMap, materiasById) {
    const materia = materiasById[id];
    if (!materia) return false;

    if (targetState === 1) {
      return materia.correlativas.every((cid) => getState(progressMap, cid) >= 1);
    }

    if (targetState === 2) {
      return materia.correlativas.every((cid) => getState(progressMap, cid) === 2);
    }

    return true;
  }

  function coerceProgressMap(rawMap, materiasById) {
    if (!isPlainObject(rawMap)) return {};

    const valid = {};
    Object.entries(rawMap).forEach(([id, state]) => {
      if (!materiasById[id]) return;
      if (VALID_STATES.has(state)) valid[id] = state;
    });
    return valid;
  }

  function normalizeProgressMap(progressMap, materias, materiasById) {
    const nextProgress = { ...progressMap };
    let changed = false;
    let keepFixing = true;

    while (keepFixing) {
      keepFixing = false;
      materias.forEach((materia) => {
        const state = getState(nextProgress, materia.id);
        if (state === 0) return;

        if (state === 1 && !canAdvanceTo(materia.id, 1, nextProgress, materiasById)) {
          nextProgress[materia.id] = 0;
          changed = true;
          keepFixing = true;
          return;
        }

        if (state === 2 && !canAdvanceTo(materia.id, 2, nextProgress, materiasById)) {
          nextProgress[materia.id] = canAdvanceTo(materia.id, 1, nextProgress, materiasById) ? 1 : 0;
          changed = true;
          keepFixing = true;
        }
      });
    }

    return { progress: nextProgress, changed };
  }

  function getBlockingDependents(id, progressMap, dependents, materiasById) {
    const dependentIds = dependents[id] ?? [];
    return dependentIds
      .map((dependentId) => materiasById[dependentId])
      .filter((materia) => materia && getState(progressMap, materia.id) > 0);
  }

  function getMissingCorrelativas(id, targetState, progressMap, materiasById) {
    const materia = materiasById[id];
    if (!materia) return [];

    return materia.correlativas
      .filter((correlativaId) => getState(progressMap, correlativaId) < targetState)
      .map((correlativaId) => materiasById[correlativaId]?.nombre || correlativaId);
  }

  function getSemesterCycleTarget(cuatrimestre, materias, progressMap) {
    const ids = materias
      .filter((materia) => materia.cuatrimestre === cuatrimestre)
      .map((materia) => materia.id);

    if (ids.length === 0) return 1;

    const states = ids.map((id) => getState(progressMap, id));
    if (states.every((state) => state === 2)) return 0;
    if (states.every((state) => state >= 1)) return 2;
    return 1;
  }

  function applySemesterTargetAction(params) {
    const {
      cuatrimestre,
      targetState,
      progressMap,
      materias,
      materiasById,
      dependents
    } = params;

    const semesterIds = materias
      .filter((materia) => materia.cuatrimestre === cuatrimestre)
      .map((materia) => materia.id);

    const snapshot = { ...progressMap };
    const changedIds = [];
    const blocked = [];
    const semesterSet = new Set(semesterIds);

    if (targetState === 0) {
      semesterIds.forEach((id) => {
        const current = snapshot[id] ?? 0;
        if (current === 0) return;

        const blockers = (dependents[id] ?? [])
          .map((depId) => materiasById[depId])
          .filter((materia) => {
            if (!materia) return false;
            const depState = snapshot[materia.id] ?? 0;
            return depState > 0 && !semesterSet.has(materia.id);
          });

        if (blockers.length > 0) {
          blocked.push({ id, reason: "dependents", blockers: blockers.map((item) => item.id) });
          return;
        }

        snapshot[id] = 0;
        changedIds.push(id);
      });
    } else {
      let keepUpdating = true;
      let safety = 0;

      while (keepUpdating && safety < semesterIds.length * 4) {
        keepUpdating = false;
        safety += 1;

        semesterIds.forEach((id) => {
          const current = snapshot[id] ?? 0;
          let next = current;

          if (targetState === 1) {
            if (current < 1 && canAdvanceTo(id, 1, snapshot, materiasById)) {
              next = 1;
            }
          } else {
            if (canAdvanceTo(id, 2, snapshot, materiasById)) {
              next = Math.max(next, 2);
            } else if (current < 1 && canAdvanceTo(id, 1, snapshot, materiasById)) {
              next = 1;
            }
          }

          if (next !== current) {
            snapshot[id] = next;
            if (!changedIds.includes(id)) changedIds.push(id);
            keepUpdating = true;
          }
        });
      }

      semesterIds.forEach((id) => {
        const current = snapshot[id] ?? 0;
        if (targetState === 1 && current === 0 && !canAdvanceTo(id, 1, snapshot, materiasById)) {
          blocked.push({ id, reason: "correlativas_regular", blockers: [] });
        }
        if (targetState === 2 && current < 2 && !canAdvanceTo(id, 2, snapshot, materiasById)) {
          blocked.push({ id, reason: "correlativas_aprobada", blockers: [] });
        }
      });
    }

    return { progress: snapshot, semesterIds, changedIds, blocked };
  }

  function applySemesterCycleAction(params) {
    const targetState = getSemesterCycleTarget(
      params.cuatrimestre,
      params.materias,
      params.progressMap
    );
    const result = applySemesterTargetAction({ ...params, targetState });
    return { ...result, targetState };
  }

  const api = {
    VALID_STATES: [0, 1, 2],
    unique,
    normalizeMateria,
    validateMateriasSchema,
    validateMetadataSchema,
    buildIndexes,
    coerceProgressMap,
    canAdvanceTo,
    normalizeProgressMap,
    getBlockingDependents,
    getMissingCorrelativas,
    getSemesterCycleTarget,
    applySemesterTargetAction,
    applySemesterCycleAction
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.UnpazCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);

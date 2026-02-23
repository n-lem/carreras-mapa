const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

function sampleMaterias() {
  return Core.validateMateriasSchema([
    { id: "A", nombre: "Intro", cuatrimestre: 1, correlativas: [] },
    { id: "B", nombre: "Algo", cuatrimestre: 2, correlativas: ["A"] },
    { id: "C", nombre: "POO", cuatrimestre: 2, correlativas: ["B"] },
    { id: "D", nombre: "Redes", cuatrimestre: 3, correlativas: ["B"] }
  ]);
}

test("canAdvanceTo: Regular requiere correlativas en >= Regular", () => {
  const materias = sampleMaterias();
  const { byId } = Core.buildIndexes(materias);
  const progress = {};

  assert.equal(Core.canAdvanceTo("B", 1, progress, byId), false);
  assert.equal(Core.canAdvanceTo("A", 1, progress, byId), true);
  progress.A = 1;
  assert.equal(Core.canAdvanceTo("B", 1, progress, byId), true);
});

test("canAdvanceTo: Aprobada requiere correlativas en Aprobada", () => {
  const materias = sampleMaterias();
  const { byId } = Core.buildIndexes(materias);
  const progress = { A: 1 };

  assert.equal(Core.canAdvanceTo("B", 2, progress, byId), false);
  progress.A = 2;
  assert.equal(Core.canAdvanceTo("B", 2, progress, byId), true);
});

test("applySemesterCycleAction: 0->1->2->0 según reglas", () => {
  const materias = sampleMaterias();
  const { byId, dependents } = Core.buildIndexes(materias);
  let progress = {};

  // Cuatrimestre 1 (A): 0 -> 1
  let result = Core.applySemesterCycleAction({
    cuatrimestre: 1,
    progressMap: progress,
    materias,
    materiasById: byId,
    dependents
  });
  progress = result.progress;
  assert.equal(progress.A, 1);

  // Cuatrimestre 1 (A): 1 -> 2
  result = Core.applySemesterCycleAction({
    cuatrimestre: 1,
    progressMap: progress,
    materias,
    materiasById: byId,
    dependents
  });
  progress = result.progress;
  assert.equal(progress.A, 2);

  // Cuatrimestre 1 (A): 2 -> 0 (sin dependientes activos aún)
  result = Core.applySemesterCycleAction({
    cuatrimestre: 1,
    progressMap: progress,
    materias,
    materiasById: byId,
    dependents
  });
  progress = result.progress;
  assert.equal(progress.A, 0);
});

test("applySemesterTargetAction target 0 bloquea por dependientes fuera del cuatrimestre", () => {
  const materias = sampleMaterias();
  const { byId, dependents } = Core.buildIndexes(materias);
  const progress = { A: 2, B: 1 }; // B depende de A y está fuera del cuatri 1

  const result = Core.applySemesterTargetAction({
    cuatrimestre: 1,
    targetState: 0,
    progressMap: progress,
    materias,
    materiasById: byId,
    dependents
  });

  assert.equal(result.progress.A, 2);
  assert.equal(result.changedIds.length, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].id, "A");
});

test("normalizeProgressMap corrige inconsistencias", () => {
  const materias = sampleMaterias();
  const { byId } = Core.buildIndexes(materias);
  const progress = { A: 0, B: 2 }; // B aprobada sin A aprobada

  const result = Core.normalizeProgressMap(progress, materias, byId);
  assert.equal(result.changed, true);
  assert.equal(result.progress.B, 0);
});

test("validateMateriasSchema rechaza correlativas inexistentes", () => {
  assert.throws(
    () =>
      Core.validateMateriasSchema([
        { id: "X1", nombre: "Base", cuatrimestre: 1, correlativas: [] },
        { id: "X2", nombre: "Avanzada", cuatrimestre: 2, correlativas: ["X999"] }
      ]),
    /correlativas/i
  );
});

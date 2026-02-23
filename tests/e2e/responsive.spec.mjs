import { test, expect } from "@playwright/test";

test("desktop: selector principal visible y FAB oculto", async ({ page }) => {
  test.skip(page.viewportSize()?.width < 900, "Caso exclusivo desktop.");
  await page.goto("/");

  await expect(page.locator("#career-select")).toBeVisible();
  await expect(page.locator("#btn-career-fab")).toBeHidden();
  await expect(page.locator(".semester-label").first()).toBeVisible();
});

test("mobile: FAB visible, selector desktop oculto y 2 columnas en cuatrimestre", async ({ page }) => {
  test.skip(page.viewportSize()?.width > 768, "Caso exclusivo mobile/tablet.");
  await page.goto("/");

  await expect(page.locator("#btn-career-fab")).toBeVisible();
  await expect(page.locator("#career-select")).toBeHidden();

  const firstRow = page.locator(".subjects-row").first();
  const cards = firstRow.locator(".subject-card");
  await expect(cards.nth(1)).toBeVisible();

  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs(firstBox.x - secondBox.x)).toBeGreaterThan(40);
});

test("clic en cuatrimestre aplica ciclo rápido a sus materias", async ({ page }) => {
  await page.goto("/");

  const firstStatus = page.locator(".subject-card .subject-status").first();
  await expect(firstStatus).toContainText(/Pendiente/i);

  const firstSemesterLabel = page.locator(".semester-label").first();
  await firstSemesterLabel.click();
  await expect(firstStatus).toContainText(/Regular|Aprobada/i);
});

test("herramientas: exportar/importar quedan ocultas hasta abrir menú", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#tools-menu")).toBeHidden();
  await page.locator("#btn-tools").click();
  await expect(page.locator("#tools-menu")).toBeVisible();
  await expect(page.locator("#btn-export")).toContainText(/Exportar progreso/i);
  await expect(page.locator("#btn-import")).toContainText(/Importar progreso/i);
});

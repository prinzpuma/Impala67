import assert from "node:assert/strict";

export async function runTablesTests(harness) {
	const { page, createPage, getBlocks, getSerialized, waitAutosave } = harness;
	const results = [];

	async function testCase(name, fn) {
		const start = Date.now();
		try {
			await fn();
			results.push({ name, passed: true, durationMs: Date.now() - start });
		} catch (err) {
			results.push({ name, passed: false, error: err.message, stack: err.stack, durationMs: Date.now() - start });
		}
	}

	await testCase("Table GFM Parsing and Rendering", async () => {
		const tableMd = `| Spalte A | Spalte B | Spalte C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |`;
		await createPage({ title: "Table GFM", content: tableMd });
		await waitAutosave(300);

		const cells = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor [data-bcell]")).map(el => el.textContent.trim())
		);
		assert.equal(cells.length, 9, "9 table cells (3x3 grid)");
		assert.deepEqual(cells, ["Spalte A", "Spalte B", "Spalte C", "1", "2", "3", "4", "5", "6"]);
	});

	await testCase("Add Row and Column Buttons", async () => {
		const tableMd = `| A | B |
| --- | --- |
| 1 | 2 |`;
		await createPage({ title: "Table Grow Buttons", content: tableMd });
		await waitAutosave(200);

		// Click Add Column button
		await page.click('#blockEditor [data-btablecol]');
		await waitAutosave(200);

		let cellCount = await page.evaluate(() => document.querySelectorAll("#blockEditor [data-bcell]").length);
		assert.equal(cellCount, 6, "Column added: 2 rows x 3 cols = 6 cells");

		// Click Add Row button
		await page.click('#blockEditor [data-btablerow]');
		await waitAutosave(200);

		cellCount = await page.evaluate(() => document.querySelectorAll("#blockEditor [data-bcell]").length);
		assert.equal(cellCount, 9, "Row added: 3 rows x 3 cols = 9 cells");
	});

	await testCase("Table Navigation with Tab, Enter, and Auto-growth", async () => {
		const tableMd = `| H1 | H2 |
| --- | --- |
| R1C1 | R1C2 |`;
		await createPage({ title: "Table Nav", content: tableMd });
		await waitAutosave(200);

		// Focus cell (1, 1) - bottom right
		await page.evaluate(() => {
			const cell = document.querySelector('[data-bcell$=":1:1"]');
			cell.focus();
		});

		// Press Tab -> should append new row and focus (2, 0)
		await page.keyboard.press("Tab");
		await waitAutosave(200);

		let focusedCell = await page.evaluate(() => document.activeElement.dataset.bcell);
		assert.ok(focusedCell && focusedCell.endsWith(":2:0"), `Tab from last cell appended row: ${focusedCell}`);

		// Press Enter -> should append another row and focus (3, 0)
		await page.keyboard.press("Enter");
		await waitAutosave(200);

		focusedCell = await page.evaluate(() => document.activeElement.dataset.bcell);
		assert.ok(focusedCell && focusedCell.endsWith(":3:0"), `Enter from last row appended row: ${focusedCell}`);
	});

	await testCase("Backspace Safety in Cell (0,0) Prevents Accidental Table Deletion", async () => {
		const tableMd = `| A | B |
| --- | --- |
| 1 | 2 |`;
		await createPage({ title: "Table Backspace Safety", content: tableMd });
		await waitAutosave(200);

		// Clear cell (0,0) and press Backspace
		await page.evaluate(() => {
			const cell = document.querySelector('[data-bcell$=":0:0"]');
			cell.textContent = "";
			cell.focus();
		});

		await page.keyboard.press("Backspace");
		await waitAutosave(200);

		const hasTable = await page.evaluate(() => document.querySelector("#blockEditor .blk-table") !== null);
		assert.ok(hasTable, "Table was not destroyed by Backspace in cell (0,0)");
	});

	return results;
}

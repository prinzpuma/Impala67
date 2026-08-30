import assert from "node:assert/strict";

export async function runSlashCommandsLinksTests(harness) {
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

	await testCase("Slash Menu Opening, Filtering, Keyboard Navigation and Esc", async () => {
		await createPage({ title: "Slash Nav" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("/to");
		await waitAutosave(100);

		// Menu should be open
		let menuExists = await page.evaluate(() => document.querySelector(".blk-slashmenu") !== null);
		assert.ok(menuExists, "Slash menu is open");

		// Filtered items should include todo and toggle
		let items = await page.evaluate(() =>
			Array.from(document.querySelectorAll(".blk-slashmenu .blk-mi")).map(el => el.dataset.slashpick)
		);
		assert.ok(items.includes("todo") || items.includes("toggle"), "Filtered list contains todo or toggle");

		// Navigate with ArrowDown
		await page.keyboard.press("ArrowDown");
		// Close with Escape
		await page.keyboard.press("Escape");
		await waitAutosave(100);

		menuExists = await page.evaluate(() => document.querySelector(".blk-slashmenu") !== null);
		assert.equal(menuExists, false, "Slash menu closed on Escape");
	});

	await testCase("Slash Command: /table Inserts 2x2 Grid and Focuses First Cell", async () => {
		await createPage({ title: "Slash Table" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("/table");
		await waitAutosave(100);

		await page.click('.blk-slashmenu [data-slashpick="table"]');
		await waitAutosave(200);

		const hasTable = await page.evaluate(() => document.querySelector("#blockEditor .blk-table") !== null);
		assert.ok(hasTable, "Table DOM element created");

		const focusedCell = await page.evaluate(() => document.activeElement.dataset.bcell);
		assert.ok(focusedCell && focusedCell.endsWith(":0:0"), `Focused first cell: ${focusedCell}`);
	});

	await testCase("Slash Command: /columns Creates 2 Columns Layout", async () => {
		await createPage({ title: "Slash Columns" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("/columns");
		await waitAutosave(100);

		await page.click('.blk-slashmenu [data-slashpick="columns"]');
		await waitAutosave(200);

		const cols = await page.evaluate(() =>
			document.querySelectorAll("#blockEditor .blk-columns .blk-column").length
		);
		assert.equal(cols, 2, "2 columns created");

		const focused = await page.evaluate(() =>
			document.activeElement.closest(".blk-column") !== null
		);
		assert.ok(focused, "Focus placed inside column");
	});

	await testCase("Slash Command: /callout and /toggle", async () => {
		await createPage({ title: "Slash Callout and Toggle" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("/callout");
		await waitAutosave(100);
		await page.click('.blk-slashmenu [data-slashpick="callout"]');
		await waitAutosave(200);

		await page.keyboard.type("Callout content");
		await page.keyboard.press("Enter");

		// Append new block at tail
		await page.click('#blockEditor [data-btail="1"]');
		await page.keyboard.type("/toggle");
		await waitAutosave(100);
		await page.click('.blk-slashmenu [data-slashpick="toggle"]');
		await waitAutosave(200);

		await page.keyboard.type("Toggle summary header");

		await waitAutosave(300);
		const md = await getSerialized();
		assert.ok(md.includes("> [!blue]") || md.includes("> Callout content"), "Callout in serialized markdown");
		assert.ok(md.includes("<details") && md.includes("<summary>Toggle summary header</summary>"), "Toggle in serialized markdown");
	});

	await testCase("Page Linking [[ Integration and Navigation", async () => {
		// Create target page first
		const targetId = await harness.page.evaluate(async () => {
			const id = "target_" + Math.random().toString(36).slice(2, 8);
			await window.STATE.dispatch("pageCreate", {
				id,
				title: "Destination Knowledge Note",
				content: "Destination content body",
				kind: "note",
				workspaceId: "default"
			});
			return id;
		});

		// Create source page
		await createPage({ title: "Source Page With Link" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Check this out: [[Dest");
		await waitAutosave(300);

		// Link menu should appear
		const linkMenuExists = await page.evaluate(() => document.querySelector(".blk-linkmenu") !== null);
		assert.ok(linkMenuExists, "Link menu opened for [[");

		// Click target item
		await page.click(`.blk-linkmenu [data-linkpick="${targetId}"]`);
		await waitAutosave(300);

		const md = await getSerialized();
		assert.ok(md.includes(`[Destination Knowledge Note](#${targetId})`), "Markdown contains page link");

		// Click link in editor
		await page.click(`a[href="#${targetId}"]`);
		await waitAutosave(300);

		const currentActiveId = await page.evaluate(() => window.S.activePageId);
		assert.equal(currentActiveId, targetId, "Navigated to linked target page on click");
	});

	return results;
}

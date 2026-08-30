import assert from "node:assert/strict";

export async function runUndoRedoPersistenceTests(harness) {
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

	await testCase("Undo / Redo with Keyboard (Ctrl+Z / Ctrl+Y)", async () => {
		await createPage({ title: "Undo Test" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Initial Sentence.");
		// Wait for commitHistory debounce (750ms)
		await waitAutosave(800);

		await page.keyboard.press("Enter");
		await page.keyboard.type("Second Sentence Added.");
		await waitAutosave(800);

		let blocks = await getBlocks();
		assert.equal(blocks.length, 2, "2 blocks before undo");

		// Undo with Ctrl+Z
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyZ");
		await page.keyboard.up("Control");
		await waitAutosave(300);

		blocks = await getBlocks();
		assert.equal(blocks.length, 1, "Undo removed 2nd block");
		assert.equal(blocks[0].text, "Initial Sentence.");

		// Redo with Ctrl+Y
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyY");
		await page.keyboard.up("Control");
		await waitAutosave(300);

		blocks = await getBlocks();
		assert.equal(blocks.length, 2, "Redo restored 2nd block");
		assert.equal(blocks[1].text, "Second Sentence Added.");
	});

	await testCase("Autosave Debounce Persists to STATE", async () => {
		const pid = await createPage({ title: "Autosave Test" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Testing autosave persistence flow.");
		await waitAutosave(600); // 450ms debounce + margin

		const stateContent = await page.evaluate((pid) => window.S.pages[pid]?.content, pid);
		assert.ok(stateContent.includes("Testing autosave persistence flow."), `State content updated: ${stateContent}`);
	});

	await testCase("Page Switching Flushes Pending Save and History without Cross-Bleed", async () => {
		const page1Id = await createPage({ title: "Page One" });
		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Page 1 fast edit before switch");

		// Immediately create & open page 2 without waiting 450ms
		const page2Id = await harness.page.evaluate(async () => {
			const id = "page2_" + Math.random().toString(36).slice(2, 8);
			await window.STATE.dispatch("pageCreate", {
				id,
				title: "Page Two",
				content: "Page 2 initial content",
				kind: "note",
				workspaceId: "default"
			});
			window.openPage(id);
			return id;
		});

		await waitAutosave(500);

		// Verify page 1 saved content was flushed
		const page1Content = await page.evaluate((p1) => window.S.pages[p1]?.content, page1Id);
		assert.ok(page1Content.includes("Page 1 fast edit before switch"), "Page 1 edits flushed on switch");

		// Verify page 2 is open with its own content
		const page2Blocks = await getBlocks();
		assert.equal(page2Blocks[0].text, "Page 2 initial content");

		// Verify undo on page 2 does not undo page 1
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyZ");
		await page.keyboard.up("Control");
		await waitAutosave(300);

		const page2BlocksAfterUndo = await getBlocks();
		assert.equal(page2BlocksAfterUndo[0].text, "Page 2 initial content", "Page 2 history is isolated");
	});

	return results;
}

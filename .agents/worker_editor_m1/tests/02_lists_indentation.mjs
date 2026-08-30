import assert from "node:assert/strict";

export async function runListsIndentationTests(harness) {
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

	await testCase("Bullet List Triggers (- , * , + )", async () => {
		await createPage({ title: "Bullet Lists" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("- Item dash");
		await page.keyboard.press("Enter");
		await page.keyboard.type("* Item star");
		await page.keyboard.press("Enter");
		await page.keyboard.type("+ Item plus");
		await waitAutosave(200);

		const blocks = await getBlocks();
		assert.equal(blocks.length, 3);
		assert.equal(blocks[0].type, "bullet");
		assert.equal(blocks[0].text, "Item dash");
		assert.equal(blocks[1].type, "bullet");
		assert.equal(blocks[1].text, "Item star");
		assert.equal(blocks[2].type, "bullet");
		assert.equal(blocks[2].text, "Item plus");
	});

	await testCase("Numbered List Trigger (1. ) and Sequential Numbering", async () => {
		await createPage({ title: "Numbered Lists" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("1. First item");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Second item");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Third item");
		await waitAutosave(200);

		const blocks = await getBlocks();
		assert.equal(blocks.length, 3);
		assert.equal(blocks[0].type, "number");
		assert.equal(blocks[0].text, "First item");
		assert.equal(blocks[1].type, "number");
		assert.equal(blocks[1].text, "Second item");
		assert.equal(blocks[2].type, "number");
		assert.equal(blocks[2].text, "Third item");

		// Verify rendered numbers in DOM
		const markers = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-num")).map(el => el.textContent.trim())
		);
		assert.deepEqual(markers, ["1.", "2.", "3."]);
	});

	await testCase("Todo List Trigger ([] ) and Checkbox Toggle", async () => {
		await createPage({ title: "Todo Lists" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("[] Task Alpha");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Task Beta");
		await waitAutosave(200);

		let blocks = await getBlocks();
		assert.equal(blocks.length, 2);
		assert.equal(blocks[0].type, "todo");
		assert.equal(blocks[0].text, "Task Alpha");
		assert.equal(blocks[1].type, "todo");
		assert.equal(blocks[1].text, "Task Beta");

		// Click checkbox of Task Alpha
		await page.click('#blockEditor input[type="checkbox"]');
		await waitAutosave(300);

		const isChecked = await page.evaluate(() =>
			document.querySelector('#blockEditor input[type="checkbox"]').checked
		);
		assert.equal(isChecked, true, "Checkbox state toggled to checked");

		const md = await getSerialized();
		assert.ok(md.includes("- [x] Task Alpha"), "Serialized markdown contains - [x]");
		assert.ok(md.includes("- [ ] Task Beta"), "Serialized markdown contains - [ ]");
	});

	await testCase("List Indentation via Tab and Outdentation via Shift+Tab", async () => {
		await createPage({ title: "List Indent" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("- Parent 1");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Child 1.1");

		// Indent with Tab
		await page.keyboard.press("Tab");
		await waitAutosave(200);

		let indents = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-li")).map(el => {
				const style = el.getAttribute("style") || "";
				const m = style.match(/padding-left:\s*([0-9.]+)px/);
				return m ? parseFloat(m[1]) : 0;
			})
		);
		assert.ok(indents[1] > indents[0], "Second item has greater indent padding");

		// Outdent with Shift+Tab
		await page.keyboard.down("Shift");
		await page.keyboard.press("Tab");
		await page.keyboard.up("Shift");
		await waitAutosave(200);

		indents = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-li")).map(el => {
				const style = el.getAttribute("style") || "";
				const m = style.match(/padding-left:\s*([0-9.]+)px/);
				return m ? parseFloat(m[1]) : 0;
			})
		);
		assert.equal(indents[1], indents[0], "Indent returned to top level after Shift+Tab");
	});

	await testCase("Empty List Item + Enter Converts to Paragraph", async () => {
		await createPage({ title: "List Exit" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("- One item");
		await page.keyboard.press("Enter");
		// Now on empty bullet item -> press Enter again
		await page.keyboard.press("Enter");
		await waitAutosave(200);

		const blocks = await getBlocks();
		assert.equal(blocks.length, 2);
		assert.equal(blocks[0].type, "bullet");
		assert.equal(blocks[1].type, "p", "Empty bullet converted to paragraph on Enter");
	});

	return results;
}

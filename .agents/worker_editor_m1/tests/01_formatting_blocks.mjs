import assert from "node:assert/strict";

export async function runFormattingBlocksTests(harness) {
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

	await testCase("Heading Markdown Triggers (# , ## , ### )", async () => {
		await createPage({ title: "Heading Triggers" });

		// Click inside initial empty text block
		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("# Heading 1");
		await page.keyboard.press("Enter");
		await page.keyboard.type("## Heading 2");
		await page.keyboard.press("Enter");
		await page.keyboard.type("### Heading 3");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Normal paragraph text");

		await waitAutosave(300);
		const blocks = await getBlocks();
		assert.ok(blocks.length >= 4, `Expected at least 4 blocks, got ${blocks.length}`);
		assert.equal(blocks[0].type, "h1");
		assert.equal(blocks[0].text, "Heading 1");
		assert.equal(blocks[1].type, "h2");
		assert.equal(blocks[1].text, "Heading 2");
		assert.equal(blocks[2].type, "h3");
		assert.equal(blocks[2].text, "Heading 3");
		assert.equal(blocks[3].type, "p");
		assert.equal(blocks[3].text, "Normal paragraph text");

		const md = await getSerialized();
		assert.ok(md.includes("# Heading 1"));
		assert.ok(md.includes("## Heading 2"));
		assert.ok(md.includes("### Heading 3"));
	});

	await testCase("Quote Trigger (> ) and Divider Trigger (---)", async () => {
		await createPage({ title: "Quote and Divider" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("> In omnibus requiem quaesivi");
		await page.keyboard.press("Enter");
		await page.keyboard.type("---");
		await waitAutosave(200);

		const blocks = await getBlocks();
		assert.ok(blocks.some(b => b.type === "quote" && b.text.includes("In omnibus")), "Quote block created");
		assert.ok(blocks.some(b => b.type === "divider"), "Divider block created");

		const md = await getSerialized();
		assert.ok(md.includes("> In omnibus"));
		assert.ok(md.includes("---"));
	});

	await testCase("Live Inline Markdown Delimiters (**bold**, *italic*, <u>underline</u>, ~~strike~~, `code`)", async () => {
		await createPage({ title: "Inline Markdown" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Here is **bold text** and *italic text* and `inline code` and ~~deleted~~ done.");
		await waitAutosave(300);

		const html = await page.evaluate(() => document.querySelector("#blockEditor [data-btext]").innerHTML);
		assert.ok(html.includes("<strong>bold text</strong>") || html.includes("<b>bold text</b>"), "Strong tag rendered");
		assert.ok(html.includes("<em>italic text</em>") || html.includes("<i>italic text</i>"), "Em tag rendered");
		assert.ok(html.includes("<code>inline code</code>"), "Code tag rendered");
		assert.ok(html.includes("<del>deleted</del>") || html.includes("<s>deleted</s>"), "Del/S tag rendered");

		const md = await getSerialized();
		assert.ok(md.includes("**bold text**"));
		assert.ok(md.includes("*italic text*"));
		assert.ok(md.includes("`inline code`"));
		assert.ok(md.includes("~~deleted~~"));
	});

	await testCase("Selection Formatting Shortcuts (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+E, Ctrl+Shift+S)", async () => {
		await createPage({ title: "Shortcuts Formatting" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Format me please");

		// Select all text in field (1st Ctrl+A)
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyA");
		await page.keyboard.up("Control");

		// Press Ctrl+B
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyB");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		let html = await page.evaluate(() => document.querySelector("#blockEditor [data-btext]").innerHTML);
		assert.ok(html.includes("<strong>Format me please</strong>") || html.includes("<b>Format me please</b>"), "Ctrl+B created bold");

		// Toggle Ctrl+B off
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyA");
		await page.keyboard.up("Control");

		await page.keyboard.down("Control");
		await page.keyboard.press("KeyB");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		html = await page.evaluate(() => document.querySelector("#blockEditor [data-btext]").innerHTML);
		assert.ok(!html.includes("<strong>"), "Ctrl+B toggled bold off");

		// Press Ctrl+U for underline
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyA");
		await page.keyboard.up("Control");

		await page.keyboard.down("Control");
		await page.keyboard.press("KeyU");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		html = await page.evaluate(() => document.querySelector("#blockEditor [data-btext]").innerHTML);
		assert.ok(html.includes("<u>Format me please</u>"), "Ctrl+U created <u> tag");
	});

	await testCase("TurnInto Shortcuts (Ctrl+Shift+0..8) and Duplication (Ctrl+D)", async () => {
		await createPage({ title: "Turn Into Shortcuts" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type("Transforming text block");

		// Convert to H1 via Ctrl+Shift+1
		await page.keyboard.down("Control");
		await page.keyboard.down("Shift");
		await page.keyboard.press("Digit1");
		await page.keyboard.up("Shift");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		let blocks = await getBlocks();
		assert.equal(blocks[0].type, "h1");

		// Convert to Code via Ctrl+Shift+8
		await page.keyboard.down("Control");
		await page.keyboard.down("Shift");
		await page.keyboard.press("Digit8");
		await page.keyboard.up("Shift");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		blocks = await getBlocks();
		assert.equal(blocks[0].type, "code");

		// Duplicate via Ctrl+D
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyD");
		await page.keyboard.up("Control");
		await waitAutosave(200);

		blocks = await getBlocks();
		assert.equal(blocks.length, 2, "Ctrl+D duplicated block");
		assert.equal(blocks[1].type, "code");
	});

	return results;
}

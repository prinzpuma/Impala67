import assert from "node:assert/strict";

export async function runMathKatexTests(harness) {
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

	await testCase("Display Math Block ($$...$$ and \\[...\\]) Hydration", async () => {
		const content = `Hier ist eine Formel:
$$
\\int_{-\\infty}^\\infty e^{-x^2} dx = \\sqrt{\\pi}
$$

Und eine zweite:
\\[
\\sum_{k=1}^n k = \\frac{n(n+1)}{2}
\\]`;
		await createPage({ title: "Display Math", content });

		await waitAutosave(500);

		const mathBlocks = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-math")).map(el => el.dataset.bmath)
		);
		assert.equal(mathBlocks.length, 2, "2 display math blocks rendered");

		const serialized = await getSerialized();
		assert.ok(serialized.includes("\\int_{-\\infty}^\\infty"));
		assert.ok(serialized.includes("\\sum_{k=1}^n"));
	});

	await testCase("Inline Math Chips ($formula$ and \\(formula\\)) and Escaped Dollars", async () => {
		const content = `Energie ist $E = mc^2$ und Satz des Pythagoras ist \\(a^2 + b^2 = c^2\\). Aber Preis ist \\$50 und \\$100.`;
		await createPage({ title: "Inline Math", content });
		await waitAutosave(400);

		const chips = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-imath")).map(el => el.dataset.md)
		);
		assert.equal(chips.length, 2, "2 inline math chips rendered");
		assert.equal(chips[0], "$E = mc^2$");
		assert.equal(chips[1], "\\(a^2 + b^2 = c^2\\)");

		// Check that escaped dollars are rendered as text, not math chips
		const textContent = await page.evaluate(() => document.querySelector("#blockEditor [data-btext]").textContent);
		assert.ok(textContent.includes("$50") && textContent.includes("$100"));
	});

	await testCase("Live Math Popover Editing and Committing", async () => {
		await createPage({ title: "Math Popover", content: "$$\nx^2\n$$" });
		await waitAutosave(300);

		// Click on math block to open popover
		await page.click("#blockEditor .blk-math");
		await waitAutosave(200);

		const popoverOpen = await page.evaluate(() => document.querySelector(".blk-mathpop") !== null);
		assert.ok(popoverOpen, "Math popover opened on click");

		// Clear and type new formula: \sqrt{x^2 + y^2}
		const inputVal = await page.evaluate(() => {
			const ta = document.querySelector(".blk-mathinput");
			ta.value = "\\sqrt{x^2 + y^2}";
			return ta.value;
		});
		assert.equal(inputVal, "\\sqrt{x^2 + y^2}");

		// Click Fertig button
		await page.click(".blk-mathok");
		await waitAutosave(300);

		const popoverClosed = await page.evaluate(() => document.querySelector(".blk-mathpop") === null);
		assert.ok(popoverClosed, "Math popover closed on commit");

		const md = await getSerialized();
		assert.ok(md.includes("\\sqrt{x^2 + y^2}"), "Serialized content has updated formula");
	});

	await testCase("Broken / Invalid LaTeX Syntax Fault Isolation", async () => {
		const brokenLatex = `$$
\\frac{1}{0
\\begin{matrix} 1 & 2
\\nonExistentCommand{hello}
$$`;
		await createPage({ title: "Broken Latex", content: brokenLatex });
		await waitAutosave(400);

		// Editor must still be mounted and functional
		const editorMounted = await page.evaluate(() => document.querySelector("#blockEditor") !== null);
		assert.ok(editorMounted, "Editor remained mounted despite broken LaTeX");

		const blocks = await getBlocks();
		assert.ok(blocks.length >= 1, "Block parsed without fatal exception");
	});

	return results;
}

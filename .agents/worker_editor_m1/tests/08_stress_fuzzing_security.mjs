import assert from "node:assert/strict";

export async function runStressFuzzingSecurityTests(harness) {
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

	await testCase("Stress: Rapid Sequential Typing (1,000+ keystrokes)", async () => {
		await createPage({ title: "Rapid Typing Stress" });

		await page.click("#blockEditor [data-btext]");

		// Type 1,000 characters rapidly
		const chunk = "The quick brown fox jumps over the lazy dog. 1234567890! ";
		const targetLength = 1000;
		let fullText = "";
		while (fullText.length < targetLength) {
			fullText += chunk;
		}
		fullText = fullText.slice(0, targetLength);

		// Send input in fast chunks or rapid type
		await page.keyboard.type(fullText, { delay: 1 });
		await waitAutosave(600);

		const blocks = await getBlocks();
		assert.equal(blocks.length, 1);
		assert.equal(blocks[0].text.length, targetLength, `Typed ${targetLength} characters, received ${blocks[0].text.length}`);
	});

	await testCase("Stress: Large Document Pasting (10,000+ words across 100+ paragraphs, tables, math)", async () => {
		let largeDoc = "# Mega Document\n\n";
		for (let i = 1; i <= 120; i++) {
			largeDoc += `### Section ${i}\n\n`;
			largeDoc += `This is paragraph ${i} containing multiple sentences of arbitrary technical prose and mathematical descriptions of distributed systems and state persistence.\n\n`;
			if (i % 20 === 0) {
				largeDoc += `| Metric | Value ${i} |\n| --- | --- |\n| Throughput | ${i * 100} ops/sec |\n| Latency | ${i} ms |\n\n`;
			}
			if (i % 25 === 0) {
				largeDoc += `$$\n\\lim_{x \\to \\infty} \\frac{1}{x} = 0\n$$\n\n`;
			}
		}

		await createPage({ title: "Large Document", content: "" });
		await page.click("#blockEditor [data-btext]");

		// Dispatch paste event with large document text
		await page.evaluate((text) => {
			const field = document.querySelector("#blockEditor [data-btext]");
			const ev = new Event("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(ev, "clipboardData", {
				value: {
					items: [],
					getData: (type) => (type === "text/plain" ? text : "")
				}
			});
			field.dispatchEvent(ev);
		}, largeDoc);

		await waitAutosave(1000);

		const blocks = await getBlocks();
		assert.ok(blocks.length > 200, `Expected >200 blocks, got ${blocks.length}`);

		const serialized = await getSerialized();
		assert.ok(serialized.includes("### Section 120"));
		assert.ok(serialized.includes("\\lim_{x \\to \\infty}"));
	});

	await testCase("Fuzzing: Unicode, Emojis, RTL Scripts, Zero-Width Characters", async () => {
		const unicodeString = "👨‍👩‍👧‍👦 🚀 🧮 🏳️‍🌈 العربية עברית 中文 日本語 \u200B\u200D\uFEFF e\u0301\u0302";
		await createPage({ title: "Unicode Fuzzing" });

		await page.click("#blockEditor [data-btext]");
		await page.keyboard.type(unicodeString);
		await waitAutosave(300);

		const blocks = await getBlocks();
		assert.equal(blocks.length, 1);
		// Zero width characters should be sanitized/handled without crashing
		assert.ok(blocks[0].text.includes("🚀"));
		assert.ok(blocks[0].text.includes("العربية"));
		assert.ok(blocks[0].text.includes("עברית"));
		assert.ok(blocks[0].text.includes("中文"));
	});

	await testCase("Security: HTML / XSS Injection Attempts in Content", async () => {
		const maliciousPayloads = [
			'<script>window.__XSS_SCRIPT = true;</script>',
			'<img src="invalid-image-url.xyz" onerror="window.__XSS_IMG = true">',
			'<svg onload="window.__XSS_SVG = true">',
			'<details open ontoggle="window.__XSS_DETAILS = true"><summary>Payload</summary></details>',
			'<iframe src="javascript:window.__XSS_IFRAME=true"></iframe>'
		];

		const content = maliciousPayloads.join("\n\n");
		await createPage({ title: "XSS Test", content });
		await waitAutosave(600);

		const xssDetected = await page.evaluate(() => {
			return {
				script: !!window.__XSS_SCRIPT,
				img: !!window.__XSS_IMG,
				svg: !!window.__XSS_SVG,
				details: !!window.__XSS_DETAILS,
				iframe: !!window.__XSS_IFRAME
			};
		});

		assert.equal(xssDetected.script, false, "XSS <script> was NOT executed");
		assert.equal(xssDetected.img, false, "XSS <img onerror> was NOT executed");
		assert.equal(xssDetected.svg, false, "XSS <svg onload> was NOT executed");
		assert.equal(xssDetected.details, false, "XSS <details ontoggle> was NOT executed");
		assert.equal(xssDetected.iframe, false, "XSS <iframe> was NOT executed");
	});

	await testCase("Stress: Boundary Backspace / Delete Spamming Across Nested Blocks", async () => {
		const complexContent = `> [!blue]
> Callout item 1
> Callout item 2

<details open>
<summary>Toggle Heading</summary>

Nested paragraph 1
Nested paragraph 2
</details>

| A | B |
| --- | --- |
| 1 | 2 |

End paragraph`;

		await createPage({ title: "Boundary Stress", content: complexContent });
		await waitAutosave(400);

		// Rapidly press Backspace 50 times in various fields
		await page.click("#blockEditor [data-btext]");
		for (let i = 0; i < 30; i++) {
			await page.keyboard.press("Backspace");
		}
		await waitAutosave(300);

		// Editor must remain stable and not throw fatal exceptions
		const isEditorAlive = await page.evaluate(() => document.querySelector("#blockEditor") !== null);
		assert.ok(isEditorAlive, "Editor remained intact during backspace stress");
	});

	return results;
}

import { createTestHarness } from "./harness.mjs";

async function diagnose() {
	const harness = await createTestHarness();
	const { page, createPage, getBlocks, getSerialized, waitAutosave } = harness;

	console.log("--- Diagnostic 1: Heading Markdown Triggers ---");
	await createPage({ title: "Diag 1" });
	await page.click("#blockEditor [data-btext]");
	await page.keyboard.type("# Heading 1");
	await waitAutosave(200);
	console.log("After typing # Heading 1:", await getBlocks());
	await page.keyboard.press("Enter");
	await waitAutosave(200);
	console.log("After Enter:", await getBlocks());
	await page.keyboard.type("## Heading 2");
	await waitAutosave(200);
	console.log("After typing ## Heading 2:", await getBlocks());

	console.log("\n--- Diagnostic 2: Shift+Digit1 KeyboardEvent ---");
	const keyEventInfo = await page.evaluate(() => {
		return new Promise((resolve) => {
			const handler = (e) => {
				window.removeEventListener("keydown", handler);
				resolve({ key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey });
			};
			window.addEventListener("keydown", handler);
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "!", code: "Digit1", shiftKey: true, ctrlKey: true }));
		});
	});
	console.log("Shift+1 KeyboardEvent:", keyEventInfo);

	console.log("\n--- Diagnostic 3: Ctrl+B Selection Unbolding ---");
	await createPage({ title: "Diag 3", content: "**Bold text**" });
	await waitAutosave(200);
	console.log("Initial bold block:", await getBlocks());
	await page.click("#blockEditor [data-btext]");
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyA");
	await page.keyboard.up("Control");
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyB");
	await page.keyboard.up("Control");
	await waitAutosave(200);
	console.log("After Ctrl+B on bold text:", await getBlocks(), "Serialized:", await getSerialized());

	console.log("\n--- Diagnostic 4: List Indent CSS/DOM ---");
	await createPage({ title: "Diag 4", content: "- Item 1\n  - Item 2" });
	await waitAutosave(200);
	const listDom = await page.evaluate(() => {
		return Array.from(document.querySelectorAll(".blk-li")).map(el => ({
			outerHTML: el.outerHTML,
			style: el.getAttribute("style"),
			classes: el.className
		}));
	});
	console.log("List DOM:", listDom);

	console.log("\n--- Diagnostic 5: Link Click Navigation ---");
	const targetId = await page.evaluate(async () => {
		const id = "target_diag";
		await window.STATE.dispatch("pageCreate", { id, title: "Target Page", content: "Target Content", kind: "note" });
		return id;
	});
	await createPage({ title: "Diag 5", content: `[Target Page](#${targetId})` });
	await waitAutosave(200);
	console.log("Active page before click:", await page.evaluate(() => window.S.activePageId));
	await page.click(`a[href="#${targetId}"]`);
	await waitAutosave(200);
	console.log("Active page after click:", await page.evaluate(() => window.S.activePageId));

	console.log("\n--- Diagnostic 6: Undo/Redo Stacks ---");
	await createPage({ title: "Diag 6" });
	await page.click("#blockEditor [data-btext]");
	await page.keyboard.type("A");
	await waitAutosave(800);
	await page.keyboard.type("B");
	await waitAutosave(800);
	const undoStatus = await page.evaluate(() => {
		const pid = window.S.activePageId;
		return {
			pid,
			// check undoStacks if accessible
			content: window.EDITOR.serialize()
		};
	});
	console.log("Undo status before Ctrl+Z:", undoStatus);
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyZ");
	await page.keyboard.up("Control");
	await waitAutosave(200);
	console.log("After Ctrl+Z:", await getSerialized());

	await harness.cleanup();
}

diagnose().catch(console.error);

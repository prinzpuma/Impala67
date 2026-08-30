import { createTestHarness } from "./harness.mjs";

async function testUndoSteps() {
	const harness = await createTestHarness();
	const { page, createPage, getBlocks, waitAutosave } = harness;

	await createPage({ title: "Undo Steps Test" });
	await page.click("#blockEditor [data-btext]");
	await page.keyboard.type("Initial Sentence.");
	await waitAutosave(800);

	await page.keyboard.press("Enter");
	await waitAutosave(800);

	await page.keyboard.type("Second Sentence Added.");
	await waitAutosave(800);

	console.log("State before undo:", await getBlocks());

	// 1st Undo: should undo typing in block 2
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyZ");
	await page.keyboard.up("Control");
	await waitAutosave(300);
	console.log("State after 1st Undo:", await getBlocks());

	// 2nd Undo: should undo Enter (removing block 2)
	await page.keyboard.down("Control");
	await page.keyboard.press("KeyZ");
	await page.keyboard.up("Control");
	await waitAutosave(300);
	console.log("State after 2nd Undo:", await getBlocks());

	await harness.cleanup();
}

testUndoSteps().catch(console.error);

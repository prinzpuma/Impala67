import fs from "node:fs";
import path from "node:path";
import { createTestHarness } from "./harness.mjs";
import { runFormattingBlocksTests } from "./tests/01_formatting_blocks.mjs";
import { runListsIndentationTests } from "./tests/02_lists_indentation.mjs";
import { runSlashCommandsLinksTests } from "./tests/03_slash_commands_links.mjs";
import { runMathKatexTests } from "./tests/04_math_katex.mjs";
import { runTablesTests } from "./tests/05_tables.mjs";
import { runMediaFilesTests } from "./tests/06_media_files.mjs";
import { runUndoRedoPersistenceTests } from "./tests/07_undo_redo_persistence.mjs";
import { runStressFuzzingSecurityTests } from "./tests/08_stress_fuzzing_security.mjs";

async function main() {
	console.log("=== Launching Impala67 Editor Automation & Stress Test Suite ===");
	const harness = await createTestHarness();
	const suiteResults = {};
	let totalPassed = 0;
	let totalFailed = 0;
	const startTime = Date.now();

	const suites = [
		{ name: "01_formatting_blocks", fn: runFormattingBlocksTests },
		{ name: "02_lists_indentation", fn: runListsIndentationTests },
		{ name: "03_slash_commands_links", fn: runSlashCommandsLinksTests },
		{ name: "04_math_katex", fn: runMathKatexTests },
		{ name: "05_tables", fn: runTablesTests },
		{ name: "06_media_files", fn: runMediaFilesTests },
		{ name: "07_undo_redo_persistence", fn: runUndoRedoPersistenceTests },
		{ name: "08_stress_fuzzing_security", fn: runStressFuzzingSecurityTests },
	];

	for (const suite of suites) {
		console.log(`\n--- Running Suite: ${suite.name} ---`);
		try {
			const res = await suite.fn(harness);
			suiteResults[suite.name] = res;
			for (const t of res) {
				if (t.passed) {
					totalPassed++;
					console.log(`  ✓ ${t.name} (${t.durationMs}ms)`);
				} else {
					totalFailed++;
					console.error(`  ✗ ${t.name} (${t.durationMs}ms)`);
					console.error(`    Error: ${t.error}`);
				}
			}
		} catch (suiteErr) {
			console.error(`Suite ${suite.name} crashed:`, suiteErr);
			suiteResults[suite.name] = [{ name: "SUITE_CRASH", passed: false, error: suiteErr.message, stack: suiteErr.stack }];
			totalFailed++;
		}
	}

	// Capture final visual screenshot of editor
	const screenshotPath = path.join(process.cwd(), ".agents/worker_editor_m1/screenshots/editor_final_state.png");
	await harness.page.screenshot({ path: screenshotPath, fullPage: false });
	console.log(`\nCaptured editor state screenshot: ${screenshotPath}`);

	const summary = {
		timestamp: new Date().toISOString(),
		totalTests: totalPassed + totalFailed,
		passed: totalPassed,
		failed: totalFailed,
		durationMs: Date.now() - startTime,
		consoleErrors: harness.consoleErrors,
		pageErrors: harness.pageErrors,
		suites: suiteResults
	};

	const resultPath = path.join(process.cwd(), ".agents/worker_editor_m1/test_results.json");
	fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2), "utf8");
	console.log(`\nTest results written to: ${resultPath}`);

	console.log("\n========================================================");
	console.log(`TOTAL: ${summary.totalTests} | PASSED: ${totalPassed} | FAILED: ${totalFailed} | TIME: ${summary.durationMs}ms`);
	console.log("========================================================");

	await harness.cleanup();
	process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error("Fatal test runner exception:", err);
	process.exit(2);
});

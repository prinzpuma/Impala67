"use strict";

import { PERF_PROFILER } from "./performance-profiler.js";
import { U } from "./util.js";

const reopen = () => window.openSettings?.("data", "performance-profiler");

document.addEventListener("click", (event) => {
	const button = event.target?.closest?.("#btnPerfCopy, #btnPerfExport, #btnPerfClear");
	if (!button) return;
	event.preventDefault();
	event.stopPropagation();
	if (button.id === "btnPerfClear") {
		PERF_PROFILER.clear();
		U.toast("Performance-Protokoll gelöscht.", "success");
		reopen();
		return;
	}
	const report = PERF_PROFILER.report();
	if (button.id === "btnPerfExport") {
		U.download("impala67-performance-" + new Date().toISOString().slice(0, 10) + ".json", report);
		return;
	}
	navigator.clipboard.writeText(report)
		.then(() => U.toast("Performance-Diagnose kopiert.", "success"))
		.catch(() => U.toast("Zwischenablage nicht verfügbar – bitte JSON exportieren.", "error"));
}, true);

document.addEventListener("change", (event) => {
	if (event.target?.id !== "inpPerformanceProfiler") return;
	PERF_PROFILER.setEnabled(event.target.checked);
	U.toast(event.target.checked ? "Performance-Profiler aktiviert." : "Performance-Profiler deaktiviert.", "success");
	reopen();
}, true);

import test from "node:test";
import assert from "node:assert/strict";

import {
	SETTINGS_SECTIONS,
	resolveSettingsSection,
	searchSettings,
	valuesSnapshot,
	valuesAreDirty,
} from "../web/settings-schema.js";

test("Settings exposes overview plus six focused areas", () => {
	assert.deepEqual(SETTINGS_SECTIONS.map(({ id }) => id), [
		"overview", "general", "appearance", "ai", "sync", "data", "devices",
	]);
});

test("legacy section ids resolve to the new information architecture", () => {
	assert.equal(resolveSettingsSection("ki"), "ai");
	assert.equal(resolveSettingsSection("home"), "general");
	assert.equal(resolveSettingsSection("look"), "appearance");
	assert.equal(resolveSettingsSection("notion"), "sync");
	assert.equal(resolveSettingsSection("backup"), "data");
	assert.equal(resolveSettingsSection("update"), "data");
	assert.equal(resolveSettingsSection("controller"), "devices");
	assert.equal(resolveSettingsSection("experimente"), "ai");
	assert.equal(resolveSettingsSection("unknown"), "overview");
});

test("search understands labels, descriptions and synonyms", () => {
	assert.ok(searchSettings("API Schlüssel").some((result) => result.id === "ai-sources"));
	assert.equal(searchSettings("dark mode")[0].id, "theme");
	assert.equal(searchSettings("gamepad")[0].section, "devices");
	assert.equal(searchSettings("notion token")[0].section, "sync");
	assert.deepEqual(searchSettings(""), []);
	assert.deepEqual(searchSettings("Gerätespeicher sichern"), []);
	assert.equal(searchSettings("Gerätespeicher sichern", 8, { native: true })[0].id, "native-fs-backup");
});

test("dirty state compares stable field snapshots", () => {
	const fields = [{ key: "token", value: "secret" }, { key: "url", value: "https://example.test" }];
	const initial = valuesSnapshot(fields);
	assert.equal(valuesAreDirty(initial, fields), false);
	assert.equal(valuesAreDirty(initial, [{ ...fields[0], value: "changed" }, fields[1]]), true);
});

test("impala67BreakReminder is present under Lernen and searchable", () => {
	const results = searchSettings("Pausen-Erinnerung");
	assert.ok(results.some((r) => r.id === "impala67BreakReminder" && r.section === "ai" && r.group === "Lernen"));
});

test("danger-cards is present under Gefahrenzone and searchable", () => {
	const results = searchSettings("Karteikarten löschen");
	assert.ok(results.some((r) => r.id === "danger-cards" && r.section === "data" && r.group === "Gefahrenzone"));
});


import test from "node:test";
import assert from "node:assert/strict";

import {
	DEFAULT_DRIVE_SYNC_MINUTES,
	DRIVE_SYNC_INTERVAL_OPTIONS,
	driveSyncAfterChange,
	driveSyncIntervalMs,
	normalizeDriveSyncMinutes,
} from "../web/drive-sync-policy.js";

test("automatic Drive sync defaults to 30 minutes and not after every change", () => {
	assert.equal(DEFAULT_DRIVE_SYNC_MINUTES, 30);
	assert.equal(normalizeDriveSyncMinutes({}), 30);
	assert.equal(driveSyncIntervalMs({}), 30 * 60 * 1000);
	assert.equal(driveSyncAfterChange({}), false);
});

test("automatic Drive sync accepts menu intervals and an explicit change toggle", () => {
	assert.deepEqual(DRIVE_SYNC_INTERVAL_OPTIONS.map(({ value }) => value), [5, 15, 30, 60, 180]);
	assert.equal(normalizeDriveSyncMinutes({ driveAutoSyncMinutes: 5 }), 5);
	assert.equal(normalizeDriveSyncMinutes({ driveAutoSyncMinutes: "60" }), 60);
	assert.equal(driveSyncAfterChange({ driveSyncAfterChange: true }), true);
});

test("invalid imported interval values safely fall back to 30 minutes", () => {
	assert.equal(normalizeDriveSyncMinutes({ driveAutoSyncMinutes: 0 }), 30);
	assert.equal(normalizeDriveSyncMinutes({ driveAutoSyncMinutes: 7 }), 30);
	assert.equal(normalizeDriveSyncMinutes({ driveAutoSyncMinutes: "x" }), 30);
});

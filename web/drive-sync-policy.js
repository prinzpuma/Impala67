"use strict";

export const DEFAULT_DRIVE_SYNC_MINUTES = 30;

export const DRIVE_SYNC_INTERVAL_OPTIONS = Object.freeze([
	{ value: 5, label: "5 Minuten" },
	{ value: 15, label: "15 Minuten" },
	{ value: 30, label: "30 Minuten" },
	{ value: 60, label: "1 Stunde" },
	{ value: 180, label: "3 Stunden" },
]);

const ALLOWED_INTERVALS = new Set(DRIVE_SYNC_INTERVAL_OPTIONS.map(({ value }) => value));

export function normalizeDriveSyncMinutes(settings) {
	const minutes = Number(settings?.driveAutoSyncMinutes);
	return ALLOWED_INTERVALS.has(minutes) ? minutes : DEFAULT_DRIVE_SYNC_MINUTES;
}

export function driveSyncIntervalMs(settings) {
	return normalizeDriveSyncMinutes(settings) * 60 * 1000;
}

export function driveSyncAfterChange(settings) {
	return settings?.driveSyncAfterChange === true;
}

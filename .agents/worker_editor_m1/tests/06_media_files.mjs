import assert from "node:assert/strict";

export async function runMediaFilesTests(harness) {
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

	await testCase("Image Block Parsing and DOM Rendering", async () => {
		const content = `Hier ist ein Bild:

![Diagramm](https://example.com/image.png)

Folgetext`;
		await createPage({ title: "Image Block", content });
		await waitAutosave(300);

		const imgExists = await page.evaluate(() =>
			document.querySelector("#blockEditor .blk-img img") !== null
		);
		assert.ok(imgExists, "Image figure and img tag rendered");

		const altText = await page.evaluate(() =>
			document.querySelector("#blockEditor .blk-img figcaption").textContent
		);
		assert.equal(altText, "Diagramm");
	});

	await testCase("File / Media Block Detection (Audio, Video, PDF, Generic)", async () => {
		const content = `:::file https://example.com/recording.mp3 Podcast.mp3

:::file https://example.com/lecture.mp4 Vorlesung.mp4

:::file https://example.com/doc.pdf Skript.pdf

:::file https://example.com/data.zip Archiv.zip`;

		await createPage({ title: "File Blocks", content });
		await waitAutosave(400);

		const fileBlocks = await page.evaluate(() =>
			Array.from(document.querySelectorAll("#blockEditor .blk-file")).map(el => ({
				fileblk: el.dataset.fileblk,
				hasAudio: el.querySelector("audio") !== null,
				hasVideo: el.querySelector("video") !== null,
				hasPdf: el.querySelector("iframe") !== null,
				hasDl: el.querySelector("[data-fdl]") !== null,
			}))
		);
		assert.equal(fileBlocks.length, 4, "4 file blocks rendered");
		assert.ok(fileBlocks[0].hasAudio, "MP3 rendered as audio element");
		assert.ok(fileBlocks[1].hasVideo, "MP4 rendered as video element");
		assert.ok(fileBlocks[2].hasPdf, "PDF rendered as iframe element");
		assert.ok(fileBlocks[3].hasDl, "ZIP rendered with download button");
	});

	await testCase("Dragover Event with Files Prevents Default to Allow Drop", async () => {
		await createPage({ title: "File Drag Over" });

		const isPrevented = await page.evaluate(() => {
			const host = document.querySelector("#blockEditor");
			const ev = new Event("dragover", { bubbles: true, cancelable: true });
			Object.defineProperty(ev, "dataTransfer", {
				value: { types: ["Files"], files: [] }
			});
			host.dispatchEvent(ev);
			return ev.defaultPrevented;
		});
		assert.equal(isPrevented, true, "dragover for Files calls preventDefault()");
	});

	return results;
}

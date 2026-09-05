import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  defaultViewport: { width: 1360, height: 1200 }
});

const page = await browser.newPage();
await page.goto('file:///c:/Users/joshu/Documents/Notion/web/test-home.html', { waitUntil: 'networkidle0' });

// Screenshot 1: Overview Dark Mode
await page.screenshot({ path: 'C:\\Users\\joshu\\.gemini\\antigravity\\brain\\d3a8e33b-d94e-484f-a8ad-2eaa1c9cad6f\\.tempmediaStorage\\ui_dark_overview.png' });

// 2. Click 'Antwort aufdecken'
await page.click('.nh-flashcard-reveal-btn');
await new Promise(r => setTimeout(r, 200));

// 3. Fill prompt & submit
await page.evaluate(() => {
  fillPrompt('Erkläre mir den Unterschied Memoization vs. Tabulation');
});
await new Promise(r => setTimeout(r, 400));

// Screenshot 2: Interactive with Claude response & flipped card
await page.screenshot({ path: 'C:\\Users\\joshu\\.gemini\\antigravity\\brain\\d3a8e33b-d94e-484f-a8ad-2eaa1c9cad6f\\.tempmediaStorage\\ui_interactive_states.png' });

// 4. Toggle Light Mode
await page.evaluate(() => toggleTheme());
await new Promise(r => setTimeout(r, 300));

// Screenshot 3: Light Mode
await page.screenshot({ path: 'C:\\Users\\joshu\\.gemini\\antigravity\\brain\\d3a8e33b-d94e-484f-a8ad-2eaa1c9cad6f\\.tempmediaStorage\\ui_light_mode.png' });

await browser.close();
console.log('All screenshots captured successfully!');

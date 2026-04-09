import { chromium } from 'playwright';

const HALSAIL_URL = 'https://halsail.com';
const EMAIL = process.env.HALSAIL_EMAIL;
const PASSWORD = process.env.HALSAIL_PASSWORD;
const CF_WORKER_URL = process.env.CF_WORKER_URL;

async function run() {
  const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

  try {
    console.log('Navigating to Halsail...');
    await page.goto(HALSAIL_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);

    // Login
await page.fill('input[name="Email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.waitForTimeout(1000);
// Submit the form directly
await page.evaluate(() => {
  const form = document.querySelector('form');
  if (form) form.submit();
});
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
console.log('After login URL:', page.url());
const pageContent = await page.content();
console.log('Has Boats menu:', pageContent.includes('Boats'));
    
    // Navigate to Import from SailEvent
    await page.goto('https://halsail.com/Import/PreviewBoatsSailEvent/1727', { waitUntil: 'networkidle' });
    console.log('Preview page loaded, URL:', page.url());

    // Read all rows and set Update Existing to Ignore
    const rowHandles = await page.$$('table tbody tr');
    let updateExistingCount = 0;
    let addNewCount = 0;

    for (const row of rowHandles) {
      const select = await row.$('select');
      if (!select) continue;

      const currentText = await select.evaluate((el) =>
        el.options[el.selectedIndex]?.text || ''
      );
      const lower = currentText.toLowerCase();

      if (lower.includes('update')) {
        await select.selectOption({ index: 0 }); // Select first option (Ignore)
        updateExistingCount++;
        console.log('Set Update Existing → Ignore');
      } else if (lower.includes('add')) {
        addNewCount++;
      }
    }

    console.log(`Add New: ${addNewCount}, Update Existing set to Ignore: ${updateExistingCount}`);

    if (addNewCount === 0) {
      console.log('No Add New entries — nothing to import');
      if (updateExistingCount > 0) {
        await sendNotify(CF_WORKER_URL, {
          type: 'complete',
          imported: 0,
          updateExisting: updateExistingCount,
          message: `No new boats imported. ${updateExistingCount} update(s) set to ignore — review in Halsail.`,
        });
      }
      return;
    }

    // Click Upload x boats button
    const importBtn = await page.$('#btnUploadTop');
    if (!importBtn) throw new Error('Could not find Upload button on preview screen');

    console.log('Found Upload button — clicking');
    await importBtn.click();
console.log('Upload clicked — waiting for import to complete...');
await page.waitForTimeout(10000); // Wait 10 seconds for imports to process
await page.waitForLoadState('networkidle');
console.log('After wait URL:', page.url());
console.log('Page content after upload:', (await page.content()).substring(0, 1000));

    // Read confirmation table
    const confirmedRows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
        return {
          helm:      cells[0] || '',
          className: cells[1] || '',
          sailNo:    cells[2] || '',
          crew:      cells[3] || '',
        };
      }).filter((r) => r.helm && r.helm.length < 50)
    );

    console.log(`Confirmation screen shows ${confirmedRows.length} boats imported`);

    let message = `✅ ${confirmedRows.length} boat${confirmedRows.length !== 1 ? 's' : ''} imported to WSC Dinghy Racing 2026-2027`;
    if (updateExistingCount > 0) {
      message += `\n⚠️ ${updateExistingCount} update${updateExistingCount !== 1 ? 's' : ''} set to ignore — review in Halsail`;
    }

    // Send completion notification
    await sendNotify(CF_WORKER_URL, {
      type: 'complete',
      imported: confirmedRows.length,
      updateExisting: updateExistingCount,
      message,
    });

    // Clear pending report from KV
    await fetch(`${CF_WORKER_URL}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': process.env.CF_WORKER_SECRET },
      body: JSON.stringify({ key: 'pending_report' }),
    });

    console.log('Import complete — notification sent');

  } catch (err) {
    console.error('import.js error:', err);
    await sendNotify(CF_WORKER_URL, {
      type: 'error',
      message: `❌ WSC import failed: ${err.message}`,
    }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

async function sendNotify(workerUrl, data) {
  const res = await fetch(`${workerUrl}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': process.env.CF_WORKER_SECRET },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
}

run();

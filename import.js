import { chromium } from 'playwright';

const HALSAIL_URL = 'https://halsail.com';
const EMAIL = process.env.HALSAIL_EMAIL;
const PASSWORD = process.env.HALSAIL_PASSWORD;
const CF_WORKER_URL = process.env.CF_WORKER_URL;
const EVENT_NAME = 'WSC Dinghy Racing 2026-2027';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('Navigating to Halsail...');
    await page.goto(`${HALSAIL_URL}/Account/Login`, { waitUntil: 'networkidle' });

    // Login
    await page.fill('input[type="email"], input[name*="email"], input[name*="Email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    console.log('Logged in');

    // Navigate to Boats > Import > Import from SailEvent
    await page.click('text=Boats', { timeout: 10000 });
    await page.click('text=Import', { timeout: 10000 });
    await page.click('text=Import from SailEvent', { timeout: 10000 });

    // Select the event
    await page.selectOption('select', { label: EVENT_NAME });
    console.log(`Selected event: ${EVENT_NAME}`);

    // Click Preview Boats
    await page.click('text=Preview Boats', { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    console.log('Preview loaded');

    // Find all rows and set "Update Existing" entries to "Ignore"
    // Halsail uses a select/dropdown per row to set the action
    const rowHandles = await page.$$('table tbody tr');
    let updateExistingCount = 0;
    let addNewCount = 0;

    for (const row of rowHandles) {
      const select = await row.$('select');
      if (!select) continue;

      const currentValue = await select.evaluate((el) => el.value);
      const currentText = await select.evaluate((el) =>
        el.options[el.selectedIndex]?.text || ''
      );

      const lower = currentText.toLowerCase();

      if (lower.includes('update')) {
        // Set to Ignore
        await select.selectOption({ label: /ignore/i });
        updateExistingCount++;
        console.log(`Set Update Existing → Ignore`);
      } else if (lower.includes('add') || lower.includes('new') || lower.includes('import')) {
        addNewCount++;
      }
    }

    console.log(`Add New: ${addNewCount}, Update Existing set to Ignore: ${updateExistingCount}`);

    if (addNewCount === 0) {
      console.log('No Add New entries — nothing to import');
      // Still notify that updates were ignored if relevant
      if (updateExistingCount > 0) {
        await fetch(`${CF_WORKER_URL}/notify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': process.env.CF_WORKER_SECRET,
          },
          body: JSON.stringify({
            type: 'complete',
            imported: 0,
            updateExisting: updateExistingCount,
            message: `No new boats imported. ${updateExistingCount} update(s) set to ignore — review in Halsail.`,
          }),
        });
      }
      await browser.close();
      return;
    }

    // Click Import All (or equivalent confirm button)
    // Halsail may label this "Import", "Import All", "Confirm Import" etc.
    const importBtn = await page.$(
      'button:has-text("Import All"), button:has-text("Import"), input[value*="Import"]'
    );
    if (!importBtn) {
      throw new Error('Could not find Import/Import All button on preview screen');
    }
    await importBtn.click();
    await page.waitForLoadState('networkidle');
    console.log('Import submitted — waiting for confirmation screen');

    // Read confirmation list — Halsail shows each boat successfully imported
    const confirmedRows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
          td.innerText.trim()
        );
        return {
          helm: cells[0] || '',
          className: cells[1] || '',
          sailNo: cells[2] || '',
          crew: cells[3] || '',
        };
      }).filter((r) => r.helm)
    );

    console.log(`Confirmation screen shows ${confirmedRows.length} boats imported`);

    // Build notification message
    const boatList = confirmedRows
      .map((b) => `${b.helm} · ${b.className} ${b.sailNo}${b.crew ? ' / ' + b.crew : ''}`)
      .join('\n');

    let message = `✅ ${confirmedRows.length} boat${confirmedRows.length !== 1 ? 's' : ''} imported to WSC Dinghy Racing 2026-2027`;
    if (updateExistingCount > 0) {
      message += `\n⚠️ ${updateExistingCount} update existing set to ignore — review in Halsail`;
    }

    // Send completion notification via Cloudflare Worker
    const res = await fetch(`${CF_WORKER_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': process.env.CF_WORKER_SECRET,
      },
      body: JSON.stringify({
        type: 'complete',
        imported: confirmedRows.length,
        updateExisting: updateExistingCount,
        message,
        boats: confirmedRows,
      }),
    });

    if (!res.ok) {
      throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
    }

    // Clear pending report from KV now import is done
    await fetch(`${CF_WORKER_URL}/clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': process.env.CF_WORKER_SECRET,
      },
      body: JSON.stringify({ key: 'pending_report' }),
    });

    console.log('Import complete — notification sent');

  } catch (err) {
    console.error('import.js error:', err);
    // Notify of failure so you know something went wrong
    await fetch(`${CF_WORKER_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': process.env.CF_WORKER_SECRET,
      },
      body: JSON.stringify({
        type: 'error',
        message: `❌ WSC import failed: ${err.message}`,
      }),
    }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();

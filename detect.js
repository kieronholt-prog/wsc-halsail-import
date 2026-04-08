import { chromium } from 'playwright';

const HALSAIL_URL = 'https://halsail.com';
const EMAIL = process.env.HALSAIL_EMAIL;
const PASSWORD = process.env.HALSAIL_PASSWORD;
const CF_WORKER_URL = process.env.CF_WORKER_URL;
const EVENT_NAME = 'WSC Dinghy Racing 2026-2027';

function normaliseName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectDuplicates(boats) {
  const duplicates = [];
  const seen = new Map();

  for (const boat of boats) {
    const key = `${normaliseName(boat.helm)}|${normaliseName(boat.className)}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      // Same helm + class but something differs
      if (
        existing.sailNo !== boat.sailNo ||
        normaliseName(existing.crew) !== normaliseName(boat.crew)
      ) {
        duplicates.push({ existing, incoming: boat });
      }
    } else {
      seen.set(key, boat);
    }
  }
  return duplicates;
}

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

    // Navigate to Boats > Import
    await page.click('text=Boats', { timeout: 10000 });
    await page.click('text=Import', { timeout: 10000 });
    await page.click('text=Import from SailEvent', { timeout: 10000 });
    console.log('On import page');

    // Select the event
    await page.selectOption('select', { label: EVENT_NAME });
    console.log(`Selected event: ${EVENT_NAME}`);

    // Click Preview Boats
    await page.click('text=Preview Boats', { timeout: 10000 });
    await page.waitForLoadState('networkidle');
    console.log('Preview loaded');

    // Read all rows from the preview table
    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) =>
          td.innerText.trim()
        );
        // Attempt to find a select/dropdown in the row for status
        const select = tr.querySelector('select');
        const status = select ? select.value : (cells[cells.length - 1] || '');
        return { cells, status };
      })
    );

    console.log(`Total rows found: ${rows.length}`);

    // Parse rows — adjust column indices based on actual Halsail table structure
    // Columns expected: Helm | Class | Sail No | Crew | Status
    const allBoats = [];
    let addNewCount = 0;
    let updateExistingCount = 0;

    for (const row of rows) {
      const c = row.cells;
      if (c.length < 3) continue;

      const boat = {
        helm: c[0] || '',
        className: c[1] || '',
        sailNo: c[2] || '',
        crew: c[3] || '',
        rawStatus: row.status,
      };

      const statusLower = (row.status || '').toLowerCase();

      if (statusLower.includes('add') || statusLower.includes('new') || statusLower === 'import') {
        boat.status = 'add_new';
        addNewCount++;
      } else if (statusLower.includes('update')) {
        boat.status = 'update_existing';
        updateExistingCount++;
      } else {
        boat.status = 'ignore';
      }

      allBoats.push(boat);
    }

    console.log(`Add New: ${addNewCount}, Update Existing: ${updateExistingCount}`);

    const newBoats = allBoats.filter((b) => b.status === 'add_new');
    const duplicates = detectDuplicates(allBoats);

    console.log(`Duplicates found: ${duplicates.length}`);

    // Only notify if there is something actionable
    if (addNewCount === 0 && duplicates.length === 0 && updateExistingCount === 0) {
      console.log('Nothing to report — silent exit');
      await browser.close();
      return;
    }

    // Build report payload — no full fleet data, only new boats and duplicate detail
    const report = {
      timestamp: new Date().toISOString(),
      addNew: addNewCount,
      updateExisting: updateExistingCount,
      duplicatesCount: duplicates.length,
      newBoats: newBoats.map((b) => ({
        helm: b.helm,
        className: b.className,
        sailNo: b.sailNo,
        crew: b.crew,
      })),
      duplicates: duplicates.map((d) => ({
        helm: d.existing.helm,
        className: d.existing.className,
        existing: { sailNo: d.existing.sailNo, crew: d.existing.crew },
        incoming: { sailNo: d.incoming.sailNo, crew: d.incoming.crew },
      })),
    };

    // Send to Cloudflare Worker (stores in KV + sends Web Push)
    const res = await fetch(`${CF_WORKER_URL}/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': process.env.CF_WORKER_SECRET,
      },
      body: JSON.stringify(report),
    });

    if (!res.ok) {
      throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
    }

    console.log('Report sent to worker successfully');

  } catch (err) {
    console.error('detect.js error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();

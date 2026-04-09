import { chromium } from 'playwright';

const HALSAIL_URL = 'https://halsail.com';
const EMAIL = process.env.HALSAIL_EMAIL;
const PASSWORD = process.env.HALSAIL_PASSWORD;
const CF_WORKER_URL = process.env.CF_WORKER_URL;

function normaliseName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectDuplicates(boats) {
  const duplicates = [];
  const seen = new Map();
  for (const boat of boats) {
    const key = `${normaliseName(boat.helm)}|${normaliseName(boat.boatClass)}|${boat.handicap}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (existing.sailNo !== boat.sailNo) {
        // Avoid adding same duplicate pair twice
        const dupKey = `${key}|${existing.sailNo}|${boat.sailNo}`;
        if (!duplicates.find(d => `${normaliseName(d.existing.helm)}|${normaliseName(d.existing.className)}|${d.existing.sailNo}|${d.incoming.sailNo}` === dupKey)) {
          duplicates.push({ existing, incoming: boat });
        }
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
await page.setViewportSize({ width: 1280, height: 800 });
  try {
    console.log('Navigating to Halsail...');
    await page.goto(HALSAIL_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    console.log('Page URL:', page.url());

    await page.fill('input[name="Email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.waitForTimeout(1000);
    await page.click('#btnLoginLarge');
    await page.waitForLoadState('networkidle');
    console.log('Logged in, URL:', page.url());

    await page.goto('https://halsail.com/Import/PreviewBoatsSailEvent/1727', { waitUntil: 'networkidle' });
    console.log('Preview page loaded, URL:', page.url());

    const rows = await page.$$eval('table tbody tr', (trs) =>
      trs.map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim());
        const select = tr.querySelector('select');
        const status = select ? select.options[select.selectedIndex]?.text || select.value : '';
        return { cells, status };
      })
    );

    console.log(`Total rows found: ${rows.length}`);

    const allBoats = [];
    let addNewCount = 0;
    let updateExistingCount = 0;

    for (const row of rows) {
      const c = row.cells;
      // Skip info/message rows — must have a select dropdown (status) and enough columns
      if (!row.status && c.length < 6) continue;
      if (c.length < 6) continue;
      // Skip rows where first cell is a long message (info rows)
      if (c[0].length > 30 && !row.status) continue;

      const boat = {
        sailNo:    c[1] || '',
        className: c[2] || '',
        owner:     c[3] || '',
        helm:      c[4] || '',
        crew:      c[5] || '',
        boatClass: c[6] || '',
        handicap:  c[7] || '',
        rawStatus: row.status,
      };

      const statusLower = (row.status || '').toLowerCase();
      if (statusLower.includes('add')) {
        boat.status = 'add_new';
        addNewCount++;
      } else if (statusLower.includes('update')) {
        boat.status = 'update_existing';
        updateExistingCount++;
      } else if (statusLower.includes('ignore')) {
        boat.status = 'ignore';
      } else {
        continue; // skip non-boat rows
      }

      allBoats.push(boat);
    }

    console.log(`Add New: ${addNewCount}, Update Existing: ${updateExistingCount}`);

    const newBoats = allBoats.filter((b) => b.status === 'add_new');
    const duplicates = detectDuplicates(allBoats);
    console.log(`Duplicates found: ${duplicates.length}`);

    if (addNewCount === 0 && duplicates.length === 0 && updateExistingCount === 0) {
      console.log('Nothing to report — silent exit');
      return;
    }

    const report = {
      timestamp: new Date().toISOString(),
      addNew: addNewCount,
      updateExisting: updateExistingCount,
      duplicatesCount: duplicates.length,
      newBoats: newBoats.map((b) => ({ helm: b.helm, className: b.boatClass, sailNo: b.sailNo, crew: b.crew })),
      duplicates: duplicates.map((d) => ({
        helm:      d.existing.helm,
        className: d.existing.boatClass,
        handicap:  d.existing.handicap,
        existing:  { sailNo: d.existing.sailNo, crew: d.existing.crew },
        incoming:  { sailNo: d.incoming.sailNo, crew: d.incoming.crew },
      })),
    };

    console.log('Report:', JSON.stringify(report, null, 2));

    const res = await fetch(`${CF_WORKER_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': process.env.CF_WORKER_SECRET },
      body: JSON.stringify(report),
    });

    if (!res.ok) throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
    console.log('Report sent to worker successfully');

  } catch (err) {
    console.error('detect.js error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();

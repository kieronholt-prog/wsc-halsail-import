# wsc-halsail-import

Private GitHub Actions repo for automated Halsail import detection and execution for Warsash Sailing Club.

---

## How it works

- **detect.yml** runs on a schedule, logs into Halsail, previews the SailEvent import, reads new/update/duplicate counts, and sends a Web Push notification if action is needed. It does NOT import anything.
- **import.yml** is triggered by the PWA when you tap "Import New Entries". It logs in, sets all "Update Existing" entries to Ignore, imports all "Add New" entries, reads the confirmation, and sends a completion notification.

---

## Initial setup

### 1. Clone and install locally (for testing)
```bash
git clone https://github.com/kieronholt-prog/wsc-halsail-import
cd wsc-halsail-import
npm install
npx playwright install chromium
```

### 2. Generate VAPID keys
Run this once to generate your Web Push key pair:
```bash
npx web-push generate-vapid-keys
```
Copy both keys — you'll need them in the next step.

### 3. GitHub Secrets
In your private repo: Settings → Secrets and variables → Actions → New repository secret

| Secret name         | Value |
|---------------------|-------|
| `HALSAIL_EMAIL`     | wscnewentries@gmail.com |
| `HALSAIL_PASSWORD`  | (your Halsail password) |
| `CF_WORKER_URL`     | https://wsc-import.YOUR.workers.dev |
| `CF_WORKER_SECRET`  | (random string — same value set in Cloudflare Worker secret) |
| `VAPID_PUBLIC_KEY`  | (from step 2) |
| `VAPID_PRIVATE_KEY` | (from step 2) |

### 4. Cloudflare Worker setup
See cloudflare-worker/README.md

### 5. PWA setup
See wsc-halsail-pwa/README.md

---

## Schedule
- Daily 08:00 UTC (09:00 BST / 08:00 GMT)
- Hourly 12:00–17:00 UTC on Wednesdays (13:00–18:00 BST)
- Hourly 12:00–17:00 UTC on Fridays (13:00–18:00 BST)

Note: GitHub Actions CRON uses UTC. BST is UTC+1 (late March to late October).
The workflows use 12:00–17:00 UTC which equals 13:00–18:00 BST in summer.
In winter (GMT=UTC) adjust the CRON to `0 13-18 * * 3,5` if needed.

---

## Duplicate detection
A duplicate is flagged when:
- Helm name matches (case-insensitive, whitespace normalised)
- Boat class matches
- Sail number OR crew differs

Checked across the full visible list on the Halsail preview screen.

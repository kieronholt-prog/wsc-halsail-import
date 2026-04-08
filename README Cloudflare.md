# Cloudflare Worker — WSC Import

Handles Web Push subscription storage, pending report storage, and push notification sending.

---

## Setup

### 1. Create a Cloudflare account
Sign up at cloudflare.com (free tier is sufficient).

### 2. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 3. Create the KV namespace
```bash
wrangler kv:namespace create WSC_KV
```
Copy the `id` from the output.

### 4. Create wrangler.toml
Create this file in the cloudflare-worker/ directory:

```toml
name = "wsc-import"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "WSC_KV"
id = "YOUR_KV_NAMESPACE_ID"
```

### 5. Set Worker secrets
```bash
wrangler secret put WORKER_SECRET
# Enter a random strong string — copy this to GitHub Secret CF_WORKER_SECRET

wrangler secret put VAPID_PUBLIC_KEY
# Paste your VAPID public key

wrangler secret put VAPID_PRIVATE_KEY
# Paste your VAPID private key
```

### 6. Set the PWA token in KV
This token is how the PWA authenticates with the worker to fetch reports.
Generate a random string and store it:
```bash
wrangler kv:key put --binding=WSC_KV pwa_token "YOUR_RANDOM_PWA_TOKEN"
```
Store the same token in your PWA's localStorage — the first time you open the PWA,
enter it when prompted, and it will be saved to localStorage.

### 7. Deploy
```bash
cd cloudflare-worker
wrangler deploy
```
Note the worker URL (e.g. https://wsc-import.YOUR.workers.dev)
Add this as `CF_WORKER_URL` in GitHub Secrets and in the PWA config.

---

## Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /subscribe | PWA token | Store push subscription |
| GET | /report | PWA token | Fetch pending report |
| POST | /detect | Worker secret | Store report + send notification 1 |
| POST | /notify | Worker secret | Send notification 2 (import complete) |
| POST | /clear | Worker secret | Clear KV key after import |

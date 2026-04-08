# wsc-halsail-pwa

Public GitHub Pages repo for the WSC New Entries PWA.

---

## Setup

### 1. Configure the PWA
Edit `index.html` and replace the config block at the top of the `<script>` section:

```javascript
const CF_WORKER_URL    = 'https://wsc-import.YOUR.workers.dev';
const VAPID_PUBLIC_KEY = 'YOUR_VAPID_PUBLIC_KEY';
const GITHUB_ORG       = 'kieronholt-prog';
const GITHUB_REPO      = 'wsc-halsail-import';
const GITHUB_TOKEN     = 'YOUR_GITHUB_PAT';
```

### 2. Create a GitHub Personal Access Token
The PAT lets the PWA trigger the import workflow in the private repo.

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. New fine-grained token:
   - Resource owner: kieronholt-prog
   - Repository access: Only select repositories → wsc-halsail-import
   - Permissions: Actions → Read and write
3. Copy the token into the PWA config above

### 3. Enable GitHub Pages
In the wsc-halsail-pwa repo:
Settings → Pages → Source: Deploy from branch → main → / (root)

Your PWA will be live at:
`https://kieronholt-prog.github.io/wsc-halsail-pwa/`

### 4. Add to iPhone home screen
1. Open the URL in Safari
2. When prompted to set a PIN, choose a 4–8 digit PIN
3. Tap Share → Add to Home Screen
4. When prompted, allow notifications

### 5. Set your PWA token
On first load, the app stores a unique token in localStorage.
You need to register this with the Cloudflare Worker so it can authenticate.

After opening the app and setting your PIN, open the browser console and run:
```javascript
localStorage.getItem('wsc_pwa_token')
```
Copy this value and update the KV store:
```bash
wrangler kv:key put --binding=WSC_KV pwa_token "PASTE_TOKEN_HERE"
```

---

## Icons
Add two PNG icons to the repo root:
- `icon-192.png` (192×192px)
- `icon-512.png` (512×512px)

Use the WSC burgee or any suitable sailing-related icon.

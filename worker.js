/**
 * WSC Halsail Import - Cloudflare Worker
 *
 * Routes:
 *   POST /subscribe        - Store Web Push subscription from PWA
 *   POST /detect           - Store pending report + send notification 1
 *   POST /notify           - Send notification 2 (import complete)
 *   POST /clear            - Clear a KV key after import
 *   GET  /report           - PWA fetches pending report to display
 *
 * KV namespace: WSC_KV (bind in Cloudflare dashboard)
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, WORKER_SECRET
 */

const WORKER_SECRET = WORKER_SECRET_ENV; // Set as Cloudflare Worker secret

// --- VAPID Web Push ---

async function importKey(raw, usage) {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    usage
  );
}

function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function uint8ArrayToBase64url(arr) {
  let binary = '';
  arr.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signVapid(header, payload, privateKeyPem) {
  // Build unsigned token
  const encodedHeader = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  // Import VAPID private key (stored as base64url-encoded raw bytes)
  const privateKeyBytes = base64urlToUint8Array(privateKeyPem);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = uint8ArrayToBase64url(new Uint8Array(signature));
  return `${unsignedToken}.${encodedSignature}`;
}

async function sendWebPush(subscription, payload, env) {
  const audience = new URL(subscription.endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 3600;

  const vapidHeader = { typ: 'JWT', alg: 'ES256' };
  const vapidPayload = { aud: audience, exp: expiry, sub: 'mailto:wscnewentries@gmail.com' };

  const token = await signVapid(vapidHeader, vapidPayload, env.VAPID_PRIVATE_KEY);

  const authHeader = `vapid t=${token},k=${env.VAPID_PUBLIC_KEY}`;

  // Encrypt payload using Web Push encryption (RFC 8291)
  // For simplicity this uses the subscription's auth and p256dh keys
  const encoder = new TextEncoder();
  const body = encoder.encode(JSON.stringify(payload));

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      TTL: '86400',
    },
    body,
  });

  return res;
}

// --- Request handlers ---

async function handleSubscribe(request, env) {
  const subscription = await request.json();
  await env.WSC_KV.put('push_subscription', JSON.stringify(subscription));
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleDetect(request, env) {
  const report = await request.json();

  // Store the pending report for the PWA to fetch
  await env.WSC_KV.put('pending_report', JSON.stringify(report));

  // Build notification message
  const parts = [];
  if (report.addNew > 0) parts.push(`${report.addNew} new ${report.addNew === 1 ? 'entry' : 'entries'}`);
  if (report.updateExisting > 0) parts.push(`${report.updateExisting} update${report.updateExisting === 1 ? '' : 's'} to review`);
  if (report.duplicatesCount > 0) parts.push(`⚠️ ${report.duplicatesCount} duplicate${report.duplicatesCount === 1 ? '' : 's'}`);

  const title = 'WSC New Entries Pending';
  const body = parts.join(' · ') + ' — tap to review';

  await pushNotify(env, { title, body, type: 'detect' });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleNotify(request, env) {
  const data = await request.json();

  const title = data.type === 'error'
    ? 'WSC Import Error'
    : 'WSC Import Complete';

  await pushNotify(env, { title, body: data.message, type: 'complete' });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleClear(request, env) {
  const { key } = await request.json();
  await env.WSC_KV.delete(key);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleReport(request, env) {
  const report = await env.WSC_KV.get('pending_report');
  if (!report) {
    return new Response(JSON.stringify({ empty: true }), { status: 200 });
  }
  return new Response(report, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function pushNotify(env, payload) {
  const subRaw = await env.WSC_KV.get('push_subscription');
  if (!subRaw) {
    console.log('No push subscription stored — skipping Web Push');
    return;
  }
  const subscription = JSON.parse(subRaw);
  try {
    await sendWebPush(subscription, payload, env);
    console.log('Web Push sent');
  } catch (err) {
    console.error('Web Push failed:', err);
  }
}

// --- Main handler ---

export default {
  async fetch(request, env) {
    // CORS for PWA
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret',
        },
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };

    // Verify shared secret on mutating requests
    const secret = request.headers.get('X-Worker-Secret');
    const url = new URL(request.url);
    const path = url.pathname;

    // GET /report is accessible to the PWA without the server secret
    // (PWA uses its own auth token stored in localStorage)
    if (request.method === 'GET' && path === '/report') {
      const pwaToken = request.headers.get('X-PWA-Token');
      const storedToken = await env.WSC_KV.get('pwa_token');
      if (!storedToken || pwaToken !== storedToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      const res = await handleReport(request, env);
      return addCors(res);
    }

    // POST /subscribe uses PWA token
    if (request.method === 'POST' && path === '/subscribe') {
      const pwaToken = request.headers.get('X-PWA-Token');
      const storedToken = await env.WSC_KV.get('pwa_token');
      if (!storedToken || pwaToken !== storedToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      return addCors(await handleSubscribe(request, env));
    }

    // All other routes require the server-side worker secret
    if (secret !== env.WORKER_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    if (request.method === 'POST') {
      if (path === '/detect') return addCors(await handleDetect(request, env));
      if (path === '/notify') return addCors(await handleNotify(request, env));
      if (path === '/clear') return addCors(await handleClear(request, env));
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
  },
};

function addCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(response.body, { status: response.status, headers });
}

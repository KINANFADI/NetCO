// NetCo network inspector. Every service in the lab runs this same small program with a
// different ROLE. Its page shows: who am I, how did you reach me, and what can I reach.
// No npm packages: only Node's built-in modules.
const http = require('http');
const os = require('os');
const fs = require('fs');
const net = require('net');
const dns = require('dns').promises;

const ROLE = process.env.ROLE || 'service';
const PORT = Number(process.env.PORT) || 3000;
const COMPANY = process.env.COMPANY_NAME || '';
const API_URL = (process.env.API_URL || '').replace(/\/$/, '');
const CHECKS = (process.env.CHECKS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [target, expect] = s.split('='); return { target, expect: expect !== 'no' }; });

const ABOUT = {
  website: 'Public website. Customers reach it through Cloudflare. Staff can also reach it through Traefik (the reverse proxy).',
  api: 'Internal API. It has no domain and no open ports. Only other containers can call it, by its name: api.',
  worker: 'Background worker. It lives only in the private "backend" network, which has NO internet access.',
  admin: 'Team-only admin panel. Its door is opened only on the Tailscale address, so only your team can reach it.',
  payroll: 'Another team\'s app, in a separate Dokploy service. It should not be able to see NetCo\'s containers.',
};

// ---------- facts about this container ----------
function myAddresses() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ iface, ip: a.address });
  }
  return out;
}

function dnsServer() {
  try {
    const m = fs.readFileSync('/etc/resolv.conf', 'utf8').match(/^nameserver\s+(\S+)/m);
    return m ? m[1] : 'unknown';
  } catch { return 'unknown'; }
}

// ---------- checks ----------
async function checkInternet() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: ctrl.signal });
    const text = await r.text();
    const ip = (text.match(/^ip=(.+)$/m) || [])[1] || 'unknown';
    return { ok: true, detail: `Reached the internet. The internet sees us as ${ip} (our public address).`, publicIp: ip };
  } catch {
    return { ok: false, detail: 'Could not reach the internet. Outbound traffic is blocked for this network.' };
  } finally {
    clearTimeout(timer);
  }
}

async function checkDoor(host, port) {
  let ip;
  try {
    ip = (await dns.lookup(host)).address;
  } catch {
    return { ok: false, detail: `The name "${host}" was not found. It is not on any network I am connected to.` };
  }
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    const done = (ok, detail) => { sock.destroy(); resolve({ ok, detail }); };
    sock.setTimeout(2500, () => done(false, `Found "${host}" at ${ip}, but door ${port} did not answer.`));
    sock.on('connect', () => done(true, `Found "${host}" at ${ip}, and door ${port} is open.`));
    sock.on('error', (e) => done(false, `Found "${host}" at ${ip}, but door ${port} refused (${e.code}).`));
  });
}

async function runChecks() {
  return Promise.all(CHECKS.map(async ({ target, expect }) => {
    let r;
    if (target === 'internet') r = await checkInternet();
    else {
      const [host, port] = target.split(':');
      r = await checkDoor(host, Number(port));
    }
    return { target, expect, ...r, asExpected: r.ok === expect };
  }));
}

function howYouReachedMe(req) {
  const h = req.headers;
  let path = 'Directly to this container\'s door (no proxy in between).';
  if (h['cf-ray']) path = 'Internet → Cloudflare → tunnel → this container.';
  else if (h['x-forwarded-for']) path = 'Your browser → Traefik (the reverse proxy) → this container.';
  let protocol = h['x-forwarded-proto'] || 'http';
  try { if (h['cf-visitor']) protocol = JSON.parse(h['cf-visitor']).scheme || protocol; } catch {}
  return {
    path,
    nameYouTyped: h.host || '',
    protocol,
    yourAddress: h['cf-connecting-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress,
    lastHop: req.socket.remoteAddress,
  };
}

async function info(req) {
  const checks = await runChecks();
  return {
    role: ROLE,
    about: ABOUT[ROLE] || '',
    company: COMPANY || null,
    container: os.hostname(),
    addresses: myAddresses(),
    phoneBook: dnsServer(),
    reached: req ? howYouReachedMe(req) : null,
    checks,
  };
}

// ---------- page ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(d) {
  const good = d.checks.filter((c) => c.asExpected).length;
  const allGood = good === d.checks.length;
  const rows = d.checks.map((c) => `
    <tr>
      <td><code>${esc(c.target)}</code></td>
      <td>${c.expect ? 'Should reach' : 'Should NOT reach'}</td>
      <td>${c.ok ? 'Reached' : 'Not reached'}</td>
      <td>${esc(c.detail)}</td>
      <td class="${c.asExpected ? 'ok' : 'bad'}">${c.asExpected ? '✔ As expected' : '✘ Not as expected'}</td>
    </tr>`).join('');
  const addr = d.addresses.map((a) => `<li><code>${esc(a.ip)}</code> <span class="muted">(${esc(a.iface)})</span></li>`).join('');
  const r = d.reached || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.role)} · NetCo</title>
<style>
:root{--bg:#F4F6F8;--ink:#17212B;--muted:#5D6B78;--line:#D4DBE2;--ok:#1C7A4B;--bad:#B3261E;--accent:#1F5E8C}
@media (prefers-color-scheme:dark){:root{--bg:#121920;--ink:#E3E9EF;--muted:#98A6B3;--line:#2A3846;--ok:#4CC38A;--bad:#F07167;--accent:#7FB6E2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:28px 20px 60px}
h1{margin:0;font-size:32px}h2{margin:30px 0 6px;font-size:20px}
.muted{color:var(--muted)}.verdict{font-size:20px;font-weight:700;margin:10px 0 0}
.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:400}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
button{font:inherit;font-weight:700;padding:8px 14px;border:2px solid var(--ink);border-radius:6px;background:transparent;color:var(--ink);cursor:pointer}
button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
pre{padding:12px;border:1px solid var(--line);border-radius:6px;overflow-x:auto;font-size:13px}
</style></head><body><main>
<h1>${esc(d.role)}</h1>
<p class="muted">${esc(d.about)}</p>
<p class="verdict ${allGood ? 'ok' : 'bad'}">${good} of ${d.checks.length} network checks as expected</p>
<p class="muted">Company setting: ${d.company ? `<span class="ok">loaded (${esc(d.company)})</span>` : '<span class="bad">not loaded. The Environment tab values did not reach this container.</span>'}</p>

<h2>1. Who am I?</h2>
<dl>
  <dt>Container name</dt><dd><code>${esc(d.container)}</code></dd>
  <dt>My private addresses</dt><dd><ul style="margin:0;padding-left:18px">${addr}</ul>
    <span class="muted">One address per Docker network I am connected to.</span></dd>
  <dt>My phone book (DNS)</dt><dd><code>${esc(d.phoneBook)}</code> <span class="muted">${d.phoneBook === '127.0.0.11' ? 'This is Docker\'s built-in phone book. It knows container names.' : ''}</span></dd>
</dl>

<h2>2. How did you reach me?</h2>
<dl>
  <dt>The path</dt><dd><strong>${esc(r.path)}</strong></dd>
  <dt>Name you typed</dt><dd><code>${esc(r.nameYouTyped)}</code></dd>
  <dt>Protocol</dt><dd>${esc(r.protocol)} ${r.protocol === 'https' ? '<span class="ok">(encrypted, padlock)</span>' : '<span class="muted">(not encrypted)</span>'}</dd>
  <dt>Your address</dt><dd><code>${esc(r.yourAddress)}</code></dd>
  <dt>Last step before me</dt><dd><code>${esc(r.lastHop)}</code> <span class="muted">(whoever handed me the request)</span></dd>
</dl>

<h2>3. What can I reach?</h2>
<div class="wrap"><table>
  <thead><tr><th>Target</th><th>Expected</th><th>Result</th><th>What happened</th><th>Verdict</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>

${API_URL ? `<h2>4. Call the internal API</h2>
<p class="muted">Your browser cannot reach the API. Only this website container can, from the inside, by the name in <code>${esc(API_URL)}</code>.</p>
<button id="ask">Ask the API</button>
<pre id="out">Not asked yet.</pre>
<script>
document.getElementById('ask').addEventListener('click', async () => {
  const out = document.getElementById('out');
  out.textContent = 'Asking...';
  try { const r = await fetch('/api-check'); out.textContent = JSON.stringify(await r.json(), null, 2); }
  catch (e) { out.textContent = 'Failed: ' + e.message; }
});
</script>` : ''}
<p class="muted" style="margin-top:30px">Raw data: <a href="/info.json">/info.json</a></p>
</main></body></html>`;
}

// ---------- server ----------
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body, null, 2) : body);
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (url.pathname === '/info.json') return send(res, 200, await info(req));
    if (url.pathname === '/api-check') {
      if (!API_URL) return send(res, 404, { error: 'This service has no API_URL' });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(`${API_URL}/info.json`, { signal: ctrl.signal });
        const d = await r.json();
        return send(res, 200, {
          answered: true,
          calledAddress: API_URL,
          apiContainer: d.container,
          apiAddresses: d.addresses.map((a) => a.ip),
          apiChecks: d.checks.map((c) => `${c.target}: ${c.ok ? 'reached' : 'not reached'} (${c.asExpected ? 'as expected' : 'NOT as expected'})`),
        });
      } catch (e) {
        return send(res, 502, { answered: false, calledAddress: API_URL, problem: e.cause?.code === 'ENOTFOUND' ? `Name not found: the phone book has no "${new URL(API_URL).hostname}"` : e.message });
      } finally {
        clearTimeout(timer);
      }
    }
    if (url.pathname === '/') return send(res, 200, page(await info(req)), 'text/html; charset=utf-8');
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[${ROLE}] listening on port ${PORT} inside the container`));

// Write the check results to the logs at start and every minute (so you can verify from the Logs tab).
async function logChecks() {
  const d = await info(null);
  console.log(`[${ROLE}] container ${d.container}, addresses ${d.addresses.map((a) => a.ip).join(', ') || 'none'}`);
  for (const c of d.checks) {
    console.log(`[${ROLE}] ${c.target.padEnd(14)} ${c.ok ? 'REACHED    ' : 'NOT REACHED'} ${c.asExpected ? '(as expected)' : '(NOT AS EXPECTED)'}`);
  }
}
setTimeout(logChecks, 5000);
setInterval(logChecks, 60_000);

process.on('SIGTERM', () => process.exit(0));

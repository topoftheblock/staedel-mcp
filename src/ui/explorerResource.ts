// src/ui/explorerResource.ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

/**
 * The MCP Apps SDK ships a dependency-free browser bundle (`app-with-deps.js`) meant to be
 * embedded directly in a UI resource. We read it once at startup, base64-encode it, and inline
 * it into the served HTML so the sandboxed iframe has zero external network dependencies.
 */
function loadSdkBundleSource(): string {
  const require = createRequire(import.meta.url);
  const bundlePath = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
  return readFileSync(bundlePath, 'utf-8');
}

export const EXPLORER_RESOURCE_URI = 'ui://staedel/explorer.html';

let cachedHtml: string | undefined;

export function buildExplorerHtml(): string {
  if (cachedHtml) return cachedHtml;

  const sdkSource = loadSdkBundleSource();
  const sdkSourceB64 = Buffer.from(sdkSource, 'utf-8').toString('base64');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
    background: var(--color-background-primary, #fff);
    color: var(--color-text-primary, #111);
  }
  #root { padding: 16px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  select, input, button {
    font: inherit;
    padding: 6px 10px;
    border-radius: var(--border-radius-md, 6px);
    border: 1px solid var(--color-border-primary, #ccc);
    background: var(--color-background-secondary, #f5f5f5);
    color: inherit;
  }
  button { cursor: pointer; }
  button.primary {
    background: var(--color-background-info, #2563eb);
    color: var(--color-text-inverse, #fff);
    border-color: transparent;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .card {
    border: 1px solid var(--color-border-primary, #ddd);
    border-radius: var(--border-radius-lg, 10px);
    padding: 10px;
    cursor: pointer;
    background: var(--color-background-secondary, #fafafa);
    font-size: var(--font-text-sm-size, 13px);
    word-break: break-word;
  }
  .card:hover { border-color: var(--color-border-info, #2563eb); }
  .muted { color: var(--color-text-secondary, #666); font-size: var(--font-text-xs-size, 12px); }
  .detail { max-width: 480px; }
  .detail img { max-width: 100%; border-radius: var(--border-radius-md, 6px); display: block; margin: 10px 0; }
  .credit { font-size: var(--font-text-xs-size, 11px); color: var(--color-text-secondary, #666); }
  .back { margin-bottom: 12px; }
  .status { padding: 20px 0; color: var(--color-text-secondary, #666); }
  .error { color: var(--color-text-danger, #b91c1c); }
</style>
</head>
<body>
<div id="root">
  <div class="status">Loading Städel Explorer…</div>
</div>
<script type="module">
const SDK_SOURCE_B64 = ${JSON.stringify(sdkSourceB64)};

function decodeBase64Utf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

const sdkUrl = URL.createObjectURL(new Blob([decodeBase64Utf8(SDK_SOURCE_B64)], { type: 'text/javascript' }));
const { App, PostMessageTransport, applyHostStyleVariables, applyDocumentTheme } = await import(sdkUrl);

const root = document.getElementById('root');
const app = new App({ name: 'staedel-explorer', version: '1.0.0' }, {});

let filters = { set: '', from: '', until: '' };
let resumptionToken;

function applyHostContext() {
  const ctx = app.getHostContext();
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
}

app.addEventListener('hostcontextchanged', applyHostContext);
app.ontoolinput = (params) => {
  const args = params?.arguments ?? {};
  filters = { set: args.set ?? '', from: args.from ?? '', until: args.until ?? '' };
  renderToolbar();
  runSearch();
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function fetchSets() {
  try {
    const result = await app.callServerTool({ name: 'list-sets', arguments: {} });
    return result.structuredContent?.sets ?? [];
  } catch {
    return [];
  }
}

function renderToolbar(sets = []) {
  root.querySelector('.toolbar')?.remove();
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.innerHTML = \`
    <select id="set-select">
      <option value="">All sets</option>
      \${sets.map(s => \`<option value="\${escapeHtml(s.setSpec)}" \${s.setSpec === filters.set ? 'selected' : ''}>\${escapeHtml(s.setName)}</option>\`).join('')}
    </select>
    <input id="from-input" type="date" value="\${escapeHtml(filters.from)}" title="From date" />
    <input id="until-input" type="date" value="\${escapeHtml(filters.until)}" title="Until date" />
    <button class="primary" id="search-btn">Search</button>
  \`;
  root.prepend(toolbar);

  toolbar.querySelector('#search-btn').addEventListener('click', () => {
    filters = {
      set: toolbar.querySelector('#set-select').value,
      from: toolbar.querySelector('#from-input').value,
      until: toolbar.querySelector('#until-input').value,
    };
    runSearch();
  });
}

function renderStatus(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'status' + (isError ? ' error' : '');
  el.textContent = message;
  root.querySelector('.results')?.remove();
  const results = document.createElement('div');
  results.className = 'results';
  results.appendChild(el);
  root.appendChild(results);
}

async function runSearch(append = false) {
  if (!append) resumptionToken = undefined;
  renderStatus('Searching the Städel collection…');
  try {
    const result = await app.callServerTool({
      name: 'search-museum-objects',
      arguments: {
        set: filters.set || undefined,
        from: filters.from || undefined,
        until: filters.until || undefined,
        resumptionToken: append ? resumptionToken : undefined,
      },
    });
    const data = result.structuredContent ?? {};
    resumptionToken = data.resumptionToken;
    renderResults(data.records ?? [], append);
  } catch (err) {
    renderStatus('Could not search the collection: ' + err, true);
  }
}

function renderResults(records, append) {
  let results = root.querySelector('.results');
  if (!results || !append) {
    results = document.createElement('div');
    results.className = 'results';
    root.querySelector('.results')?.remove();
    root.appendChild(results);
  }

  if (records.length === 0 && !append) {
    results.innerHTML = '<div class="status">No records found for these filters.</div>';
    return;
  }

  const grid = results.querySelector('.grid') ?? (() => {
    const g = document.createElement('div');
    g.className = 'grid';
    results.appendChild(g);
    return g;
  })();

  for (const objectId of records) {
    const card = document.createElement('div');
    card.className = 'card';
    card.textContent = objectId.replace(/^oai:/, '');
    card.addEventListener('click', () => showDetail(objectId));
    grid.appendChild(card);
  }

  results.querySelector('.load-more')?.remove();
  if (resumptionToken) {
    const btn = document.createElement('button');
    btn.textContent = 'Load more';
    btn.className = 'load-more';
    btn.style.marginTop = '12px';
    btn.addEventListener('click', () => runSearch(true));
    results.appendChild(btn);
  }
}

async function showDetail(objectId) {
  renderStatus('Loading object…');
  try {
    const result = await app.callServerTool({
      name: 'get-museum-object',
      arguments: { objectId, returnImage: false },
    });
    const obj = result.structuredContent?.object;
    if (!obj) throw new Error('No data returned for this object.');

    const results = document.createElement('div');
    results.className = 'results detail';
    results.innerHTML = \`
      <button class="back">← Back to results</button>
      <h3>\${escapeHtml(obj.primaryTitle)}</h3>
      <div class="muted">\${escapeHtml(obj.artistDisplayName)} · \${escapeHtml(obj.objectDate)}</div>
      \${obj.primaryImage ? \`<img src="\${escapeHtml(obj.primaryImage)}" alt="\${escapeHtml(obj.primaryTitle)}" />\` : ''}
      <p>\${escapeHtml(Object.values(obj.medium ?? {})[0] ?? '')}</p>
      <p class="muted">\${escapeHtml(Object.values(obj.dimensions ?? {})[0] ?? '')}</p>
      <p class="credit">\${escapeHtml(obj.license)}</p>
    \`;
    root.querySelector('.results')?.remove();
    root.appendChild(results);
    results.querySelector('.back').addEventListener('click', () => runSearch());
  } catch (err) {
    renderStatus('Could not load this object: ' + err, true);
  }
}

await app.connect(new PostMessageTransport(window.parent, window.parent));
applyHostContext();

const sets = await fetchSets();
renderToolbar(sets);
renderStatus('Choose a set or date range, then press Search.');
</script>
</body>
</html>
`;

  cachedHtml = html;
  return html;
}

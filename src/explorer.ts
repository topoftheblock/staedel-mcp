import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const EXPLORER_URI = 'ui://staedel/explorer.html';

// The MCP Apps SDK ships a dependency-free browser bundle. It is inlined (as base64, so nothing in
// it can end the <script> early) to keep the sandboxed iframe free of network dependencies.
const sdk = readFileSync(createRequire(import.meta.url).resolve('@modelcontextprotocol/ext-apps/app-with-deps'), 'base64');

export const EXPLORER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
    background: var(--color-background-primary, #fff);
    color: var(--color-text-primary, #111);
  }
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
  .more { margin-top: 12px; }
  .muted { color: var(--color-text-secondary, #666); font-size: var(--font-text-xs-size, 12px); }
  .detail { max-width: 480px; }
  .detail img { max-width: 100%; border-radius: var(--border-radius-md, 6px); display: block; margin: 10px 0; }
  .back { margin-bottom: 12px; }
  .status { padding: 20px 0; color: var(--color-text-secondary, #666); }
  .error { color: var(--color-text-danger, #b91c1c); }
</style>
</head>
<body>
<div class="toolbar"></div>
<div class="results"><div class="status">Loading Städel Explorer…</div></div>
<script type="module">
const sdkUrl = URL.createObjectURL(new Blob(
  [Uint8Array.from(atob(${JSON.stringify(sdk)}), c => c.charCodeAt(0))],
  { type: 'text/javascript' },
));
const { App, PostMessageTransport, applyHostStyleVariables, applyDocumentTheme } = await import(sdkUrl);

const toolbar = document.querySelector('.toolbar');
const results = document.querySelector('.results');
const app = new App({ name: 'staedel-explorer', version: '1.0.0' }, {});

function el(tag, className, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

let sets = [];
let filters = { set: '', from: '', until: '' };
let resumptionToken;
let grid;
const more = el('button', 'more', 'Load more');
more.onclick = () => { more.disabled = true; runSearch(true); };

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localized = byLang => byLang?.en ?? Object.values(byLang ?? {})[0];

const showStatus = (message, isError) => results.replaceChildren(el('div', isError ? 'status error' : 'status', message));

async function callTool(name, args = {}) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.[0]?.text ?? 'Tool call failed');
  return result.structuredContent ?? {};
}

function applyHostContext() {
  const ctx = app.getHostContext();
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
}

function renderToolbar() {
  toolbar.innerHTML = \`
    <select>
      <option value="">All sets</option>
      \${sets.map(s => \`<option value="\${escapeHtml(s.setSpec)}" \${s.setSpec === filters.set ? 'selected' : ''}>\${escapeHtml(s.setName)}</option>\`).join('')}
    </select>
    <input type="date" value="\${escapeHtml(filters.from)}" title="From date" />
    <input type="date" value="\${escapeHtml(filters.until)}" title="Until date" />
    <button class="primary">Search</button>
  \`;
  const [set, from, until, search] = toolbar.children;
  search.onclick = () => {
    filters = { set: set.value, from: from.value, until: until.value };
    runSearch();
  };
}

async function runSearch(append = false) {
  if (!append) showStatus('Searching the Städel collection…');
  try {
    const page = await callTool('search-museum-objects', append
      ? { resumptionToken }
      : Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
    resumptionToken = page.resumptionToken;
    if (!append) results.replaceChildren(grid = el('div', 'grid'), more);
    more.hidden = !resumptionToken;
    more.disabled = false;

    for (const id of page.records ?? []) {
      const card = el('div', 'card', id.replace(/^oai:/, ''));
      card.onclick = () => showDetail(id);
      grid.append(card);
    }
    if (!resumptionToken && !grid.children.length) showStatus('No records found for these filters.');
  } catch (err) {
    showStatus('Could not search the collection: ' + err.message, true);
  }
}

async function showDetail(objectId) {
  const list = [...results.children];
  showStatus('Loading object…');
  try {
    const { object } = await callTool('get-museum-object', { objectId, returnImage: false });
    const detail = el('div', 'detail');
    detail.innerHTML = \`
      <button class="back">← Back to results</button>
      <h3>\${escapeHtml(object.primaryTitle)}</h3>
      <div class="muted">\${escapeHtml(object.artistDisplayName)} · \${escapeHtml(object.objectDate)}</div>
      \${object.primaryImage ? \`<img src="\${escapeHtml(object.primaryImage)}" alt="\${escapeHtml(object.primaryTitle)}" />\` : ''}
      <p>\${escapeHtml(localized(object.medium))}</p>
      <p class="muted">\${escapeHtml(localized(object.dimensions))}</p>
      <p class="muted">\${escapeHtml(object.license)}</p>
    \`;
    detail.firstElementChild.onclick = () => results.replaceChildren(...list);
    results.replaceChildren(detail);
  } catch (err) {
    showStatus('Could not load this object: ' + err.message, true);
  }
}

app.addEventListener('hostcontextchanged', applyHostContext);
app.ontoolinput = params => {
  const args = params?.arguments ?? {};
  filters = { set: args.set ?? '', from: args.from ?? '', until: args.until ?? '' };
  renderToolbar();
  runSearch();
};

await app.connect(new PostMessageTransport(window.parent, window.parent));
applyHostContext();
renderToolbar();
showStatus('Choose a set or date range, then press Search.');
sets = (await callTool('list-sets').catch(() => ({}))).sets ?? [];
renderToolbar();
</script>
</body>
</html>
`;

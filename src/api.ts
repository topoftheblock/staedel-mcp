import { XMLParser } from 'fast-xml-parser';

// Städel OAI-PMH endpoint, see https://sammlung.staedelmuseum.de/en/oai/guide
const BASE_URL = 'https://sammlung.staedelmuseum.de/api/oai';
const ID_PREFIX = 'oai:DE-MUS-048017:'; // DE-MUS-048017 is the Städel's ISIL
const TIMEOUT_MS = Math.max(0, Number(process.env.STAEDEL_API_TIMEOUT_MS)) || 10_000;
const RETRIES = 2;
const BACKOFF_MS = 300;
const MIN_INTERVAL_MS = 100;

// Tag values stay strings so titles like "1984" or "007" survive untouched.
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (_name, jpath) => jpath === 'OAI-PMH.ListSets.set' || jpath === 'OAI-PMH.ListIdentifiers.header',
});

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Requests run one at a time, MIN_INTERVAL_MS apart, so a burst of tool calls can't hammer the museum.
let queue: Promise<unknown> = Promise.resolve();
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => {}).then(() => sleep(MIN_INTERVAL_MS));
  return result;
}

/** GET with a timeout; retries 503s and timeouts with a linear backoff. */
async function request(url: string, accept: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => fetch(url, {
      headers: { Accept: accept, 'User-Agent': 'staedel-mcp/1.0 (+https://github.com/topoftheblock/staedel-mcp)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })).catch((error: Error) => error);

    if (res instanceof Response && res.ok) return res;
    const transient = res instanceof Response ? res.status === 503 : res.name === 'TimeoutError';
    if (!transient || attempt === RETRIES) {
      throw new Error(`Städel request failed: ${res instanceof Response ? `HTTP ${res.status}` : res.message}`);
    }
    await sleep(BACKOFF_MS * (attempt + 1));
  }
}

async function oai(verb: string, params: Record<string, string | undefined>): Promise<any> {
  const query = new URLSearchParams({ verb });
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);

  const res = await request(`${BASE_URL}?${query}`, 'application/xml');
  const body = parser.parse(await res.text())['OAI-PMH'];
  // OAI-PMH reports errors (e.g. idDoesNotExist) with HTTP 200 and an <error> element.
  if (body?.error !== undefined) throw new Error(`Städel OAI-PMH error: ${body.error['@_code'] ?? 'unknown'}`);
  return body?.[verb];
}

export interface Filters { set?: string; from?: string; until?: string; resumptionToken?: string }

export async function listSets(): Promise<Array<{ setSpec: string; setName: string }>> {
  const sets = (await oai('ListSets', {}))?.set ?? [];
  return sets.map((s: any) => ({ setSpec: s.setSpec, setName: s.setName }));
}

/** One page of identifiers of live (non-deleted) records, plus the token for the next page if any. */
export async function listIdentifiers({ resumptionToken, ...filters }: Filters) {
  // A resumptionToken must be sent on its own; it already encodes the original filters.
  const page = await oai('ListIdentifiers', resumptionToken ? { resumptionToken } : { metadataPrefix: 'lido', ...filters });
  const records: string[] = (page?.header ?? [])
    .filter((h: any) => h['@_status'] !== 'deleted')
    .map((h: any) => h.identifier);
  // The last page carries an empty <resumptionToken/>, which parses to an object without text.
  const next: string | undefined = page?.resumptionToken?.['#text'];
  return { records, resumptionToken: next };
}

/** The raw LIDO record for an OAI identifier or bare object number; undefined if it was deleted. */
export async function getLido(id: string): Promise<{ identifier: string; lido: any } | undefined> {
  const identifier = id.startsWith('oai:') ? id : ID_PREFIX + id;
  const record = (await oai('GetRecord', { identifier, metadataPrefix: 'lido' }))?.record;
  const lido = record?.metadata?.['lido:lidoWrap']?.['lido:lido'];
  return lido && { identifier, lido };
}

export async function getImage(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await request(url, 'image/*');
  const mimeType = res.headers.get('content-type')?.split(';')[0].trim();
  return {
    data: Buffer.from(await res.arrayBuffer()).toString('base64'),
    mimeType: mimeType?.startsWith('image/') ? mimeType : 'image/jpeg',
  };
}

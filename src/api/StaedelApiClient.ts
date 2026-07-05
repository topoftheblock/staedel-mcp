// src/api/StaedelApiClient.ts
import { XMLParser } from 'fast-xml-parser';
import process from 'node:process';
import { staedelRateLimiter } from '../utils/RateLimiter.js';
import { DEFAULT_STAEDEL_API_TIMEOUT_MS, STAEDEL_ISIL } from '../constants.js';

// Configuration helpers
function getApiTimeoutMs(): number {
  const rawTimeout = process.env.STAEDEL_API_TIMEOUT_MS;
  const parsedTimeout = Number.parseInt(rawTimeout || '', 10);
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_STAEDEL_API_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Custom Error Class
export class StaedelApiError extends Error {
  public readonly status: number | undefined;
  public readonly isUserFriendly: boolean;

  constructor(message: string, status?: number, isUserFriendly: boolean = false) {
    super(message);
    this.name = 'StaedelApiError';
    this.status = status;
    this.isUserFriendly = isUserFriendly;
  }
}

export class StaedelApiClient {
  // Städel's OAI-PMH Base URL (see https://sammlung.staedelmuseum.de/en/oai/guide)
  private readonly baseUrl: string = 'https://sammlung.staedelmuseum.de/api/oai';
  private readonly requestTimeoutMs: number = getApiTimeoutMs();
  private readonly transientRetryCount: number = 2;
  private readonly transientRetryBackoffMs: number = 300;

  // XML Parser instance
  private readonly parser: XMLParser;

  constructor() {
    // Configure fast-xml-parser to handle LIDO attributes and arrays safely
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      // Ensure repeated tags (like multiple artists or sets) are always parsed as arrays, even if there's only one.
      isArray: (name, jpath) => {
        const arrayPaths = [
          'OAI-PMH.ListSets.set',
          'OAI-PMH.ListRecords.record',
          'OAI-PMH.GetRecord.record.metadata.lido:lidoWrap.lido:lido.lido:descriptiveMetadata.lido:eventWrap.lido:eventSet',
          'OAI-PMH.GetRecord.record.metadata.lido:lidoWrap.lido:lido.lido:descriptiveMetadata.lido:objectIdentificationWrap.lido:titleWrap.lido:titleSet',
          'OAI-PMH.GetRecord.record.metadata.lido:lidoWrap.lido:lido.lido:administrativeMetadata.lido:resourceWrap.lido:resourceSet',
        ];
        return arrayPaths.includes(jpath);
      }
    });
  }

  /**
   * Fetches the organizational groupings (Sets) available in the Städel API.
   */
  public async listSets(): Promise<any> {
    const url = `${this.baseUrl}?verb=ListSets`;
    const parsed = await this.fetchAndParseXml(url);
    this.checkForOaiError(parsed);

    // OAI-PMH encapsulates sets in <ListSets><set>...</set></ListSets>
    return parsed['OAI-PMH']?.ListSets?.set || [];
  }

  /**
   * Searches for objects. Since OAI-PMH is for harvesting, we use ListRecords.
   * Filtering is done via Datestamps (from/until) or Sets.
   */
  public async listRecords(options: { set?: string; from?: string; until?: string; resumptionToken?: string }): Promise<any> {
    let url = `${this.baseUrl}?verb=ListRecords`;

    // OAI-PMH requires passing ONLY the resumptionToken if paginating
    if (options.resumptionToken) {
      url += `&resumptionToken=${encodeURIComponent(options.resumptionToken)}`;
    } else {
      url += `&metadataPrefix=lido`;
      if (options.set) url += `&set=${encodeURIComponent(options.set)}`;
      if (options.from) url += `&from=${encodeURIComponent(options.from)}`;
      if (options.until) url += `&until=${encodeURIComponent(options.until)}`;
    }

    const parsed = await this.fetchAndParseXml(url);
    this.checkForOaiError(parsed);

    return parsed['OAI-PMH']?.ListRecords;
  }

  /**
   * Gets rich LIDO metadata for a specific artwork using GetRecord.
   */
  public async getRecord(identifier: string): Promise<any> {
    // Format identifier to OAI standard if the user only provides the bare object number
    const oaiId = identifier.startsWith('oai:')
      ? identifier
      : `oai:${STAEDEL_ISIL}:${identifier}`;

    const url = `${this.baseUrl}?verb=GetRecord&identifier=${encodeURIComponent(oaiId)}&metadataPrefix=lido`;

    const parsed = await this.fetchAndParseXml(url);
    this.checkForOaiError(parsed);

    return parsed['OAI-PMH']?.GetRecord?.record;
  }

  /**
   * Downloads an image from the provided URL and converts it to a base64 string.
   */
  public async getImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string }> {
    const response = await this.fetchWithTransientRetry(imageUrl, { Accept: 'image/*' });

    if (!response.ok) {
      throw new StaedelApiError('Unable to load the artwork image right now.', response.status, true);
    }

    const mimeTypeHeader = response.headers.get('content-type') ?? '';
    const parsedMimeType = mimeTypeHeader.split(';')[0]?.trim();
    const mimeType = parsedMimeType?.startsWith('image/') ? parsedMimeType : 'image/jpeg';

    const imageBytes = await response.arrayBuffer();
    return {
      data: Buffer.from(imageBytes).toString('base64'),
      mimeType,
    };
  }

  // --- Helper Methods ---

  /**
   * Fetches data and parses it from XML into a JSON object.
   */
  private async fetchAndParseXml(url: string): Promise<any> {
    const response = await this.fetchWithTransientRetry(url, { Accept: 'application/xml' });

    if (!response.ok) {
      throw new StaedelApiError(`The Städel API returned an error (HTTP ${response.status}).`, response.status, true);
    }

    const xmlData = await response.text();
    return this.parser.parse(xmlData);
  }

  /**
   * OAI-PMH returns HTTP 200 even for errors (e.g., idDoesNotExist).
   * We must inspect the XML structure for the <error> tag.
   */
  private checkForOaiError(parsedJson: any): void {
    if (parsedJson['OAI-PMH']?.error) {
      const errorNode = parsedJson['OAI-PMH'].error;
      const errorCode = errorNode['@_code'];
      const errorMessage = errorNode['#text'] || 'Unknown OAI-PMH Error';

      const status = errorCode === 'idDoesNotExist' ? 404 : 400;

      throw new StaedelApiError(`Städel API Error (${errorCode}): ${errorMessage}`, status, true);
    }
  }

  /**
   * Reliable fetching with timeouts and rate-limit backoffs.
   */
  private async fetchWithTransientRetry(url: string, headers: Record<string, string>): Promise<Response> {
    let attempt = 0;
    while (true) {
      try {
        const response = await staedelRateLimiter.fetch(url, {
          headers: { 'User-Agent': 'staedel-mcp/1.0 (+https://github.com/topoftheblock/staedel-mcp)', ...headers },
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        // Handle temporary 503 unavailability
        if (response.status === 503 && attempt < this.transientRetryCount) {
          await sleep(this.transientRetryBackoffMs * (attempt + 1));
          attempt += 1;
          continue;
        }
        return response;
      } catch (error) {
        const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        if (isTimeout && attempt < this.transientRetryCount) {
          await sleep(this.transientRetryBackoffMs * (attempt + 1));
          attempt += 1;
          continue;
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new StaedelApiError('The Städel API is unreachable. Please check your internet connection.', undefined, true);
        }
        throw error;
      }
    }
  }
}

// src/tools/GetObjectTool.ts
import type { CallToolResult, ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';
import type { StaedelApiClient } from '../api/StaedelApiClient.js';
import { StaedelObjectResponseSchema } from '../types/types.js';
import z from 'zod';

const PREFERRED_LANGUAGES = ['en', 'de'];
const DEFAULT_LICENSE = 'CC BY-SA 4.0 Städel Museum, Frankfurt am Main';

export class GetObjectTool {
  public readonly name: string = 'get-museum-object';
  public readonly description: string = 'Get detailed information about a specific Städel museum object by its OAI identifier (e.g. oai:DE-MUS-048017:2442) or bare object number (e.g. 2442). Returns metadata and optionally the high-resolution image.';

  public readonly inputSchema = z.object({
    objectId: z.string().describe('The OAI identifier (e.g., oai:DE-MUS-048017:2442) or bare object number'),
    returnImage: z.boolean().optional().default(true).describe('Whether to return the image (if available) as base64'),
  });

  constructor(private readonly apiClient: StaedelApiClient) {}

  public async execute({ objectId, returnImage }: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
    try {
      const rawRecord = await this.apiClient.getRecord(objectId);
      const metadata = rawRecord?.metadata?.['lido:lidoWrap']?.['lido:lido'];
      if (!metadata) throw new Error('No LIDO metadata found for this record. It may have been deleted from the collection.');

      // 1. Flatten the LIDO data
      const parsedObject = this.flattenLidoRecord(rawRecord.header.identifier, metadata);

      // 2. Format the text for the LLM
      let text = `Object ID: ${parsedObject.objectId}\n`
        + `Title: ${parsedObject.primaryTitle}\n`
        + `Artist: ${parsedObject.artistDisplayName}\n`
        + `Date: ${parsedObject.objectDate}\n`
        + `License: ${parsedObject.license}\n`
        + (parsedObject.primaryImage ? `Image URL: ${parsedObject.primaryImage}\n` : '')
        + `More info: ${parsedObject.objectURL}\n`;

      // 3. Fetch Image if requested
      let imageContent: ImageContent | null = null;
      if (returnImage && parsedObject.primaryImage) {
        try {
          const image = await this.apiClient.getImageAsBase64(parsedObject.primaryImage);
          imageContent = { type: 'image', data: image.data, mimeType: image.mimeType };
        } catch {
          text += '\nNote: Image could not be loaded or is restricted.';
        }
      }

      const content: Array<TextContent | ImageContent> = [{ type: 'text', text }];
      if (imageContent) content.push(imageContent);

      return {
        content,
        structuredContent: { object: parsedObject },
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error getting object ${objectId}: ${error}` }], isError: true };
    }
  }

  // --- LIDO Flattening Helpers ---

  private flattenLidoRecord(oaiIdentifier: string, lido: any): z.infer<typeof StaedelObjectResponseSchema> {
    const descMeta = lido['lido:descriptiveMetadata'];
    const adminMeta = lido['lido:administrativeMetadata'];
    const objectId = oaiIdentifier.replace(/^oai:/, '');

    const titles = this.extractByLang(descMeta?.['lido:objectIdentificationWrap']?.['lido:titleWrap']?.['lido:titleSet'], 'lido:appellationValue');
    const dimensions = this.extractByLang(descMeta?.['lido:objectIdentificationWrap']?.['lido:objectMeasurementsWrap']?.['lido:objectMeasurementsSet'], 'lido:displayObjectMeasurements');
    const medium = this.extractMedium(descMeta?.['lido:eventWrap']);
    const constituents = this.extractActors(descMeta?.['lido:eventWrap']);
    const primaryImage = this.extractImage(adminMeta?.['lido:resourceWrap']);
    const license = this.extractLicense(adminMeta?.['lido:resourceWrap']);
    const primaryTitle = this.pickPreferredLang(titles) || 'Untitled';

    return {
      objectId,
      oaiIdentifier,
      titles,
      primaryTitle,
      constituents,
      artistDisplayName: constituents.length > 0 ? constituents[0].name : 'Unknown Artist',
      objectDate: this.extractPreferredText(descMeta?.['lido:eventWrap']?.['lido:eventSet']?.[0]?.['lido:event']?.['lido:eventDate']?.['lido:displayDate']),
      medium,
      dimensions,
      primaryImage,
      objectURL: `https://sammlung.staedelmuseum.de/en/search?query=${encodeURIComponent(primaryTitle)}`,
      relatedWorks: this.extractRelatedWorks(descMeta?.['lido:objectRelationWrap']),
      license,
    };
  }

  /** Extracts a `{ lang: text }` map from a LIDO wrap element whose child nodes carry `xml:lang`. */
  private extractByLang(wrapSet: any, childTag: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const set of this.toArray(wrapSet)) {
      for (const node of this.toArray(set?.[childTag])) {
        const lang = node?.['@_xml:lang'] || 'unknown';
        const text = this.extractText(node);
        if (text) result[lang] = text;
      }
    }
    return result;
  }

  /** Materials/technique come from the production event's eventMaterialsTech, which may repeat. */
  private extractMedium(eventWrap: any): Record<string, string> {
    for (const eventSet of this.toArray(eventWrap?.['lido:eventSet'])) {
      const materialsTechs = this.toArray(eventSet?.['lido:event']?.['lido:eventMaterialsTech']);
      for (const mt of materialsTechs) {
        const byLang = this.extractByLang([mt], 'lido:displayMaterialsTech');
        if (Object.keys(byLang).length > 0) return byLang;
      }
    }
    return {};
  }

  private extractActors(eventWrap: any): Array<{ name: string; role?: string; attribution?: string }> {
    const actors: Array<{ name: string; role?: string; attribution?: string }> = [];

    for (const eventSet of this.toArray(eventWrap?.['lido:eventSet'])) {
      for (const eventActor of this.toArray(eventSet?.['lido:event']?.['lido:eventActor'])) {
        const actorInRole = eventActor?.['lido:actorInRole'];
        if (!actorInRole) continue;

        const nameSet = actorInRole['lido:actor']?.['lido:nameActorSet'];
        const names = this.extractByLang(this.toArray(nameSet), 'lido:appellationValue');
        const roleNode = actorInRole['lido:roleActor']?.['lido:term'];

        actors.push({
          name: this.pickPreferredLang(names) || 'Unknown',
          role: this.extractPreferredText(roleNode) || undefined,
          attribution: this.extractPreferredText(actorInRole['lido:attributionQualifierActor']) || undefined,
        });
      }
    }
    return actors;
  }

  /**
   * Picks the primary resource representation link for an object. LIDO records may list
   * several representations per resourceSet (thumbnail, large, download page); we prefer the
   * largest actual image file over anything else.
   */
  private extractImage(resourceWrap: any): string | undefined {
    const candidates: string[] = [];
    for (const set of this.toArray(resourceWrap?.['lido:resourceSet'])) {
      for (const rep of this.toArray(set?.['lido:resourceRepresentation'])) {
        const link = this.extractText(rep?.['lido:linkResource']);
        const format = rep?.['lido:linkResource']?.['@_lido:formatResource'] || '';
        if (link && (format.startsWith('image/') || /\.(jpe?g|png|tiff?)$/i.test(link))) {
          candidates.push(link);
        }
      }
    }
    if (candidates.length === 0) return undefined;
    // Prefer filenames that look like a larger/"xl" derivative over a plain thumbnail.
    return candidates.find(c => /xl|large|full/i.test(c)) ?? candidates[0];
  }

  private extractLicense(resourceWrap: any): string {
    for (const set of this.toArray(resourceWrap?.['lido:resourceSet'])) {
      const rights = set?.['lido:rightsResource'];
      for (const r of this.toArray(rights)) {
        const term = this.extractPreferredText(r?.['lido:rightsType']?.['lido:term']);
        if (term) return term;
      }
    }
    return DEFAULT_LICENSE;
  }

  private extractRelatedWorks(objectRelationWrap: any): Array<{ type: string; identifier: string }> | undefined {
    const sets = this.toArray(objectRelationWrap?.['lido:relatedWorksWrap']?.['lido:relatedWorkSet']);
    if (sets.length === 0) return undefined;

    const related = sets
      .map((set: any) => ({
        type: this.extractPreferredText(set?.['lido:relatedWorkRelType']?.['lido:term']) || 'related',
        identifier: this.extractText(set?.['lido:relatedWork']?.['lido:object']?.['lido:objectID']),
      }))
      .filter((r: { identifier: string }) => Boolean(r.identifier));

    return related.length > 0 ? related : undefined;
  }

  /** Picks the value for the first preferred language found (en, then de), else the first available. */
  private pickPreferredLang(byLang: Record<string, string>): string | undefined {
    for (const lang of PREFERRED_LANGUAGES) {
      if (byLang[lang]) return byLang[lang];
    }
    return Object.values(byLang)[0];
  }

  /** Extracts text from a node (or array of language-tagged nodes), preferring English/German. */
  private extractPreferredText(node: any): string {
    if (Array.isArray(node)) {
      for (const lang of PREFERRED_LANGUAGES) {
        const match = node.find((n: any) => n?.['@_xml:lang'] === lang);
        if (match) return this.extractText(match);
      }
      return this.extractText(node[0]);
    }
    return this.extractText(node);
  }

  // Safely extracts the text value from the fast-xml-parser node output
  private extractText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (node['#text'] !== undefined) return String(node['#text']);
    if (Array.isArray(node)) return this.extractText(node[0]);
    return '';
  }

  // Ensures we always iterate over an array, even if fast-xml-parser returned a single object
  private toArray(obj: any): any[] {
    if (obj === undefined || obj === null) return [];
    return Array.isArray(obj) ? obj : [obj];
  }
}

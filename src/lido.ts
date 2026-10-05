import { z } from 'zod';

const byLanguage = z.record(z.string(), z.string());

/** The small, stable shape a verbose LIDO record is flattened into. */
export const StaedelObjectSchema = z.object({
  objectId: z.string().describe('Städel object identifier (ISIL + object number)'),
  oaiIdentifier: z.string().describe('OAI-PMH record identifier'),
  titles: byLanguage.describe('Titles keyed by language code, e.g. { "en": "...", "de": "..." }'),
  primaryTitle: z.string().describe('Best available title (English preferred)'),
  constituents: z.array(z.object({
    name: z.string().describe('Name of the artist or creator'),
    role: z.string().optional().describe('Role, e.g. painter'),
    attribution: z.string().optional().describe('Attribution qualifier, e.g. workshop of'),
  })).describe('Artists or creators involved'),
  artistDisplayName: z.string().describe('Name of the primary artist'),
  objectDate: z.string().describe('Display date of creation'),
  medium: byLanguage.describe('Materials and technique keyed by language'),
  dimensions: byLanguage.describe('Measurements keyed by language'),
  primaryImage: z.string().optional().describe('URL of the largest available image'),
  objectURL: z.string().optional().describe('Page of the object in the Städel digital collection'),
  relatedWorks: z.array(z.object({
    type: z.string().describe('Relation type, e.g. is part of'),
    identifier: z.string().describe('Identifier of the related work'),
  })).optional().describe('Related works, e.g. the series a print belongs to'),
  license: z.string().describe('Rights statement of the image; use it as the credit line when showing the image'),
});

export type StaedelObject = z.infer<typeof StaedelObjectSchema>;

const DEFAULT_LICENSE = 'CC BY-SA 4.0 Städel Museum, Frankfurt am Main';

const arr = (value: any): any[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

/** Follows a path of LIDO element names, fanning out over repeated elements. */
const at = (node: any, ...path: string[]): any[] =>
  path.reduce((nodes, tag) => nodes.flatMap(n => arr(n?.[`lido:${tag}`])), arr(node));

/** Text of a parsed element: a bare string, or `#text` when the element carries attributes. */
const text = (node: any): string => (typeof node === 'string' ? node : node?.['#text'] ?? '');

/** Maps `xml:lang`-tagged elements to `{ lang: text }`; the first element of a language wins. */
function byLang(nodes: any[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const node of nodes) {
    const value = text(node);
    if (value) result[node['@_xml:lang'] || 'unknown'] ??= value;
  }
  return result;
}

const pick = (values: Record<string, string>): string | undefined => values.en ?? values.de ?? Object.values(values)[0];
const prefer = (nodes: any[]): string | undefined => pick(byLang(nodes));

export function flattenLido(oaiIdentifier: string, lido: any): StaedelObject {
  const ident = at(lido, 'descriptiveMetadata', 'objectIdentificationWrap');
  const events = at(lido, 'descriptiveMetadata', 'eventWrap', 'eventSet', 'event');
  const resources = at(lido, 'administrativeMetadata', 'resourceWrap', 'resourceSet');

  const titles = byLang(at(ident, 'titleWrap', 'titleSet', 'appellationValue'));
  const constituents = at(events, 'eventActor', 'actorInRole').map(actor => ({
    name: prefer(at(actor, 'actor', 'nameActorSet', 'appellationValue')) ?? 'Unknown',
    role: prefer(at(actor, 'roleActor', 'term')),
    attribution: prefer(at(actor, 'attributionQualifierActor')),
  }));
  // A resourceSet lists several renditions (thumb-lg, thumb-xl, a download page); take the largest image.
  const images = at(resources, 'resourceRepresentation', 'linkResource')
    .filter(link => link?.['@_lido:formatResource']?.startsWith('image/'))
    .map(text);
  const relatedWorks = at(lido, 'descriptiveMetadata', 'objectRelationWrap', 'relatedWorksWrap', 'relatedWorkSet')
    .map(set => ({
      type: prefer(at(set, 'relatedWorkRelType', 'term')) ?? 'related',
      identifier: text(at(set, 'relatedWork', 'object', 'objectID')[0]),
    }))
    .filter(work => work.identifier);

  return {
    objectId: oaiIdentifier.replace(/^oai:/, ''),
    oaiIdentifier,
    titles,
    primaryTitle: pick(titles) ?? 'Untitled',
    constituents,
    artistDisplayName: constituents[0]?.name ?? 'Unknown Artist',
    objectDate: prefer(at(events, 'eventDate', 'displayDate')) ?? '',
    medium: at(events, 'eventMaterialsTech')
      .map(tech => byLang(at(tech, 'displayMaterialsTech')))
      .find(medium => Object.keys(medium).length) ?? {},
    dimensions: byLang(at(ident, 'objectMeasurementsWrap', 'objectMeasurementsSet', 'displayObjectMeasurements')),
    primaryImage: images.find(url => /xl|large|full/i.test(url)) ?? images[0],
    objectURL: text(at(lido, 'administrativeMetadata', 'recordWrap', 'recordInfoSet', 'recordInfoLink')[0]) || undefined,
    relatedWorks: relatedWorks.length ? relatedWorks : undefined,
    license: prefer(at(resources, 'rightsResource', 'rightsType', 'term')) ?? DEFAULT_LICENSE,
  };
}

// src/types/types.ts
import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';

export interface AppResource extends Resource {
  mimeType: string;
  getHtml: () => Promise<string>;
}

// ============================================================================
// OAI-PMH & LIDO RAW PARSED SCHEMAS
// These schemas validate the raw JSON output produced by `fast-xml-parser`
// ============================================================================

export const OaiSetSchema = z.object({
  setSpec: z.string().describe('The OAI-PMH set identifier'),
  setName: z.string().describe('Display name of the collection or set'),
});

export const OaiListSetsResponseSchema = z.object({
  sets: z.array(OaiSetSchema),
});

/**
 * Helper for fast-xml-parser text nodes with attributes.
 * Example XML: <lido:appellationValue xml:lang="en">Portrait</lido:appellationValue>
 * Parsed as: { "#text": "Portrait", "@_xml:lang": "en" }
 */
export const LidoTextNodeSchema = z.union([
  z.string(),
  z.number().transform(String),
  z.object({
    '#text': z.union([z.string(), z.number().transform(String)]).optional(),
    '@_xml:lang': z.string().optional(),
  }).passthrough()
]);

/**
 * Validates the deeply nested Artist/Actor structure in LIDO.
 * Accounts for multiple actors, roles, and attribution qualifiers.
 */
export const LidoActorSchema = z.object({
  'lido:actorInRole': z.object({
    'lido:actor': z.object({
      'lido:nameActorSet': z.union([
        z.object({ 'lido:appellationValue': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]) }),
        z.array(z.object({ 'lido:appellationValue': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]) }))
      ]).optional(),
      'lido:actorID': z.any().optional(),
    }).optional(),
    'lido:roleActor': z.any().optional(),
    'lido:attributionQualifierActor': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]).optional()
  }).optional()
}).passthrough();

/**
 * Main LIDO Record Schema wrapper.
 * Uses .passthrough() generously because LIDO metadata is expansive and we only 
 * need to strictly validate the fields we extract for the MCP Server.
 */
export const LidoRecordSchema = z.object({
  'lido:lidoRecID': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]).describe('ISIL combined object identifier'),
  
  'lido:descriptiveMetadata': z.object({
    'lido:objectIdentificationWrap': z.object({
      'lido:titleWrap': z.object({
        'lido:titleSet': z.union([
          z.object({ 'lido:appellationValue': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]) }),
          z.array(z.object({ 'lido:appellationValue': z.union([LidoTextNodeSchema, z.array(LidoTextNodeSchema)]) }))
        ]).optional()
      }).optional(),
      'lido:repositoryWrap': z.any().optional(),
      'lido:objectMeasurementsWrap': z.any().optional(),
    }).passthrough().optional(),
    
    'lido:eventWrap': z.object({
      'lido:eventSet': z.union([
         z.object({
           'lido:event': z.object({
             'lido:eventActor': z.union([LidoActorSchema, z.array(LidoActorSchema)]).optional(),
             'lido:eventDate': z.any().optional(),
             'lido:eventMaterialsTech': z.any().optional()
           }).passthrough().optional()
         }),
         z.array(z.any())
      ]).optional()
    }).passthrough().optional(),
    
    'lido:objectRelationWrap': z.any().optional()
  }).passthrough().optional(),

  'lido:administrativeMetadata': z.object({
    'lido:resourceWrap': z.object({
      'lido:resourceSet': z.union([
        z.object({
          'lido:resourceRepresentation': z.union([
            z.object({ 'lido:linkResource': LidoTextNodeSchema }),
            z.array(z.object({ 'lido:linkResource': LidoTextNodeSchema }))
          ]).optional()
        }).passthrough(),
        z.array(z.any())
      ]).optional()
    }).passthrough().optional()
  }).passthrough().optional()
}).passthrough();


// ============================================================================
// NORMALIZED SCHEMAS FOR LLM CONSUMPTION
// These define the clean shapes returned by the MCP tools to the AI model.
// Your tool logic will map `LidoRecordSchema` -> `StaedelObjectResponseSchema`.
// ============================================================================

export const NormalizedConstituentSchema = z.object({
  name: z.string().describe('Name of the artist or creator'),
  role: z.string().optional().describe('Role (e.g., Maler/Painter)'),
  attribution: z.string().optional().describe('Attribution qualifier (e.g., Workshop of, Follower of)'),
});

export const StaedelObjectResponseSchema = z.object({
  objectId: z.string().describe('Unique Städel object identifier (ISIL + Object number)'),
  oaiIdentifier: z.string().describe('OAI-PMH record identifier'),
  
  // Handles language resolution (xml:lang="de" vs "en")
  titles: z.record(z.string(), z.string()).describe('Titles keyed by language code (e.g., { "en": "...", "de": "..." })'),
  primaryTitle: z.string().describe('Best available title (prioritizes English)'),
  
  constituents: z.array(NormalizedConstituentSchema).describe('Artists or creators involved'),
  artistDisplayName: z.string().describe('Primary artist display name (for simple UIs)'),
  
  objectDate: z.string().describe('Display date of creation'),
  medium: z.record(z.string(), z.string()).describe('Materials and technique keyed by language'),
  dimensions: z.record(z.string(), z.string()).describe('Measurements keyed by language'),
  
  primaryImage: z.string().describe('URL to the primary high-resolution image resource'),
  objectURL: z.string().describe('Web link to the Städel digital collection'),
  
  relatedWorks: z.array(z.object({
    type: z.string().describe('Relation type (e.g., part of)'),
    identifier: z.string().describe('Identifier of the related work')
  })).optional().describe('Hierarchical components or parent artworks (e.g., panels of a diptych)'),
  
  license: z.string().describe('Image and Metadata License. ALWAYS default to: CC BY-SA 4.0 Städel Museum, Frankfurt am Main'),
}).partial();


// --- Tool Response Schemas ---

export const SearchMuseumObjectsStructuredContentSchema = z.object({
  pageCount: z.number().describe('Number of records returned in this current request'),
  records: z.array(z.string()).describe('List of OAI identifiers matching the query'),
  resumptionToken: z.string().optional().describe('Token to retrieve the next page of results'),
});

export const GetMuseumObjectStructuredContentSchema = z.object({
  object: StaedelObjectResponseSchema.describe('Detailed object data mapped from LIDO metadata'),
});

export const OpenStaedelExplorerLaunchStateSchema = z.object({
  set: z.string().optional().describe('Pre-filter the UI explorer by an OAI Set (e.g., collection/department)'),
  from: z.string().optional().describe('Datestamp (YYYY-MM-DD) to filter records modified from this date'),
  until: z.string().optional().describe('Datestamp (YYYY-MM-DD) to filter records modified until this date'),
});

export const OpenStaedelExplorerStructuredContentSchema = z.object({
  initialState: OpenStaedelExplorerLaunchStateSchema.describe('Initial app launch state for the Städel Explorer UI'),
});
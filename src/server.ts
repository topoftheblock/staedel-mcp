import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getImage, getLido, listIdentifiers, listSets } from './api.js';
import { EXPLORER_HTML, EXPLORER_URI } from './explorer.js';
import { flattenLido, StaedelObjectSchema } from './lido.js';

const filters = {
  set: z.string().optional().describe('OAI-PMH set spec to filter by (see list-sets)'),
  from: z.string().optional().describe('Only records modified on or after this date (YYYY-MM-DD)'),
  until: z.string().optional().describe('Only records modified on or before this date (YYYY-MM-DD)'),
};

// Handlers simply throw on failure: McpServer turns that into an `isError` tool result.
export function createServer(): McpServer {
  const server = new McpServer({ name: 'staedel-museum-mcp', version: '1.0.0' });

  server.registerTool('list-sets', {
    description: 'Lists the sets (collections/departments) of the Städel Museum OAI-PMH interface.',
    outputSchema: { sets: z.array(z.object({ setSpec: z.string(), setName: z.string() })) },
  }, async () => {
    const sets = await listSets();
    return {
      content: [{ type: 'text', text: sets.map(s => `${s.setSpec}: ${s.setName}`).join('\n') }],
      structuredContent: { sets },
    };
  });

  server.registerTool('search-museum-objects', {
    description: 'Harvests object identifiers from the Städel Museum. This is OAI-PMH, not a search engine: '
      + 'there is no keyword search, only filtering by set and/or modification date. '
      + 'Pass the returned identifiers to get-museum-object.',
    inputSchema: {
      ...filters,
      resumptionToken: z.string().optional().describe('Token from a previous call to fetch the next page; replaces all other filters'),
    },
    outputSchema: {
      records: z.array(z.string()).describe('OAI identifiers on this page'),
      resumptionToken: z.string().optional().describe('Token for the next page, absent on the last one'),
    },
  }, async (input) => {
    const page = await listIdentifiers(input);
    const text = `${page.records.length} identifiers: ${page.records.join(', ')}\n`
      + (page.resumptionToken ? `Resumption token for the next page: ${page.resumptionToken}` : 'No more pages.');
    return { content: [{ type: 'text', text }], structuredContent: page };
  });

  server.registerTool('get-museum-object', {
    description: 'Gets the metadata of one Städel object, and optionally its image, by OAI identifier '
      + '(e.g. oai:DE-MUS-048017:13) or bare object number (e.g. 13).',
    inputSchema: {
      objectId: z.string().describe('OAI identifier or bare object number'),
      returnImage: z.boolean().default(true).describe('Also return the image itself, if there is one'),
    },
    outputSchema: { object: StaedelObjectSchema },
  }, async ({ objectId, returnImage }) => {
    const record = await getLido(objectId);
    if (!record) throw new Error(`Object ${objectId} has no metadata; it was probably removed from the collection.`);
    const object = flattenLido(record.identifier, record.lido);

    const content: CallToolResult['content'] = [{
      type: 'text',
      text: [
        `Object ID: ${object.objectId}`,
        `Title: ${object.primaryTitle}`,
        `Artist: ${object.artistDisplayName}`,
        `Date: ${object.objectDate}`,
        `License: ${object.license}`,
        object.primaryImage && `Image URL: ${object.primaryImage}`,
        object.objectURL && `More info: ${object.objectURL}`,
      ].filter(Boolean).join('\n'),
    }];
    if (returnImage && object.primaryImage) {
      // A missing image shouldn't cost the caller the metadata.
      const image = await getImage(object.primaryImage).catch(() => undefined);
      content.push(image ? { type: 'image', ...image } : { type: 'text', text: 'Note: the image could not be loaded.' });
    }
    return { content, structuredContent: { object } };
  });

  registerAppTool(server, 'open-staedel-explorer', {
    description: 'Opens the interactive Städel Explorer app for browsing and filtering objects visually.',
    inputSchema: filters,
    _meta: { ui: { resourceUri: EXPLORER_URI } },
  }, async () => ({
    content: [{
      type: 'text',
      text: 'The Städel Explorer is open; the user can filter by set or date and open objects in it. '
        + 'Only use object IDs that come from the explorer or from search-museum-objects, never invented ones. '
        + 'Call get-museum-object for details on an item, and whenever you show or describe an image, '
        + 'credit it with the `license` that tool reports.',
    }],
  }));

  registerAppResource(server, 'Städel Explorer', EXPLORER_URI, {
    description: 'Interactive UI for browsing and filtering the Städel Museum digital collection.',
    _meta: { ui: { csp: { resourceDomains: ['https://cdn.staedelmuseum.de'] } } },
  }, () => ({ contents: [{ uri: EXPLORER_URI, mimeType: RESOURCE_MIME_TYPE, text: EXPLORER_HTML }] }));

  return server;
}

// src/StaedelServer.ts
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StaedelApiClient } from './api/StaedelApiClient.js';
import { ListSetsTool } from './tools/ListSetsTool.js';
import { SearchMuseumObjectsTool } from './tools/SearchMuseumObjectsTool.js';
import { GetObjectTool } from './tools/GetObjectTool.js';
import { OpenStaedelExplorerTool } from './tools/OpenStaedelExplorerTool.js';
import { EXPLORER_RESOURCE_URI, buildExplorerHtml } from './ui/explorerResource.js';
import {
  OaiListSetsResponseSchema,
  SearchMuseumObjectsStructuredContentSchema,
  GetMuseumObjectStructuredContentSchema,
  OpenStaedelExplorerStructuredContentSchema
} from './types/types.js';

export function createStaedelServer(): McpServer {
  const server = new McpServer({
    name: 'staedel-museum-mcp',
    version: '1.0.0',
  });

  const apiClient = new StaedelApiClient();

  const listSets = new ListSetsTool(apiClient);
  const searchObjects = new SearchMuseumObjectsTool(apiClient);
  const getObject = new GetObjectTool(apiClient);
  const openExplorer = new OpenStaedelExplorerTool();

  registerAppTool(server, listSets.name, {
    description: listSets.description,
    inputSchema: listSets.inputSchema.shape,
    outputSchema: OaiListSetsResponseSchema.shape,
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, listSets.execute.bind(listSets));

  registerAppTool(server, searchObjects.name, {
    description: searchObjects.description,
    inputSchema: searchObjects.inputSchema.shape,
    outputSchema: SearchMuseumObjectsStructuredContentSchema.shape,
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, searchObjects.execute.bind(searchObjects));

  registerAppTool(server, getObject.name, {
    description: getObject.description,
    inputSchema: getObject.inputSchema.shape,
    outputSchema: GetMuseumObjectStructuredContentSchema.shape,
    _meta: { ui: { visibility: ['model', 'app'] } }
  }, getObject.execute.bind(getObject));

  registerAppTool(server, openExplorer.name, {
    description: openExplorer.description,
    inputSchema: openExplorer.inputSchema.shape,
    outputSchema: OpenStaedelExplorerStructuredContentSchema.shape,
    _meta: { ui: { resourceUri: openExplorer.resourceUri } }
  }, openExplorer.execute.bind(openExplorer));

  registerAppResource(server, 'Städel Explorer', EXPLORER_RESOURCE_URI, {
    description: 'Interactive UI for browsing and filtering the Städel Museum digital collection.',
    _meta: { ui: { csp: { resourceDomains: ['https://sammlung.staedelmuseum.de'] } } }
  }, () => ({
    contents: [{ uri: EXPLORER_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: buildExplorerHtml() }],
  }));

  return server;
}
// src/tools/SearchMuseumObjectsTool.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { StaedelApiClient } from '../api/StaedelApiClient.js';
import { SearchMuseumObjectsStructuredContentSchema } from '../types/types.js';
import z from 'zod';

const SearchInputSchema = z.object({
  set: z.string().optional().describe('Filter by an OAI-PMH Set spec (retrieved via list-sets tool)'),
  from: z.string().optional().describe('Datestamp (YYYY-MM-DD) to filter records modified from this date'),
  until: z.string().optional().describe('Datestamp (YYYY-MM-DD) to filter records modified until this date'),
  resumptionToken: z.string().optional().describe('Pass this token to get the next page of results. Do not pass other filters if using this token.'),
});

export class SearchMuseumObjectsTool {
  public readonly name: string = 'search-museum-objects';
  public readonly description: string = 'Harvests a list of object identifiers from the Städel Museum. Note: This uses OAI-PMH, so standard full-text keyword searching is not supported. You must filter by date or Set. Returns a list of identifiers to be used with the get-museum-object tool.';
  public readonly inputSchema = SearchInputSchema;

  constructor(private readonly apiClient: StaedelApiClient) {}

  public async execute(input: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
    try {
      const data = await this.apiClient.listRecords(input);
      
      if (!data || !data.record) {
        return { content: [{ type: 'text', text: 'No records found.' }], isError: false };
      }

      // Ensure records are an array
      const recordsArray = Array.isArray(data.record) ? data.record : [data.record];
      
      // Extract the OAI identifiers from the headers
      const objectIDs = recordsArray.map((r: any) => r.header?.identifier).filter(Boolean);
      
      // Check for pagination token
      const resumptionToken = data.resumptionToken?.['#text'] || data.resumptionToken || null;

      const structuredContent = {
        pageCount: objectIDs.length,
        records: objectIDs,
        resumptionToken,
      };

      const text = `Harvested ${objectIDs.length} identifiers.\nObject IDs: ${objectIDs.join(', ')}\n` + 
                   (resumptionToken ? `\nResumption Token for next page: ${resumptionToken}` : '\nNo more pages.');

      return {
        content: [{ type: 'text', text }],
        structuredContent,
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error harvesting records: ${error}` }],
        isError: true,
      };
    }
  }
}
// src/tools/ListSetsTool.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { StaedelApiClient } from '../api/StaedelApiClient.js';
import { OaiListSetsResponseSchema } from '../types/types.js';
import z from 'zod';

export class ListSetsTool {
  public readonly name: string = 'list-sets';
  public readonly description: string = 'Lists all organizational sets (collections/departments) available in the Städel Museum OAI-PMH interface.';
  public readonly inputSchema = z.object({}).describe('No input required');

  constructor(private readonly apiClient: StaedelApiClient) {}

  public async execute(): Promise<CallToolResult> {
    try {
      const rawSets = await this.apiClient.listSets();
      
      // Map the raw XML JSON to our clean Zod schema
      const sets = rawSets.map((s: any) => ({
        setSpec: s.setSpec,
        setName: s.setName,
      }));

      const structuredContent = { sets };
      const text = sets.map((s: any) => `Set Spec: ${s.setSpec}, Set Name: ${s.setName}`).join('\n');

      return {
        content: [{ type: 'text', text }],
        structuredContent,
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error listing sets: ${error}` }],
        isError: true,
      };
    }
  }
}
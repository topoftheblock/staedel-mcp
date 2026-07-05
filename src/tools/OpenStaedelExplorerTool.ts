// src/tools/OpenStaedelExplorerTool.ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OpenStaedelExplorerStructuredContentSchema } from '../types/types.js';
import { EXPLORER_RESOURCE_URI } from '../ui/explorerResource.js';
import z from 'zod';

export class OpenStaedelExplorerTool {
  public readonly name: string = 'open-staedel-explorer';
  public readonly description: string = 'Open the interactive Städel Explorer app for browsing and filtering objects visually.';

  public readonly resourceUri: string = EXPLORER_RESOURCE_URI;

  public readonly inputSchema = z.object({
    set: z.string().optional().describe('Optional OAI Set to filter the explorer'),
    from: z.string().optional().describe('Optional datestamp (YYYY-MM-DD)'),
  }).describe('Open the Städel Museum explorer app UI');

  public async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
    return {
      content: [{
        type: 'text',
        text: `Opening Städel Explorer UI.

Assistant response style and LICENSING RULES:
- IMPORTANT: The Städel Museum provides its high-resolution images under a Creative Commons CC BY-SA 4.0 license. 
- MANDATORY: Whenever you display, describe, or return an image from this tool or the get-museum-object tool, you MUST include the following credit line exactly as written: "Image: CC BY-SA 4.0 Städel Museum, Frankfurt am Main".
- Focus on what the user can do in this UI right now (filtering by Set or Date).
- Treat titles and object IDs from the explorer as the source of truth. 
- Call get-museum-object when the user asks to go deeper on a specific item or requests image-level detail.
- Do NOT invent object IDs. Only use the ones provided by the OAI-PMH harvest or the Explorer UI context.`,
      }],
      structuredContent: { initialState: args },
      isError: false,
    };
  }
}
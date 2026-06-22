import z from 'zod';
export class ListSetsTool {
    apiClient;
    name = 'list-sets';
    description = 'Lists all organizational sets (collections/departments) available in the Städel Museum OAI-PMH interface.';
    inputSchema = z.object({}).describe('No input required');
    constructor(apiClient) {
        this.apiClient = apiClient;
    }
    async execute() {
        try {
            const rawSets = await this.apiClient.listSets();
            // Map the raw XML JSON to our clean Zod schema
            const sets = rawSets.map((s) => ({
                setSpec: s.setSpec,
                setName: s.setName,
            }));
            const structuredContent = { sets };
            const text = sets.map((s) => `Set Spec: ${s.setSpec}, Set Name: ${s.setName}`).join('\n');
            return {
                content: [{ type: 'text', text }],
                structuredContent,
                isError: false,
            };
        }
        catch (error) {
            return {
                content: [{ type: 'text', text: `Error listing sets: ${error}` }],
                isError: true,
            };
        }
    }
}

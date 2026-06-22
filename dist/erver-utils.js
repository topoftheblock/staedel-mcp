import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import process from 'node:process';
export async function startServer(createServer, isHttp) {
    const server = createServer();
    if (isHttp) {
        // We need to dynamically import express only if HTTP is used
        const app = express();
        let transport;
        app.get('/mcp', async (req, res) => {
            transport = new SSEServerTransport('/mcp/messages', res);
            await server.connect(transport);
        });
        app.post('/mcp/messages', async (req, res) => {
            if (transport) {
                await transport.handlePostMessage(req, res);
            }
        });
        const port = process.env.PORT || 3001;
        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}/mcp`);
        });
    }
    else {
        // Default Stdio transport for Claude Desktop / Cursor
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}

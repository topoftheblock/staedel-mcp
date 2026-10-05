#!/usr/bin/env node
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

if (process.argv.includes('--http')) {
  // Stateless Streamable HTTP: nothing is kept between requests, so each one gets a fresh server.
  const app = createMcpExpressApp();
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => void server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => void res.sendStatus(405));
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, '127.0.0.1', () => console.log(`Städel MCP server listening on http://localhost:${port}/mcp`));
} else {
  await createServer().connect(new StdioServerTransport());
}

#!/usr/bin/env node

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import process from 'node:process';
import { createStaedelServer } from './StaedelServer.js';
import { startServer } from './server-utils.js';

function createServer(): McpServer {
  return createStaedelServer();
}

const http = process.argv.includes('--http');

startServer(createServer, http).catch((error: unknown) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
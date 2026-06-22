#!/usr/bin/env node
import process from 'node:process';
import { createStaedelServer } from './StaedelServer.js';
import { startServer } from './server-utils.js';
function createServer() {
    return createStaedelServer();
}
const http = process.argv.includes('--http');
startServer(createServer, http).catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});

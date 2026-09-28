import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { log } from './log.js';

const server = createServer();
await server.connect(new StdioServerTransport());

log('main', 'claude-todo is running');

#!/usr/bin/env node
// MCP stdio server exposing FileToolSuite's three tools (viewFile, writeToFile,
// replaceFileContent) over the Model Context Protocol, so any MCP-capable client
// (opencode, Claude Desktop, …) gets a robust, line-range + CRLF-safe file editor.
//
// Workspace root: FILETOOLS_ROOT env, else first CLI arg, else the process cwd
// (opencode launches local MCP servers in the project directory).
//
// Requires Node >= 23 (native TypeScript import of ./fileTools.ts).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FileToolSuite } from "./fileTools.ts";

const root = process.env.FILETOOLS_ROOT || process.argv[2] || process.cwd();
const suite = new FileToolSuite(root);

const defs = FileToolSuite.getToolDefinitions();
const dispatch = {
  viewFile: (a) => suite.viewFile(a),
  writeToFile: (a) => suite.writeToFile(a),
  replaceFileContent: (a) => suite.replaceFileContent(a),
};

const server = new Server(
  { name: "filetools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: defs.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const fn = dispatch[name];
  if (!fn) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  let res;
  try {
    res = fn(args ?? {});
  } catch (e) {
    return { content: [{ type: "text", text: `ERROR: ${e?.message ?? String(e)}` }], isError: true };
  }
  const text = (res.output ?? "") + (res.diff ? `\n\nDiff:\n${res.diff}` : "");
  return { content: [{ type: "text", text }], isError: !res.success };
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is fine for logs; stdout is the JSON-RPC channel.
process.stderr.write(`filetools MCP server ready (root: ${root})\n`);

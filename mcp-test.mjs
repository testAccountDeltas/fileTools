// Standalone MCP smoke test: spawn the server, list tools, edit a CRLF file.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-"));
const f = path.join(dir, "crlf.js");
fs.writeFileSync(f, "a();\r\nTARGET();\r\nb();\r\n");

const transport = new StdioClientTransport({
  command: "node",
  args: [path.resolve("mcp-server.mjs")],
  env: { ...process.env, FILETOOLS_ROOT: dir },
});
const client = new Client({ name: "smoke", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { (c ? pass++ : fail++); console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };

const { tools } = await client.listTools();
ok("tools/list returns 3 tools", tools.length === 3, tools.map((t) => t.name).join(","));
ok("each tool has inputSchema", tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));

const r = await client.callTool({
  name: "replaceFileContent",
  arguments: { targetFile: "crlf.js", startLine: 2, endLine: 2, targetContent: "TARGET();", replacementContent: "FIXED();" },
});
const txt = r.content?.[0]?.text ?? "";
ok("replaceFileContent via MCP succeeded", r.isError !== true, txt.split("\n")[0]);

const raw = fs.readFileSync(f);
ok("CRLF preserved through MCP layer", raw.includes(Buffer.from("FIXED();\r\n")) && !raw.includes(Buffer.from("FIXED();\n\n")));

// view it back
const v = await client.callTool({ name: "viewFile", arguments: { targetFile: "crlf.js" } });
ok("viewFile shows numbered lines", /1:\s/.test(v.content?.[0]?.text ?? ""));

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

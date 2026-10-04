# fileTools

A robust file–editing tool suite for AI agents, exposed as a **Model Context Protocol (MCP)** server (and usable as a plain TypeScript library). It fixes the editing failures that plague LLM coding agents — `Could not find oldString`, Windows CRLF mismatches, line-number drift, ambiguous duplicate matches, and regex corruption of replacement text.

Point any MCP-capable client (opencode, Claude Desktop, …) at it and the model gets three reliable tools: `viewFile`, `replaceFileContent`, `writeToFile`.

## Why

The built-in `edit` tool of most agents does an exact string match of an `oldString` the model reproduces from memory. On real projects that fails constantly:

- **Indentation / whitespace drift** — the model guesses 2 spaces where the file has 4.
- **Windows CRLF** — the read path strips `\r`, so the model sends LF and the exact match misses.
- **Line drift** — a previous edit shifted the lines the model was targeting.
- **Ambiguity** — `return true;` appears ten times and the wrong one gets replaced.
- **Regex corruption** — `String.replace()` mangles replacements containing `$1`, `$&`, `` $` ``.

`replaceFileContent` removes all of these: matching is **scoped to a `[startLine, endLine]` window** (read first, then edit from ground truth), replacement is **byte-literal**, line endings are **detected and preserved**, writes are **atomic**, and on a mismatch it returns the **actual current content of the range** so the model corrects from reality instead of guessing.

## Requirements

- **Node ≥ 23** (the server imports the TypeScript library directly via native type-stripping).

## Tools

| Tool | Purpose |
|---|---|
| `viewFile` | Read a file with 1-based line numbers and bounded slicing (`startLine`/`endLine`, byte/line caps). Always read before editing. |
| `replaceFileContent` | Replace exact `targetContent` within `[startLine, endLine]`. Preserves CRLF/LF and indentation, rejects ambiguous matches, returns a unified diff, and emits a self-correction hint on failure. |
| `writeToFile` | Create a new file or atomically overwrite/append an existing one (with overwrite protection). |

## Use it with opencode

1. Clone this repo and install dependencies:
   ```bash
   git clone https://github.com/testAccountDeltas/fileTools.git
   cd fileTools && npm install
   ```
2. In `~/.config/opencode/opencode.json`, register the server and disable the built-in `edit` so the model uses this one:
   ```jsonc
   {
     "mcp": {
       "filetools": {
         "type": "local",
         "command": ["node", "/absolute/path/to/fileTools/mcp-server.mjs"],
         "enabled": true
       }
     },
     "permission": {
       "*": "allow",
       "edit": "deny"
     }
   }
   ```
3. Fully restart opencode. The model now edits via `filetools_replaceFileContent` — CRLF-safe, line-scoped, no `Could not find oldString`.

The server resolves relative paths against the working directory opencode launches it in (your project root).

## Use it with other MCP clients (e.g. Claude Desktop)

```jsonc
{
  "mcpServers": {
    "filetools": {
      "command": "node",
      "args": ["/absolute/path/to/fileTools/mcp-server.mjs"],
      "env": { "FILETOOLS_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

`FILETOOLS_ROOT` (or the first CLI argument) overrides the workspace root; it defaults to the process working directory.

## Use it as a library

```ts
import { FileToolSuite } from "./fileTools.ts";

const tools = new FileToolSuite(process.cwd());
tools.viewFile({ targetFile: "src/app.ts", startLine: 1, endLine: 50 });
tools.replaceFileContent({
  targetFile: "src/app.ts",
  startLine: 15, endLine: 16,
  targetContent: "  const port = 3000;",
  replacementContent: "  const port = process.env.PORT || 8080;",
});
```

`FileToolSuite.getToolDefinitions()` returns JSON schemas ready for OpenAI, Anthropic, Gemini function-calling, or MCP.

## Develop / test

```bash
npm test          # 17 unit tests (node:test)
npm run demo      # scripted agent walkthrough with diffs + self-correction
npm run smoke     # spins up the MCP server and exercises it over the protocol
```

## License

MIT

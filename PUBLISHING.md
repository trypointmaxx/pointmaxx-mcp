# Publishing pointmaxx-mcp

Two places: npm (the package people install) and the official MCP Registry (the directory other MCP directories read
from). The registry only stores the details in `server.json`; the code comes from npm, so npm goes first.

## Every release

1. Bump the version in all three places, to the same number:
   - `package.json` → `version`
   - `server.mjs` → `const VERSION`
   - `server.json` → `version`, and `packages[0].version`
2. `node server.test.mjs` (must print `mcp server ok`).
3. Publish to npm: `npm publish` (needs the npm account that owns `pointmaxx-mcp`).
4. Publish to the registry: `mcp-publisher publish` (see below).

## The MCP Registry

- **Name:** `io.github.trypointmaxx/pointmaxx-mcp`. It must match `mcpName` in `package.json`, which is how the registry
  checks that the npm package is ours.
- **Install the tool:** `brew install mcp-publisher`, or the pre-built binary from the registry's GitHub releases
  (github.com/modelcontextprotocol/registry).
- **Log in:** `mcp-publisher login github`. It prints a code to enter at github.com/login/device.
  - The `io.github.trypointmaxx/` namespace belongs to the `trypointmaxx` GitHub organization. The account that logs
    in must be a member, and its membership should be **public** (github.com/orgs/trypointmaxx/people → set your
    membership to Public), or the registry may refuse the name.
- **Publish:** `mcp-publisher publish` from this folder.
- **Check it's listed:**
  `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.trypointmaxx/pointmaxx-mcp"`

`server.json` follows the 2025-12-11 schema. The description is limited to 100 characters.

## Other directories

- **Glama:** reads `glama.json`. Submit the repo at glama.ai/mcp/servers.
- **PulseMCP:** picks servers up from the official registry.
- **mcp.so, MCP Market:** submit forms with the repo link.
- **Smithery:** stopped taking new servers on Oct 31, 2026 (it's now a curated directory run by Arcade), so
  `smithery.yaml` no longer does anything.

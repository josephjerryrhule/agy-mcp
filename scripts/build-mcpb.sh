#!/bin/bash
set -e

echo "=== 1. Bundling MCP Server with Esbuild ==="
mkdir -p dist/bundle build/tmp-mcpb/server
npx -y esbuild src/server/stdio.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=build/tmp-mcpb/server/index.mjs \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# Copy to dist/bundle
cp build/tmp-mcpb/server/index.mjs dist/bundle/index.mjs
chmod +x dist/bundle/index.mjs

echo "=== 2. Creating manifest.json ==="
cat << 'MANIFEST' > build/tmp-mcpb/manifest.json
{
  "manifest_version": "0.2",
  "name": "agy-mcp",
  "display_name": "Antigravity Bridge",
  "version": "1.2.0",
  "description": "Enables Claude to delegate heavy coding, multi-file editing, test runs, and repository operations to Antigravity (agy) headless subagents with live streaming and token savings tracking.",
  "author": {
    "name": "Joseph Jerry Rhule"
  },
  "icon": "icon.png",
  "server": {
    "type": "node",
    "entry_point": "server/index.mjs",
    "mcp_config": {
      "command": "node",
      "args": [
        "${__dirname}/server/index.mjs"
      ]
    }
  },
  "tools_generated": true
}
MANIFEST

echo "=== 3. Copying Assets ==="
cp icon.png build/tmp-mcpb/icon.png

echo "=== 4. Packaging .mcpb ZIP Bundle ==="
rm -f build/agy-mcp.mcpb
cd build/tmp-mcpb
zip -r ../agy-mcp.mcpb manifest.json icon.png server/
cd ../..

echo "=== 5. Cleaning Up Temp Files ==="
rm -rf build/tmp-mcpb

echo "=== Build Complete! File: build/agy-mcp.mcpb ==="
ls -lh build/agy-mcp.mcpb

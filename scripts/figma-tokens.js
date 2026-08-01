#!/usr/bin/env node
/**
 * figma-tokens.js
 * Reads design/tokens.json and pushes design tokens to a Figma file
 * as Local Variables (Collections + Variables) via the Figma REST API.
 *
 * Usage:
 *   node scripts/figma-tokens.js --file=<file_key> --token=<personal_access_token>
 *
 * The file_key is the alphanumeric string from the Figma file URL:
 *   https://www.figma.com/design/<file_key>/...
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    })
);

const FILE_KEY = args.file;
const PAT = args.token;

if (!FILE_KEY || !PAT) {
  console.error(
    "Usage: node scripts/figma-tokens.js --file=<file_key> --token=<pat>"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Token loading
// ---------------------------------------------------------------------------
const TOKENS_PATH = path.join(__dirname, "..", "design", "tokens.json");
const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8")).global;

// ---------------------------------------------------------------------------
// Figma API helpers
// ---------------------------------------------------------------------------
function figmaRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.figma.com",
      path: endpoint,
      method,
      headers: {
        "X-Figma-Token": PAT,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(
              new Error(
                "Figma API " + res.statusCode + ": " + JSON.stringify(parsed)
              )
            );
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error("Failed to parse response: " + data));
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

/** Parse a CSS hex color string into Figma { r, g, b, a } (0-1 range). */
function hexToFigmaColor(hex) {
  const h = hex.replace("#", "");
  const parse = (s) => parseInt(s, 16) / 255;
  if (h.length === 6) {
    return { r: parse(h.slice(0, 2)), g: parse(h.slice(2, 4)), b: parse(h.slice(4, 6)), a: 1 };
  }
  if (h.length === 8) {
    return { r: parse(h.slice(0, 2)), g: parse(h.slice(2, 4)), b: parse(h.slice(4, 6)), a: parse(h.slice(6, 8)) };
  }
  throw new Error("Cannot parse color: " + hex);
}

/** Strip a unit suffix and return the numeric float value. */
function parseUnit(val) {
  return parseFloat(String(val).replace(/[a-z%]+$/, ""));
}

// ---------------------------------------------------------------------------
// Build the variable payload
// ---------------------------------------------------------------------------

function buildPayload() {
  const variableCollections = [];
  const variables = [];
  const variableModeValues = [];

  let varIndex = 0;
  function tempId(prefix) {
    return prefix + "_" + (varIndex++);
  }

  function addCollection(name) {
    const collectionId = tempId("col");
    const modeId = tempId("mode");
    variableCollections.push({
      action: "CREATE",
      id: collectionId,
      name,
      initialModeId: modeId,
    });
    return { collectionId, modeId };
  }

  function addVariable(collectionId, modeId, name, resolvedType, value) {
    const varId = tempId("var");
    variables.push({
      action: "CREATE",
      id: varId,
      name,
      variableCollectionId: collectionId,
      resolvedType,
    });
    variableModeValues.push({
      variableId: varId,
      modeId,
      value,
    });
  }

  // Colors
  const { collectionId: colorCol, modeId: colorMode } = addCollection("Colors");
  for (const [name, token] of Object.entries(tokens.color)) {
    addVariable(colorCol, colorMode, name, "COLOR", hexToFigmaColor(token["$value"]));
  }

  // Spacing
  const { collectionId: spacingCol, modeId: spacingMode } = addCollection("Spacing");
  for (const [name, token] of Object.entries(tokens.spacing)) {
    addVariable(spacingCol, spacingMode, "spacing/" + name, "FLOAT", parseUnit(token["$value"]));
  }

  // Border Radius
  const { collectionId: radiiCol, modeId: radiiMode } = addCollection("Border Radius");
  for (const [name, token] of Object.entries(tokens.borderRadius)) {
    addVariable(radiiCol, radiiMode, name, "FLOAT", parseUnit(token["$value"]));
  }

  // Sizing
  const { collectionId: sizingCol, modeId: sizingMode } = addCollection("Sizing");
  for (const [name, token] of Object.entries(tokens.sizing)) {
    addVariable(sizingCol, sizingMode, name, "FLOAT", parseUnit(token["$value"]));
  }

  return { variableCollections, variables, variableModeValues };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\nFrame TV Art - Figma Token Sync");
  console.log("File key : " + FILE_KEY);
  console.log("Endpoint : https://api.figma.com/v1/files/" + FILE_KEY + "/variables\n");

  console.log("Verifying file access...");
  const fileInfo = await figmaRequest("GET", "/v1/files/" + FILE_KEY + "?depth=1");
  console.log("  File: \"" + fileInfo.name + "\" - OK\n");

  const payload = buildPayload();

  const colorCount = Object.keys(tokens.color).length;
  const spacingCount = Object.keys(tokens.spacing).length;
  const radiiCount = Object.keys(tokens.borderRadius).length;
  const sizingCount = Object.keys(tokens.sizing).length;

  console.log("Creating variable collections:");
  console.log("  Colors        - " + colorCount + " variables");
  console.log("  Spacing       - " + spacingCount + " variables");
  console.log("  Border Radius - " + radiiCount + " variables");
  console.log("  Sizing        - " + sizingCount + " variables");
  console.log("  Total         - " + payload.variables.length + " variables\n");

  console.log("Posting to Figma Variables API...");
  const result = await figmaRequest(
    "POST",
    "/v1/files/" + FILE_KEY + "/variables",
    payload
  );

  if (result.error) {
    throw new Error("API error: " + JSON.stringify(result));
  }

  console.log("Done. Variables created successfully.\n");
  console.log("Next steps:");
  console.log("  1. Open the Figma file");
  console.log("  2. Click Variables panel (right sidebar > Local Variables)");
  console.log("  3. Verify 4 collections: Colors, Spacing, Border Radius, Sizing");
  console.log("  4. Then install and run the Figma plugin (design/figma-plugin/)");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});

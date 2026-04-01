/**
 * Config signal line extraction module. Takes signal-bearing config files and
 * replaces their raw content with flat dotted key-value pairs for each detected
 * architecture signal. Follows the same in-place mutation pattern as config-filter.ts.
 */

import type { ConfigSignal } from "./config-signals.js";
import type { ScannedApplication } from "../analyzers/types.js";

export interface ExtractionResult {
  filePath: string;
  originalLineCount: number;
  extractedSignalCount: number;
}

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

type ConfigFormat = "yaml" | "properties" | "xml" | "json" | "toml" | "ini";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(filePath: string): ConfigFormat {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "yml":
    case "yaml":
      return "yaml";
    case "properties":
      return "properties";
    case "xml":
      return "xml";
    case "json":
      return "json";
    case "toml":
      return "toml";
    case "cfg":
    case "ini":
    case "conf":
      return "ini";
    default:
      return "properties";
  }
}

// ---------------------------------------------------------------------------
// Key path builders
// ---------------------------------------------------------------------------

function buildYamlKeyPath(
  lines: string[],
  targetLineIdx: number,
): string | null {
  const targetLine = lines[targetLineIdx];
  if (!targetLine || !targetLine.trim()) return null;

  const parts: string[] = [];
  const targetIndent = targetLine.search(/\S/);
  let currentIndent = targetIndent;

  // Check if this is a list item
  const isListItem = /^\s*-\s/.test(targetLine);

  if (!isListItem) {
    const keyMatch = targetLine.match(/^\s*([\w.-]+)\s*:/);
    if (keyMatch) {
      parts.push(keyMatch[1]);
    }
  }

  // Walk backwards to build full key path
  for (let i = targetLineIdx - 1; i >= 0; i--) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < 0) continue; // skip empty lines

    if (indent < currentIndent) {
      const parentMatch = line.match(/^\s*([\w.-]+)\s*:/);
      if (parentMatch) {
        parts.unshift(parentMatch[1]);
        currentIndent = indent;
      }
    }
    if (currentIndent === 0) break;
  }

  return parts.join(".") || null;
}

function buildPropertiesKeyPath(line: string): string | null {
  const match = line.match(/^\s*([\w.-]+)\s*[=:]/);
  return match ? match[1] : null;
}

function buildXmlKeyPath(
  lines: string[],
  targetLineIdx: number,
): string | null {
  const targetLine = lines[targetLineIdx];
  if (!targetLine || !targetLine.trim()) return null;

  const parts: string[] = [];
  const trimmedTarget = targetLine.trim();

  // Extract tag name from target line
  const tagMatch = trimmedTarget.match(/<([\w.-]+)[\s>]/);
  if (tagMatch) {
    parts.push(tagMatch[1]);
  }

  const targetIndent = targetLine.search(/\S/);
  let currentIndent = targetIndent;

  // Walk backwards to build full tag path
  for (let i = targetLineIdx - 1; i >= 0; i--) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent < 0) continue; // skip empty lines

    const trimmed = line.trim();
    // Skip closing tags and XML declarations
    if (trimmed.startsWith("</") || trimmed.startsWith("<?")) continue;

    if (indent < currentIndent) {
      const parentMatch = trimmed.match(/<([\w.-]+)[\s>]/);
      if (parentMatch) {
        parts.unshift(parentMatch[1]);
        currentIndent = indent;
      }
    }
    if (currentIndent === 0) break;
  }

  return parts.join(".") || null;
}

function buildJsonKeyPath(
  lines: string[],
  targetLineIdx: number,
): string | null {
  const targetLine = lines[targetLineIdx];
  if (!targetLine || !targetLine.trim()) return null;

  const parts: string[] = [];

  // Extract key from target line
  const keyMatch = targetLine.match(/^\s*"([\w.-]+)"\s*:/);
  if (keyMatch) {
    parts.push(keyMatch[1]);
  }

  const targetIndent = targetLine.search(/\S/);
  let currentIndent = targetIndent;

  // Walk backwards to build full key path
  for (let i = targetLineIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue; // skip empty lines

    const indent = line.search(/\S/);
    if (indent < currentIndent) {
      const parentMatch = line.match(/^\s*"([\w.-]+)"\s*:/);
      if (parentMatch) {
        parts.unshift(parentMatch[1]);
        currentIndent = indent;
      }
    }
    if (currentIndent === 0) break;
  }

  return parts.join(".") || null;
}

function buildTomlKeyPath(
  lines: string[],
  targetLineIdx: number,
): string | null {
  const targetLine = lines[targetLineIdx];
  if (!targetLine || !targetLine.trim()) return null;

  // Extract key from target line
  const keyMatch = targetLine.match(/^\s*([\w.-]+)\s*=/);
  if (!keyMatch) return null;
  const key = keyMatch[1];

  // Walk backwards to find section header
  for (let i = targetLineIdx - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    const sectionMatch = trimmed.match(/^\[([\w.-]+)\]$/);
    if (sectionMatch) {
      return `${sectionMatch[1]}.${key}`;
    }
  }

  // No section found — top-level key
  return key;
}

// ---------------------------------------------------------------------------
// Value extraction
// ---------------------------------------------------------------------------

function extractValue(line: string, format: ConfigFormat): string {
  switch (format) {
    case "yaml": {
      // List item: `  - value`
      if (/^\s*-\s/.test(line)) {
        const content = line.replace(/^\s*-\s*/, "").trim();
        return content.replace(/^["']|["']$/g, "");
      }
      // Key: value
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        const content = line.slice(colonIdx + 1).trim();
        return content.replace(/^["']|["']$/g, "");
      }
      return line.trim();
    }

    case "properties": {
      // key=value or key: value
      const eqIdx = line.indexOf("=");
      const colIdx = line.indexOf(":");
      let sepIdx: number;
      if (eqIdx >= 0 && colIdx >= 0) {
        sepIdx = Math.min(eqIdx, colIdx);
      } else if (eqIdx >= 0) {
        sepIdx = eqIdx;
      } else if (colIdx >= 0) {
        sepIdx = colIdx;
      } else {
        return line.trim();
      }
      return line.slice(sepIdx + 1).trim();
    }

    case "xml": {
      // Try element content: >content</
      const elementMatch = line.match(/>([^<]+)</);
      if (elementMatch) return elementMatch[1].trim();
      // Try value attribute first (common in config XML): value="..."
      const valueAttrMatch = line.match(/value=["']([^"']+)["']/);
      if (valueAttrMatch) return valueAttrMatch[1].trim();
      // Try any attribute value: ="value"
      const attrMatch = line.match(/=["']([^"']+)["']/);
      if (attrMatch) return attrMatch[1].trim();
      return line.trim();
    }

    case "json": {
      const colonIdx = line.indexOf(":");
      if (colonIdx >= 0) {
        const content = line.slice(colonIdx + 1).trim();
        // Remove trailing comma and quotes
        return content.replace(/,\s*$/, "").replace(/^["']|["']$/g, "");
      }
      return line.trim();
    }

    case "toml": {
      const eqIdx = line.indexOf("=");
      if (eqIdx >= 0) {
        const content = line.slice(eqIdx + 1).trim();
        return content.replace(/^["']|["']$/g, "");
      }
      return line.trim();
    }

    case "ini": {
      const eqIdx = line.indexOf("=");
      if (eqIdx >= 0) {
        return line.slice(eqIdx + 1).trim();
      }
      return line.trim();
    }
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function extractSignalLines(
  content: string,
  filePath: string,
  signals: readonly ConfigSignal[],
): string {
  const lines = content.split("\n");
  const format = detectFormat(filePath);
  const processedLines = new Set<number>();
  const extracted: Array<{ keyPath: string; value: string }> = [];

  for (const signal of signals) {
    const lineIdx = signal.line - 1; // convert 1-indexed to 0-indexed
    if (lineIdx < 0 || lineIdx >= lines.length) continue;
    if (processedLines.has(signal.line)) continue; // dedup by line number
    processedLines.add(signal.line);

    let keyPath: string | null;
    switch (format) {
      case "yaml":
        keyPath = buildYamlKeyPath(lines, lineIdx);
        break;
      case "properties":
        keyPath = buildPropertiesKeyPath(lines[lineIdx]);
        break;
      case "xml":
        keyPath = buildXmlKeyPath(lines, lineIdx);
        break;
      case "json":
        keyPath = buildJsonKeyPath(lines, lineIdx);
        break;
      case "toml":
      case "ini":
        keyPath = buildTomlKeyPath(lines, lineIdx);
        break;
    }

    const value = extractValue(lines[lineIdx], format);

    if (keyPath) {
      extracted.push({ keyPath, value });
    }
  }

  // Fallback: if extraction produced zero lines, keep original content
  if (extracted.length === 0) return content;

  // Sort alphabetically by key path
  extracted.sort((a, b) => a.keyPath.localeCompare(b.keyPath));

  return extracted.map((e) => `${e.keyPath}: ${e.value}`).join("\n");
}

export function applyConfigExtraction(
  applications: ScannedApplication[],
): Map<string, ExtractionResult[]> {
  const results = new Map<string, ExtractionResult[]>();

  for (const app of applications) {
    if (!app.configFiles || !app.signals) continue;

    const appResults: ExtractionResult[] = [];

    for (const file of app.configFiles) {
      const fileSignals = app.signals.filter((s) => s.filePath === file.path);
      if (fileSignals.length === 0) continue;

      const originalLineCount = file.content.split("\n").length;
      file.content = extractSignalLines(file.content, file.path, fileSignals);

      appResults.push({
        filePath: file.path,
        originalLineCount,
        extractedSignalCount: fileSignals.length,
      });
    }

    if (appResults.length > 0) {
      results.set(app.id, appResults);
    }
  }

  return results;
}

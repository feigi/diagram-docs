/**
 * Wrap text at word boundaries, inserting D2 newline escapes.
 * Keeps each line under `maxWidth` characters.
 */
export function wrapText(text: string, maxWidth = 35): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + 1 + word.length > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\\n");
}

/**
 * Low-level D2 syntax writer.
 * Builds up D2 file content as a string.
 */
export class D2Writer {
  private lines: string[] = [];
  private indent = 0;

  shape(id: string, label?: string, props?: Record<string, string>): this {
    const prefix = this.pad();
    if (label) {
      this.lines.push(`${prefix}${id}: ${this.quote(label)}`);
    } else {
      this.lines.push(`${prefix}${id}`);
    }
    if (props) {
      for (const [key, value] of Object.entries(props).sort(([a], [b]) => a.localeCompare(b))) {
        this.lines.push(`${prefix}${id}.${key}: ${value}`);
      }
    }
    return this;
  }

  container(id: string, label: string, fn: () => void): this {
    const prefix = this.pad();
    this.lines.push(`${prefix}${id}: ${this.quote(label)} {`);
    this.indent++;
    fn();
    this.indent--;
    this.lines.push(`${prefix}}`);
    return this;
  }

  connection(
    sourceId: string,
    targetId: string,
    label?: string,
    props?: Record<string, string>,
  ): this {
    const prefix = this.pad();
    if (label) {
      this.lines.push(`${prefix}${sourceId} -> ${targetId}: ${this.quote(label)}`);
    } else {
      this.lines.push(`${prefix}${sourceId} -> ${targetId}`);
    }
    if (props) {
      // Connection props use (source -> target)[prop] syntax in D2,
      // but for simplicity we'll add as comments
    }
    return this;
  }

  blank(): this {
    this.lines.push("");
    return this;
  }

  comment(text: string): this {
    const prefix = this.pad();
    this.lines.push(`${prefix}# ${text}`);
    return this;
  }

  raw(line: string): this {
    this.lines.push(`${this.pad()}${line}`);
    return this;
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }

  private pad(): string {
    return "  ".repeat(this.indent);
  }

  private quote(text: string): string {
    // D2 supports \n as newline in labels natively.
    // Use double-quoted strings when text contains reserved characters.
    if (/[{}:;|#\[\]()'"\\]/.test(text) || text.includes("\\n")) {
      // Escape any double quotes in the text
      const escaped = text.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    return text;
  }
}

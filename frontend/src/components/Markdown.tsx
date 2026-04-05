/**
 * Markdown.tsx — lightweight markdown renderer (no external deps).
 * Handles: headings, bold, italic, inline code, code blocks, lists,
 *          blockquotes, horizontal rules, links.
 */

interface Props {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: Props) {
  const html = parse(children ?? "");
  return (
    <div
      className={`md${className ? " " + className : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── parser ────────────────────────────────────────────────────────────────────

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineFormat(s: string): string {
  return s
    // code spans (must come before bold/italic to protect backtick content)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escape(c)}</code>`)
    // bold + italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    // bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function parse(raw: string): string {
  const lines  = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i        = 0;
  let inList   = false;
  let listType = "";

  const closeList = () => {
    if (inList) { out.push(`</${listType}>`); inList = false; listType = ""; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── fenced code block ─────────────────────────────────────────────────
    if (line.startsWith("```")) {
      closeList();
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escape(lines[i]));
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ""}>${codeLines.join("\n")}</code></pre>`);
      i++;
      continue;
    }

    // ── headings ──────────────────────────────────────────────────────────
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      closeList();
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineFormat(escape(hMatch[2]))}</h${level}>`);
      i++; continue;
    }

    // ── horizontal rule ───────────────────────────────────────────────────
    if (/^[-*_]{3,}$/.test(line.trim())) {
      closeList();
      out.push("<hr />");
      i++; continue;
    }

    // ── blockquote ────────────────────────────────────────────────────────
    if (line.startsWith("> ")) {
      closeList();
      out.push(`<blockquote>${inlineFormat(escape(line.slice(2)))}</blockquote>`);
      i++; continue;
    }

    // ── unordered list ────────────────────────────────────────────────────
    const ulMatch = line.match(/^[-*+]\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== "ul") { closeList(); out.push("<ul>"); inList = true; listType = "ul"; }
      out.push(`<li>${inlineFormat(escape(ulMatch[1]))}</li>`);
      i++; continue;
    }

    // ── ordered list ──────────────────────────────────────────────────────
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (!inList || listType !== "ol") { closeList(); out.push("<ol>"); inList = true; listType = "ol"; }
      out.push(`<li>${inlineFormat(escape(olMatch[1]))}</li>`);
      i++; continue;
    }

    // ── blank line ────────────────────────────────────────────────────────
    if (line.trim() === "") {
      closeList();
      i++; continue;
    }

    // ── paragraph ─────────────────────────────────────────────────────────
    closeList();
    out.push(`<p>${inlineFormat(escape(line))}</p>`);
    i++;
  }

  closeList();
  return out.join("\n");
}

/**
 * Markdown.tsx — lightweight markdown renderer (no external deps).
 * Handles: headings, bold, italic, inline code, code blocks, lists,
 *          blockquotes, horizontal rules, links.
 */
import { useRef, useEffect } from "react";

interface Props {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: Props) {
  const html = parse(children ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // Inject copy buttons into <pre> blocks after render.
  useEffect(() => {
    if (!ref.current) return;
    const pres = ref.current.querySelectorAll("pre");
    pres.forEach(pre => {
      if (pre.querySelector(".md-copy")) return; // already injected
      // Wrap pre in a relative container for absolute positioning of the button
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const btn = document.createElement("button");
      btn.className = "md-copy";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.style.cssText =
        "position:absolute;top:6px;right:6px;padding:2px 8px;font-size:10px;" +
        "background:var(--c-bg-active);border:1px solid var(--c-border);color:var(--c-text-muted);" +
        "border-radius:4px;cursor:pointer;opacity:0;transition:opacity .15s;";
      wrapper.addEventListener("mouseenter", () => { btn.style.opacity = "1"; });
      wrapper.addEventListener("mouseleave", () => { btn.style.opacity = "0"; });
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy"; }, 1500);
        });
      });
      wrapper.appendChild(btn);
    });
  });

  return (
    <div
      ref={ref}
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

/**
 * Only http(s) and mailto URLs are allowed in links. Everything else
 * (javascript:, data:, vbscript:, file:, etc.) is stripped to prevent XSS
 * via LLM-generated or event-message-embedded markdown links.
 */
function safeUrl(raw: string): string {
  const url = raw.trim();
  // Allow relative URLs and fragment links
  if (url.startsWith("/") || url.startsWith("#") || url.startsWith("?")) return url;
  // Allowlist schemes
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url))     return url;
  return "#";
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
    // links — URL validated against an allowlist of safe schemes,
    // and both URL + label are escaped to block attribute injection.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, url) =>
        `<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`
    );
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

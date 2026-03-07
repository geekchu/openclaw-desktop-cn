import { truncateText } from "./format.ts";

const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "img",
];

const allowedAttrs = ["class", "href", "rel", "target", "title", "start", "src", "alt"];
const sanitizeOptions = {
  ALLOWED_TAGS: allowedTags,
  ALLOWED_ATTR: allowedAttrs,
  ADD_DATA_URI_TAGS: ["img"],
};

let hooksInstalled = false;
const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const markdownCache = new Map<string, string>();

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }
  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

// Lazy-loaded engine definitions
type EngineType = {
  DOMPurify: typeof import("dompurify").default;
  marked: typeof import("marked").marked;
  htmlEscapeRenderer: import("marked").Renderer;
};

let enginePromise: Promise<EngineType> | null = null;

async function loadMarkdownEngine(): Promise<EngineType> {
  if (enginePromise) {
    return enginePromise;
  }
  enginePromise = (async () => {
    const [dompurifyMod, markedMod] = await Promise.all([import("dompurify"), import("marked")]);

    const DOMPurify = dompurifyMod.default;
    const { marked } = markedMod;

    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    // Prevent raw HTML in chat messages from being rendered as formatted HTML.
    // Display it as escaped text so users see the literal markup.
    const htmlEscapeRenderer = new marked.Renderer();
    htmlEscapeRenderer.html = ({ text }: { text: string }) => escapeHtml(text);

    return { DOMPurify, marked, htmlEscapeRenderer };
  })();
  return enginePromise;
}

function installHooks(DOMPurify: EngineType["DOMPurify"]) {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    const href = node.getAttribute("href");
    if (!href) {
      return;
    }
    node.setAttribute("rel", "noreferrer noopener");
    node.setAttribute("target", "_blank");
  });
}

export async function toSanitizedMarkdownHtmlAsync(markdown: string): Promise<string> {
  const input = markdown.trim();
  if (!input) {
    return "";
  }

  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }

  const engine = await loadMarkdownEngine();
  installHooks(engine.DOMPurify);

  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    const html = `<pre class="code-block">${escaped}</pre>`;
    const sanitized = engine.DOMPurify.sanitize(html, sanitizeOptions);
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }
  const rendered = await engine.marked.parse(`${truncated.text}${suffix}`, {
    renderer: engine.htmlEscapeRenderer,
    gfm: true,
    breaks: true,
  });
  const sanitized = engine.DOMPurify.sanitize(rendered, sanitizeOptions);
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

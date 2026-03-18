import { describe, expect, it } from "vitest";
import { toSanitizedMarkdownHtmlAsync } from "./markdown.ts";

describe("toSanitizedMarkdownHtmlAsync", () => {
  it("renders basic markdown", async () => {
    const html = await toSanitizedMarkdownHtmlAsync("Hello **world**");
    expect(html).toContain("<strong>world</strong>");
  });

  it("strips scripts and unsafe links", async () => {
    const html = await toSanitizedMarkdownHtmlAsync(
      [
        "<script>alert(1)</script>",
        "",
        "[x](javascript:alert(1))",
        "",
        "[ok](https://example.com)",
      ].join("\n"),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("https://example.com");
  });

  it("renders fenced code blocks", async () => {
    const html = await toSanitizedMarkdownHtmlAsync(["```ts", "console.log(1)", "```"].join("\n"));
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log(1)");
  });

  it("preserves img tags with src and alt from markdown images (#15437)", async () => {
    const html = await toSanitizedMarkdownHtmlAsync("![Alt text](https://example.com/image.png)");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain('alt="Alt text"');
  });

  it("preserves base64 data URI images (#15437)", async () => {
    const html = await toSanitizedMarkdownHtmlAsync("![Chart](data:image/png;base64,iVBORw0KGgo=)");
    expect(html).toContain("<img");
    expect(html).toContain("data:image/png;base64,");
  });

  it("strips javascript image urls", async () => {
    const html = await toSanitizedMarkdownHtmlAsync("![X](javascript:alert(1))");
    expect(html).toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("src=");
  });

  it("renders GFM markdown tables (#20410)", async () => {
    const md = [
      "| Feature | Status |",
      "|---------|--------|",
      "| Tables  | ✅     |",
      "| Borders | ✅     |",
    ].join("\n");
    const html = await toSanitizedMarkdownHtmlAsync(md);
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<th>");
    expect(html).toContain("Feature");
    expect(html).toContain("Tables");
  });

  it("renders GFM tables surrounded by text (#20410)", async () => {
    const md = [
      "Text before.",
      "",
      "| Col1 | Col2 |",
      "|------|------|",
      "| A    | B    |",
      "",
      "Text after.",
    ].join("\n");
    const html = await toSanitizedMarkdownHtmlAsync(md);
    expect(html).toContain("<table");
    expect(html).toContain("Col1");
    expect(html).toContain("Col2");
    // Pipes from table delimiters must not appear as raw text
    expect(html).not.toContain("|------|");
  });
});

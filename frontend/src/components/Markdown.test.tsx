import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings", () => {
    const { container } = render(<Markdown>{"# Hello"}</Markdown>);
    const h1 = container.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(h1!.textContent).toBe("Hello");
  });

  it("renders h2 and h3 headings", () => {
    const { container } = render(
      <Markdown>{"## Second\n### Third"}</Markdown>
    );
    expect(container.querySelector("h2")!.textContent).toBe("Second");
    expect(container.querySelector("h3")!.textContent).toBe("Third");
  });

  it("renders bold text", () => {
    const { container } = render(<Markdown>{"**bold**"}</Markdown>);
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong!.textContent).toBe("bold");
  });

  it("renders italic text", () => {
    const { container } = render(<Markdown>{"*italic*"}</Markdown>);
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em!.textContent).toBe("italic");
  });

  it("renders inline code", () => {
    const { container } = render(<Markdown>{"`code`"}</Markdown>);
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code!.textContent).toBe("code");
  });

  it("renders fenced code blocks", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<Markdown>{md}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    const code = pre!.querySelector("code");
    expect(code).toBeTruthy();
    expect(code!.classList.contains("language-js")).toBe(true);
    expect(code!.textContent).toBe("const x = 1;");
  });

  it("renders unordered lists", () => {
    const md = "- first\n- second";
    const { container } = render(<Markdown>{md}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).toBeTruthy();
    const items = ul!.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("first");
    expect(items[1].textContent).toBe("second");
  });

  it("renders ordered lists", () => {
    const md = "1. alpha\n2. beta";
    const { container } = render(<Markdown>{md}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    const items = ol!.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("alpha");
  });

  it("renders blockquotes", () => {
    const { container } = render(<Markdown>{"> quote text"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq).toBeTruthy();
    expect(bq!.textContent).toBe("quote text");
  });

  it("renders links with href", () => {
    const { container } = render(
      <Markdown>{"[click](https://example.com)"}</Markdown>
    );
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("https://example.com");
    expect(a!.textContent).toBe("click");
    expect(a!.getAttribute("target")).toBe("_blank");
  });

  it("sanitizes javascript: URLs to #", () => {
    const { container } = render(
      <Markdown>{"[xss](javascript:alert(1))"}</Markdown>
    );
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("#");
  });

  it("sanitizes data: URLs to #", () => {
    const { container } = render(
      <Markdown>{"[xss](data:text/html,<script>alert(1)</script>)"}</Markdown>
    );
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a!.getAttribute("href")).toBe("#");
  });

  it("applies className when provided", () => {
    const { container } = render(
      <Markdown className="custom">{"hello"}</Markdown>
    );
    expect(container.firstChild).toHaveClass("md", "custom");
  });

  it("renders hr from ---", () => {
    const { container } = render(<Markdown>{"---"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).toBeTruthy();
  });
});

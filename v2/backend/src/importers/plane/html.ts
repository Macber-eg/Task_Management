import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { type DomNode, domNode } from "./dom-node";

export type HtmlToMarkdownOptions = {
  mentionName?: (userId: string) => string | undefined;
};

export type HtmlToMarkdown = (html: string | null | undefined) => string;

const MENTION_PATTERN =
  /<mention-component\b([^>]*)>([\s\S]*?)<\/mention-component>/gi;
const ATTRIBUTE_PATTERN = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function createHtmlToMarkdown(
  options: HtmlToMarkdownOptions = {},
): HtmlToMarkdown {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  service.use(gfm);
  service.addRule("planeParagraph", { filter: "p", replacement: paragraph });
  service.addRule("planeList", { filter: ["ul", "ol"], replacement: list });
  service.addRule("planeListItem", { filter: "li", replacement: listItem });
  service.addRule("planeImage", { filter: "img", replacement: image });

  return (html) => {
    if (!html?.trim()) return "";
    return service
      .turndown(replaceMentions(html, options))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };
}

function paragraph(content: string, element: HTMLElement): string {
  const node = domNode(element);
  const parent = node.parentNode?.nodeName;
  if (parent === "TH" || parent === "TD") {
    return node.previousElementSibling ? ` ${content}` : content;
  }
  if (isListItemContent(node) && !node.previousElementSibling) {
    return `\n${content}\n`;
  }
  return `\n\n${content}\n\n`;
}

function list(content: string, element: HTMLElement): string {
  const node = domNode(element);
  if (isListItemContent(node) && !node.nextElementSibling) {
    return `\n${content}`;
  }
  return `\n\n${content}\n\n`;
}

function listItem(
  content: string,
  element: HTMLElement,
  options: TurndownService.Options,
): string {
  const node = domNode(element);
  const parent = node.parentNode;
  let marker = `${options.bulletListMarker ?? "-"} `;
  if (parent?.nodeName === "OL") {
    const start = Number(parent.getAttribute("start") ?? "1");
    const index = Array.prototype.indexOf.call(parent.children, node);
    marker = `${(Number.isFinite(start) ? start : 1) + index}. `;
  }

  const indent = " ".repeat(marker.length);
  const body = content
    .replace(/^\n+/, "")
    .replace(/\n+$/, "")
    .replace(/\n(?=[^\n])/g, `\n${indent}`);
  return `${marker}${checkbox(node)}${body}${node.nextSibling ? "\n" : ""}`;
}

function checkbox(node: DomNode): string {
  if (node.getAttribute("data-type") !== "taskItem") return "";
  return node.getAttribute("data-checked") === "true" ? "[x] " : "[ ] ";
}

function image(_content: string, element: HTMLElement): string {
  const node = domNode(element);
  const src = node.getAttribute("src") ?? "";
  const alt = (node.getAttribute("alt") ?? "").trim();
  if (/^https?:\/\//i.test(src)) return `![${alt}](${src})`;
  return alt;
}

function isListItemContent(node: DomNode): boolean {
  const parent = node.parentNode;
  if (!parent) return false;
  if (parent.nodeName === "LI") return true;
  return parent.nodeName === "DIV" && parent.parentNode?.nodeName === "LI";
}

function replaceMentions(html: string, options: HtmlToMarkdownOptions): string {
  return html.replace(
    MENTION_PATTERN,
    (_match, rawAttributes: string, inner: string) => {
      const attributes = new Map<string, string>();
      for (const [, name, double, single] of rawAttributes.matchAll(
        ATTRIBUTE_PATTERN,
      )) {
        if (name) attributes.set(name.toLowerCase(), double ?? single ?? "");
      }

      const label = attributes.get("label")?.trim();
      if (label) return `<span>@${label.replace(/[<>]/g, escapeChar)}</span>`;

      const id = attributes.get("entity_identifier");
      const name = id ? options.mentionName?.(id)?.trim() : undefined;
      if (name) return `<span>@${name.replace(/[&<>]/g, escapeChar)}</span>`;
      return inner;
    },
  );
}

function escapeChar(char: string): string {
  return char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;";
}

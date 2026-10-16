import { absoluteNGAImageUrl } from "./nga-images";
import type { Nodes, Definition } from "mdast";
import {
  overlaps,
  parse,
  protectedRanges,
  stripTiming,
  walk,
} from "./document";
import { toNGAColor } from "./nga-colors";

export function toBBCode(
  markdown: string,
  imageUrl: (url: string) => string = (url) => url,
): string {
  const source = stripTiming(markdown);
  const original = parse(source);
  const blocked = protectedRanges(source, false, true, original);
  walk(original, (node) => {
    const position = node.position;
    if (
      position &&
      (node.type === "definition" ||
        node.type === "image" ||
        (node.type === "link" && source[position.start.offset!] === "["))
    )
      blocked.push([position.start.offset!, position.end.offset!]);
  });
  // GFM autolinking runs on decoded text, so backslash escapes alone do not
  // protect URLs inside BBCode. Angle brackets stop autolinking; a private-use
  // prefix keeps the temporary text from being recognized as an HTML tag.
  let prefix = "\ue000";
  while (source.includes(prefix)) prefix += "\ue000";
  const rawLinks = new Map<string, string>();
  const tree = parse(
    source.replace(
      /\[(img|url)(?:=[^\]\r\n]*)?\][^\r\n]*?\[\/\1\]/gi,
      (value: string, _tag: string, offset: number) => {
        if (overlaps(blocked, offset)) return value;
        const key = "<" + prefix + rawLinks.size + ">";
        rawLinks.set(key, value);
        return key;
      },
    ),
  );
  const definitions = new Map<string, Definition>();
  walk(tree, (n) => {
    if (n.type === "definition") definitions.set(n.identifier.toLowerCase(), n);
  });
  function url(value: string, image = false): string {
    if (image) value = absoluteNGAImageUrl(value);
    if (!/^https?:\/\//i.test(value))
      throw new Error(
        image
          ? "本地图片需要先上传到可访问的图床，才能导出到 NGA。"
          : `NGA 无法访问本地链接：${value}`,
      );
    if (image && !rawCodeDepth) value = imageUrl(value);
    return value.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
  }
  let rawCodeDepth = 0;
  function colorTags(text: string): string {
    return text.replace(
      /\[\/?code\]|\[color=([^\]\r\n]+)\]/gi,
      (tag, value: string | undefined) => {
        if (tag.toLowerCase() === "[code]") rawCodeDepth++;
        else if (tag.toLowerCase() === "[/code]")
          rawCodeDepth = Math.max(0, rawCodeDepth - 1);
        else if (!rawCodeDepth && value !== undefined)
          return `[color=${toNGAColor(value)}]`;
        return tag;
      },
    );
  }
  function render(node: Nodes): string {
    const children = () =>
      "children" in node ? node.children.map(render).join("") : "";
    const blocks = () =>
      "children" in node
        ? node.children.map(render).filter(Boolean).join("\n\n")
        : "";
    switch (node.type) {
      case "root":
        return blocks();
      case "text":
        if (
          /!?\[\[[^\]\n]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp)(?:\|[^\]\n]*)?\]\]/i.test(
            node.value,
          )
        )
          throw new Error("本地图片需要先上传到可访问的图床，才能导出到 NGA。");
        return colorTags(node.value);
      case "paragraph":
        return children();
      case "strong":
        return `[b]${children()}[/b]`;
      case "emphasis":
        return `[i]${children()}[/i]`;
      case "delete":
        return `[del]${children()}[/del]`;
      case "heading":
        return `[b]${children()}[/b]`;
      case "blockquote":
        return `[quote]${blocks()}[/quote]`;
      case "break":
        return "\n";
      case "thematicBreak":
        return "\n";
      case "code":
        return `[code]${node.value}[/code]`;
      case "inlineCode":
        return `[code]${node.value}[/code]`;
      case "link":
        return `[url=${url(node.url)}]${children()}[/url]`;
      case "image":
        return `[img]${url(node.url, true)}[/img]`;
      case "linkReference":
      case "imageReference": {
        const definition = definitions.get(node.identifier.toLowerCase());
        if (!definition) throw new Error(`缺少链接定义：${node.identifier}`);
        return node.type === "imageReference"
          ? `[img]${url(definition.url, true)}[/img]`
          : `[url=${url(definition.url)}]${children()}[/url]`;
      }
      case "list":
        return `[list${node.ordered ? "=1" : ""}]\n${node.children.map(render).join("\n")}\n[/list]`;
      case "listItem":
        return `[*]${node.checked === null || node.checked === undefined ? "" : node.checked ? "☑ " : "☐ "}${blocks()}`;
      case "table":
        return `[table]\n${node.children.map(render).join("\n")}\n[/table]`;
      case "tableRow":
        return `[tr]${children()}[/tr]`;
      case "tableCell":
        return `[td]${children()}[/td]`;
      case "definition":
      case "yaml":
        return "";
      case "html":
        if (/^<!--[\s\S]*-->$/.test(node.value.trim())) return "";
        throw new Error("导出暂不转换 HTML，请使用 Markdown 或 NGA BBCode。");
      default:
        throw new Error(`暂不支持导出这种 Markdown：${node.type}`);
    }
  }
  let codeDepth = 0;
  return render(tree)
    .replace(
      new RegExp("\\[\\/?code\\]|<" + prefix + "[0-9]+>", "gi"),
      (key) => {
        if (key.toLowerCase() === "[code]") codeDepth++;
        else if (key.toLowerCase() === "[/code]")
          codeDepth = Math.max(0, codeDepth - 1);
        const raw = rawLinks.get(key);
        if (!raw) return key;
        return codeDepth
          ? raw
          : raw.replace(
              /^(\[img(?:=[^\]\r\n]*)?\])([^\r\n]*)(\[\/img\])$/i,
              (_match, open, url, close) => open + imageUrl(absoluteNGAImageUrl(url)) + close,
            );
      },
    )
    .trim();
}

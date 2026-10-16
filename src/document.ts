import { ngaImage, ngaImageSizeUrl, type NGAImageSize } from "./nga-images";
import { toNGAColor } from "./nga-colors";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import type { Nodes, Root } from "mdast";

const gfmSyntax = gfm({ singleTilde: false });
const tildeConstructs = gfmSyntax.text![126]!;
const nonAsciiPunctuation = (code: number | null) =>
  code !== null && code > 127 && /\p{P}/u.test(String.fromCodePoint(code));
// Keep GFM's token pairing and code/escape handling, but allow Chinese punctuation
// beside a double-tilde delimiter even when the outer text has no separating space.
for (const construct of Array.isArray(tildeConstructs) ? tildeConstructs : [tildeConstructs]) {
  if (construct.name !== "strikethrough") continue;
  const tokenize = construct.tokenize;
  construct.tokenize = function (effects, ok, nok) {
    const before = this.previous;
    return tokenize.call(this, effects, (after) => {
      const token = this.events.at(-1)![1];
      if (token.type === "strikethroughSequenceTemporary") {
        if (nonAsciiPunctuation(after)) token._open = true;
        if (nonAsciiPunctuation(before)) token._close = true;
      }
      return ok(after);
    }, nok);
  };
}

export const parse = (text: string): Root =>
  fromMarkdown(text, {
    extensions: [gfmSyntax, frontmatter(["yaml"])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml"])],
  });
export const start = (node: Nodes) => node.position!.start.offset!;
export const end = (node: Nodes) => node.position!.end.offset!;
export function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node) node.children.forEach((child) => walk(child, visit));
}
export function protectedRanges(
  text: string,
  links = false,
  includeHtml = true,
  tree: Root = parse(text),
): [number, number][] {
  const ranges: [number, number][] = [];
  walk(tree, (node) => {
    if (
      [
        "code",
        "inlineCode",
        "yaml",
        ...(includeHtml ? ["html"] : []),
        ...(links ? ["link", "image", "linkReference", "imageReference"] : []),
      ].includes(node.type)
    ) {
      ranges.push([start(node), end(node)]);
    }
  });
  return ranges;
}
export const overlaps = (ranges: [number, number][], a: number, b = a + 1) =>
  ranges.some(([x, y]) => a < y && b > x);

export interface Segment {
  from: number;
  to: number;
  title: string;
}
export function segments(text: string): Segment[] {
  const tree = parse(text);
  const front = tree.children[0]?.type === "yaml" ? end(tree.children[0]) : 0;
  const rules = tree.children.filter((node) => node.type === "thematicBreak");
  const result: Segment[] = [];
  let from = front;
  for (const to of [...rules.map(start), text.length]) {
    const content = text.slice(from, to);
    const title = content.match(
      /^\s*(?:\[timingpost[^\]\n]*\]\s*)?<!-- anke-section: ("[^\n]*") -->/,
    );
    let name = "";
    if (title) {
      try {
        name = JSON.parse(title[1]);
      } catch {
        /* A malformed comment stays a comment. */
      }
    }
    result.push({ from, to, title: name || `分节 ${result.length + 1}` });
    const rule = rules.find((n) => start(n) === to);
    from = rule ? end(rule) : to;
  }
  return result;
}
export function segmentAt(text: string, offset: number): Segment {
  const all = segments(text);
  return (
    all.find((s) => offset >= s.from && offset <= s.to) ??
    all.find((s) => s.from > offset) ??
    all.at(-1)!
  );
}

export interface TimingTag {
  from: number;
  openEnd: number;
  closeStart: number;
  to: number;
  attrs: Record<string, string>;
  body: string;
}
export function timingTags(text: string): TimingTag[] {
  const blocked = protectedRanges(text);
  const tokens = [
    ...text.matchAll(
      /^[ \t]*\[(timingpost(?:\s[^\]\n]*)?|\/timingpost)\][ \t]*$/gm,
    ),
  ].filter((m) => !overlaps(blocked, m.index!, m.index! + m[0].length));
  const tags: TimingTag[] = [];
  let open: RegExpMatchArray | undefined;
  for (const token of tokens) {
    if (token[1] !== "/timingpost") {
      if (open) throw new Error("发布标签不能嵌套，请先修正 timingpost。");
      open = token;
    } else {
      if (!open) throw new Error("发现缺少起始标签的 /timingpost。");
      const raw = open[1].slice("timingpost".length);
      const attrs: Record<string, string> = {};
      for (const match of raw.matchAll(/([a-z]+)="([^"\n]*)"/g)) {
        if (attrs[match[1]] !== undefined)
          throw new Error("发布标签属性重复。");
        attrs[match[1]] = match[2];
      }
      if (raw.replace(/([a-z]+)="([^"\n]*)"/g, "").trim())
        throw new Error('发布标签使用 name="value" 格式。');
      const from = open.index!,
        openEnd = from + open[0].length;
      const closeStart = token.index!,
        to = closeStart + token[0].length;
      const section = segmentAt(text, from);
      if (to > section.to)
        throw new Error("一个发布标签只能包围一个分节；分割后请重新安排发布。");
      const outside =
        text.slice(section.from, from) + text.slice(to, section.to);
      if (outside.replace(/<!-- anke-section: .*? -->/g, "").trim())
        throw new Error("发布标签必须包围完整分节。");
      tags.push({
        from,
        openEnd,
        closeStart,
        to,
        attrs,
        body: text.slice(openEnd, closeStart).trim(),
      });
      open = undefined;
    }
  }
  if (open) throw new Error("发布标签缺少 [/timingpost]。");
  return tags;
}
export function openingTag(attrs: Record<string, string>): string {
  for (const value of Object.values(attrs))
    if (/["\]\r\n]/.test(value)) throw new Error("发布属性含有无效字符。");
  return `[timingpost ${Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ")}]`;
}
export function stripTiming(text: string): string {
  const tags = timingTags(text);
  for (const tag of tags.reverse())
    text = text.slice(0, tag.from) + tag.body + text.slice(tag.to);
  return text;
}
export function wrapSegment(
  text: string,
  section: Segment,
  attrs: Record<string, string>,
): string {
  const inner = text.slice(section.from, section.to).trim();
  if (!inner) throw new Error("空白分节不能发布。");
  if (
    timingTags(text).some((t) => t.from >= section.from && t.to <= section.to)
  )
    throw new Error("这个分节已有发布记录；请先在发布面板处理。");
  return `\n\n${openingTag(attrs)}\n${inner}\n[/timingpost]\n\n`;
}

export interface Variant {
  from: number;
  to: number;
  label: string;
  url: string;
  raw: string;
  image?: boolean;
  labelFrom?: number;
  labelTo?: number;
  urlFrom?: number;
  urlTo?: number;
}
export function variants(text: string): Variant[] {
  const result: Variant[] = [];
  const tree = parse(text);
  const paragraphs: [number, number][] = [];
  walk(tree, (node) => {
    if (node.type !== "paragraph") return;
    paragraphs.push([start(node), end(node)]);
    for (const [index, link] of node.children.entries()) {
      if (
        !["link", "image"].includes(link.type) ||
        (link.type === "link" &&
          link.children.some((n) => n.type !== "text")) ||
        link.position!.start.line !== link.position!.end.line
      )
        continue;
      if (link.type !== "link" && link.type !== "image") continue;
      const from = text.lastIndexOf("\n", start(link) - 1) + 1;
      const newline = text.indexOf("\n", end(link));
      if (text.slice(end(link), newline < 0 ? text.length : newline).trim())
        continue;
      const prefix = text.slice(from, start(link));
      const list = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+$/.test(prefix);
      const colon = prefix.match(
        /^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(.*?)([:：][ \t]*)$/,
      );
      const previous = node.children[index - 1];
      // The caption must be plain text on this line, outside code and other links.
      if (
        !list &&
        prefix.trim() &&
        (!colon ||
          previous?.type !== "text" ||
          start(previous) > from + colon[1].length)
      )
        continue;
      const label =
        colon && previous?.type === "text"
          ? previous.value
              .split(/\r?\n/)
              .at(-1)!
              .replace(/[:：][ \t]*$/, "")
              .trim()
          : link.type === "image"
            ? link.alt || ""
            : link.children.map((n) => ("value" in n ? n.value : "")).join("");
      result.push({
        from,
        to: end(link),
        label,
        url: link.url,
        raw: text.slice(from, end(link)),
        ...(link.type === "image" ? { image: true } : {}),
        ...(colon
          ? {
              labelFrom: from + colon[1].length,
              labelTo: start(link) - colon[3].length,
            }
          : {}),
      });
    }
  });
  const blocked = protectedRanges(text, true, true, tree);
  const code = protectedRanges(text, false, true, tree);
  // Markdown does not autolink NGA's bare ./ paths or its [img] wrapper.
  for (const match of text.matchAll(
    /^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(?:(.*?)([:：][ \t]*))?(\[img\])?((?:\.\/mon_|https?:\/\/)[^\s<>\[\]]+)(\[\/img\])?[ \t]*\r?$/gmi,
  )) {
    const url = match[5];
    const urlFrom = match.index! + match[1].length + (match[2]?.length || 0) +
      (match[3]?.length || 0) + (match[4]?.length || 0);
    const urlTo = urlFrom + url.length;
    if (!ngaImage(url) || !!match[4] !== !!match[6] ||
      (!match[4] && !url.startsWith("./")) ||
      !paragraphs.some(([from, to]) => from <= urlFrom && urlTo <= to) ||
      overlaps(blocked, match.index!, urlFrom) ||
      overlaps(code, urlFrom, urlTo)) continue;
    const to = urlTo + (match[6]?.length || 0);
    result.push({
      from: match.index!, to, raw: text.slice(match.index!, to),
      url, urlFrom, urlTo, label: match[2]?.trim() ?? url,
      image: !!match[4],
      ...(match[3] ? {
        labelFrom: match.index! + match[1].length,
        labelTo: match.index! + match[1].length + match[2].length,
      } : {}),
    });
  }
  for (const match of text.matchAll(
    /^[ \t]*(?:[-+*][ \t]+)?(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\][ \t]*$/gm,
  )) {
    if (overlaps(blocked, match.index!, match.index! + match[0].length))
      continue;
    const url = match[2];
    if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(url)) continue;
    const alias = match[3];
    result.push({
      from: match.index!,
      to: match.index! + match[0].length,
      raw: match[0],
      url,
      label:
        alias !== undefined && !/^\d+(?:x\d+)?$/.test(alias)
          ? alias
          : url
              .split("/")
              .at(-1)!
              .replace(/\.[^.]+$/, ""),
      image: !!match[1],
    });
  }
  return result.sort((a, b) => a.from - b.from);
}
export interface VariantSection {
  key: string;
  path: string;
  title: string;
  depth: number;
  parentKey?: string;
  headingFrom: number;
  from: number;
  to: number;
  line: number;
  entries: Variant[];
}
export function variantSections(text: string): VariantSection[] {
  const headings = parse(text).children.filter(
    (node) => node.type === "heading",
  );
  const entries = variants(text);
  const sections: VariantSection[] = [];
  const stack: { depth: number; name: string; key: string }[] = [];
  const counts = new Map<string, number>();
  const preamble = entries.filter(
    (entry) => entry.from < (headings[0] ? start(headings[0]) : text.length),
  );
  if (preamble.length || !headings.length)
    sections.push({
      key: "preamble",
      path: "默认",
      title: "默认",
      depth: 0,
      headingFrom: 0,
      from: 0,
      to: headings[0] ? start(headings[0]) : text.length,
      line: 0,
      entries: preamble,
    });
  for (const [index, heading] of headings.entries()) {
    let name = "";
    walk(heading, (node) => {
      if (node.type === "text" || node.type === "inlineCode")
        name += node.value;
    });
    while (stack.length && stack.at(-1)!.depth >= heading.depth) stack.pop();
    const parentKey = stack.at(-1)?.key;
    const path = [...stack.map((part) => part.name), name].join(" / ");
    const count = (counts.get(path) || 0) + 1;
    counts.set(path, count);
    const key = `${encodeURIComponent(path)}:${count}`;
    stack.push({ depth: heading.depth, name, key });
    const from = end(heading),
      to = headings[index + 1] ? start(headings[index + 1]) : text.length;
    const rows = entries.filter(
      (entry) => entry.from >= from && entry.to <= to,
    );
    sections.push({
      key,
      path,
      title: name,
      depth: heading.depth,
      parentKey,
      headingFrom: start(heading),
      from,
      to,
      line: heading.position!.start.line - 1,
      entries: rows,
    });
  }
  return sections;
}
/** Move a heading and its complete subtree without changing Markdown heading levels. */
export function reorderVariantSection(
  text: string,
  source: Pick<VariantSection, "key" | "headingFrom">,
  target: Pick<VariantSection, "key" | "headingFrom">,
  after: boolean,
): { text: string; keyChanges: [string, string][] } {
  const sections = variantSections(text);
  const a = sections.findIndex(
    (s) => s.key === source.key && s.headingFrom === source.headingFrom,
  );
  const b = sections.findIndex(
    (s) => s.key === target.key && s.headingFrom === target.headingFrom,
  );
  if (a < 0 || b < 0) throw new Error("差分标题或顺序已改变，请刷新后再拖动。");
  const old = sections[a],
    destination = sections[b];
  if (
    !old.depth ||
    old.depth !== destination.depth ||
    old.parentKey !== destination.parentKey
  )
    throw new Error("只能在同级、同一父标题下拖动差分组。");
  if (a === b) return { text, keyChanges: [] };
  const subtreeEnd = (index: number) => {
    let end = index + 1;
    while (end < sections.length && sections[end].depth > sections[index].depth)
      end++;
    return end;
  };
  const end = subtreeEnd(a);
  const insertIndex = after ? subtreeEnd(b) : b;
  if (insertIndex === a || insertIndex === end) return { text, keyChanges: [] };
  const from = old.headingFrom;
  const to = sections[end]?.headingFrom ?? text.length;
  const insertAt = sections[insertIndex]?.headingFrom ?? text.length;
  const remaining = text.slice(0, from) + text.slice(to);
  const offset = insertAt > from ? insertAt - (to - from) : insertAt;
  const before = remaining.slice(0, offset),
    following = remaining.slice(offset);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const join = (left: string, right: string) =>
    left +
    (left && right && !left.endsWith(newline + newline)
      ? left.endsWith(newline)
        ? newline
        : newline + newline
      : "") +
    right;
  const next = join(join(before, text.slice(from, to)), following);
  const order = sections.slice();
  const moved = order.splice(a, end - a);
  order.splice(
    insertIndex > a ? insertIndex - moved.length : insertIndex,
    0,
    ...moved,
  );
  const updated = variantSections(next);
  if (
    updated.length !== order.length ||
    updated.some(
      (s, i) => s.title !== order[i].title || s.depth !== order[i].depth,
    )
  )
    throw new Error(
      "移动会改变 Markdown 标题结构，请先检查未闭合的代码块或标签。",
    );
  return {
    text: next,
    keyChanges: order.flatMap((s, i) =>
      s.key === updated[i].key
        ? []
        : [[s.key, updated[i].key] as [string, string]],
    ),
  };
}

export function appendVariant(text: string, key: string, link: string): string {
  return appendVariantLine(text, key, `- ${link}`);
}
export function appendVariantLine(text: string, key: string, raw: string): string {
  const section = variantSections(text).find((part) => part.key === key);
  if (!section) throw new Error("差分标题已改变，请刷新后重试。");
  const prefix = text.slice(0, section.to);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = prefix.endsWith("\n") ? newline : newline + newline;
  const insert = `${separator}${raw}${newline}${newline}`;
  const next = prefix + insert + text.slice(section.to);
  if (
    !variantSections(next).find((part) => part.key === key)?.entries.some(
      (entry) => entry.from === prefix.length + separator.length && entry.raw === raw,
    )
  )
    throw new Error("无法识别新增差分，请检查该组的 Markdown 格式。");
  return next;
}
export const linkLabel = (value: string) =>
  value.replace(/[\\\[\]]/g, "\\$&").replace(/\r?\n/g, " ");
export function markdownLink(
  label: string,
  url: string,
  image = false,
): string {
  if (/[<>\r\n]/.test(url)) throw new Error("图片地址不能包含换行或尖括号。");
  return `${image ? "!" : ""}[${linkLabel(label)}](<${url}>)`;
}
export function resizeVariant(
  text: string,
  old: Variant,
  size: NGAImageSize,
): string {
  if (text.slice(old.from, old.to) !== old.raw)
    throw new Error("差分文件已修改，请刷新后再调整大小。");
  const url = ngaImageSizeUrl(old.url, size);
  if (!url) throw new Error("图片大小选项仅支持 NGA 图片地址。");
  if (url === old.url) return text;
  if (old.urlFrom !== undefined && old.urlTo !== undefined)
    return text.slice(0, old.urlFrom) + url + text.slice(old.urlTo);
  return (
    text.slice(0, old.from) +
    mapLinkDestinations(old.raw, () => url) +
    text.slice(old.to)
  );
}
export function editVariant(text: string, old: Variant, label: string): string {
  if (text.slice(old.from, old.to) !== old.raw)
    throw new Error("差分文件已修改，请刷新后再编辑。");
  if (old.labelFrom !== undefined && old.labelTo !== undefined)
    return (
      text.slice(0, old.labelFrom) + linkLabel(label) + text.slice(old.labelTo)
    );
  return (
    text.slice(0, old.from) +
    (old.raw.match(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/)?.[0] ||
      (old.image ? "" : "- ")) +
    markdownLink(label, old.url, old.image) +
    text.slice(old.to)
  );
}
export function deleteVariant(text: string, entry: Variant): string {
  if (
    !variants(text).some(
      (row) => row.from === entry.from && row.raw === entry.raw,
    )
  )
    throw new Error("差分文件已修改，请刷新后再删除。");
  const newline = text.indexOf("\n", entry.to);
  return (
    text.slice(0, entry.from) +
    text.slice(newline < 0 ? text.length : newline + 1)
  );
}

export function reorderVariant(
  text: string,
  old: Variant,
  target: Variant,
  displayed?: Variant[],
): string {
  if (old.from === target.from && !displayed) return text;
  if (
    text.slice(old.from, old.to) !== old.raw ||
    text.slice(target.from, target.to) !== target.raw
  )
    throw new Error("差分顺序已改变，请刷新后再拖动。");
  const section = variantSections(text).find((part) =>
    part.entries.some((entry) => entry.from === old.from),
  );
  if (!section?.entries.some((entry) => entry.from === target.from))
    throw new Error("请在同一差分组内拖动排序。");
  const slots = displayed
    ? section.entries.filter((entry) =>
        displayed.some((row) => row.from === entry.from),
      )
    : section.entries;
  const list = displayed ?? slots;
  if (
    list.length !== slots.length ||
    list.some(
      (row) =>
        !slots.some((slot) => slot.from === row.from && slot.raw === row.raw),
    )
  )
    throw new Error("差分内容已改变，请刷新后再拖动。");
  const a = list.findIndex((v) => v.from === old.from),
    b = list.findIndex((v) => v.from === target.from);
  if (a < 0 || b < 0) throw new Error("差分内容已改变，请刷新后再拖动。");
  const rows = list.map((v) => v.raw);
  rows.splice(b, 0, rows.splice(a, 1)[0]);
  for (let i = slots.length - 1; i >= 0; i--)
    text = text.slice(0, slots[i].from) + rows[i] + text.slice(slots[i].to);
  return text;
}

export function editAndPromoteVariant(
  text: string,
  old: Variant,
  label: string,
  displayed: Variant[],
): { text: string; entry: Variant } {
  if (!displayed.length) throw new Error("差分组已改变，请刷新后再编辑。");
  const first = Math.min(...displayed.map((row) => row.from));
  const moved = reorderVariant(text, old, displayed[0], displayed);
  const promoted = variants(moved).find((row) => row.from === first)!;
  const next = editVariant(moved, promoted, label);
  return {
    text: next,
    entry: variants(next).find((row) => row.from === first)!,
  };
}

/** Rewrite destinations only; retain captions, titles, code and surrounding Markdown. */
export function mapLinkDestinations(
  text: string,
  replace: (url: string, wiki: boolean) => string,
): string {
  const changes: { from: number; to: number; value: string }[] = [];
  walk(parse(text), (node) => {
    if (
      node.type !== "link" &&
      node.type !== "image" &&
      node.type !== "definition"
    )
      return;
    const url = replace(node.url, false);
    if (url === node.url) return;
    if (/[<>\r\n]/.test(url)) throw new Error("链接路径包含不支持的字符。");
    const raw = text.slice(start(node), end(node));
    if (node.type === "link" && !raw.startsWith("[")) {
      const bracket = raw.startsWith("<") ? 1 : 0;
      changes.push({ from: start(node) + bracket, to: end(node) - bracket, value: url });
      return;
    }
    let cursor = raw[0] === "!" ? 1 : 0,
      depth = 0;
    for (; cursor < raw.length; cursor++) {
      if (raw[cursor] === "\\") {
        cursor++;
        continue;
      }
      if (raw[cursor] === "[") depth++;
      if (raw[cursor] === "]" && --depth === 0) {
        cursor++;
        break;
      }
    }
    // Inline links use '(' after the label; definitions use ':'.
    while (/\s/.test(raw[cursor] || "") && cursor < raw.length) cursor++;
    cursor++;
    while (/\s/.test(raw[cursor] || "") && cursor < raw.length) cursor++;
    const from = cursor;
    if (raw[cursor] === "<") {
      cursor++;
      while (cursor < raw.length && raw[cursor] !== ">") {
        if (raw[cursor] === "\\") cursor++;
        cursor++;
      }
      cursor++;
    } else {
      let parentheses = 0;
      while (cursor < raw.length) {
        const ch = raw[cursor];
        if (ch === "\\") {
          cursor += 2;
          continue;
        }
        if (/\s/.test(ch) || (ch === ")" && parentheses === 0)) break;
        if (ch === "(") parentheses++;
        if (ch === ")") parentheses--;
        cursor++;
      }
    }
    changes.push({
      from: start(node) + from,
      to: start(node) + cursor,
      value: `<${url}>`,
    });
  });
  const blocked = protectedRanges(text, true);
  for (const match of text.matchAll(/!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) {
    if (overlaps(blocked, match.index!, match.index! + match[0].length))
      continue;
    const url = replace(match[1], true);
    if (url === match[1]) continue;
    const from = match.index! + match[0].indexOf("[[") + 2;
    changes.push({ from, to: from + match[1].length, value: url });
  }
  for (const change of changes.sort((a, b) => b.from - a.from))
    text = text.slice(0, change.from) + change.value + text.slice(change.to);
  return text;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}
export function dialogueChanges(
  text: string,
  from: number,
  to: number,
  color: string,
): TextChange[] {
  color = toNGAColor(color);
  const blocked = protectedRanges(text, true);
  const changes: TextChange[] = [];
  let allColored = true;
  const pattern = /“([^”\n]*)”|「([^」\n]*)」|『([^』\n]*)』|"([^"\n]*)"/g;
  for (const match of text.slice(from, to).matchAll(pattern)) {
    const a = from + match.index! + 1,
      b = a + match[0].length - 2;
    if (a === b || overlaps(blocked, a, b)) continue;
    const original = text.slice(a, b);
    const inside = original.replace(/\[\/?color(?:=[^\]]+)?\]/gi, "");
    const wrapper = original.match(/^\[color=([^\]]+)\]([\s\S]*)\[\/color\]$/i);
    try {
      allColored =
        allColored &&
        !!wrapper &&
        wrapper[2] === inside &&
        toNGAColor(wrapper[1]) === color;
    } catch {
      // An unsupported old color can still be replaced with the chosen color.
      allColored = false;
    }
    changes.push({
      from: a,
      to: b,
      insert: inside,
    });
  }
  return allColored
    ? changes
    : changes.map((change) => ({
        ...change,
        insert: `[color=${color}]${change.insert}[/color]`,
      }));
}
export function completion(text: string, caret: number): TextChange | null {
  const before = text.slice(0, caret);
  const match = before.match(
    /(?<![\\\[])\[(quo(?:t(?:e)?)?|col(?:o(?:r)?)?(?:=[^\]\n]*)?|coll(?:apse)?(?:=[^\]\n]*)?)\]?$/,
  );
  if (!match || text[caret] === "(") return null;
  if (overlaps(protectedRanges(text, true), caret - 1, caret)) return null;
  const typed = match[1],
    tag = typed.startsWith("quo")
      ? "quote"
      : typed.startsWith("coll")
        ? "collapse"
        : "color";
  if (text.slice(caret).startsWith(`[/${tag}]`)) return null;
  const parameter = typed.includes("=")
    ? typed.slice(typed.indexOf("="))
    : tag === "color"
      ? "=red"
      : "";
  return {
    from: caret - match[0].length,
    to: caret,
    insert: `[${tag}${parameter}][/${tag}]`,
  };
}

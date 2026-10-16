import test from "node:test";
import assert from "node:assert/strict";
import { toBBCode } from "../src/export";

const imageURL =
  "https://img.nga.178.com/attachments/mon_202412/09/example.png";
const image = `[img]${imageURL}[/img]`;

test("existing NGA image tags survive export without nested URL tags", () => {
  assert.equal(toBBCode(image), image);
  assert.equal(toBBCode(toBBCode(image)), image);
  assert.equal(toBBCode(`前文${image}后文`), `前文${image}后文`);
});

test("adjacent raw images preserve case, URL punctuation and query strings", () => {
  const other = "[IMG]https://example.com/a_b_c.png?x=[one]&copy;=2#part[/IMG]";
  assert.equal(toBBCode(image + other), image + other);
  assert.equal(toBBCode(image + "\n" + other), image + "\n" + other);
});

test("Markdown formatting surrounding raw images still converts recursively", () => {
  assert.equal(
    toBBCode(`> **caption** ${image}\n>\n> - *picture* ${image}`),
    `[quote][b]caption[/b] ${image}\n\n[list]\n[*][i]picture[/i] ${image}\n[/list][/quote]`,
  );
});

test("manual URL tags remain intact while Markdown and bare links still convert", () => {
  const raw = `[url]${imageURL}[/url] [url=${imageURL}]图片[/url]`;
  assert.equal(
    toBBCode(
      `${raw}\n\n![photo](${imageURL}) [link](https://example.com) https://example.com`,
    ),
    `${raw}\n\n${image} [url=https://example.com]link[/url] [url=https://example.com]https://example.com[/url]`,
  );
});

test("raw image examples remain literal in Markdown and BBCode code", () => {
  for (const source of [
    "`" + image + "`",
    "```\n" + image + "\n```",
    `[code]${image}[/code]`,
  ])
    assert.equal(toBBCode(source), `[code]${image}[/code]`);
  assert.equal(toBBCode(`\ue0000 ${image}`), `\ue0000 ${image}`);
});

test("BBCode-looking text in Markdown destinations and YAML is not rewritten", () => {
  const url = "https://example.com/[img]asset[/img]";
  const encoded = "https://example.com/%5Bimg%5Dasset%5B/img%5D";
  assert.equal(toBBCode(`[link](${url})`), `[url=${encoded}]link[/url]`);
  assert.equal(toBBCode(`![alt](${url})`), `[img]${encoded}[/img]`);
  assert.equal(
    toBBCode(`[link][ref]\n\n[ref]: ${url}`),
    `[url=${encoded}]link[/url]`,
  );
  assert.equal(toBBCode(`---\nexample: '${image}'\n---\n\n${image}`), image);
});

test("timing and color processing remain active around preserved raw images", () => {
  assert.equal(
    toBBCode(
      `[timingpost task="image" time="2030-01-01T00:00:00Z"]\n[color=#f00]**text**[/color] ${image}\n[/timingpost]`,
    ),
    `[color=red][b]text[/b][/color] ${image}`,
  );
});

test("raw images next to code and bare URLs do not merge parser tokens", () => {
  assert.equal(
    toBBCode("`before`" + image + "`after`"),
    `[code]before[/code]${image}[code]after[/code]`,
  );
  assert.equal(
    toBBCode("https://example.com" + image),
    `[url=https://example.com]https://example.com[/url]${image}`,
  );
});

test("number ranges and single tildes remain literal during export", () => {
  for (const source of [
    "1-2……3-4……5-6……",
    "1~2……3~4……5~6……",
    "1～2……3～4……5～6……",
    "1—2……3—4……5—6……",
    "1~2：成功\n3~4：失败\n5~6：重试",
    "~保留这句话~",
  ]) assert.equal(toBBCode(source), source);
});

test("explicit double-tilde strikethrough still supports nested Markdown", () => {
  assert.equal(
    toBBCode("1~2 ~~删除 **这段**~~ 3~4 ~~另一段~~ 5~6"),
    "1~2 [del]删除 [b]这段[/b][/del] 3~4 [del]另一段[/del] 5~6",
  );
  assert.equal(toBBCode("[del]手写删除线[/del]"), "[del]手写删除线[/del]");
});

test("ranges retain their punctuation inside quotes and around section markers", () => {
  assert.equal(
    toBBCode("> 1~2：成功\n> 3~4：失败\n\n---\n\n1-2……3-4……5-6……"),
    "[quote]1~2：成功\n3~4：失败[/quote]\n\n\n\n\n1-2……3-4……5-6……",
  );
});

test("double tildes around Chinese punctuation work next to Latin and Chinese text", () => {
  assert.equal(
    toBBCode("这个示例的编号是Demo~~（测试）~~。"),
    "这个示例的编号是Demo[del]（测试）[/del]。",
  );
  assert.equal(toBBCode("前文~~“删除”~~后文"), "前文[del]“删除”[/del]后文");
  assert.equal(toBBCode("~~文字。~~接下来"), "[del]文字。[/del]接下来");
  assert.equal(toBBCode("JK~~（**大嘘**）~~。"), "JK[del]（[b]大嘘[/b]）[/del]。");
});

test("Chinese strikethrough keeps escaped markers, code, URLs and single tildes literal", () => {
  for (const source of ["JK~（测试）~。", "JK~~（测试）", "JK~~ （测试） ~~。", "JK～～（测试）～～。"])
    assert.equal(toBBCode(source), source);
  assert.equal(toBBCode(String.raw`JK\~\~（测试）\~\~。`), "JK~~（测试）~~。");
  for (const source of ["`JK~~（测试）~~。`", "```\nJK~~（测试）~~。\n```"])
    assert.equal(toBBCode(source), "[code]JK~~（测试）~~。[/code]");
  const url = "https://example.com/JK~~（测试）~~.webp";
  assert.equal(toBBCode(`![图](${url})`), `[img]${url}[/img]`);
  assert.equal(toBBCode("1~2……3~4……5~6……"), "1~2……3~4……5~6……");
});

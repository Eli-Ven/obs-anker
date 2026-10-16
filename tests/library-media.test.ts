import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { posix } from "node:path";
import { createRequire } from "node:module";
import type { App, TFile } from "obsidian";
import type { Library as LibraryType, VariantGroup } from "../src/library";
import { variantSections, variants } from "../src/document";

// Exercise the production media paths offline; only Obsidian's Vault API is stubbed.
class File {
  constructor(public path: string) {}
  get parent() { return { path: posix.dirname(this.path) }; }
}
const require = createRequire(import.meta.url);
const code = buildSync({
  entryPoints: ["src/library.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", external: ["obsidian"], logLevel: "silent",
}).outputFiles[0].text;
const module = { exports: {} as { Library: typeof LibraryType } };
new Function("require", "module", "exports", code)(
  (id: string) => id === "obsidian" ? {
    TFile: File, normalizePath: posix.normalize,
    parseLinktext: (path: string) => ({ path, subpath: "" }),
  } : require(id), module, module.exports,
);
const { Library } = module.exports;

function setup() {
  const local = new File("project/characters/photo.webp");
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => path === local.path ? local : null,
      getResourcePath: (file: File) => "app://vault/" + file.path,
    },
    metadataCache: { getFirstLinkpathDest: () => null },
    fileManager: { generateMarkdownLink: (file: File) => `[[${file.path}|local]]` },
  } as unknown as App;
  return {
    library: new Library(app, /^\d+-\d+/, "characters"),
    source: new File("project/characters/A.md") as TFile,
    target: new File("project/1-1.md") as TFile,
  };
}

test("relative NGA variants preview and insert as absolute URLs across note locations", () => {
  const { library, source, target } = setup();
  for (const suffix of ["", ".thumb_s.jpg?x=1#part"]) {
    const relative = "./mon_202610/05/example.webp" + suffix;
    const absolute = "https://img.nga.cn/attachments/" + relative.slice(2);
    assert.equal(library.resolveMedia(relative, source), absolute);
    assert.equal(library.insertionUrl(relative, source, target), absolute);
    assert.equal(library.imageLink(relative, source, target, "微笑"), `![微笑](<${absolute}>)`);
    assert.equal(library.imageLink(relative, source, source, "微笑", false), `[微笑](<${absolute}>)`);
    const catalog = `# 常服\n微笑：[img]${relative}[/img]\n[困惑](${relative})`;
    assert.equal(library.imageEntries(catalog, source).length, 2);
    assert.equal(library.rebaseLinks(catalog, source, "other/characters/A.md"), catalog);
  }
});

test("ordinary Vault images keep local preview and link generation", () => {
  const { library, source, target } = setup();
  assert.equal(library.resolveMedia("./photo.webp", source), "app://vault/project/characters/photo.webp");
  assert.equal(library.insertionUrl("./photo.webp", source, target), "characters/photo.webp");
  assert.equal(library.imageLink("./photo.webp", source, target, "local"), "![[project/characters/photo.webp|local]]");
  assert.throws(() => library.resolveMedia("./missing.webp", source), /找不到图片/);
});


function moveSetup(sourceText: string, targetText: string) {
  const { library, source } = setup();
  const target = new File("other/characters/B.md") as TFile;
  const texts = new Map([[source.path, sourceText], [target.path, targetText]]);
  const writes: string[] = [];
  const app = library.app as any;
  app.workspace = { getLeavesOfType: () => [] };
  app.vault.read = async (file: TFile) => texts.get(file.path)!;
  app.vault.process = async (file: TFile, change: (text: string) => string) => {
    texts.set(file.path, change(texts.get(file.path)!));
    writes.push(file.path);
  };
  const group = (file = target, index = 0): VariantGroup => {
    const section = variantSections(texts.get(file.path)!)[index];
    return { ...section, file, sectionKey: section.key, key: `${file.path}#${section.key}` };
  };
  return { library, source, target, texts, writes, group };
}

test("moving variants between characters preserves captions, syntax and surrounding notes", async () => {
  for (const raw of [
    "- [微笑](https://example.com/a.webp)",
    "https://example.com/a.webp",
    "平淡：[img]./mon_202610/05/a.webp.thumb_s.jpg[/img]",
    "[空白描述：](./mon_202610/05/a.webp)",
    "![](https://example.com/a.webp)",
  ]) {
    const sourceText = `---\nanke-type: character\n---\n# 常服\n${raw}\n\n角色备注\n`;
    const targetText = "# 冬装\n目标备注\n\n# 经历\n保留记录\n";
    const { library, source, target, texts, writes, group } = moveSetup(sourceText, targetText);
    await library.moveVariant(source, variants(sourceText)[0], group());
    assert.equal(texts.get(source.path), sourceText.replace(raw + "\n", ""));
    const sections = variantSections(texts.get(target.path)!);
    assert.equal(sections[0].entries[0].raw, raw);
    assert.equal(sections[1].entries.length, 0);
    assert.ok(texts.get(target.path)!.endsWith("# 经历\n保留记录\n"));
    assert.deepEqual(writes, [target.path, source.path]);
  }
});

test("moving local Markdown and wiki images rebases references without moving attachments", async () => {
  for (const [raw, expected] of [
    ["- [表情](./photo.webp)", "- [表情](<../../project/characters/photo.webp>)"],
    ["![[./photo.webp|表情]]", "![[project/characters/photo.webp|表情]]"],
  ]) {
    const { library, source, target, texts, group } = moveSetup(raw, "# 差分\n");
    const movedUrl = await library.moveVariant(source, variants(raw)[0], group());
    assert.equal(variants(texts.get(target.path)!)[0].raw, expected);
    assert.equal(movedUrl, variants(texts.get(target.path)!)[0].url);
    assert.equal(texts.get(source.path), "");
  }
});

test("same-file moves use one write and preserve nested headings and notes in either direction", async () => {
  for (const [from, to] of [[0, 2], [2, 0]]) {
    const original = "# 常服\n- [A](https://example.com/a.webp)\n\n备注 A\n## 细节\n备注 B\n# 冬装\n- [B](https://example.com/b.webp)\n";
    const { library, source, texts, writes, group } = moveSetup(original, "");
    const entry = variantSections(original)[from].entries[0];
    await library.moveVariant(source, entry, group(source, to));
    const sections = variantSections(texts.get(source.path)!);
    assert.deepEqual(sections.map(s => s.title), ["常服", "细节", "冬装"]);
    assert.equal(sections[from].entries.length, 0);
    assert.equal(sections[to].entries.at(-1)!.raw, entry.raw);
    assert.ok(texts.get(source.path)!.includes("备注 A\n"));
    assert.ok(texts.get(source.path)!.includes("备注 B\n"));
    assert.deepEqual(writes, [source.path]);
  }
});

test("empty characters receive a default group while existing YAML and notes remain intact", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const targetText = "---\nanke-type: character\nname: B\n---\n\n角色备注";
  const { library, source, target, texts, group } = moveSetup(raw, targetText);
  await library.moveVariant(source, variants(raw)[0], group());
  assert.ok(texts.get(target.path)!.startsWith(targetText));
  assert.equal(variantSections(texts.get(target.path)!)[0].title, "默认");
  assert.equal(variants(texts.get(target.path)!)[0].raw, raw);
});

test("stale source or target snapshots reject moves before either file changes", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  for (const stale of ["source", "target"]) {
    const { library, source, target, texts, writes, group } = moveSetup(raw, "# 常服\n");
    const destination = group();
    texts.set(stale === "source" ? source.path : target.path, "New note\n\n" + texts.get(stale === "source" ? source.path : target.path));
    const before = new Map(texts);
    await assert.rejects(library.moveVariant(source, variants(raw)[0], destination), /已修改|已改变/);
    assert.deepEqual(texts, before);
    assert.deepEqual(writes, []);
  }
});

test("target write failures never remove the source", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const { library, source, texts, group } = moveSetup(raw, "# 常服\n");
  library.app.vault.process = async () => { throw new Error("disk error"); };
  await assert.rejects(library.moveVariant(source, variants(raw)[0], group()), /disk error/);
  assert.equal(texts.get(source.path), raw);
});

test("source edits during a cross-file move are kept and the destination copy is reported", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const { library, source, target, texts, group } = moveSetup(raw, "# 常服\n");
  const process = library.app.vault.process;
  library.app.vault.process = async (file, change) => {
    const result = await process(file, change);
    if (file.path === target.path) texts.set(source.path, raw.replace("微笑", "新描述"));
    return result;
  };
  await assert.rejects(library.moveVariant(source, variants(raw)[0], group()), /已写入.*来源未能移除/);
  assert.equal(texts.get(source.path), raw.replace("微笑", "新描述"));
  assert.equal(variants(texts.get(target.path)!)[0].raw, raw);
});

test("an unclosed code block in the destination rejects insertion without deleting the source", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const { library, source, target, texts, group } = moveSetup(raw, "# 常服\n```md\ncode");
  const before = new Map(texts);
  await assert.rejects(library.moveVariant(source, variants(raw)[0], group()), /无法识别新增差分/);
  assert.deepEqual(texts, before);
});


test("moves read and update open editor buffers through native transactions", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const { library, source, target, texts, group } = moveSetup("# 常服\n" + raw, "# 冬装\n");
  const destination = group();
  const edits: string[] = [];
  const toOffset = (text: string, pos: { line: number; ch: number }) =>
    text.split("\n").slice(0, pos.line).reduce((total, line) => total + line.length + 1, 0) + pos.ch;
  library.editor = (file) => ({
    editor: {
      getValue: () => texts.get(file.path)!,
      offsetToPos: (offset: number) => {
        const lines = texts.get(file.path)!.slice(0, offset).split("\n");
        return { line: lines.length - 1, ch: lines.at(-1)!.length };
      },
      transaction: ({ changes }: any) => {
        let text = texts.get(file.path)!;
        for (const change of changes)
          text = text.slice(0, toOffset(text, change.from)) + change.text + text.slice(toOffset(text, change.to));
        texts.set(file.path, text);
        edits.push(file.path);
      },
    },
  } as any);
  library.app.vault.read = async () => { throw new Error("Must read the open editor"); };
  library.app.vault.process = async () => { throw new Error("Must update the open editor"); };
  texts.set(source.path, "# 常服\n" + raw + "\n\nUnsaved source note");
  texts.set(target.path, "# 冬装\nUnsaved target note");
  await library.moveVariant(source, variants(texts.get(source.path)!)[0], destination);
  assert.equal(variants(texts.get(source.path)!).length, 0);
  assert.equal(variants(texts.get(target.path)!)[0].raw, raw);
  assert.ok(texts.get(source.path)!.includes("Unsaved source note"));
  assert.ok(texts.get(target.path)!.includes("Unsaved target note"));
  assert.deepEqual(edits, [target.path, source.path]);
});


test("moving into a CRLF character file preserves its newline style", async () => {
  const raw = "[微笑](https://example.com/a.webp)";
  const { library, source, target, texts, group } = moveSetup(raw, "# 常服\r\n备注\r\n\r\n# 经历\r\n正文\r\n");
  await library.moveVariant(source, variants(raw)[0], group());
  assert.equal(variants(texts.get(target.path)!)[0].raw, raw);
  assert.ok(!/(?<!\r)\n/.test(texts.get(target.path)!));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mapLinkDestinations,
  resizeVariant,
  appendVariant,
  variantSections,
  completion,
  dialogueChanges,
  editVariant,
  editAndPromoteVariant,
  deleteVariant,
  markdownLink,
  reorderVariant,
  reorderVariantSection,
  segmentAt,
  segments,
  stripTiming,
  timingTags,
  variants,
  wrapSegment,
} from "../src/document";
import { toBBCode } from "../src/export";

test("real thematic breaks split sections; YAML, code and setext headings do not", () => {
  const text =
    '---\nname: demo\n---\n\nHeading\n---\n\nfirst\n\n```md\n---\n```\n\n---\n<!-- anke-section: "Second" -->\n\nsecond';
  assert.equal(segments(text).length, 2);
  assert.equal(segmentAt(text, text.length).title, "Second");
});
test("named separators do not need literal braces or persistent segment IDs", () => {
  const text = 'One\n\n---\n<!-- anke-section: "重逢" -->\n\nTwo';
  assert.equal(segments(text)[1].title, "重逢");
});
test("timing export strips only actual wrappers and retains the current body", () => {
  const text =
    '[timingpost time="2030-01-01T00:00:00Z" task="abc"]\n**New**\n[/timingpost]';
  assert.equal(timingTags(text)[0].attrs.task, "abc");
  assert.equal(toBBCode(text), "[b]New[/b]");
  assert.equal(stripTiming("```\n" + text + "\n```"), "```\n" + text + "\n```");
});
test("publishing wrappers cannot silently span split sections or omit adjacent prose", () => {
  assert.throws(
    () => timingTags('[timingpost task="x"]\nOne\n\n---\n\nTwo\n[/timingpost]'),
    /一个分节/,
  );
  assert.throws(
    () => timingTags('outside\n\n[timingpost task="x"]\ninside\n[/timingpost]'),
    /完整分节/,
  );
  assert.throws(() => timingTags('[timingpost task="x"]\ntext'), /缺少/);
  assert.throws(
    () => timingTags('[timingpost task="x" task="y"]\ntext\n[/timingpost]'),
    /重复/,
  );
});
test("schedule creation keeps the segment prose exactly once", () => {
  const text = "Hello";
  const wrapped = wrapSegment(text, segmentAt(text, 0), {
    task: "x",
    time: "2030-01-01T00:00:00Z",
  });
  assert.equal(timingTags(wrapped)[0].body, text);
  assert.throws(
    () => wrapSegment(wrapped, segmentAt(wrapped, 0), { task: "y" }),
    /已有/,
  );
});
test("variant captions allow empty values and links containing parentheses", () => {
  const text =
    "---\nanke-type: variants\n---\n\n- [](https://example.com/blank.png)\n- [smile](<https://example.com/(one).png>)";
  const rows = variants(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "");
  assert.equal(variants(editVariant(text, rows[1], ""))[1].label, "");
  assert.equal(
    variants("- " + markdownLink("a[b]", rows[1].url))[0].label,
    "a[b]",
  );
});
test("standalone image links need neither a list marker nor a caption prefix", () => {
  const url = "https://img.nga.cn/attachments/mon_202606/25/example.WEBP?size=2#preview";
  for (const [line, label] of [
    [url, url],
    [`<${url}>`, url],
    [`[微笑](${url})`, "微笑"],
    [`[](${url})`, ""],
    [`![微笑](${url})`, "微笑"],
  ]) {
    const text = `# 常服\r\n  ${line}  \r\n`;
    const rows = variants(text);
    assert.equal(rows.length, 1, line);
    assert.equal(rows[0].url, url);
    assert.equal(rows[0].label, label);
    assert.equal(text.slice(rows[0].from, rows[0].to), rows[0].raw);
    assert.equal(variantSections(text)[0].entries.length, 1);
  }
});
test("adjacent bare image URLs can be reordered, edited and deleted without altering notes", () => {
  const a = "https://example.com/a.webp";
  const b = "https://example.com/b.png?size=2";
  const text = `# 常服\r\n${a}\r\n${b}\r\n\r\nNotes\r\n`;
  const rows = variants(text);
  assert.deepEqual(rows.map((row) => row.url), [a, b]);
  const moved = reorderVariant(text, rows[0], rows[1]);
  assert.equal(moved, `# 常服\r\n${b}\r\n${a}\r\n\r\nNotes\r\n`);
  const edited = editVariant(text, rows[0], "微笑");
  assert.equal(edited, `# 常服\r\n- [微笑](<${a}>)\r\n${b}\r\n\r\nNotes\r\n`);
  assert.deepEqual(variants(edited).map((row) => row.url), [a, b]);
  assert.equal(deleteVariant(text, rows[0]), `# 常服\r\n${b}\r\n\r\nNotes\r\n`);
});
test("caption-colon catalogs accept NGA Markdown links and bare URLs on adjacent lines", () => {
  const a =
    "https://img.nga.cn/attachments/mon_202606/25/example-a.webp";
  const b =
    "https://img.nga.cn/attachments/mon_202606/25/example-b.webp";
  for (const text of [
    `平淡直视:[${a}](${a})\n腼腆拘谨:[${b}](${b})`,
    `平淡直视:${a}\n腼腆拘谨： ${b}`,
    `- 平淡直视:<${a}>\n- 腼腆拘谨：[图片](${b})`,
  ]) {
    const rows = variants(text);
    assert.deepEqual(
      rows.map((r) => [r.label, r.url]),
      [
        ["平淡直视", a],
        ["腼腆拘谨", b],
      ],
    );
    for (const row of rows) assert.equal(text.slice(row.from, row.to), row.raw);
  }
});
test("caption editing keeps colons, URL spelling, CRLF and adjacent rows intact", () => {
  const text =
    "平淡直视: https://example.com/a.webp\r\n腼腆拘谨：[链接](https://example.com/b.webp)\r\n";
  const edited = editVariant(text, variants(text)[0], "微笑[闭眼]");
  assert.equal(variants(edited)[0].label, "微笑[闭眼]");
  assert.ok(edited.endsWith(text.slice(text.indexOf(": "))));
  let cleared = text;
  for (const row of variants(text).reverse())
    cleared = editVariant(cleared, row, "");
  assert.equal(
    cleared,
    ": https://example.com/a.webp\r\n：[链接](https://example.com/b.webp)\r\n",
  );
  assert.deepEqual(
    variants(cleared).map((r) => r.label),
    ["", ""],
  );
  assert.throws(
    () =>
      editVariant(text.replace("平淡", "微笑"), variants(text)[0], "edited"),
    /已修改/,
  );
});
test("mixed list and colon rows remain distinct when reordered without blank lines", () => {
  const text =
    "# Catalog\n\n- [A](https://example.com/a)\nB:https://example.com/b\nC:[c](https://example.com/c)\n\nNotes";
  const rows = variants(text);
  assert.equal(rows.length, 3);
  const moved = reorderVariant(text, rows[0], rows[2]);
  assert.deepEqual(
    variants(moved).map((r) => [r.label, r.url]),
    [
      ["B", "https://example.com/b"],
      ["C", "https://example.com/c"],
      ["A", "https://example.com/a"],
    ],
  );
  assert.ok(moved.startsWith("# Catalog\n\n"));
  assert.ok(moved.endsWith("\n\nNotes"));
});
test("catalog parsing excludes metadata, code examples, headings and multi-link prose", () => {
  const text = [
    "---",
    "example: https://example.com/yaml",
    "---",
    "",
    "```",
    "code:https://example.com/code",
    "```",
    "",
    "`inline`:https://example.com/inline",
    "",
    "# heading:https://example.com/heading",
    "",
    "first:https://example.com/one second:https://example.com/two",
    "",
    "```md",
    "https://example.com/code.webp",
    "```",
    "",
    "`https://example.com/inline.webp`",
    "",
    "# https://example.com/heading.webp",
    "",
    "    https://example.com/indented.webp",
    "",
    "https://example.com/a.webp https://example.com/b.webp",
    "",
    "See https://example.com/prose.webp",
    "",
    "https://example.com/trailing.webp more text",
    "",
    "description:https://example.com/real",
  ].join("\n");
  assert.deepEqual(
    variants(text).map((r) => r.label),
    ["description"],
  );
});
test("variant writes detect intervening manual edits rather than overwriting them", () => {
  const text = "- [old](https://example.com/a)";
  assert.throws(
    () => editVariant(text.replace("old", "new"), variants(text)[0], "edited"),
    /已修改/,
  );
});
test("reordering moves descriptions together with their image URLs and preserves unrelated prose", () => {
  const text =
    "# Variants\n\n- [A](https://example.com/a)\n- [B](https://example.com/b)\n- [C](https://example.com/c)\n\nNotes";
  const rows = variants(text),
    moved = reorderVariant(text, rows[0], rows[2]);
  assert.deepEqual(
    variants(moved).map((v) => [v.label, v.url]),
    [
      ["B", "https://example.com/b"],
      ["C", "https://example.com/c"],
      ["A", "https://example.com/a"],
    ],
  );
  assert.ok(moved.endsWith("Notes"));
});
test("colors affect quotation interiors only, preserve Markdown, and skip code and URLs", () => {
  const text =
    '“**Hello**” 「世界」 『您好』 "Hi" `"code"` [x](https://example.com "title")';
  const changes = dialogueChanges(text, 0, text.length, "#abcdef");
  assert.equal(changes.length, 4);
  assert.equal(changes[0].insert, "[color=skyblue]**Hello**[/color]");
  assert.equal(text[changes[0].from - 1], "“");
  assert.equal(text[changes[0].to], "”");
});
test("recoloring replaces an existing color rather than nesting it", () => {
  const text = "“[color=red]Hello[/color]”";
  assert.equal(
    dialogueChanges(text, 0, text.length, "blue")[0].insert,
    "[color=blue]Hello[/color]",
  );
});
test("Tab completion is explicit, local, and avoids code, YAML, wiki-links and existing closers", () => {
  assert.equal(completion("[quo", 4)?.insert, "[quote][/quote]");
  assert.equal(completion("[quote]", 7)?.insert, "[quote][/quote]");
  assert.equal(
    completion("[collapse=title]", 16)?.insert,
    "[collapse=title][/collapse]",
  );
  for (const [text, caret] of [
    ["`[quo`", 5],
    ["[[quo", 5],
    ["[quote][/quote]", 7],
    ["[quote](https://a)", 7],
    ["---\nfoo: [quo\n---", 12],
  ] as const)
    assert.equal(completion(text, caret), null, text);
});
test("Markdown converts recursively inside block quotes and retains manual BBCode", () => {
  const text =
    "> **Bold** and *italic*\n>\n> - item\n> - [link](https://example.com)\n\n[collapse=test]hello[/collapse]\n\n[dice]1d100[/dice]";
  assert.equal(
    toBBCode(text),
    "[quote][b]Bold[/b] and [i]italic[/i]\n\n[list]\n[*]item\n[*][url=https://example.com]link[/url]\n[/list][/quote]\n\n[collapse=test]hello[/collapse]\n\n[dice]1d100[/dice]",
  );
});
test("export rejects local images instead of silently sending broken resources", () => {
  assert.throws(() => toBBCode("![](assets/local.png)"), /先上传/);
  assert.equal(
    toBBCode("![alt](https://example.com/a.png)"),
    "[img]https://example.com/a.png[/img]",
  );
});
test("Markdown paragraphs preserve one blank line, not HTML copy spacing", () =>
  assert.equal(toBBCode("one\n\ntwo"), "one\n\ntwo"));

test("chapter YAML stays outside publishing wrappers and BBCode exports", () => {
  const header = '---\nanke-type: chapter\ntitle: "Chapter metadata"\n---';
  const text = header + "\n\n“Hello”\n\n---\n\nSecond section";
  const section = segmentAt(text, text.indexOf("Hello"));
  const scheduled =
    text.slice(0, section.from) +
    wrapSegment(text, section, {
      task: "chapter-yaml",
      time: "2030-01-01T00:00:00Z",
    }) +
    text.slice(section.to);
  assert.ok(scheduled.startsWith(header + "\n\n[timingpost"));
  assert.equal(timingTags(scheduled)[0].body, "“Hello”");
  assert.equal(segments(scheduled).length, 2);
  assert.equal(toBBCode(scheduled), toBBCode(text));
  assert.ok(!toBBCode(scheduled).includes("anke-type"));
  assert.ok(!toBBCode(scheduled).includes("Chapter metadata"));
});

test("single-file character headings own their rows, including nested and duplicate headings", () => {
  const text =
    "---\nanke-type: character\n---\n\n# 常服\n- [A](https://e.test/a.png)\n\n# 演出服\n## 站姿\n![[portrait.png|微笑]]\n\n# 常服\n\n```md\n# Not a group\n![[code.png]]\n```\n";
  const sections = variantSections(text);
  assert.deepEqual(
    sections.map((s) => s.path),
    ["常服", "演出服", "演出服 / 站姿", "常服"],
  );
  assert.equal(new Set(sections.map((s) => s.key)).size, 4);
  assert.equal(sections[2].parentKey, sections[1].key);
  assert.equal(sections[2].depth, 2);
  assert.equal(sections[2].title, "站姿");
  assert.deepEqual(
    sections.map((s) => s.entries.map((v) => v.label)),
    [["A"], [], ["微笑"], []],
  );
  const inserted = appendVariant(
    text,
    sections[0].key,
    markdownLink("", "https://e.test/b.png"),
  );
  assert.ok(inserted.indexOf("b.png") < inserted.indexOf("# 演出服"));
  assert.equal(variantSections(inserted)[0].entries.length, 2);
  assert.equal(variantSections(inserted)[2].entries[0].label, "微笑");
  assert.throws(
    () => appendVariant(text, "missing", "[x](x.png)"),
    /标题已改变/,
  );
  assert.throws(
    () => reorderVariant(text, sections[0].entries[0], sections[2].entries[0]),
    /同一差分组/,
  );
});
test("native embeds and wiki links support caption edits while code and ordinary notes are excluded", () => {
  const text =
    "# 常服\n![[附件/portrait.png|200]]\n- [[附件/a.webp|]]\n![微笑](<附件/a (1).png>)\n\n[[普通笔记]]\n\n```md\n![[example.png]]\n```\n";
  const rows = variants(text);
  assert.deepEqual(
    rows.map((r) => r.label),
    ["portrait", "", "微笑"],
  );
  assert.deepEqual(
    rows.map((r) => r.image),
    [true, false, true],
  );
  for (const row of rows) {
    const changed = editVariant(text, row, "新[描述]");
    assert.ok(
      variants(changed).some(
        (r) => r.label === "新[描述]" && r.url === row.url,
      ),
    );
    assert.ok(changed.includes("![[example.png]]"));
  }
  assert.throws(() => toBBCode("![[附件/a.png|100]]"), /先上传/);
  assert.equal(toBBCode("`![[附件/a.png]]`"), "[code]![[附件/a.png]][/code]");
});

test("moving character notes rebases destinations while preserving captions, titles, definitions and code", () => {
  const text =
    '- [**Bold**](<old/a b.png> "a title")\n![a\\]b](old/a\\(1\\).png)\n\n[ref]: old/target.md "title"\n\n![[old/local.png|200]]\n\n```md\n[code](old/code.png)\n```';
  const actual = mapLinkDestinations(text, (url) =>
    url.replace("old/", "new/"),
  );
  assert.equal(
    actual,
    '- [**Bold**](<new/a b.png> "a title")\n![a\\]b](<new/a(1).png>)\n\n[ref]: <new/target.md> "title"\n\n![[new/local.png|200]]\n\n```md\n[code](old/code.png)\n```',
  );
});

test("empty outline parents accept an image before child headings and retain note text", () => {
  const text =
    "# Notes\nKeep notes.\n\n### Relationship\nNo images here.\n\n# Pictures\n![Smile](smile.png)";
  const sections = variantSections(text);
  assert.deepEqual(
    sections.map((s) => [s.title, s.depth]),
    [
      ["Notes", 1],
      ["Relationship", 3],
      ["Pictures", 1],
    ],
  );
  assert.equal(sections[1].parentKey, sections[0].key);
  const changed = appendVariant(text, sections[0].key, "[New](new.png)");
  assert.ok(changed.indexOf("[New]") < changed.indexOf("### Relationship"));
  assert.ok(changed.includes("Keep notes."));
  assert.ok(changed.endsWith("# Pictures\n![Smile](smile.png)"));
});
test("image ordering leaves interleaved note links at their original positions", () => {
  const text =
    "# Pictures\n- [A](a.png)\n- [Reference](notes.md)\n- [B](b.png)";
  const rows = variants(text);
  assert.equal(
    reorderVariant(text, rows[0], rows[2], [rows[0], rows[2]]),
    "# Pictures\n- [B](b.png)\n- [Reference](notes.md)\n- [A](a.png)",
  );
});

test("group sorting moves complete sibling subtrees and retains YAML, notes, and code", () => {
  const prefix = "---\nanke-type: character\n---\n\nIntro.\n\n";
  const a =
    "# A\n- [A](a.png)\nKeep notes.\n\n## Detail\n```md\n# Example\n```\n\n";
  const b = "# B\nNotes without images.\n\n## Child\n![B](b.png)\n\n";
  const c = "# C\n- [C](c.png)";
  const text = prefix + a + b + c;
  const groups = variantSections(text);
  const moved = reorderVariantSection(text, groups[0], groups[4], true);
  assert.equal(moved.text, prefix + b + c + "\n\n" + a);
  assert.deepEqual(moved.keyChanges, []);
  const reversed = reorderVariantSection(text, groups[4], groups[0], false);
  assert.equal(reversed.text, prefix + c + "\n\n" + a + b);
  assert.deepEqual(
    variantSections(moved.text).map((g) => g.path),
    ["B", "B / Child", "C", "A", "A / Detail"],
  );
});

test("group sorting respects parents, heading levels, stale positions, and default groups", () => {
  const text =
    "- [Intro](intro.png)\n\n# A\n## One\n[A](a.png)\n## Two\n[B](b.png)\n# B\n## Three\n[C](c.png)";
  const groups = variantSections(text);
  const moved = reorderVariantSection(text, groups[2], groups[3], true);
  assert.deepEqual(
    variantSections(moved.text).map((g) => g.path),
    ["默认", "A", "A / Two", "A / One", "B", "B / Three"],
  );
  for (const [a, b] of [
    [2, 5],
    [1, 2],
    [0, 1],
  ])
    assert.throws(
      () => reorderVariantSection(text, groups[a], groups[b], false),
      /同级/,
    );
  assert.throws(
    () => reorderVariantSection("Extra.\n" + text, groups[2], groups[3], false),
    /已改变/,
  );
  assert.equal(
    reorderVariantSection(text, groups[2], groups[3], false).text,
    text,
  );
});

test("group sorting remaps duplicate heading keys and preserves CRLF and setext headings", () => {
  const a = "# Same\r\n[A](a.png)\r\n## Child\r\nNotes A\r\n\r\n";
  const b = "Same\r\n====\r\n[B](b.png)\r\n## Child\r\nNotes B";
  const text = a + b;
  const sections = variantSections(text);
  const result = reorderVariantSection(text, sections[2], sections[0], false);
  assert.equal(result.text, b + "\r\n\r\n" + a);
  const keys = new Map(result.keyChanges);
  assert.equal(keys.get(sections[0].key), sections[2].key);
  assert.equal(keys.get(sections[2].key), sections[0].key);
  assert.equal(keys.get(sections[1].key), sections[3].key);
});

test("group sorting refuses to swallow following headings in an unclosed code fence", () => {
  const text = "# A\n[A](a.png)\n\n# B\n```md\nUnfinished";
  const groups = variantSections(text);
  assert.throws(
    () => reorderVariantSection(text, groups[1], groups[0], false),
    /Markdown 标题结构/,
  );
});

test("deleting a variant removes only its line and retains headings, notes, and other references", () => {
  for (const newline of ["\n", "\r\n"]) {
    for (const line of [
      "- [Smile](a.png)",
      "微笑：[链接](a.png)",
      "![[a.png|微笑]]",
    ]) {
      const before = [
        "---",
        "anke-type: character",
        "---",
        "",
        "# Outfit",
        "Keep notes.",
        "",
      ].join(newline);
      const after = [
        "- [Another](a.png)",
        "",
        "## Notes",
        "Keep this too.",
      ].join(newline);
      const text = before + line + "  " + newline + after;
      assert.equal(deleteVariant(text, variants(text)[0]), before + after);
      const last = before + line;
      assert.equal(deleteVariant(last, variants(last)[0]), before);
    }
  }
});

test("variant deletion rejects edited, moved, or no-longer-standalone source lines", () => {
  const text = "# Group\n- [Old](a.png)\nKeep notes.\n";
  const entry = variants(text)[0];
  for (const changed of [
    text.replace("Old", "New"),
    "Intro\n" + text,
    text.replace("(a.png)", "(a.png) additional notes"),
  ])
    assert.throws(() => deleteVariant(changed, entry), /已修改/);
  assert.equal(deleteVariant(text, entry), "# Group\nKeep notes.\n");
});

test("dragging commits the displayed usage order while leaving notes in their source slots", () => {
  const text =
    "# Outfit\n- [A](a.png)\n- [Reference](notes.md)\n- [B](b.png)\nNotes.\n- [C](c.png)\n- [D](d.png)\n";
  const all = variants(text);
  const [a, , b, c, d] = all;
  const displayed = [c, a, b, d];
  const changed = reorderVariant(text, d, a, displayed);
  assert.equal(
    changed,
    "# Outfit\n- [C](c.png)\n- [Reference](notes.md)\n- [D](d.png)\nNotes.\n- [A](a.png)\n- [B](b.png)\n",
  );
  assert.throws(
    () => reorderVariant(text.replace("[B]", "[X]"), d, a, displayed),
    /已改变/,
  );
});

test("editing a variant promotes it and preserves the other displayed rows and notes", () => {
  const text =
    "# Main\n- [A](a.png)\n- [reference](note.md)\n- [B](b.png)\nKeep this note.\n\n- [C](c.png)\n- [D](d.png)\n\n# Other\n- [E](e.png)\n";
  const rows = variants(text).filter((row) => /[abcd]\.png/.test(row.url));
  const displayed = [rows[0], rows[2], rows[1], rows[3]];
  const result = editAndPromoteVariant(text, rows[1], "Renamed B", displayed);
  assert.deepEqual(
    variants(result.text).map((row) => [row.label, row.url]),
    [
      ["Renamed B", "b.png"],
      ["reference", "note.md"],
      ["A", "a.png"],
      ["C", "c.png"],
      ["D", "d.png"],
      ["E", "e.png"],
    ],
  );
  assert.ok(result.text.includes("Keep this note."));
  assert.ok(result.text.endsWith("# Other\n- [E](e.png)\n"));
  assert.equal(result.entry.from, rows[0].from);
  assert.equal(result.entry.label, "Renamed B");
  assert.equal(result.entry.url, "b.png");
  const deleted = deleteVariant(result.text, result.entry);
  assert.deepEqual(
    variants(deleted).map((row) => row.url),
    ["note.md", "a.png", "c.png", "d.png", "e.png"],
  );
});

test("editing the displayed first row commits the usage order even when source order differs", () => {
  const text = "# Main\n- [A](a.png)\n- [B](b.png)\n- [C](c.png)\n";
  const rows = variants(text);
  const result = editAndPromoteVariant(text, rows[2], "", [
    rows[2],
    rows[0],
    rows[1],
  ]);
  assert.deepEqual(
    variants(result.text).map((row) => [row.label, row.url]),
    [
      ["", "c.png"],
      ["A", "a.png"],
      ["B", "b.png"],
    ],
  );
  assert.equal(result.entry.label, "");
  assert.equal(result.entry.url, "c.png");
});

test("edit and promote handles wiki and colon catalogs and rejects stale group snapshots", () => {
  const text =
    "# Main\r\n- [[a.png|A]]\r\n描述:[图片](https://e.test/b.png)\r\n- ![[c.png|C]]\r\n";
  const rows = variants(text);
  const result = editAndPromoteVariant(text, rows[2], "改名", rows);
  assert.deepEqual(
    variants(result.text).map((row) => [row.label, row.url]),
    [
      ["改名", "c.png"],
      ["A", "a.png"],
      ["描述", "https://e.test/b.png"],
    ],
  );
  assert.ok(!result.text.replaceAll("\r\n", "").includes("\n"));
  assert.throws(
    () =>
      editAndPromoteVariant(
        text.replace("描述", "名称"),
        rows[2],
        "Renamed",
        rows,
      ),
    /差分内容已改变/,
  );
});


test("NGA relative variants support bare paths, captions, Markdown, and image tags", () => {
  const url = "./mon_202610/05/example.webp.thumb_s.jpg?x=1#part";
  const absolute = "https://img.nga.cn/attachments/" + url.slice(2);
  for (const [line, label] of [
    [url, url], [`平静：${url}`, "平静"], [`- 微笑: ${url}`, "微笑"],
    [`[说明](${url})`, "说明"], [`![笑](${url})`, "笑"],
    [`[img]${url}[/img]`, url], [`平静：[img]${url}[/img]`, "平静"],
    [`[img]${absolute}[/img]`, absolute],
  ]) {
    const text = `# 常服\r\n${line}  \r\n\r\n备注\r\n`;
    const rows = variants(text);
    assert.equal(rows.length, 1, line);
    assert.equal(rows[0].label, label);
    assert.equal(rows[0].url, line.includes(absolute) ? absolute : url);
    assert.equal(text.slice(rows[0].from, rows[0].to), rows[0].raw);
    assert.equal(variantSections(text)[0].entries.length, 1);
    const resized = resizeVariant(text, rows[0], "thumb");
    assert.equal(variants(resized)[0].url, absolute.replace("thumb_s", "thumb"));
    assert.ok(resized.endsWith("  \r\n\r\n备注\r\n"));
    const edited = editVariant(text, rows[0], "新描述");
    assert.equal(variants(edited)[0].label, "新描述");
    assert.equal(deleteVariant(text, rows[0]), "# 常服\r\n\r\n备注\r\n");
  }
});

test("relative NGA recognition excludes notes, incomplete tags, local files, and code", () => {
  const url = "./mon_202610/05/example.webp";
  for (const text of [
    `---\nimage: ${url}\n---`, `# ${url}`, `    ${url}`, "`" + url + "`",
    `\`\`\`md\n${url}\n\`\`\``, `说明 ${url}`, `${url} 备注`,
    `[img]${url}`, `${url}[/img]`, `\`说明\`: ${url}`, `./local.webp`,
    `./mon_202610/05/note.md`, `[链接](https://example.com):${url}`,
  ]) assert.equal(variants(text).length, 0, text);
  const text = `# 常服\n${url}\n平静：[img]${url}.thumb.jpg[/img]\n`;
  const [first, second] = variants(text);
  assert.equal(reorderVariant(text, first, second), `# 常服\n平静：[img]${url}.thumb.jpg[/img]\n${url}\n`);
});

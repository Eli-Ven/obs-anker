import test from "node:test";
import assert from "node:assert/strict";
import { contextQuote } from "../src/punctuation";

function type(text: string, input: string) {
  const caret = text.indexOf("|"),
    source = text.replace("|", "");
  const result = contextQuote(source, caret, caret, input);
  assert.ok(result);
  const output = source.slice(0, caret) + result.insert + source.slice(caret);
  return output.slice(0, result.head) + "|" + output.slice(result.head);
}

test("either quote direction starts a pair outside dialogue and skips an existing closer", () => {
  for (const [left, right] of ["“”", "‘’", "「」", "『』"]) {
    for (const input of [left, right]) {
      assert.equal(type("|", input), left + "|" + right);
      assert.equal(
        type(left + "你好|" + right, input),
        left + "你好" + right + "|",
      );
      assert.equal(
        type(left + "第一句" + right + "\n|", input),
        left + "第一句" + right + "\n" + left + "|" + right,
      );
      assert.equal(
        type(left + "没结束|", input),
        left + "没结束" + right + "|",
      );
    }
  }
});

test("paragraph context follows text after edits and handles nested quote types", () => {
  assert.equal(type("“跨行\n对白|", "“"), "“跨行\n对白”|");
  assert.equal(type("“上段没有结尾\n\n|", "”"), "“上段没有结尾\n\n“|”");
  assert.equal(type("“外层|”", "’"), "“外层‘|’”");
  assert.equal(type("“‘内部’接着|”", "“"), "“‘内部’接着”|");
  assert.equal(type("“旧句”\n\n新句|后文", "”"), "“旧句”\n\n新句“|”后文");
});

test("right quotes wrap a selected phrase with the corresponding pair", () => {
  assert.deepEqual(contextQuote("前你好后", 1, 3, "”"), {
    insert: "“你好”",
    anchor: 2,
    head: 4,
  });
  assert.deepEqual(contextQuote("前你好后", 1, 3, "』"), {
    insert: "『你好』",
    anchor: 2,
    head: 4,
  });
});

test("code, frontmatter, links and escaped quotes remain literal", () => {
  for (const marked of [
    "`a|b`",
    "```\n|\n```",
    "---\nname: |\n---",
    "[a|b](https://example.com)",
    "[a](https://example.com/|)",
    "<!-- | -->",
    "\\|",
  ]) {
    const caret = marked.indexOf("|"),
      text = marked.replace("|", "");
    assert.equal(contextQuote(text, caret, caret, "”"), undefined, marked);
  }
  assert.equal(contextQuote("text", 0, 4, "“多字”"), undefined);
  assert.equal(contextQuote("", 0, 0, '"'), undefined);
  assert.equal(
    type("`“code` [“link](https://example.com) |", "”"),
    "`“code` [“link](https://example.com) “|”",
  );
});

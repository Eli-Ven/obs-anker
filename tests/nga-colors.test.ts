import test from "node:test";
import assert from "node:assert/strict";
import { NGA_COLORS, toNGAColor } from "../src/nga-colors";
import { dialogueChanges } from "../src/document";
import { toBBCode } from "../src/export";

test("the NGA palette exports only its 24 canonical color names", () => {
  assert.equal(NGA_COLORS.length, 24);
  assert.equal(new Set(NGA_COLORS.map((color) => color.name)).size, 24);
  for (const color of NGA_COLORS) {
    assert.equal(toNGAColor(" " + color.name.toUpperCase() + " "), color.name);
    assert.equal(toNGAColor(color.hex), color.name);
    assert.equal(
      toBBCode(`[color=${color.name}]text[/color]`),
      `[color=${color.name}]text[/color]`,
    );
  }
});

test("legacy RGB colors map to named colors for both new dialogue and export", () => {
  assert.equal(toNGAColor("#f00"), "red");
  assert.equal(toNGAColor("#87CEEB"), "skyblue");
  assert.equal(toNGAColor("#86cfea"), "skyblue");
  assert.equal(toNGAColor("#abcdef"), "skyblue");
  const source = "“[color=#87ceeb]**Hello**[/color]”";
  assert.equal(toBBCode(source), "“[color=skyblue][b]Hello[/b][/color]”");
  assert.equal(source, "“[color=#87ceeb]**Hello**[/color]”");
  assert.equal(
    dialogueChanges("“Hello”", 0, 7, "#87ceeb")[0].insert,
    "[color=skyblue]Hello[/color]",
  );
  assert.equal(
    toBBCode("[COLOR=SKYBLUE]Hello[/COLOR]"),
    "[color=skyblue]Hello[/COLOR]",
  );
});

test("unsupported names and malformed RGB stop export before reaching NGA", () => {
  for (const color of [
    "banana",
    "yellow",
    "#12345",
    "#12345678",
    "rgb(1, 2, 3)",
    "red;background:url(x)",
  ]) {
    assert.throws(() => toNGAColor(color), /NGA 不支持颜色/);
    assert.throws(
      () => toBBCode(`[color=${color}]text[/color]`),
      /NGA 不支持颜色/,
    );
  }
});

test("color examples in Markdown and raw BBCode code blocks remain literal", () => {
  assert.equal(
    toBBCode("`[color=#abcdef]x[/color]`"),
    "[code][color=#abcdef]x[/color][/code]",
  );
  assert.equal(
    toBBCode("```text\n[color=banana]x[/color]\n```"),
    "[code][color=banana]x[/color][/code]",
  );
  assert.equal(
    toBBCode(
      "[code][color=banana]x[/color][/code] [color=#f00]outside[/color]",
    ),
    "[code][color=banana]x[/color][/code] [color=red]outside[/color]",
  );
  assert.equal(
    toBBCode("[code]\n\n[color=banana]example[/color]\n\n[/code]"),
    "[code]\n\n[color=banana]example[/color]\n\n[/code]",
  );
});

function colorDialogue(
  text: string,
  color: string,
  from = 0,
  to = text.length,
): string {
  for (const change of dialogueChanges(text, from, to, color).reverse())
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}

test("applying the same dialogue color twice removes only its tags", () => {
  const original =
    '叙述 [color=red]不变[/color] “**Hello**” 「世界」 『您好』 "Hi"';
  const colored = colorDialogue(original, "skyblue");
  assert.notEqual(colored, original);
  assert.equal(colorDialogue(colored, "skyblue"), original);
  assert.equal(
    colorDialogue(colorDialogue(colored, "skyblue"), "skyblue"),
    colored,
  );
});

test("mixed dialogue colors first become uniform, then clear together", () => {
  const original =
    "“[color=red]红[/color]” 「无色」 『[color=blue]蓝[/color]』";
  const colored =
    "“[color=red]红[/color]” 「[color=red]无色[/color]」 『[color=red]蓝[/color]』";
  assert.equal(colorDialogue(original, "red"), colored);
  assert.equal(colorDialogue(colored, "red"), "“红” 「无色」 『蓝』");
  assert.equal(
    colorDialogue("“[color=red]红[/color]”", "blue"),
    "“[color=blue]红[/color]”",
  );
});

test("clearing a selected dialogue preserves other lines, code and links", () => {
  const first = "“[color=red]第一行[/color]”";
  const rest =
    '\n“[color=blue]第二行[/color]”\n`“[color=red]code[/color]”`\n[link](https://example.com "title")';
  assert.equal(
    colorDialogue(first + rest, "red", 0, first.length),
    "“第一行”" + rest,
  );
  const protectedOnly =
    '`“[color=red]code[/color]”` [link](https://example.com "title")';
  assert.equal(colorDialogue(protectedOnly, "red"), protectedOnly);
});

test("legacy and uppercase colors toggle, while partial or invalid colors are repaired", () => {
  assert.equal(colorDialogue("“[COLOR=#F00]旧文[/COLOR]”", "red"), "“旧文”");
  assert.equal(
    colorDialogue("“[color=SKYBLUE]旧文[/color]”", "#87ceeb"),
    "“旧文”",
  );
  for (const original of [
    "“前[color=red]文[/color]”",
    "“[color=banana]前文[/color]”",
    "“[color=red]前[color=blue]文[/color][/color]”",
  ])
    assert.equal(colorDialogue(original, "red"), "“[color=red]前文[/color]”");
});

import test from "node:test";
import assert from "node:assert/strict";
import { absoluteNGAImageUrl, ngaImageSizeUrl, NGA_IMAGE_SIZES } from "../src/nga-images";
import { resizeVariant, variants } from "../src/document";
import { relativeNGAImages, toNGABBCode } from "../src/nga";

const path = "mon_202610/05/example.webp";
const original = `https://img.nga.cn/attachments/${path}`;
const thumb = original + ".thumb.jpg";
const relative = `./${path}.thumb.jpg`;
function mock(fail = false) {
  const calls: string[] = [];
  const check = async (url: string) => {
    calls.push(url);
    if (fail) throw new Error("Image unavailable");
  };
  return { calls, check };
}

test("all five sizes retain full URL and replace the real no-comma suffix", () => {
  for (const size of NGA_IMAGE_SIZES) {
    const suffix = size.value ? `.${size.value}.jpg` : "";
    assert.equal(
      ngaImageSizeUrl(thumb + "?x=1#part", size.value),
      original + suffix + "?x=1#part",
    );
  }
  assert.equal(
    ngaImageSizeUrl(
      original.replace("img.nga.cn", "img.nga.178.com"),
      "thumb_s",
    ),
    original.replace("img.nga.cn", "img.nga.178.com") + ".thumb_s.jpg",
  );
});

test("size menu only accepts NGA attachment image URLs", () => {
  for (const url of [
    "./local.webp",
    "https://example.com/attachments/" + path,
    original.replace("nga.cn", "nga.cn.evil.test"),
    original.replace("img.nga.cn", "user:password@img.nga.cn"),
    original.replace("img.nga.cn", "[broken"),
    original.replace("attachments", "avatars"),
    original + ".txt",
  ])
    assert.equal(ngaImageSizeUrl(url, "thumb"), null, url);
});

test("resizing writes full links and preserves labels, notes, and supported syntax", () => {
  for (const line of [
    original,
    `<${original}>`,
    `[微笑](${original} "title")`,
    `![微笑](${original})`,
    `平静:${original}`,
    `平静:[说明](${original})`,
  ]) {
    const text = `# 常服\n\n${line}\n\n备注\n`;
    const [entry] = variants(text);
    assert.ok(entry, line);
    const next = resizeVariant(text, entry, "thumb_s");
    assert.equal(variants(next)[0].url, original + ".thumb_s.jpg");
    assert.equal(
      variants(next)[0].label,
      entry.label === original ? original + ".thumb_s.jpg" : entry.label,
    );
    assert.ok(next.startsWith("# 常服\n\n") && next.endsWith("\n\n备注\n"));
    if (line.includes('"title"')) assert.ok(next.includes('"title"'));
    const restored = resizeVariant(next, variants(next)[0], "");
    assert.equal(variants(restored)[0].url, original);
  }
  const text = `[微笑](${original})`;
  assert.throws(
    () => resizeVariant("changed " + text, variants(text)[0], "thumb"),
    /已修改/,
  );
});

test("relative NGA attachments expand without changing local files or foreign URLs", () => {
  assert.equal(absoluteNGAImageUrl(`./${path}`), original);
  assert.equal(absoluteNGAImageUrl(relative + "?v=1#part"), thumb + "?v=1#part");
  assert.equal(ngaImageSizeUrl(relative, "thumb_s"), original + ".thumb_s.jpg");
  assert.equal(ngaImageSizeUrl(relative, ""), original);
  for (const value of ["./local.webp", "../" + path, "./mon_202610/05/note.md", "https://example.com/" + path, original])
    assert.equal(absoluteNGAImageUrl(value), value);
});


test("all sized images are checked directly without a thread or Cookie", async () => {
  const { calls, check } = mock();
  const urls = NGA_IMAGE_SIZES.filter((size) => size.value).map((size) => ngaImageSizeUrl(original, size.value)!);
  const result = await relativeNGAImages([...urls, ...urls], check);
  assert.deepEqual(calls, urls, "Repeated uses of a URL are checked once");
  for (const url of urls) assert.equal(result.get(url), url.replace("https://img.nga.cn/attachments/", "./"));
  const direct = mock();
  assert.equal((await relativeNGAImages([relative], direct.check)).get(relative), relative);
  assert.deepEqual(direct.calls, [thumb]);
  await assert.rejects(relativeNGAImages([thumb], mock(true).check), /Image unavailable/);
});

test("clipboard export converts Markdown, raw BBCode and reference images after checking URLs", async () => {
  const { calls, check } = mock();
  const source = `![图](${thumb})\n\n[IMG]${thumb}?v=1#part[/IMG]\n\n![图][ref]\n\n[ref]: ${thumb}`;
  assert.equal(await toNGABBCode(source, check), `[img]${relative}[/img]\n\n[IMG]${relative}?v=1#part[/IMG]\n\n[img]${relative}[/img]`);
  assert.deepEqual(calls, [thumb, thumb + "?v=1#part"]);
  assert.ok(source.includes(thumb));
});

test("originals and external images need no check, while local images still fail export", async () => {
  const { calls, check } = mock(true);
  for (const source of [`![图](${original})`, `![图](./${path})`, `[img]./${path}[/img]`])
    assert.equal(await toNGABBCode(source, check), `[img]${original}[/img]`);
  assert.equal(await toNGABBCode("![图](https://example.com/x.webp)", check), "[img]https://example.com/x.webp[/img]");
  await assert.rejects(toNGABBCode("![图](local.webp)", check), /本地图片/);
  assert.deepEqual(calls, []);
});

test("relative image syntax uses the same size availability checks", async () => {
  for (const source of [`![图](${relative})`, `[img]${relative}[/img]`, `![图][ref]\n\n[ref]: ${relative}`]) {
    const { calls, check } = mock();
    assert.equal(await toNGABBCode(source, check), `[img]${relative}[/img]`);
    assert.deepEqual(calls, [thumb]);
    await assert.rejects(toNGABBCode(source, mock(true).check), /Image unavailable/);
  }
});

test("ordinary links and Markdown or BBCode examples never trigger image checks", async () => {
  const raw = `[img]${thumb}[/img]`;
  const { calls, check } = mock(true);
  const source = `[查看](${thumb})\n\n\`${raw}\`\n\n\`\`\`\n${raw}\n\`\`\`\n\n[code]${raw}[/code]\n\n[code]\n![图](${thumb})\n[/code]`;
  const result = await toNGABBCode(source, check);
  assert.ok(result.includes(`[url=${thumb}]查看[/url]`));
  assert.ok(result.includes(`[code]${raw}[/code]`));
  assert.ok(!result.includes(relative));
  assert.deepEqual(calls, []);
});

test("mixed examples and real images check only the real image", async () => {
  const example = thumb.replace("lsQ13-gcdfKkT1kS9u-dk", "example");
  const { calls, check } = mock();
  assert.equal(await toNGABBCode(`[code][img]${example}[/img][/code]\n\n[img]${thumb}[/img]`, check),
    `[code][img]${example}[/img][/code]\n\n[img]${relative}[/img]`);
  assert.deepEqual(calls, [thumb]);
});

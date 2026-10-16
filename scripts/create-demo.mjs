import { mkdir, writeFile, cp, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
const vault = resolve(process.argv[2] || ".test-vault");
try {
  await stat(vault);
  throw new Error("The destination already exists; choose a new empty path.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(join(vault, ".obsidian/plugins"), { recursive: true });
await cp("dist/anke-writing", join(vault, ".obsidian/plugins/anke-writing"), {
  recursive: true,
});
await writeFile(
  join(vault, ".obsidian/community-plugins.json"),
  '["anke-writing"]',
);
await writeFile(join(vault, ".obsidian/app.json"), '{"livePreview":true}');
const portrait =
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240"><rect width="180" height="240" rx="16" fill="#d8e7db"/><circle cx="90" cy="85" r="42" fill="#789785"/><path d="M25 240Q25 140 90 140Q155 140 155 240" fill="#789785"/></svg>';
for (const name of ["演示作品", "另一部作品"]) {
  const root = join(vault, name);
  for (const folder of ["角色", "附件"])
    await mkdir(join(root, folder), { recursive: true });
  const files = {
    [`${name}.md`]: `---\nanke-type: project\nname: ${name}\ncharacters:\n  - "[[${name}/角色/若叶睦]]"\nnga-thread: ""\n---\n\n# ${name}\n`,
    "角色/若叶睦.md":
      '---\nanke-type: character\nname: 若叶睦\naliases: []\ncolor: "seagreen"\navatar: "../附件/portrait.svg"\nnotes: 演示用角色。\n---\n\n# 常服\n\n- [微笑](../附件/portrait.svg)\n- [](../附件/portrait.svg)\n\n# 演出服\n\n## 站姿\n\n- [站姿](../附件/portrait.svg)\n',
    "附件/portrait.svg": portrait,
    "1-1 第一章.md":
      '# 第一章 · 重逢\n\n“你终于来了。”她抬起头。\n\n> **观察**\n>\n> 这里可以使用 Markdown 的引用与格式。\n\n[dice]1d100[/dice]\n\n---\n<!-- anke-section: "门后的声音" -->\n\n「进来吧。」\n',
  };
  for (const [path, text] of Object.entries(files))
    await writeFile(join(root, path), text);
}
await writeFile(
  join(vault, "普通笔记.md"),
  "# 普通笔记\n\n[普通链接](https://example.com)\n\n[color=red]保留原样[/color]\n",
);
console.log(`Created demonstration vault: ${vault}`);

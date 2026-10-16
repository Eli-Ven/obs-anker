import test from "node:test";
import assert from "node:assert/strict";
import { fullwidthPunctuation } from "../src/fullwidth";

// Golden outputs from the user-provided fullwidth_punctuation.py.
const cases = [
  {
    name: "prose",
    input: '他说: "你好, world!" (继续...) [备注] {内容}; 好吗?',
    expected: "他说：“你好，world！”（继续……）【备注】｛内容｝；好吗？",
  },
  {
    name: "English and numbers",
    input: "Don't change ABC 123 or 3.14, 1,000.5. '你好' and John's note.",
    expected: "Don’t change ABC 123 or 3.14，1,000.5.‘你好’and John’s note。",
  },
  {
    name: "formatting",
    input:
      '# 标题: 开始\n\n> "你好, **世界!**"\n\n- [ ] 待办: A_B-C\n1) 项目;\n2. 列表.\n\n---\n*斜体,* **粗体!** ~~删除?~~ # _ - + = / % @ &',
    expected:
      "# 标题：开始\n\n>“你好，**世界！**”\n\n- [ ] 待办：A_B-C\n1) 项目；\n2. 列表。\n\n---\n*斜体，* **粗体！** ~~删除？~~ # _ - + = / % @ &",
  },
  {
    name: "spacing and breaks",
    input: "你好 , 世界 !  \n下行 ( 好 )\t?\n\nEnglish words stay apart.  ",
    expected: "你好，世界！  \n下行（好）？\n\nEnglish words stay apart。  ",
  },
  {
    name: "YAML",
    input: '---\nname: "Alpha, B"\naliases: [a, b]\n---\n\n他说: "你好!"',
    expected: '---\nname: "Alpha, B"\naliases: [a, b]\n---\n\n他说：“你好！”',
  },
  {
    name: "empty YAML",
    input: "---\n---\n你好, 世界!",
    expected: "---\n---\n你好，世界！",
  },
  {
    name: "fences",
    input:
      '```python\nx = "a,b"\n```\n你好, world!\n\n~~~text\na,b!\n~~~\n最后.',
    expected:
      '```python\nx = "a,b"\n```\n你好，world！\n\n~~~text\na,b!\n~~~\n最后。',
  },
  {
    name: "unclosed fence",
    input: "你好,\n\n```python\nx: (a, b)!\n仍不关闭, ok?",
    expected: "你好，\n\n```python\nx: (a, b)!\n仍不关闭, ok?",
  },
  {
    name: "quoted fence",
    input: '> ```js\n> f("a,b");\n> ```\n> 你好, world!',
    expected: '> ```js\n> f("a,b");\n> ```\n> 你好，world！',
  },
  {
    name: "indented and inline code",
    input: "    f(a,b);\n\tcode: [x]\n正文, `f(a,b)`; ``a ` b!``.",
    expected: "    f(a,b);\n\tcode: [x]\n正文，`f(a,b)`；``a ` b!``。",
  },
  {
    name: "Markdown links",
    input:
      '[说明, 好!](https://e.test/a(b).png "title, hi") ![图片: 好](a.png)\n[文字, 好][id]\n[id]: https://e.test/a(b) "title"\n\n正文, hi!',
    expected:
      '[说明, 好!](https://e.test/a(b).png "title, hi") ![图片: 好](a.png)\n[文字, 好][id]\n[id]: https://e.test/a(b) "title"\n\n正文，hi！',
  },
  {
    name: "nested link text",
    input: "[嵌套 [说明, 好]](https://e.test/a(b(c)).png) 后文, hi!",
    expected: "[嵌套 [说明, 好]](https://e.test/a(b(c)).png) 后文，hi！",
  },
  {
    name: "wiki links",
    input: "[[角色/若叶睦|睦, hello!]] ![[photo.png|a,b]] 后文, hi!",
    expected: "[[角色/若叶睦|睦, hello!]] ![[photo.png|a,b]] 后文，hi！",
  },
  {
    name: "raw BBCode",
    input:
      "[code=js]\nf(a, b);\n[/code]\n[pre]a,b![/pre] [noparse]x,y![/noparse]\n[img]https://e.test/a,b.png[/img]\n[url]https://e.test/?a=1,b=2[/url]\n[email]a.b@example.com[/email]\n[attach]1,2[/attach] [attachment]3,4[/attachment]\n正文, hi!",
    expected:
      "[code=js]\nf(a, b);\n[/code]\n[pre]a,b![/pre] [noparse]x,y![/noparse]\n[img]https://e.test/a,b.png[/img]\n[url]https://e.test/?a=1,b=2[/url]\n[email]a.b@example.com[/email]\n[attach]1,2[/attach] [attachment]3,4[/attachment]\n正文，hi！",
  },
  {
    name: "unclosed raw BBCode",
    input: "你好, [code]x,y!\nmore, code!",
    expected: "你好，[code]x,y!\nmore, code!",
  },
  {
    name: "BBCode prose",
    input:
      '[quote]他说: "你好, 世界!"[/quote]\n[color=skyblue]你好, friend![/color] [dice]1d100[/dice]\n[collapse=标题, a]内容;[/collapse] [url=https://e.test/?a=1,b=2]链接, 好![/url]',
    expected:
      "[quote]他说：“你好，世界！”[/quote]\n[color=skyblue]你好，friend！[/color] [dice]1d100[/dice]\n[collapse=标题, a]内容；[/collapse] [url=https://e.test/?a=1,b=2]链接，好！[/url]",
  },
  {
    name: "timing tags",
    input:
      '[timingpost time="2030-01-01T12:34:56Z" task="a"]\n你好, hi!\n[/timingpost]',
    expected:
      '[timingpost time="2030-01-01T12:34:56Z" task="a"]\n你好，hi！\n[/timingpost]',
  },
  {
    name: "URLs and emails",
    input:
      "https://e.test/a(b), 好! ftp://server/x?a=1; www.e.test/path. mailto:me@e.test! me.name+tag@example.com, (https://e.test/a).",
    expected:
      "https://e.test/a(b)，好！ftp://server/x?a=1；www.e.test/path。mailto:me@e.test！me.name+tag@example.com，（https://e.test/a）。",
  },
  {
    name: "HTML",
    input:
      '<span title="a,b!">你好, hi!</span> <https://e.test/a,b> <!-- section: "a,b" -->',
    expected:
      '<span title="a,b!">你好，hi！</span> <https://e.test/a,b> <!-- section: "a,b" -->',
  },
  {
    name: "escapes",
    input: '\\, \\[ \\] \\. \\" \\( \\) \\! 后文, hi!',
    expected: '\\, \\[ \\] \\. \\" \\( \\) \\! 后文，hi！',
  },
  {
    name: "markers and CRLF",
    input: "A\r\n你好 , 世界 !  \r\n\r\n> 1) 列表, hi!\r\n",
    expected: "A\r\n你好，世界！  \r\n\r\n> 1) 列表，hi！\r\n",
  },
  {
    name: "many protected spans",
    input:
      "`code,0!` `code,1!` `code,2!` `code,3!` `code,4!` `code,5!` `code,6!` `code,7!` `code,8!` `code,9!` `code,10!` `code,11!` `code,12!` `code,13!` `code,14!` `code,15!` `code,16!` `code,17!` `code,18!` `code,19!` `code,20!` `code,21!` `code,22!` `code,23!` `code,24!` `code,25!` `code,26!` `code,27!` `code,28!` `code,29!` `code,30!` `code,31!` `code,32!` `code,33!` `code,34!` `code,35!` `code,36!` `code,37!` `code,38!` `code,39!` `code,40!` `code,41!` `code,42!` `code,43!` `code,44!` `code,45!` `code,46!` `code,47!` `code,48!` `code,49!` `code,50!` `code,51!` `code,52!` `code,53!` `code,54!` `code,55!` `code,56!` `code,57!` `code,58!` `code,59!` `code,60!` `code,61!` `code,62!` `code,63!` `code,64!` `code,65!` `code,66!` `code,67!` `code,68!` `code,69!` `code,70!` `code,71!` `code,72!` `code,73!` `code,74!` `code,75!` `code,76!` `code,77!` `code,78!` `code,79!` 你好, hi!",
    expected:
      "`code,0!` `code,1!` `code,2!` `code,3!` `code,4!` `code,5!` `code,6!` `code,7!` `code,8!` `code,9!` `code,10!` `code,11!` `code,12!` `code,13!` `code,14!` `code,15!` `code,16!` `code,17!` `code,18!` `code,19!` `code,20!` `code,21!` `code,22!` `code,23!` `code,24!` `code,25!` `code,26!` `code,27!` `code,28!` `code,29!` `code,30!` `code,31!` `code,32!` `code,33!` `code,34!` `code,35!` `code,36!` `code,37!` `code,38!` `code,39!` `code,40!` `code,41!` `code,42!` `code,43!` `code,44!` `code,45!` `code,46!` `code,47!` `code,48!` `code,49!` `code,50!` `code,51!` `code,52!` `code,53!` `code,54!` `code,55!` `code,56!` `code,57!` `code,58!` `code,59!` `code,60!` `code,61!` `code,62!` `code,63!` `code,64!` `code,65!` `code,66!` `code,67!` `code,68!` `code,69!` `code,70!` `code,71!` `code,72!` `code,73!` `code,74!` `code,75!` `code,76!` `code,77!` `code,78!` `code,79!` 你好，hi！",
  },
  {
    name: "quotes across lines",
    input: "\"第一行,\n第二行!\"\n\n'内部,\n继续?'",
    expected: "“第一行，\n第二行！”\n\n‘内部，\n继续？’",
  },
  {
    name: "Unicode numbers",
    input: "１２３.４, ١٢٣.٤; test ABC123, 100%.",
    expected: "１２３.４，١٢٣.٤；test ABC123，100%。",
  },
];

for (const { name, input, expected } of cases) {
  test(`fullwidth punctuation matches the original script: ${name}`, () => {
    assert.equal(fullwidthPunctuation(input), expected);
  });
}

import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out");
};
const path = "演示作品/1-1 第一章.md";
const header = "---\nanke-type: chapter\n---\n\n";
const variantPath = "演示作品/角色/若叶睦/photo/常服.md";
try {
  assert.ok(
    await call(
      (chapter, variants) =>
        !!app.vault.getFileByPath(chapter) &&
        !!app.vault.getFileByPath(variants),
      path,
      variantPath,
    ),
    "This script requires a freshly generated demo vault; it overwrites demo samples.",
  );
  await call(
    async (path, header) => {
      const p = app.plugins.plugins["anke-writing"];
      const leaves = app.workspace.getLeavesOfType("markdown");
      const leaf = leaves[0];
      for (const other of leaves.slice(1)) other.detach();
      await leaf.setViewState({
        type: "markdown",
        state: { file: path, mode: "source" },
        active: true,
      });
      window.ankeTestView = leaf.view;
      leaf.view.editor.setValue(header + "Before\n\nAfter");
      leaf.view.editor.setCursor(
        leaf.view.editor.offsetToPos(header.length + 8),
      );
      leaf.view.editor.focus();
      await p.openCharacters();
      await p.views()[0].render();
    },
    path,
    header,
  );
  await waitFor(() =>
    c.evaluate(`!!document.querySelector('.anke-thumbnail')`),
  );
  const inserted = await c.evaluate(
    `(()=>{document.querySelector('.anke-thumbnail').click();return window.ankeTestView.editor.getValue().slice(${header.length});})()`,
  );
  assert.match(
    inserted,
    /^Before\n\n!\[.*?\]\(<角色\/若叶睦\/assets\/portrait.svg>\)After$/,
  );
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key: "z",
      code: "KeyZ",
      modifiers: 4,
    });
  assert.equal(
    await c.evaluate(
      `window.ankeTestView.editor.getValue().slice(${header.length})`,
    ),
    "Before\n\nAfter",
  );
  const dragged = await c.evaluate(
    `(()=>{const v=window.ankeTestView;app.workspace.setActiveLeaf(v.leaf,{focus:true});v.editor.focus();const cm=v.editor.cm,coords=cm.coordsAtPos(${header.length + 8}),data=new DataTransfer();document.querySelector('.anke-thumbnail').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));cm.contentDOM.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:coords.left+1,clientY:(coords.top+coords.bottom)/2}));return v.editor.getValue().slice(${header.length});})()`,
  );
  assert.equal(dragged, inserted);
  console.log(
    "PASS: thumbnail click/drop insert at the intended position and use native undo",
  );

  await call(async (path) => {
    const leaf = app.workspace.getLeaf("split");
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "preview" },
      active: true,
    });
    window.ankeReading = leaf.view;
    const edit = app.workspace.getLeaf("split");
    await edit.setViewState({
      type: "markdown",
      state: { file: path, mode: "source" },
      active: true,
    });
    window.ankeVariantEditor = edit.view;
  }, variantPath);
  await c.send("Page.bringToFront");
  await c.screenshot("/tmp/anke-two-modes.png");
  await waitFor(() =>
    c.evaluate(
      '!!window.ankeReading.contentEl.querySelector(".anke-reading-image")',
    ),
  );
  assert.equal(
    await c.evaluate(
      'window.ankeVariantEditor.contentEl.querySelectorAll(".anke-reading-image").length',
    ),
    0,
  );
  console.log(
    "PASS: simultaneous Reading/Editing views show images/ordinary links independently",
  );

  await call(async () => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: { file: "普通笔记.md", mode: "preview" },
      active: true,
    });
    window.ankeOrdinary = leaf.view;
  });
  await c.send("Page.bringToFront");
  await c.screenshot("/tmp/anke-ordinary-note.png");
  await waitFor(() =>
    c.evaluate(
      'window.ankeOrdinary.contentEl.innerText.includes("[color=red]")',
    ),
  );
  assert.equal(
    await c.evaluate(
      'window.ankeOrdinary.contentEl.querySelectorAll(".anke-reading-image,.anke-badge").length',
    ),
    0,
  );
  console.log(
    "PASS: unrelated notes retain normal Markdown and literal NGA text",
  );

  await call(async () => {
    const p = app.plugins.plugins["anke-writing"];
    const projects = p.library.projects();
    const source = projects.find((p) => p.name === "演示作品");
    const target = projects.find((p) => p.name === "另一部作品");
    const character = p.library.characters(source)[0];
    await p.library.copyCharacter(character, target, "独立副本");
  });
  await waitFor(() =>
    c.evaluate(
      `(()=>{const lib=app.plugins.plugins['anke-writing'].library;const target=lib.projects().find(p=>p.name==='另一部作品');return target && lib.characters(target).length===2;})()`,
    ),
  );
  const copy = await c.evaluate(
    `(async()=>{const p=app.plugins.plugins['anke-writing'];const path='另一部作品/角色/独立副本';const role=app.vault.getFileByPath(path+'/独立副本.md');const list=app.vault.getFileByPath(path+'/photo/常服.md');return {name:app.metadataCache.getFileCache(role).frontmatter.name,assets:!!app.vault.getFileByPath(path+'/assets/portrait.svg'),text:await p.library.read(list)};})()`,
  );
  assert.equal(copy.name, "独立副本");
  assert.equal(copy.assets, true);
  assert.match(copy.text, /portrait.svg/);
  console.log(
    "PASS: copying a character creates independent notes, lists and local assets",
  );
  await call(async () => {
    const p = app.plugins.plugins["anke-writing"];
    const target = p.library.projects().find((p) => p.name === "另一部作品");
    await p.library.setVisible(
      target,
      p.library
        .characters(target)
        .filter((c) => c.name !== "独立副本")
        .map((c) => c.file.path),
    );
    await app.vault.trash(
      app.vault.getAbstractFileByPath("另一部作品/角色/独立副本"),
      false,
    );
  });
} finally {
  c.close();
}

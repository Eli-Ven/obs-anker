import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";
const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const wait = async (fn, ...args) => {
  for (let i = 0; i < 120; i++) {
    if (await call(fn, ...args)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Single-file UI condition timed out");
};
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: { Enter: 13, Escape: 27, KeyZ: 90 }[code] || 0,
    });
};
const root = `SingleFileCheck-${Date.now()}`;
let rolePath;
try {
  await call(async (root) => {
    if (document.querySelector(".modal"))
      throw Error("Close dialogs before running this test");
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    const p = app.plugins.plugins["anke-writing"];
    await p.openCharacters();
    window.singleFileCheck = {
      active: app.workspace.activeLeaf,
      character: p.views()[0].characterPath,
      leaf: app.workspace.getLeaf("tab"),
      attachment: app.vault.getConfig("attachmentFolderPath"),
      wiki: app.vault.getConfig("useMarkdownLinks"),
      autoLinks: app.vault.getConfig("alwaysUpdateLinks"),
    };
    await p.library.createProject(root);
    await p.library.createProject(root + "-other");
    await app.vault.createFolder(root + "/Attachments");
    app.vault.setConfig("attachmentFolderPath", root + "/Attachments");
    app.vault.setConfig("useMarkdownLinks", false);
  }, root);
  await wait(
    (root) =>
      app.plugins.plugins["anke-writing"].library
        .projects()
        .some((p) => p.root === root + "-other"),
    root,
  );
  rolePath = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((p) => p.root === root);
    const file = await p.library.createCharacter(project, "Alpha");
    await app.vault.create(
      root + "/Attachments/portrait.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="90"><rect width="60" height="90" fill="#abc"/></svg>',
    );
    await app.vault.modify(
      file,
      '---\nanke-type: character\nname: Alpha\ncolor: "#123456"\nnotes: Keep notes\n---\n\n# 常服\n- [微笑](../Attachments/portrait.svg)\n- [](../Attachments/portrait.svg)\n\n# 演出服\n## 站姿\n![[portrait.svg|站姿]]\n\n# 空白组\n',
    );
    await window.singleFileCheck.leaf.openFile(
      app.vault.getFileByPath(root + "/1-1 第一章.md"),
    );
    app.workspace.setActiveLeaf(window.singleFileCheck.leaf, { focus: true });
    return file.path;
  }, root);
  assert.match(rolePath, /\/Alpha\.md$/);
  assert.equal(
    await call(
      (path) => !!app.vault.getFolderByPath(path.slice(0, -3)),
      rolePath,
    ),
    false,
    "No per-character folder",
  );
  await wait(
    (path) =>
      document.querySelector(".anke-variant-browser")?.dataset.character ===
        path && document.querySelectorAll(".anke-add-variant").length === 2,
    rolePath,
  );
  const groupKeys = await call(() =>
    [...document.querySelectorAll(".anke-group-heading")].map((el) => ({
      name: el.textContent,
      key: el.dataset.group,
    })),
  );
  assert.deepEqual(
    groupKeys.map((g) => g.name),
    ["常服", "演出服 / 站姿"],
  );
  await call(
    (key) =>
      [...document.querySelectorAll(".anke-group-heading")]
        .find((el) => el.dataset.group === key)
        .click(),
    groupKeys[0].key,
  );
  await wait(() => document.querySelectorAll(".anke-group-chip").length === 1);
  assert.equal(
    await call(() => document.querySelectorAll(".anke-variant-group").length),
    1,
  );
  await call(() => document.querySelector(".anke-group-chip").click());
  await wait(
    () => document.querySelectorAll(".anke-variant-group").length === 2,
  );
  await call(
    (key) =>
      [...document.querySelectorAll(".anke-variant-group")]
        .find((el) => el.dataset.path === key)
        .querySelector(".anke-add-variant")
        .click(),
    groupKeys[0].key,
  );
  await call(() => {
    const [label, url] = document.querySelectorAll(".modal input");
    label.value = "新增";
    url.value = "portrait.svg";
    for (const i of [label, url])
      i.dispatchEvent(new Event("input", { bubbles: true }));
    url.focus();
  });
  await key("Enter", "Enter");
  await wait(() => !document.querySelector(".modal"));
  await wait(() => document.querySelectorAll(".anke-variant").length === 4);
  const text = await call(
    (path) =>
      app.plugins.plugins["anke-writing"].library.read(
        app.vault.getFileByPath(path),
      ),
    rolePath,
  );
  assert.ok(text.indexOf("新增") < text.indexOf("# 演出服"));
  assert.match(text, /\[\[[^\]]*portrait\.svg\|新增\]\]/);
  // Search must use heading group identities even though every row shares a file.
  await call(
    async (root, key) => {
      const p = app.plugins.plugins["anke-writing"];
      p.data.collapsedGroups.push(key);
      await p.persist();
      const leaf = window.singleFileCheck.leaf;
      leaf.view.editor.focus();
      await p.searchVariants(
        p.library.projects().find((x) => x.root === root),
        leaf.view.editor,
        leaf.view,
      );
    },
    root,
    groupKeys[0].key,
  );
  await wait(() => !!document.querySelector(".prompt-input"));
  assert.ok(
    await call(() =>
      document
        .querySelector(".anke-search-scope")
        .textContent.includes("已展开分组"),
    ),
  );
  assert.deepEqual(
    await call(() =>
      [...document.querySelectorAll(".suggestion-item")].map(
        (el) => el.firstElementChild.textContent,
      ),
    ),
    ["站姿"],
  );
  await call(() => {
    const i = document.querySelector(".prompt-input");
    i.value = "新增";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(() =>
    document
      .querySelector(".anke-search-scope")
      .textContent.includes("全部差分"),
  );
  await key("Enter", "Enter");
  await wait(() => !document.querySelector(".prompt-input"));
  assert.ok(
    await call(() =>
      /!\[\[[^\]]*portrait\.svg\|新增\]\]/.test(
        window.singleFileCheck.leaf.view.editor.getValue(),
      ),
    ),
  );
  // Native Obsidian paste chooses the configured attachment location and emits its own embed syntax.
  await call(async (path) => {
    const leaf = window.singleFileCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: path, mode: "source", source: true },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const editor = leaf.view.editor;
    editor.setCursor(editor.offsetToPos(editor.getValue().length));
    editor.replaceSelection("\n");
    editor.focus();
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    leaf.view.containerEl.querySelector(".cm-content").dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, rolePath);
  await wait(
    (root) =>
      app.vault
        .getFiles()
        .some(
          (file) =>
            file.path.startsWith(root + "/Attachments/") &&
            file.extension === "png",
        ),
    root,
  );
  assert.ok(
    await call(() =>
      /!\[\[.*\.png/.test(window.singleFileCheck.leaf.view.editor.getValue()),
    ),
  );
  await wait(() => document.querySelectorAll(".anke-variant").length >= 2);
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    const source = p.library.characters(project)[0];
    await p.library.copyCharacter(
      source,
      p.library.projects().find((x) => x.root === root + "-other"),
      "Copy",
    );
  }, root);
  await wait((root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library
      .projects()
      .find((x) => x.root === root + "-other");
    return project && p.library.characters(project).length === 1;
  }, root);
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library
      .projects()
      .find((x) => x.root === root + "-other");
    const copy = p.library.characters(project)[0];
    for (const group of await p.library.groups(copy))
      for (const row of group.entries)
        p.library.resolveMedia(row.url, copy.file);
    await p.library.deleteCharacter(project, copy);
  }, root);
  assert.equal(
    await call(
      (root) => !!app.vault.getFileByPath(root + "/Attachments/portrait.svg"),
      root,
    ),
    true,
    "Deleting a role keeps attachments",
  );
  // The migration command operates only on this fixture, retains metadata, notes, captions and image targets.
  const legacy = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const base = p.library.characterFolder(root) + "/Legacy";
    await p.library.folders(base + "/photo");
    await p.library.folders(base + "/assets");
    await app.vault.create(
      base + "/assets/old.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    const note = await app.vault.create(
      base + "/Legacy.md",
      '---\nanke-type: character\nname: Legacy\ncolor: "#654321"\navatar: assets/old.svg\ncustom: Keep me\n---\n\n# Legacy\n\n## Notes\nKeep this paragraph.\n',
    );
    await app.vault.create(
      base + "/photo/常服.md",
      "---\nanke-type: variants\n---\n\n- [Old smile](../assets/old.svg)\n\n```md\n# literal example\n```\n",
    );
    await app.vault.create(
      base + "/photo/演出服.md",
      "---\nanke-type: variants\n---\n\n- [Remote](https://example.invalid/a.webp)\n",
    );
    const project = p.library.projects().find((x) => x.root === root);
    await app.fileManager.processFrontMatter(project.file, (fm) => {
      fm.characters.push("[[Legacy]]");
    });
    return note.path;
  }, root);
  await wait((root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    return (
      project && p.library.characters(project).some((c) => c.name === "Legacy")
    );
  }, root);
  const migrated = await call(async (root) => {
    app.vault.setConfig("alwaysUpdateLinks", false);
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    const source = p.library
      .characters(project)
      .find((c) => c.name === "Legacy");
    const file = await p.library.migrateCharacter(project, source);
    return { path: file.path, text: await p.library.read(file) };
  }, root);
  assert.match(migrated.path, /\/Legacy\.md$/);
  assert.ok(migrated.text.includes("custom: Keep me"));
  assert.ok(migrated.text.includes("Keep this paragraph."));
  assert.ok(migrated.text.includes("# literal example"));
  assert.ok(!migrated.text.includes("## literal example"));
  assert.ok(migrated.text.includes("Old smile"));
  assert.equal(
    await call((path) => !!app.vault.getFileByPath(path), legacy),
    false,
  );
  await wait((root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    return (
      project &&
      p.library
        .characters(project)
        .some((c) => c.name === "Legacy" && !p.library.isLegacy(c))
    );
  }, root);
  const groups = await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    const project = p.library.projects().find((x) => x.root === root);
    const role = p.library.characters(project).find((c) => c.name === "Legacy");
    p.library.resolveMedia(role.avatar, role.file);
    const groups = await p.library.groups(role);
    for (const group of groups)
      for (const row of group.entries)
        p.library.resolveMedia(row.url, role.file);
    return groups.map((g) => ({
      path: g.path,
      labels: g.entries.map((e) => e.label),
    }));
  }, root);
  assert.deepEqual(groups, [
    { path: "常服", labels: ["Old smile"] },
    { path: "演出服", labels: ["Remote"] },
  ]);
  await c.screenshot("/tmp/anke-single-file.png");
  console.log(
    "PASS: flat character creation, heading groups, add/collapse/search/insertion, native configured attachment paste, copy/delete, and lossless legacy migration",
  );
} finally {
  await key("Escape", "Escape");
  await call(async (root) => {
    const state = window.singleFileCheck;
    if (!state) return;
    const p = app.plugins.plugins["anke-writing"];
    state.leaf.detach();
    app.vault.setConfig("attachmentFolderPath", state.attachment);
    app.vault.setConfig("useMarkdownLinks", state.wiki);
    app.vault.setConfig("alwaysUpdateLinks", state.autoLinks);
    p.data.collapsedGroups = p.data.collapsedGroups.filter(
      (path) => !path.startsWith(root),
    );
    await p.persist();
    if (state.active)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    p.views()[0].characterPath = state.character;
    for (const path of [root, root + "-other"]) {
      const folder = app.vault.getFolderByPath(path);
      if (folder) await app.vault.trash(folder, false);
    }
    await p.views()[0].render();
    delete window.singleFileCheck;
  }, root);
  c.close();
}

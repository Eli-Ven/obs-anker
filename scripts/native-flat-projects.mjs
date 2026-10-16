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
  throw new Error("Timed out waiting for test state");
};
const root = `FlatCheck-${Date.now()}`;
const task = `flat-check-${Date.now()}`;
const open = async (path, mode = "source") => {
  await call(
    async (path, mode) => {
      const leaf = window.ankeFlatCheck.leaf;
      await leaf.setViewState({
        type: "markdown",
        state: { file: path, mode },
        active: true,
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      if (mode === "source") leaf.view.editor.focus();
    },
    path,
    mode,
  );
};
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: /^(Key[A-Z]|Digit[0-9])$/.test(code)
        ? code.at(-1).charCodeAt(0)
        : { Tab: 9, Enter: 13 }[code],
    });
};
try {
  await call(
    async (root, task) => {
      const p = app.plugins.plugins["anke-writing"];
      window.ankeFlatCheck = {
        active: app.workspace.activeLeaf,
        characterPath: p.views()[0]?.characterPath,
        compact: p.data.compact,
        height: p.data.characterHeight,
        root,
        task,
        leaf: app.workspace.getLeaf("tab"),
      };
      await p.library.createProject(root);
      for (const name of ["1-10 十章", "2-1 新卷", "1-2 第二章"])
        await app.vault.create(`${root}/${name}.md`, "chapter");
      await app.vault.create(
        `${root}/普通笔记.md`,
        "“普通文本”\n\n[color=red]原样[/color]\n\n[dice]1d100[/dice]\n\n[quo",
      );
      await app.vault.create(
        `${root}/待办.md`,
        `[timingpost time="2099-01-01T00:00:00Z" task="${task}-ordinary"]\n普通笔记\n[/timingpost]`,
      );
    },
    root,
    task,
  );
  await waitFor(() =>
    call((root) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root);
      return project && p.library.chapters(project).length === 4;
    }, root),
  );
  const structure = await call((root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    return {
      chapters: p.library.chapters(project).map((f) => f.basename),
      folders: app.vault
        .getAbstractFileByPath(root)
        .children.filter((f) => f.children)
        .map((f) => f.name),
    };
  }, root);
  assert.deepEqual(structure.chapters, [
    "1-1 第一章",
    "1-2 第二章",
    "1-10 十章",
    "2-1 新卷",
  ]);
  assert.deepEqual(structure.folders, ["角色"]);
  console.log(
    "PASS: projects are top-level; filenames identify chapters without YAML; volume/chapter names sort numerically",
  );

  await open(`${root}/普通笔记.md`, "preview");
  await waitFor(() =>
    call(() =>
      window.ankeFlatCheck.leaf.view.contentEl.textContent.includes("[dice]"),
    ),
  );
  assert.equal(
    await call(
      () =>
        !!window.ankeFlatCheck.leaf.view.contentEl.querySelector(".anke-badge"),
    ),
    false,
  );
  await open(`${root}/普通笔记.md`);
  assert.equal(
    await call(
      () =>
        !!app.plugins.plugins["anke-writing"].isWriting(
          window.ankeFlatCheck.leaf.view,
        ),
    ),
    false,
  );
  await call(() => {
    const editor = window.ankeFlatCheck.leaf.view.editor;
    editor.setCursor(editor.offsetToPos(editor.getValue().length));
    editor.focus();
  });
  await key("Tab", "Tab");
  assert.equal(
    await call(() =>
      window.ankeFlatCheck.leaf.view.editor.getValue().includes("[/quote]"),
    ),
    false,
  );
  await call(async (root) => {
    await app.fileManager.renameFile(
      app.vault.getFileByPath(`${root}/普通笔记.md`),
      `${root}/1-3 普通笔记.md`,
    );
  }, root);
  await waitFor(() =>
    call(
      () =>
        !!app.plugins.plugins["anke-writing"].isWriting(
          window.ankeFlatCheck.leaf.view,
        ),
    ),
  );
  console.log(
    "PASS: ordinary project notes keep native behavior and become chapters when their filenames match",
  );

  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((x) => x.root === root);
    for (const name of [
      "若叶睦",
      "很长的人物名字",
      "第三位",
      "第四位",
      "第五位",
    ])
      await p.library.createCharacter(project, name);
    const role = app.vault.getFileByPath(`${root}/角色/若叶睦/若叶睦.md`);
    await app.fileManager.processFrontMatter(role, (fm) => {
      fm.color = "#abcdef";
    });
    await app.vault.create(
      `${root}/角色/若叶睦/assets/test.svg`,
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#abcdef"/></svg>',
    );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/角色/若叶睦/photo/默认.md`),
      "---\nanke-type: variants\n---\n\n- [微笑](../assets/test.svg)",
    );
    await app.vault.createFolder(`${root}/角色/若叶睦/photo/演出服`);
    await app.vault.create(
      `${root}/角色/若叶睦/photo/演出服/站姿.md`,
      "---\nanke-type: variants\n---\n\n- [站姿](../../assets/test.svg)",
    );
    p.data.compact = true;
    p.data.characterHeight = 50;
    p.refresh();
  }, root);
  await open(`${root}/1-1 第一章.md`);
  await waitFor(() =>
    call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelectorAll(".anke-character").length === 5,
    ),
  );
  await call(async () => {
    const v = window.ankeFlatCheck.leaf.view;
    v.editor.setValue("“Hello”");
    v.editor.setCursor(v.editor.offsetToPos(v.editor.getValue().length));
    v.editor.focus();
  });
  await key("¡", "Digit1", 1);
  assert.equal(
    await call(() => window.ankeFlatCheck.leaf.view.editor.getValue()),
    "“[color=#abcdef]Hello[/color]”",
  );
  await key("z", "KeyZ", 4);
  assert.equal(
    await call(() => window.ankeFlatCheck.leaf.view.editor.getValue()),
    "“Hello”",
  );
  await key("∂", "KeyD", 1);
  assert.ok(
    (
      await call(() => window.ankeFlatCheck.leaf.view.editor.getValue())
    ).endsWith("[dice]1d100[/dice]"),
  );
  await key("z", "KeyZ", 4);
  await call(() =>
    app.plugins.plugins["anke-writing"]
      .views()[0]
      .contentEl.querySelector(".anke-thumbnail")
      .click(),
  );
  assert.ok(
    (
      await call(() => window.ankeFlatCheck.leaf.view.editor.getValue())
    ).includes("(<角色/若叶睦/assets/test.svg>)"),
  );
  await key("z", "KeyZ", 4);
  assert.equal(
    await call(() => window.ankeFlatCheck.leaf.view.editor.getValue()),
    "“Hello”",
  );
  console.log(
    "PASS: top-level chapters support color/dice hotkeys, relative image insertion and native undo",
  );

  const sizes = await call(() => {
    const el = app.plugins.plugins["anke-writing"].views()[0].contentEl;
    const size = (e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    });
    return {
      cards: [...el.querySelectorAll(".anke-character")].map(size),
      headings: [...el.querySelectorAll(".anke-group-heading")].map(size),
      rows: [...el.querySelectorAll(".anke-variant")].map(size),
      overflow: el.scrollWidth > el.clientWidth,
    };
  });
  assert.ok(sizes.cards.every((x) => x.width <= 53 && x.height <= 51));
  assert.ok(sizes.headings.every((x) => x.height <= 24));
  assert.ok(sizes.rows.every((x) => x.height <= 33));
  assert.equal(sizes.overflow, false);
  await call(() => {
    const el = app.plugins.plugins["anke-writing"].views()[0].contentEl;
    for (let i = 0; i < 8; i++)
      el.querySelector(".anke-divider").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
  });
  assert.equal(
    await call(
      () =>
        app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelector(".anke-character-list")
          .getBoundingClientRect().height,
    ),
    50,
  );
  console.log(
    "PASS: compact cards/group headings/variants fit, with a one-row minimum height",
  );

  await call(
    async (root, task) => {
      const p = app.plugins.plugins["anke-writing"],
        v = window.ankeFlatCheck.leaf.view;
      v.editor.setValue(
        `[timingpost task="${task}" marked="2026-01-01T00:00:00Z"]\nPublished\n[/timingpost]`,
      );
      p.data.journal[task] = {
        status: "sent",
        file: v.file.path,
        thread: "",
        time: "2026-01-01T00:00:00Z",
        message: "Test fixture",
      };
      await p.persist();
      await app.fileManager.renameFile(v.file, `${root}/1-1 重命名.md`);
      await app.fileManager.renameFile(
        app.vault.getAbstractFileByPath(root),
        root + "-moved",
      );
      window.ankeFlatCheck.root = root + "-moved";
    },
    root,
    task,
  );
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((p) => p.root === root + "-moved"),
      root,
    ),
  );
  const moved = await call(
    async (root, task) => {
      const p = app.plugins.plugins["anke-writing"],
        project = p.library.projects().find((x) => x.root === root + "-moved");
      return {
        file: p.data.journal[task].file,
        chapters: p.library.chapters(project).map((file) => file.basename),
        pending: (await p.publisher.pending())
          .filter(
            (x) =>
              x.tag.attrs.task === task ||
              x.tag.attrs.task === task + "-ordinary",
          )
          .map((x) => x.tag.attrs.task),
      };
    },
    root,
    task,
  );
  assert.equal(moved.file, `${root}-moved/1-1 重命名.md`);
  assert.equal(moved.chapters[0], "1-1 重命名");
  assert.equal(moved.chapters[1], "1-2 第二章");
  assert.deepEqual(moved.pending, [task]);
  console.log(
    "PASS: renames preserve publication identity/path; chapter order and ordinary-note exclusion hold",
  );
} finally {
  await call(async () => {
    const state = window.ankeFlatCheck;
    if (!state) return;
    const p = app.plugins.plugins["anke-writing"];
    state.leaf.detach();
    delete p.data.journal[state.task];
    p.data.compact = state.compact;
    p.data.characterHeight = state.height;
    if (p.views()[0]) p.views()[0].characterPath = state.characterPath || "";
    await p.persist();
    const folder = app.vault.getAbstractFileByPath(state.root);
    if (folder) await app.vault.trash(folder, false);
    if (state.active?.parent)
      app.workspace.setActiveLeaf(state.active, { focus: true });
    p.refresh();
    delete window.ankeFlatCheck;
  });
  c.close();
}

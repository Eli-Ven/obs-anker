import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const root = `InitCheck-${Date.now()}`;
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for initialization state");
};
const key = async (key, code, modifiers = 0) => {
  for (const type of ["keyDown", "keyUp"])
    await c.send("Input.dispatchKeyEvent", {
      type,
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: { KeyP: 80, Enter: 13, Escape: 27 }[code],
    });
};
const typeQuery = (value) =>
  call((value) => {
    const input = document.querySelector(".prompt input");
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
const runInit = (path) =>
  call(async (path) => {
    const result = await app.plugins.plugins[
      "anke-writing"
    ].library.initProject(app.vault.getFolderByPath(path));
    return { file: result.file.path, created: result.created };
  }, path);
const snapshot = (path) =>
  call(async (path) => {
    const rows = [];
    for (const f of app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(path + "/")))
      rows.push([
        f.path,
        Array.from(new Uint8Array(await app.vault.readBinary(f))),
      ]);
    return Object.fromEntries(rows);
  }, path);
try {
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    window.ankeInitCheck = {
      root,
      active: app.workspace.activeLeaf,
      character: p.views()[0]?.characterPath,
      folder: p.data.characterFolderName,
      collapsed: app.workspace.leftSplit.collapsed,
      leaf: app.workspace.getLeaf("tab"),
    };
    await p.setCharacterFolderName("Characters");
    for (const path of [
      "Story/Story 2.md",
      "Story/Characters",
      "Conflict",
      "Already",
      "Multiple",
      "Malformed",
      "Parent/Child",
      "Fresh",
    ])
      await p.library.folders(`${root}/${path}`);
    const files = {
      "Story/Story.md":
        "---\ntitle: Ordinary note\ncustom: keep\n---\n\nExisting folder note\n",
      "Story/Story 1.md": "Another existing note\n",
      "Story/Story 2.md/keep.md": "Nested folder with an md suffix\n",
      "Story/1-1 Existing.md":
        "---\r\ncustom: preserve\r\n---\r\n\r\n“正文不能改变。”\r\n\r\n---\r\n\r\nSecond section\r\n",
      "Story/Characters/readme.txt": "Existing resources\n",
      "Conflict/Characters": "This is a file, not a folder\n",
      "Already/Custom.md":
        '---\nanke-type: project\nname: Custom title\ncharacters:\n  - "[[Some role]]"\nnga-thread: "https://nga.178.com/read.php?tid=123"\ncustom: keep\n---\n\nPersonal notes\n',
      "Multiple/A.md": "---\nanke-type: project\n---\nA\n",
      "Multiple/B.md": "---\nanke-type: project\n---\nB\n",
      "Malformed/Broken.md":
        "---\nbroken: [\n---\nKeep malformed YAML untouched\n",
      "Parent/Child/Child.md":
        "---\nanke-type: project\nname: Child\n---\nChild config\n",
      "Parent/Child/1-1 Child.md": "Child chapter\n",
      "Parent/1-1 Parent.md": "Parent chapter\n",
    };
    for (const [path, text] of Object.entries(files))
      await app.vault.create(`${root}/${path}`, text);
    await app.vault.createBinary(
      `${root}/Story/image.webp`,
      new Uint8Array([82, 73, 70, 70, 0, 255, 0, 128, 10]).buffer,
    );
    const leaf = window.ankeInitCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: `${root}/Story/1-1 Existing.md`, mode: "source" },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, root);
  const before = await snapshot(root);
  const assertPreserved = async () => {
    const after = await snapshot(root);
    for (const [path, bytes] of Object.entries(before))
      assert.deepEqual(
        after[path],
        bytes,
        `Original file must remain byte-identical: ${path}`,
      );
  };

  // Exercise the actual command palette, not just the command callback.
  await key("p", "KeyP", 4);
  await waitFor(() => call(() => !!document.querySelector(".prompt input")));
  await typeQuery("anke init");
  await waitFor(() =>
    call(() =>
      [...document.querySelectorAll(".suggestion-item")].some(
        (el) =>
          el.querySelector(".suggestion-prefix")?.textContent === "obs-anker" &&
          el.textContent.includes("anke init"),
      ),
    ),
  );
  await key("Enter", "Enter");
  await waitFor(() =>
    call(() =>
      document
        .querySelector(".prompt input")
        ?.getAttribute("placeholder")
        ?.startsWith("anke init"),
    ),
  );
  assert.equal(
    await call(() => document.querySelector(".suggestion-item")?.textContent),
    `${root}/Story`,
  );
  await key("Escape", "Escape");
  await waitFor(() => call(() => !document.querySelector(".prompt")));
  assert.deepEqual(await snapshot(root), before);
  console.log(
    "PASS: Cmd+P finds anke init; current folder is first; cancel performs no writes",
  );

  await call(() => app.commands.executeCommandById("anke-writing:anke-init"));
  await waitFor(() =>
    call(() =>
      document
        .querySelector(".prompt input")
        ?.getAttribute("placeholder")
        ?.startsWith("anke init"),
    ),
  );
  await typeQuery(`${root}/Story`);
  await call((path) => {
    const row = [...document.querySelectorAll(".suggestion-item")].find(
      (el) => el.textContent === path,
    );
    if (!row) throw new Error("Target folder is missing from picker");
    row.click();
  }, `${root}/Story`);
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((p) => p.root === `${root}/Story`),
      root,
    ),
  );
  assert.equal(
    await call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .find((p) => p.root === `${root}/Story`).file.path,
      root,
    ),
    `${root}/Story/Story 3.md`,
  );
  assert.equal(
    await call(
      (root) => !!app.vault.getFileByPath(`${root}/Story/1-1 第一章.md`),
      root,
    ),
    false,
  );
  await assertPreserved();
  const afterFirst = await snapshot(`${root}/Story`);
  assert.deepEqual(await runInit(`${root}/Story`), {
    file: `${root}/Story/Story 3.md`,
    created: false,
  });
  assert.deepEqual(await snapshot(`${root}/Story`), afterFirst);
  console.log(
    "PASS: init avoids file/folder name collisions, preserves existing chapters/assets, creates no sample chapter, and reuses its config",
  );

  assert.deepEqual(await runInit(`${root}/Already`), {
    file: `${root}/Already/Custom.md`,
    created: false,
  });
  assert.equal(
    await call(
      (root) => !!app.vault.getFolderByPath(`${root}/Already/Characters`),
      root,
    ),
    true,
  );
  for (const folder of ["Conflict", "Multiple", "Malformed"]) {
    const beforeFailure = await snapshot(`${root}/${folder}`);
    assert.equal(
      await call(async (path) => {
        try {
          await app.plugins.plugins["anke-writing"].library.initProject(
            app.vault.getFolderByPath(path),
          );
          return false;
        } catch {
          return true;
        }
      }, `${root}/${folder}`),
      true,
    );
    assert.deepEqual(await snapshot(`${root}/${folder}`), beforeFailure);
    assert.equal(
      await call(
        (path) => !!app.vault.getFolderByPath(`${path}/Characters`),
        `${root}/${folder}`,
      ),
      false,
    );
  }
  await assertPreserved();
  console.log(
    "PASS: existing project metadata is untouched; conflicting resource paths, multiple configs and malformed YAML stop without overwriting files",
  );

  assert.deepEqual(await runInit(`${root}/Fresh`), {
    file: `${root}/Fresh/Fresh.md`,
    created: true,
  });
  assert.deepEqual(await runInit(`${root}/Fresh`), {
    file: `${root}/Fresh/Fresh.md`,
    created: false,
  });
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    for (const panel of p.views()) panel.leaf.detach();
    app.workspace.leftSplit.collapse();
    // Like init, open a new tab. Reusing the original fixture's tab makes
    // Obsidian itself normalize CRLF on file switch, outside this workflow.
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: { file: `${root}/Fresh/Fresh.md`, mode: "source" },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await p.openCharacters();
  }, root);
  const emptyVisible = () =>
    call(() => {
      const panel = app.plugins.plugins["anke-writing"].views()[0];
      return (
        !app.workspace.leftSplit.collapsed &&
        panel?.contentEl.querySelector(".anke-details button.mod-cta")
          ?.textContent === "添加角色"
      );
    });
  await waitFor(emptyVisible);
  await call(async () => {
    const panel = app.plugins.plugins["anke-writing"].views()[0];
    await panel.render();
    await panel.render();
  });
  assert.equal(await emptyVisible(), true);
  assert.equal(
    await call(
      (root) =>
        app.vault.getFolderByPath(`${root}/Fresh/Characters`).children.length,
      root,
    ),
    0,
  );
  await call(async (root) => {
    await app.fileManager.processFrontMatter(
      app.vault.getFileByPath(`${root}/Fresh/Fresh.md`),
      (fm) => {
        fm.characters = null;
      },
    );
  }, root);
  await waitFor(() =>
    call(
      (root) =>
        app.metadataCache.getFileCache(
          app.vault.getFileByPath(`${root}/Fresh/Fresh.md`),
        )?.frontmatter?.characters === null,
      root,
    ),
  );
  await call(async () => {
    await app.plugins.plugins["anke-writing"].views()[0].render();
  });
  assert.equal(await emptyVisible(), true);
  await call(() => {
    const panel = app.plugins.plugins["anke-writing"].views()[0];
    panel.contentEl.querySelector(".anke-details button.mod-cta").click();
    const input = document.querySelector(".modal input");
    input.value = "First role";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".modal button.mod-cta").click();
  });
  await waitFor(() =>
    call(
      () =>
        !document.querySelector(".modal") &&
        !!app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelector('.anke-character[title="First role"]'),
    ),
  );
  assert.deepEqual(
    await call(
      (root) =>
        app.metadataCache.getFileCache(
          app.vault.getFileByPath(`${root}/Fresh/Fresh.md`),
        ).frontmatter.characters,
      root,
    ),
    [`[[${root}/Fresh/Characters/First role/First role]]`],
  );
  await call(async (root) => {
    const library = app.plugins.plugins["anke-writing"].library;
    const project = library.projects().find((p) => p.root === `${root}/Fresh`);
    await library.setVisible(project, []);
  }, root);
  await waitFor(emptyVisible);
  await call(async (root) => {
    const library = app.plugins.plugins["anke-writing"].library;
    const project = library.projects().find((p) => p.root === `${root}/Fresh`);
    await library.setVisible(project, [
      `${root}/Fresh/Characters/First role/First role.md`,
    ]);
  }, root);
  await waitFor(() =>
    call(
      () =>
        !!app.plugins.plugins["anke-writing"]
          .views()[0]
          .contentEl.querySelector('.anke-character[title="First role"]'),
    ),
  );
  await call(async (root) => {
    const library = app.plugins.plugins["anke-writing"].library;
    const project = library.projects().find((p) => p.root === `${root}/Fresh`);
    await library.deleteCharacter(project, library.characters(project)[0]);
  }, root);
  await waitFor(emptyVisible);
  await call(async () => {
    await app.plugins.plugins["anke-writing"].views()[0].render();
  });
  assert.equal(await emptyVisible(), true);
  console.log(
    "PASS: fresh empty panel opens with [], blank characters, and no role files; the first-role form saves and appears; hiding/deleting the last role keeps creation available",
  );

  assert.deepEqual(await runInit(`${root}/Parent`), {
    file: `${root}/Parent/Parent.md`,
    created: true,
  });
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((p) => p.root === `${root}/Parent`),
      root,
    ),
  );
  assert.deepEqual(
    await call((root) => {
      const l = app.plugins.plugins["anke-writing"].library;
      return [
        l.chapterProject(
          app.vault.getFileByPath(`${root}/Parent/1-1 Parent.md`),
        )?.root,
        l.chapterProject(
          app.vault.getFileByPath(`${root}/Parent/Child/1-1 Child.md`),
        )?.root,
      ];
    }, root),
    [`${root}/Parent`, `${root}/Parent/Child`],
  );
  await call(async (root) => {
    await app.plugins.plugins["anke-writing"].library.createProject(
      `${root}-new`,
    );
  }, root);
  assert.equal(
    await call(
      (root) =>
        !!app.vault.getFileByPath(`${root}-new/1-1 第一章.md`) &&
        !!app.vault.getFolderByPath(`${root}-new/Characters`),
      root,
    ),
    true,
  );
  await assertPreserved();
  console.log(
    "PASS: immediate re-init is idempotent, nested projects retain nearest-folder ownership, and new-project creation still works",
  );
} finally {
  try {
    await key("Escape", "Escape");
    await call(async () => {
      const check = window.ankeInitCheck;
      if (!check) return;
      // Only close leaves opened on this test's files.
      for (const leaf of app.workspace.getLeavesOfType("markdown"))
        if (
          leaf === check.leaf ||
          leaf.view.file?.path.startsWith(check.root + "/") ||
          leaf.view.file?.path.startsWith(check.root + "-new/")
        )
          leaf.detach();
      const p = app.plugins.plugins["anke-writing"];
      await p.setCharacterFolderName(check.folder);
      for (const path of [check.root, check.root + "-new"]) {
        const folder = app.vault.getFolderByPath(path);
        if (folder) await app.vault.trash(folder, false);
      }
      if (check.active?.parent)
        app.workspace.setActiveLeaf(check.active, { focus: true });
      const panel = p.views()[0];
      if (panel) {
        panel.characterPath = check.character;
        await panel.render();
      }
      if (check.collapsed) app.workspace.leftSplit.collapse();
      delete window.ankeInitCheck;
    });
  } finally {
    c.close();
  }
}

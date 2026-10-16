import assert from "node:assert/strict";
import { connect } from "./test-client.mjs";

const c = await connect();
const call = (fn, ...args) =>
  c.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const root = `CharacterFolderCheck-${Date.now()}`;
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for character folder state");
};
const configure = (name, save = true) =>
  call(
    (name, save) => {
      app.setting.open();
      app.setting.openTabById("anke-writing");
      const container = app.setting.pluginTabs.find(
        (t) => t.id === "anke-writing",
      ).containerEl;
      const row = [...container.querySelectorAll(".setting-item")].find(
        (el) =>
          el.querySelector(".setting-item-name")?.textContent ===
          "Character folder name",
      );
      if (!row) throw new Error("Character folder name setting is missing");
      const input = row.querySelector("input");
      input.value = name;
      input.dispatchEvent(
        new input.ownerDocument.defaultView.Event("input", { bubbles: true }),
      );
      if (save) row.querySelector("button").click();
    },
    name,
    save,
  );
try {
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"];
    window.ankeFolderCheck = {
      root,
      folder: p.data.characterFolderName,
      active: app.workspace.activeLeaf,
      character: p.views()[0]?.characterPath,
      leaf: app.workspace.getLeaf("tab"),
    };
    await p.setCharacterFolderName("角色");
    await p.library.createProject(root);
  }, root);
  await waitFor(() =>
    call(
      (root) =>
        app.plugins.plugins["anke-writing"].library
          .projects()
          .some((p) => p.root === root),
      root,
    ),
  );
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((p) => p.root === root);
    await p.library.createCharacter(project, "Alpha");
    await app.vault.create(
      `${root}/角色/Alpha/assets/test.svg`,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    await app.vault.modify(
      app.vault.getFileByPath(`${root}/角色/Alpha/photo/默认.md`),
      "---\nanke-type: variants\n---\n\n- [Smile](../assets/test.svg)",
    );
  }, root);
  await waitFor(() =>
    call((root) => {
      const l = app.plugins.plugins["anke-writing"].library;
      return (
        l.characters(l.projects().find((p) => p.root === root)).length === 1
      );
    }, root),
  );
  console.log("PASS: existing/default character folder is still 角色");

  await configure("Characters", false);
  assert.equal(
    await call(
      () => app.plugins.plugins["anke-writing"].data.characterFolderName,
    ),
    "角色",
  );
  await configure("invalid/path");
  await waitFor(() =>
    call(() => {
      const doc = app.setting.pluginTabs.find((t) => t.id === "anke-writing")
        .containerEl.ownerDocument;
      return [...doc.querySelectorAll(".notice")].some((el) =>
        el.textContent.includes("名称不能为空"),
      );
    }),
  );
  for (const name of [
    "",
    " ",
    "..",
    "bad/name",
    "bad\\name",
    "CON",
    ".hidden",
  ]) {
    assert.equal(
      await call(async (name) => {
        try {
          await app.plugins.plugins["anke-writing"].setCharacterFolderName(
            name,
          );
          return false;
        } catch {
          return true;
        }
      }, name),
      true,
      name,
    );
  }
  assert.equal(
    await call(
      async () =>
        (await app.plugins.plugins["anke-writing"].loadData())
          .characterFolderName,
    ),
    "角色",
  );
  await configure("Characters");
  await waitFor(() =>
    call(
      async () =>
        (await app.plugins.plugins["anke-writing"].loadData())
          .characterFolderName === "Characters",
    ),
  );
  await call(() => app.setting.close());
  assert.deepEqual(
    await call((root) => {
      const l = app.plugins.plugins["anke-writing"].library,
        p = l.projects().find((p) => p.root === root);
      return {
        oldExists: !!app.vault.getFileByPath(`${root}/角色/Alpha/Alpha.md`),
        newExists: !!app.vault.getFolderByPath(`${root}/Characters`),
        roles: l.characters(p, false).length,
      };
    }, root),
    { oldExists: true, newExists: false, roles: 0 },
  );
  console.log(
    "PASS: the setting saves explicitly, rejects invalid names, and does not move or fall back to old folders",
  );

  await call(async (root) => {
    await app.fileManager.renameFile(
      app.vault.getFolderByPath(`${root}/角色`),
      `${root}/Characters`,
    );
  }, root);
  await waitFor(() =>
    call((root) => {
      const l = app.plugins.plugins["anke-writing"].library,
        p = l.projects().find((p) => p.root === root);
      return (
        l.characters(p, false)[0]?.file.path ===
        `${root}/Characters/Alpha/Alpha.md`
      );
    }, root),
  );
  await call(async (root) => {
    const p = app.plugins.plugins["anke-writing"],
      project = p.library.projects().find((p) => p.root === root);
    // Match the documented migration step even when the vault disables automatic link updates.
    await p.library.setVisible(project, [`${root}/Characters/Alpha/Alpha.md`]);
    await app.vault.create(
      `${root}/Characters/Alpha/1-2 Resource.md`,
      "Resource",
    );
    await p.library.createProject(`${root}-other`);
    const leaf = window.ankeFolderCheck.leaf;
    await leaf.setViewState({
      type: "markdown",
      state: { file: `${root}/1-1 第一章.md`, mode: "source" },
      active: true,
    });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await p.openCharacters();
  }, root);
  await waitFor(() =>
    call((root) => {
      const p = app.plugins.plugins["anke-writing"];
      return (
        p.library.projects().some((p) => p.root === `${root}-other`) &&
        p.views()[0].contentEl.querySelector('.anke-character[title="Alpha"]')
      );
    }, root),
  );
  assert.deepEqual(
    await call(async (root) => {
      const l = app.plugins.plugins["anke-writing"].library,
        p = l.projects().find((p) => p.root === root),
        c = l.characters(p)[0],
        groups = await l.groups(c),
        chapter = app.vault.getFileByPath(`${root}/1-1 第一章.md`);
      return {
        label: groups[0].entries[0].label,
        url: l.insertionUrl(groups[0].entries[0].url, groups[0].file, chapter),
        resourceIsChapter: !!l.chapterProject(
          app.vault.getFileByPath(`${root}/Characters/Alpha/1-2 Resource.md`),
        ),
        newFolder: !!app.vault.getFolderByPath(`${root}-other/Characters`),
        oldFolder: !!app.vault.getFolderByPath(`${root}-other/角色`),
      };
    }, root),
    {
      label: "Smile",
      url: "Characters/Alpha/assets/test.svg",
      resourceIsChapter: false,
      newFolder: true,
      oldFolder: false,
    },
  );

  await call(async (root) => {
    const l = app.plugins.plugins["anke-writing"].library,
      source = l.projects().find((p) => p.root === root),
      target = l.projects().find((p) => p.root === `${root}-other`);
    await l.createCharacter(target, "Beta");
    await l.copyCharacter(l.characters(source)[0], target, "Copied");
  }, root);
  await waitFor(() =>
    call((root) => {
      const l = app.plugins.plugins["anke-writing"].library,
        project = l.projects().find((p) => p.root === `${root}-other`);
      return project && l.characters(project).length === 2;
    }, root),
  );
  assert.equal(
    await call(
      (root) =>
        !!app.vault.getFileByPath(
          `${root}-other/Characters/Copied/assets/test.svg`,
        ),
      root,
    ),
    true,
  );
  assert.equal(
    await call(async (root) => {
      const l = app.plugins.plugins["anke-writing"].library,
        source = l.projects().find((p) => p.root === root),
        target = l.projects().find((p) => p.root === `${root}-other`),
        copy = l.characters(target).find((c) => c.name === "Copied");
      try {
        await l.deleteCharacter(source, copy);
        return false;
      } catch {
        return true;
      }
    }, root),
    true,
  );
  await call(async (root) => {
    const l = app.plugins.plugins["anke-writing"].library,
      target = l.projects().find((p) => p.root === `${root}-other`);
    await l.deleteCharacter(
      target,
      l.characters(target).find((c) => c.name === "Copied"),
    );
  }, root);
  assert.deepEqual(
    await call(
      (root) => ({
        copy: !!app.vault.getFolderByPath(`${root}-other/Characters/Copied`),
        source: !!app.vault.getFolderByPath(`${root}/Characters/Alpha`),
        beta: !!app.vault.getFolderByPath(`${root}-other/Characters/Beta`),
      }),
      root,
    ),
    { copy: false, source: true, beta: true },
  );
  console.log(
    "PASS: custom folder supports sidebar discovery, images, new projects/roles, copies, chapter exclusion and project-bounded deletion",
  );

  await call(async () => {
    await app.plugins.disablePlugin("anke-writing");
    await app.plugins.enablePlugin("anke-writing");
    await app.plugins.plugins["anke-writing"].openCharacters();
  });
  assert.deepEqual(
    await call(() => {
      const p = app.plugins.plugins["anke-writing"];
      return {
        saved: p.data.characterFolderName,
        library: p.library.characterFolderName,
        name: p.manifest.name,
      };
    }),
    { saved: "Characters", library: "Characters", name: "obs-anker" },
  );
  await configure("Characters", false);
  await call(() => app.setting.close());
  console.log(
    "PASS: folder setting and obs-anker display name survive plugin reload",
  );
} finally {
  try {
    await call(async () => {
      const check = window.ankeFolderCheck;
      if (!check) return;
      app.setting.close();
      check.leaf.detach();
      const p = app.plugins.plugins["anke-writing"];
      await p.setCharacterFolderName(check.folder);
      for (const root of [check.root, `${check.root}-other`]) {
        const folder = app.vault.getFolderByPath(root);
        if (folder) await app.vault.trash(folder, false);
      }
      if (check.active?.parent)
        app.workspace.setActiveLeaf(check.active, { focus: true });
      const panel = p.views()[0];
      if (panel) {
        panel.characterPath = check.character;
        await panel.render();
      }
      delete window.ankeFolderCheck;
    });
  } finally {
    c.close();
  }
}

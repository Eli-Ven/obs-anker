import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import type { Editor, TFile, WorkspaceParent } from "obsidian";
import type AnkePlugin from "../src/main";
import type { Publisher as PublisherType, Pending } from "../src/publish";
import type { Project } from "../src/library";
import { timingTags, stripTiming } from "../src/document";

// Execute production controllers offline. Obsidian UI is stubbed; send is replaced
// on normal controller fixtures; image integration tests stub HTTPS instead.
class Empty {}
class MarkdownView {
  constructor(
    public file: TFile,
    public editor: Editor,
    public mode = "source",
  ) {}
  getMode() {
    return this.mode;
  }
}
class Modal {
  static opened: {
    heading: string;
    submit: (values: Record<string, string>) => Promise<void>;
  };
  open() {
    Modal.opened = this as unknown as typeof Modal.opened;
  }
}
const obsidian = {
  MarkdownView,
  Modal,
  Notice: Empty,
  Plugin: Empty,
  PluginSettingTab: Empty,
  ItemView: Empty,
  MarkdownRenderChild: Empty,
  FuzzySuggestModal: Empty,
  SuggestModal: Empty,
};
const require = createRequire(import.meta.url);
function load<T>(entry: string, overrides: Record<string, unknown> = {}): T {
  const code = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["obsidian"],
    logLevel: "silent",
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function("require", "module", "exports", "createImageBitmap", code)(
    (id: string) => (id === "obsidian" ? obsidian : overrides[id] ?? require(id)),
    module,
    module.exports,
    overrides.createImageBitmap,
  );
  return module.exports as T;
}
const { Publisher } = load<{ Publisher: typeof PublisherType }>(
  "src/publish.ts",
);
const { default: Plugin } = load<{ default: typeof AnkePlugin }>("src/main.ts");

function setup(initial: string, at: string) {
  let text = initial;
  const file = {
    path: "project/1-1 Chapter.md",
    basename: "1-1 Chapter",
  } as TFile;
  const project = {
    file: { path: "project/Project.md" } as TFile,
    root: "project",
    name: "Project",
    thread: "https://bbs.nga.cn/read.php?tid=42420001",
    characters: [],
  } as Project;
  const editor = {
    getValue: () => text,
    getCursor: () => ({ line: 0, ch: 0 }),
    posToOffset: () => text.indexOf(at),
  } as unknown as Editor;
  const sent: Pending[] = [];
  const p = Object.create(Plugin.prototype) as AnkePlugin;
  let beforePatch: (() => void | Promise<void>) | undefined;
  Object.assign(p, {
    deviceId: "test-device",
    data: { executor: "test-device", journal: {} },
    app: { secretStorage: { getSecret: () => "test-cookie" } },
    library: {
      chapterProject: (f: TFile) => (f === file ? project : undefined),
      patch: async (f: TFile, transform: (text: string) => string) => {
        assert.equal(f, file);
        await beforePatch?.();
        text = transform(text);
      },
      read: async (f: TFile) => {
        assert.equal(f, file);
        return text;
      },
    },
  });
  const publisher = new Publisher(p);
  publisher.send = async (item) => {
    sent.push(item);
  };
  p.publisher = publisher;
  return {
    p,
    publisher,
    project,
    file,
    editor,
    sent,
    getText: () => text,
    setText: (value: string) => {
      text = value;
    },
    beforePatch: (fn: () => void | Promise<void>) => {
      beforePatch = fn;
    },
  };
}

test("current publication targets the cursor even when earlier and later sections are marked sent", async () => {
  const original =
    '[timingpost task="first" sent="2030-01-01"]\nFirst.\n[/timingpost]\n\n---\n\nMiddle.\n\n---\n\n[timingpost task="last" marked="2030-01-02"]\nLast.\n[/timingpost]';
  const f = setup(original, "Middle.");
  await f.publisher.publishCurrent(f.file, f.editor);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].file, f.file);
  assert.equal(f.sent[0].tag.body, "Middle.");
  assert.deepEqual(
    timingTags(f.getText())
      .filter((t) => ["first", "last"].includes(t.attrs.task))
      .map((t) => t.attrs),
    timingTags(original).map((t) => t.attrs),
  );
  assert.equal(
    stripTiming(f.getText()).replace(/\s/g, ""),
    stripTiming(original).replace(/\s/g, ""),
  );
  assert.equal(f.publisher.busy, false);
  await assert.rejects(
    f.publisher.publishCurrent(f.file, f.editor),
    /已有发布记录/,
  );
  assert.equal(f.sent.length, 1);
});

test("empty or already scheduled/published current sections cannot be sent", async () => {
  for (const attrs of [
    'time="2030-01-01T00:00:00Z"',
    'sent="2030-01-01"',
    'marked="2030-01-01"',
  ]) {
    const initial = `[timingpost task="existing" ${attrs}]\nTarget.\n[/timingpost]`;
    const f = setup(initial, "Target.");
    await assert.rejects(
      f.publisher.publishCurrent(f.file, f.editor),
      /已有发布记录/,
    );
    assert.equal(f.getText(), initial);
    assert.equal(f.sent.length, 0);
    assert.equal(f.publisher.busy, false);
  }
  const empty = setup("\n", "\n");
  await assert.rejects(
    empty.publisher.publishCurrent(empty.file, empty.editor),
    /没有可发布内容/,
  );
  assert.equal(empty.sent.length, 0);
});

test("document changes between click and patch abort instead of publishing a shifted section", async () => {
  const f = setup("First.\n\n---\n\nTarget.", "Target.");
  const edited = "New section.\n\n---\n\n" + f.getText();
  f.beforePatch(() => f.setText(edited));
  await assert.rejects(
    f.publisher.publishCurrent(f.file, f.editor),
    /正文已改变/,
  );
  assert.equal(f.getText(), edited);
  assert.equal(f.sent.length, 0);
  assert.equal(f.publisher.busy, false);
});

test("double clicks cannot create two tasks during an in-flight publication", async () => {
  const f = setup("Target.", "Target.");
  let release!: () => void;
  f.beforePatch(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = f.publisher.publishCurrent(f.file, f.editor);
  await assert.rejects(
    f.publisher.publishCurrent(f.file, f.editor),
    /正在执行/,
  );
  release();
  await first;
  assert.equal(f.sent.length, 1);
  assert.equal(timingTags(f.getText()).length, 1);
});

test("sidebar resolves the current editor in its own window and rejects stale project, notes, and preview", () => {
  const f = setup("Target.", "Target.");
  const root = {} as WorkspaceParent;
  let view: MarkdownView | undefined = new MarkdownView(f.file, f.editor);
  Object.assign(f.p.app, {
    workspace: {
      getMostRecentLeaf: (requested: unknown) => {
        assert.equal(requested, root);
        return { view };
      },
    },
  });
  assert.deepEqual(f.p.currentWritingEditor(root, f.project), {
    file: f.file,
    editor: f.editor,
  });
  assert.throws(
    () =>
      f.p.currentWritingEditor(root, {
        ...f.project,
        file: { path: "other/Project.md" } as TFile,
      }),
    /当前项目正文/,
  );
  view.mode = "preview";
  assert.throws(
    () => f.p.currentWritingEditor(root, f.project),
    /编辑项目正文/,
  );
  view = new MarkdownView({ path: "project/Character.md" } as TFile, f.editor);
  assert.throws(
    () => f.p.currentWritingEditor(root, f.project),
    /当前项目正文/,
  );
  view = undefined;
  assert.throws(
    () => f.p.currentWritingEditor(root, f.project),
    /编辑项目正文/,
  );
});

test("automatic scheduling captures the current section without sending it", async () => {
  const f = setup("First.\n\n---\n\nTarget.\n\n---\n\nLast.", "Target.");
  f.p.schedule(f.file, f.editor);
  assert.match(Modal.opened.heading, /设置自动发布.*分节 2/);
  const time = new Date(Date.now() + 3600000).toISOString();
  // Moving the cursor after opening the form does not change its captured target.
  f.editor.posToOffset = () => 0;
  await Modal.opened.submit({ time });
  const tags = timingTags(f.getText());
  assert.equal(tags.length, 1);
  assert.equal(tags[0].body, "Target.");
  assert.equal(tags[0].attrs.time, time);
  assert.equal(f.sent.length, 0);
});

function imagePublication(imageState: "valid" | "missing" | "invalid" | "incomplete", editWhileReading = false) {
  const path = "mon_202610/05/example.webp";
  const url = `https://img.nga.cn/attachments/${path}.thumb.jpg`;
  const f = setup(
    `[timingpost task="image"]\n![image](${url})\n[/timingpost]`,
    "![image]",
  );
  const calls: { url: URL; body?: string }[] = [];
  const https = {
    request: (
      url: URL,
      options: { headers: Record<string, string> },
      callback: (res: EventEmitter) => void,
    ) => {
      const req = Object.assign(new EventEmitter(), {
        setTimeout: () => {},
        end: (body?: string) => {
          calls.push({ url, body });
          const isImage = url.hostname === "img.nga.cn";
          if (isImage) {
            assert.equal(options.headers.Cookie, undefined);
            assert.equal(body, undefined);
          } else assert.equal(url.pathname, "/post.php", "Never query the thread for image verification");
          queueMicrotask(() => {
            const res = Object.assign(new EventEmitter(), {
              statusCode: isImage && imageState === "missing" ? 404 : 200,
              complete: !isImage || imageState !== "incomplete",
              resume: () => {},
              headers: { "content-type": isImage ? "image/gif" : "application/json; charset=utf-8" },
            });
            callback(res);
            const text = isImage
              ? (imageState === "invalid" ? "<html>error</html>" : "fixture-image")
              : body ? "<__MESSAGE>发帖完毕</__MESSAGE>"
                : JSON.stringify({ data: { tid: 42420001, pid: "", fid: 784 } });
            res.emit("data", Buffer.from(text));
            if (editWhileReading && isImage)
              f.setText(
                f.getText().replace("![image]", "正文改变了\n![image]"),
              );
            res.emit("end");
          });
        },
      });
      return req;
    },
  };
  const { Publisher: ImagePublisher } = load<{
    Publisher: typeof PublisherType;
  }>("src/publish.ts", {
    "node:https": https,
    createImageBitmap: async (blob: Blob) => {
      if (await blob.text() !== "fixture-image") throw new Error("Decode failed");
      return { width: 100, height: 100, close: () => {} };
    },
  });
  const publisher = new ImagePublisher(f.p);
  publisher.pending = async () =>
    timingTags(f.getText()).map((tag) => ({
      file: f.file,
      project: f.project,
      tag,
    }));
  f.p.persist = async () => {};
  f.p.refresh = () => {};
  const send = async () => publisher.send((await publisher.pending())[0]);
  return { ...f, calls, send, path };
}

test("a missing size stops publishing even when the HTTP error contains an image", async () => {
  const f = imagePublication("missing");
  const before = f.getText();
  await assert.rejects(f.send(), /HTTP 404/);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls.every((call) => call.body === undefined));
  assert.deepEqual(f.p.data.journal, {});
  assert.equal(f.getText(), before);
});

test("publishing sends the verified relative thumbnail while Markdown retains the full URL", async () => {
  const f = imagePublication("valid");
  await f.send();
  const posts = f.calls.filter((call) => call.body);
  assert.equal(posts.length, 1);
  const body = new URLSearchParams(posts[0].body);
  assert.equal(body.get("post_content"), `[img]./${f.path}.thumb.jpg[/img]`);
  assert.equal(body.get("tid"), "42420001");
  assert.ok(
    f.getText().includes(`https://img.nga.cn/attachments/${f.path}.thumb.jpg`),
  );
  assert.equal(f.p.data.journal.image.status, "sent");
});

test("edits during image verification stop publishing before the first POST", async () => {
  const f = imagePublication("valid", true);
  await assert.rejects(f.send(), /核验期间正文/);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls.every((call) => call.body === undefined));
  assert.deepEqual(f.p.data.journal, {});
});


test("incomplete downloads and undecodable responses stop before any publication", async () => {
  for (const state of ["invalid", "incomplete"] as const) {
    const f = imagePublication(state);
    await assert.rejects(f.send(), /有效图片|下载未完成/);
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls.every((call) => call.body === undefined));
    assert.deepEqual(f.p.data.journal, {});
  }
});

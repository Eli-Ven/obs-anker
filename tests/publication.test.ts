import test from "node:test";
import assert from "node:assert/strict";
import {
  eligible,
  sendRecorded,
  type Journal,
  type JournalEntry,
} from "../src/publication";
import { timingTags } from "../src/document";
import { parseReceipt, threadUrl } from "../src/nga";
const due = Date.parse("2030-01-01T00:00:00Z");
const tag = timingTags(
  '[timingpost task="one" time="2030-01-01T00:00:00Z"]\nbody\n[/timingpost]',
)[0];
const entry = (): JournalEntry => ({
  status: "sending",
  file: "project/chapter.md",
  thread: "https://bbs.nga.cn/read.php?tid=1",
  time: new Date(due).toISOString(),
  content: "latest text",
  message: "sending",
});
test("only a unique, newly due task executes automatically", () => {
  assert.equal(eligible(tag, {}, 1, due - 10, due - 1000), "wait");
  assert.equal(eligible(tag, {}, 1, due + 1000, due - 1000), "due");
  assert.equal(eligible(tag, {}, 2, due + 1000, due - 1000), "blocked");
  assert.equal(eligible(tag, {}, 1, due + 1000, due + 500), "missed");
  assert.equal(eligible(tag, {}, 1, due + 60000, due - 1000), "missed");
});
test("undoing a sent tag or restarting an interrupted request cannot repost", () => {
  for (const status of [
    "sending",
    "sent",
    "unknown",
    "failed",
    "missed",
    "blocked",
  ] as const)
    assert.equal(
      eligible(tag, { one: { ...entry(), status } }, 1, due + 1000, due - 1000),
      "wait",
    );
});
test("the sending journal is durably saved before any external request", async () => {
  const journal: Journal = {},
    order: string[] = [];
  await sendRecorded(
    journal,
    "one",
    entry(),
    async () => {
      order.push(journal.one.status);
    },
    async () => {
      order.push("network");
      return { status: "sent", message: "ok", pid: "123" };
    },
  );
  assert.deepEqual(order, ["sending", "network", "sent"]);
  assert.equal(journal.one.content, "latest text");
  await assert.rejects(
    () =>
      sendRecorded(
        journal,
        "one",
        entry(),
        async () => {},
        async () => {
          throw new Error("must not call");
        },
      ),
    /不能重复/,
  );
});
test("failure to persist the journal prevents a network side effect", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      sendRecorded(
        {},
        "one",
        entry(),
        async () => {
          throw new Error("disk full");
        },
        async () => {
          calls++;
          return { status: "sent", message: "ok" };
        },
      ),
    /disk full/,
  );
  assert.equal(calls, 0);
});
test("a lost reply becomes unknown, never a retryable success assumption", async () => {
  const journal: Journal = {};
  const result = await sendRecorded(
    journal,
    "one",
    entry(),
    async () => {},
    async () => {
      throw new Error("timeout");
    },
  );
  assert.equal(result.status, "unknown");
  assert.equal(journal.one.status, "unknown");
});
test("NGA receipts use server messages and their own reply PID, not page content or highest floor", () => {
  assert.equal(parseReceipt("some post says 发布成功").status, "unknown");
  assert.equal(
    parseReceipt("<__ERROR>login required</__ERROR>").status,
    "failed",
  );
  assert.deepEqual(
    parseReceipt(
      '<__MESSAGE>发表成功 <a href="read.php?tid=1&amp;pid=99">reply</a></__MESSAGE>',
    ),
    { status: "sent", message: "发表成功 reply", pid: "99" },
  );
  assert.equal(parseReceipt("<__MESSAGE>发帖完毕</__MESSAGE>").pid, undefined);
});
test("cookies are bound to NGA hosts; spoofed URLs and redirects are not accepted as thread bindings", () => {
  assert.equal(
    threadUrl("http://bbs.nga.cn/read.php?tid=42&page=8"),
    "https://bbs.nga.cn/read.php?tid=42",
  );
  for (const url of [
    "https://bbs.nga.cn.example.org/read.php?tid=1",
    "https://bbs.nga.cn@evil.test/read.php?tid=1",
    "https://bbs.nga.cn:444/read.php?tid=1",
    "https://bbs.nga.cn/post.php?tid=1",
  ])
    assert.throws(() => threadUrl(url));
});

test("floor lookup identifies our reply by PID even when later replies already exist", async () => {
  const { replyFloor } = await import("../src/nga");
  const page =
    '<tr id="post1strow23"><td><a id="pid100Anchor"></a></td></tr><tr id="post1strow24"><td><a id="pid101Anchor"></a></td></tr>';
  assert.equal(replyFloor(page, "100"), "23");
  assert.equal(replyFloor(page, "101"), "24");
  assert.equal(replyFloor(page, "102"), undefined);
});

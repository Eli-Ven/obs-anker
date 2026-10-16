import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReceipt,
  parseReplyData,
  postReply,
  prepareReply,
} from "../src/nga";

const target = "https://bbs.nga.cn/read.php?tid=42420001";
const cookie = "test-cookie=fixture";
const tid = "42420001";
const form = JSON.stringify({ data: { fid: -7, tid: 42420001, pid: 0 } });
// Actual anonymous __output=8 response, with its timestamp omitted.
const loginApi = JSON.stringify({
  error: { 0: "2048:你没有登录", 1: "", 2: "" },
  data: { __MESSAGE: { 0: 2048, 1: "你没有登录", 3: 200 } },
  encode: "gbk",
});
// Error markers observed on an anonymous GET of the bound thread's reply page.
const login = `<title>你没有登录</title>
(ERROR:<!--msgcodestart-->2048<!--msgcodeend-->)
<!--msginfostart-->你没有登录<!--msginfoend-->`;
type RequestPage = NonNullable<Parameters<typeof postReply>[3]>;
function mock(...responses: (string | Error)[]) {
  const calls: Parameters<RequestPage>[] = [];
  const request: RequestPage = async (...args) => {
    calls.push(args);
    const response = responses[calls.length - 1];
    assert.notEqual(
      response,
      undefined,
      "Unexpected request or automatic retry",
    );
    if (response instanceof Error) throw response;
    return response as string;
  };
  return { calls, request };
}

test("reply preparation reads numeric or string IDs from JSON, without HTML inputs", () => {
  assert.equal(parseReplyData(form, tid), "-7");
  assert.equal(
    parseReplyData(
      JSON.stringify({
        data: { fid: "7", tid, pid: "0", content: "", __F: { fid: 999 } },
      }),
      tid,
    ),
    "7",
  );
});

// Routing fields observed in the user's authenticated connection-check response.
const threadReply = JSON.stringify({
  data: { action: "reply", tid: 42420001, pid: "", fid: 784 },
});

test("authenticated thread reply may use an empty PID while the check remains read-only", async () => {
  assert.equal(parseReplyData(threadReply, tid), "784");
  const { calls, request } = mock(threadReply);
  assert.equal(await prepareReply(target, cookie, request), "784");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], undefined);
});

test("empty response PID still submits the bound thread and canonical zero PID", async () => {
  const { calls, request } = mock(
    threadReply,
    "<__MESSAGE>发帖完毕</__MESSAGE>",
  );
  const result = await postReply(target, "正文", cookie, request);
  assert.equal(result.status, "sent");
  assert.equal(calls.length, 2);
  const body = new URLSearchParams(calls[1][3]);
  assert.equal(body.get("tid"), tid);
  assert.equal(body.get("pid"), "0");
  assert.equal(body.get("fid"), "784");
  assert.equal(body.get("post_content"), "正文");
});

test("reply preparation rejects invalid data and IDs for a different reply target", () => {
  for (const data of [
    null,
    {},
    { fid: -7 },
    { fid: -7, tid: 999, pid: 0 },
    { fid: -7, tid, pid: 99 },
    { fid: -7, tid, pid: null },
    { fid: -7, tid },
    { fid: -7, tid: 999, pid: "" },
    { fid: -7, tid, pid: false },
    { fid: -7, tid, pid: " " },
    { fid: -7, tid, pid: "99" },
    { fid: -7, tid: [tid], pid: 0 },
    { fid: -7, tid, pid: [0] },
  ])
    assert.throws(
      () => parseReplyData(JSON.stringify({ data }), tid),
      /回复目标/,
    );
  for (const fid of [undefined, null, "", "12x", 0, [], [7], {}, true, 1.5])
    assert.throws(
      () => parseReplyData(JSON.stringify({ data: { fid, tid, pid: 0 } }), tid),
      /版面 ID/,
    );
});

test("JSON login errors take precedence over returned data and explain saved Cookie", () => {
  assert.throws(
    () => parseReplyData(loginApi, tid),
    /2048:你没有登录.*更新插件设置里的 NGA Cookie/s,
  );
  assert.throws(
    () =>
      parseReplyData(
        JSON.stringify({
          error: { 0: "你没有登录" },
          data: { fid: -7, tid, pid: 0 },
        }),
        tid,
      ),
    /你没有登录/,
  );
});

test("captcha and permission errors retain the server explanation", () => {
  assert.throws(
    () =>
      parseReplyData(
        JSON.stringify({ error: { 0: "需要验证码", 1: "请重试" } }),
        tid,
      ),
    /需要验证码；请重试.*浏览器完成验证/,
  );
  assert.throws(
    () => parseReplyData(JSON.stringify({ error: ["禁止回复"] }), tid),
    /^Error: 禁止回复$/,
  );
  assert.throws(
    () => parseReplyData(JSON.stringify({ error: "没有权限" }), tid),
    /^Error: 没有权限$/,
  );
});

test("HTML error pages are still explained, but HTML or script fields cannot authorize POST", () => {
  assert.throws(
    () => parseReplyData(login, tid),
    /你没有登录.*2048.*更新插件设置里的 NGA Cookie/s,
  );
  assert.throws(
    () => parseReplyData("<__ERROR>需要验证码</__ERROR>", tid),
    /浏览器完成验证/,
  );
  assert.throws(
    () =>
      parseReplyData(
        "<title>NGA玩家社区</title><input name=fid value=-7>",
        tid,
      ),
    /未返回 JSON（页面：NGA玩家社区）/,
  );
  assert.throws(
    () => parseReplyData("window.script_muti_get_var_store=" + form, tid),
    /未返回 JSON/,
  );
  assert.equal(parseReceipt(login).status, "failed");
});

test("connection check is exactly one GET requesting structured reply preparation", async () => {
  const { calls, request } = mock(form);
  assert.equal(await prepareReply(target, cookie, request), "-7");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0].href,
    "https://bbs.nga.cn/post.php?action=reply&tid=42420001&pid=0&__output=8",
  );
  assert.equal(calls[0][1], cookie);
  assert.equal(calls[0][2], target);
  assert.equal(calls[0][3], undefined);
});

test("invalid bindings and empty or multiline Cookies never cause a request", async () => {
  const { calls, request } = mock();
  await assert.rejects(
    prepareReply("https://evil.test/read.php?tid=1", cookie, request),
  );
  for (const value of ["", "  ", "a=b\r\nx=y"])
    await assert.rejects(prepareReply(target, value, request));
  assert.equal(calls.length, 0);
});

test("failed preflight never submits content and reports that nothing was sent", async () => {
  for (const response of [
    login,
    loginApi,
    JSON.stringify({ data: { fid: -7, tid: 999, pid: 0 } }),
    "<title>Unknown page</title>",
    new Error("timeout"),
  ]) {
    const { calls, request } = mock(response);
    const result = await postReply(target, "正文", cookie, request);
    assert.equal(result.status, "failed");
    assert.match(result.message, /^正文未发送：/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][3], undefined);
  }
});

test("successful preflight preserves Unicode content and the reply protocol", async () => {
  const { calls, request } = mock(form, "<__MESSAGE>发帖完毕</__MESSAGE>");
  const content = "中文 [dice]1d100[/dice]\n[color=red]对白 & + %[/color]";
  assert.equal(
    (await postReply(target, content, cookie, request)).status,
    "sent",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0].href, "https://bbs.nga.cn/post.php");
  assert.equal(calls[1][1], cookie);
  assert.equal(calls[1][2], target);
  const body = new URLSearchParams(calls[1][3]);
  assert.deepEqual(Object.fromEntries(body), {
    action: "reply",
    tid: "42420001",
    pid: "0",
    fid: "-7",
    step: "2",
    nojump: "1",
    lite: "xml",
    __inchst: "UTF8",
    post_content: content,
  });
});

test("lost or unrecognized POST response remains unknown without automatic retry", async () => {
  for (const response of [new Error("timeout"), "unrecognized response"]) {
    const { calls, request } = mock(form, response);
    const result = await postReply(target, "正文", cookie, request);
    assert.equal(result.status, "unknown");
    assert.match(result.message, /不会自动重发/);
    assert.equal(calls.length, 2);
  }
});

test("explicit errors after submission are failed, while failed floor lookup remains sent", async () => {
  const failed = mock(form, login);
  assert.equal(
    (await postReply(target, "正文", cookie, failed.request)).status,
    "failed",
  );
  assert.equal(failed.calls.length, 2);
  const sent = mock(
    form,
    '<__MESSAGE>发表成功 <a href="read.php?tid=42420001&amp;pid=99">reply</a></__MESSAGE>',
    new Error("floor lookup timeout"),
  );
  const receipt = await postReply(target, "正文", cookie, sent.request);
  assert.equal(receipt.status, "sent");
  assert.equal(receipt.pid, "99");
  assert.equal(receipt.floor, undefined);
  assert.equal(sent.calls.length, 3);
  assert.equal(sent.calls[2][3], undefined);
});

test("reply diagnostics show routing IDs without exposing private response data", () => {
  const response = {
    data: {
      fid: 7,
      tid: 42420001,
      pid: null,
      auth: "attachment-secret",
      subject: "private-title",
      content: "private-draft",
      __CU: { uid: 123456, name: "private-user" },
      0: { fid: 7, auth: "nested-secret" },
    },
  };
  let message = "";
  try {
    parseReplyData(JSON.stringify(response), tid);
  } catch (error) {
    message = String(error);
  }
  assert.match(message, /tid=42420001，pid=null，fid=7/);
  assert.ok(!message.includes("顶层字段"));
  for (const secret of [
    "attachment-secret",
    "private-title",
    "private-draft",
    "private-user",
    "123456",
    "nested-secret",
  ])
    assert.ok(!message.includes(secret));
});

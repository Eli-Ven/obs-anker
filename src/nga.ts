// Publishing logic follows our local AnkeCreator additions (commit 793eec2),
// not files present in upstream origin/main at da02c46. NGA HTML anchor formats
// were cross-checked against the upstream crawler; see THIRD_PARTY_NOTICES.md.
import { request } from "node:https";
import { absoluteNGAImageUrl, ngaImage } from "./nga-images";
import { toBBCode } from "./export";

export interface Receipt {
  status: "sent" | "failed" | "unknown";
  message: string;
  pid?: string;
  floor?: string;
}
export function threadUrl(value: string): string {
  const invalid = "请输入 NGA 主题链接（read.php?tid=…）。";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(invalid);
  }
  const tid = url.searchParams.get("tid");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !["bbs.nga.cn", "ngabbs.com", "nga.178.com"].includes(url.hostname) ||
    url.pathname !== "/read.php" ||
    !tid ||
    !/^[1-9]\d*$/.test(tid)
  )
    throw new Error(invalid);
  return `https://${url.hostname}/read.php?tid=${tid}`;
}
function plain(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function serverError(body: string): string | undefined {
  const xml = body.match(/<__ERROR(?:\s[^>]*)?>([\s\S]*?)<\/__ERROR>/i);
  if (xml) return plain(xml[1]) || "NGA 返回发布错误。";
  // NGA also returns HTTP 200 HTML error pages, e.g. login error 2048.
  const code = body.match(
    /<!--msgcodestart-->\s*(-?\d+)\s*<!--msgcodeend-->/i,
  )?.[1];
  const info = body.match(/<!--msginfostart-->([\s\S]*?)<!--msginfoend-->/i);
  if (code && code !== "0" && info)
    return `${plain(info[1])}（错误码 ${code}）`;
}

function replyError(message: string): Error {
  if (
    /没有登[录入]|未登[录入]|尚未登[录入]|重新登录|login required/i.test(
      message,
    )
  )
    return new Error(
      `${message}。请更新插件设置里的 NGA Cookie；浏览器登录不会自动更新已保存的 Cookie。`,
    );
  if (/验证码|人机验证/.test(message))
    return new Error(
      `${message}。请先在浏览器完成验证，再更新插件中的 Cookie。`,
    );
  return new Error(message);
}

// Only expose numeric routing IDs, never response content or auth.
function replyDataDetails(data: unknown): string {
  const field = (value: unknown): string => {
    if (value === undefined) return "缺失";
    if (value === null) return "null";
    if (value === "") return "空字符串";
    if (
      (typeof value === "string" || typeof value === "number") &&
      /^-?\d{1,15}$/.test(String(value))
    )
      return String(value);
    return Array.isArray(value) ? "数组" : typeof value;
  };
  const values =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return `tid=${field(values.tid)}，pid=${field(values.pid)}，fid=${field(values.fid)}`;
}

export function parseReplyData(body: string, tid: string): string {
  let response;
  try {
    response = JSON.parse(body);
  } catch {
    const error = serverError(body);
    if (error) throw replyError(error);
    const title = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    throw new Error(
      `NGA 回复准备接口未返回 JSON${title ? `（页面：${plain(title)}）` : ""}。`,
    );
  }
  if (response?.error) {
    const parts =
      typeof response.error === "object"
        ? Object.values(response.error)
        : [response.error];
    const message = parts
      .filter((part) => typeof part === "string" || typeof part === "number")
      .map((part) => plain(String(part)))
      .filter(Boolean)
      .join("；");
    throw replyError(message || "NGA 拒绝了回复准备请求。");
  }
  const id = (value: unknown): string =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const data = response?.data;
  // NGA returns pid="" when replying to the thread rather than a specific post.
  if (
    !data ||
    id(data.tid) !== tid ||
    (data.pid !== "" && id(data.pid) !== "0")
  )
    throw new Error(
      `NGA 回复目标校验未通过（期望 tid=${tid}）。${replyDataDetails(data)}`,
    );
  const fid = id(data.fid);
  if (!/^-?[1-9]\d*$/.test(fid))
    throw new Error(
      `NGA 回复准备数据中没有有效的版面 ID（fid）。${replyDataDetails(data)}`,
    );
  return fid;
}

export function parseReceipt(body: string): Receipt {
  const error = serverError(body);
  if (error) return { status: "failed", message: error };
  const message = body.match(/<__MESSAGE(?:\s[^>]*)?>([\s\S]*?)<\/__MESSAGE>/i);
  if (!message || !/发[帖贴]完毕|发表成功|发布成功/.test(plain(message[1])))
    return {
      status: "unknown",
      message: "无法确认是否发布成功，请到帖子核对；不会自动重发。",
    };
  return {
    status: "sent",
    message: plain(message[1]),
    pid: message[1].match(/[?&](?:amp;)?pid=(\d+)/)?.[1],
  };
}
export function replyFloor(html: string, pid: string): string | undefined {
  if (!/^\d+$/.test(pid)) return undefined;
  const rows = [...html.matchAll(/<tr\b[^>]*\bid=['"]post1strow(\d+)['"]/gi)];
  for (let i = 0; i < rows.length; i++) {
    const body = html.slice(rows[i].index, rows[i + 1]?.index ?? html.length);
    if (new RegExp(`\\bid=['"]pid${pid}Anchor['"]`, "i").test(body))
      return rows[i][1];
  }
  return undefined;
}
function http(
  url: URL,
  cookie: string,
  referer: string,
  body?: string,
): Promise<string> {
  // Node HTTPS deliberately does not follow redirects with the Cookie header.
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: cookie,
          Referer: referer,
          Origin: url.origin,
          "User-Agent": "Mozilla/5.0",
          "Content-Type": "application/x-www-form-urlencoded",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`NGA 返回 HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("error", reject);
        res.on("end", () =>
          resolve(
            new TextDecoder(
              /utf-?8/i.test(String(res.headers["content-type"]))
                ? "utf-8"
                : "gb18030",
            ).decode(Buffer.concat(chunks)),
          ),
        );
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("连接超时")));
    req.on("error", reject);
    req.end(body);
  });
}
// Read structured preparation data without depending on rendered HTML inputs.
// This GET never submits content or changes a task.
export async function prepareReply(
  target: string,
  cookie: string,
  requestPage: typeof http = http,
): Promise<string> {
  const url = new URL(threadUrl(target));
  if (!cookie.trim() || /[\r\n]/.test(cookie))
    throw new Error("请先设置有效的 NGA Cookie。");
  const prepare = new URL("/post.php", url);
  prepare.search = new URLSearchParams({
    action: "reply",
    tid: url.searchParams.get("tid")!,
    pid: "0",
    __output: "8",
  }).toString();
  return parseReplyData(
    await requestPage(prepare, cookie, url.href),
    url.searchParams.get("tid")!,
  );
}

/** Read the image itself without forum credentials; HTTP errors may contain GIFs. */
export async function verifyNGAImage(value: string): Promise<void> {
  const image = ngaImage(value);
  if (!image) throw new Error("图片大小选项仅支持 NGA 图片地址。");
  const url = new URL(absoluteNGAImageUrl(value));
  url.protocol = "https:";
  const failure = (reason: string) => new Error(
    `NGA 图片尺寸不可用（${reason}）：${image.path}${image.size ? `.${image.size}.jpg` : ""}。请选择其他尺寸或原图。`,
  );
  const data = await new Promise<Buffer>((resolve, reject) => {
    const req = request(url, { headers: { Accept: "image/*" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(failure(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("error", reject);
      res.on("end", () => {
        if (!res.complete) reject(failure("下载未完成"));
        else resolve(Buffer.concat(chunks));
      });
    });
    req.setTimeout(30000, () => req.destroy(failure("连接超时")));
    req.on("error", reject);
    req.end();
  });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
  } catch {
    throw failure("返回内容不是有效图片");
  }
  try {
    if (!bitmap.width || !bitmap.height) throw failure("图片尺寸无效");
  } finally {
    bitmap.close();
  }
}

/** Sized images use NGA's relative syntax only after the image URL is readable. */
export async function relativeNGAImages(
  values: string[],
  checkImage: (url: string) => Promise<void> = verifyNGAImage,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const value of new Set(values)) {
    const image = ngaImage(value);
    if (!image?.size) continue;
    await checkImage(absoluteNGAImageUrl(value));
    result.set(value, `./${image.path}.${image.size}.jpg${image.tail}`);
  }
  return result;
}

/** Shared by clipboard export and manual/scheduled publication. */
export async function toNGABBCode(
  markdown: string,
  checkImage: (url: string) => Promise<void> = verifyNGAImage,
): Promise<string> {
  const images: string[] = [];
  const original = toBBCode(markdown, (url) => { images.push(url); return url; });
  const replacements = await relativeNGAImages(images, checkImage);
  return replacements.size
    ? toBBCode(markdown, (url) => replacements.get(url) ?? url)
    : original;
}

export async function postReply(
  target: string,
  content: string,
  cookie: string,
  requestPage: typeof http = http,
): Promise<Receipt> {
  const url = new URL(threadUrl(target));
  if (!content.trim()) throw new Error("没有可发布正文。");
  if (!cookie.trim() || /[\r\n]/.test(cookie))
    throw new Error("请先设置有效的 NGA Cookie。");
  let submitted = false;
  try {
    const fid = await prepareReply(target, cookie, requestPage);
    const body = new URLSearchParams({
      action: "reply",
      tid: url.searchParams.get("tid")!,
      pid: "0",
      fid,
      step: "2",
      nojump: "1",
      lite: "xml",
      __inchst: "UTF8",
      post_content: content,
    }).toString();
    submitted = true;
    const receipt = parseReceipt(
      await requestPage(new URL("/post.php", url), cookie, url.href, body),
    );
    if (receipt.status === "sent" && receipt.pid) {
      const reply = new URL(url);
      reply.searchParams.set("pid", receipt.pid);
      try {
        receipt.floor = replyFloor(
          await requestPage(reply, cookie, url.href),
          receipt.pid,
        );
      } catch {
        /* Posting is already confirmed; a failed floor lookup must never trigger resend. */
      }
    }
    return receipt;
  } catch (error) {
    return {
      status: submitted ? "unknown" : "failed",
      message: submitted
        ? "发送后连接中断，请到帖子核对；不会自动重发。"
        : `正文未发送：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

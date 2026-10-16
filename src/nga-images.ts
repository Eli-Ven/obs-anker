export const NGA_IMAGE_SIZES = [
  { value: "medium", label: "中图（medium）" },
  { value: "thumb", label: "缩略图（thumb）" },
  { value: "thumb_s", label: "小缩略图（thumb_s）" },
  { value: "thumb_ss", label: "极小缩略图（thumb_ss）" },
  { value: "", label: "原图" },
] as const;
export type NGAImageSize = (typeof NGA_IMAGE_SIZES)[number]["value"];

/** Attachment identity excludes CDN host, query and thumbnail suffix. */
export function ngaImage(value: string) {
  const parts = value.match(
    /^(https?:\/\/[^/?#]+\/attachments\/|\.\/)(mon_\d{6}\/\d{2}\/[\w.-]+)([?#].*)?$/i,
  );
  if (!parts) return null;
  if (parts[1] !== "./") {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.port ||
      !/(^|\.)(nga\.cn|nga\.178\.com|ngabbs\.com)$/i.test(url.hostname)
    )
      return null;
  }
  const suffix = parts[2].match(/\.(medium|thumb|thumb_s|thumb_ss)\.jpg$/i);
  const path = suffix ? parts[2].slice(0, -suffix[0].length) : parts[2];
  if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)) return null;
  const size = (suffix?.[1].toLowerCase() || "") as NGAImageSize;
  return { prefix: parts[1], path, size, tail: parts[3] || "" };
}

/** NGA's ./ attachment notation is independent of the note's Vault location. */
export function absoluteNGAImageUrl(value: string): string {
  return ngaImage(value)?.prefix === "./"
    ? "https://img.nga.cn/attachments/" + value.slice(2)
    : value;
}

export function ngaImageSizeUrl(
  value: string,
  size: NGAImageSize,
): string | null {
  const image = ngaImage(absoluteNGAImageUrl(value));
  if (!image) return null;
  return image.prefix + image.path + (size ? `.${size}.jpg` : "") + image.tail;
}

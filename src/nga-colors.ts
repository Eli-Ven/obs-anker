// NGA's 24 named text colors. Hex values are standard CSS equivalents used
// only for swatches and mapping colors produced by the previous RGB picker.
export const NGA_COLORS = [
  { name: "skyblue", label: "天蓝", hex: "#87ceeb" },
  { name: "orange", label: "橙色", hex: "#ffa500" },
  { name: "firebrick", label: "火砖", hex: "#b22222" },
  { name: "seagreen", label: "海绿", hex: "#2e8b57" },
  { name: "coral", label: "珊瑚", hex: "#ff7f50" },
  { name: "sandybrown", label: "沙棕", hex: "#f4a460" },
  { name: "royalblue", label: "宝蓝", hex: "#4169e1" },
  { name: "orangered", label: "橙红", hex: "#ff4500" },
  { name: "darkred", label: "暗红", hex: "#8b0000" },
  { name: "teal", label: "青色", hex: "#008080" },
  { name: "purple", label: "紫色", hex: "#800080" },
  { name: "sienna", label: "赭色", hex: "#a0522d" },
  { name: "blue", label: "蓝色", hex: "#0000ff" },
  { name: "crimson", label: "绯红", hex: "#dc143c" },
  { name: "green", label: "绿色", hex: "#008000" },
  { name: "deeppink", label: "深粉", hex: "#ff1493" },
  { name: "indigo", label: "靛蓝", hex: "#4b0082" },
  { name: "chocolate", label: "巧克力", hex: "#d2691e" },
  { name: "darkblue", label: "深蓝", hex: "#00008b" },
  { name: "red", label: "红色", hex: "#ff0000" },
  { name: "limegreen", label: "青绿", hex: "#32cd32" },
  { name: "tomato", label: "番茄", hex: "#ff6347" },
  { name: "burlywood", label: "硬木", hex: "#deb887" },
  { name: "silver", label: "银色", hex: "#c0c0c0" },
] as const;

export type NGAColor = (typeof NGA_COLORS)[number]["name"];

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

export function toNGAColor(value: string): NGAColor {
  let color = value.trim().toLowerCase();
  const named = NGA_COLORS.find((item) => item.name === color);
  if (named) return named.name;
  if (/^#[a-f0-9]{3}$/.test(color))
    color = "#" + [...color.slice(1)].map((digit) => digit + digit).join("");
  if (!/^#[a-f0-9]{6}$/.test(color))
    throw new Error(
      `NGA 不支持颜色「${value}」，请在角色颜色中选择 NGA 色名。`,
    );
  const channels = rgb(color);
  let nearest: NGAColor = "red";
  let distance = Infinity;
  for (const item of NGA_COLORS) {
    const squared = rgb(item.hex).reduce(
      (sum, channel, index) => sum + (channel - channels[index]) ** 2,
      0,
    );
    if (squared < distance) {
      distance = squared;
      nearest = item.name;
    }
  }
  return nearest;
}

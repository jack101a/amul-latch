import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

export interface ProductCardInput {
  category: string;
  name: string;
  priceINR: number;
  stockUnits: number;
  unitLabel?: string;
  yieldText?: string | null;
  costPerGram?: number | null;
  pincode: string;
  depot: string;
  thumbnailBuffer?: Buffer | null;
  thumbnailUrl?: string | null;
}

const W = 900;
const H = 1180;
const green = "#299f50";
const muted = "#666666";
const black = "#171717";

function esc(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

let cachedDefaultThumbDataUri: string | null = null;

async function getDefaultThumbDataUri(): Promise<string> {
  if (cachedDefaultThumbDataUri) return cachedDefaultThumbDataUri;
  try {
    const assetPath = path.resolve(process.cwd(), "src/lib/amul/assets/product-thumbnail.png");
    const buf = await fs.readFile(assetPath);
    cachedDefaultThumbDataUri = `data:image/png;base64,${buf.toString("base64")}`;
    return cachedDefaultThumbDataUri;
  } catch {
    return "";
  }
}

/**
 * Builds the SVG markup matching the high-fidelity Amul product card design.
 */
export function buildProductCardSvg(input: ProductCardInput, thumbnailDataUri: string): string {
  const stock = input.stockUnits.toLocaleString("en-IN");
  const price = `₹${input.priceINR.toLocaleString("en-IN")}`;
  const unitLabel = input.unitLabel || "boxes";
  const costPerGram = input.costPerGram ? Number(input.costPerGram.toFixed(2)) : null;
  const showBestValue = Boolean(costPerGram && costPerGram <= 2.5);

  const stockText = `${stock} ${unitLabel} in stock`;
  const pillWidth = Math.max(340, Math.min(540, 95 + stockText.length * 15));

  const costText = costPerGram ? `₹${costPerGram.toFixed(2)}/g` : "Best Market Rate";
  const badgeX = 98 + Math.round(costText.length * 24) + 20;

  const bestValueBadge = showBestValue
    ? `
      <rect x="${badgeX}" y="646" width="255" height="58" rx="18" fill="#fff0d5"/>
      <path d="M${badgeX + 24} 690 C${badgeX + 12} 681 ${badgeX + 19} 670 ${badgeX + 29} 659 C${badgeX + 28} 671 ${badgeX + 40} 673 ${badgeX + 39} 684 C${badgeX + 38} 693 ${badgeX + 30} 698 ${badgeX + 24} 690 Z" fill="#f08a18"/>
      <path d="M${badgeX + 28} 689 C${badgeX + 25} 683 ${badgeX + 30} 678 ${badgeX + 32} 675 C${badgeX + 32} 682 ${badgeX + 36} 684 ${badgeX + 34} 689 C${badgeX + 33} 692 ${badgeX + 29} 692 ${badgeX + 28} 689 Z" fill="#ffbd46"/>
      <text x="${badgeX + 52}" y="684" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="#855515">BEST VALUE</text>`
    : "";

  const yieldString = input.yieldText || "High Quality Milk Protein";

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="15" y="15" width="870" height="1150" rx="40" fill="#ffffff" stroke="#e0e0e0" stroke-width="2.5"/>

    <!-- Header / thumbnail -->
    <image href="${thumbnailDataUri}" x="31" y="31" width="207" height="260" preserveAspectRatio="xMidYMid meet"/>
    <text x="265" y="77" font-family="Arial, Helvetica, sans-serif" font-size="29" fill="#5f5f5f">${esc(input.category)}</text>
    <text x="265" y="155" font-family="Arial, Helvetica, sans-serif" font-size="67" font-weight="700" fill="${green}">${esc(price)}</text>
    <rect x="265" y="190" width="${pillWidth}" height="62" rx="31" fill="#e0f6e6"/>
    <circle cx="299" cy="221" r="16" fill="#68b86a"/>
    <circle cx="299" cy="221" r="10" fill="#3a9e50"/>
    <text x="326" y="232" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#287641" font-weight="600">${esc(stockText)}</text>

    <line x1="31" y1="347" x2="869" y2="347" stroke="#e7e7e7" stroke-width="2"/>

    <!-- Protein yield icon (dumbbell) -->
    <g transform="translate(34 431)" stroke="#6a6a6a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M9 20 H37"/>
      <path d="M4 12 V28 M10 7 V33 M17 15 V25 M30 15 V25 M37 7 V33 M43 12 V28"/>
    </g>
    <text x="98" y="431" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="${muted}">PROTEIN YIELD</text>
    <text x="98" y="492" font-family="Arial, Helvetica, sans-serif" font-size="37" fill="#171717">${esc(yieldString)}</text>

    <!-- Value tier / lightning icon -->
    <g transform="translate(40 619)" fill="none" stroke="#6a6a6a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 2 L5 25 H18 L14 48 L36 18 H22 Z"/>
    </g>
    <text x="98" y="617" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="${muted}">VALUE TIER</text>
    <text x="98" y="679" font-family="Arial, Helvetica, sans-serif" font-size="37" font-weight="700" fill="#171717">${esc(costText)}</text>
    ${bestValueBadge}

    <!-- Regional hub / location pin icon -->
    <g transform="translate(40 787)" fill="none" stroke="#6a6a6a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 43 C14 33 5 25 5 17 A16 16 0 1 1 37 17 C37 25 28 34 21 43 Z"/>
      <circle cx="21" cy="17" r="5.5"/>
    </g>
    <text x="98" y="787" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="${muted}">REGIONAL HUB</text>
    <text x="98" y="849" font-family="Arial, Helvetica, sans-serif" font-size="37" fill="#171717">${esc(input.pincode)} · ${esc(input.depot)}</text>

    <!-- Visual CTA -->
    <rect x="31" y="919" width="838" height="94" rx="47" fill="${black}"/>
    <path d="M270 974 L291 941 L287 960 L301 960 L278 990 L282 974 Z" fill="#ffc928"/>
    <text x="322" y="977" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="600" fill="#ffffff">Buy on Amul Store</text>
    <path d="M633 954 H655 V976 M655 954 L633 976" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Renders the product card into a high-resolution PNG buffer.
 */
export async function renderProductCardPng(input: ProductCardInput): Promise<Buffer> {
  let dataUri = "";
  if (input.thumbnailBuffer && input.thumbnailBuffer.length > 0) {
    try {
      const pngBuf = await sharp(input.thumbnailBuffer).resize(207, 260, { fit: "inside" }).png().toBuffer();
      dataUri = `data:image/png;base64,${pngBuf.toString("base64")}`;
    } catch {
      dataUri = await getDefaultThumbDataUri();
    }
  } else if (input.thumbnailUrl) {
    try {
      const res = await fetch(input.thumbnailUrl, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const rawBuf = Buffer.from(await res.arrayBuffer());
        const pngBuf = await sharp(rawBuf).resize(207, 260, { fit: "inside" }).png().toBuffer();
        dataUri = `data:image/png;base64,${pngBuf.toString("base64")}`;
      } else {
        dataUri = await getDefaultThumbDataUri();
      }
    } catch {
      dataUri = await getDefaultThumbDataUri();
    }
  } else {
    dataUri = await getDefaultThumbDataUri();
  }

  const svg = Buffer.from(buildProductCardSvg(input, dataUri));
  return sharp(svg).png({ quality: 95 }).toBuffer();
}

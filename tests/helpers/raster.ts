/**
 * Minimal software rasteriser for headless tests.
 *
 * Node has no <canvas>, but js-aruco2 only needs a duck-typed ImageData
 * ({ data, width, height }), so we synthesise one here. This lets the whole
 * colour pipeline be validated before a phone, a camera, or a test strip
 * exists.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, fill: RGB = { r: 255, g: 255, b: 255 }) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.fillRect(0, 0, width, height, fill);
  }

  fillRect(x0: number, y0: number, w: number, h: number, c: RGB): void {
    const xEnd = Math.min(this.width, Math.round(x0 + w));
    const yEnd = Math.min(this.height, Math.round(y0 + h));
    for (let y = Math.max(0, Math.round(y0)); y < yEnd; y++) {
      for (let x = Math.max(0, Math.round(x0)); x < xEnd; x++) {
        const i = (y * this.width + x) * 4;
        this.data[i] = c.r;
        this.data[i + 1] = c.g;
        this.data[i + 2] = c.b;
        this.data[i + 3] = 255;
      }
    }
  }

  get(x: number, y: number): RGB {
    const i = (Math.round(y) * this.width + Math.round(x)) * 4;
    return { r: this.data[i] ?? 0, g: this.data[i + 1] ?? 0, b: this.data[i + 2] ?? 0 };
  }

  /** Duck-typed ImageData for js-aruco2 and our own sampler. */
  toImageData(): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: this.data, width: this.width, height: this.height };
  }
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };

/**
 * Draw an ArUco marker using the same cell layout js-aruco2's generateSVG uses:
 * a (size+4) grid with a 1-cell white margin, a 1-cell black ring, and
 * size x size data cells where code[y * size + x] === '1' means white.
 */
export function drawMarker(
  raster: Raster,
  code: string,
  originX: number,
  originY: number,
  cellPx: number,
): void {
  const size = Math.sqrt(code.length);
  if (!Number.isInteger(size)) {
    throw new Error(`marker code length ${code.length} is not a perfect square`);
  }
  const gridCells = size + 4;

  raster.fillRect(originX, originY, gridCells * cellPx, gridCells * cellPx, WHITE);
  raster.fillRect(
    originX + cellPx,
    originY + cellPx,
    (size + 2) * cellPx,
    (size + 2) * cellPx,
    BLACK,
  );

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (code[y * size + x] === "1") {
        raster.fillRect(
          originX + (x + 2) * cellPx,
          originY + (y + 2) * cellPx,
          cellPx,
          cellPx,
          WHITE,
        );
      }
    }
  }
}

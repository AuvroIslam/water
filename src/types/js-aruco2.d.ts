/**
 * js-aruco2 ships no types. It also assigns onto `this` at module scope rather
 * than to `module.exports` directly, so only a default import resolves under
 * Node's ESM loader — see the note in src/core/markers.ts.
 */
declare module "js-aruco2/src/aruco.js" {
  interface Point {
    x: number;
    y: number;
  }

  interface Marker {
    id: number;
    corners: Point[];
    hammingDistance: number;
  }

  interface DetectorOptions {
    dictionaryName?: string;
    maxHammingDistance?: number;
  }

  interface Detector {
    detect(image: { data: Uint8ClampedArray; width: number; height: number }): Marker[];
  }

  interface Dictionary {
    /** Binary strings, indexed by marker id. */
    codeList: string[];
    /** Grid size including the black ring, i.e. sqrt(nBits) + 2. */
    markSize: number;
    nBits: number;
    generateSVG(id: number): string;
  }

  interface ArNamespace {
    Detector: new (options?: DetectorOptions) => Detector;
    Dictionary: new (name: string) => Dictionary;
    DICTIONARIES: Record<string, { nBits: number; tau: number; codeList: unknown[] }>;
  }

  const aruco: { AR: ArNamespace };
  export default aruco;
}

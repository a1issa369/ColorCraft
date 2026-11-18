// Shared shapes for the grading engine. Everything here is plain data, so it can be cloned, compared and stored.

/** RGBA pixels, row by row. */
export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A point on a tone curve: input and output, both 0..1. */
export type CurvePoint = readonly [number, number];
export type Channel = 'rgb' | 'r' | 'g' | 'b';
export type Curves = Record<Channel, CurvePoint[]>;

/** Hue, saturation and brightness shifts for each of the eight colour families, -100..100. */
export interface Hsl {
  hue: number[];
  sat: number[];
  lum: number[];
}

export interface Split {
  hue: number;
  amount: number;
}

export type SliderKey =
  | 'exposure' | 'contrast' | 'highlights' | 'shadows'
  | 'temperature' | 'tint' | 'saturation' | 'fade';

/** A complete set of adjustments. */
export interface Adjustments extends Record<SliderKey, number> {
  splitShadow: Split;
  splitHighlight: Split;
  curves: Curves | null;
  hsl: Hsl | null;
  lookCurves: Curves | null;
}

/** What a caller may pass in: any subset, with curves allowed to be partial. */
export type AdjustmentsInput = Partial<Record<SliderKey, number>> & {
  splitShadow?: Split;
  splitHighlight?: Split;
  curves?: Partial<Curves> | null;
  hsl?: Hsl | null;
  lookCurves?: Partial<Curves> | null;
};

export type Rgb = readonly [number, number, number];

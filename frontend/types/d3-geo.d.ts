declare module 'd3-geo' {
  export interface GeoProjection {
    scale(s: number): GeoProjection;
    center(c: [number, number]): GeoProjection;
    translate(t: [number, number]): GeoProjection;
    invert(point: [number, number]): [number, number] | null;
    (coordinates: [number, number]): [number, number] | null;
  }
  export function geoMercator(): GeoProjection;
}

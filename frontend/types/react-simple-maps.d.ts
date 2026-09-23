declare module 'react-simple-maps' {
  import React from 'react';

  export interface ComposableMapProps {
    projection?: string;
    projectionConfig?: Record<string, unknown>;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }
  export const ComposableMap: React.FC<ComposableMapProps>;

  export interface ZoomableGroupProps {
    zoom?: number;
    minZoom?: number;
    maxZoom?: number;
    children?: React.ReactNode;
  }
  export const ZoomableGroup: React.FC<ZoomableGroupProps>;

  export interface GeographiesProps {
    geography: string | object;
    children: (props: { geographies: unknown[] }) => React.ReactNode;
  }
  export const Geographies: React.FC<GeographiesProps>;

  export interface GeographyProps {
    geography: unknown;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
    [key: string]: unknown;
  }
  export const Geography: React.FC<GeographyProps>;

  export interface MarkerProps {
    coordinates: [number, number];
    onClick?: (event: React.MouseEvent<SVGGElement>) => void;
    onMouseEnter?: (event: React.MouseEvent<SVGGElement>) => void;
    onMouseLeave?: (event: React.MouseEvent<SVGGElement>) => void;
    children?: React.ReactNode;
  }
  export const Marker: React.FC<MarkerProps>;
}

declare module 'jsqr' {
  export interface QRCodeLocationPoint {
    x: number;
    y: number;
  }

  export interface QRCodeLocation {
    topLeftCorner: QRCodeLocationPoint;
    topRightCorner: QRCodeLocationPoint;
    bottomLeftCorner: QRCodeLocationPoint;
    bottomRightCorner: QRCodeLocationPoint;
  }

  export interface QRCode {
    binaryData: number[];
    data: string;
    chunks?: Array<{ type: string; text?: string }>;
    location: QRCodeLocation;
  }

  export interface Options {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: Options,
  ): QRCode | null;
}

declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    scale?: number;
    width?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
}

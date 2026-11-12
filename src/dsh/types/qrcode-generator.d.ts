/**
 * Minimal typings for `qrcode-generator` (the package ships no TypeScript
 * declarations). Only the surface used by `src/dsh/lib/qr.ts` is declared.
 */
declare module 'qrcode-generator' {
  export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  export interface QrCode {
    addData(data: string, mode?: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }

  export default function qrcode(typeNumber: number, errorCorrectionLevel: QrErrorCorrectionLevel): QrCode;
}

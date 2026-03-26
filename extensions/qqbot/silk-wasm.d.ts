declare module "silk-wasm" {
  export interface EncodeResult {
    data: Uint8Array;
    duration: number;
  }
  export interface DecodeResult {
    data: Uint8Array;
    duration: number;
  }
  export interface WavFileInfo {
    chunkInfo: Array<{ chunkId: string; dataOffset: number; dataLength: number }>;
    fmt: {
      formatCode: number;
      numberOfChannels: number;
      sampleRate: number;
      bytesPerSec: number;
      bytesPerFrame: number;
      bitsPerSample: number;
    };
  }
  export function encode(
    input: ArrayBufferView | ArrayBuffer,
    sampleRate: number,
  ): Promise<EncodeResult>;
  export function decode(
    input: ArrayBufferView | ArrayBuffer,
    sampleRate: number,
  ): Promise<DecodeResult>;
  export function isSilk(data: ArrayBufferView | ArrayBuffer): boolean;
  export function getWavFileInfo(data: ArrayBufferView | ArrayBuffer): WavFileInfo;
}

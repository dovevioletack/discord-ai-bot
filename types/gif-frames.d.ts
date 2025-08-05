declare module 'gif-frames' {
  interface GifFrame {
    getImage: () => NodeJS.ReadableStream;
    frameIndex: number;
    frameInfo: { [key: string]: any };
  }
  interface GifFramesOptions {
    url: string;
    frames?: 'all' | number[];
    outputType?: 'jpg' | 'png' | 'canvas' | 'jpg-pixels' | 'png-pixels';
    quality?: number;
  }
  function gifFrames(options: GifFramesOptions): Promise<GifFrame[]>;
  export = gifFrames;
}

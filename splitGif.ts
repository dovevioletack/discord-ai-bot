import { sharpFromApng, framesFromApng } from "sharp-apng";
import gifFrames from "gif-frames";
import sharp from "sharp";
import { Buffer } from "buffer";

type FrameData = {
    buffer: Buffer;
    delay: number; // in ms
};

async function extractFramesFromApng(buffer: Buffer): Promise<FrameData[]> {
    const imageData = await framesFromApng(buffer, true) as any; // ImageData type
    const frames: FrameData[] = [];

    for (const frameSharp of imageData.frames) {
        const frameBuffer = await frameSharp.png().toBuffer();
        frames.push({
            buffer: frameBuffer,
            delay: imageData.delay.shift() || 100, // fallback to 100ms if missing
        });
    }
    return frames;
}

// Classic event-based stream to buffer
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

async function extractFramesFromGif(buffer: Buffer): Promise<FrameData[]> {
    const dataUrl = `data:image/gif;base64,${buffer.toString('base64')}`;

    // Now use gifFrames with the in-memory data URL
    const frameData = await gifFrames({
        url: dataUrl,
        frames: 'all',
        outputType: 'png'
    });

    const frames: FrameData[] = [];

    for (const frame of frameData) {
        const stream = frame.getImage();
        const frameBuffer = await streamToBuffer(stream);
        frames.push({
            buffer: frameBuffer,
            delay: frame.frameInfo.delay * 10, // gif delay: 1/100s to ms
        });
    }

    return frames;
}

/**
 * Get 10 evenly spaced frames from GIF or APNG buffer.
 * Returns array of Buffers.
 */
export async function extractFrames(buffer: Buffer): Promise<Buffer[]> {
    // Detect format via signature
    const isGif = buffer.slice(0, 6).toString() === "GIF89a" || buffer.slice(0, 6).toString() === "GIF87a";
    const isPng = buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

    if (!isGif && !isPng) throw new Error("Unsupported image format");

    let frames: FrameData[] = [];

    if (isGif) {
        frames = await extractFramesFromGif(buffer);
    } else if (isPng) {
        frames = await extractFramesFromApng(buffer);
    }

    if (frames.length === 0) throw new Error("No frames extracted");

    // Calculate total duration
    const totalDuration = frames.reduce((sum, f) => sum + f.delay, 0);

    // Target timestamps: 0%, 10%, ..., 90%
    const targets = Array.from({ length: 10 }, (_, i) => (i / 9) * totalDuration);

    // Build cumulative frame time for mapping time -> frame index
    let cumulative = 0;
    const cumulativeTimes = frames.map(f => {
        cumulative += f.delay;
        return cumulative;
    });

    // Find frame index for a timestamp
    function findFrameIndexAt(time: number): number {
        for (let i = 0; i < cumulativeTimes.length; i++) {
            if (time < cumulativeTimes[i]!) return i;
        }
        return cumulativeTimes.length - 1;
    }

    // Grab frames at each target timestamp
    const selectedFrames: Buffer[] = targets.map(t => {
        const idx = findFrameIndexAt(t);
        return frames[idx]!.buffer;
    });

    // If fewer than 10 frames, fill with last
    while (selectedFrames.length < 10) {
        selectedFrames.push(selectedFrames[selectedFrames.length - 1]!);
    }

    return selectedFrames;
}

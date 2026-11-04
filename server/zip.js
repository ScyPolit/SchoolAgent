import yazl from 'yazl';
import { pipeline } from 'node:stream/promises';

// Entries come solely from generated in-memory buffers; no filesystem paths or
// caller-supplied archive entry names are accepted.
export async function writePngArchive(destination, { height, partHeight = 16000, width = 1100, capture }) {
  const archive = new yazl.ZipFile();
  archive.on('error', error => archive.outputStream.destroy(error));
  // Attach the rejection handler immediately, including during slow rendering.
  const completion = pipeline(archive.outputStream, destination).then(() => null, error => error);
  try {
    const count = Math.ceil(height / partHeight);
    archive.addBuffer(Buffer.from(`长对话共 ${count} 张图片，依文件编号顺序阅读。每张最多 ${partHeight} 像素，不省略任何消息。\n`), '阅读说明.txt', { compressionLevel: 6 });
    for (let y = 0, index = 1; y < height; y += partHeight, index++) {
      if (destination.destroyed) throw new Error('Export destination closed');
      const buffer = await capture({ x: 0, y, width, height: Math.min(partHeight, height - y) });
      archive.addBuffer(buffer, `对话-${String(index).padStart(3, '0')}.png`, { compressionLevel: 6 });
    }
    archive.end();
    const failure = await completion;
    if (failure) throw failure;
  } catch (error) {
    archive.outputStream.destroy(error);
    await completion;
    throw error;
  }
}

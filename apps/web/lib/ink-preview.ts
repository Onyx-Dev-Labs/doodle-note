import { inflateSync } from "node:zlib";
/** Deliberately narrow native preview contract: noninterlaced 8-bit RGB/RGBA PNG. */
export function validateInkPreview(input: Uint8Array) {
  const bytes = Buffer.from(input);
  const fail = () => {
    throw new Error("invalid_content");
  };
  if (
    bytes.length < 33 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    fail();
  let offset = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) fail();
    const name = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32BE(offset + 8 + size))
      fail();
    if (["acTL", "fcTL", "fdAT"].includes(name)) fail();
    if (offset === 8) {
      if (name !== "IHDR" || size !== 13) fail();
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 4_194_304 ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9]!) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        fail();
      channels = data[9] === 6 ? 4 : 3;
    } else if (name === "IDAT") compressed.push(data);
    else if (name === "IEND") {
      if (size !== 0) fail();
      ended = true;
      offset += 12;
      break;
    } else if (name === "IHDR" || name[0] === name[0]?.toUpperCase()) fail(); // Unknown critical chunks, including animation, are not accepted.
    offset += size + 12;
  }
  if (!ended || offset !== bytes.length || !compressed.length) fail();
  const stride = width * channels + 1;
  let decoded: Buffer;
  try {
    decoded = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: stride * height,
    });
  } catch {
    return fail();
  }
  if (decoded.length !== stride * height) fail();
  for (let row = 0; row < height; row++) if (decoded[row * stride]! > 4) fail();
}

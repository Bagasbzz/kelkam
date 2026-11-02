import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { assertPublicUrl, isPrivateAddress, safeFetch, SafeFetchError } from "../src/lib/server/safe-fetch";
import { extractDocx, extractPptx, extractXlsx, extractZip, readZipEntry, readZipEntryBytes, extractImagesFromFile } from "../src/lib/server/extract-text";
import { loadBoundedArchive, MAX_ARCHIVE_BYTES, readBoundedEntry } from "../src/lib/server/bounded-archive";
import { inspectImage, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, toPng } from "../src/lib/server/image-convert";
import { boundedSvgScale, MAX_SVG_DIMENSION, MAX_SVG_PIXELS, svgToPngServer } from "../src/lib/server/laporan/svg-raster";

const isTooLarge = (error: unknown) => error instanceof Error && "status" in error && error.status === 413;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=", "base64");

async function archive(files: Record<string, string | Buffer>, compression: "STORE" | "DEFLATE" = "DEFLATE") {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
  return zip.generateAsync({ type: "nodebuffer", compression });
}

function forgeSize(buffer: Buffer, name: string, size: number): Buffer {
  const result = Buffer.from(buffer);
  // Test fixtures deliberately disagree with the actual DEFLATE output.
  for (let offset = 0; offset + 46 <= result.length; offset++) {
    if (result.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = result.readUInt16LE(offset + 28);
    if (result.toString("utf8", offset + 46, offset + 46 + nameLength) === name) {
      result.writeUInt32LE(size, offset + 24);
      return result;
    }
  }
  throw new Error("Missing fixture entry");
}

test("canonical IP classification blocks equivalent mapped/private/reserved IPv6", () => {
  for (const ip of [
    "127.0.0.1", "0.0.0.0", "10.0.0.1", "169.254.169.254", "100.64.0.1", "172.16.0.1", "192.168.1.1",
    "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::", "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:FFFF:a00:1", "::ffff:a9fe:a9fe",
    "::ffff:c0a8:101", "::ffff:ac10:1", "::ffff:6440:1", "::ffff:c000:201", "::ffff:e000:1",
    "fc00::1", "fe80::1", "fec0::1", "ff02::1", "2001:0db8::1", "64:ff9b::a00:1",
    "2002:7f00:1::", "2001:0:1234::1", "3fff::1", "::127.0.0.1", "fe80::1%eth0", "bad-ip",
  ]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "192.0.3.1", "198.51.101.1", "203.0.114.1", "::ffff:808:808", "2606:4700:4700::1111", "2001:4860:4860::8888", "2001:db80::1"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("URL validation rejects canonicalized private literals without DNS/network", async () => {
  for (const url of ["http://127.1", "http://2130706433", "http://0x7f000001", "http://[::ffff:127.0.0.1]", "http://[0:0:0:0:0:ffff:a00:1]", "http://localhost.", "http://foo.internal.", "file:///tmp/a", "https://user:pass@8.8.8.8", "https://8.8.8.8:1234"]) {
    await assert.rejects(assertPublicUrl(url), SafeFetchError, url);
  }
  assert.equal((await assertPublicUrl("https://[::ffff:8.8.8.8]/")).hostname, "[::ffff:808:808]");
});

test("safeFetch revalidates redirects and bounds actual/peek bytes (mocked fetch only)", async (t) => {
  let cancelled = false;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: "http://[::ffff:7f00:1]/" } });
  });
  await assert.rejects(safeFetch("https://8.8.8.8/"), SafeFetchError);
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(1024)));
  await assert.rejects(safeFetch("https://8.8.8.8/", { maxBytes: 8 }), SafeFetchError);
  const peek = await safeFetch("https://8.8.8.8/", { maxBytes: 8, peekBytes: 4 });
  assert.equal(peek.body.length, 4);
  await assert.rejects(safeFetch("https://8.8.8.8/", { maxBytes: NaN }), SafeFetchError);
});

test("valid DOCX, PPTX, XLSX and plain ZIP retain extraction compatibility", async () => {
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Valid document content")] })] }] }));
  assert.match((await extractDocx(docx)).content, /Valid document content/);
  const pptx = await archive({ "ppt/slides/slide1.xml": "<p:sld><a:p><a:t>Slide &amp; text</a:t></a:p></p:sld>", "ppt/notesSlides/notesSlide1.xml": "<a:t>Speaker note</a:t>" });
  assert.match((await extractPptx(pptx)).content, /Slide & text[\s\S]*Speaker note/);
  const xlsx = await archive({ "xl/sharedStrings.xml": "<sst><si><t>Cell content</t></si></sst>", "xl/workbook.xml": '<sheets><sheet name="Data"/></sheets>', "xl/worksheets/sheet1.xml": '<sheetData><row><c t="s"><v>0</v></c></row></sheetData>' });
  assert.match((await extractXlsx(xlsx)).content, /Data[\s\S]*Cell content/);
  const zip = await archive({ "readme.txt": "Plain archive content", "empty.txt": "" });
  assert.match((await extractZip(zip)).content, /Plain archive content/);
  assert.equal((await readZipEntry(zip, "empty.txt")).content, "");
  const nested = await archive({ "inner.zip": zip });
  assert.match((await readZipEntry(nested, "inner.zip::readme.txt")).content, /Plain archive content/);
});

test("all Office parsers preflight oversized declared entries before inflating", async () => {
  for (const [name, parser] of [["word/document.xml", extractDocx], ["ppt/slides/slide1.xml", extractPptx], ["xl/worksheets/sheet1.xml", extractXlsx]] as const) {
    const input = forgeSize(await archive({ [name]: "small XML" }), name, MAX_ARCHIVE_BYTES + 1);
    await assert.rejects(parser(input), isTooLarge, name);
  }
  const highRatio = await archive({ "word/document.xml": "x".repeat(128 * 1024) });
  await assert.rejects(extractDocx(highRatio), isTooLarge);
  const combined = await archive({ "a.xml": Buffer.alloc(13 * 1024 * 1024), "b.xml": Buffer.alloc(13 * 1024 * 1024) }, "STORE");
  await assert.rejects(loadBoundedArchive(combined, true), isTooLarge);
});

test("forged small expanded sizes fail during streaming across Office and ZIP reads", async () => {
  const huge = Buffer.alloc(2 * 1024 * 1024, 65);
  for (const [name, parser] of [["word/document.xml", extractDocx], ["ppt/slides/slide1.xml", extractPptx], ["xl/worksheets/sheet1.xml", extractXlsx]] as const) {
    const input = forgeSize(await archive({ [name]: huge }), name, 32);
    await assert.rejects(parser(input), isTooLarge, name);
  }
  const zip = forgeSize(await archive({ "readme.txt": huge }), "readme.txt", 32);
  await assert.rejects(readZipEntry(zip, "readme.txt"), isTooLarge);
  await assert.rejects(readZipEntryBytes(zip, "readme.txt"), isTooLarge);
  const inner = forgeSize(await archive({ "inner.zip": huge }), "inner.zip", 32);
  await assert.rejects(extractZip(inner), isTooLarge);
});

test("expanded-byte budget is aggregate and enforced before concatenation", async () => {
  const input = await archive({ "a.txt": "abcdefgh", "b.txt": "abcdefgh" });
  const zip = await loadBoundedArchive(input);
  const budget = { used: 0, limit: 12 };
  assert.equal((await readBoundedEntry(zip.files["a.txt"], budget)).toString(), "abcdefgh");
  await assert.rejects(readBoundedEntry(zip.files["b.txt"], budget), isTooLarge);
  assert.equal(budget.used, 8);
});

test("image extraction rejects forged expanded media, preserves valid PNG", async () => {
  const valid = await extractImagesFromFile(await archive({ "word/media/image1.png": png }), "doc.docx");
  assert.equal(valid.images.length, 1);
  const bad = forgeSize(await archive({ "word/media/image1.png": Buffer.alloc(1024 * 1024, 65) }), "word/media/image1.png", 32);
  const result = await extractImagesFromFile(bad, "doc.docx");
  assert.equal(result.images.length, 0);
  assert.equal(result.skipped.length, 1);
});

test("PNG header/height/pixel limits apply even to passthrough", async () => {
  assert.deepEqual(inspectImage(png), { mime: "image/png", width: 1, height: 1 });
  assert.equal((await toPng(png)).bytes, png);
  for (const [width, height] of [[1, MAX_IMAGE_DIMENSION + 1], [8192, 8192], [0, 1]]) {
    const modified = Buffer.from(png);
    modified.writeUInt32BE(width, 16);
    modified.writeUInt32BE(height, 20);
    await assert.rejects(toPng(modified), /Dimensi\/piksel/);
  }
  for (const short of [png.subarray(0, 12), png.subarray(0, 24), png.subarray(0, 32)]) await assert.rejects(toPng(short), /Header/);
  await assert.rejects(toPng(png, { maxWidth: NaN }), /lebar/);
});

test("JPEG/GIF/WebP dimensions are checked before native decode", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0xff, 0xff, 0xff, 0xff, 1, 1, 0x11, 0, 0xff, 0xda]);
  const gif = Buffer.alloc(14);
  gif.write("GIF89a"); gif.writeUInt16LE(65535, 6); gif.writeUInt16LE(65535, 8);
  const webp = Buffer.alloc(30);
  webp.write("RIFF"); webp.writeUInt32LE(22, 4); webp.write("WEBPVP8X", 8); webp.writeUInt32LE(10, 16);
  webp.writeUIntLE(65535, 24, 3); webp.writeUIntLE(65535, 27, 3);
  for (const input of [jpeg, gif, webp]) await assert.rejects(toPng(input), /Dimensi\/piksel/);
});

test("native conversion accepts ordinary PNG/JPEG/WebP and bounds tall output", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(20, 40);
  canvas.getContext("2d").fillRect(0, 0, 20, 40);
  for (const kind of ["png", "jpeg", "webp"] as const) {
    const input = kind === "png" ? await canvas.encode("png") : kind === "jpeg" ? await canvas.encode("jpeg") : await canvas.encode("webp");
    const output = await toPng(input, { maxBytesPassthrough: 0 });
    assert.equal(output.width, 20, kind);
    assert.equal(output.height, 40, kind);
    assert.ok(output.width * output.height <= MAX_IMAGE_PIXELS);
  }
  const tall = createCanvas(64, 5000);
  const output = await toPng(await tall.encode("png"), { maxBytesPassthrough: 0 });
  assert.ok(output.height <= 4096);
});

test("SVG sizing rejects invalid intrinsic sizes and bounds extreme zoom/aspect ratios", async () => {
  for (const scale of [NaN, Infinity, 0, -1]) {
    assert.throws(() => boundedSvgScale(100, 100, scale));
    await assert.rejects(svgToPngServer('<svg xmlns="http://www.w3.org/2000/svg"/>', scale));
  }
  for (const [width, height] of [[0, 100], [Infinity, 1], [1e12, 1], [15000, 15000]]) assert.throws(() => boundedSvgScale(width, height, 2));
  for (const [width, height, requested] of [[8000, 8000, 2], [1, 32768, 1e12], [100, 50, 1e12]]) {
    const scale = boundedSvgScale(width, height, requested);
    assert.ok(Math.ceil(width * scale) <= MAX_SVG_DIMENSION);
    assert.ok(Math.ceil(height * scale) <= MAX_SVG_DIMENSION);
    assert.ok(Math.ceil(width * scale) * Math.ceil(height * scale) <= MAX_SVG_PIXELS);
  }
  const output = Buffer.from(await svgToPngServer('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>'));
  assert.equal(output.readUInt32BE(16), 24);
  assert.equal(output.readUInt32BE(20), 16);
  const wide = Buffer.from(await svgToPngServer('<svg xmlns="http://www.w3.org/2000/svg" width="16000" height="1"/>'));
  assert.ok(wide.readUInt32BE(16) <= MAX_SVG_DIMENSION);
  assert.ok(wide.readUInt32BE(20) >= 1);
  await assert.rejects(svgToPngServer('<svg xmlns="http://www.w3.org/2000/svg" width="15000" height="15000"/>'), /Dimensi/);
});

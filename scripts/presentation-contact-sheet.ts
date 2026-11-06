import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { THEME_IDS } from "../src/lib/presentation/model";

async function main() {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory)) throw new Error("Berikan direktori review absolut.");
  const width = 1920;
  const cellWidth = 620;
  const cellHeight = 390;
  const canvas = createCanvas(width, cellHeight * 5 + 80);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#E8EBE3"; ctx.fillRect(0, 0, width, canvas.height);
  ctx.font = "bold 23px Arial"; ctx.fillStyle = "#20352B";
  ctx.fillText("KELUHKAMPUS / RENDER MICROSOFT POWERPOINT", 22, 34);
  for (const [column, theme] of THEME_IDS.entries()) {
    ctx.fillText(theme.toUpperCase(), column * 640 + 12, 68);
    for (let index = 0; index < 5; index++) {
      const image = await loadImage(path.join(directory, theme, `Slide${index + 1}.PNG`));
      const x = column * 640 + 10;
      const y = index * cellHeight + 85;
      ctx.drawImage(image, x, y, cellWidth, cellWidth * 9 / 16);
      ctx.font = "15px Arial"; ctx.fillStyle = "#20352B";
      ctx.fillText(`${theme} / ${index + 1}`, x, y + 371);
    }
  }
  const output = path.join(directory, "contact-sheet.png");
  await writeFile(output, await canvas.encode("png"));
  console.log(output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

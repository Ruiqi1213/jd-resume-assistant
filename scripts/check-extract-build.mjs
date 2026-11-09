import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

// Run on the deployment platform as well as locally: compiling alone does not
// detect missing runtime-loaded canvas bindings and PDF workers.
const trace = JSON.parse(await readFile(".next/server/app/api/extract/route.js.nft.json", "utf8"));
const files = trace.files.map((file) => file.replaceAll("\\", "/"));
assert(files.some((file) => file.endsWith("/@napi-rs/canvas/index.js")), "Canvas entry missing from function bundle");
assert(files.some((file) => file.includes("/@napi-rs/canvas-") && file.endsWith(".node")), "Native canvas binding missing from function bundle");
if (process.platform === "linux" && process.arch === "x64") {
  assert(files.some((file) => file.includes("canvas-linux-x64-gnu/") && file.endsWith(".node")), "Linux canvas binding missing from function bundle");
}
assert(files.some((file) => file.endsWith("/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs")), "CJS PDF worker missing from function bundle");
assert(files.some((file) => file.endsWith("/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")), "ESM PDF worker missing from function bundle");

const expected = "Resume test: data analysis and operations.";
const content = `BT /F1 12 Tf 72 720 Td (${expected}) Tj ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const parser = new PDFParse({ data: new Uint8Array(Buffer.from(pdf)) });
try {
  const result = await parser.getText({ first: 1 });
  assert(result.pages.some((page) => page.text.includes(expected)), "PDF fixture text was not extracted");
} finally {
  await parser.destroy();
}
console.log(`Upload runtime check passed (${process.platform}/${process.arch}): canvas, workers, PDF text extraction.`);

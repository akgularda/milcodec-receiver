import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const readmePath = resolve(root, "README.md");
const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
const match = readme.match(/<!-- repository-hygiene:start -->([\s\S]*?)<!-- repository-hygiene:end -->/);
const contract = match?.[1] ?? "";
const expectedHeadings = ["Repository status","Public access","Screenshots","Data and methodology","Update frequency","Quick start","Architecture","Tests","Provenance","Forecast limitations","Security","License","Citation","Masterbrand endorsement"];

test("MonarchCastleTech/milcodec-receiver exposes the complete repository documentation contract", () => {
  assert.ok(match, "README must include the managed repository-hygiene block");
  assert.ok(contract.includes("Browser-based acoustic data link that demodulates and decrypts MILCODEC chirp-spread-spectrum signals over sound — a Monarch Castle Technologies / Defense Intelligence receiver."), "README purpose must match the canonical registry");
  assert.match(contract, /lifecycle-active/);
  assert.ok(contract.includes("https://monarchcastle.tech/milcodec-receiver/"));
  for (const heading of expectedHeadings) assert.ok(contract.includes(`## ${heading}`), `missing heading: ${heading}`);
  for (const phrase of ["guaranteed accurate", "official government intelligence", "investment advice"]) {
    assert.ok(!contract.toLowerCase().includes(phrase), `prohibited claim: ${phrase}`);
  }
});

test("MonarchCastleTech/milcodec-receiver keeps every managed image local and ships a valid social preview", () => {
  const images = [...contract.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(([, target]) => target);
  assert.ok(images.includes("docs/brand/organization-lockup.png"));
  assert.ok(images.includes("docs/social-preview.png"));
  for (const image of images) {
    assert.ok(!/^https?:/i.test(image), `managed image must be local: ${image}`);
    assert.ok(existsSync(resolve(root, image)), `missing image: ${image}`);
  }
  const previewPath = resolve(root, "docs/social-preview.png");
  const preview = readFileSync(previewPath);
  assert.equal(preview.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(preview.readUInt32BE(16), 1280);
  assert.equal(preview.readUInt32BE(20), 640);
  assert.ok(statSync(previewPath).size < 1_000_000);
});

test("MonarchCastleTech/milcodec-receiver documents citation, rights, and HTTPS policy", () => {
  assert.ok(existsSync(resolve(root, "CITATION.cff")));
  assert.ok(existsSync(resolve(root, "THIRD_PARTY_NOTICES.md")));
  assert.ok(existsSync(resolve(root, "LICENSE")));
  const citation = readFileSync(resolve(root, "CITATION.cff"), "utf8");
  assert.match(citation, /^cff-version: 1\.2\.0/m);
  assert.match(citation, /^title:/m);
  const links = [...contract.matchAll(/https?:\/\/[^\s)>]+/g)].map(([url]) => url);
  const allowedHttp = new Set(["http://localhost", ""]);
  for (const link of links.filter((url) => url.startsWith("http://"))) {
    assert.ok([...allowedHttp].some((prefix) => prefix && link.startsWith(prefix)), `HTTP link lacks an explicit exception: ${link}`);
  }
});

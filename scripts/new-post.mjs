/* eslint-disable no-console */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BLOG_PATH = path.resolve("src/content/posts");
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value, length) {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = ID_ALPHABET[Number(value % 32n)] + output;
    value /= 32n;
  }
  return output;
}

function createShortId() {
  const timestamp = encodeBase32(BigInt(Math.floor(Date.now() / 1000)), 8);
  const bytes = randomBytes(3);
  let randomness = 0n;
  for (const byte of bytes) randomness = (randomness << 8n) | BigInt(byte);
  return timestamp + encodeBase32(randomness, 4);
}

async function getMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(entry => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? getMarkdownFiles(entryPath) : [entryPath];
    })
  );
  return files.flat().filter(file => /\.mdx?$/.test(file));
}

function getShanghaiDatetime() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 19)}+08:00`;
}

function parseArguments(args) {
  const directoryIndex = args.indexOf("--dir");
  const directory = directoryIndex >= 0 ? args[directoryIndex + 1] : "";
  const title = args.filter((_, index) =>
    directoryIndex >= 0 ? index !== directoryIndex && index !== directoryIndex + 1 : true
  ).join(" ").trim();

  if (!title) throw new Error('请提供文章标题，例如：pnpm new:post "文章标题"');
  if (directoryIndex >= 0 && !directory)
    throw new Error("--dir 后必须提供目录名");
  if (path.isAbsolute(directory) || directory.split(/[\\/]/).includes(".."))
    throw new Error("文章目录必须位于 src/content/posts 内");

  return { title, directory };
}

const { title, directory } = parseArguments(process.argv.slice(2));
const files = await getMarkdownFiles(BLOG_PATH);
const numbers = files
  .map(file => Number(path.basename(file).match(/^(\d+)/)?.[1]))
  .filter(Number.isFinite);
const nextNumber = String(Math.max(0, ...numbers) + 1).padStart(3, "0");
const existingIds = new Set(
  (await Promise.all(files.map(file => readFile(file, "utf8"))))
    .map(content => content.match(/^id:\s*["']?([0-9A-HJKMNP-TV-Z]{12})["']?$/m)?.[1])
    .filter(Boolean)
);

let id = createShortId();
while (existingIds.has(id)) id = createShortId();

const targetDirectory = path.resolve(BLOG_PATH, directory);
if (!targetDirectory.startsWith(`${BLOG_PATH}${path.sep}`) && targetDirectory !== BLOG_PATH)
  throw new Error("文章目录必须位于 src/content/posts 内");

await mkdir(targetDirectory, { recursive: true });
const targetFile = path.join(targetDirectory, `${nextNumber}.md`);
const content = `---
id: ${id}
title: ${JSON.stringify(title)}
description: ""
pubDatetime: ${getShanghaiDatetime()}
draft: true
tags: []
---

# ${title}
`;

await writeFile(targetFile, content, { flag: "wx" });
console.log(`已创建文章：${path.relative(process.cwd(), targetFile)}`);
console.log(`公开地址：/posts/${[
  ...directory.split(/[\\/]/).filter(segment => segment && !segment.startsWith("_")),
  id.toLowerCase(),
].join("/")}/`);

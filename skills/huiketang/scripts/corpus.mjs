#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = resolve(skillRoot, "references/evidence.json");
const indexPath = resolve(skillRoot, "references/corpus-index.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function formatTime(seconds) {
  assert(Number.isFinite(seconds) && seconds >= 0, "Invalid timestamp");
  const value = Math.floor(seconds);
  const parts = [Math.floor(value / 60) % 60, value % 60];
  if (value >= 3600) parts.unshift(Math.floor(value / 3600));
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function textLineSeconds(line) {
  const match = line.match(/^\[(\d+:\d{2}(?::\d{2})?)\] /u);
  if (!match) return null;
  const parts = match[1].split(":").map(Number);
  if (parts.slice(1).some((part) => part > 59)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

export function publicationLabel(episode) {
  const match = episode.title.match(/^\s*(?:Vol\.?|V)\s*(\d+)/iu);
  return match ? `Vol.${Number(match[1])}` : episode.label || "未编号";
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readIndexedTranscript(root, metadata) {
  const bytes = readFileSync(resolve(root, metadata.path));
  assert(
    digest(bytes) === metadata.sha256,
    `Source changed since the indexed snapshot: ${metadata.path}. Run verify and review the changes before refreshing.`,
  );
  return JSON.parse(bytes.toString("utf8"));
}

export function locateCorpus(explicitRoot) {
  if (explicitRoot) {
    const root = resolve(explicitRoot);
    assert(existsSync(resolve(root, "data-v2.json")), `Not a corpus: ${root}`);
    assert(existsSync(resolve(root, "transcripts")), `No transcripts: ${root}`);
    return root;
  }
  if (process.env.HUIKETANG_CORPUS) return locateCorpus(process.env.HUIKETANG_CORPUS);
  return [process.cwd(), resolve(skillRoot, "../..")].find(
    (root) =>
      existsSync(resolve(root, "data-v2.json")) &&
      existsSync(resolve(root, "transcripts")),
  );
}

export function readCorpus(root) {
  const data = readJson(resolve(root, "data-v2.json"));
  assert(Array.isArray(data.episodes), "Missing episodes array");
  const seen = new Set();
  return [...data.episodes]
    .sort((a, b) => a.n - b.n)
    .map((episode) => {
      assert(
        Number.isInteger(episode.n) && episode.n > 0 && !seen.has(episode.n),
        `Invalid or duplicate episode n=${episode.n}`,
      );
      seen.add(episode.n);
      const path = `transcripts/${episode.n}.json`;
      const bytes = readFileSync(resolve(root, path));
      const transcript = JSON.parse(bytes.toString("utf8"));
      assert(Array.isArray(transcript.chunks), `Missing chunks in ${path}`);
      assert(typeof transcript.text === "string", `Missing text in ${path}`);
      for (const [i, chunk] of transcript.chunks.entries()) {
        assert(
          Number.isFinite(chunk.start) &&
            chunk.start >= 0 &&
            typeof chunk.text === "string",
          `Invalid chunk ${i} in ${path}`,
        );
      }
      return { episode, transcript, path, sha256: digest(bytes) };
    });
}

export function enrichEvidence(items, corpus, root) {
  const ids = new Set();
  const byNumber = new Map(corpus.map((row) => [row.episode.n, row]));
  return items.map((item) => {
    assert(/^E\d{2,3}$/.test(item.id) && !ids.has(item.id), `Invalid ID: ${item.id}`);
    ids.add(item.id);
    const row = byNumber.get(item.n);
    assert(row, `${item.id}: missing episode ${item.n}`);
    assert(
      Number.isInteger(item.chunk) && item.chunk >= 0,
      `${item.id}: invalid chunk index`,
    );
    const chunk = row.transcript.chunks[item.chunk];
    assert(chunk, `${item.id}: missing chunk ${item.chunk}`);
    assert(
      typeof item.quote === "string" &&
        item.quote.length > 0 &&
        chunk.text.includes(item.quote),
      `${item.id}: quotation is not an exact substring of the original chunk`,
    );
    for (const key of ["claim", "topic", "attribution", "boundary"]) {
      assert(typeof item[key] === "string" && item[key].trim(), `${item.id}: missing ${key}`);
    }
    const timestamp = formatTime(chunk.start);
    const textPath = `transcripts/${item.n}.txt`;
    let textLine = null;
    if (existsSync(resolve(root, textPath))) {
      const lines = readFileSync(resolve(root, textPath), "utf8").split("\n");
      const index = lines.findIndex(
        (line) =>
          textLineSeconds(line) === Math.floor(chunk.start) &&
          line.includes(item.quote),
      );
      if (index >= 0) textLine = index + 1;
    }
    const quoteStart = chunk.text.indexOf(item.quote);
    return {
      id: item.id,
      n: item.n,
      chunk: item.chunk,
      topic: item.topic,
      attribution: item.attribution,
      claim: item.claim,
      boundary: item.boundary,
      quote: item.quote,
      context_before: chunk.text.slice(Math.max(0, quoteStart - 90), quoteStart),
      context_after: chunk.text.slice(quoteStart + item.quote.length, quoteStart + item.quote.length + 140),
      source: {
        label: publicationLabel(row.episode),
        catalog_label: row.episode.label,
        title: row.episode.title,
        date: row.episode.date.replaceAll(".", "-"),
        url: row.episode.link,
        path: row.path,
        chunk_index: item.chunk,
        start_seconds: chunk.start,
        timestamp,
        text_path: textPath,
        text_line: textLine,
        sha256: row.sha256,
      },
    };
  });
}

export function makeIndex(corpus, evidence, createdAt) {
  const dates = corpus.map((row) => row.episode.date.replaceAll(".", "-")).sort();
  return {
    schema_version: 1,
    created_at: createdAt,
    coverage: "Local snapshot; not a claim to cover all published episodes.",
    stats: {
      episode_files: corpus.length,
      transcript_chunks: corpus.reduce((sum, row) => sum + row.transcript.chunks.length, 0),
      text_characters: corpus.reduce((sum, row) => sum + [...row.transcript.text].length, 0),
      text_utf16_code_units: corpus.reduce((sum, row) => sum + row.transcript.text.length, 0),
      first_date: dates[0],
      last_date: dates.at(-1),
      evidence_entries: evidence.length,
      evidence_episode_files: new Set(evidence.map((item) => item.n)).size,
    },
    episodes: corpus.map((row) => ({
      n: row.episode.n,
      label: publicationLabel(row.episode),
      catalog_label: row.episode.label,
      title: row.episode.title,
      date: row.episode.date.replaceAll(".", "-"),
      url: row.episode.link,
      path: row.path,
      chunks: row.transcript.chunks.length,
      sha256: row.sha256,
      evidence_ids: evidence.filter((item) => item.n === row.episode.n).map((item) => item.id),
    })),
  };
}

export function searchEvidence(items, query, episode, limit = 6) {
  const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  assert(terms.length, "Search query must not be empty");
  return items
    .filter((item) => episode === undefined || item.n === episode)
    .map((item) => {
      const text = [item.topic, item.claim, item.quote, item.boundary].join(" ").toLocaleLowerCase();
      return { ...item, score: terms.filter((term) => text.includes(term)).length };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.n - b.n || a.chunk - b.chunk)
    .slice(0, limit);
}

function parseArgs(args) {
  const parsed = { positional: [] };
  const allowed = new Set(["root", "episode", "chunk", "radius", "limit"]);
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (!argument.startsWith("--")) {
      parsed.positional.push(argument);
      continue;
    }
    const key = argument.slice(2);
    assert(allowed.has(key), `Unknown option: ${argument}`);
    assert(args[i + 1] !== undefined && !args[i + 1].startsWith("--"), `Missing value: ${argument}`);
    parsed[key] = args[++i];
  }
  for (const key of ["episode", "chunk", "radius", "limit"]) {
    if (parsed[key] === undefined) continue;
    assert(/^\d+$/.test(parsed[key]), `${key} must be a non-negative integer`);
    parsed[key] = Number(parsed[key]);
    assert(Number.isSafeInteger(parsed[key]), `${key} is too large`);
  }
  if (parsed.episode !== undefined) assert(parsed.episode > 0, "episode must be positive");
  if (parsed.limit !== undefined) assert(parsed.limit > 0 && parsed.limit <= 100, "limit must be 1..100");
  if (parsed.radius !== undefined) assert(parsed.radius <= 5, "radius must be 0..5");
  return parsed;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function main(args = process.argv.slice(2)) {
  const [command = "help", ...rest] = args;
  const options = parseArgs(rest);
  if (command === "help") {
    console.log(`Usage:
  node scripts/corpus.mjs stats
  node scripts/corpus.mjs evidence E04 E05
  node scripts/corpus.mjs search "风险 现金流" [--root PATH] [--episode N] [--limit 6]
  node scripts/corpus.mjs episode --episode N [--chunk I] [--radius 1] [--root PATH]
  node scripts/corpus.mjs verify --root PATH
  node scripts/corpus.mjs refresh --root PATH

N is the source file number, NOT the podcast Vol number. Chunk indices are zero-based.
Search terms are literal, OR-matched and ranked by number of matching terms.
Without the original corpus, search uses bundled evidence only.
Only refresh writes files, and only the skill's generated evidence/index files.`);
    return;
  }
  const bundle = readJson(evidencePath);
  if (command === "evidence") {
    assert(options.positional.length, "Provide at least one evidence ID");
    const selected = options.positional.map((id) => {
      const item = bundle.evidence.find((candidate) => candidate.id === id);
      assert(item, `Unknown evidence ID: ${id}`);
      return item;
    });
    print({ coverage: "bundled_verified_excerpts", evidence: selected });
    return;
  }
  if (command === "stats") {
    print(readJson(indexPath).stats);
    return;
  }
  assert(["search", "episode", "verify", "refresh"].includes(command), `Unknown command: ${command}`);
  const root = locateCorpus(options.root);
  if (command === "verify" || command === "refresh") {
    assert(root, "Original corpus required; pass --root PATH");
    const corpus = readCorpus(root);
    const evidence = enrichEvidence(bundle.evidence, corpus, root);
    const index = makeIndex(corpus, evidence, bundle.created_at);
    if (command === "refresh") {
      writeFileSync(evidencePath, `${JSON.stringify({ ...bundle, evidence }, null, 2)}\n`);
      writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
      print({ refreshed: true, ...index.stats });
      return;
    }
    assert(JSON.stringify(bundle.evidence) === JSON.stringify(evidence), "Evidence snapshot differs; review source changes before refreshing");
    assert(JSON.stringify(readJson(indexPath)) === JSON.stringify(index), "Corpus index differs; review new or changed episodes");
    print({ verified: true, ...index.stats });
    return;
  }
  const index = readJson(indexPath);
  if (options.episode !== undefined) {
    assert(index.episodes.some((episode) => episode.n === options.episode), `Unknown source episode: ${options.episode}`);
  }
  if (command === "episode") {
    assert(options.episode !== undefined, "Use --episode N (source file number)");
    const metadata = index.episodes.find((episode) => episode.n === options.episode);
    if (options.chunk === undefined || !root) {
      print({
        coverage: "bundled_index_and_selected_evidence",
        metadata,
        requested_chunk_available: options.chunk === undefined ? null : false,
        evidence: bundle.evidence.filter((item) => item.n === options.episode),
      });
      return;
    }
    const transcript = readIndexedTranscript(root, metadata);
    assert(options.chunk < transcript.chunks.length, "Chunk index out of range");
    const radius = options.radius ?? 1;
    print({
      coverage: "original_local_transcript",
      metadata,
      chunks: transcript.chunks
        .map((chunk, i) => ({ chunk: i, timestamp: formatTime(chunk.start), ...chunk }))
        .filter((chunk) => Math.abs(chunk.chunk - options.chunk) <= radius),
    });
    return;
  }
  const query = options.positional.join(" ").trim();
  assert(query, "Provide a search query");
  const limit = options.limit ?? 6;
  if (!root) {
    print({
      coverage: "bundled_evidence_only_not_full_corpus",
      hits: searchEvidence(bundle.evidence, query, options.episode, limit),
    });
    return;
  }
  const terms = query.toLocaleLowerCase().split(/\s+/u);
  const hits = [];
  const episodes = index.episodes.filter((episode) => options.episode === undefined || episode.n === options.episode);
  for (const episode of episodes) {
    const transcript = readIndexedTranscript(root, episode);
    transcript.chunks.forEach((chunk, i) => {
      const text = chunk.text.toLocaleLowerCase();
      const matches = terms.filter((term) => text.includes(term));
      if (!matches.length) return;
      const start = Math.max(0, text.indexOf(matches[0]) - 65);
      hits.push({
        n: episode.n,
        label: episode.label,
        title: episode.title,
        date: episode.date,
        chunk: i,
        timestamp: formatTime(chunk.start),
        score: matches.length,
        excerpt: chunk.text.slice(start, start + 330),
        source: episode.path,
      });
    });
  }
  hits.sort((a, b) => b.score - a.score || a.n - b.n || a.chunk - b.chunk);
  print({
    coverage: "original_local_transcripts",
    scope: "indexed_snapshot_only",
    snapshot_created_at: index.created_at,
    indexed_episode_files: episodes.length,
    total_hits: hits.length,
    hits: hits.slice(0, limit),
  });
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

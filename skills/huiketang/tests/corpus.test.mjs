import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  enrichEvidence, formatTime, locateCorpus, makeIndex, publicationLabel,
  readCorpus, readIndexedTranscript, searchEvidence, skillRoot, textLineSeconds,
} from "../scripts/corpus.mjs";

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "huiketang-corpus-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixture(t) {
  const root = temporary(t);
  mkdirSync(join(root, "transcripts"));
  const episode = {
    n: 5, label: "Special", title: "Vol 4. Example", date: "2025.01.10",
    link: "https://example.invalid/episode",
  };
  const text = "begin \u{1d11e} exact quotation end";
  writeFileSync(join(root, "data-v2.json"), JSON.stringify({ episodes: [episode] }));
  writeFileSync(join(root, "transcripts/5.json"), JSON.stringify({
    text, chunks: [{ start: 4425, end: 4485, text }],
  }));
  writeFileSync(join(root, "transcripts/5.txt"), `Example\n\n[1:13:45] ${text}\n`);
  return {
    root,
    item: {
      id: "E01", n: 5, chunk: 0, topic: "testing", attribution: "dialogue",
      claim: "A synthetic claim", boundary: "Synthetic test only", quote: "exact quotation",
    },
  };
}

test("timestamps are readable across the one-hour boundary", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(59.9), "00:59");
  assert.equal(formatTime(60), "01:00");
  assert.equal(formatTime(3599), "59:59");
  assert.equal(formatTime(3600), "01:00:00");
  assert.equal(formatTime(4425), "01:13:45");
  assert.throws(() => formatTime(-1));
  assert.throws(() => formatTime(NaN));
});

test("text timestamps accept both padded and unpadded hours", () => {
  assert.equal(textLineSeconds("[1:13:45] excerpt"), 4425);
  assert.equal(textLineSeconds("[01:13:45] excerpt"), 4425);
  assert.equal(textLineSeconds("[73:45] excerpt"), 4425);
  assert.equal(textLineSeconds("[00:59] excerpt"), 59);
  assert.equal(textLineSeconds("[00:99] excerpt"), null);
  assert.equal(textLineSeconds("no timestamp"), null);
});

test("publication number comes from the title, not the source file number", () => {
  assert.equal(publicationLabel({ title: "Vol 111. Example", label: "Special", n: 112 }), "Vol.111");
  assert.equal(publicationLabel({ title: "V110.Example", label: "Special" }), "Vol.110");
  assert.equal(publicationLabel({ title: "Unnumbered", label: "Special" }), "Special");
});

test("evidence enrichment verifies exact excerpts and creates actual text-line locators", (t) => {
  const { root, item } = fixture(t);
  assert.equal(locateCorpus(root), root);
  const corpus = readCorpus(root);
  const [enriched] = enrichEvidence([item], corpus, root);
  assert.equal(enriched.source.label, "Vol.4");
  assert.equal(enriched.source.catalog_label, "Special");
  assert.equal(enriched.source.timestamp, "01:13:45");
  assert.equal(enriched.source.text_line, 3);
  assert.equal(enriched.source.date, "2025-01-10");
  assert.match(enriched.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(enriched.context_after, " end");
  assert.deepEqual(enrichEvidence([enriched], corpus, root), [enriched]);
});

test("modified quotations, duplicate IDs and missing chunks cannot silently refresh", (t) => {
  const { root, item } = fixture(t);
  const corpus = readCorpus(root);
  assert.throws(() => enrichEvidence([{ ...item, quote: "rewritten quotation" }], corpus, root), /exact substring/);
  assert.throws(() => enrichEvidence([item, item], corpus, root), /Invalid ID/);
  assert.throws(() => enrichEvidence([{ ...item, chunk: 99 }], corpus, root), /missing chunk/);
  assert.throws(() => enrichEvidence([{ ...item, n: 999 }], corpus, root), /missing episode/);
});

test("index statistics distinguish code points and UTF-16 code units", (t) => {
  const { root, item } = fixture(t);
  const corpus = readCorpus(root);
  const evidence = enrichEvidence([item], corpus, root);
  const index = makeIndex(corpus, evidence, "2026-10-24");
  assert.equal(index.stats.episode_files, 1);
  assert.equal(index.stats.transcript_chunks, 1);
  assert.equal(index.stats.text_utf16_code_units, index.stats.text_characters + 1);
  assert.equal(index.stats.evidence_episode_files, 1);
  assert.deepEqual(index.episodes[0].evidence_ids, ["E01"]);
});

test("live retrieval does not attach an old citation to a modified source", (t) => {
  const { root } = fixture(t);
  const [row] = readCorpus(root);
  assert.equal(readIndexedTranscript(root, row).text, row.transcript.text);
  writeFileSync(join(root, row.path), JSON.stringify({
    text: "changed source", chunks: [{ start: 0, end: 60, text: "changed source" }],
  }));
  assert.throws(() => readIndexedTranscript(root, row), /Source changed since the indexed snapshot/);
});

test("literal search ranks independent query terms and supports source-file filtering", () => {
  const items = [
    { id: "E01", n: 1, chunk: 2, topic: "Cash", claim: "income", quote: "x", boundary: "x" },
    { id: "E02", n: 2, chunk: 0, topic: "cash", claim: "reserve", quote: "x", boundary: "x" },
  ];
  assert.deepEqual(searchEvidence(items, "CASH income").map((item) => item.id), ["E01", "E02"]);
  assert.deepEqual(searchEvidence(items, "cash", 2).map((item) => item.id), ["E02"]);
  assert.equal(searchEvidence(items, "unmatched").length, 0);
  assert.throws(() => searchEvidence(items, "  "), /empty/);
});

test("bundled evidence, attribution and source index are internally consistent", () => {
  const bundle = JSON.parse(readFileSync(join(skillRoot, "references/evidence.json"), "utf8"));
  const index = JSON.parse(readFileSync(join(skillRoot, "references/corpus-index.json"), "utf8"));
  const ids = new Set(bundle.evidence.map((item) => item.id));
  assert.equal(ids.size, bundle.evidence.length);
  assert.equal(index.stats.evidence_entries, bundle.evidence.length);
  assert.equal(index.stats.episode_files, index.episodes.length);
  assert.equal(index.stats.evidence_episode_files, new Set(bundle.evidence.map((item) => item.n)).size);
  for (const item of bundle.evidence) {
    const source = index.episodes.find((episode) => episode.n === item.n);
    assert.ok(source, item.id);
    assert.ok(source.evidence_ids.includes(item.id), item.id);
    assert.equal(item.source.sha256, source.sha256, item.id);
    assert.equal(item.source.path, source.path, item.id);
    assert.equal(item.source.timestamp, formatTime(item.source.start_seconds), item.id);
    assert.ok(item.quote.length && item.boundary.length, item.id);
    assert.match(item.attribution, /^(host|dialogue|guest:.+)$/u, item.id);
  }
  assert.equal(bundle.evidence.find((item) => item.id === "E34").attribution, "guest:熊军");
  assert.equal(bundle.evidence.find((item) => item.id === "E36").attribution, "host");
  assert.equal(index.episodes.find((episode) => episode.n === 112).label, "Vol.111");
});

test("documentation links and evidence pointers resolve inside the bundle", () => {
  const bundle = JSON.parse(readFileSync(join(skillRoot, "references/evidence.json"), "utf8"));
  const ids = new Set(bundle.evidence.map((item) => item.id));
  const docs = [
    join(skillRoot, "SKILL.md"),
    ...readdirSync(join(skillRoot, "references")).filter((name) => name.endsWith(".md"))
      .map((name) => join(skillRoot, "references", name)),
  ];
  for (const path of docs) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(existsSync(resolve(dirname(path), target)), `${path}: ${target}`);
    }
    for (const match of source.matchAll(/\bE\d{2,3}\b/gu)) {
      assert.ok(ids.has(match[0]), `${path}: ${match[0]}`);
    }
  }
});

test("a portable install explicitly falls back to bundled excerpts without the corpus", (t) => {
  const root = temporary(t);
  const installed = join(root, "standalone/huiketang");
  for (const directory of ["scripts", "references"]) mkdirSync(join(installed, directory), { recursive: true });
  for (const file of ["scripts/corpus.mjs", "references/evidence.json", "references/corpus-index.json"]) {
    cpSync(join(skillRoot, file), join(installed, file));
  }
  const env = { ...process.env };
  delete env.HUIKETANG_CORPUS;
  const run = (...args) => spawnSync(process.execPath, [join(installed, "scripts/corpus.mjs"), ...args], {
    cwd: root, env, encoding: "utf8",
  });
  const search = run("search", "现金流");
  assert.equal(search.status, 0, search.stderr);
  const output = JSON.parse(search.stdout);
  assert.equal(output.coverage, "bundled_evidence_only_not_full_corpus");
  assert.ok(output.hits.length);
  const episode = run("episode", "--episode", "102", "--chunk", "23");
  assert.equal(episode.status, 0, episode.stderr);
  assert.equal(JSON.parse(episode.stdout).requested_chunk_available, false);
  const invalid = run("evidence", "E999");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown evidence/);
});

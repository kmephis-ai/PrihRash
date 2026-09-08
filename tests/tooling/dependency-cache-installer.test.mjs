import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

const repoRoot = new URL("../../", import.meta.url).pathname;
const installer = join(repoRoot, "tools/dependency-cache/install_from_artifact.py");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeArtifact({ lockHash = sha256(join(repoRoot, "package-lock.json")), sourceSha = "a".repeat(40) } = {}) {
  const root = mkdtempSync(join(tmpdir(), "prihrash-dep-cache-test-"));
  const payload = join(root, "payload");
  const cache = join(root, "cache");
  mkdirSync(payload);
  mkdirSync(cache);
  writeFileSync(join(cache, "placeholder"), "synthetic public cache fixture\n");
  execFileSync("tar", ["-czf", join(payload, "npm-cache.tar.gz"), "-C", cache, "."]);
  const manifest = {
    schema_version: 1,
    source_repository: "synthetic/repo",
    source_sha: sourceSha,
    package_lock_sha256: lockHash,
    package_json_sha256: sha256(join(repoRoot, "package.json")),
    cache_archive_sha256: sha256(join(payload, "npm-cache.tar.gz")),
    node_version: process.version,
    node_major: Number(process.versions.node.split(".")[0]),
    npm_version: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    npm_major: Number(execFileSync("npm", ["--version"], { encoding: "utf8" }).trim().split(".")[0]),
    platform: process.platform,
    arch: process.arch,
  };
  writeFileSync(join(payload, "manifest.json"), JSON.stringify(manifest));
  const artifact = join(root, "artifact.zip");
  execFileSync("python", ["-c", "import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'w'); [z.write(x,x.name) for x in p.iterdir()]; z.close()", payload, artifact]);
  return artifact;
}

function verify(artifact, extraArgs = []) {
  return spawnSync("python", [installer, "--artifact-zip", artifact, "--repo", repoRoot, "--verify-only", ...extraArgs], {
    encoding: "utf8",
  });
}

test("dependency cache verifier accepts exact synthetic artifact", () => {
  const result = verify(makeArtifact(), ["--source-sha", "a".repeat(40)]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "PASS");
  assert.equal(parsed.verified, true);
  assert.equal(parsed.installed, false);
});

test("dependency cache verifier fails closed on lockfile mismatch", () => {
  const result = verify(makeArtifact({ lockHash: "0".repeat(64) }));
  assert.equal(result.status, 2);
  assert.match(result.stdout, /package-lock\.json mismatch/);
});

test("dependency cache verifier fails closed on source SHA mismatch", () => {
  const result = verify(makeArtifact(), ["--source-sha", "b".repeat(40)]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /source SHA mismatch/);
});

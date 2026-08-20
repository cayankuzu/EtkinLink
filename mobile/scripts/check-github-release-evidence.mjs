import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredEnvironment = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA'];
for (const key of requiredEnvironment) {
  if (!process.env[key]) throw new Error(`${key} eksik.`);
}

const [owner, repository] = process.env.GITHUB_REPOSITORY.split('/');
const apiBase = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
};
const evidence = [];

async function github(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub evidence sorgusu HTTP ${response.status}: ${path}`);
  }
  return response.json();
}

async function requireWorkflowEvidence({
  workflow,
  maxAgeDays,
  currentSha = false,
  artifacts = [],
}) {
  const runsPayload = await github(
    `/repos/${owner}/${repository}/actions/workflows/${workflow}/runs?status=completed&per_page=30`,
  );
  const earliest = Date.now() - maxAgeDays * 24 * 60 * 60_000;
  const run = runsPayload.workflow_runs?.find(candidate => {
    const recent = new Date(candidate.updated_at).getTime() >= earliest;
    const sameCommit =
      !currentSha || candidate.head_sha === process.env.GITHUB_SHA;
    return candidate.conclusion === 'success' && recent && sameCommit;
  });
  if (!run) {
    throw new Error(
      `${workflow} için ${maxAgeDays} gün içinde uygun başarılı run yok.`,
    );
  }
  const artifactPayload = await github(
    `/repos/${owner}/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
  );
  const available = new Set(
    (artifactPayload.artifacts ?? [])
      .filter(artifact => !artifact.expired)
      .map(artifact => artifact.name),
  );
  for (const artifact of artifacts) {
    if (!available.has(artifact)) {
      throw new Error(
        `${workflow} run ${run.id} ${artifact} artefaktını içermiyor.`,
      );
    }
  }
  evidence.push({
    workflow,
    runId: run.id,
    runUrl: run.html_url,
    headSha: run.head_sha,
    completedAt: run.updated_at,
    artifacts,
  });
}

await requireWorkflowEvidence({
  workflow: 'mobile-ci.yml',
  maxAgeDays: 7,
  currentSha: true,
  artifacts: ['etkinlink-mobile-sbom', 'etkinlink-debug-apk'],
});
await requireWorkflowEvidence({
  workflow: 'mobile-e2e.yml',
  maxAgeDays: 7,
  artifacts: [
    'android-maestro-evidence',
    'staging-critical-backend-e2e-evidence',
  ],
});
await requireWorkflowEvidence({
  workflow: 'staging-load-test.yml',
  maxAgeDays: 30,
  artifacts: ['staging-mixed-load-evidence-10000vu'],
});

const artifactDirectory = resolve(import.meta.dirname, '../../artifacts');
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(
  resolve(artifactDirectory, 'release-prerequisite-evidence.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA,
      evidence,
    },
    null,
    2,
  ),
);
console.log('CI, staging E2E ve 10K yük testi kanıtları doğrulandı.');

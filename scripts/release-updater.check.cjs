const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createUpdaterMetadata } = require('./release-updater.cjs');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..');
const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8').split(/\r?\n/);
const actionScripts = [];
for (let i = 0; i < workflow.length; i++) {
  if (workflow[i].trim() !== 'script: |') continue;
  const body = [];
  while (++i < workflow.length && (workflow[i].startsWith('            ') || !workflow[i].trim())) {
    body.push(workflow[i].slice(12));
  }
  actionScripts.push(body.join('\n'));
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runAction = (index, github, core = {}) => new AsyncFunction('github', 'context', 'core', 'require', 'process',
  actionScripts[index])(github, { repo: { owner: 'lzmzzw', repo: 'zNote' } }, core,
  createRequire(join(repoRoot, 'package.json')), { env: { TAG_NAME: 'v0.1.5' } });

const names = ['zNote_0.1.5_x64-setup.exe', 'zNote_0.1.5_x64-setup.exe.sig',
  'zNote_aarch64.app.tar.gz', 'zNote_aarch64.app.tar.gz.sig', 'zNote_0.1.5_aarch64.dmg'];
const assets = names.map(name => ({ name,
  browser_download_url: `https://github.com/lzmzzw/zNote/releases/download/v0.1.5/${name}` }));
const options = { tag: 'v0.1.5', assets, readSignature: async asset => `signature:${asset.name}\n`,
  notes: 'Release notes', publishedAt: '2026-10-12T00:00:00Z' };

test('macOS CI and local bundle targets can produce both updater archives and installers', () => {
  // CI 的 --bundles 会覆盖配置 targets，必须分别检查两条构建入口。
  const matrix = workflow.join('\n').match(/          - os: macos-[^\n]+\n((?:            [^\n]*\n)+)/);
  assert.ok(matrix, 'macOS release matrix entry must exist');
  assert.match(matrix[1], /target: aarch64-apple-darwin/);
  const bundles = matrix[1].match(/bundles: ([^\n]+)/)?.[1].trim().split(',');
  assert.ok(bundles?.includes('app'), 'CI --bundles must include app to produce updater artifacts');
  assert.ok(bundles.includes('dmg'), 'CI must also produce the macOS installer');
  assert.ok(workflow.some(line => line.includes('--bundles ${{ matrix.bundles }}')),
    'tauri-action must use the verified matrix bundle targets');
  const config = JSON.parse(readFileSync(join(repoRoot, 'src-tauri/tauri.macos.conf.json'), 'utf8'));
  const base = JSON.parse(readFileSync(join(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(config.bundle.createUpdaterArtifacts ?? base.bundle.createUpdaterArtifacts, true);
  assert.ok(config.bundle.targets.includes('app'), 'local macOS builds must produce updater artifacts');
  assert.ok(config.bundle.targets.includes('dmg'), 'local macOS builds must produce the installer');
});

test('Windows and macOS updater URLs retain their own signed payloads', async () => {
  const metadata = await createUpdaterMetadata(options);
  assert.equal(metadata.version, '0.1.5');
  assert.deepEqual(Object.keys(metadata.platforms), ['windows-x86_64', 'darwin-aarch64']);
  assert.ok(metadata.platforms['windows-x86_64'].url.endsWith('-setup.exe'));
  assert.ok(metadata.platforms['darwin-aarch64'].url.endsWith('.app.tar.gz'));
  assert.equal(metadata.platforms['darwin-aarch64'].signature, 'signature:zNote_aarch64.app.tar.gz.sig');
});

test('missing or ambiguous bundles fail before publishing metadata', async () => {
  await assert.rejects(createUpdaterMetadata({ ...options,
    assets: assets.filter(asset => !asset.name.endsWith('.app.tar.gz')) }), /darwin-aarch64 updater bundle/);
  await assert.rejects(createUpdaterMetadata({ ...options,
    assets: [...assets, assets[0]] }), /windows-x86_64 updater bundle/);
});

test('missing, empty signatures and insecure URLs fail before publishing metadata', async () => {
  await assert.rejects(createUpdaterMetadata({ ...options,
    assets: assets.filter(asset => !asset.name.endsWith('.app.tar.gz.sig')) }), /darwin-aarch64 signature/);
  await assert.rejects(createUpdaterMetadata({ ...options,
    readSignature: async () => ' \n' }), /signature is empty/);
  await assert.rejects(createUpdaterMetadata({ ...options,
    assets: assets.map(asset => ({ ...asset, browser_download_url: asset.browser_download_url.replace('https:', 'http:') })) }), /must use HTTPS/);
});

test('invalid tags fail before downloading signatures', async () => {
  await assert.rejects(createUpdaterMetadata({ ...options, tag: 'v-next' }), /Invalid release version/);
});

test('release creation reuses a release concurrently created by gh', async () => {
  let reads = 0;
  let output;
  await runAction(0, { rest: { repos: {
    getReleaseByTag: async () => {
      if (++reads === 1) throw Object.assign(new Error('missing'), { status: 404 });
      return { data: { id: 42 } };
    },
    createRelease: async () => { throw Object.assign(new Error('already exists'), { status: 422 }); },
  } } }, { setOutput: (key, value) => { output = [key, value]; } });
  assert.deepEqual(output, ['release-id', '42']);
});

function mockGithub(releaseAssets, effects) {
  return {
    paginate: async () => releaseAssets,
    request: async (_route, args) => ({ data: Buffer.from(`signature:${args.asset_id}`) }),
    rest: { repos: {
      getReleaseByTag: async () => ({ data: { id: 42, body: 'Release notes from gh' } }),
      listReleaseAssets: async () => {},
      deleteReleaseAsset: async args => { effects.push(['delete', args.asset_id]); },
      uploadReleaseAsset: async args => { effects.push(['upload', JSON.parse(args.data.toString('utf8'))]); },
    } },
  };
}

test('aggregate action uploads valid JSON and preserves both platform signatures', async () => {
  const effects = [];
  const releaseAssets = [...assets, { name: 'latest.json' }].map((asset, id) => ({ ...asset, id }));
  await runAction(1, mockGithub(releaseAssets, effects));
  assert.deepEqual(effects[0], ['delete', 5]);
  const metadata = effects[1][1];
  assert.equal(metadata.notes, 'Release notes from gh');
  assert.equal(metadata.platforms['windows-x86_64'].signature, 'signature:1');
  assert.equal(metadata.platforms['darwin-aarch64'].signature, 'signature:3');
  assert.ok(metadata.platforms['darwin-aarch64'].url.endsWith('.app.tar.gz'));
});

test('aggregate action leaves existing metadata intact when a platform is missing', async () => {
  const effects = [];
  await assert.rejects(runAction(1, mockGithub([assets[0], assets[1], { name: 'latest.json' }], effects)), /darwin-aarch64/);
  assert.deepEqual(effects, []);
});

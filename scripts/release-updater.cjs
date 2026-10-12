// 仅在所有平台构建成功后汇总 Release 中的签名更新产物。
async function createUpdaterMetadata({ tag, assets, readSignature, notes, publishedAt }) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${tag}`);
  }

  const findAsset = (predicate, description) => {
    const matches = assets.filter(predicate);
    if (matches.length !== 1) {
      throw new Error(`${description}: expected one asset, found ${matches.length}`);
    }
    return matches[0];
  };
  const platforms = {};
  for (const [platform, matchesBundle] of [
    ['windows-x86_64', asset => asset.name.endsWith('-setup.exe')],
    ['darwin-aarch64', asset => asset.name.endsWith('.app.tar.gz')],
  ]) {
    const bundle = findAsset(matchesBundle, `${platform} updater bundle`);
    const signatureAsset = findAsset(asset => asset.name === `${bundle.name}.sig`, `${platform} signature`);
    const signature = (await readSignature(signatureAsset)).trim();
    if (!signature) throw new Error(`${platform} signature is empty`);
    const url = new URL(bundle.browser_download_url);
    if (url.protocol !== 'https:') throw new Error(`${platform} download URL must use HTTPS`);
    platforms[platform] = { signature, url: url.href };
  }
  return { version, notes, pub_date: publishedAt, platforms };
}

module.exports = { createUpdaterMetadata };

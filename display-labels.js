// Human labels for identifiers that come from the backend: networks, protocols and token fallbacks.
// Raw ids ("mainnet-beta", "kamino") never reach the screen; an unknown value is shown as received.
const NETWORKS = Object.freeze({ 'mainnet-beta': 'Solana Mainnet', mainnet: 'Solana Mainnet', 'solana-mainnet': 'Solana Mainnet', devnet: 'Solana Devnet', 'solana-devnet': 'Solana Devnet', 'devnet-demo': 'Demo' });
const PROTOCOLS = Object.freeze({ kamino: 'Kamino', 'kamino-lend': 'Kamino Lend', klend: 'Kamino Lend', kvault: 'Kamino kVault', steakhouse: 'Steakhouse', squads: 'Squads' });
// Placeholder symbols the portfolio mapper uses when the token is unknown: not a token name.
const PLACEHOLDER_SYMBOLS = new Set(['underlying token', 'token']);

export function networkName(id) {
  if (id == null || id === '') return '';
  const key = String(id).trim();
  return NETWORKS[key.toLowerCase()] || key;
}

export function protocolName(id) {
  if (id == null || id === '') return '';
  const key = String(id).trim();
  if (PROTOCOLS[key.toLowerCase()]) return PROTOCOLS[key.toLowerCase()];
  // A lowercase slug ("marginfi") gets a capital; a name that already has capitals is kept as given.
  return /^[a-z][a-z0-9-]*$/.test(key) ? key[0].toUpperCase() + key.slice(1).replace(/-/g, ' ') : key;
}

export function assetName(symbol) {
  if (symbol == null) return '';
  const text = String(symbol).trim();
  return PLACEHOLDER_SYMBOLS.has(text.toLowerCase()) ? '' : text;
}

// "Kamino · Solana Mainnet · USDG", leaving out empty and placeholder parts.
export function contextLine({ protocol, network, asset } = {}) {
  return [protocolName(protocol), networkName(network), assetName(asset)].filter(Boolean).join(' · ');
}

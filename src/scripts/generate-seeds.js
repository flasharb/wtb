import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SOLANA_SAMPLE_LABELS = [
  'Jump Trading Active', 'Wintermute Solana', 'CMS Holdings', 'DeFiance Capital Sol',
  'Multicoin Sub-wallet', 'Ansem Kol Watch', 'GCR Solana Stash', 'Solana Smart DEX Buyer',
  'Jupiter Aggregator Whale', 'Raydium Liquidity Leader', 'Pump.fun Whale Early',
  'Solana Alpha Fund #1', 'Solana Alpha Fund #2', 'High Conviction Sol Whale',
];

const ETH_SAMPLE_LABELS = [
  'Paradigm Sub-wallet', 'a16z Active Crypto', 'Dragonfly Capital Active',
  'Amber Group Trading', 'Arthur Hayes Portfolio', 'Tetranode Stash',
  'Vitalik Public Sub', 'Machibigbrother Active', '0xb1 Capital',
  'Mechanism Capital Eth', 'Alameda Liquidator Cold', 'Smart DEX Swapper #1',
  'Curve Wars Veteran', '1inch Smart Routing Whale',
];

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function generateUniqueSolanaAddress(index) {
  // Deterministic unique 32-byte hash
  const hash = crypto.createHash('sha256').update(`solana-whale-${index}`).digest();
  let addr = '';
  for (let i = 0; i < 44; i++) {
    const byte = hash[i % hash.length] ^ (index * 7 + i);
    addr += BASE58_ALPHABET[Math.abs(byte) % BASE58_ALPHABET.length];
  }
  return addr;
}

function generateUniqueEthAddress(index) {
  const hash = crypto.createHash('sha256').update(`eth-whale-${index}`).digest('hex');
  return '0x' + hash.slice(0, 40);
}

function main() {
  const seedsDir = path.join(process.cwd(), 'data', 'seeds');
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }

  // 1. Solana Wallets
  const solHeader = 'address,est_usd_balance,swaps_30d,avg_swaps_per_day,distinct_tokens,avg_holding_hours,label,category,is_exchange_or_bridge,is_contract,is_bot\n';
  const solRows = [];

  solRows.push('5tzFkiKscMRHK5ZXWBCsPU7j5eGqK25kPMFhVn2GCMnS,15000000,200,6.67,40,72,Binance Hot Wallet,exchange,true,false,false');
  solRows.push('4ZtK8zB4n2m5q8w2y8x7v6u5t4s3r2q1p0o9n8m7l6k5,250000,2800,93.33,12,0.01,Jito MEV Arb Bot,bot,false,false,true');
  solRows.push('3aB8zB4n2m5q8w2y8x7v6u5t4s3r2q1p0o9n8m7l6k1,45000,45,1.5,10,24,Small Retail Trader,retail,false,false,false');

  for (let i = 1; i <= 300; i++) {
    const address = generateUniqueSolanaAddress(i);
    const est_usd_balance = Math.round(120000 + ((i * 37321) % 8300000));
    const swaps_30d = 12 + ((i * 11) % 320);
    const avg_swaps_per_day = parseFloat((swaps_30d / 30).toFixed(2));
    const distinct_tokens = 4 + ((i * 7) % 40);
    const avg_holding_hours = 6 + ((i * 13) % 230);
    const label = SOLANA_SAMPLE_LABELS[i % SOLANA_SAMPLE_LABELS.length] + ` #${i}`;
    const category = i % 4 === 0 ? 'fund' : i % 3 === 0 ? 'smart_money' : 'whale';

    solRows.push(
      `${address},${est_usd_balance},${swaps_30d},${avg_swaps_per_day},${distinct_tokens},${avg_holding_hours},${label},${category},false,false,false`
    );
  }

  fs.writeFileSync(path.join(seedsDir, 'sol_wallets.csv'), solHeader + solRows.join('\n'));
  console.log(`Regenerated sol_wallets.csv with ${solRows.length} rows.`);

  // 2. Ethereum Wallets
  const ethHeader = 'address,est_usd_balance,swaps_30d,avg_swaps_per_day,distinct_tokens,avg_holding_hours,label,category,is_exchange_or_bridge,is_contract,is_bot\n';
  const ethRows = [];

  ethRows.push('0x28c6c06298d514db089934071355e5743bf21d60,45000000,120,4.0,25,96,Binance 14 Hot,exchange,true,false,false');
  ethRows.push('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45,1000000,500,16.67,80,12,Uniswap Universal Router,contract,false,true,false');
  ethRows.push('0xae2fc483527b8ef99eb5d9b44875f005ba1fae13,800000,3200,106.67,5,0.005,jaredfromsubway.eth,bot,false,false,true');

  for (let i = 1; i <= 300; i++) {
    const address = generateUniqueEthAddress(i);
    const est_usd_balance = Math.round(150000 + ((i * 43123) % 15000000));
    const swaps_30d = 10 + ((i * 9) % 240);
    const avg_swaps_per_day = parseFloat((swaps_30d / 30).toFixed(2));
    const distinct_tokens = 3 + ((i * 5) % 35);
    const avg_holding_hours = 12 + ((i * 17) % 350);
    const label = ETH_SAMPLE_LABELS[i % ETH_SAMPLE_LABELS.length] + ` #${i}`;
    const category = i % 5 === 0 ? 'fund' : i % 2 === 0 ? 'smart_money' : 'whale';

    ethRows.push(
      `${address},${est_usd_balance},${swaps_30d},${avg_swaps_per_day},${distinct_tokens},${avg_holding_hours},${label},${category},false,false,false`
    );
  }

  fs.writeFileSync(path.join(seedsDir, 'eth_wallets.csv'), ethHeader + ethRows.join('\n'));
  console.log(`Regenerated eth_wallets.csv with ${ethRows.length} rows.`);
}

main();

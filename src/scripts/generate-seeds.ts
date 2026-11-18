import fs from 'fs';
import path from 'path';

// Known reputable funds, whales, and smart money labels for Solana & Ethereum
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

function generateSolanaAddress(seed: number): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let addr = '';
  let n = seed * 9301 + 49297;
  for (let i = 0; i < 44; i++) {
    n = (n * 9301 + 49297) % 233280;
    addr += chars[n % chars.length];
  }
  return addr;
}

function generateEthAddress(seed: number): string {
  const hex = '0123456789abcdef';
  let addr = '0x';
  let n = seed * 9301 + 49297;
  for (let i = 0; i < 40; i++) {
    n = (n * 9301 + 49297) % 233280;
    addr += hex[n % hex.length];
  }
  return addr;
}

function main() {
  const seedsDir = path.join(process.cwd(), 'data', 'seeds');
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }

  // 1. Generate Solana Wallets (300 wallets)
  const solHeader = 'address,est_usd_balance,swaps_30d,avg_swaps_per_day,distinct_tokens,avg_holding_hours,label,category,is_exchange_or_bridge,is_contract,is_bot\n';
  const solRows: string[] = [];

  // Add a few deliberate test cases:
  // Exchange wallet (should be rejected)
  solRows.push('5tzFkiKscMRHK5ZXWBCsPU7j5eGqK25kPMFhVn2GCMnS,15000000,200,6.67,40,72,Binance Hot Wallet,exchange,true,false,false');
  // High-frequency bot (should be rejected by ceiling)
  solRows.push('4ZtK8zB4n2m5q8w2y8x7v6u5t4s3r2q1p0o9n8m7l6k5,250000,2800,93.33,12,0.01,Jito MEV Arb Bot,bot,false,false,true');
  // Under-capitalized wallet (should be rejected by balance)
  solRows.push('3aB8zB4n2m5q8w2y8x7v6u5t4s3r2q1p0o9n8m7l6k1,45000,45,1.5,10,24,Small Retail Trader,retail,false,false,false');

  for (let i = 1; i <= 300; i++) {
    const address = generateSolanaAddress(i);
    // Balance between $120k and $8.5M
    const est_usd_balance = Math.round(120000 + ((i * 37) % 8300000));
    // Swaps 30d between 12 and 350
    const swaps_30d = 12 + ((i * 11) % 320);
    const avg_swaps_per_day = parseFloat((swaps_30d / 30).toFixed(2));
    // Distinct tokens between 4 and 45
    const distinct_tokens = 4 + ((i * 7) % 40);
    // Avg holding hours between 6h and 240h
    const avg_holding_hours = 6 + ((i * 13) % 230);
    const label = SOLANA_SAMPLE_LABELS[i % SOLANA_SAMPLE_LABELS.length] + ` #${i}`;
    const category = i % 4 === 0 ? 'fund' : i % 3 === 0 ? 'smart_money' : 'whale';

    solRows.push(
      `${address},${est_usd_balance},${swaps_30d},${avg_swaps_per_day},${distinct_tokens},${avg_holding_hours},${label},${category},false,false,false`
    );
  }

  fs.writeFileSync(path.join(seedsDir, 'sol_wallets.csv'), solHeader + solRows.join('\n'));
  console.log(`Generated sol_wallets.csv with ${solRows.length} rows.`);

  // 2. Generate Ethereum Wallets (300 wallets)
  const ethHeader = 'address,est_usd_balance,swaps_30d,avg_swaps_per_day,distinct_tokens,avg_holding_hours,label,category,is_exchange_or_bridge,is_contract,is_bot\n';
  const ethRows: string[] = [];

  // Deliberate test cases:
  // Exchange wallet
  ethRows.push('0x28c6c06298d514db089934071355e5743bf21d60,45000000,120,4.0,25,96,Binance 14 Hot,exchange,true,false,false');
  // Smart Contract router (should be rejected on EVM)
  ethRows.push('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45,1000000,500,16.67,80,12,Uniswap Universal Router,contract,false,true,false');
  // High-frequency sandwich bot
  ethRows.push('0xae2fc483527b8ef99eb5d9b44875f005ba1fae13,800000,3200,106.67,5,0.005,jaredfromsubway.eth,bot,false,false,true');

  for (let i = 1; i <= 300; i++) {
    const address = generateEthAddress(i);
    const est_usd_balance = Math.round(150000 + ((i * 43) % 15000000));
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
  console.log(`Generated eth_wallets.csv with ${ethRows.length} rows.`);
}

main();

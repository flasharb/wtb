import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

if (!ALCHEMY_API_KEY || ALCHEMY_API_KEY.trim() === '') {
  console.error('❌ Error: ALCHEMY_API_KEY is not defined in your .env file.');
  console.error('Please create or update your .env file with:');
  console.error('ALCHEMY_API_KEY=your_alchemy_api_key_here');
  process.exit(1);
}

const ALCHEMY_ENDPOINT = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Helper function to make JSON-RPC calls to Alchemy
async function jsonRpcRequest(method: string, params: any[] = []): Promise<any> {
  const response = await fetch(ALCHEMY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`HTTP error ${response.status}: ${errorBody}`);
  }

  const json = (await response.json()) as any;
  if (json.error) {
    throw new Error(`RPC Error (${json.error.code}): ${json.error.message}`);
  }

  return json.result;
}

// ERC-20 Transfer event signature: Transfer(address,address,uint256)
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// Tether USD (USDT) on Ethereum Mainnet
const USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

async function main() {
  console.log('🔗 Connecting to Alchemy Ethereum Mainnet endpoint...');
  const maskedKey = ALCHEMY_API_KEY ? `${ALCHEMY_API_KEY.slice(0, 6)}...${ALCHEMY_API_KEY.slice(-4)}` : '';
  console.log(`🔑 Using ALCHEMY_API_KEY: ${maskedKey}`);

  try {
    // 1. Get latest block number
    const latestBlockHex = await jsonRpcRequest('eth_blockNumber');
    const latestBlockNumber = parseInt(latestBlockHex, 16);
    console.log(`📦 Latest Block on Ethereum: #${latestBlockNumber} (${latestBlockHex})`);

    // 2. Query eth_getLogs for the last 3 blocks
    // To ensure we get real data fast without hitting limits, query USDT Transfer events over the last 3 blocks
    const fromBlockNumber = latestBlockNumber - 2;
    const fromBlockHex = '0x' + fromBlockNumber.toString(16);
    const toBlockHex = latestBlockHex;

    console.log(`\n🔍 Fetching logs via eth_getLogs:`);
    console.log(`   - Range: block #${fromBlockNumber} to #${latestBlockNumber}`);
    console.log(`   - Target: USDT contract (${USDT_CONTRACT})`);
    console.log(`   - Event Topic: Transfer (0xddf2...)`);

    const logs = await jsonRpcRequest('eth_getLogs', [
      {
        fromBlock: fromBlockHex,
        toBlock: toBlockHex,
        address: USDT_CONTRACT,
        topics: [TRANSFER_EVENT_TOPIC],
      },
    ]);

    console.log(`\n✅ Successfully fetched ${logs.length} log(s) from Ethereum Mainnet!`);

    if (logs.length > 0) {
      console.log('\n--- Sample Log Preview (First 3 logs) ---');
      logs.slice(0, 3).forEach((log: any, index: number) => {
        const blockNum = parseInt(log.blockNumber, 16);
        const logIdx = parseInt(log.logIndex, 16);
        const fromAddress = log.topics[1] ? '0x' + log.topics[1].slice(26) : 'N/A';
        const toAddress = log.topics[2] ? '0x' + log.topics[2].slice(26) : 'N/A';
        const rawAmount = log.data ? BigInt(log.data).toString() : '0';

        console.log(`\nLog #${index + 1}:`);
        console.log(`  Block: #${blockNum}`);
        console.log(`  Tx Hash: ${log.transactionHash}`);
        console.log(`  Log Index: ${logIdx}`);
        console.log(`  From: ${fromAddress}`);
        console.log(`  To: ${toAddress}`);
        console.log(`  Raw Amount (USDT 6 decimals): ${rawAmount}`);
      });
    }

    console.log('\n🎉 Alchemy eth_getLogs test executed successfully!');
  } catch (err: any) {
    console.error('\n❌ Execution failed:');
    console.error(err.message || err);
    process.exit(1);
  }
}

main();

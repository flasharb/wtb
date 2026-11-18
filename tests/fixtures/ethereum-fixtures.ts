import { EthereumTxPayload } from '../../src/classify/ethereum.js';
import { ERC20_TRANSFER_EVENT_TOPIC } from '../../src/classify/constants.js';

export const WHALE_ETH_WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'; // Vitalik / Whale address
export const TARGET_ERC20_TOKEN = '0x6982508145454ce325ddbe47a25d4ec3d2311933'; // Pepe Token
export const SECOND_ERC20_TOKEN = '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce'; // Shiba Inu

function padAddress(address: string): string {
  return '0x000000000000000000000000' + address.toLowerCase().replace('0x', '');
}

function encodeAmount(amount: bigint): string {
  return '0x' + amount.toString(16).padStart(64, '0');
}

export const ethereumFixtures: Record<
  string,
  { tx: EthereumTxPayload; expectedBuy: boolean; expectedUsd?: number }
> = {
  // 1. Uniswap V3 ETH -> Token Swap ($15,000)
  uniswapV3EthSwap: {
    expectedBuy: true,
    expectedUsd: 15000,
    tx: {
      hash: '0x1111...uniswapV3EthSwap1111111111111111111111111111111111111111111111',
      from: WHALE_ETH_WALLET,
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap Router
      value: 5000000000000000000n, // 5 ETH = $15,000 @ $3000
      status: 1,
      blockNumber: 19000000,
      blockTimestamp: 1700000000,
      logs: [
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'), // from router
            padAddress(WHALE_ETH_WALLET), // to whale
          ],
          data: encodeAmount(10000000000000000000000n), // 10,000 tokens
          logIndex: 12,
        },
      ],
    },
  },

  // 2. Uniswap V2 USDC -> Token Swap ($20,000)
  uniswapV2UsdcSwap: {
    expectedBuy: true,
    expectedUsd: 20000,
    tx: {
      hash: '0x2222...uniswapV2UsdcSwap2222222222222222222222222222222222222222222222',
      from: WHALE_ETH_WALLET,
      to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router
      value: 0n,
      status: 1,
      blockNumber: 19000010,
      blockTimestamp: 1700000010,
      logs: [
        // USDC Outflow
        {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
          ],
          data: encodeAmount(20000000000n), // 20,000 USDC
          logIndex: 5,
        },
        // Token Inflow
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(50000000000000000000000n),
          logIndex: 6,
        },
      ],
    },
  },

  // 3. 1inch Multi-Hop WETH -> Token Swap ($90,000 High Conviction)
  aggregator1inchWethSwap: {
    expectedBuy: true,
    expectedUsd: 90000,
    tx: {
      hash: '0x3333...aggregator1inchWethSwap333333333333333333333333333333333333333333',
      from: WHALE_ETH_WALLET,
      to: '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch Router
      value: 0n,
      status: 1,
      blockNumber: 19000020,
      blockTimestamp: 1700000020,
      logs: [
        // WETH Outflow: 30 WETH = $90,000 @ $3000
        {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0x1111111254fb6c44bac0bed2854e76f90643097d'),
          ],
          data: encodeAmount(30000000000000000000n),
          logIndex: 20,
        },
        // Target Token Inflow
        {
          address: SECOND_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x1111111254fb6c44bac0bed2854e76f90643097d'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(500000000000000000000000n),
          logIndex: 21,
        },
      ],
    },
  },

  // 4. CowSwap DAI -> Token Swap ($12,000)
  cowSwapDaiSwap: {
    expectedBuy: true,
    expectedUsd: 12000,
    tx: {
      hash: '0x4444...cowSwapDaiSwap444444444444444444444444444444444444444444444444',
      from: WHALE_ETH_WALLET,
      to: '0x9008d19f58aabd9ed0d6fb971263270e0a24952c', // GPv2Settlement
      value: 0n,
      status: 1,
      blockNumber: 19000030,
      blockTimestamp: 1700000030,
      logs: [
        // DAI Outflow
        {
          address: '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0x9008d19f58aabd9ed0d6fb971263270e0a24952c'),
          ],
          data: encodeAmount(12000000000000000000000n), // 12,000 DAI
          logIndex: 3,
        },
        // Token Inflow
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x9008d19f58aabd9ed0d6fb971263270e0a24952c'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(25000000000000000000000n),
          logIndex: 4,
        },
      ],
    },
  },

  // 5. Token -> ETH Sell Swap (Selling, NOT a buy)
  tokenSellSwap: {
    expectedBuy: false,
    tx: {
      hash: '0x5555...tokenSellSwap55555555555555555555555555555555555555555555555555',
      from: WHALE_ETH_WALLET,
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: 0n,
      status: 1,
      blockNumber: 19000040,
      blockTimestamp: 1700000040,
      logs: [
        // Token Outflow (Selling Token)
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'),
          ],
          data: encodeAmount(50000000000000000000000n),
          logIndex: 1,
        },
        // WETH Inflow (Receiving Quote)
        {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(15000000000000000000n), // 15 WETH
          logIndex: 2,
        },
      ],
    },
  },

  // 6. Stable-to-Stable Swap (USDC -> DAI)
  stableToStableSwap: {
    expectedBuy: false,
    tx: {
      hash: '0x6666...stableToStableSwap6666666666666666666666666666666666666666666666',
      from: WHALE_ETH_WALLET,
      to: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', // Curve 3pool
      value: 0n,
      status: 1,
      blockNumber: 19000050,
      blockTimestamp: 1700000050,
      logs: [
        {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'),
          ],
          data: encodeAmount(30000000000n), // 30,000 USDC
          logIndex: 10,
        },
        {
          address: '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(30000000000000000000000n), // 30,000 DAI
          logIndex: 11,
        },
      ],
    },
  },

  // 7. Plain ERC-20 Airdrop / Transfer In (0 quote outflow)
  plainErc20TransferIn: {
    expectedBuy: false,
    tx: {
      hash: '0x7777...plainErc20TransferIn7777777777777777777777777777777777777777777',
      from: '0x000000000000000000000000000000000000dead',
      to: TARGET_ERC20_TOKEN,
      value: 0n,
      status: 1,
      blockNumber: 19000060,
      blockTimestamp: 1700000060,
      logs: [
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x000000000000000000000000000000000000dead'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(1000000000000000000000n),
          logIndex: 1,
        },
      ],
    },
  },

  // 8. Exchange Withdrawal of Native ETH
  exchangeWithdrawalEth: {
    expectedBuy: false,
    tx: {
      hash: '0x8888...exchangeWithdrawalEth88888888888888888888888888888888888888888888',
      from: '0x28c6c06298d514db089934071355e5743bf21d60', // Binance hot wallet
      to: WHALE_ETH_WALLET,
      value: 50000000000000000000n, // 50 ETH
      status: 1,
      blockNumber: 19000070,
      blockTimestamp: 1700000070,
      logs: [],
    },
  },

  // 9. Small Buy Below Threshold ($3,000 < $5,000 MIN_BUY_USD)
  smallBuyBelowThreshold: {
    expectedBuy: false,
    tx: {
      hash: '0x9999...smallBuyBelowThreshold9999999999999999999999999999999999999999',
      from: WHALE_ETH_WALLET,
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: 1000000000000000000n, // 1 ETH = $3,000 @ $3000
      status: 1,
      blockNumber: 19000080,
      blockTimestamp: 1700000080,
      logs: [
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress('0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'),
            padAddress(WHALE_ETH_WALLET),
          ],
          data: encodeAmount(1000000000000000000000n),
          logIndex: 1,
        },
      ],
    },
  },

  // 10. Reverted / Failed Transaction (Status: 0)
  revertedTx: {
    expectedBuy: false,
    tx: {
      hash: '0x0000...revertedTx000000000000000000000000000000000000000000000000000000',
      from: WHALE_ETH_WALLET,
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: 10000000000000000000n,
      status: 0, // Failed
      blockNumber: 19000090,
      blockTimestamp: 1700000090,
      logs: [],
    },
  },

  // 11. Uniswap Liquidity Provision Deposit
  uniswapLpDeposit: {
    expectedBuy: false,
    tx: {
      hash: '0xaaaa...uniswapLpDepositaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      from: WHALE_ETH_WALLET,
      to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      value: 10000000000000000000n, // 10 ETH
      status: 1,
      blockNumber: 19000100,
      blockTimestamp: 1700000100,
      logs: [
        // Transfers token OUT to pool
        {
          address: TARGET_ERC20_TOKEN,
          topics: [
            ERC20_TRANSFER_EVENT_TOPIC,
            padAddress(WHALE_ETH_WALLET),
            padAddress('0x7a250d5630b4cf539739df2c5dacb4c659f2488d'),
          ],
          data: encodeAmount(10000000000000000000000n),
          logIndex: 1,
        },
      ],
    },
  },

  // 12. Bridge Deposit Outflow
  bridgeDeposit: {
    expectedBuy: false,
    tx: {
      hash: '0xbbbb...bridgeDepositbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      from: WHALE_ETH_WALLET,
      to: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a', // Arbitrum Bridge Inbox
      value: 20000000000000000000n, // 20 ETH
      status: 1,
      blockNumber: 19000110,
      blockTimestamp: 1700000110,
      logs: [],
    },
  },
};

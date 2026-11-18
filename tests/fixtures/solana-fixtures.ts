import { HeliusSwapPayload } from '../../src/classify/solana.js';

export const WHALE_SOL_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
export const TARGET_TOKEN_MINT = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'; // Popcat / Meme token
export const SECOND_TOKEN_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // Bonk token

export const solanaFixtures: Record<string, { tx: HeliusSwapPayload; expectedBuy: boolean; expectedUsd?: number }> = {
  // 1. Jupiter Direct SOL -> Token Swap ($10,000)
  jupiterSolSwap: {
    expectedBuy: true,
    expectedUsd: 10000,
    tx: {
      signature: '5K3yGj...jupiterSolSwap1111111111111111111111111111111111111111111111111111111111111111',
      type: 'SWAP',
      source: 'JUPITER',
      timestamp: 1700000000,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          nativeInput: {
            account: WHALE_SOL_WALLET,
            amount: '50000000000', // 50 SOL = $10,000 @ $200/SOL
          },
          nativeOutput: null,
          tokenInputs: [],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: TARGET_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '2500000000000', decimals: 6 },
            },
          ],
        },
      },
    },
  },

  // 2. Raydium USDC -> Token Swap ($15,000)
  raydiumUsdcSwap: {
    expectedBuy: true,
    expectedUsd: 15000,
    tx: {
      signature: '4J2x...raydiumUsdcSwap2222222222222222222222222222222222222222222222222222222222222222',
      type: 'SWAP',
      source: 'RAYDIUM',
      timestamp: 1700000010,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          nativeInput: null,
          nativeOutput: null,
          tokenInputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              rawTokenAmount: { tokenAmount: '15000000000', decimals: 6 },
            },
          ],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: SECOND_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '450000000000', decimals: 5 },
            },
          ],
        },
      },
    },
  },

  // 3. Pump.fun SOL -> Meme Coin Swap ($7,000)
  pumpFunSolSwap: {
    expectedBuy: true,
    expectedUsd: 7000,
    tx: {
      signature: '3H1w...pumpFunSolSwap3333333333333333333333333333333333333333333333333333333333333333',
      type: 'SWAP',
      source: 'PUMP_FUN',
      timestamp: 1700000020,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          nativeInput: {
            account: WHALE_SOL_WALLET,
            amount: '35000000000', // 35 SOL = $7,000 @ $200
          },
          nativeOutput: null,
          tokenInputs: [],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: TARGET_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '10000000000000', decimals: 6 },
            },
          ],
        },
      },
    },
  },

  // 4. Aggregator Multi-Hop Route USDC -> Token ($50,000 High Conviction)
  aggregatorMultiHopSwap: {
    expectedBuy: true,
    expectedUsd: 50000,
    tx: {
      signature: '2G0v...aggregatorMultiHopSwap44444444444444444444444444444444444444444444444444444444444',
      type: 'SWAP',
      source: 'JUPITER',
      timestamp: 1700000030,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          tokenInputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              rawTokenAmount: { tokenAmount: '50000000000', decimals: 6 },
            },
          ],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: TARGET_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '20000000000000', decimals: 6 },
            },
          ],
          innerSwaps: [{ route: 'USDC -> WSOL -> TARGET' }],
        },
      },
    },
  },

  // 5. Token -> SOL Sell Swap (Selling Token for SOL)
  tokenSellSwap: {
    expectedBuy: false, // Sell, NOT a buy
    tx: {
      signature: '1F9u...tokenSellSwap55555555555555555555555555555555555555555555555555555555555555555',
      type: 'SWAP',
      source: 'RAYDIUM',
      timestamp: 1700000040,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          tokenInputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: TARGET_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '5000000000000', decimals: 6 },
            },
          ],
          nativeInput: null,
          nativeOutput: {
            account: WHALE_SOL_WALLET,
            amount: '60000000000', // 60 SOL received
          },
          tokenOutputs: [],
        },
      },
    },
  },

  // 6. Stable-to-Stable Swap (USDC -> USDT)
  stableToStableSwap: {
    expectedBuy: false, // Both are quote assets
    tx: {
      signature: '6E8t...stableToStableSwap666666666666666666666666666666666666666666666666666666666666',
      type: 'SWAP',
      source: 'ORCA',
      timestamp: 1700000050,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          tokenInputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
              rawTokenAmount: { tokenAmount: '25000000000', decimals: 6 },
            },
          ],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
              rawTokenAmount: { tokenAmount: '25000000000', decimals: 6 },
            },
          ],
        },
      },
    },
  },

  // 7. Plain Token Airdrop (No quote asset spent)
  plainAirdrop: {
    expectedBuy: false, // No quote outflow
    tx: {
      signature: '7D7s...plainAirdrop7777777777777777777777777777777777777777777777777777777777777777',
      type: 'TRANSFER',
      timestamp: 1700000060,
      feePayer: 'AirdropDistributor11111111111111111111111111',
      tokenTransfers: [
        {
          fromUserAccount: 'AirdropDistributor11111111111111111111111111',
          toUserAccount: WHALE_SOL_WALLET,
          tokenAmount: 1000000,
          mint: TARGET_TOKEN_MINT,
        },
      ],
    },
  },

  // 8. Exchange Withdrawal of Native SOL
  exchangeWithdrawalSol: {
    expectedBuy: false, // Native SOL received, no altcoin
    tx: {
      signature: '8C6r...exchangeWithdrawalSol8888888888888888888888888888888888888888888888888888888',
      type: 'TRANSFER',
      timestamp: 1700000070,
      feePayer: 'BinanceHotWallet111111111111111111111111111111',
      nativeTransfers: [
        {
          fromUserAccount: 'BinanceHotWallet111111111111111111111111111111',
          toUserAccount: WHALE_SOL_WALLET,
          amount: 50000000000,
        },
      ],
    },
  },

  // 9. Small Buy Below Threshold ($1,600 < $5,000 MIN_BUY_USD)
  smallBuyBelowThreshold: {
    expectedBuy: false, // Below threshold
    tx: {
      signature: '9B5q...smallBuyBelowThreshold99999999999999999999999999999999999999999999999999999',
      type: 'SWAP',
      source: 'RAYDIUM',
      timestamp: 1700000080,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          nativeInput: {
            account: WHALE_SOL_WALLET,
            amount: '8000000000', // 8 SOL = $1,600 @ $200
          },
          nativeOutput: null,
          tokenInputs: [],
          tokenOutputs: [
            {
              userAccount: WHALE_SOL_WALLET,
              mint: TARGET_TOKEN_MINT,
              rawTokenAmount: { tokenAmount: '100000000', decimals: 6 },
            },
          ],
        },
      },
    },
  },

  // 10. Failed Transaction (Reverted on chain)
  failedTransaction: {
    expectedBuy: false,
    tx: {
      signature: '0A4p...failedTransaction00000000000000000000000000000000000000000000000000000000',
      type: 'SWAP',
      source: 'JUPITER',
      timestamp: 1700000090,
      feePayer: WHALE_SOL_WALLET,
      transactionError: { InstructionError: [2, 'Custom(1)'] },
      events: {
        swap: {
          nativeInput: { account: WHALE_SOL_WALLET, amount: '50000000000' },
          tokenOutputs: [{ userAccount: WHALE_SOL_WALLET, mint: TARGET_TOKEN_MINT, rawTokenAmount: { tokenAmount: '100', decimals: 6 } }],
        },
      },
    },
  },

  // 11. Liquidity Pool Deposit
  liquidityPoolDeposit: {
    expectedBuy: false, // LP deposit is not a token buy
    tx: {
      signature: '1Z3o...liquidityPoolDeposit1111111111111111111111111111111111111111111111111111111',
      type: 'ADD_LIQUIDITY',
      timestamp: 1700000100,
      feePayer: WHALE_SOL_WALLET,
      events: {
        swap: {
          nativeInput: { account: WHALE_SOL_WALLET, amount: '50000000000' },
          nativeOutput: null,
          tokenInputs: [],
          tokenOutputs: [
            // Returns LP Token (treated as quote/LP)
            { userAccount: WHALE_SOL_WALLET, mint: 'So11111111111111111111111111111111111111112', rawTokenAmount: { tokenAmount: '1000', decimals: 9 } }
          ],
        },
      },
    },
  },
};

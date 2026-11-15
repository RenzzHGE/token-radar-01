# Token Radar

[![Token Radar bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/RenzzHGE/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/RenzzHGE/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Radar ranks every pre-token protocol in the sealed snapshot by what its token launch would be worth — TVL times the multiple the live market pays its category — and gives each one a seven-step farm plan with costs and times, in a sortable, filterable dashboard.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/`, with `out/dossier.json` last. Node 22 or newer, standard library only, no network.

## How it works

The model, radar-2, is a market-calibrated multiple, not a flat constant. The snapshot's own live protocols set the price: for each category, the median market-cap-to-TVL ratio of its live protocols, shrunk toward the global median with a prior weight of 5 and clamped to 0.25×–3× the global median — so a category with one live protocol is pulled hard toward the market average instead of inheriting an outlier. Implied value is TVL × that multiple × a chain-breadth factor (up to +20% for ten extra chains) × a growth factor from the seven-day change × a maturity factor from the time the protocol has run with no token.

The board covers all 203 rankable pre-token protocols: the 40 watchlist slugs plus every other rankable one, including launches above the watchlist floor the watchlist missed. Bridges, wrapped assets and liquid-staking receipts are excluded — their token already trades, so there is no launch to rank. The live-token protocols are set aside with their market caps shown, and their multiples are what calibrate the model.

The dashboard is a static page with no network: a radar scope of the top 12, a top-five list, a sortable and filterable board (search, category, chain, minimum TVL), a live-token view, the full calibration table, a model sandbox that re-ranks the board live when a constant changes, and a detail view per protocol with the model's own arithmetic and the seven-step farm plan. Farm plans are derived from each protocol's category, chains, TVL and age, with gas priced per chain.

Implied value is a model, not a price, and a launch is never guaranteed.

Optional: earn referral rewards, a second way to make money: https://make.fun/r/9nf38kge

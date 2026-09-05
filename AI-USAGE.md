# AI Usage

ETHOnline 2026 requires disclosure of how AI tools were used. This file is kept up to date
as the project is built, not written at the end.

## Tools used

| Tool | Purpose |
|---|---|
| Claude (Anthropic) | Planning, API reference lookup, code review, debugging assistance |

## Where AI was used

<!-- Update this table as you go. One row per area, be specific about files. -->

| Area | Files | Nature of assistance |
|---|---|---|
| Project planning | — | Bounty analysis, scoping, schedule |
| README and docs | `README.md` | Drafting and editing |
| | | |

## Where AI was not used

<!-- Equally important. Judges want to see meaningful human contribution. -->

- The core design decision — modelling an invoice as a zero-coupon bond so it maps onto ATS
  `deployBond` — comes from my own work at Indonesia Eximbank, where I automated Drawdown
  Loan document generation inside a UBS Oracle core banking platform.
- Domain rules around receivables, discounting, and non-recourse purchase.
- All debugging decisions and the final shape of the code.

## Learning done before the hackathon

Between 16 and 25 August 2026 I worked through Hedera's native services as throwaway
practice projects in unrelated domains (loyalty tokens, event tickets, cold-chain logging).
No project-specific code, design, or assets for Forfait existed before the hackathon opened.
Those practice repositories are separate from this one.

The measured fee figures quoted in `README.md` come from those practice transactions on
Hedera testnet.
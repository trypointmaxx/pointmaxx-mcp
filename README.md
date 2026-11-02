# pointmaxx-mcp

Ask your AI assistant which credit card to use, and which cards would earn you the most, with the same math as [pointmaxx.app](https://pointmaxx.app). Compares 53 U.S. credit cards after annual fees, spending caps and the credits you'd actually use.

## Set it up

**Claude Desktop:** open Settings, then Developer, then Edit Config, add this, and restart Claude:

```json
{
  "mcpServers": {
    "pointmaxx": { "command": "npx", "args": ["-y", "pointmaxx-mcp"] }
  }
}
```

**Any other MCP app:** run `npx -y pointmaxx-mcp` as a stdio server. Needs Node 18 or later.

## What you can ask

| Tool | Ask your assistant something like |
|---|---|
| `best_card` | "I have Amex Gold and Citi Double Cash. Which should I use on DoorDash?" |
| `compare_cards` | "I spend about $500 a month on groceries, $300 on dining and $1,500 on everything else. Which two cards would earn the most? I have a Double Cash." |
| `card_terms` | "What's the annual fee on the Sapphire Reserve, and what are its credits?" |

Answers include each card's percent back, why it wins, any spending cap, the net value a year after fees, and how much more that is than the cards you already have.

## Privacy

It runs on your own computer and makes no network requests. It only needs card names and rough monthly spending by category: never statements, card numbers or a login. Nothing is saved.

## Good to know

- Estimates from each card's published terms, checked against issuer pages. Not financial advice; check the issuer before you apply.
- Points are valued at a fixed cents-per-point for each card. Sign-up bonuses are left out.
- Card terms are built into each release. Run with `npx -y pointmaxx-mcp` to always get the latest.

For a full backtest on a year of your own statements, read in your browser and never uploaded, try [pointmaxx.app](https://pointmaxx.app).

MIT licensed. Card data includes [CardPin](lib/CARDPIN-LICENSE.txt) (MIT).

## Source
This repo is the published package: `server.mjs` plus the engine and card data in `lib/`, copied from PointMaxx's main codebase at each release. Run `npm test` to check it.

# Mythwrought Development HQ

An independent, read-only development dashboard for the Mythwrought game. It collects public GitHub evidence into a static snapshot and runs as an installable web app on GitHub Pages.

## Run locally

Use Node.js 24. No package installation is required.

```sh
npm test
npm run sync
npm run build
npm run dev
```

Open `http://127.0.0.1:3000/Mythwrought-dev-hq/`. In an environment with an HTTPS proxy, use `NODE_USE_ENV_PROXY=1 npm run sync`. Build without a snapshot to test the unavailable-data state. GitHub Actions requires a validated snapshot.

## Sources and operations

- [Architecture and Pages runbook](docs/ARCHITECTURE.md)
- [Reporting protocol and developer onboarding](docs/REPORTING.md)
- [Development checkpoints](docs/CHECKPOINT.md)

The production target is [Mythwrought Development HQ](https://hdog960.github.io/Mythwrought-dev-hq/). The separate [game repository](https://github.com/hdog960/Mythwrought) is a read-only source for HQ.

# Architecture and operation

## Data flow

```text
Public GitHub API + public game release metadata
       ↓
HQ-only GitHub Actions collector
       ↓
Evidence projection, report validation, exact-commit verification
       ↓
Last valid per-source values and collection-health metadata
       ↓
Atomic GitHub Pages deployment of a versioned static build
       ↓
Browser snapshot validation, offline cache and read-only views
```

`config/sources.mjs` contains stable developer and assignment IDs, repository and source bindings, and the applicable creator directives. A name can change without changing an ID. A new assignment gets a distinct assignment ID. Keep historical report records linked to the historical assignment ID. The registry ships a provisional roster for sources listed in the creator brief. Publicly confirmed scopes link to the underlying issue, PR, or repository. Developers with private schedules or checkpoints remain unconfirmed until creator-authorized sources are available.

The collector reads the game main ref, a bounded PR and issue window, registered PRs and exact branch HEADs, recent workflows, exact-commit checks, public releases, Pages deployments, and the game HTML release identifier. The development dashboard exposes these as source evidence. It does not infer activity from PR presence, full qualification from check success, accepted gameplay from a deployment, or a completed scheduler run from a planned time. Public branch protection API access can leave required checks unknown. Recent windows are bounded to protect the source quota.

Public report ingestion binds a versioned allowlisted report to a registered repository, publisher, assignment, and exact branch history. Content outside the report block stays at the source. Legacy comments remain linked through GitHub without inferred milestone or authorization changes. Browser rendering uses text nodes and GitHub links from a restricted URL allowlist. The build copies only application files and the normalized snapshot into Pages. Snapshot and collector cache records are public-safe and contain no tokens or original comment bodies. Public text requires explicit publisher consent. Keep personal information, private conversations, and credentials out of each public report.

## Synchronization

`scripts/sync.mjs` saves sanitized collector state atomically. The GitHub Actions workflow uses a concurrency group, schedules at :07/:17/:27/:37/:47/:57 UTC, and supports manual dispatch on main. Actual start times depend on GitHub. The Pages publish step runs for changes, on manual dispatch, or at a 30-minute heartbeat. A failed source retains its last usable data with health details. A failed first core collection leaves the site untouched. The previous published snapshot backs up Actions cache state. Cache entries contain conditional request tags and comment cursors. A missing cache replays the bounded report window and deduplicates against previously published history. Report history is append-only in the snapshot.

The static frontend requests one snapshot on launch and while foregrounded. The service worker caches the content-derived shell under the repository scope. The app caches only a validated snapshot. Offline and old data are labeled. The Idea Vault and preferences use local browser storage and stay across shell updates. JSON export is the backup and transfer mechanism.

## GitHub Pages operation

Public repository metadata and the existing successful deployment confirm that Pages is enabled. During repository discovery the site served the initial README. An authenticated check confirmed the initial Pages source was main at the repository root using branch-based publishing.

For a repository moving from branch-based publishing, configure **Settings → Pages → Source → GitHub Actions** in the HQ repository or confirm that selection if it is already set. Run **Synchronize and deploy Development HQ** manually on main for first release verification. The workflow writes only to the HQ Pages environment. Its collect job uses the repository-scoped GitHub Actions token with contents-read permission and public read fallback. Its deploy job has only Pages write and OIDC token permissions. No game or private automation credentials are required for the public pipeline.

Check the published `version.json` for the source SHA and shell version. Check `data/snapshot.json` for actual source freshness. On physical iPhone Safari, open the HQ URL, choose **Share → Add to Home Screen**, and test launch, portrait, landscape, and offline reopening after the first successful load. Use the reporting coverage page to verify source status through GitHub.

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

`scripts/sync.mjs` saves sanitized collector state atomically. The GitHub Actions workflow uses a concurrency group, schedules at :07/:17/:27/:37/:47/:57 UTC, and supports manual dispatch on main. A new owner-published report marker on HQ PR #1 also requests a refresh. Reports from the game repository continue to arrive through the scheduled collector. Actual start times depend on GitHub. The Pages publish step runs for changes, on manual dispatch, or at a 30-minute heartbeat. A failed source retains its last usable data with health details. A failed first core collection leaves the site untouched. The previous published snapshot backs up Actions cache state. Cache entries contain conditional request tags and comment cursors. A missing cache replays the bounded report window and deduplicates against previously published history. Report history is append-only in the snapshot.

The static frontend requests one snapshot on launch and while foregrounded. The service worker caches the content-derived shell under the repository scope. The app caches only a validated snapshot. Offline and old data are labeled. The Idea Vault and preferences use local browser storage and stay across shell updates. JSON export is the backup and transfer mechanism.

Registered branches and PR checks reconcile independently. A failed lookup retains the last branch SHA and observation time for reference while clearing the current assignment HEAD. A PR detail failure can use a matching row from a successful current list. A check-run failure can retain earlier results at the same SHA for that PR as preserved evidence with unknown required status. Mandatory context matches can come from active public rulesets or readable legacy branch protection. Ruleset completeness still depends on visibility into legacy protection. Reporting coverage shows both the latest observed scheduled HQ run and the latest completed scheduled run. The first observed schedule on this workflow successfully collected and published on the unchanged main branch at 02:07 UTC on November 28. GitHub exposes the recorded run and its job outcomes. The preceding gap has no recorded job to diagnose. [First scheduled HQ run](https://github.com/hdog960/Mythwrought-dev-hq/actions/runs/46096515947)

## Operations overview

The home screen groups manual, Codex, and automatic assignments. The automatic roster covers the creator's 15 slots. Ten fluid developer roles are recorded from the connected automation configuration, and five older lanes are listed from the creator's brief pending reconfirmation. The capture contains role names, public game assignments, schedule metadata, and the completion and creator-follow-up flags from five observed scheduler results. Two of those results link to verified public commits. Historical scheduler results show their observation time. Private scheduler IDs, raw prompts, and result text stay outside the repository. Personal and Business views use creator ownership records first and browser labels as a fallback. A saved manual developer conversation shortcut is local to that browser. Continue Development copies the current verified continuation text for the exact known HEAD. Open Conversation opens the locally configured ChatGPT link.

The Command Center puts explicit ownership collisions and failed required checks first, followed by pending approvals, reported engineering blockers, integration candidates, and explicitly unassigned developers. Exact-commit requests move out of the current queue when their HEAD changes or cannot be verified. Integration candidates require a current open PR and completion evidence. Every action links to its source and the overview exposes the reporting gaps alongside the queue. Developer profiles combine linked sources with time-limited execution observations. The Testing state uses exact branch and commit matches for the known qualification workflows listed in `config/sources.mjs`.

Congestion displays GitHub's repository-wide workflow run totals and a bounded list of run details for each status. Developer execution comes from authenticated reports, with unknown or stale coverage marked explicitly. Related GitHub runs match the verified assignment branch and commit. Reported work blockers and verified release constraints have separate labels.

The scoped congestion page scores assessed assignments from 0 to 100 using evidence for engineering blockers (20), creator decisions (10), required qualification (20), requested PR reviews (10), dependency and handoff blockers (15), checkpoint drift (10), ownership overlaps (10), and implementation awaiting integration (5). A category contributes its weight multiplied by the fraction of assessed assignments with an observed signal. Each assignment counts at most once within a category and may contribute to distinct categories. The lower bound counts only affected assignments and the upper bound also allows every unknown observation. Bounds round outward. Use a single rounded score when all observations are known. Intentionally deferred, explicitly unassigned, and exactly reported accepted work stays out of the denominator. Open registered drafts and creator release constraints are still visible on the page. A draft contributes no requested-review signal. The requested-review endpoint counts outstanding requests, including teams. A zero from that endpoint establishes only an empty request list. Historical checkpoints serve as reconciliation cues. The required gate stays unavailable where rule or result coverage is insufficient.

The evidence vault reconciles Check Runs and legacy Combined Status contexts at the exact PR commit. A partial or failed feed cannot clear a gate. GitHub App-bound rules require attributable check results. Legacy statuses with the same name as a required check must also pass, and a status without a verifiable App ID cannot satisfy an App-bound requirement. The other feed can still show a sourced required failure or pending check. Preserved rows remain visible with the requirement marked unavailable.

Release Center shows exact candidate and base commits, creator authorization, merge commit, recorded deployment, and physical iPhone acceptance separately. The collector computes a Git blob hash of the public HTML and compares it with `index.html` on the latest successful GitHub Pages commit. A unique match links both the deployment job and the commit. This check covers the HTML entry point. Historical deployment success remains traceable after GitHub marks the deployment inactive. Physical acceptance requires a creator-enrolled receipt for the verified deployment commit and public release ID.

The Roadmap counts milestones from compatible reported plans, shows remaining-session estimates on each program, and follows registered required dependencies across workspace boundaries. A critical-path estimate needs complete estimates on the linked programs and a consistent graph. Remaining work sessions measure effort along that chain. They leave waiting time for approvals, release coordination, and physical acceptance open.

Automation oversight distinguishes schedule configuration, scheduler observations, repository checkpoints, authenticated execution reports, and production output. A calculated next occurrence requires a schedule observation within the previous 24 hours. Development efficiency flags repeated blocker IDs and distinct workflow runs with matching reported commit, suite, environment, scope, and artifact digest. Reused evidence is excluded from the repeat count. A match provides a review lead under #501. For Skill and Combat, the exact base and candidate file comparison highlights paths outside the active creator-approved boundaries, with a separate count for workflow and build files. Check coordination records with the affected owners before drawing conclusions. The studio timeline combines structured accomplishments, milestones, creator ownership records, authorizations, and bounded GitHub merge and deployment history.

Creator Notes supports browser-local editing, archiving, copying, and Markdown export. The optional private ChatGPT Page shortcut is stored on the device. Notes added on the private Page can be referenced in a chat that has access. The public build and collector have no note or private shortcut inputs.

## Desktop browser checks

After collecting a snapshot, build and serve HQ locally. Run `python tests/desktop-smoke.py --browser chromium` or `--browser firefox` with Python Playwright and that browser available. The checks cover keyboard focus, short desktop windows, the effective screen widths of laptop zoom, and an offline reload. An installed Chromium executable can be supplied with `--executable`.

## GitHub Pages operation

Public repository metadata and the existing successful deployment confirm that Pages is enabled. During repository discovery the site served the initial README. An authenticated check confirmed the initial Pages source was main at the repository root using branch-based publishing.

The repository can publish its tested release while the existing Pages setting uses main at the repository root. The root contains the generated static release from `dist/`, a validated public snapshot, and `.nojekyll`. This gives the branch publisher an installable app to serve during a branch build. Normal application changes belong in `src/`. The synchronization workflow continues publishing current snapshots without committing generated data on each run. The browser keeps its newest validated snapshot if branch publishing briefly serves an earlier data capture.

For a release while branch publishing is enabled, run the collector and build from the release source commit. Stage only the validated static distribution at the root, then verify its files and snapshot before merging. Wait for the branch deployment before manually dispatching the Actions workflow. The embedded `version.json` identifies the source commit used to generate the root build. Actions stamps the merged main commit when it publishes the refreshed artifact.

An owner can switch **Settings → Pages → Source → GitHub Actions** to use only artifact-based deployments. After that is verified, remove the generated root files in a regular release. The collector job keeps contents-read permission and public API fallback. The deploy job has Pages write and OIDC token permissions.

Check the published `version.json` for the source SHA and shell version. Check `data/snapshot.json` for actual source freshness. On physical iPhone Safari, open the HQ URL, choose **Share → Add to Home Screen**, and test launch, portrait, landscape, and offline reopening after the first successful load. Use the reporting coverage page to verify source status through GitHub.

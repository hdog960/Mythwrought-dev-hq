# Developer reports and onboarding

HQ prefers existing authorized public checkpoint comments or dedicated public HQ tracking issues. A source is enrolled by an HQ configuration change mapping one assignment to a repository, issue or pull request number, and explicitly approved GitHub publisher account IDs. Structured intake reads game PRs #502, #503, #514 and #515 and HQ PR #1. HQ PR #1 is the reporting source for the Development HQ assignment. Approval for a new source or an amendment to an active developer or automation belongs to the creator.

## Report format

Use one exact marker and JSON block. The executable v1 schema is `scripts/report.mjs`. The illustrative example in `reports/session-report-v1.example.json` uses a placeholder SHA and is only a template. Copy the actual exact commit and session details from your authorized checkpoint before posting. Include each standard item you know and omit or set unavailable optional items to null.

````text
<!-- mythwrought-hq-report:v1 -->
```json
{ ...one valid v1 report object... }
```
````

| Contract | Fields |
| --- | --- |
| Identity | `schemaVersion: 1`, `publish: true`, `reportId`, `developerId`, `assignmentId`, `category`, `sessionId`, `reportedAt` |
| Source | `repository`, `branch`, full `commit`, `pull`, `issue`, `checkpoint` |
| Progress | `outcome`, `completed`, `milestone`, `roadmapRevision`, `roadmap`, `newlyCompleted`, `quantitative`, `remaining`, `estimate`, `releaseReadiness` |
| Coordination | `execution`, `blockers`, `dependencyIds`, `qualification`, `reusableEvidence`, `decisions`, `nextObjective`, `continuation`, `ownership`, `physicalAcceptance` |

Required identity fields, repository, branch, commit, and outcome must always be present. IDs are stable lowercase letters, digits and hyphens. Dates are UTC ISO 8601. Use one of `development`, `qualification`, `administration`, `waiting`, `blocked`, or `failed` for outcome. Qualified and released quantities require their own evidence. An estimate is an object with numeric `optimistic`, `likely`, and `conservative` session ranges, `confidence`, and a `rationale`. A blocker has stable `id`, `category`, `description`, `detectedAt`, a public `evidence` URL, and optional `owner` and `resolution`. Use a new report ID for a correction. Earlier reports remain visible in history. Keep decisions under one stable decision ID across reports. Creator authorizations require a separately enrolled creator source.

Examples rejected by design include an abbreviated commit, mismatched assignment, report block without `publish: true`, extra field `privateNotes`, a nonregistered publisher, or an exact commit the collector cannot tie to the enrolled branch. Secret-like values and email addresses are rejected. Text publishes to a public site. Verify that notes, prompts and links are public-safe before posting.

## Creator ownership records

Under [creator rule #509](https://github.com/hdog960/Mythwrought/issues/509), the optional `ownership` object records an existing explicit creator decision. The source must be enrolled for creator ownership records and the comment must come from its allowlisted creator account. Use `workspace` of `personal` or `business`, `assignmentState` of `assigned` or `unassigned`, a public accountable `owner` label (or `null` when unassigned), and `exclusiveScopes` containing stable IDs for explicitly reserved work packages. Use an empty list when there are no explicit reservations. Agree on the IDs in the canonical issue or PR before recording a reservation. HQ compares exact scope IDs or branch names within a repository and links both owner records when it finds an overlap. Page preferences remain a browser-local fallback.

Record ownership in the next meaningful authorized checkpoint. The latest creator ownership record persists across ordinary progress reports and changes only when a later authenticated creator record replaces it. Keep unconfirmed workspace ownership unavailable.

The existing ownership issues [#511](https://github.com/hdog960/Mythwrought/issues/511), [#512](https://github.com/hdog960/Mythwrought/issues/512), and [#513](https://github.com/hdog960/Mythwrought/issues/513) already identify the ten Business liquid lanes and two Personal lanes. The collector verifies the creator account, open issue, and reviewed body digest before displaying these records. A changed issue needs review. A newer authenticated ownership report takes precedence.

## Public checkpoint links

Enrolled checkpoint files and creator comments can appear on the dashboard before an assignment publishes its first structured report. Files link to the latest revision of the exact enrolled path within the verified branch history. A pinned creator comment must belong to the enrolled PR, carry the expected full SHA, and remain on the verified assignment history. HQ publishes link, date, and commit metadata. Use a structured report for ownership changes, activity claims, decisions, typed blockers, qualification, or copyable continuation text. An older checkpoint remains visible as a historical link.

The linked sources cover the public #503 merge checkpoint, numbered session handoffs on the Age of Beasts, Skill and Combat branches, and the stable checkpoint path on each of the ten Business liquid lanes. The collector finds the highest unambiguous session number inside each enrolled directory at the observed branch HEAD. New patterns or paths can be enrolled after review, and owners can publish structured reports to the existing feeds.

Continue Development composes the observed branch and SHA, ownership, current directives, exact-commit checks and recorded dependencies. A matching public checkpoint enables the action even when the developer has no structured report. The prompt links that checkpoint for the next authorized objective and asks the developer to recheck GitHub before writing.

## Physical iPhone receipt

The creator can record test results using the optional `physicalAcceptance` object on a source enrolled for creator authorization. Include the full deployed `commit`, public release `version`, public `device` description, `result` of `passed` or `failed`, UTC `observedAt`, and a public `evidence` link. Set `final` to true only when the creator records full acceptance. Release Center checks the receipt against the verified public deployment and the test observation time. Record automated browser tests under `qualification` instead.

## Developer run status

Use the optional `execution` object for the latest verified workflow of the developer or automation itself. Include `state` (queued, running, waiting, blocked, or complete), `observedAt` in UTC, and a public `evidence` link from an allowlisted repository. The observation precedes or matches the report timestamp. HQ groups current reports by state and marks observations older than two hours as unknown for active status. A completed session and project acceptance have distinct fields. Keep CI workflow evidence in the existing GitHub or qualification fields.

## Estimate from milestones

To enable a throughput estimate, publish a `roadmap` with a stable `revision` and its milestone records. Each milestone has `id`, `label`, `effort` on the assignment’s own consistent scale, `kind` of development or qualification, and a boolean `complete`. Subsequent session reports identify that revision in `roadmapRevision`. Use `newlyCompleted` for milestones actually completed in that session. Include an empty array for eligible development or qualification sessions that completed no new milestone. Publish a new revision when changing scope or effort assumptions. An additive revision can reuse observed throughput when each original milestone keeps its ID, work type, and effort. Mark previously completed work in the new revision when it remains applicable. Previous reports stay in history. HQ derives a range when the revision has sufficient observed throughput and otherwise uses a valid developer estimate when available.

## Copyable amendments

**Manual developer.** After meaningful work or a change in a verified blocker, qualification result or creator request, append one HQ v1 marker and report to the existing creator-approved checkpoint. Use your registered assignment ID, actual branch and full HEAD, source evidence, concise work remaining, and a precise public-safe continuation prompt. Keep the existing handoff and release authorizations intact.

**Automatic developer.** When an authorized run produces a checkpoint, append one HQ v1 report to its approved tracking location using a stable delivery ID, actual timestamp and outcome. Record a meaningful accomplishment only when supported. Report a failed or waiting outcome separately. Keep the existing schedule and assignment.

**Codex project.** Include the HQ report in the approved project checkpoint, giving the scoped repository, assignment, branch and full HEAD, changed milestones, evidence, and creator decisions. Use assigned project scope and include no credentials or private conversation detail.

## Coverage and troubleshooting

| Group | Initial discovery |
| --- | --- |
| Three-in-One and Age of Beasts | Confirmed public assignment and protected PR. Registered intake PRs #503 and #502, respectively. |
| Cave, Enchanted Forest, Mountain, Desert, Snow | Listed by the brief. Verify current creator priority, branch and reporting channel before onboarding. |
| Master :00 | Current building ownership confirmed by creator issue #507. Verify active checkpoint channel and schedule timezone. |
| :12, :24, :36, :48 | Public toolkit recognizes lane identities and points to existing automation instructions. Verify the current assignments, schedules and approved reporting surfaces with the creator. |
| Floating Islands | Named by the brief and public creator issue #498. Confirm the current assignment and checkpoint path. |
| Development HQ | HQ PR #1 is the enrolled checkpoint source. Its reports bind to this repository’s main branch. |

Symptoms commonly come from a report posted to a different issue, an unmatched branch or PR HEAD, a pending Actions run, malformed JSON, or a report ID reused for a correction. Check **More → Reporting coverage** for a source error and compare the time of the report with the last attempted collection. The next step after authorized onboarding is one genuine verified report from each category and coverage reconciliation for each remaining source.

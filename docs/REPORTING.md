# Developer reports and onboarding

HQ prefers existing authorized public checkpoint comments or dedicated public HQ tracking issues. A source is enrolled by an HQ configuration change mapping one assignment to a repository, issue or pull request number, and explicitly approved GitHub publisher account IDs. Current intake reads registered PRs #502 and #503. Their existing comments have no accepted HQ reports. Approval for a new source or an amendment to an active developer or automation belongs to the creator.

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
| Progress | `outcome`, `completed`, `milestone`, `newlyCompleted`, `quantitative`, `remaining`, `estimate`, `releaseReadiness` |
| Coordination | `blockers`, `dependencyIds`, `qualification`, `reusableEvidence`, `decisions`, `nextObjective`, `continuation` |

Required identity fields, repository, branch, commit, and outcome must always be present. IDs are stable lowercase letters, digits and hyphens. Dates are UTC ISO 8601. Use one of `development`, `qualification`, `administration`, `waiting`, `blocked`, or `failed` for outcome. Qualified and released quantities require their own evidence. An estimate is an object with numeric `optimistic`, `likely`, and `conservative` session ranges, `confidence`, and a `rationale`. A blocker has stable `id`, `category`, `description`, `detectedAt`, a public `evidence` URL, and optional `owner` and `resolution`. Use a new report ID for a correction. Earlier reports remain visible in history. Keep decisions under one stable decision ID across reports. Creator authorizations require a separately enrolled creator source.

Examples rejected by design include an abbreviated commit, mismatched assignment, report block without `publish: true`, extra field `privateNotes`, a nonregistered publisher, or an exact commit the collector cannot tie to the enrolled branch. Secret-like values and email addresses are rejected. Text publishes to a public site. Verify that notes, prompts and links are public-safe before posting.

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
| Development HQ | This repository is the project source. Enroll an HQ checkpoint source after an authorized report channel is agreed. |

Symptoms commonly come from a report posted to a different issue, an unmatched branch or PR HEAD, a pending Actions run, malformed JSON, or a report ID reused for a correction. Check **More → Reporting coverage** for a source error and compare the time of the report with the last attempted collection. The next step after authorized onboarding is one genuine verified report from each category and coverage reconciliation for each remaining source.

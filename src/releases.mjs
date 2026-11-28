import { approvalQueue, latestFor } from './model.mjs';

const gameRepo = 'hdog960/mythwrought';
const timeOf = item => Date.parse(item.recordedAt ?? item.reportedAt);
const newest = (a, b) => timeOf(b) - timeOf(a);

function physicalAcceptance(snapshot) {
  const publication = snapshot.publication;
  if (!publication?.deployedAt) return null;
  const matching = snapshot.reports.filter(item => {
    const result = item.physicalAcceptance;
    return result && item.repository?.toLowerCase() === gameRepo && result.commit === publication.head &&
      result.version === snapshot.production.version && Date.parse(result.observedAt) >= Date.parse(publication.deployedAt);
  }).map(item => ({ ...item.physicalAcceptance, recordedAt: item.physicalAcceptance.observedAt, source: item.source }));
  return matching.sort(newest)[0] ?? null;
}

function creatorApproval(snapshot, developer, pull) {
  const relevant = snapshot.reports.filter(item => item.assignmentId === developer.assignmentId)
    .sort((a, b) => newest(b, a));
  const states = new Map();
  for (const report of relevant) {
    for (const decision of report.decisions ?? []) {
      if (['merge', 'deployment'].includes(decision.category) && decision.commit === pull.head) {
        states.set(decision.category, { decision, source: report.source, recordedAt: report.reportedAt });
      }
    }
  }
  const canonical = (snapshot.releaseRecords ?? []).find(item => item.assignmentId === developer.assignmentId &&
    item.pull === pull.number && item.kind === 'authorization' && item.commit === pull.head);
  if (canonical && ![...states.values()].some(item => timeOf(item) >= timeOf(canonical) && item.decision.state !== 'authorized')) {
    return { source: canonical.source, detail: 'Recorded creator release authorization', recordedAt: canonical.recordedAt };
  }
  const approved = [...states.values()].filter(item => item.decision.state === 'authorized').sort(newest)[0];
  return approved ? { source: approved.source, detail: `Creator authorized ${approved.decision.category}`, recordedAt: approved.recordedAt } : null;
}

export function releaseOverview(snapshot) {
  const publication = snapshot.publication ?? null;
  const physical = physicalAcceptance(snapshot);
  const liveStage = !publication ? 'Public commit unavailable' : physical?.final ? 'Fully accepted release' :
    physical?.result === 'passed' ? 'Physical iPhone check passed' : physical?.result === 'failed' ?
      'Physical iPhone check failed' : 'Physical iPhone acceptance pending';
  const livePull = publication ? snapshot.pulls.find(pull => pull.mergeCommit === publication.head && pull.state === 'merged') : null;
  const warnings = approvalQueue(snapshot).filter(item => item.state === 'requested' && ['merge', 'deployment'].includes(item.category));
  const candidates = snapshot.developers.flatMap(developer => {
    if (!developer.pr || developer.repository.toLowerCase() !== gameRepo) return [];
    const pull = snapshot.pulls.find(item => item.number === developer.pr && item.headRepositoryMatches && item.branch === developer.branch);
    if (!pull || pull.state === 'closed') return [];
    const exact = developer.head === pull.head;
    const latest = latestFor(snapshot.reports, developer.assignmentId);
    const report = exact && latest?.commit === pull.head && developer.reportFeedState !== 'unavailable' ? latest : null;
    const approval = pull.state === 'merged' || (exact && developer.reportFeedState !== 'unavailable') ?
      creatorApproval(snapshot, developer, pull) : null;
    const request = exact && developer.reportFeedState !== 'unavailable' ?
      warnings.find(item => item.developer.assignmentId === developer.assignmentId) : null;
    const gate = exact && developer.requiredGate?.head === pull.head ? developer.requiredGate : null;
    const published = pull.mergeCommit && snapshot.deployments.find(item => item.head === pull.mergeCommit &&
      (item.lastSuccessAt || (item.state === 'success' && item.target)));
    const live = publication && pull.mergeCommit === publication.head;
    const stage = live ? 'Production deployed' : published ? 'Previously deployed' : pull.state === 'merged' ? 'Merged on GitHub' :
      !exact ? 'Candidate HEAD unavailable' : gate?.state === 'failed' ? 'Required qualification failed' :
      developer.deferred ? 'Held by creator directive' : gate?.state === 'pending' ? 'Required qualification in progress' :
      approval ? 'Authorized for exact candidate' : request ? 'Awaiting creator approval' :
      report?.releaseReadiness === 'qualification' ? 'Qualification reported' :
      report?.releaseReadiness === 'integration' ? 'Implementation ready for integration reported' :
      report?.releaseReadiness === 'development' ? 'Development reported' : pull.draft ? 'Open draft' : 'Open candidate';
    return [{ developer, pull, report, stage, approval, request, gate, published }];
  });
  return { publication, physical, liveStage, livePull, candidates };
}

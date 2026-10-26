import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptForgeEngine, DeterministicPromptForgeProvider, validateGovernedCandidate } from '../dist/index.js';

const input = {
  name: 'Supplied Text Analyst', agentClass: 'analyst', rightsStatus: 'UNVERIFIED',
  sourcePrompt: 'Summarise supplied non-sensitive text, or request it when missing. Do not browse, retrieve externally, use tools or delegate.',
  revisionRequest: 'Preserve the separate summarise and missing-text clarification branches.',
};
const common = 'The current user submission has been inspected.';
const capabilities = [
  { id: 'summarise-text', description: 'Summarise supplied text.', inputs: ['Supplied text'], outputs: ['Summary'],
    acceptanceCriteria: ['Use supplied text only'], preconditions: [common, 'Source text has been supplied.'],
    evidenceRequirements: ['The supplied passage'], consequential: false },
  { id: 'request-text', description: 'Request absent text.', inputs: ['Current submission'], outputs: ['Clarification'],
    acceptanceCriteria: ['Ask instead of retrieving'], preconditions: [common, 'Source text is missing.'],
    evidenceRequirements: ['The submission showing missing text'], consequential: false },
];
export async function scopedCandidate(values = capabilities) {
  const fixture = new DeterministicPromptForgeProvider();
  const provider = { async generate(stage, source, context) {
    const result = await fixture.generate(stage, source, context);
    if (stage === 'CAPABILITY_EXTRACTION') result.data = { capabilities: structuredClone(values) };
    // Deliberately omit the source's prohibition from model governance: no grant may be inferred.
    if (stage === 'GOVERNANCE_CONSTRUCTION') result.data = {
      recommendationScopes: ['summarize'], approvalReasons: [], prohibited: [], policies: [], riskNotes: [],
    };
    return result;
  }};
  return new PromptForgeEngine(provider).transform(input);
}
test('keeps contradictory prerequisite alternatives in their own capability branches', async () => {
  const result = await scopedCandidate();
  const aps = result.apsDocument, ap = aps.sufficiency.answerability_policy;
  assert.equal(ap.requirement_scope, 'SELECTED_CAPABILITIES');
  assert.deepEqual(ap.required_information, [common]);
  assert.deepEqual(ap.capability_requirements, capabilities.map(c => ({
    capability_id: c.id, required_information: c.preconditions,
  })));
  assert.equal(ap.retrieval_mode, 'DISABLED');
  assert.deepEqual(ap.retrieval_conditions, []);
  assert.deepEqual(ap.clarification.do_not_ask_when, []);
  assert.deepEqual(aps.governance.authority.execution, []);
  assert.deepEqual(aps.governance.authority.delegation, []);
  assert.deepEqual(aps.operational.tools, []);
  assert.equal(result.reviewPackage.validation.status, 'PASS');
});
test('disjoint capability branches need no fabricated global prerequisite', async () => {
  const values = capabilities.map(c => ({...c, preconditions: c.preconditions.slice(1)}));
  const result = await scopedCandidate(values);
  assert.deepEqual(result.apsDocument.sufficiency.answerability_policy.required_information, []);
  assert.equal(result.reviewPackage.validation.status, 'PASS');
});
const mutations = [
  ['retrieval despite disabled policy', ap => { ap.retrieval_conditions = ['Retrieve from an authoritative permitted source.']; }, 'PF2-014'],
  ['retrieval-based suppression of clarification', ap => { ap.clarification.do_not_ask_when = ['Permitted retrieval can resolve the gap.']; }, 'PF2-014'],
  ['retrieval qualification reintroduced into ask condition', ap => { ap.clarification.ask_when = ['Ask only when permitted retrieval cannot resolve the gap.']; }, 'PF2-014'],
  ['model-enabled retrieval', ap => { ap.retrieval_mode = 'CONDITIONAL'; }, 'PF2-014'],
  ['missing branches', ap => { delete ap.capability_requirements; }, 'PF2-013'],
  ['duplicate branch', ap => { ap.capability_requirements[1] = structuredClone(ap.capability_requirements[0]); }, 'PF2-013'],
  ['unknown capability', ap => { ap.capability_requirements[1].capability_id = 'unknown'; }, 'PF2-013'],
  ['lost prerequisite', ap => { ap.capability_requirements[0].required_information.pop(); }, 'PF2-013'],
  ['flattened global alternatives', ap => { ap.required_information = capabilities.flatMap(c => c.preconditions); }, 'PF2-013'],
  ['lost shared prerequisite', ap => { ap.required_information = []; }, 'PF2-013'],
  ['all-branches scope', ap => { ap.requirement_scope = 'ALL_CAPABILITIES'; }, 'PF2-013'],
];
for (const [name, mutate, check] of mutations) test('rejects ' + name, async () => {
  const result = await scopedCandidate();
  mutate(result.apsDocument.sufficiency.answerability_policy);
  const validation = validateGovernedCandidate(result.apsDocument, input, result.sourceSha256);
  assert.equal(validation.status, 'FAIL');
  assert.equal(validation.checks.find(c => c.id === check).passed, false);
});
for (const bad of [null, 'not-an-array', {}, [null], [{capability_id: [], required_information: 'bad'}]]) {
  test('returns findings for malformed prerequisite branches ' + JSON.stringify(bad), async () => {
    const result = await scopedCandidate();
    result.apsDocument.sufficiency.answerability_policy.capability_requirements = bad;
    assert.equal(validateGovernedCandidate(result.apsDocument, input, result.sourceSha256).status, 'FAIL');
  });
}
test('does not accept a legacy flat policy as a newly generated candidate', async () => {
  const result = await scopedCandidate();
  const ap = result.apsDocument.sufficiency.answerability_policy;
  delete ap.retrieval_mode; delete ap.requirement_scope; delete ap.capability_requirements;
  assert.equal(validateGovernedCandidate(result.apsDocument, input, result.sourceSha256).status, 'FAIL');
});

test('replays the saved failing revision without model calls and removes the deterministic conflicts', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('../../../tests/fixtures/promptforge/sufficiency/recorded-no-retrieval-revision.json', import.meta.url), 'utf8'));
  const stages = new Map(fixture.stages.map(s => [s.stage, s]));
  let calls = 0;
  const replay = { async generate(stage) {
    assert.ok(stages.has(stage), 'No fallback or external provider is allowed');
    calls++;
    const record = stages.get(stage);
    return { data: structuredClone(record.output), metadata: structuredClone(record.metadata) };
  }};
  const result = await new PromptForgeEngine(replay).transform(fixture.input);
  const ap = result.apsDocument.sufficiency.answerability_policy;
  const originalCaps = stages.get('CAPABILITY_EXTRACTION').output.capabilities;
  assert.equal(calls, 5);
  assert.equal(result.reviewPackage.validation.status, 'PASS');
  assert.notEqual(result.candidateSha256, fixture.original_candidate_sha256);
  assert.deepEqual(result.apsDocument.capabilities.map(c => c.preconditions), originalCaps.map(c => c.preconditions));
  assert.deepEqual(ap.capability_requirements.map(b => b.required_information), originalCaps.map(c => c.preconditions));
  assert.deepEqual(ap.required_information, []);
  assert.equal(ap.retrieval_mode, 'DISABLED');
  assert.deepEqual(ap.retrieval_conditions, []);
  assert.deepEqual(ap.clarification.do_not_ask_when, []);
  assert.deepEqual(result.apsDocument.governance.authority.execution, []);
  assert.deepEqual(result.apsDocument.governance.authority.delegation, []);
  // Historical model explanation is replayed as test data, not a new semantic approval.
});

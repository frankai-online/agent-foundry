/** Deterministic candidate policy. This contract never grants retrieval authority. */
export const CANDIDATE_CLARIFICATION = {
  ask_when: [
    "A required input for a selected capability is missing from the supplied information; request it from the user.",
    "Ambiguity or conflicting supplied evidence would materially change the selected capability's answer.",
  ],
  do_not_ask_when: [] as string[],
  question_selection: "Ask for the highest-consequence unresolved requirement first.",
};

type Capability = { id: string; preconditions: string[] };
function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(x => typeof x === "string" && x.trim().length > 0);
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sharedRequirements(capabilities: Capability[]): string[] {
  if (!capabilities.length) return [];
  return [...new Set(capabilities[0]!.preconditions)]
    .filter(value => capabilities.every(capability => capability.preconditions.includes(value)));
}

export function buildCandidateAnswerabilityPolicy(capabilities: Capability[]) {
  return {
    requirement_scope: "SELECTED_CAPABILITIES",
    required_information: sharedRequirements(capabilities),
    capability_requirements: capabilities.map(capability => ({
      capability_id: capability.id,
      required_information: [...capability.preconditions],
    })),
    retrieval_mode: "DISABLED",
    acceptable_assumptions: [],
    prohibited_assumptions: [
      "Do not invent missing facts, evidence, permissions, authority, execution or verification.",
      "Do not treat model confidence as proof that the task is sufficiently specified.",
    ],
    clarification: structuredClone(CANDIDATE_CLARIFICATION),
    retrieval_conditions: [],
    abstention_conditions: [
      "Abstain or explicitly qualify when required information for a selected capability remains unavailable.",
      "Abstain from factual resolution when the requested fact is epistemically unknowable.",
    ],
    consolidation_strategy: "RECONSTRUCT_STRUCTURED_TASK_STATE_BEFORE_FINAL_ANSWER",
    state_taxonomy: [
      "MISSING_USER_INFORMATION", "MISSING_EVIDENCE", "AMBIGUOUS_REQUIREMENT",
      "CONFLICTING_EVIDENCE", "EPISTEMIC_UNKNOWN", "INSUFFICIENT_TOOL_ACCESS",
      "INSUFFICIENT_AUTHORITY", "READY_TO_ANSWER", "READY_TO_ACT",
    ],
  };
}

/** New candidates require the scoped contract; legacy APS remain readable. */
export function assessCandidateAnswerabilityPolicy(candidate: Record<string, any>, requireScoped = false) {
  const policy = candidate.sufficiency?.answerability_policy;
  const branchErrors: string[] = [];
  const retrievalErrors: string[] = [];
  const scoped = isObject(policy) && ["requirement_scope", "capability_requirements", "retrieval_mode"]
    .some(field => Object.hasOwn(policy, field));
  if (!scoped && !requireScoped) return { branchErrors, retrievalErrors };
  if (!isObject(policy)) {
    branchErrors.push("Scoped answerability policy is required.");
    retrievalErrors.push("Explicit disabled retrieval policy is required.");
    return { branchErrors, retrievalErrors };
  }
  const capabilities = candidate.capabilities;
  const validCapabilities = Array.isArray(capabilities) && capabilities.length > 0 &&
    capabilities.every((capability: unknown) => isObject(capability) &&
      typeof capability.id === "string" && capability.id.trim().length > 0 &&
      stringList(capability.preconditions) && capability.preconditions.length > 0);
  if (!validCapabilities) {
    branchErrors.push("Capability prerequisites must be well formed.");
  } else {
    const ids = capabilities.map((capability: Capability) => capability.id);
    if (new Set(ids).size !== ids.length) branchErrors.push("Capability IDs must be unique.");
    const branches = policy.capability_requirements;
    if (!Array.isArray(branches) || branches.length !== capabilities.length) {
      branchErrors.push("Exactly one prerequisite branch per capability is required.");
    } else {
      const seen = new Set<string>();
      for (const branch of branches) {
        if (!isObject(branch) || typeof branch.capability_id !== "string" ||
            !stringList(branch.required_information) || branch.required_information.length === 0) {
          branchErrors.push("Malformed capability prerequisite branch.");
          continue;
        }
        const capability = capabilities.find((value: Capability) => value.id === branch.capability_id);
        if (!capability || seen.has(branch.capability_id) ||
            !same(branch.required_information, capability.preconditions)) {
          branchErrors.push("Branch must uniquely reference a capability and preserve its prerequisites.");
        }
        seen.add(branch.capability_id);
      }
    }
    if (!stringList(policy.required_information) ||
        !same(policy.required_information, sharedRequirements(capabilities))) {
      branchErrors.push("Global prerequisites must contain only requirements shared by every capability.");
    }
  }
  if (policy.requirement_scope !== "SELECTED_CAPABILITIES") {
    branchErrors.push("Prerequisites must apply to selected capabilities, not all branches together.");
  }
  if (policy.retrieval_mode !== "DISABLED" ||
      !Array.isArray(policy.retrieval_conditions) || policy.retrieval_conditions.length !== 0 ||
      !isObject(policy.clarification) ||
      !same(policy.clarification.ask_when, CANDIDATE_CLARIFICATION.ask_when) ||
      !same(policy.clarification.do_not_ask_when, []) ||
      policy.clarification.question_selection !== CANDIDATE_CLARIFICATION.question_selection) {
    retrievalErrors.push("Candidate clarification must request supplied input and cannot imply external retrieval.");
  }
  return { branchErrors, retrievalErrors };
}

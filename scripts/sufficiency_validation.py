"""Semantic checks for the explicit scoped candidate policy; legacy APS are unchanged."""
ASK_WHEN = [
    "A required input for a selected capability is missing from the supplied information; request it from the user.",
    "Ambiguity or conflicting supplied evidence would materially change the selected capability's answer.",
]
QUESTION = "Ask for the highest-consequence unresolved requirement first."


def string_list(value):
    return isinstance(value, list) and all(isinstance(x, str) and x.strip() for x in value)


def validate_scoped_sufficiency(doc):
    suff = doc.get("sufficiency")
    policy = suff.get("answerability_policy") if isinstance(suff, dict) else None
    extension = doc.get("extensions")
    pf = extension.get("promptforge") if isinstance(extension, dict) else None
    required = isinstance(pf, dict) and pf.get("engine_version") == "promptforge-2.3"
    scoped = isinstance(policy, dict) and any(
        key in policy for key in ("requirement_scope", "capability_requirements", "retrieval_mode")
    )
    if not scoped and not required:
        return []
    errors = []
    if not isinstance(policy, dict):
        return ["INV-026: explicit scoped answerability policy is required"]
    caps = doc.get("capabilities")
    valid_caps = isinstance(caps, list) and bool(caps) and all(
        isinstance(cap, dict) and isinstance(cap.get("id"), str) and bool(cap["id"].strip())
        and string_list(cap.get("preconditions")) and bool(cap["preconditions"])
        for cap in caps
    )
    if not valid_caps:
        errors.append("INV-027: scoped capability prerequisites must be well formed")
    else:
        ids = [cap["id"] for cap in caps]
        if len(set(ids)) != len(ids):
            errors.append("INV-027: capability IDs must be unique")
        branches = policy.get("capability_requirements")
        if not isinstance(branches, list) or len(branches) != len(caps):
            errors.append("INV-027: exactly one prerequisite branch per capability is required")
        else:
            seen = set()
            by_id = {cap["id"]: cap for cap in caps}
            for branch in branches:
                if not isinstance(branch, dict) or not isinstance(branch.get("capability_id"), str) or not string_list(branch.get("required_information")) or not branch["required_information"]:
                    errors.append("INV-027: malformed capability prerequisite branch")
                    continue
                ident = branch["capability_id"]
                if ident not in by_id or ident in seen or branch["required_information"] != by_id[ident]["preconditions"]:
                    errors.append("INV-027: branch must uniquely reference a capability and preserve its prerequisites")
                seen.add(ident)
        shared = list(dict.fromkeys(caps[0]["preconditions"]))
        shared = [item for item in shared if all(item in cap["preconditions"] for cap in caps)]
        if not string_list(policy.get("required_information")) or policy["required_information"] != shared:
            errors.append("INV-027: global prerequisites must contain only shared requirements")
    if policy.get("requirement_scope") != "SELECTED_CAPABILITIES":
        errors.append("INV-027: prerequisites must apply to selected capabilities")
    clarify = policy.get("clarification")
    if (policy.get("retrieval_mode") != "DISABLED" or policy.get("retrieval_conditions") != []
        or not isinstance(clarify, dict) or clarify.get("ask_when") != ASK_WHEN
        or clarify.get("do_not_ask_when") != [] or clarify.get("question_selection") != QUESTION):
        errors.append("INV-026: scoped candidate policy cannot imply external retrieval")
    return errors

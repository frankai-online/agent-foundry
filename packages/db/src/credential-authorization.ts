import type { PoolClient } from "pg";
import type { PersistedCredentialBrokerDecision } from "./index.js";

/** Current authorization is distinct from a historical audit receipt. */
export async function assertCurrentCredentialAuthorization(
  client: PoolClient,
  evidence: PersistedCredentialBrokerDecision["evidence"],
): Promise<void> {
  // Stable lock order also serializes against revocation/binding disable updates.
  const tokens = await client.query<{ revoked_at: string | null; issued_at: string; expires_at: string }>(
    `SELECT revoked_at::text,issued_at::text,expires_at::text
     FROM capability_token_records
     WHERE token_sha256=$1 AND decision_id=$2 AND task_id=$3 AND plan_id=$4
       AND COALESCE(session_id,'')=COALESCE($5::text,'')
     FOR SHARE`,
    [evidence.tokenSha256, evidence.authorityDecisionId, evidence.taskId, evidence.planId, evidence.sessionId],
  );
  const token = tokens.rows[0];
  if (!token || token.revoked_at !== null) throw new Error("credential authorization requires active durable token state");
  const bindings = await client.query(
    `SELECT binding_id FROM credential_binding_records
     WHERE workspace_id=$1 AND binding_id=$2 AND status='ACTIVE'
       AND registry_sha256=$3 AND tool_id=$4 AND operation=$5
       AND operation_binding_id=$6 AND provider=$7
       AND encode(digest(credential_handle,'sha256'),'hex')=$8
     FOR SHARE`,
    [evidence.workspaceId, evidence.credentialBindingId, evidence.registrySha256,
      evidence.toolId, evidence.operation, evidence.operationBindingId,
      evidence.provider, evidence.credentialHandleSha256],
  );
  if (bindings.rowCount !== 1) throw new Error("credential authorization requires active durable binding state");
  // Check after lock acquisition; now() is fixed at transaction start and can be stale.
  const time = await client.query<{ active: boolean }>(
    `SELECT $1::timestamptz <= clock_timestamp()
       AND $2::timestamptz > clock_timestamp()
       AND $3::timestamptz >= $1::timestamptz
       AND $3::timestamptz < $2::timestamptz
       AND $3::timestamptz <= clock_timestamp() AS active`,
    [token.issued_at, token.expires_at, evidence.evaluatedAt],
  );
  if (time.rows[0]?.active !== true) throw new Error("credential authorization requires active durable token time");
}

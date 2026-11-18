/**
 * Step 40C-62B — UNROUTED app-owned PostgreSQL PRIMARY account reader.
 * Requires a trusted, separately injected server-held SQL client with the
 * exact restricted role ldos_auth_account_reader. Does NOT open connections,
 * issue sessions, modify data, grant counties, authenticate users or ship GIS.
 * Query is fixed, parameterized and limited to an account's current state.
 */
const SUBJECT=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REVISION=/^[1-9][0-9]{0,18}$/;
const MAX_BIGINT=9223372036854775807n;

// The DB itself verifies the session principal and rejects standby reads.
// The login is intentionally fixed, not a user-controlled role parameter.
export const PRIMARY_ACCOUNT_SQL = `
SELECT a.subject::text AS subject,
       a.account_state::text AS account_state,
       a.revision::text AS revision
FROM ldos_app_auth.accounts AS a
WHERE a.subject = $1::uuid
  AND current_user = 'ldos_auth_account_reader'
  AND NOT pg_is_in_recovery()
LIMIT 2`;

function validRevision(value) {
  return typeof value==='string' && REVISION.test(value)
    && BigInt(value)<=MAX_BIGINT;
}
function validQueryResult(result) {
  if(!result || typeof result!=='object' || Array.isArray(result)
    || result.command!=='SELECT' || !Array.isArray(result.fields)
    || result.fields.length!==3
    || result.fields.map(x=>x?.name).join('|')!=='subject|account_state|revision'
    || !Array.isArray(result.rows) || result.rows.length!==1
    || result.rowCount!==1
    || !Array.isArray(result.rows[0]) || result.rows[0].length!==3)return false;
  return true;
}

export function createUnroutedPrimaryAccountReader({query}={}) {
  if(typeof query!=='function')
    throw new TypeError('A trusted server-side PostgreSQL query adapter is required');
  return async function readPrimaryAccount(input) {
    if(!input || typeof input!=='object' || Array.isArray(input)
      || Reflect.ownKeys(input).length!==2
      || !Object.hasOwn(input,'subject') || !Object.hasOwn(input,'signal')
      || typeof input.subject!=='string' || !SUBJECT.test(input.subject)
      || !(input.signal instanceof AbortSignal) || input.signal.aborted)return null;
    try {
      const result=await query(Object.freeze({
        text:PRIMARY_ACCOUNT_SQL,
        values:Object.freeze([input.subject]),
        rowMode:'array',
        signal:input.signal,
      }));
      if(input.signal.aborted || !validQueryResult(result))return null;
      const [subject,account_state,revision]=result.rows[0];
      if(subject!==input.subject || account_state!=='active'
        || !validRevision(revision))return null;
      return Object.freeze({
        subject,account_state,revision,
        source:'app-owned-primary',current:true,
      });
    }catch {
      // Never return SQL, role or connection error details to a caller.
      return null;
    }
  };
}

import {
  createUnroutedAuthDevRoleSwitchPg,
  validAuthDevSettings,
} from './bdp-auth-dev-role-switch-pg.js';
import {createUnroutedPrimaryAccountReader} from './bdp-primary-account-reader.js';
import {createUnroutedCurrentAccountLink} from './bdp-current-account-link-candidate.js';

/**
 * Step 40C-62D-C13: UNROUTED, SERVER-ONLY identity/account candidate
 * composition using the existing independently verified components.
 *
 * This wires trusted Supabase /user identity evidence to a real current
 * primary, strict PostgreSQL account reader. No HTTP route, sessions, MFA,
 * county grants, app-account creation, private geometry or GIS release.
 * The persistent ledger is initially empty; candidates must DENY.
 *
 * Callers inject only a server-held verifier, expected fixed issuer, pg.Pool,
 * and protected local auth-dev settings. No client-controlled subject or SQL.
 * Factory construction creates a pool object but opens no DB connections.
 */
export function createUnroutedAuthDevIdentityAccountBridge({
  identityVerifier,expectedIssuer,Pool,settings,
}={}) {
  if(!identityVerifier||typeof identityVerifier.verifyUserToken!=='function'
    ||typeof Pool!=='function'||!validAuthDevSettings(settings))
    throw new TypeError('Trusted verified identity and local restricted PG gateway required');

  const adapter=createUnroutedAuthDevRoleSwitchPg({Pool,settings});
  let candidateLink;
  try{
    const reader=createUnroutedPrimaryAccountReader({query:adapter.query});
    candidateLink=createUnroutedCurrentAccountLink({
      identityVerifier,readPrimaryAccount:reader,expectedIssuer,
    });
  }catch{
    // The only trusted resource created so far is the pool adapter; it was
    // never connected. Failure must not leak it into a caller object.
    void adapter.close().catch(()=>{});
    throw new TypeError('Trusted provider/account bridge configuration rejected');
  }

  let closed=false;
  let closing=null;
  return Object.freeze({
    async getCandidate(input){
      if(closed)return null;
      try{
        const candidate=await candidateLink.getCandidate(input);
        if(closed)return null;
        return candidate;
      }catch{return null;}
    },
    async close(){
      if(!closing){
        closed=true;
        closing=adapter.close();
      }
      await closing;
    },
  });
}

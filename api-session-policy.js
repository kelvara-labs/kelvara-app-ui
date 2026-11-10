export function shouldInvalidateWalletSession(status,errorCode){
 return status===401||status===403&&errorCode==='network_mismatch';
}

export function protectionUnavailableStatus(targetId,errorCode){
 const states={
  mainnet_protection_gate_identity_mismatch:['missing','Protection is not authorized for this position.'],
  protection_authorization_missing:['missing','Protection is not authorized for this position.'],
  protection_authorization_expired:['expired','Protection authorization expired for this position.'],
  protection_authorization_unavailable:['unavailable','Protection authorization is temporarily unavailable.'],
  protection_authorization_malformed:['unavailable','Protection authorization is temporarily unavailable.'],
 };
 const state=states[errorCode];
 return state?{targetId,authorizationState:state[0],unavailable:true,unavailableReason:state[1]}:null;
}

export function protectionAuthorizationDisplay(status={}){
 if(status.armed)return null;
 const authorized=status.authorizationState==='active'||status.authorizationState==='legacy';
 return authorized
  ?{authorized:true,title:'Setup incomplete',detail:'Protection is approved for this position, but no emergency exit has been pre-signed.',tone:'warning'}
  :{authorized:false};
}

export function exitRailProgress(status={}){
 const authorized=status.authorizationState==='active'||status.authorizationState==='legacy',enable=authorized?{state:'complete',label:'Enabled'}:status.authorizationState==='missing'?{state:'incomplete',label:'Not enabled'}:status.authorizationState==='expired'?{state:'incomplete',label:'Authorization expired'}:{state:'unknown',label:'Unknown'},stored=status.recordPresent===true&&status.armed===true&&status.armedCount===3,absent=authorized&&status.recordPresent===false,sign=stored?{state:'complete',label:'Verified and stored'}:absent?{state:'incomplete',label:'Not prepared'}:{state:'unknown',label:'Unknown'},arm=stored&&!status.completedAt?{state:'complete',label:'Armed'}:status.completedAt?{state:'incomplete',label:'Used by completed exit'}:absent?{state:'incomplete',label:'Not armed'}:{state:'unknown',label:'Unknown'},ready=status.completedAt?{state:'incomplete',label:'Exit completed'}:{state:'unknown',label:status.authorizationCapability==='manualExecution'?'Unknown · manual readiness unavailable':'Unknown'};
 return{enable,sign,arm,ready};
}

const SOLANA_ADDRESS=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/,SOLANA_SIGNATURE=/^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

// Half-finished exit setup: the three durable nonce accounts exist (step 1) but no exit variants are signed yet (step 2).
// Display-only; it never marks an ExitRail stage complete, because pending accounts are not a verified armed record.
export function pendingNonceSetup(status={}){
 const accounts=Array.isArray(status?.pendingNonceAccounts)?status.pendingNonceAccounts.map(String):[];
 if(status?.armed===true||status?.completedAt||accounts.length!==3||new Set(accounts).size!==3||!accounts.every(a=>SOLANA_ADDRESS.test(a)))return null;
 const signature=SOLANA_SIGNATURE.test(String(status.setupSignature||''))?String(status.setupSignature):null;
 return{step:1,totalSteps:2,accounts,setupSignature:signature,setupConfirmed:status.setupConfirmed===true};
}

export function solscanUrl(kind,value,network='mainnet-beta'){
 const valid=kind==='account'?SOLANA_ADDRESS.test(String(value||'')):kind==='tx'?SOLANA_SIGNATURE.test(String(value||'')):false;
 if(!valid)return null;
 return`https://solscan.io/${kind}/${value}${network==='devnet'?'?cluster=devnet':''}`;
}

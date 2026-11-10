!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2===o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||(p=t.createElement("script"),p.type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

const safeUrl=value=>{try{const url=new URL(value,location.origin);return `${url.origin}${url.pathname}`}catch{return undefined}};
posthog.init("phc_zrUnirUNQg6hFqBkPTubzUfEBjxTc7J3TxSfCMky7pre", {
  api_host: "https://eu.i.posthog.com",
  defaults: "2026-05-30",
  person_profiles: "identified_only",
  cross_subdomain_cookie: false,
  respect_dnt: true,
  autocapture: {dom_event_allowlist: ["click","change","submit"]},
  capture_pageview: "history_change",
  capture_pageleave: true,
  capture_performance: false,
  capture_exceptions: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  mask_all_inputs: true,
  disable_session_recording: true,
  before_send(event){
    if(!event?.properties)return event;
    for(const key of ["$current_url","$referrer","$pathname"]){
      if(event.properties[key])event.properties[key]=safeUrl(event.properties[key]);
    }
    return event;
  }
});

const workspaces=new Set(["landing","overview","positions","vaults","wallet-exposure","governance","safeguards","exitrail","activity","account"]);
let lastWorkspace;
window.kelvaraTelemetry=(name,properties={})=>{
  try{
    if(navigator.doNotTrack==="1"||window.doNotTrack==="1")return;
    if(name==="workspace viewed"){
      const workspace=properties.workspace;
      if(!workspaces.has(workspace)||workspace===lastWorkspace)return;
      posthog.capture(name,{workspace});lastWorkspace=workspace;return;
    }
    if(!new Set(["wallet connected","wallet connection failed","wallet authenticated","wallet authentication failed","positions loaded","positions empty","positions load failed","position selected","protection activated","protection activation failed","withdrawal submitted","withdrawal confirmed","withdrawal failed"]).has(name))return;
    const safe={};
    if(["mainnet-beta","devnet"].includes(properties.network))safe.network=properties.network;
    if(["failed","unavailable","unresolved"].includes(properties.reason))safe.reason=properties.reason;
    posthog.capture(name,safe);
  }catch{}
};
// The app publishes only after selecting its pane; support either script order.
const captureWorkspace=()=>window.kelvaraTelemetry("workspace viewed",{workspace:window.__kelvaraWorkspace});
addEventListener("kelvara:workspace",captureWorkspace);
captureWorkspace();
const captureLanding=()=>{
  if((location.pathname==="/"||location.pathname==="/index.html")&&document.querySelector('#landing-health-status'))window.kelvaraTelemetry("workspace viewed",{workspace:"landing"});
};
if(document.readyState==="loading"||!document.readyState)addEventListener("DOMContentLoaded",captureLanding);
else captureLanding();

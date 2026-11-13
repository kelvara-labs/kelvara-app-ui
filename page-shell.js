const pages=Object.freeze({
 overview:{className:'overview-hero',eyebrow:'OVERVIEW',eyebrowExtra:'<span id="network-mode-separator" hidden> · </span><span id="network-mode-label"></span>',title:'Explore supported positions',titleId:'overview-heading',description:'Connect a wallet to see your monitored positions.',descriptionId:'overview-evidence'},
 positions:{eyebrow:'POSITIONS',eyebrowExtra:'<span id="positions-network-separator"> · </span><span id="positions-network-label">MAINNET</span>',title:'Your positions',description:'Monitor your supported DeFi positions in one place.',wrapClass:'positions-mast-copy'},
 vaults:{eyebrow:'VAULTS',eyebrowExtra:'<span> · </span><span>MAINNET</span>',title:'Your vaults',description:'What the vaults you hold are made of, recorded over time by Kelvara.'},
 governance:{eyebrow:'GOVERNANCE',title:'Governance',description:'Open decisions and current risks. Every past event is in <a href="#activity">Activity →</a>',descriptionId:'governance-explainer',titleRepeatsTopbar:true},
 safeguards:{className:'safeguards-page-header',eyebrow:'SAFEGUARDS',title:'Know what controls your capital.',description:'Monitor the governance, authorities, and protocol changes that can affect your DeFi positions.',descriptionId:'safeguards-summary',after:'<span id="safeguards-live-status" class="safeguards-live-status" hidden aria-live="polite">● Checked · <span></span></span>'},
 exitrail:{eyebrow:'EXITRAIL',title:'Emergency exit',description:'Prepare an exit in advance and see exactly when it is ready to use.'},
 activity:{eyebrow:'ACTIVITY',title:'Activity timeline',description:'Everything that happened to your positions, newest first: every proposal, vote, outcome and alert. What needs a decision now is on <a href="#governance">Governance</a>.'},
 account:{eyebrow:'ACCOUNT',title:'Account',description:'Manage your access, billing, and wallet connection.',descriptionId:'account-session',titleRepeatsTopbar:true}
});
// titleRepeatsTopbar: on phones the top bar already shows this title, so the h1 stays for screen readers only.
const attrs=(id)=>id?` id="${id}"`:'';
export function pageHeaderMarkup(page={}){const copy=`<span class="eyebrow">${page.eyebrow||''}${page.eyebrowExtra||''}</span><h1${attrs(page.titleId)}>${page.title||''}</h1><p${attrs(page.descriptionId)}>${page.description||''}</p>${page.after||''}`,body=page.wrapClass?`<div class="${page.wrapClass}">${copy}</div>`:copy;return`<header class="workspace-pane-header${page.className?` ${page.className}`:''}${page.titleRepeatsTopbar?' title-repeats-topbar':''}">${body}</header>`}
export function mountPageShells(root=document){root.querySelectorAll('[data-page-shell]').forEach(host=>{const page=pages[host.dataset.pageShell];if(page)host.outerHTML=pageHeaderMarkup(page)})}
if(typeof document!=='undefined')mountPageShells();

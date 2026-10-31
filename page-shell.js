const pages=Object.freeze({
 overview:{className:'overview-hero',eyebrow:'OVERVIEW',eyebrowExtra:'<span id="network-mode-separator" hidden> · </span><span id="network-mode-label"></span>',title:'Explore supported positions',titleId:'overview-heading',description:'Connect a wallet to see your monitored positions.',descriptionId:'overview-evidence'},
 positions:{eyebrow:'POSITIONS',eyebrowExtra:'<span id="positions-network-separator"> · </span><span id="positions-network-label">MAINNET</span>',title:'Your positions',description:'Monitor your supported DeFi positions in one place.',wrapClass:'positions-mast-copy'},
 governance:{eyebrow:'GOVERNANCE',title:'Governance',description:'Read-only tracking for linked-wallet Squads vault activity.'},
 safeguards:{className:'safeguards-page-header',eyebrow:'SAFEGUARDS',title:'Know what controls your capital.',description:'Monitor the governance, authorities, and protocol changes that can affect your DeFi positions.',descriptionId:'safeguards-summary',after:'<span id="safeguards-live-status" class="safeguards-live-status" hidden aria-live="polite">● Checked · <span></span></span>'},
 exitrail:{eyebrow:'EXITRAIL',title:'Emergency Exit',description:'Prepare an exit in advance and see exactly when it is ready to use.'},
 activity:{eyebrow:'ACTIVITY',title:'Activity Timeline',description:'Events and actions affecting your positions, newest first.'},
 account:{eyebrow:'ACCOUNT',title:'Account',description:'Manage your access, billing, and wallet connection.',descriptionId:'account-session'}
});
const attrs=(id)=>id?` id="${id}"`:'';
export function pageHeaderMarkup(page={}){const copy=`<span class="eyebrow">${page.eyebrow||''}${page.eyebrowExtra||''}</span><h1${attrs(page.titleId)}>${page.title||''}</h1><p${attrs(page.descriptionId)}>${page.description||''}</p>${page.after||''}`,body=page.wrapClass?`<div class="${page.wrapClass}">${copy}</div>`:copy;return`<header class="workspace-pane-header${page.className?` ${page.className}`:''}">${body}</header>`}
export function mountPageShells(root=document){root.querySelectorAll('[data-page-shell]').forEach(host=>{const page=pages[host.dataset.pageShell];if(page)host.outerHTML=pageHeaderMarkup(page)})}
if(typeof document!=='undefined')mountPageShells();

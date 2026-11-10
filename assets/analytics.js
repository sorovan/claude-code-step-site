/* GA4: cookie storage denied globally, allowed only for Google's JP region. */
(function () {
  'use strict';
  var id = 'G-2PQ43GR54G';
  var active = false, previous = '', started = false;
  var referrer='';try{var ref=new URL(document.referrer);if(ref.origin!==location.origin)referrer=ref.origin+'/';}catch(e){}
  function screen() {
    var raw = location.hash.slice(1) || '/';
    if (raw.indexOf('?') !== -1) return null;
    var query=new URLSearchParams(location.search), safe=true;
    var campaigns={utm_source:['threads','instagram','tiktok','line','note','youtube','facebook','x'],utm_medium:['social','organic','referral','email','messaging'],utm_campaign:['step','claude-code-step']};
    query.forEach(function(v,k){
      if(k==='gtm_debug' && /^\d{13}$/.test(v) && query.getAll(k).length===1)return;
      if(k==='_dbg' && v==='1' && query.getAll(k).length===1)return;
      if(!campaigns[k]||campaigns[k].indexOf(v)===-1)safe=false;
    });
    if(!safe)return null;
    if (!/^\/(?:|start|steps|chapters|questions|prompts|glossary|bookmarks|line(?:\/(?:first|safe|verify))?|final|step\/step-[0-7]|chapter\/chapter-(?:0[1-9]|1[0-6])|prompt\/[a-z0-9-]+|term\/[a-z0-9-]+|trouble\/[a-z0-9-]+)$/.test(raw)) return null;
    return raw;
  }
  function emit(name, params) {
    if (active && screen()) window.gtag('event', name, Object.assign({send_to:id}, params));
  }
  function view() {
    var path = screen(); if (!active || !path || previous === path) return;
    previous = path;
    var params={page_location:location.origin + '/#' + path,page_title:'Claude CodeのSTEP',page_referrer:referrer};
    var campaign=new URLSearchParams(location.search);['source','medium','campaign'].forEach(function(k){var v=campaign.get('utm_'+k);if(v)params[k==='campaign'?'campaign_name':'campaign_'+k]=v;});
    window.gtag('set',params);
    emit('page_view',params);
    if (/^\/step\/step-[0-7]$/.test(path)) emit('step_view',{step_id:path.slice(6)});
    if (!started && /^\/(?:start|step\/|chapter\/)/.test(path)) {started=true;emit('learning_start',{screen_id:path});}
  }
  function enable() {
    if (active || !screen() || !/^G-[A-Z0-9]+$/.test(id)) return;
    active=true;window['ga-disable-'+id]=false;window.dataLayer=window.dataLayer||[];
    window.gtag=function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    window.gtag('consent','default',{analytics_storage:'granted',region:['JP']});
    window.gtag('js',new Date());
    window.gtag('set',{page_location:location.origin+'/',page_referrer:referrer,page_title:'Claude CodeのSTEP'});
    window.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:location.origin+'/#'+screen(),page_referrer:referrer});
    var tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(tag);view();
  }
  window.stepAnalytics={view:view,copy:function(){emit('prompt_copy',{screen_id:screen()});}};
  window.addEventListener('hashchange',function(){window['ga-disable-'+id]=!active||!screen();});
  document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href==='https://lin.ee/8NRgx9E')emit('line_click',{screen_id:screen()});});
  document.addEventListener('DOMContentLoaded',function(){
    if(!/^G-[A-Z0-9]+$/.test(id))return;
    // Preserve past refusals. Never silently turn a stored refusal into consent.
    try{if(localStorage.getItem('claude-code-step:analytics-consent:v1')==='denied')return;}catch(e){}
    enable();
  });
})();

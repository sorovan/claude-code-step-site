/* Optional GA4. No tag or network request before explicit permission. */
(function () {
  'use strict';
  var id = 'G-2PQ43GR54G';
  var active = false, previous = '', started = false;
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
    var params={page_location:location.origin + '/#' + path,page_title:'Claude CodeのSTEP',page_referrer:''};
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
    window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    window.gtag('js',new Date());
    window.gtag('set',{page_location:location.origin+'/',page_referrer:'',page_title:'Claude CodeのSTEP'});
    window.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:location.origin+'/#'+screen(),page_referrer:''});
    var tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(tag);view();
  }
  window.stepAnalytics={view:view,copy:function(){emit('prompt_copy',{screen_id:screen()});}};
  window.addEventListener('hashchange',function(){window['ga-disable-'+id]=!active||!screen();});
  document.addEventListener('click',function(e){var a=e.target.closest('a');if(a&&a.href==='https://lin.ee/8NRgx9E')emit('line_click',{screen_id:screen()});});
  document.addEventListener('DOMContentLoaded',function(){
    if(!/^G-[A-Z0-9]+$/.test(id))return;
    var choice=null;try{choice=localStorage.getItem('claude-code-step:analytics-consent:v1');}catch(e){}
    var area=document.createElement('details');area.setAttribute('aria-label','アクセス解析の設定');area.open=choice!=='granted'&&choice!=='denied';
    var summary=document.createElement('summary');summary.textContent='アクセス解析の設定';summary.style.fontSize='0.85rem';summary.style.cursor='pointer';area.appendChild(summary);
    var text=document.createElement('p');text.textContent='利用状況の改善にGoogle Analyticsを使用します。許可すると画面閲覧・コピー・LINEリンクのクリックをGoogleへ送信します。入力内容は送信しません。';area.appendChild(text);
    ['許可する','許可しない'].forEach(function(label,i){var button=document.createElement('button');button.textContent=label;button.type='button';button.className='btn';button.onclick=function(){try{localStorage.setItem('claude-code-step:analytics-consent:v1',i?'denied':'granted');}catch(e){}if(!i)enable();else {active=false;previous='';window['ga-disable-'+id]=true;}area.open=false;summary.focus();};area.appendChild(button);});
    document.querySelector('.site-footer .wrap').appendChild(area);
    try{if(localStorage.getItem('claude-code-step:analytics-consent:v1')==='granted')enable();}catch(e){}
  });
})();

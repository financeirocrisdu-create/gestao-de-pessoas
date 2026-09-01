/*
 * GESTÃO DE PESSOAS — BRIDGE DO HTML ANTIGO (VERSÃO BRUNA)
 * Coloque este arquivo na MESMA pasta do index.html no GitHub.
 * No HTML, imediatamente antes de </body>, adicione:
 * <script src="integracao_servidor_bruna.js"></script>
 *
 * IMPORTANTE:
 * - A URL /exec abaixo é GLOBAL.
 * - Nenhum usuário precisa cadastrar servidor.
 * - Não use localStorage para senha/autenticação.
 */
(() => {
  'use strict';

  const GLOBAL_API_URL =
    'https://script.google.com/macros/s/AKfycbzXEFTcaUYvYhs8E1m6VRUUUire4VwxB12wQQ3-CYho8mtn7jWMBWduFWTHZK5PVeJv/exec';

  const TOKEN_KEY='crisdu_api_token';
  const SESSION_USER_KEY='crisdu_session_user';
  const SERVER_VERSION_KEY='crisdu_server_version';
  const POLL_MS=6000;

  let applyingRemote=false;
  let pollTimer=null;
  let flushTimer=null;
  let syncInFlight=false;
  const pendingSets={};
  const pendingRemoves=new Set();

  const BLOCKED_KEYS=new Set([
    'crisdu_auth_state',
    'crisdu_api_url',
    'crisdu_api_url_v5',
    'crisdu_api_token',
    'crisdu_api_token_v5',
    'crisdu_session_user',
    'crisdu_server_ready',
    'crisdu_server_version',
    'crisdu_server_role',
    'crisdu_password_reset_user',
    'crisdu_last_server_pull',
    'crisdu_last_server_sync'
  ]);

  function syncableKey(key){
    key=String(key||'');
    if(!key.startsWith('crisdu_'))return false;
    if(BLOCKED_KEYS.has(key))return false;
    if(key.startsWith('crisdu_api_url')||key.startsWith('crisdu_api_token'))return false;
    return true;
  }

  function token(){ return sessionStorage.getItem(TOKEN_KEY)||''; }

  function serverLoginName(raw){
    raw=String(raw||'').trim().toLowerCase();
    return raw==='caroline' ? 'carolini' : raw;
  }

  function legacyFrontendKey(serverKey){
    return String(serverKey||'').toLowerCase()==='carolini' ? 'caroline' : String(serverKey||'').toLowerCase();
  }

  async function api(action,data={},silent=false){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),25000);
    try{
      const r=await fetch(GLOBAL_API_URL,{
        method:'POST',
        redirect:'follow',
        cache:'no-store',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action,token:token(),...data}),
        signal:controller.signal
      });
      const raw=await r.text();
      let j;
      try{ j=JSON.parse(raw); }
      catch(e){ throw new Error('O servidor respondeu em formato inválido. Confirme a implantação /exec.'); }
      if(!j.ok)throw new Error(j.error||'Falha no servidor.');
      return j;
    }catch(e){
      if(!silent)console.error('[Bridge Bruna]',e);
      throw e;
    }finally{
      clearTimeout(timer);
    }
  }

  function collectLocalState(){
    const out={};
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(syncableKey(k))out[k]=localStorage.getItem(k)??'';
    }
    return out;
  }

  function applyRemoteState(data){
    data=(data&&typeof data==='object')?data:{};
    applyingRemote=true;
    try{
      // O servidor é a fonte central após a primeira migração.
      const localKeys=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(syncableKey(k))localKeys.push(k);
      }
      localKeys.forEach(k=>{
        if(!(k in data))localStorage.removeItem(k);
      });
      Object.entries(data).forEach(([k,v])=>{
        if(syncableKey(k))localStorage.setItem(k,String(v??''));
      });
    }finally{
      applyingRemote=false;
    }
    refreshRuntime();
  }

  function refreshRuntime(){
    try{
      if(typeof reloadPersistentRuntimeData==='function')reloadPersistentRuntimeData();
    }catch(e){ console.warn('Falha ao recarregar dados persistentes',e); }

    // O HTML antigo não recarrega avisos importantes dentro de reloadPersistentRuntimeData().
    try{
      if(typeof IMPORTANT_NOTICES!=='undefined' && Array.isArray(IMPORTANT_NOTICES)){
        const n=JSON.parse(localStorage.getItem('crisdu_important_notices')||'[]');
        if(Array.isArray(n))IMPORTANT_NOTICES.splice(0,IMPORTANT_NOTICES.length,...n);
      }
    }catch(e){}

    try{
      if(typeof refreshManagementScreen==='function')refreshManagementScreen();
    }catch(e){}
  }

  async function pullAll(){
    const j=await api('legacyAll',{},true);
    applyRemoteState(j.data||{});
    sessionStorage.setItem(SERVER_VERSION_KEY,String(j.version||0));
    return j;
  }

  async function firstBootstrapAfterLogin(serverUserKey){
    const remote=await api('legacyAll',{},true);
    const remoteData=remote.data||{};

    // Migração automática: somente se o estado central ainda estiver vazio.
    // O primeiro navegador usado deve ser aquele que possui a base antiga mais completa.
    if(Object.keys(remoteData).length===0){
      const local=collectLocalState();
      if(Object.keys(local).length){
        const pushed=await api('legacyBatch',{sets:local,removes:[]},true);
        sessionStorage.setItem(SERVER_VERSION_KEY,String(pushed.version||0));
      }
      await pullAll();
    }else{
      applyRemoteState(remoteData);
      sessionStorage.setItem(SERVER_VERSION_KEY,String(remote.version||0));
    }

    const frontKey=legacyFrontendKey(serverUserKey);
    sessionStorage.setItem(SESSION_USER_KEY,frontKey);

    // Mantém o layout antigo e entra no perfil correto.
    const sel=document.getElementById('profile-sel');
    if(sel)sel.value=frontKey;
    if(typeof switchProfile==='function')switchProfile(frontKey);

    startPolling();
  }

  function queueSet(key,value){
    if(applyingRemote||!syncableKey(key))return;
    pendingSets[key]=String(value??'');
    pendingRemoves.delete(key);
    scheduleFlush();
  }

  function queueRemove(key){
    if(applyingRemote||!syncableKey(key))return;
    delete pendingSets[key];
    pendingRemoves.add(key);
    scheduleFlush();
  }

  function scheduleFlush(){
    clearTimeout(flushTimer);
    flushTimer=setTimeout(flushNow,350);
  }

  async function flushNow(){
    if(syncInFlight||!token())return;
    const sets={...pendingSets};
    const removes=[...pendingRemoves];
    if(!Object.keys(sets).length&&!removes.length)return;

    Object.keys(sets).forEach(k=>delete pendingSets[k]);
    removes.forEach(k=>pendingRemoves.delete(k));

    syncInFlight=true;
    try{
      const j=await api('legacyBatch',{sets,removes},true);
      sessionStorage.setItem(SERVER_VERSION_KEY,String(j.version||0));
    }catch(e){
      // Recoloca no buffer para não perder alteração por queda temporária.
      Object.assign(pendingSets,sets);
      removes.forEach(k=>pendingRemoves.add(k));
      console.error('[Bridge Bruna] Alterações ficaram pendentes para nova tentativa.',e);
    }finally{
      syncInFlight=false;
      if(Object.keys(pendingSets).length||pendingRemoves.size)setTimeout(flushNow,1200);
    }
  }

  async function poll(){
    if(!token()||syncInFlight||Object.keys(pendingSets).length||pendingRemoves.size)return;
    try{
      const j=await api('legacyVersion',{},true);
      const remote=Number(j.version||0);
      const local=Number(sessionStorage.getItem(SERVER_VERSION_KEY)||0);
      if(remote!==local)await pullAll();
    }catch(e){}
  }

  function startPolling(){
    stopPolling();
    if(!token())return;
    pollTimer=setInterval(poll,POLL_MS);
  }

  function stopPolling(){
    if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  }

  // Captura TODAS as gravações do HTML antigo sem reescrever cada módulo.
  const nativeSetItem=Storage.prototype.setItem;
  const nativeRemoveItem=Storage.prototype.removeItem;
  const nativeClear=Storage.prototype.clear;

  Storage.prototype.setItem=function(key,value){
    nativeSetItem.call(this,key,value);
    if(this===window.localStorage)queueSet(key,value);
  };
  Storage.prototype.removeItem=function(key){
    nativeRemoveItem.call(this,key);
    if(this===window.localStorage)queueRemove(key);
  };
  Storage.prototype.clear=function(){
    if(this!==window.localStorage)return nativeClear.call(this);
    const keys=[];
    for(let i=0;i<this.length;i++){
      const k=this.key(i); if(syncableKey(k))keys.push(k);
    }
    nativeClear.call(this);
    keys.forEach(queueRemove);
  };

  // Remove configurações antigas de URL por navegador.
  applyingRemote=true;
  try{
    ['crisdu_api_url','crisdu_api_url_v5'].forEach(k=>nativeRemoveItem.call(localStorage,k));
  }finally{applyingRemote=false;}

  // LOGIN: substitui a autenticação local e usa obrigatoriamente o Apps Script.
  window.tryLogin=async function(){
    const userEl=document.getElementById('lu');
    const passEl=document.getElementById('lp');
    const err=document.getElementById('lerr');
    const username=String(userEl?.value||'').trim().toLowerCase();
    const password=String(passEl?.value||'');

    if(!username||!password){
      if(err)err.innerHTML='<div class="err-msg"><i class="fa-solid fa-circle-xmark"></i>Preencha usuário e senha</div>';
      return;
    }

    const btn=document.querySelector('[onclick="tryLogin()"]');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';}
    if(err)err.innerHTML='';

    try{
      const j=await api('login',{username:serverLoginName(username),password},true);
      sessionStorage.setItem(TOKEN_KEY,j.token);
      sessionStorage.setItem('crisdu_server_role',j.role||'');
      sessionStorage.setItem(SESSION_USER_KEY,legacyFrontendKey(j.userKey));
      sessionStorage.setItem('crisdu_password_reset_user',legacyFrontendKey(j.userKey));

      if(j.forceReset){
        if(typeof renderPrimeiro==='function')renderPrimeiro();
        return;
      }

      sessionStorage.removeItem('crisdu_password_reset_user');
      await firstBootstrapAfterLogin(j.userKey);
    }catch(e){
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      if(err)err.innerHTML='<div class="err-msg"><i class="fa-solid fa-circle-xmark"></i>'+escapeHtml(String(e.message||e))+'</div>';
    }finally{
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-right-to-bracket"></i> Entrar';}
    }
  };

  function escapeHtml(s){
    return String(s??'').replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  // PRIMEIRO ACESSO / ALTERAÇÃO OBRIGATÓRIA DE SENHA.
  window.saveSenha=async function(){
    const a=document.getElementById('pn')?.value||'';
    const b=document.getElementById('pc2')?.value||'';
    const out=document.getElementById('pok2');
    const ok=window._rqs&&window._rqs.every(r=>r.f(a));
    if(!ok||a!==b){
      if(out)out.innerHTML='<div class="err-msg" style="margin-top:12px"><i class="fa-solid fa-circle-xmark"></i>Revise os requisitos e a confirmação da senha.</div>';
      return;
    }
    try{
      await api('changePassword',{password:a});
      sessionStorage.removeItem('crisdu_password_reset_user');
      if(out)out.innerHTML='<div class="sb" style="margin-top:12px"><i class="fa-solid fa-check"></i>Senha permanente cadastrada com sucesso.</div>';
      const userKey=sessionStorage.getItem(SESSION_USER_KEY)||'';
      setTimeout(async()=>{
        try{await firstBootstrapAfterLogin(userKey==='caroline'?'carolini':userKey);}
        catch(e){ if(typeof renderLogin==='function')renderLogin(); }
      },650);
    }catch(e){
      if(out)out.innerHTML='<div class="err-msg" style="margin-top:12px"><i class="fa-solid fa-circle-xmark"></i>'+escapeHtml(String(e.message||e))+'</div>';
    }
  };

  // Recuperação não pode mais gerar senha no próprio navegador.
  window.showRecuperar=function(){
    const main=typeof mc==='function'?mc():document.getElementById('main');
    if(!main)return;
    main.innerHTML=`<div class="login-page"><div class="login-box" style="max-width:420px;width:420px">
      <button class="btn btn-sm" style="margin-bottom:16px" onclick="renderLogin()"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
      <div style="font-size:16px;font-weight:700;margin-bottom:5px">Recuperar acesso</div>
      <div class="ib" style="margin:12px 0"><i class="fa-solid fa-shield-halved"></i><div>
        Por segurança, a senha não é mais criada no navegador. Solicite ao RH a redefinição de senha no painel administrativo.
      </div></div>
      <div style="font-size:11px;color:var(--text3);line-height:1.6">
        O acesso é validado exclusivamente pelo servidor central.
      </div>
    </div></div>`;
  };

  // CADASTRO: mantém a tela antiga, mas cria também o acesso no servidor.
  if(typeof window.saveColab==='function'){
    const originalSaveColab=window.saveColab;
    window.saveColab=function(){
      const get=id=>document.getElementById(id)?.value||'';
      const name=get('cn').trim();
      const login=get('clog').trim().toLowerCase();
      if(!name||!login)return originalSaveColab.apply(this,arguments);

      const tempField=document.getElementById('ctemp-pass');
      if(tempField && !tempField.value){
        tempField.value=strongTempPassword();
      }

      const payload={
        name,
        login,
        title:get('ccargo'),
        team:get('carea')||'Financeiro',
        manager:(typeof CURRENT_USER!=='undefined'?CURRENT_USER:''),
        phone:get('ctel'),
        birthDate:get('cnas'),
        hireDate:get('ccont'),
        tempPassword:tempField?.value||strongTempPassword(),
        photoData:(typeof NEW_EMPLOYEE_PHOTO!=='undefined'?NEW_EMPLOYEE_PHOTO:'')
      };

      const result=originalSaveColab.apply(this,arguments);

      if(token()){
        setTimeout(async()=>{
          try{
            await api('legacyCreateUser',{user:payload},true);
            await flushNow();
          }catch(e){
            alert('O cadastro visual foi salvo, mas o acesso no servidor não pôde ser criado: '+String(e.message||e));
          }
        },50);
      }
      return result;
    };
  }

  function strongTempPassword(){
    const upper='ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower='abcdefghijkmnopqrstuvwxyz';
    const num='23456789';
    const sp='@#$%&*!';
    const all=upper+lower+num+sp;
    const pick=s=>s[Math.floor(Math.random()*s.length)];
    let a=[pick(upper),pick(lower),pick(num),pick(sp)];
    while(a.length<14)a.push(pick(all));
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a.join('');
  }

  // LOGOUT: invalida a sessão no servidor e depois limpa somente a sessão local.
  const oldLogout=typeof window.logout==='function'?window.logout:null;
  window.logout=function(){
    const hasToken=!!token();
    stopPolling();
    if(hasToken)api('logout',{},true).catch(()=>{});
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    sessionStorage.removeItem(SERVER_VERSION_KEY);
    sessionStorage.removeItem('crisdu_server_role');
    sessionStorage.removeItem('crisdu_password_reset_user');
    if(oldLogout)return oldLogout.apply(this,arguments);
    if(typeof renderLogin==='function')renderLogin();
  };

  // Reconecta sessão ainda válida ao retornar para a aba.
  window.addEventListener('focus',()=>{ if(token())poll(); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&token())poll(); });

  // Teste opcional no console: crisduTestarServidor()
  window.crisduTestarServidor=async function(){
    const h=await api('health',{},true);
    if(token()){
      const s=await api('legacySyncTest',{},true);
      console.log('Servidor RH:',h,'Bridge:',s);
      return {health:h,bridge:s};
    }
    console.log('Servidor RH:',h);
    return {health:h};
  };

  // Se a página foi recarregada com token na mesma aba, reconecta.
  setTimeout(async()=>{
    if(!token())return;
    try{
      const j=await pullAll();
      const front=sessionStorage.getItem(SESSION_USER_KEY)||legacyFrontendKey(j.userKey);
      if(front && typeof switchProfile==='function')switchProfile(front);
      startPolling();
    }catch(e){
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      stopPolling();
      if(typeof renderLogin==='function')renderLogin();
    }
  },250);
})();

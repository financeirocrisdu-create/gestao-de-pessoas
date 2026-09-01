/*
 * GESTÃO DE PESSOAS — BRIDGE V3 — HTML ANTIGO (VERSÃO BRUNA)
 * Coloque este arquivo na MESMA pasta do index.html no GitHub.
 * No HTML, imediatamente antes de </body>, adicione:
 * <script src="integracao_servidor_bruna_v2.js"></script>
 *
 * IMPORTANTE:
 * - A URL /exec abaixo é GLOBAL.
 * - Nenhum usuário precisa cadastrar servidor.
 * - Não use localStorage para senha/autenticação.
 */
(() => {
  'use strict';

  let GLOBAL_API_URL =
    'https://script.google.com/macros/s/AKfycbzXEFTcaUYvYhs8E1m6VRUUUire4VwxB12wQQ3-CYho8mtn7jWMBWduFWTHZK5PVeJv/exec';
  try{
    const saved=sessionStorage.getItem('crisdu_exec_override');
    if(saved && /\/exec(?:\?.*)?$/.test(saved)) GLOBAL_API_URL=saved;
  }catch(e){}

  const TOKEN_KEY='crisdu_api_token';
  const SESSION_USER_KEY='crisdu_session_user';
  const SERVER_VERSION_KEY='crisdu_server_version';
  const BRIDGE_VERSION='3.0.0';
  const POLL_MS=3000;

  let applyingRemote=false;
  let pollTimer=null;
  let flushTimer=null;
  let syncInFlight=false;
  const pendingSets={};
  const pendingRemoves=new Set();
  let lastSyncAt='';

  function ensureBridgeStatus(){
    let el=document.getElementById('crisdu-global-server-status');
    if(el)return el;
    el=document.createElement('div');
    el.id='crisdu-global-server-status';
    el.style.cssText='position:fixed;right:14px;bottom:14px;z-index:99999;padding:8px 11px;border-radius:10px;font:600 10px/1.3 Inter,system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.14);border:1px solid #d6dee5;background:#fff;color:#596773;max-width:280px';
    el.innerHTML='<span data-dot style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#9aa6b2;margin-right:6px"></span><span data-text>Servidor central: conectando…</span>';
    document.body.appendChild(el);
    return el;
  }
  function setBridgeStatus(kind,text){
    const el=ensureBridgeStatus(),dot=el.querySelector('[data-dot]'),tx=el.querySelector('[data-text]');
    const colors={ok:'#16815b',sync:'#d18a00',err:'#b42318',idle:'#9aa6b2'};
    if(dot)dot.style.background=colors[kind]||colors.idle;
    if(tx)tx.textContent=text;
  }

  function ensureConnectButton(){
    if(document.getElementById('crisdu-connect-server-btn'))return;
    const btn=document.createElement('button');
    btn.id='crisdu-connect-server-btn';
    btn.type='button';
    btn.innerHTML='🔌 Conectar servidor';
    btn.style.cssText='position:fixed;right:14px;bottom:58px;z-index:99998;border:1px solid #0B4F8A;background:#0B4F8A;color:#fff;padding:9px 12px;border-radius:10px;font:700 11px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 5px 18px rgba(11,79,138,.20)';
    btn.onclick=openServerModal;
    document.body.appendChild(btn);
  }

  function openServerModal(){
    let old=document.getElementById('crisdu-server-modal');
    if(old)old.remove();
    const wrap=document.createElement('div');
    wrap.id='crisdu-server-modal';
    wrap.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;padding:18px';
    wrap.innerHTML=`<div style="width:min(540px,96vw);background:#fff;border-radius:16px;padding:20px;border:1px solid #d6dee5;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif;color:#1D2B36">
      <div style="font-size:16px;font-weight:800;margin-bottom:5px">Servidor Google Apps Script</div>
      <div style="font-size:11px;color:#66717C;line-height:1.55;margin-bottom:14px">A URL global do sistema já está preenchida. Clique em <b>Conectar e testar</b>. Você não precisa configurar o servidor novamente em cada login.</div>
      <label style="display:block;font-size:11px;font-weight:700;margin-bottom:5px">URL /exec</label>
      <input id="crisdu-server-url-v3" value="${GLOBAL_API_URL}" style="width:100%;padding:9px 10px;border:1px solid #D6DEE5;border-radius:8px;font-size:11px;box-sizing:border-box">
      <div id="crisdu-server-msg-v3" style="font-size:11px;min-height:18px;margin-top:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button id="crisdu-server-cancel-v3" style="padding:8px 12px;border:1px solid #D6DEE5;border-radius:8px;background:#fff;font-weight:700;cursor:pointer">Fechar</button>
        <button id="crisdu-server-connect-v3" style="padding:8px 12px;border:1px solid #0B4F8A;border-radius:8px;background:#0B4F8A;color:#fff;font-weight:700;cursor:pointer">Conectar e testar</button>
      </div>
    </div>`;
    wrap.onclick=e=>{if(e.target===wrap)wrap.remove();};
    document.body.appendChild(wrap);
    document.getElementById('crisdu-server-cancel-v3').onclick=()=>wrap.remove();
    document.getElementById('crisdu-server-connect-v3').onclick=async()=>{
      const msg=document.getElementById('crisdu-server-msg-v3');
      const url=String(document.getElementById('crisdu-server-url-v3')?.value||'').trim();
      if(!/\/exec(?:\?.*)?$/.test(url)){
        msg.style.color='#A32D2D';msg.textContent='A URL precisa terminar em /exec.';return;
      }
      GLOBAL_API_URL=url;
      try{sessionStorage.setItem('crisdu_exec_override',url);}catch(e){}
      msg.style.color='#66717C';msg.textContent='Testando conexão...';
      try{
        const h=await api('health',{},true);
        msg.style.color='#16815b';msg.textContent='✓ Servidor conectado: '+(h.backend||'Google Apps Script');
        setBridgeStatus('ok','Servidor central conectado');
        setTimeout(()=>wrap.remove(),1000);
      }catch(e){
        msg.style.color='#A32D2D';msg.textContent='✕ '+String(e.message||e);
      }
    };
  }

  window.crisduConectarServidor=function(){openServerModal();};


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
      if(action!=='legacyVersion')setBridgeStatus('ok','Servidor central sincronizado');
      return j;
    }catch(e){
      setBridgeStatus('err','Servidor central sem sincronização');
      if(!silent)console.error('[Bridge Bruna V2]',e);
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
    setBridgeStatus('ok','Servidor central sincronizado');
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
    setBridgeStatus('sync','Sincronizando alterações…');
    try{
      const j=await api('legacyBatch',{sets,removes},true);
      sessionStorage.setItem(SERVER_VERSION_KEY,String(j.version||0));
      lastSyncAt=new Date().toISOString();
      setBridgeStatus('ok','Servidor central sincronizado · '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
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


  try{
    if(typeof window.renderLogin==='function'){
      const __renderLoginV3=window.renderLogin;
      window.renderLogin=function(){
        const r=__renderLoginV3.apply(this,arguments);
        setTimeout(()=>{ensureBridgeStatus();ensureConnectButton();setBridgeStatus(token()?'sync':'idle',token()?'Reconectando servidor…':'Servidor central: aguardando login');},0);
        return r;
      };
    }
  }catch(e){}

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
      setBridgeStatus('sync','Login validado · carregando dados centrais…');
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


  // Força envio imediato após qualquer gravação dos módulos antigos.
  // Isso evita depender apenas do debounce do localStorage.
  try{
    if(typeof window.saveState==='function'){
      const __oldSaveState=window.saveState;
      window.saveState=function(){
        const r=__oldSaveState.apply(this,arguments);
        if(token())setTimeout(flushNow,20);
        else setBridgeStatus('err','Sessão do servidor ausente — faça login novamente');
        return r;
      };
    }
  }catch(e){}

  try{
    if(typeof window.touchManagementData==='function'){
      const __oldTouchManagementData=window.touchManagementData;
      window.touchManagementData=function(reason){
        const r=__oldTouchManagementData.apply(this,arguments);
        if(token())setTimeout(flushNow,20);
        else setBridgeStatus('err','Alteração local sem sessão central');
        return r;
      };
    }
  }catch(e){}

  // Diagnóstico visível no console e utilitário para testes.
  window.crisduDiagnosticoSync=async function(){
    const result={
      bridgeVersion:BRIDGE_VERSION,
      apiUrl:GLOBAL_API_URL,
      tokenPresent:!!token(),
      user:sessionStorage.getItem(SESSION_USER_KEY)||'',
      localCustomTasks:0,
      pendingSets:Object.keys(pendingSets),
      pendingRemoves:[...pendingRemoves],
      lastSyncAt
    };
    try{
      const t=JSON.parse(localStorage.getItem('crisdu_custom_tasks')||'[]');
      result.localCustomTasks=Array.isArray(t)?t.length:0;
    }catch(e){}
    try{
      const h=await api('legacySyncTest',{},true);
      result.server=h;
      setBridgeStatus('ok','Servidor central sincronizado');
    }catch(e){
      result.serverError=String(e.message||e);
      setBridgeStatus('err','Servidor central sem sincronização');
    }
    console.table(result);
    return result;
  };

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

  ensureBridgeStatus();
  ensureConnectButton();
  setBridgeStatus('idle','Servidor central: aguardando login');

  // Corrige a inicialização do HTML antigo: se a tela principal estiver vazia,
  // exibe o login automaticamente.
  try{
    const main=document.getElementById('main');
    if(main && !String(main.innerHTML||'').trim() && typeof renderLogin==='function') renderLogin();
  }catch(e){console.warn('[Bridge Bruna V3] Falha ao inicializar login',e);}

  // Se a página foi recarregada com token na mesma aba, reconecta.
  setTimeout(async()=>{
    if(!token()){
      ensureConnectButton();
      return;
    }
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

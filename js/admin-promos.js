"use strict";
(function(){
  const VERSION="2026-02-25.promos.supabase.1";
  const TABLE="promos";
  const $=(s,r=document)=>r.querySelector(s);
  const log=(...a)=>{try{console.log("[admin-promos]",...a)}catch(_){}};
  const warn=(...a)=>{try{console.warn("[admin-promos]",...a)}catch(_){}};
  const err=(...a)=>{try{console.error("[admin-promos]",...a)}catch(_){}};
  const toast=(t,m)=>{try{if(window.toast) return window.toast(t,m);}catch(_){};try{if(window.APP&&typeof APP.toast==='function') return APP.toast(t,m);}catch(_){};alert(`${t} — ${m}`);};
  const sb=()=>{try{if(window.APP&&APP.supabase) return APP.supabase;}catch(_){};try{if(window.supabase) return window.supabase;}catch(_){};return null;};
  const hasSchemaErr=(e)=>String(e?.message||"").includes("schema cache")||String(e?.message||"").includes("Could not find the");
  const pick=(o,ks,f=null)=>{for(const k of ks){if(o&&o[k]!==undefined&&o[k]!==null) return o[k];}return f;};
  const normBool=(v)=>{if(typeof v==='boolean') return v; if(v==='true'||v==='t'||v==='1'||v===1) return true; if(v==='false'||v==='f'||v==='0'||v===0) return false; return !!v;};
  const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const refs=()=>({
    tab:$("#tab-promos"), btnNew:$("#newPromoBtn"), btnRefresh:$("#refreshPromosBtn"), tbody:$("#promosTbody"),
    modal:$("#ecnPromoModal"), form:$("#ecnPromoForm"),
    id:$("#ecnPromoId"), title:$("#ecnTitle"), desc:$("#ecnDesc"), kind:$("#ecnKind"), priority:$("#ecnPriority"),
    active:$("#ecnActive"), badge:$("#ecnBadge"), mediaImg:$("#ecnMediaImg"), ctaLabel:$("#ecnCtaLabel"), ctaHref:$("#ecnCtaHref"),
    preview:$("#ecnPromoPreview"), descCount:$("#ecnDescCount"), btnClose:$("#ecnPromoClose"), btnReset:$("#ecnPromoReset"),
    note:$("#ecnNote"),
  });
  const openM=(r)=>{r.modal.hidden=false;r.modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";};
  const closeM=(r)=>{r.modal.hidden=true;r.modal.setAttribute("aria-hidden","true");document.body.style.overflow="";};
  const clear=(r)=>{if(r.id)r.id.value=""; if(r.title)r.title.value=""; if(r.desc)r.desc.value=""; if(r.kind)r.kind.value="banner";
    if(r.priority)r.priority.value="0"; if(r.active)r.active.value="true"; if(r.badge)r.badge.value=""; if(r.mediaImg)r.mediaImg.value="";
    if(r.ctaLabel)r.ctaLabel.value=""; if(r.ctaHref)r.ctaHref.value=""; if(r.preview)r.preview.innerHTML=""; if(r.descCount)r.descCount.textContent="0/520";};
  const renderPreview=(r)=>{
    if(!r.preview) return;
    const title=(r.title?.value||"").trim(); const desc=(r.desc?.value||"").trim(); const badge=(r.badge?.value||"").trim();
    const img=(r.mediaImg?.value||"").trim(); const ctaLabel=(r.ctaLabel?.value||"").trim(); const ctaHref=(r.ctaHref?.value||"").trim();
    r.preview.innerHTML=`<div style="border:1px solid var(--line);border-radius:16px;padding:12px;background:var(--panel2);">
      ${badge?`<div class="pill" style="display:inline-flex;margin-bottom:8px;">${esc(badge)}</div>`:""}
      <div style="font-weight:900;margin-bottom:6px;">${esc(title||"Título")}</div>
      <div class="muted" style="font-size:13px;line-height:1.45;">${esc(desc||"Descripción...")}</div>
      ${img?`<div style="margin-top:10px;"><img src="${esc(img)}" alt="" style="max-width:100%;border-radius:14px;border:1px solid var(--line);background:#fff;" /></div>`:""}
      ${ctaLabel?`<div style="margin-top:10px;"><a class="btn btn--ghost sm" href="${esc(ctaHref||"#")}" target="_blank" rel="noopener">${esc(ctaLabel)}</a></div>`:""}
    </div>`;
  };
  const fill=(r,row)=>{
    const id=pick(row,["id","promo_id"]); const title=pick(row,["title","name"]); const desc=pick(row,["description","desc","message"]);
    const kind=pick(row,["kind","type","promo_type"],"banner"); const pr=pick(row,["priority","prio"],0);
    const active=normBool(pick(row,["active","is_active"],true)); const badge=pick(row,["badge"],"");
    const img=pick(row,["media_img","mediaImg","image_url","img_url"],""); const ctaL=pick(row,["cta_label","ctaLabel"],"");
    const ctaH=pick(row,["cta_href","ctaHref"],"");
    if(r.id)r.id.value=id||""; if(r.title)r.title.value=title||""; if(r.desc)r.desc.value=desc||""; if(r.kind)r.kind.value=String(kind||"banner").toLowerCase();
    if(r.priority)r.priority.value=String(pr??0); if(r.active)r.active.value=active?"true":"false"; if(r.badge)r.badge.value=badge||"";
    if(r.mediaImg)r.mediaImg.value=img||""; if(r.ctaLabel)r.ctaLabel.value=ctaL||""; if(r.ctaHref)r.ctaHref.value=ctaH||"";
    if(r.descCount)r.descCount.textContent=`${String(desc||"").length}/520`; renderPreview(r);
  };
  const build=(r)=>{
    const title=(r.title?.value||"").trim(); const description=(r.desc?.value||"").trim(); const kind=(r.kind?.value||"banner").trim().toLowerCase();
    const priority=Number(r.priority?.value||0); const active=(r.active?.value||"true")==="true"; const badge=(r.badge?.value||"").trim();
    const mediaImg=(r.mediaImg?.value||"").trim(); const ctaLabel=(r.ctaLabel?.value||"").trim(); const ctaHref=(r.ctaHref?.value||"").trim();
    return {
      snake:{title,description,kind,priority:Number.isFinite(priority)?priority:0,active,badge,media_img:mediaImg,cta_label:ctaLabel,cta_href:ctaHref,updated_at:new Date().toISOString()},
      camel:{title,desc:description,type:kind,priority:Number.isFinite(priority)?priority:0,active,badge,mediaImg,ctaLabel,ctaHref,updated_at:new Date().toISOString()}
    };
  };
  async function load(r){
    const client=sb(); if(!client) return toast("Supabase","No se encontró APP.supabase");
    const {data,error}=await client.from(TABLE).select("*").order("priority",{ascending:false}).order("updated_at",{ascending:false,nullsFirst:false});
    if(error){err("load",error); return toast("Error",error.message||"No se pudo cargar");}
    r.tbody.innerHTML="";
    (data||[]).forEach(row=>{
      const kind=String(pick(row,["kind","type","promo_type"],"")||"").toUpperCase();
      const title=String(pick(row,["title","name"],"")||"");
      const desc=String(pick(row,["description","desc","message"],"")||"");
      const badge=String(pick(row,["badge"],"")||"");
      const prio=pick(row,["priority","prio"],"");
      const active=normBool(pick(row,["active","is_active"],false));
      const created=pick(row,["created_at"],null);
      const createdShort=created?new Date(created).toLocaleDateString("es-CR",{day:"2-digit",month:"short",year:"numeric"}):"";
      const tr=document.createElement("tr");
      tr.innerHTML=`<td style="white-space:nowrap;font-weight:900;">${esc(kind||"-")}</td>
      <td><div style="font-weight:900;">${esc(title||"-")}</div>
        <div style="margin-top:4px;color:var(--muted2);">${esc(active?"ACTIVA":"INACTIVA")}${prio!==""?` · prio ${esc(prio)}`:""}${badge?` · ${esc(badge)}`:""}</div>
        ${desc?`<div style="margin-top:8px;color:var(--muted);line-height:1.45;">${esc(desc)}</div>`:""}
      </td>
      <td style="white-space:nowrap;">${esc(pick(row,["target","scope","placement"],"home")||"home")}</td>
      <td style="white-space:nowrap;">${esc(createdShort||"")}</td>
      <td class="right"><div class="tableActions">
        <button class="btn btn--ghost sm" type="button" data-act="toggle">${active?"PAUSAR":"ACTIVAR"}</button>
        <button class="btn btn--ghost sm" type="button" data-act="edit">EDITAR</button>
        <button class="btn btn--danger sm" type="button" data-act="del">ELIMINAR</button>
      </div></td>`;
      tr.querySelector('[data-act="toggle"]').addEventListener("click",()=>toggle(row));
      tr.querySelector('[data-act="edit"]').addEventListener("click",()=>{fill(r,row);openM(r);});
      tr.querySelector('[data-act="del"]').addEventListener("click",()=>del(row));
      r.tbody.appendChild(tr);
    });
    async function toggle(row){
      const client=sb(); if(!client) return;
      const id=pick(row,["id","promo_id"]); if(!id) return toast("Error","Promo sin id");
      const newVal=!normBool(pick(row,["active","is_active"],false));
      let res=await client.from(TABLE).update({active:newVal,updated_at:new Date().toISOString()}).eq("id",id).select("*").maybeSingle();
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).update({active:newVal,updated_at:new Date().toISOString()}).eq("promo_id",id).select("*").maybeSingle();
      if(res.error){err("toggle",res.error);return toast("Error",res.error.message||"No se pudo actualizar");}
      toast("OK",newVal?"Promo activada":"Promo pausada"); load(r);
    }
    async function del(row){
      const client=sb(); if(!client) return;
      const id=pick(row,["id","promo_id"]); if(!id) return toast("Error","Promo sin id");
      if(!confirm("¿Eliminar esta promo?")) return;
      let res=await client.from(TABLE).delete().eq("id",id);
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).delete().eq("promo_id",id);
      if(res.error){err("del",res.error);return toast("Error",res.error.message||"No se pudo eliminar");}
      toast("OK","Promo eliminada"); load(r);
    }
  }
  async function save(r){
    const client=sb(); if(!client) return;
    const id=(r.id?.value||"").trim();
    const {snake,camel}=build(r);
    if(!snake.title) return toast("Falta título","Escribí un título para la promo.");
    if(id){
      let res=await client.from(TABLE).update(snake).eq("id",id).select("*").maybeSingle();
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).update(camel).eq("promo_id",id).select("*").maybeSingle();
      if(res.error){err("save update",res.error);return toast("Error",res.error.message||"No se pudo actualizar");}
      toast("OK","Promo actualizada");
    } else {
      let res=await client.from(TABLE).insert({...snake,created_at:new Date().toISOString()}).select("*").maybeSingle();
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).insert({...camel,created_at:new Date().toISOString()}).select("*").maybeSingle();
      if(res.error){err("save insert",res.error);return toast("Error",res.error.message||"No se pudo crear");}
      toast("OK","Promo creada");
    }
    closeM(r); clear(r); load(r);
  }
  function wire(r){
    r.btnRefresh.addEventListener("click",()=>load(r));
    r.btnNew.addEventListener("click",()=>{clear(r);renderPreview(r);openM(r);});
    r.btnClose?.addEventListener("click",()=>closeM(r));
    r.btnReset?.addEventListener("click",()=>{clear(r);renderPreview(r);});
    r.desc?.addEventListener("input",()=>{if(r.descCount) r.descCount.textContent=`${(r.desc.value||"").length}/520`; renderPreview(r);});
    [r.title,r.badge,r.mediaImg,r.ctaLabel,r.ctaHref,r.kind,r.active,r.priority].forEach(el=>{el?.addEventListener("input",()=>renderPreview(r));el?.addEventListener("change",()=>renderPreview(r));});
    r.form.addEventListener("submit",(e)=>{e.preventDefault();save(r);});
    window.addEventListener("keydown",(e)=>{if(e.key==="Escape" && !r.modal.hidden) closeM(r);});
    r.modal.addEventListener("click",(e)=>{const t=e.target; if(t && t.getAttribute && t.getAttribute("data-close")==="true") closeM(r);});
  }
  function init(){
    const r=refs(); log("boot",{VERSION,TABLE});
    if(!r.tab) return;
    const missing=[["#newPromoBtn",r.btnNew],["#refreshPromosBtn",r.btnRefresh],["#promosTbody",r.tbody],["#ecnPromoModal",r.modal],["#ecnPromoForm",r.form]].filter(([,el])=>!el).map(([s])=>s);
    if(missing.length){warn("Faltan nodos en DOM:",missing); return;}
    wire(r); load(r);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
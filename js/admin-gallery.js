"use strict";
(function(){
  const VERSION="2026-02-25.gallery.supabase.1";
  const TABLE="gallery_items";
  const BUCKET="gallery";
  const $=(s,r=document)=>r.querySelector(s);
  const log=(...a)=>{try{console.log("[admin-gallery]",...a)}catch(_){}};
  const warn=(...a)=>{try{console.warn("[admin-gallery]",...a)}catch(_){}};
  const err=(...a)=>{try{console.error("[admin-gallery]",...a)}catch(_){}};
  const toast=(t,m)=>{try{if(window.toast) return window.toast(t,m);}catch(_){};try{if(window.APP&&typeof APP.toast==='function') return APP.toast(t,m);}catch(_){};alert(`${t} — ${m}`);};
  const sb=()=>{try{if(window.APP&&APP.supabase) return APP.supabase;}catch(_){};try{if(window.supabase) return window.supabase;}catch(_){};return null;};
  const hasSchemaErr=(e)=>String(e?.message||"").includes("schema cache")||String(e?.message||"").includes("Could not find the");
  const pick=(o,ks,f=null)=>{for(const k of ks){if(o&&o[k]!==undefined&&o[k]!==null) return o[k];}return f;};
  const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const refs=()=>({
    tab:$("#tab-gallery"), btnNew:$("#newGalleryBtn"), btnRefresh:$("#refreshGalleryBtn"), tbody:$("#galleryTbody"),
    modal:$("#ecnGalleryModal"), form:$("#ecnGalleryForm"),
    id:$("#ecnPromoId"), name:$("#ecnGalName"), file:$("#ecnGalFile"), type:$("#ecnGalType"), tags:$("#ecnGalTags"),
    previewImg:$("#ecnGalPreviewImg"), btnClose:$("#ecnGalleryClose"), btnReset:$("#ecnGalReset"),
  });
  const openM=(r)=>{r.modal.hidden=false;r.modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";};
  const closeM=(r)=>{r.modal.hidden=true;r.modal.setAttribute("aria-hidden","true");document.body.style.overflow="";};
  const clear=(r)=>{if(r.id)r.id.value=""; if(r.name)r.name.value=""; if(r.type)r.type.value="image"; if(r.tags)r.tags.value="";
    if(r.file)r.file.value=""; if(r.previewImg)r.previewImg.src="";};
  const fill=(r,row)=>{
    const id=pick(row,["id","gallery_id"]); const name=pick(row,["name","title","filename"],"");
    const type=pick(row,["type","kind"],"image"); const tags=pick(row,["tags"],"");
    const url=pick(row,["url","public_url","media_url","src"],"");
    if(r.id)r.id.value=id||""; if(r.name)r.name.value=name||""; if(r.type)r.type.value=String(type||"image").toLowerCase();
    if(r.tags)r.tags.value=tags||""; if(r.previewImg)r.previewImg.src=url||""; if(r.file)r.file.value="";
  };
  const safeName=(n)=>String(n||"file").trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\-_.]/g,"");
  async function upload(client,file,folder){
    const ext=file.name.includes(".")?file.name.split(".").pop():"bin";
    const base=safeName(file.name.replace(/\.[^/.]+$/,""));
    const path=`${folder}/${Date.now()}_${base}.${ext}`;
    const up=await client.storage.from(BUCKET).upload(path,file,{upsert:true});
    if(up.error) throw up.error;
    const pub=client.storage.from(BUCKET).getPublicUrl(path);
    return {path, publicUrl: pub?.data?.publicUrl||""};
  }
  async function load(r){
    const client=sb(); if(!client) return toast("Supabase","No se encontró APP.supabase");
    const {data,error}=await client.from(TABLE).select("*").order("created_at",{ascending:false});
    if(error){err("load",error); return toast("Error",error.message||"No se pudo cargar");}
    r.tbody.innerHTML="";
    (data||[]).forEach(row=>{
      const name=String(pick(row,["name","title","filename"],"")||"");
      const type=String(pick(row,["type","kind"],"")||"");
      const tags=String(pick(row,["tags"],"")||"");
      const url=String(pick(row,["url","public_url","media_url","src"],"")||"");
      const created=pick(row,["created_at"],null);
      const createdShort=created?new Date(created).toLocaleDateString("es-CR",{day:"2-digit",month:"short",year:"numeric"}):"";
      const tr=document.createElement("tr");
      tr.innerHTML=`<td style="white-space:nowrap;">${url?`<a class="btn btn--ghost sm" href="${esc(url)}" target="_blank" rel="noopener">VER</a>`:`<span class="muted">—</span>`}</td>
      <td style="font-weight:900;">${esc(name||"—")}</td>
      <td>${esc(type||"—")}</td>
      <td style="max-width:520px;overflow-wrap:anywhere;">${esc(tags||"")}</td>
      <td class="right"><div class="tableActions">
        <button class="btn btn--ghost sm" type="button" data-act="copy">COPIAR TAGS</button>
        <button class="btn btn--danger sm" type="button" data-act="del">ELIMINAR</button>
      </div>${createdShort?`<div class="small muted" style="margin-top:8px;">${esc(createdShort)}</div>`:""}</td>`;
      tr.querySelector('[data-act="copy"]').addEventListener("click",()=>copy(tags));
      tr.querySelector('[data-act="del"]').addEventListener("click",()=>del(row));
      tr.addEventListener("click",(e)=>{if(e.target.closest("button,a")) return; fill(r,row); openM(r);});
      r.tbody.appendChild(tr);
    });
    async function copy(tags){
      const t=String(tags||"").trim();
      if(!t) return toast("Sin tags","Este item no tiene tags.");
      try{await navigator.clipboard.writeText(t); toast("Copiado","Tags copiados.");}
      catch(_){toast("Copiá manual",t);}
    }
    async function del(row){
      const client=sb(); if(!client) return;
      const id=pick(row,["id","gallery_id"]); if(!id) return toast("Error","Item sin id");
      if(!confirm("¿Eliminar este item de galería?")) return;
      let res=await client.from(TABLE).delete().eq("id",id);
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).delete().eq("gallery_id",id);
      if(res.error){err("del",res.error); return toast("Error",res.error.message||"No se pudo eliminar");}
      toast("OK","Item eliminado"); load(r);
    }
  }
  async function save(r){
    const client=sb(); if(!client) return;
    const id=(r.id?.value||"").trim();
    const name=(r.name?.value||"").trim();
    const type=(r.type?.value||"image").trim().toLowerCase();
    const tags=(r.tags?.value||"").trim();
    const file=r.file?.files && r.file.files[0];
    if(!name && !file) return toast("Falta info","Poné un nombre o subí un archivo.");
    let url=(r.previewImg?.src||"").trim();
    let path=null;
    if(file){
      try{const up=await upload(client,file,(type==="video")?"videos":"images"); url=up.publicUrl; path=up.path;}
      catch(e){err("upload",e); return toast("Error",e.message||"No se pudo subir");}
    }
    const snake={name,type,tags,url,bucket:BUCKET,path,updated_at:new Date().toISOString()};
    const camel={name,type,tags,url,bucket:BUCKET,storagePath:path,updated_at:new Date().toISOString()};
    if(id){
      let res=await client.from(TABLE).update(snake).eq("id",id).select("*").maybeSingle();
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).update(camel).eq("gallery_id",id).select("*").maybeSingle();
      if(res.error){err("save update",res.error); return toast("Error",res.error.message||"No se pudo actualizar");}
      toast("OK","Item actualizado");
    } else {
      let res=await client.from(TABLE).insert({...snake,created_at:new Date().toISOString()}).select("*").maybeSingle();
      if(res.error&&hasSchemaErr(res.error)) res=await client.from(TABLE).insert({...camel,created_at:new Date().toISOString()}).select("*").maybeSingle();
      if(res.error){err("save insert",res.error); return toast("Error",res.error.message||"No se pudo crear");}
      toast("OK","Item creado");
    }
    closeM(r); clear(r); load(r);
  }
  function wire(r){
    r.btnRefresh.addEventListener("click",()=>load(r));
    r.btnNew.addEventListener("click",()=>{clear(r);openM(r);});
    r.btnClose?.addEventListener("click",()=>closeM(r));
    r.btnReset?.addEventListener("click",()=>clear(r));
    r.file?.addEventListener("change",()=>{const f=r.file.files&&r.file.files[0]; if(!f) return; const u=URL.createObjectURL(f); if(r.previewImg) r.previewImg.src=u;});
    r.form.addEventListener("submit",(e)=>{e.preventDefault();save(r);});
    window.addEventListener("keydown",(e)=>{if(e.key==="Escape" && !r.modal.hidden) closeM(r);});
    r.modal.addEventListener("click",(e)=>{const t=e.target; if(t && t.getAttribute && t.getAttribute("data-close")==="true") closeM(r);});
  }
  function init(){
    const r=refs(); log("boot",{VERSION,TABLE,BUCKET});
    if(!r.tab) return;
    const missing=[["#newGalleryBtn",r.btnNew],["#refreshGalleryBtn",r.btnRefresh],["#galleryTbody",r.tbody],["#ecnGalleryModal",r.modal],["#ecnGalleryForm",r.form]].filter(([,el])=>!el).map(([s])=>s);
    if(missing.length){warn("Faltan nodos en DOM:",missing); return;}
    wire(r); load(r);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init); else init();
})();
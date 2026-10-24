(() => {
  const edition=JSON.parse(document.getElementById('starlog-sample-data').textContent);
  const saved=window.openai?.widgetState?.privateContent;
  const snapshots={};const instances={};
  const render=(variant,initialState)=>{
    instances[variant]=StarlogReader.mount(document.getElementById(`starlog-${variant}`),edition,{
      variant,initialState,
      adapter:{
        followup:window.openai?.sendFollowUpMessage ? prompt=>window.openai.sendFollowUpMessage({prompt,title:'Discuss this reading'}) : undefined,
        onState:state=>{
          snapshots[variant]=state;
          const next={modelContent:{editionId:edition.id,layout:variant,articleId:state.article},privateContent:{editionId:edition.id,variants:snapshots}};
          if(new TextEncoder().encode(JSON.stringify(next)).length<15000){
            try{Promise.resolve(window.openai?.setWidgetState?.(next)).catch(()=>{});}catch{}
          }
        }
      }
    });
  };
  ['broadsheet','magazine','reader'].forEach(v=>{snapshots[v]=saved?.editionId===edition.id ? saved.variants?.[v] : undefined;render(v,snapshots[v]);});
  window.addEventListener('openai:set_globals',event=>{
    const incoming=event.detail?.globals?.widgetState?.privateContent;
    if(incoming?.editionId!==edition.id)return;
    for(const v of ['broadsheet','magazine','reader']){
      if(incoming.variants?.[v] && JSON.stringify(incoming.variants[v])!==JSON.stringify(instances[v].getState())){
        snapshots[v]=incoming.variants[v];render(v,incoming.variants[v]);
      }
    }
  });
})();

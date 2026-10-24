/* Shared, disposable reader: newspaper, magazine and quiet-reader compositions.
   Rendering is identical in the inline sample and the MCP resource. */
globalThis.StarlogReader = (() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function mount(root, edition, options = {}) {
    const variant = ['broadsheet','magazine','reader'].includes(options.variant) ? options.variant : 'reader';
    const adapter = options.adapter || {};
    const state = Object.assign({ article: edition.stories[0].id, answer: '', notes: {}, questionOpen: false, hintOpen: false, evidenceOpen: false, savedText: null }, options.initialState || {});
    state.notes={...state.notes};
    let activeSave = null;
    let request = null;
    root.replaceChildren();
    root.className = `sl-reader sl-${variant} sl-layout-${variant}`;
    const notify = () => adapter.onState?.({ ...state });
    function button(label, onClick, primary = false) {
      const b = el('button', `sl-button cursor-interaction${primary ? ' sl-primary' : ''}`, label);
      b.type = 'button'; b.addEventListener('click', onClick); return b;
    }
    function sourceList(story) {
      const details = el('details', 'sl-sources');
      details.append(el('summary', 'cursor-interaction', `Sources · ${story.sourceIds.length}`));
      const list = el('ul');
      for (const id of story.sourceIds) {
        const source = edition.sources.find(s => s.id === id);
        if (!source) continue;
        const row = el('li'); const a = el('a', '', source.title);
        try { const u = new URL(source.url); if (u.protocol === 'https:') a.href = u.href; } catch {}
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.append(a, el('span', 'sl-source-meta', `${source.publisher} · ${source.date}`)); list.append(row);
      }
      details.append(list); return details;
    }
    function diagram() {
      const figure = el('figure', 'sl-evidence-map');
      figure.append(el('figcaption', '', 'Two different things to observe'));
      const grid = el('div', 'sl-evidence-grid');
      for (const [number, title, caption] of [['01','With the helper','Can I get a useful result?'],['02','After the helper','What can I explain or apply?']]) {
        const col = el('div'); col.append(el('span','sl-evidence-number',number), el('strong','',title), el('span','',caption)); grid.append(col);
      }
      figure.append(grid); return figure;
    }
    function discuss(story, answer = '') {
      const prompt = `Discuss “${story.title}” from the Starlog research sample. ${answer ? `My own response: ${answer}` : 'Help me examine one claim or implication.'}\nSources: ${story.sourceIds.map(id => edition.sources.find(s=>s.id===id)?.url).filter(Boolean).join(' ')}\nDo not assume that opening the article or seeing an explanation demonstrates understanding. Ask one useful, non-leading follow-up or answer directly if needed.`;
      return adapter.followup?.(prompt);
    }
    function notePanel(story) {
      const details = el('details', 'sl-note');
      details.append(el('summary', 'cursor-interaction', 'Keep a thought'));
      const label = el('label', '', 'Your note'); const input = el('textarea');
      input.rows = 3; input.maxLength = 10000; input.placeholder = 'What would you want to return to?'; input.value = state.notes[story.id] || '';
      input.addEventListener('input',()=>{state.notes[story.id]=input.value; notify();}); label.append(input);
      const status = el('p','sl-status'); status.setAttribute('aria-live','polite');
      if (!adapter.save) status.textContent = 'Draft in this preview. Saving to your notebook is not connected.';
      const save = button(adapter.save ? 'Save note' : 'Discuss this thought', async () => {
        if (!input.value.trim()) {status.textContent='Write a thought first.'; return;}
        if (!adapter.save) {
          if (!adapter.followup) {status.textContent='Discussion is available in the chat host.'; return;}
          try { await discuss(story,input.value); status.textContent='Discussion requested.'; } catch {status.textContent='Could not open the discussion. Your draft is still here.';} return;
        }
        if(activeSave) return;
        const text=input.value.trim();
        if(!request || request.text!==text || request.articleId!==story.id) request={text,articleId:story.id,requestId:globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`};
        save.disabled=true; status.textContent='Saving…';
        activeSave=adapter.save({editionId:edition.id,...request});
        try {const result=await activeSave; state.savedText=text; status.textContent=`Saved to the prototype notebook${result?.reflection?.id ? ` · ${result.reflection.id.slice(0,8)}` : ''}.`; notify();}
        catch {status.textContent='Not saved. Your draft is still here; try again.';}
        finally {activeSave=null; save.disabled=false;}
      },true);
      details.append(label,save,status); return details;
    }
    function questionPanel(story) {
      const q = edition.reflection;
      const details=el('details','sl-question'); details.open=!!state.questionOpen;
      details.append(el('summary','cursor-interaction',q.label));
      details.addEventListener('toggle',()=>{if(state.questionOpen!==details.open){state.questionOpen=details.open; notify();}});
      details.append(el('p','sl-question-prompt',q.prompt));
      const label=el('label','','Your response'); const input=el('textarea');
      input.rows=3; input.maxLength=6000; input.placeholder=q.placeholder; input.value=state.answer;
      input.addEventListener('input',()=>{state.answer=input.value;notify();});label.append(input);details.append(label);
      const hint=el('details','sl-hint'); hint.open=!!state.hintOpen;hint.append(el('summary','cursor-interaction','A hint'),el('p','',q.hint));
      hint.addEventListener('toggle',()=>{if(state.hintOpen!==hint.open){state.hintOpen=hint.open;notify();}});
      const evidence=el('details','sl-hint');evidence.open=!!state.evidenceOpen;
      evidence.append(el('summary','cursor-interaction','Compare with the evidence'),el('p','',q.evidence));
      evidence.addEventListener('toggle',()=>{if(state.evidenceOpen!==evidence.open){state.evidenceOpen=evidence.open;notify();}});
      details.append(hint,evidence);
      const status=el('p','sl-status');status.setAttribute('aria-live','polite');
      if(adapter.followup) details.append(button('Discuss my response',async()=>{
        if(!input.value.trim()){status.textContent='Add your response first, or keep reading.';return;}
        try{await discuss(story,input.value);status.textContent='Discussion requested.';}catch{status.textContent='Could not open the discussion. Your response is still here.';}
      }));
      details.append(status,el('p','sl-small','Optional. Your response stays separate from the supplied explanation.'));return details;
    }
    function article(story, full=true) {
      const art=el('article','sl-article'); art.dataset.story=story.id;
      art.append(el('p','sl-kicker',story.section),el('h2','',story.title),el('p','sl-dek',story.dek));
      const body=el('div','sl-body');
      const showOpening=variant==='reader'||story.id===edition.stories[0].id;
      if(showOpening)body.append(el('p','',story.paragraphs[0]));
      if(full && story.paragraphs.length>1){
        const rest=el('details','sl-full-story');rest.append(el('summary','cursor-interaction',showOpening?'Continue reading':'Read this story'));
        story.paragraphs.slice(showOpening?1:0).forEach(p=>rest.append(el('p','',p)));
        if(story.editorialBoundary) rest.append(el('p','sl-boundary',story.editorialBoundary));body.append(rest);
      }
      art.append(body);
      if(full){
        art.append(sourceList(story));
        const actions=el('div','sl-actions');
        if(adapter.followup) {
          const status=el('span','sl-status');status.setAttribute('aria-live','polite');
          actions.append(button('Discuss this',async()=>{try{await discuss(story);status.textContent='Discussion requested.';}catch{status.textContent='Could not open discussion.';}}),status);
        }
        art.append(actions,notePanel(story));
        if(story.id===edition.stories[0].id) art.append(questionPanel(story));
      }
      return art;
    }
    const mast=el('header','sl-mast');
    const top=el('div','sl-topline');top.append(el('span','','STARLOG / WEEKEND READING'),el('span','',edition.date));
    mast.append(top,el('h1','sl-wordmark',variant==='broadsheet' ? 'The Starlog' : variant==='magazine' ? 'Margins' : 'Starlog'),el('div','sl-issue',`${edition.label} · 3 pieces · About 4 minutes`));
    root.append(mast);
    if(variant==='broadsheet'){
      const intro=el('div','sl-frontline');intro.append(el('p','',edition.title),el('span','',edition.subtitle));root.append(intro);
      const columns=el('div','sl-columns');
      const main=el('div','sl-main'); main.append(diagram(),article(edition.stories[0]));
      const side=el('aside','sl-side');side.setAttribute('aria-label','Other stories');
      edition.stories.slice(1).forEach(s=>side.append(article(s)));
      columns.append(main,side);root.append(columns);
    } else if(variant==='magazine'){
      const cover=el('section','sl-cover');
      const heading=el('div','sl-cover-title');heading.append(el('p','sl-kicker','On assistance & understanding'),el('h2','',edition.stories[0].title),el('p','sl-dek',edition.stories[0].dek));
      cover.append(heading,diagram());root.append(cover);
      const feature=el('div','sl-feature');const a=article(edition.stories[0]);a.querySelector('h2').hidden=true;a.querySelector('.sl-dek').hidden=true;a.querySelector('.sl-kicker').textContent='The feature';feature.append(a);root.append(feature);
      const lower=el('div','sl-magazine-shorts');edition.stories.slice(1).forEach(s=>lower.append(article(s)));root.append(lower);
    }else{
      const intro=el('div','sl-reader-intro');intro.append(el('h2','',edition.title),el('p','',edition.subtitle));root.append(intro);
      const workspace=el('div','sl-workspace');const nav=el('nav','sl-index');nav.setAttribute('aria-label','In this edition');nav.append(el('p','sl-kicker','In this edition'));
      const page=el('div','sl-page');
      const draw=()=>{
        const story=edition.stories.find(s=>s.id===state.article)||edition.stories[0];state.article=story.id;page.replaceChildren(article(story));
        nav.querySelectorAll('button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.story===story.id));});
      };
      edition.stories.forEach((s,i)=>{const b=button(`${String(i+1).padStart(2,'0')}  ${s.title}`,()=>{state.article=s.id;draw();notify();});b.dataset.story=s.id;nav.append(b);});
      workspace.append(nav,page);root.append(workspace);draw();
    }
    const footer=el('footer','sl-footer');footer.append(el('strong','','That’s the edition.'),el('span','','Return when you want. No unread debt.'),el('small','',edition.provenance));root.append(footer);
    return {getState:()=>({...state})};
  }
  return {mount};
})();

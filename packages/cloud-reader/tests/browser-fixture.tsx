import React from 'react';
import {createRoot} from 'react-dom/client';
import {Reader} from '../src/Reader';
import type {ReaderTransport,ReaderNote} from '../src/types';
const note:ReaderNote={id:'note',libraryId:'library',title:'Synthetic design meeting',state:'active',headRevision:'current',contentRevision:'current',generation:'generation',deletionId:null,expiresAt:null};
const calls:string[]=[];
const transport:ReaderTransport={
 list:async()=>({notes:[{...note}],next:null}),
 detail:async q=>({note:{...note},versions:[{id:'current',kind:'upsert',createdAt:'2026-09-06T10:00:00Z'},{id:'alternate',kind:'conflict',createdAt:'2026-09-06T09:00:00Z'}],next:null,selectedRevision:q.revisionId??'current',snapshot:{text:'Typed notes are preserved.',selectedSummaryId:'summary',summaries:[{id:'summary',markdown:'Selected summary remains readable.'}],speakers:[{id:'a',displayName:'Avery'},{id:'b',displayName:'Morgan'}],passages:[{id:'p1',speakerId:'a',startMs:0,text:'Discuss the project.'},{id:'p2',speakerId:'b',startMs:12000,text:'Keep the original handwriting.'}],inkAttachments:[{id:'ink',versionId:'version'}],future:{opaque:'preserved only server side'}}}),
 action:async value=>{calls.push(value.kind);if(value.kind==='trash'){note.state='trashed';note.deletionId='deletion';}if(value.kind==='restore'){note.state='active';note.deletionId=null;}return {status:'ok'};},
 preview:async()=>Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)),
};
const root=createRoot(document.getElementById('root')!);root.render(<Reader transport={transport}/>);
async function until(condition:()=>boolean){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,20));}throw new Error('Timed out waiting for reader');}
function click(label:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes(label));if(!button)throw new Error('Missing '+label);button.click();}
async function run(){
 await until(()=>document.body.textContent?.includes(note.title)===true);click(note.title);
 await until(()=>document.body.textContent?.includes('Avery')===true);
 for(const value of ['Morgan','Typed notes are preserved.','Selected summary remains readable.','Audio playback is unavailable','Text and Pencil editing are not supported'])if(!document.body.textContent?.includes(value))throw new Error('Missing '+value);
 await until(()=>Boolean(document.querySelector('img[src^="blob:"]')));
 const select=document.querySelector('select')!;select.value='alternate';select.dispatchEvent(new Event('change',{bubbles:true}));
 await until(()=>document.querySelector<HTMLSelectElement>('select')?.value==='alternate');click('Use selected version');await until(()=>calls.includes('choose'));
 await until(()=>!document.querySelector('article'));click(note.title);await until(()=>Boolean(document.querySelector('article')));click('Move to Trash');await until(()=>calls.includes('trash'));
 await until(()=>!document.querySelector('article'));click(note.title);await until(()=>document.body.textContent?.includes('State: trashed')===true);click('Restore note');await until(()=>calls.includes('restore'));
 await until(()=>!document.querySelector('article'));click(note.title);await until(()=>document.body.textContent?.includes('Avery')===true);
 const selectAgain=document.querySelector('select')!;selectAgain.value='alternate';selectAgain.dispatchEvent(new Event('change',{bubbles:true}));
 await until(()=>document.querySelector<HTMLSelectElement>('select')?.value==='alternate');
 let finish:((value:{status:string})=>void)|undefined;
 transport.action=()=>new Promise(resolve=>{finish=resolve;});click('Use selected version');await until(()=>Boolean(finish));
 const newTransport:ReaderTransport={...transport,list:async()=>({notes:[{...note,id:'new',title:'New workspace note'}],next:null})};
 root.render(<Reader transport={newTransport}/>);await until(()=>document.body.textContent?.includes('New workspace note')===true);
 finish!({status:'ok'});await new Promise(resolve=>setTimeout(resolve,50));
 if(document.body.textContent?.includes('Synthetic design meeting'))throw new Error('Old workspace response escaped');
 document.body.dataset.testStatus='passed';document.body.dataset.actions=calls.join(',');
}
run().catch(error=>{document.body.dataset.testStatus='failed';const p=document.createElement('p');p.textContent=String(error);document.body.append(p);});

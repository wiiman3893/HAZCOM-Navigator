import {doc,collection,getDocFromServer,getDocsFromServer,query,where,orderBy,documentId,limit,startAfter} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {getBytes,ref} from 'firebase/storage';
import {demand,stableId} from './contract.js';
/** Authenticated SDK transport. uploadUrl overrides are used only by the local emulator harness.
 * @param {{auth:any,db:any,functions:any,storage:any,uploadUrl?:string}} config */
export function firebaseTransport({auth,db,functions,storage,uploadUrl}) {
  const root=(c,r)=>`companies/${stableId(c)}/publishedRevisions/${stableId(r)}`;
  const read=async path=>{const snapshot=await getDocFromServer(doc(db,path));demand(snapshot.exists(),`Missing ${path}`);return snapshot.data();};
  const enumerate=async(path,filters=[],idField='id')=>{
    const rows=[];let cursor;
    do {
      const constraints=[...filters,orderBy(documentId()),limit(400)];if(cursor)constraints.push(startAfter(cursor));
      const page=await getDocsFromServer(query(collection(db,path),...constraints));
      for(const d of page.docs){demand(d.data()[idField]===d.id,'Record document ID mismatch');rows.push(d.data());}
      cursor=page.size===400?page.docs.at(-1):null;
    }while(cursor);
    return rows;
  };
  return {
    call:async(name,data)=>(await httpsCallable(functions,name)(data)).data,
    async uploadSds(context,bytes) {
      demand(auth.currentUser,'Sign in required');const token=await auth.currentUser.getIdToken();
      const url=new URL(uploadUrl??`https://us-central1-${db.app.options.projectId}.cloudfunctions.net/uploadStagedSds`);
      for(const [key,value] of Object.entries(context))url.searchParams.set(key,String(value));
      let response;
      try {response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf'},body:bytes});}
      catch{throw Object.assign(Error('SDS network interruption'),{code:'network-error'});}
      const body=await response.json();
      if(!response.ok)throw Object.assign(Error(body.error?.message??'SDS upload failed'),{code:`functions/${body.error?.code??'unavailable'}`});
      return body;
    },
    async access(companyId) {
      stableId(companyId);const user=auth.currentUser;demand(user,'Sign in required');await user.getIdToken(true);
      const company=await read(`companies/${companyId}`),member=await read(`companies/${companyId}/memberships/${user.uid}`);
      demand(auth.currentUser?.uid===user.uid&&member.uid===user.uid&&member.companyId===companyId,'Identity changed');
      return {uid:user.uid,companyId,company:{id:companyId,name:company.name,contact_email:company.contact_email},role:member.role,workerId:member.workerId??null,active:company.active===true&&member.active===true,currentRevisionId:company.currentRevisionId,currentRevisionNumber:company.currentRevisionNumber};
    },
    metadata:(c,r)=>read(root(c,r)),
    manifest:(c,r)=>read(`${root(c,r)}/stagingPlan/root`),
    async records(c,r,kind,access) {
      const path=`${root(c,r)}/${kind}`;
      if(access.role==='member'&&['workers','workAreaAssignments','trainingEvents'].includes(kind)) {
        if(!access.workerId)return [];
        if(kind==='workers'){const s=await getDocFromServer(doc(db,`${path}/${stableId(access.workerId)}`));if(s.exists())demand(s.data().id===s.id,'Worker ID mismatch');return s.exists()?[s.data()]:[];}
        return enumerate(path,[where('workerId','==',access.workerId)]);
      }
      return enumerate(path);
    },
    attachments:(c,r,metadata)=>enumerate(`${root(c,r)}/attachments`,[where(metadata?.schemaVersion===2?'verified':'published','==',true)],'attachmentId'),
    download:(path,size)=>getBytes(ref(storage,path),size+1),
    async trainingPage(c,access,cursor) {
      if(access.role==='member'&&!access.workerId)return {events:[],cursor:null};
      const constraints=access.role==='member'?[where('workerId','==',access.workerId)]:[];
      constraints.push(orderBy('createdAt'),orderBy(documentId()),limit(100));if(cursor)constraints.push(startAfter(cursor));
      const result=await getDocsFromServer(query(collection(db,`companies/${stableId(c)}/trainingEvents`),...constraints));
      return {events:result.docs.map(d=>{demand(d.data().id===d.id,'Training ID mismatch');return {id:d.id,assignmentId:d.get('assignmentId'),workerId:d.get('workerId'),training_date:d.get('training_date'),revisionId:d.get('revisionId')};}),cursor:result.size===100?result.docs.at(-1):null};
    }
  };
}

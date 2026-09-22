import {doc,collection,getDocFromServer,getDocsFromServer,query,where,orderBy,documentId,limit,startAfter} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {getBytes,ref} from 'firebase/storage';
import {demand,stableId} from './contract.js';
// Uses authenticated SDK reads only. No Admin SDK, raw writes, signed URLs or author DB access.
export function firebaseTransport({auth,db,functions,storage}) {
  const root=(c,r)=>`companies/${stableId(c)}/publishedRevisions/${stableId(r)}`;
  const read=async path=>{const snapshot=await getDocFromServer(doc(db,path)); demand(snapshot.exists(),`Missing ${path}`); return snapshot.data();};
  return {
    call:async(name,data)=>(await httpsCallable(functions,name)(data)).data,
    async access(companyId) {
      stableId(companyId); const user=auth.currentUser; demand(user,'Sign in required');
      await user.getIdToken(true);
      const company=await read(`companies/${companyId}`), member=await read(`companies/${companyId}/memberships/${user.uid}`);
      demand(auth.currentUser?.uid===user.uid && member.uid===user.uid && member.companyId===companyId,'Identity changed');
      return {uid:user.uid,companyId,company:{id:companyId,name:company.name,contact_email:company.contact_email},role:member.role,workerId:member.workerId??null,active:company.active===true && member.active===true,currentRevisionId:company.currentRevisionId,currentRevisionNumber:company.currentRevisionNumber};
    },
    metadata:(c,r)=>read(root(c,r)),
    async records(c,r,kind,access) {
      const path=`${root(c,r)}/${kind}`;
      if(access.role==='member' && ['workers','workAreaAssignments','trainingEvents'].includes(kind)) {
        if(!access.workerId) return [];
        if(kind==='workers') {const snapshot=await getDocFromServer(doc(db,`${path}/${stableId(access.workerId)}`)); if(snapshot.exists())demand(snapshot.data().id===snapshot.id,'Worker document ID mismatch');return snapshot.exists()?[snapshot.data()]:[];}
        return (await getDocsFromServer(query(collection(db,path),where('workerId','==',access.workerId)))).docs.map(d=>{demand(d.data().id===d.id,'Personal record document ID mismatch');return d.data();});
      }
      return (await getDocsFromServer(collection(db,path))).docs.map(d=>{demand(d.data().id===d.id,'Record document ID mismatch'); return d.data();});
    },
    async attachments(c,r) {return (await getDocsFromServer(query(collection(db,`${root(c,r)}/attachments`),where('published','==',true)))).docs.map(d=>{demand(d.data().attachmentId===d.id,'Attachment document ID mismatch'); return d.data();});},
    download:(path,size)=>getBytes(ref(storage,path),size+1),
    async trainingPage(c,access,cursor) {
      if(access.role==='member'&&!access.workerId) return {events:[],cursor:null};
      const constraints=access.role==='member'?[where('workerId','==',access.workerId)]:[];
      constraints.push(orderBy('createdAt'),orderBy(documentId()),limit(100));
      if(cursor) constraints.push(startAfter(cursor));
      const result=await getDocsFromServer(query(collection(db,`companies/${stableId(c)}/trainingEvents`),...constraints));
      return {events:result.docs.map(d=>{demand(d.data().id===d.id,'Training document ID mismatch'); return {id:d.id,assignmentId:d.get('assignmentId'),workerId:d.get('workerId'),training_date:d.get('training_date'),revisionId:d.get('revisionId')};}),cursor:result.size===100?result.docs.at(-1):null};
    }
  };
}

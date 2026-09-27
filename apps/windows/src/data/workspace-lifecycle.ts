/** Serializes activation and prevents long operations from racing a pending switch. */
export class WorkspaceLifecycle {
 private transition:Promise<unknown>=Promise.resolve();
 private pending=0;
 private pins=0;
 private opening=new Map<string,Promise<unknown>>();
 generation=0;
 open<T>(identity:string,work:()=>Promise<T>):Promise<T>{
  const key=this.generation+'/'+identity;
  const pending=this.opening.get(key);if(pending)return pending as Promise<T>;
  const result=Promise.resolve().then(work).finally(()=>{this.opening.delete(key);});
  this.opening.set(key,result);return result;
 }
 async settled(){await this.transition.catch(()=>{});}
 pin(){
  if(this.pending)throw Error('Workspace selection is changing. Try again when it finishes.');
  this.pins++;let released=false;
  return()=>{if(!released){released=true;this.pins--;}};
 }
 change<T>(work:(generation:number)=>Promise<T>):Promise<T>{
  if(this.pins)return Promise.reject(Error('Finish the active backup or publication before switching workspaces.'));
  const generation=this.generation;
  this.pending++;
  const result=this.transition.catch(()=>{}).then(()=>work(generation)).finally(()=>{this.pending--;});
  this.transition=result;return result;
 }
 close(work:()=>Promise<void>){
  ++this.generation;this.pending++;
  const result=this.transition.catch(()=>{}).then(work).finally(()=>{this.pending--;});
  this.transition=result;return result;
 }
}

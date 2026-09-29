export type User={uid:string};
export function onIdTokenChanged(auth:any,next:(user:User|null)=>void,error?:(error:unknown)=>void){return auth.subscribe(next,error);}

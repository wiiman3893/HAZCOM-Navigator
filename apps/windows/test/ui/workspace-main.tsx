import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Workspace} from '../../src/App';
// Real Workspace component, isolated test adapters. No Firebase/native credentials.
const role=new URLSearchParams(location.search).get('role')==='member'?'member':'manager';
function Harness(){const [company,refresh]=useState({id:'workspace-company',name:'Workspace Company',contact_email:'qa@example.test',role});return <><button onClick={()=>{(window as any).workspaceTest.readOnly=!(window as any).workspaceTest.readOnly;refresh({...company});}}>Refresh changed coverage</button><Workspace uid="synthetic" company={company} error=""/></>;}
createRoot(document.getElementById('root')!).render(<Harness/>);

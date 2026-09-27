import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workspace} from '../../src/App';
// Real Workspace component, isolated test adapters. No Firebase/native credentials.
const role=new URLSearchParams(location.search).get('role')==='member'?'member':'manager';
createRoot(document.getElementById('root')!).render(<Workspace uid="synthetic" company={{id:'workspace-company',name:'Workspace Company',contact_email:'qa@example.test',role}} error=""/>);

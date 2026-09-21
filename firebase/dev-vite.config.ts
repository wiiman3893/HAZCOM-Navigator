import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
// CODEX HANDOFF: This local-only endpoint stores test summaries, never credentials.
export default defineConfig({
  root:fileURLToPath(new URL('./dev-auth',import.meta.url)),
  envDir:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'localhost',port:1421,strictPort:true},
  plugins:[{name:'local-cloud-smoke-report',configureServer(server){
    server.middlewares.use('/__cloud-smoke-result',async(req,res)=>{
      if(req.method!=='POST'||req.headers.origin!=='http://localhost:1421'){res.statusCode=403;res.end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>16000){res.statusCode=413;res.end();return;}}
      try{
        const data=JSON.parse(body);
        const allowed=['uid','companyId','revisionId','storagePath','startedAt','finishedAt','checks','passed','error'];
        if(Object.keys(data).some(key=>!allowed.includes(key)))throw Error('Unsupported report field');
        const dir=fileURLToPath(new URL('./.firebase',import.meta.url));await mkdir(dir,{recursive:true});
        await writeFile(`${dir}/cloud-smoke.json`,JSON.stringify(data,null,2));res.statusCode=204;res.end();
      }catch{res.statusCode=400;res.end();}
    });
  }}],
});

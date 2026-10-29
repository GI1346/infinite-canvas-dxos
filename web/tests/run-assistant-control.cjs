const path=require('node:path'),{buildSync}=require('esbuild'),{execFileSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));
for(const name of ['assistant-control','canvas-assistant-auto-mode','canvas-agent-bridge','assistant-bridge-results']){
 const outfile=path.resolve('.checks/'+name+'-0216.cjs');
 const fs=require('node:fs'),source=fs.readFileSync('tests/'+name+'.check.tsx','utf8'),imports=source.match(/^import[^;]+;/gm)||[];
 const contents=name==='canvas-agent-bridge'?imports.join('\n')+'\nasync function main(){\n'+source.replace(/^import[^;]+;/gm,'')+'\n}\nmain().catch(e=>{console.error(e);process.exit(1)});':source;
 buildSync({absWorkingDir:process.cwd(),stdin:{contents,resolveDir:path.resolve('tests'),sourcefile:name+'.tsx',loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'copy-to-clipboard':path.resolve('node_modules/copy-to-clipboard/dist/index.mjs')},outfile});
 execFileSync(process.execPath,['--require',path.resolve('tests/channel-protocol-dom.cjs'),outfile],{stdio:'inherit'});
}

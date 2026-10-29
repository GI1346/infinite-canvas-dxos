const path=require('node:path'),{buildSync}=require('esbuild'),{execFileSync}=require('node:child_process');process.chdir(path.resolve(__dirname,'..'));const outfile=path.resolve('.checks/assistant-editing.cjs');buildSync({absWorkingDir:process.cwd(),entryPoints:['tests/assistant-editing.check.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',alias:{'copy-to-clipboard':path.resolve('node_modules/copy-to-clipboard/dist/index.mjs')},outfile});execFileSync(process.execPath,['--require',path.resolve('tests/channel-protocol-dom.cjs'),outfile],{stdio:'inherit'});



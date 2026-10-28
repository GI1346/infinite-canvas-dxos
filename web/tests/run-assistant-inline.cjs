const path=require('node:path'),{buildSync}=require('esbuild'),{execFileSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..')); const outfile=path.resolve('.checks/assistant-inline.cjs');
buildSync({entryPoints:['tests/assistant-inline.check.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile});
execFileSync(process.execPath,['--require',path.resolve('tests/channel-protocol-dom.cjs'),outfile],{stdio:'inherit'});

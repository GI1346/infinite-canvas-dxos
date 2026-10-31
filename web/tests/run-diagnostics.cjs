const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{buildSync}=require('esbuild');
process.chdir(path.resolve(__dirname,'..'));fs.mkdirSync('.checks',{recursive:true});
buildSync({entryPoints:['tests/diagnostics.check.ts'],bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:'tsconfig.json',outfile:'.checks/diagnostics.mjs'});
execFileSync(process.execPath,['--require','./tests/indexeddb-storage.cjs','.checks/diagnostics.mjs'],{stdio:'inherit'});

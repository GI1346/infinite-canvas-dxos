const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{buildSync}=require('esbuild');
process.chdir(path.resolve(__dirname,'..'));fs.mkdirSync('.checks',{recursive:true});
fs.writeFileSync('.checks/diagnostics-ui-preload.cjs',`require(${JSON.stringify(path.resolve('tests/channel-protocol-dom.cjs'))});window.indexedDB=globalThis.indexedDB;window.IDBKeyRange=globalThis.IDBKeyRange;`);
buildSync({entryPoints:['tests/diagnostics-ui.check.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',define:{'__APP_VERSION__':'"local"','__APP_RELEASES__':'[]','import.meta.env':'{}'},tsconfig:'tsconfig.json',outfile:'.checks/diagnostics-ui.cjs'});
execFileSync(process.execPath,['--require',path.resolve('.checks/diagnostics-ui-preload.cjs'),'.checks/diagnostics-ui.cjs'],{stdio:'inherit'});

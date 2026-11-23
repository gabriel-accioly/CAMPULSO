import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { parseAst } from 'rollup/parseAst';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
const files=(await readdir('dist',{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(f=>path.relative('dist',path.join(f.parentPath,f.name)).split(path.sep).join('/')).sort();
const refs=[];
const seen=new Set();
function ref(source,value){
 if(value.startsWith('data:')||value.startsWith('#'))return;
 const base='https://local.invalid/';
 const u=new URL(value,base+source);
 assert.equal(u.origin,new URL(base).origin,source);
 const name=decodeURIComponent(u.pathname.slice(1))||'index.html';
 assert.ok(files.includes(name),source+' => '+name);
 refs.push({source,target:name});seen.add(name);
}
const modules=new Set();
const again=await build({logLevel:'silent',build:{write:false}});
for(const bundle of [again].flat()){
 for(const item of bundle.output){
   const original=await readFile(path.join('dist',item.fileName));
   assert.deepEqual(Buffer.from(item.type==='chunk'?item.code:item.source),original,item.fileName);
   if(item.type==='chunk'){
     for (const key of Object.keys(item.modules)) modules.add(key.replaceAll('\\','/'));
     for (const url of [...item.imports,...item.dynamicImports,...item.referencedFiles]) ref(item.fileName,'/'+url);
   }
 }
}
assert.ok([...modules].some(s=>s.endsWith('/r02/entry.tsx')));
assert.ok(![...modules].some(s=>/\/src\/(main\.tsx|app\/App\.tsx)$/.test(s)));
const htmls=files.filter(s=>s.endsWith('.html'));assert.deepEqual(htmls,['404.html','index.html']);
for(const n of files.filter(f=>/\.(html|css|js)$/.test(f))){
 const s=await readFile('dist/'+n,'utf8');
 assert.ok(!/sourceMappingURL\s*=|diagnostic-[\w-]+\.(js|css)|Ensaio técnico isolado da integração|Atualizar diagnóstico/.test(s),n);
 if(n.endsWith('.html')){
  const doc=new JSDOM(s).window.document;
  for(const node of doc.querySelectorAll('[src],[href]'))ref(n,node.getAttribute('src')||node.getAttribute('href'));
 }else if(n.endsWith('.css')){
  const ast=postcss.parse(s);
  ast.walkDecls(d=>{for(const x of d.value.matchAll(/url\(\s*["']?([^)'"]+)["']?\s*\)/g))ref(n,x[1]);});
  ast.walkAtRules('import',d=>{throw Error('unexpected CSS import '+d.params);});
 }else{
  function walk(node){
   if(!node || typeof node!=='object')return;
   if(node.type==='Literal' && typeof node.value==='string' && (/^\/assets\/.+/.test(node.value)||node.value==='/sw.js'))ref(n,node.value);
   if((node.type==='ImportExpression'||node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration')&&node.source){assert.ok(typeof node.source.value==='string');ref(n,node.source.value);}
   for(const v of Object.values(node))if(typeof v==='object')walk(v);
  }
  walk(parseAst(s));
 }
}
const man=JSON.parse(await readFile('dist/manifest.webmanifest'));ref('manifest.webmanifest',man.start_url);
for(const icon of man.icons)ref('manifest.webmanifest',icon.src);
const sw=await readFile('dist/sw.js','utf8');
assert.equal(sw,await readFile('dist/r02/sw.js','utf8'));
const assets=JSON.parse(sw.match(/const ASSETS = (\[[^;]+\]);/)[1]);
for(const a of assets)ref('sw.js',a);
assert.deepEqual([...assets].sort(),files.filter(n=>!n.endsWith('sw.js')&&!['404.html','_headers','LICENSE','NOTICE','THIRD_PARTY_NOTICES.txt'].includes(n)).map(n=>n==='index.html'?'/':'/'+n).sort());
assert.ok(files.every(n=>!n.includes('diagnostic')&&!n.endsWith('.map')));
const proof={html:htmls,refs,emittedModules:[...modules].length,moduleIDs:[...modules].map(id=>id.replace(path.resolve('.').replaceAll('\\','/'),'').replace(/^\u0000/,'')).sort(),privateEntryInBundle:false,assetSet:assets,identicalViteRebuild:true};
const evidence=process.env.CAMPULSO_EVIDENCE_DIR || 'proof';
await mkdir(evidence,{recursive:true});
await writeFile(path.join(evidence,'referencias.json'),JSON.stringify(proof,null,2)+'\n');
console.log(htmls,files.length,refs.length,modules.size);
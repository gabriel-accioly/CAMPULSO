import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [repo, baseline, output] = process.argv.slice(2).map(p => path.resolve(p));
assert.ok(repo && baseline && output, 'Uso: node preparar-seo.mjs REPOSITORIO DIST_BASE DIRETORIO_NOVO');
const manifest = fs.readFileSync(path.join(repo, 'docs/SHA256SUMS_DISTRIBUICAO.txt'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(manifest), 'ac31acb8401f400f673f203bbee3c121654e6e0597c38046d7b3db497e183a36');
const files = manifest.toString().trim().split(/\r?\n/).map(line => line.match(/^([0-9a-f]{64})  (.+)$/));
const inventory = root => fs.readdirSync(root,{recursive:true}).filter(f => fs.statSync(path.join(root,f)).isFile()).sort();
assert.equal(inventory(baseline).length,18);
for(const [,digest,file] of files) assert.equal(hash(fs.readFileSync(path.join(baseline,file))),digest,file);
assert.ok(!fs.existsSync(output), 'O destino deve ser novo');
assert.ok(!output.startsWith(baseline+path.sep),'O destino deve estar fora da base');
const privacy = fs.readFileSync(path.join(repo,'PRIVACY.md'),'utf8');
assert.equal(hash(privacy),'455a08ff7e1bf1152d82ac9c548f23b808060c1a183af2907bdc37064e1eecd7');
const verification = process.env.CAMPULSO_GOOGLE_VERIFICATION;
if(verification) assert.match(verification,/^[\w-]{20,100}$/);
const work = fs.mkdtempSync(path.join(os.tmpdir(),'campulso-seo-'));
const dist = path.join(work,'dist');
fs.cpSync(baseline,dist,{recursive:true});
const read = file => fs.readFileSync(path.join(dist,file),'utf8');
function write(file,text){const dest=path.join(dist,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);}
const origin='https://campulso.pages.dev', title='CAMPULSO | Organização acadêmica para universitários';
const slogan='No ritmo da sua vida universitária.';
const description='Organize disciplinas, tarefas e compromissos, planeje o dia e ajuste a carga de estudos. O CAMPULSO é uma PWA gratuita que funciona offline após o primeiro acesso.';
const icon='/r02/icons/icone-512.png';
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function head(route,name,desc,schema){
  return [
    '<title>'+esc(name)+'</title>',
    '<meta name="description" content="'+esc(desc)+'">',
    '<link rel="canonical" href="'+origin+route+'">',
    ...Object.entries({'og:type':'website','og:site_name':'CAMPULSO','og:locale':'pt_BR','og:title':name,'og:description':desc,'og:url':origin+route,'og:image':origin+icon,'og:image:width':'512','og:image:height':'512','og:image:alt':'Símbolo do CAMPULSO'}).map(([k,v])=>'<meta property="'+k+'" content="'+esc(v)+'">'),
    '<meta name="twitter:card" content="summary">',
    '<link rel="apple-touch-icon" href="/r02/icons/icone-192.png">',
    '<link rel="stylesheet" href="/descoberta.css">',
    '<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org',...schema}).replaceAll('<','\\u003c')+'</script>'
  ].join('\n');
}
const { version } = JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const product={softwareVersion:version,'@type':'WebApplication','@id':origin+'/#app',name:'CAMPULSO',url:origin+'/',description,applicationCategory:'EducationalApplication',operatingSystem:'Web',inLanguage:'pt-BR',isAccessibleForFree:true,image:origin+icon,offers:{'@type':'Offer',price:'0',priceCurrency:'BRL'}};
const links='<a href="/sobre/">Sobre o CAMPULSO</a> · <a href="/privacidade/">Política de privacidade</a>';
let index=read('index.html').replace(/  <meta name="description"[^>]+>\s*<title>[^<]+<\/title>/,head('/',title,description,product));
assert.ok(index.includes('application/ld+json'));
if(verification) index=index.replace('</head>','<meta name="google-site-verification" content="'+verification+'">\n</head>');
index=index.replace('<div id="app-root"></div>','<div id="app-root"><main><h1>CAMPULSO</h1><p>'+slogan+'</p><p>'+description+'</p></main></div>');
index=index.replace('</body>','<nav class="discovery-links" aria-label="Informações sobre o CAMPULSO">'+links+'</nav>\n</body>');
write('index.html',index);
write('descoberta.css',` .discovery-links{font:1rem/1.6 system-ui,sans-serif;text-align:center;padding:1rem;color:#32234c;background:#faf9fd}.discovery-links a,.information a{color:#48209c;text-underline-offset:.15em}.information{max-width:68ch;margin:auto;padding:clamp(1rem,4vw,3rem);color:#272333;background:#faf9fd;font:1.05rem/1.65 system-ui,sans-serif;overflow-wrap:anywhere}.information h1,.information h2{line-height:1.22}.information h2{margin-top:2rem}.information footer{border-top:1px solid #c9c1d5;margin-top:2rem;padding-top:1rem}a:focus-visible{outline:3px solid #7040bb;outline-offset:3px}`.trim()+'\n');
function page(route,name,desc,type,main){return '<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/r02/icons/icone-192.png">'+head(route,name,desc,{'@type':type,name,url:origin+route,inLanguage:'pt-BR',isPartOf:{'@type':'WebSite',name:'CAMPULSO',url:origin+'/'}})+'</head><body class="information"><header><a href="/">Abrir CAMPULSO</a></header><main>'+main+'</main><footer>'+links+'</footer></body></html>\n'}
write('sobre/index.html',page('/sobre/','Sobre o CAMPULSO | Organização universitária','Conheça o aplicativo gratuito de organização acadêmica para estudantes de diferentes graduações, seu funcionamento offline e o contato do responsável.','AboutPage','<h1>Sobre o CAMPULSO</h1><p>'+slogan+'</p><p>'+description+'</p><p>Versão do aplicativo: '+esc(version)+'.</p><h2>Como começar</h2><p>Em Meu dia, abra seu espaço local, cadastre uma disciplina e crie uma tarefa. Informe os compromissos e os horários disponíveis para revisar a proposta de estudo. Quando precisar diminuir a carga, experimente o Modo leve.</p><h2>Instalação e dados</h2><p>Depois da primeira carga, você pode instalar o aplicativo em um navegador compatível e voltar a usá-lo offline. A agenda fica neste dispositivo. Em Dados, exporte um backup JSON para guardar uma cópia ou restaurá-la em outro navegador.</p><h2>Contato</h2><p>Gabriel Accioly é o responsável pelo projeto. Dúvidas e sugestões podem ser enviadas para <a href="mailto:accioly.ga@hotmail.com">accioly.ga@hotmail.com</a>.</p>'));
function inline(text){return esc(text).replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)]+)\)/g,'<a href="$2">$1</a>');}
let body='',list=false;
for(const line of privacy.trim().split(/\r?\n/).filter(x=>x.trim())){
  if(line.startsWith('- ')){if(!list)body+='<ul>';list=true;body+='<li>'+inline(line.slice(2))+'</li>';continue;}
  if(list){body+='</ul>';list=false;}
  const level=line.startsWith('## ')?'h2':line.startsWith('# ')?'h1':'p';
  body+='<'+level+'>'+inline(line.replace(/^#{1,2} /,''))+'</'+level+'>';
}
if(list)body+='</ul>';
write('privacidade/index.html',page('/privacidade/','Política de privacidade | CAMPULSO','Política 1.1 do CAMPULSO. Saiba onde ficam os dados, como funcionam o backup e o atendimento e como exercer seus direitos.','WebPage',body));
write('robots.txt','User-agent: *\nAllow: /\nDisallow: /?scenario=\n\nSitemap: '+origin+'/sitemap.xml\n');
write('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/sobre/','/privacidade/'].map(p=>'<url><loc>'+origin+p+'</loc></url>').join('')+'</urlset>\n');
write('404.html',read('404.html').replace('<title>','<meta name="robots" content="noindex,follow"><title>'));
const headerBlocks = new Map(read('_headers').trim().split(/\r?\n\s*\r?\n/).map(block => {
  const [route, ...headers] = block.split(/\r?\n/);
  return [route, headers];
}));
function addHeader(route, header) {
  const headers = headerBlocks.get(route) || [];
  headers.push('  ' + header);
  headerBlocks.set(route, headers);
}
for (const route of ['/r02/*','/404.html','/LICENSE','/NOTICE','/THIRD_PARTY_NOTICES.txt','/sw.js','/manifest.webmanifest','https://:deployment.campulso.pages.dev/*']) {
  addHeader(route, 'X-Robots-Tag: noindex');
}
for (const route of ['/sobre/','/privacidade/','/robots.txt','/sitemap.xml','/descoberta.css']) {
  addHeader(route, 'Cache-Control: public, no-cache, must-revalidate');
}
write('_headers', [...headerBlocks].map(([route, headers]) => [route, ...headers].join('\n')).join('\n\n') + '\n');
// Include the two new public documents and their stylesheet in the same
// atomic, integrity-checked cache as the existing shell.
const originalBuilder=fs.readFileSync(path.join(repo,'scripts/build-offline.mjs'),'utf8');
const initialFiles="const files = ['index.html',";
const indexRoute="file === 'index.html' ? '/' : '/' + file";
assert.ok(originalBuilder.includes(initialFiles) && originalBuilder.includes(indexRoute));
const builder=originalBuilder.replace(initialFiles,"const files = ['descoberta.css','sobre/index.html','privacidade/index.html','index.html',")
  .replace(indexRoute,"file.endsWith('index.html') ? '/' + file.slice(0,-10) : '/' + file");
fs.mkdirSync(path.join(work,'scripts'),{recursive:true});
fs.writeFileSync(path.join(work,'scripts/build-offline.mjs'),builder);
for (const name of ['LICENSE', 'NOTICE']) fs.copyFileSync(path.join(repo,name),path.join(work,name));
execFileSync(process.execPath,[path.join(work,'scripts/build-offline.mjs')],{cwd:work,stdio:'inherit'});
fs.cpSync(dist,output,{recursive:true,errorOnExist:true,force:false});
console.log('Distribuição de descoberta:',inventory(output).length,'arquivos.');

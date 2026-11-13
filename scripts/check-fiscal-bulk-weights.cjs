const fs=require('fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('apps/frontend/src/app/features/listings/listing-fiscal-dialog.component.ts','utf8'),ast=ts.createSourceFile('editor.ts',source,ts.ScriptTarget.Latest,true);
const component=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='ListingFiscalDialogComponent');
const methods=['validWeight','bulkWeightError','validBulkWeights','applyBulkWeights'].map(name=>component.members.find(member=>member.name?.getText(ast)===name).getText(ast)).join('\n');
const code=ts.transpileModule('class Editor {'+methods+' contextValid(){return true;} } globalThis.Editor=Editor;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox={};vm.runInNewContext(code,sandbox);
const editor=new sandbox.Editor();Object.assign(editor,{bulkNetWeight:'0.500',bulkGrossWeight:'0.550',busy:false,phase:'edit',draft:{rows:[{values:{cost:'10',net_weight:'0.200',gross_weight:'0.300'},sources:{}},{values:{cost:'20',net_weight:'0.250',gross_weight:'0.350'},sources:{}}]}});
assert.equal(editor.validBulkWeights,true);editor.applyBulkWeights();for(const row of editor.draft.rows){assert.equal(row.values.net_weight,'0.500');assert.equal(row.values.gross_weight,'0.550');}assert.equal(editor.draft.rows[0].values.cost,'10');
editor.bulkNetWeight='';editor.bulkGrossWeight='0.600';editor.applyBulkWeights();assert.equal(editor.draft.rows[0].values.net_weight,'0.500');assert.equal(editor.draft.rows[0].values.gross_weight,'0.600');
editor.bulkNetWeight='0.700';editor.bulkGrossWeight='';assert.equal(editor.validBulkWeights,false);assert.match(editor.bulkWeightError,/peso bruto/);
for(const invalid of ['-1','NaN','0','0.1234']){editor.bulkNetWeight=invalid;assert.equal(editor.validBulkWeights,false);}
editor.bulkNetWeight='';editor.bulkGrossWeight='';assert.equal(editor.validBulkWeights,false);
editor.bulkNetWeight='0.200';editor.bulkGrossWeight='0.300';editor.busy=true;editor.applyBulkWeights();assert.equal(editor.draft.rows[0].values.net_weight,'0.500');
console.log('Fiscal bulk weights verified: both weights, independent updates, preserved costs, kg precision, invalid/blank values, gross/net consistency and busy state.');

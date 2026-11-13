export const FISCAL_OPTIONS:Record<string,ReadonlyArray<{value:string;label:string}>>={
  origin_type:[{value:'manufacturer',label:'Fabricação própria'},{value:'reseller',label:'Revenda'},{value:'imported',label:'Importado'}],
  origin_detail:[
    {value:'0',label:'0 — Nacional, exceto códigos 3, 4, 5 e 8'},
    {value:'1',label:'1 — Estrangeira: importação direta, exceto código 6'},
    {value:'2',label:'2 — Estrangeira: compra no mercado interno, exceto código 7'},
    {value:'3',label:'3 — Nacional: conteúdo importado acima de 40% até 70%'},
    {value:'4',label:'4 — Nacional: produzida conforme processo produtivo básico'},
    {value:'5',label:'5 — Nacional: conteúdo importado de até 40%'},
    {value:'6',label:'6 — Importação direta: sem similar nacional (lista CAMEX) ou gás natural'},
    {value:'7',label:'7 — Compra interna: sem similar nacional (lista CAMEX) ou gás natural'},
    {value:'8',label:'8 — Nacional: conteúdo importado acima de 70%'}
  ],
  measurement_unit:[{value:'UNID',label:'UNID — Unidade'},{value:'PAR',label:'PAR — Par'},{value:'KIT',label:'KIT — Kit'},{value:'CX',label:'CX — Caixa'},{value:'PCT',label:'PCT — Pacote'},{value:'DZ',label:'DZ — Dúzia'},{value:'KG',label:'KG — Quilograma'},{value:'G',label:'G — Grama'},{value:'M',label:'M — Metro'},{value:'M2',label:'M2 — Metro quadrado'},{value:'M3',label:'M3 — Metro cúbico'},{value:'L',label:'L — Litro'},{value:'ML',label:'ML — Mililitro'}],
  csosn:[
    {value:'101',label:'101 — Tributação com permissão de crédito'},
    {value:'102',label:'102 — Tributação sem permissão de crédito'},
    {value:'103',label:'103 — Isenção do ICMS por faixa de receita'},
    {value:'201',label:'201 — Com crédito e cobrança de ICMS por substituição tributária'},
    {value:'202',label:'202 — Sem crédito e com cobrança de ICMS por substituição tributária'},
    {value:'203',label:'203 — Isenção por faixa de receita e ICMS por substituição tributária'},
    {value:'300',label:'300 — Imune'},
    {value:'400',label:'400 — Não tributada pelo Simples Nacional'},
    {value:'500',label:'500 — ICMS recolhido anteriormente por substituição ou antecipação'},
    {value:'900',label:'900 — Outros'}
  ]
};

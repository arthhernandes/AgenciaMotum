# Catálogo NCM

Fonte: `Tabela_NCM_Vigente_20261014.xlsx`, fornecida pelo usuário, com referência em 14/10/2026.

O arquivo `ncm-2026-10-14.json` preserva os códigos, descrições, datas e atos legais da planilha. A tabela `NcmEntry` mantém 10.516 códigos completos de oito dígitos e 4.641 registros de hierarquia. Códigos mantêm os zeros à esquerda. `fullDescription` reúne a descrição do código e de seus níveis superiores, sem substituir a descrição original.

Extração: `prisma/import-ncm.ps1`, com `-Path` para a planilha e `-OutputPath` para o JSON. A extração trata o conteúdo da planilha somente como dados.

Importação no diretório do backend:

```
npx ts-node prisma/import-ncm.ts prisma/data/ncm-2026-10-14.json
```

A importação valida todos os registros antes de gravar e usa upsert pela chave `code`; repetir o arquivo não duplica códigos. Não altera produtos, estoque, preço nem os dados fiscais dos anúncios.

Consultas autenticadas: `GET /api/ncm?search=calcas%20algodao`, `GET /api/ncm/61051000`, `GET /api/ncm?includeHierarchy=true`. O chat dispõe da ferramenta `consultar_ncm`. A presença do código na tabela não confirma que ele seja a classificação fiscal correta de um produto.

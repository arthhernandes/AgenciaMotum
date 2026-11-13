# Rentabilidade de pedidos

A aba **Relatórios → Rentabilidade de pedidos** usa a conta conectada e exige as permissões **Relatórios** e **Custos dos produtos**. A consulta é somente leitura.

## Execução por linha de comando

Após `npm.cmd --workspace apps/backend run build`, configure `ACCESS_TOKEN` e `SELLER_ID` no ambiente ou no `.env`. O token é enviado somente à API oficial e nunca é incluído no relatório.

```powershell
node scripts/order-profitability.cjs --from 2026-10-01 --to 2026-10-22 --tax-rate 6 --out rentabilidade.json
```

Sem datas, consulta os últimos 30 dias. Também aceita `--config caminho.json`, com as chaves `ACCESS_TOKEN`, `SELLER_ID`, `dateFrom`, `dateTo` e `taxRate`. Proteja esse arquivo e não o versione. Sem `--out`, escreve JSON na saída padrão.

## Fontes e cálculos

- Pedidos pagos: `/orders/search`, páginas de até 50, e `/orders/{id}`.
- Receita da linha: `unit_price × quantity`; taxa ML: `sale_fee × quantity`.
- Frete: `senders[].cost` do vendedor em `/shipments/{id}/costs`. Consulta todos os pedidos de `/shipments/{id}/items` e rateia proporcionalmente à receita, em centavos, incluindo itens fora do intervalo para não cobrar o envio inteiro várias vezes.
- Custo: `cost` de `/items/fiscal_information/{sku}`, multiplicado pela quantidade. É o cadastro atual, não um custo histórico comprovado na data da venda.
- Imposto: percentual geral informado pelo usuário, aplicado sobre `unit_price × quantity` e arredondado em centavos por item. Informe de 0 a 100%; 0% é aceito explicitamente. Na linha de comando, use `--tax-rate`, `GENERAL_TAX_RATE` ou `taxRate` no arquivo. Não há alíquota presumida. Na tela, a consulta pode ocorrer sem percentual: imposto e lucro líquido ficam pendentes e são recalculados localmente ao preencher ou alterar a alíquota, sem consultar novamente os pedidos.
- Custo operacional: taxa ML + frete rateado + custo fiscal + imposto calculado.
- Lucro líquido calculado: receita − custo operacional. Margem: lucro / receita × 100. Receita zero não gera margem.

Valores ausentes permanecem nulos; zero somente quando confirmado na fonte. O resultado antes dos impostos é apresentado separadamente quando os demais componentes existem. Pedidos com reembolso ou moeda diferente de BRL exigem conciliação e não recebem lucro líquido. Erros por pedido não interrompem os demais. Há novas tentativas limitadas para falhas transitórias e rate limit; uma falha de paginação é informada como relatório incompleto.

A consulta por linha de comando não importa publicidade. O relatório não inclui despesas fixas, conciliação de cashback nem ajustes financeiros posteriores não fornecidos nesses recursos. Não consulta billing_info porque esse recurso contém dados fiscais do comprador, não o custo de aquisição.

## Referências

- [Pedidos](https://developers.mercadolivre.com.br/pt_br/imovel-consulta-de-usuarios/gerenciamento-de-vendas)
- [Cadastro fiscal por SKU](https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/envio-dos-dados-fiscais)
- [Custos de envio](https://developers.mercadolivre.com.br/pt_br/registre-o-seu-aplicativo/gerenciamento-de-envios)

Na tela, a coluna Publicidade (R$) permite informar o custo total de publicidade de cada item do pedido (sem multiplicar pela quantidade). Em branco considera zero. O valor reduz o resultado antes dos impostos e o lucro, integra o custo operacional e acompanha o CSV. Os valores digitados ficam salvos por conta e período.

## Importação de Product Ads na tela

O relatório lê automaticamente a publicidade já salva no banco. A importação ocorre na sincronização diária. O token deve ter acesso a um único anunciante brasileiro Product Ads. A integração verifica o dono de cada MLB, busca os Ad Groups usando filters[item_ids] e pagina as métricas dos anúncios do grupo. Usa api-version 1 na identificação do anunciante e 2 nas demais leituras.

O gasto real cost de cada MLB no período é rateado pela receita das linhas desse MLB nos pedidos pagos consultados. O rateio preserva todos os centavos e está identificado como **Product Ads · rateado**. Não representa atribuição exata da publicidade a um pedido nem inclui gasto de produtos sem pedidos neste relatório. Inclui apenas Product Ads, sem Brand Ads/Display. A API limita a consulta aos últimos 90 dias.

Valores manuais são preservados; um MLB com algum valor manual não recebe novo rateio. Ausência de métricas não é convertida em zero: a linha fica pendente até informar o custo manualmente ou importar com sucesso. Origem e pendências acompanham o CSV.

[Documentação de Product Ads](https://developers.mercadolivre.com.br/pt_br/product-ads-para-catalogo-e-user-products-leitura).

## Dados persistentes

A migração 20261022172000_persistent_integration_snapshots cria IntegrationSnapshot, com chave exclusiva por conta, categoria e consulta. Pedidos sanitizados e custos de Product Ads confirmados são armazenados por vendedor e período exato. Não armazena tokens nem dados fiscais ou endereços do comprador. Lucro e margem são recalculados a partir dos componentes salvos.

O relatório e o botão Atualizar relatório leem exclusivamente o banco. Mesmo refresh=true ou cachedOnly=false não habilitam chamadas ao Mercado Livre. A publicidade usa o histórico diário salvo; dados ausentes permanecem pendentes.

Imposto e valores manuais são compartilhados na conta e período, salvos ao sair do campo ou no botão Salvar ajustes. O salvamento registra o usuário responsável. O relatório só confirma o salvamento após a gravação; erros permitem nova tentativa. Atualizar os dados externos preserva esses ajustes.

O cache de consultas avulsas de visitas mantém validade de 15 minutos. O histórico diário importado é permanente: Anúncios e Relatórios somam as datas salvas antes de consultar o Mercado Livre. Um período só usa o histórico diário quando todos os dias estão cobertos; falhas não viram zero.

Ao abrir a rentabilidade, a tela recupera automaticamente as informações salvas, sem chamar o Mercado Livre. A leitura reúne todas as páginas do período independentemente do tamanho da importação. Páginas com custos ausentes ou erros por pedido também ficam salvas, mantendo suas pendências. Importar pedidos busca dados ainda não salvos; Atualizar pedidos força nova leitura externa. O último tipo de relatório e o período escolhido são lembrados por conta no navegador.

## Importação integral do histórico

Execute node scripts/import-order-history.cjs depois de compilar o backend. Usa as contas Mercado Livre ativas e importa os últimos 12 meses disponibilizados pela API, inclusive status diferentes de pago. As opções --account mottum ou --account outlet4u e --from/--to limitam uma retomada. O processo só faz leituras no Mercado Livre.

Cada lote é gravado com upsert por conta/pedido na categoria ORDER_HISTORY. ORDER_HISTORY_RANGE e ORDER_HISTORY_DAY registram os períodos concluídos, permitindo retomar sem repetir meses completos. AuditLog, ação ORDER_HISTORY_IMPORT, registra o andamento, contagens e falhas. Um bloqueio transacional impede iniciar dois importadores simultâneos.

O arquivo guarda apenas dados de produto e financeiros, sem comprador/endere?o/tokens. A taxa ML é multiplicada pela quantidade; custo fiscal confirmado vem do cadastro por SKU. Frete previamente confirmado no relatório é preservado para o mesmo item/quantidade/preço. Outros fretes ficam pendentes, sem utilizar shipping_cost do comprador nem order_cost (que pode representar o valor do pedido). A sincronização diária completa esses componentes no banco.

O relatório recupera os pedidos pagos do histórico para qualquer intervalo coberto, inclusive quando não existe um snapshot com aquelas datas exatas. Os demais status continuam arquivados no banco. Os registros e ajustes manuais preexistentes são preservados.

Após importar, node scripts/reconcile-order-history.cjs confere novamente os IDs e recupera lacunas entre páginas. A opção --tail-only verifica somente os 500 pedidos mais recentes, para fechar novas vendas ocorridas durante uma conferência integral já realizada. Em 22/10/2026, a carga e a conferência concluíram 6.093 pedidos da Motum e 43.284 da Outlet4u (49.377 no total), com cobertura de 366 dias nas duas contas.

## Histórico diário de publicidade e visitas

Depois de compilar o backend, execute `node scripts/import-advertising-visits.cjs`. Importa as contas Mercado Livre ativas, apenas com leituras externas. `--account mottum` / `--account outlet4u`, `--ads-only` e `--visits-only` permitem cargas separadas. A ação `ADVERTISING_VISITS_IMPORT` no AuditLog registra progresso, totais, falhas e conclusão. Checkpoints permitem retomar sem repetir os intervalos concluídos; o processo controla a velocidade entre as duas contas e aguarda o rate limit.

`PRODUCT_ADS_DAILY` guarda os gastos em centavos por MLB/dia dos últimos 90 dias disponibilizados pelo Product Ads. A enumeração inclui grupos e anúncios pausados. Nas métricas diárias, o filtro obrigatório é `filters[item_id]` (singular): sem ele a API agrega todos os anúncios do vendedor, mesmo com um grupo no caminho. A importação valida o total diário contra os gastos por MLB; se o gasto do dia cresceu durante a carga, consulta novamente o total. Não atribui automaticamente o total de um grupo a cada um de seus anúncios.

`VISITS_DAILY` guarda a série diária e seus intervalos de cobertura, até dois anos. Inclui os anúncios locais, os IDs do histórico de pedidos e os IDs da publicidade da própria conta. `VISITS_TOTAL` guarda a contagem de dois anos devolvida pelo Mercado Livre: zero confirmado evita consultas diárias redundantes. Demais itens são consultados em janelas inclusivas de até 150 dias, preservando as datas do provedor e validando a soma da série. Só grava métricas confirmadas, sem tokens nem dados de compradores.

Os registros diários não expiram. Períodos cobertos são calculados no banco, inclusive combinações de datas que nunca haviam sido consultadas na tela. A rentabilidade recupera a publicidade salva automaticamente e mantém o rateio por receita; a atribuição continua sendo por MLB/período, não por pedido. Datas fora da cobertura precisam de nova importação; os valores do dia corrente são os encontrados no horário indicado em `checkedAt`.

Quando a soma dos dias conhecidos coincide com o total retido, a carga verifica novamente o total após a leitura diária. Se continua igual, os dias restantes são comprovadamente zero e não exigem outras janelas. Se houver diferença ou erro na conferência, continua consultando as janelas. `node scripts/check-metrics-import-status.cjs --verify` confere a cobertura gravada e os totais; `node scripts/check-persistent-metrics-real.cjs` verifica a reutilização dos dados das duas contas com acesso externo deliberadamente bloqueado.

## Próximas cargas e retomada

Os importadores consultam os checkpoints de cada conta antes de buscar o histórico. Pedidos recuperam os dias ausentes e revisam os últimos sete dias já coletados, incluindo os pedidos cancelados/alterados desse trecho. `--refresh-days 0` desliga essa revisão; `--refresh-days N` aceita até 90 dias. Alterações em pedidos mais antigos exigem reconciliação explícita do período.

Visitas buscam apenas as lacunas de cobertura e os dias novos, com um dia de sobreposição para fechar o último dia parcial. Publicidade consulta as datas ausentes e revisa três dias recentes para métricas que chegam com atraso. Novos MLBs de publicidade recebem seu próprio histórico de até 90 dias, sem atribuir aos novos itens a cobertura de outros anúncios. Uma nova carga de publicidade renova os dados dos grupos; checkpoints de grupos são reaproveitados somente em retomadas explícitas.

Depois de confirmar que o processo antigo foi encerrado, `node scripts/import-advertising-visits.cjs --visits-only --resume-job ID` retoma a execução interrompida e mantém suas datas originais, mesmo no dia seguinte. Não usa o total móvel de dois anos do dia atual para deduzir zeros de uma data histórica. O vínculo entre a execução antiga e a nova fica no AuditLog. `node scripts/check-incremental-import-plan.cjs` mostra o plano calculado com os checkpoints reais, sem chamadas externas.

Esses comportamentos pertencem aos importadores. O agendamento existente de catálogo/anúncios não inicia automaticamente os novos importadores financeiros.
# Conferência dos custos pendentes

`node scripts/enrich-order-history.cjs` preenche apenas frete e custo fiscal ausentes nos pedidos pagos já importados, das duas contas. Os pedidos mais recentes são priorizados. `--account outlet4u` e `--limit 6` permitem restringir uma conferência.

O frete vem de `/shipments/{id}/costs`, é conferido contra os itens do envio e rateado por receita entre todos os pedidos envolvidos, inclusive fora do período do relatório. Os valores de frete e os itens sanitizados do envio ficam persistidos, para reutilização. Não são salvos dados pessoais do destinatário. O custo fiscal é consultado por SKU; valores não confirmados permanecem nulos. Ajustes manuais de publicidade, frete comprador e imposto não são alterados.

`node scripts/check-order-enrichment-status.cjs` mostra o andamento salvo em `ORDER_HISTORY_ENRICHMENT`. Os campos preenchidos são checkpoints permanentes: uma nova execução seleciona somente pedidos que ainda têm custos pendentes. Para recuperar uma execução interrompida, use `--resume-job ID`; o script recusa iniciar outra cópia enquanto o processo anterior existir.

Essa conferência completa pode levar horas por causa do volume e do limite da API. Ela não é iniciada automaticamente pelo cron de anúncios. O relatório lê os valores atualizados do banco ao ser recarregado.

A retomada preserva o escopo original em `ORDER_ENRICHMENT_SCOPE` e um marcador por pedido em `ORDER_ENRICHMENT_CHECK`. Um custo fiscal confirmado como indisponível também conta como pedido conferido, permanecendo nulo no relatório sem voltar automaticamente à fila. O marcador considera identificação do item, SKU, quantidade, preço, status e envio: alterações nesses dados invalidam o marcador. Erros transitórios permanecem elegíveis para nova tentativa. A barra mantém a contagem acumulada das execuções anteriores.

`node scripts/check-enrichment-checkpoints.cjs` valida essa regra. Para migração de uma execução legada interrompida, `node scripts/migrate-enrichment-checkpoints.cjs ID` recupera os marcadores pela ordem original e só prossegue quando o total reconstruído coincide exatamente com o escopo registrado; não realiza chamadas ao Mercado Livre.

## Sincronização diária dos relatórios

Após a sincronização diária do catálogo, um processo em segundo plano atualiza pedidos, custos e publicidade/visitas, nessa ordem, para as duas contas. O agendamento usa a configura??o diária existente e aguarda qualquer carga inicial ativa. A execução fica registrada em AuditLog com a??o DAILY_REPORTS_SYNC, etapa, PID e resultado. Resultados parciais não impedem as demais fontes.

Os importadores reutilizam dias e checkpoints j? gravados, atualizando os dias recentes para capturar mudan?as de status e m?tricas. Nenhum relatório inicia importa??es. Uma execução interrompida preserva os dados e checkpoints; processos encerrados são identificados pelo PID, sem reiniciar processos ativos. A próxima sincronização completa os dados que faltarem.

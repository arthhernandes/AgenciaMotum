# Chat da operação

O menu **Assistente IA** abre `/chat`. A integração aceita Qwen em servidor compatível com Chat Completions (como Ollama ou vLLM) e OpenAI Responses. As mensagens e os dados necessários são enviados somente ao provedor configurado; credenciais Olist/Mercado Livre nunca entram nos resultados das ferramentas.

## Ativação

### Qwen no seu servidor

No arquivo `apps/backend/.env`, configure o endereço alcançável pelo backend e o nome exato do modelo instalado:

```dotenv
CHAT_PROVIDER=qwen
CHAT_BASE_URL=http://SEU_SERVIDOR:11434/v1
CHAT_MODEL=NOME_EXATO_DO_MODELO
CHAT_API_KEY=
CHAT_REASONING_EFFORT=none
```

A porta 11434 é um exemplo de Ollama; vLLM costuma usar outra porta. A URL deve terminar na base da API (`/v1`), sem `/chat/completions`. Se o servidor exigir autenticação, preencha `CHAT_API_KEY`. Não é necessária chave OpenAI nesse modo e não há fallback para a OpenAI.

O servidor e o modelo precisam suportar chamadas de ferramentas (`tools` e `tool_calls`) para consultar as APIs e preparar ações. Em vLLM, isso pode exigir configuração do parser e habilitação de ferramentas no servidor, conforme a versão e o modelo. Reinicie a instância existente do backend após editar o ambiente.

### OpenAI

No arquivo `apps/backend/.env`, configure:

```dotenv
OPENAI_API_KEY=sua_chave_da_api
OPENAI_CHAT_MODEL=gpt-4.1-mini
CHAT_PROVIDER=openai
```

Reinicie a instância existente do backend e abra o Assistente IA. A chave precisa ter acesso ao modelo configurado. O consumo é cobrado pela conta da API. Não publique a chave nem coloque variáveis OpenAI no frontend.

## Recursos

- Consultar produtos e variações do catálogo Olist.
- Consultar anúncios agrupados por pai e filtrar SKUs encontrados, não encontrados ou ausentes.
- Comparar estoque disponível Olist com os anúncios vinculados ao SKU completo.
- Consultar progresso e erros de sincronização.
- Preparar e confirmar sincronização Olist ou Mercado Livre.
- Preparar e confirmar vínculo entre MLB e variação Olist com SKU exato já presente no anúncio.
- Consultar anúncios Mercado Livre ao vivo, com preço, estoque, fotos, descrição e IDs de variações.
- Preparar alterações de preço em reais, estoque, pausa/reativação, título/nome de família, descrição, fotos e atributos.
- Alterar até 20 MLBs explícitos em uma proposta, com resultado individual por anúncio.
- Adicionar ou editar variações tradicionais preservando as demais; não remove variações. Em User Products, preparar outra publicação com novos atributos.
- Criar um anúncio por proposta usando um MLB existente da conta como modelo, validado na API antes de publicar. Categoria, condição, tipo, fotos e atributos não informados são herdados e aparecem na prévia. Publicações podem gerar tarifas.
- Abrir **Histórico de ações** no chat para consultar data, usuário, conta, proposta e resultado. O histórico é persistente, paginado e filtrado pela conta e tipo de ação. Inclui confirmações, falhas e cancelamentos; consultas e mensagens não entram como ações executadas. As sincronizações mostram o estado atual de sua execução.

Os dados consultados vêm da última sincronização local. A Motum usa o estoque disponível da Outlet4u pelo SKU. As ações usam apenas a conta selecionada e exigem confirmação por botão. As propostas expiram em 10 minutos, são vinculadas ao usuário e à conta e desaparecem se o backend reiniciar. A conversa permanece apenas na tela e é limpa ao sair ou recarregar.

Para alterações e publicações no Mercado Livre, usuários ADMIN e CONSULTANT precisam conferir a tabela Atual/Proposto e clicar em Confirmar. Escrever "confirmo" no chat não executa uma mudança. O servidor verifica o vendedor e a conta, consulta novamente o anúncio, recusa propostas desatualizadas, registra a intenção em AuditLog, envia a mudança uma vez e consulta o resultado. Se houver timeout, falha parcial ou valor ignorado pela API, o resultado fica não verificado: consulte o anúncio antes de repetir. Cancelar remove a proposta do servidor.

Estoque Full e estoque por depósito não são alterados pelo chat. Preços com automatização ativa são bloqueados. Em anúncios tradicionais todas as variações compartilham o preço; em User Products, certas características e estoques podem ser compartilhados com outros anúncios, conforme indicado na prévia. Descrições devem conter texto simples. Fotos substituem a lista completa e precisam preservar os IDs usados pelas variações. Restrições de categoria, títulos com vendas e ofertas continuam sujeitas às regras do Mercado Livre. A integração não modifica o estoque ou preço Olist. Falhas nas autorizações Olist/Mercado Livre precisam ser resolvidas em Contas conectadas.

Exemplos: "Altere o preço do MLB123456789 para R$ 149,90", "Pause o MLB123456789", "Mude o estoque da variação 123 do MLB123456789 para 8", "Prepare um novo anúncio com o MLB123456789 como modelo, título Camiseta azul, SKU AZUL-M, preço R$ 149,90 e estoque 5". Valores, anúncio e variação precisam ser explícitos; a IA pode pedir os dados que faltarem.

## Endpoints

Todos exigem JWT da aplicação:

- `GET /api/chat/status`: indica se existe chave configurada, sem expô-la.
- `POST /api/chat/messages?marketplaceAccountId=...`: mensagens com papéis `user` e `assistant`.
- `POST /api/chat/actions/:id/confirm?marketplaceAccountId=...`: executa proposta pertencente ao usuário e à conta selecionada, uma única vez.
- `POST /api/chat/actions/:id/cancel?marketplaceAccountId=...`: remove a proposta pertencente ao usuário e à conta.
- `GET /api/chat/history?marketplaceAccountId=...&page=1&limit=20&kind=all`: retorna o histórico da conta selecionada; filtros `marketplace`, `sync`, `link` e `cancelled`. Registros anteriores de alterações ML e vínculos aparecem quando há informação suficiente para identificar a conta. Detalhes técnicos de auditoria não aparecem como ações duplicadas.

Referência oficial: https://developers.openai.com/api/docs/guides/function-calling

Compatibilidade Ollama: https://docs.ollama.com/api/openai-compatibility

Compatibilidade vLLM: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/

Mercado Livre: [Modificação de anúncios](https://developers.mercadolivre.com.br/pt_br/produto-sincronizacao-de-publicacoes), [Automatização de preços](https://developers.mercadolivre.com.br/pt_br/automatizacoes-de-precos), [Estoque distribuído](https://developers.mercadolivre.com.br/pt_br/estoque-distribuido), [Validador](https://developers.mercadolivre.com.br/pt_br/validador-de-publicacoes).

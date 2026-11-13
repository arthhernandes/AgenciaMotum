const text = { type: 'string' };
const searchText = { type: 'string', description: 'Nome, SKU ou termo específico solicitado. Use string vazia quando não houver filtro, inclusive para consultar o total geral.' };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const attributes = { type: 'array', maxItems: 50, items: object({ id: text, valor: text }) };
const photos = { type: 'array', minItems: 1, maxItems: 12, items: text };
const update = object({
  mlb: text, preco: nullable({ type: 'number', exclusiveMinimum: 0 }), estoque: nullable({ type: 'integer', minimum: 0 }),
  variacao_id: nullable(text), status: nullable({ type: 'string', enum: ['active', 'paused'] }),
  titulo: nullable(text), descricao: nullable(text), fotos: nullable(photos), atributos: nullable(attributes)
});
const tool = (name: string, description: string, properties: Record<string, unknown>) => ({
  type: 'function', name, description, strict: true,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
});

export const CHAT_TOOLS = [
  tool('consultar_ncm','Consulta códigos NCM de 8 dígitos na tabela importada, por código com ou sem pontos ou por termos da descrição. Retorna descrição completa com hierarquia, vigência e ato legal. Use para verificar códigos e pesquisar classificações; não invente códigos nem atribua uma classificação ao produto sem revisão e confirmação.',{busca:text}),
  tool('preparar_publicacao_variacoes_do_pai_ml','Prepara publicação das variações de um pai User Products: reaproveita variantes existentes, cria somente as faltantes, consulta estoque ao vivo na Bling, define estoque por depósito e cria ofertas na MESMA família. Exige preço escolhido; a prévia mostra as fotos herdadas e o clique Confirmar e publicar autoriza seu uso. publicar_com_saldo deve ser true no fluxo padrão Confirmar e publicar, cuja prévia informa que as sem saldo são publicadas pausadas e aguardam reposição para ativar. false preserva todas ou nenhuma e bloqueia o fluxo não atômico. Não publica ao preparar: exige botão Confirmar. skus null usa as outras cores do catálogo. O trabalho fica salvo e retoma após limites da API.',{anuncio:text,preco:nullable({type:'number',exclusiveMinimum:0}),skus:nullable({type:'array',minItems:1,maxItems:100,items:text}),fotos_modelo_confirmadas:{type:'boolean'},publicar_com_saldo:{type:'boolean'}}),
  tool('preparar_variantes_da_familia_ml', 'Prepara novas variações a partir do pai e dos SKUs Bling. O servidor identifica o formato ao vivo e escolhe automaticamente o fluxo. No tradicional, adiciona variações preservando as existentes e usa estoque Bling e preço compartilhado. Em User Products, prepara por padrão a publicação de ofertas na mesma família, com saldo real Bling, guia do modelo e confirmação única. Somente pedidos explícitos sem publicar usam cadastro de variantes. Informe nome/MLB do pai e SKUs exatos ausentes da Bling; o servidor obtém cor e tamanho da mesma linha do catálogo. fotos pode ser null para herdar as imagens do modelo, com aviso na prévia. Exige o botão Confirmar. Use como fluxo padrão ao adicionar cores/tamanhos de qualquer pai; não escolha o formato nem use preparar_publicacao_ml para esse pedido.', {anuncio:text,variacoes:{type:'array',minItems:1,maxItems:20,items:object({sku:text,fotos:nullable(photos)})}}),
  tool('consultar_variacoes_do_anuncio', 'Consulta pelo nome, MLB ou referência: recupera ao vivo os MLBs, preços e SKUs do pai, identifica automaticamente o produto Bling pelos SKUs/vínculos e retorna TODAS as cores, tamanhos, estoque e quais já existem no pai. Use para conferir SKUs e completar variações sem pedir novamente o SKU base ou o nome do produto. Não prepara alterações.', { anuncio: text }),
  tool('identificar_anuncio_ml', 'Identifica o anúncio pai pelo nome, MLB ou referência na conta selecionada e retorna todos os MLBs, SKUs e atributos das variações. Não invente IDs. Se houver ambiguidade, peça a escolha do usuário.', { anuncio: text }),
  tool('preparar_alteracao_por_nome_ml', 'Prepara uma alteração pelo nome, MLB ou referência do anúncio. Use escopo pai por padrão quando o usuário pedir alterar o anúncio: inclui TODOS os MLBs e variações automaticamente, sem truncar. Use escopo variacao somente quando o usuário pedir uma variação específica e informar qual; se não informar, pergunte. variacao contém SKU, ID ou cor e tamanho fornecidos pelo usuário; nunca escolha uma por conta própria. Estoque do pai é a quantidade por variação; esclareça se o usuário informar um total agregado. Use null nos campos não solicitados. Consulta ao vivo e exige confirmação da prévia.', {
    anuncio: text, escopo: { type: 'string', enum: ['pai', 'variacao'] }, variacao: nullable(text),
    preco: nullable({ type: 'number', exclusiveMinimum: 0 }), estoque: nullable({ type: 'integer', minimum: 0 }),
    status: nullable({ type: 'string', enum: ['active', 'paused'] }), titulo: nullable(text), descricao: nullable(text), fotos: nullable(photos), atributos: nullable(attributes)
  }),
  tool('consultar_produtos', 'Busca produtos e variações no catálogo Bling da conta selecionada. Dados salvos na última sincronização.', { busca: searchText }),
  tool('consultar_anuncios', 'Busca anúncios pai da conta selecionada por nome, MLB ou SKU. Filtro de SKU no catálogo Bling. Retorna total e até 10 anúncios.', {
    busca: searchText, sku_na_bling: { type: 'string', enum: ['todos', 'found', 'missing', 'no_sku'] }
  }),
  tool('comparar_estoque', 'Consulta SKU completo de variação e compara estoque disponível Bling com anúncios ML vinculados. Dados locais, não consulta em tempo real.', { sku: text }),
  tool('consultar_sincronizacoes', 'Mostra as 5 últimas execuções da conta selecionada, com erros e progresso.', {}),
  tool('preparar_sincronizacao', 'Prepara uma sincronização para confirmação no chat. Não executa: aguarda clique do usuário. Conta selecionada apenas.', { origem: { type: 'string', enum: ['BLING', 'MERCADO_LIVRE'] } }),
  tool('preparar_vinculo', 'Prepara vínculo por SKU exato de anúncio MLB com variação Bling da conta selecionada. Só permite SKU já presente no anúncio. Aguarda confirmação no chat.', { mlb: text, sku: text }),
  tool('consultar_contas_ml', 'Lista os vendedores Mercado Livre da conta selecionada, sem credenciais.', {}),
  tool('consultar_anuncio_ml', 'Consulta ao vivo preço, estoque, descrição, atributos, fotos e IDs de variações de um MLB da conta selecionada. Use antes de preparar alterações.', { mlb: text }),
  tool('consultar_categoria_ml', 'Consulta regras e atributos obrigatórios ou de variações de uma categoria MLB para preparar uma publicação.', { categoria_id: text }),
  tool('preparar_alteracoes_ml', 'Prepara alterações de 1 a 20 MLBs explícitos, com prévia e confirmação. Permite preço em reais, estoque, active/paused, título, descrição completa, fotos completas e atributos. Use null nos campos não solicitados. Nunca muda nada ao preparar. Em anúncios tradicionais o preço é compartilhado por todas as variações. Estoque exige variacao_id quando houver variações. Não invente valores nem selecione anúncios não solicitados.', {
    alteracoes: { type: 'array', minItems: 1, maxItems: 20, items: update }
  }),
  tool('preparar_variacoes_ml', 'Prepara adição ou edição de variações de um anúncio tradicional. Preserva todas as variações não mencionadas; não remove variações. Use id null para adicionar. Use IDs de fotos existentes e os atributos completos de cor/tamanho. O servidor detecta User Products e encaminha adições para a família existente, sem publicar anúncios; a prévia explica que preço e estoque não são alterados nesse formato. Aguarda confirmação.', {
    mlb: text, variacoes: { type: 'array', minItems: 1, maxItems: 20, items: object({ id: nullable(text), sku: text, estoque: { type: 'integer', minimum: 0 }, atributos: attributes, fotos: photos }) }
  }),
  tool('preparar_publicacao_ml', 'Prepara um novo anúncio de um produto usando um MLB existente como modelo, na mesma conta e categoria. Herda fotos, condição, tipo e atributos que não forem informados. Exige título/nome, preço, estoque e SKU explícitos. Consulte o modelo e as regras da categoria antes. Novas cores/tamanhos em User Products usam os novos atributos. Valida na API sem publicar. A confirmação publica e pode gerar tarifas. Não invente informações do produto.', {
    modelo_mlb: text, titulo: text, preco: nullable({ type: 'number', exclusiveMinimum: 0 }), usar_preco_modelo: { type: 'boolean', description: 'true somente quando o usuário pediu preço igual ao anúncio/variação existente. Nesse caso, preco deve ser null e o servidor consulta o preço atual do modelo, sem pedir o valor numérico novamente. false exige preco explícito.' }, estoque: { type: 'integer', minimum: 0 }, sku: text,
    descricao: nullable(text), fotos: nullable(photos), atributos: nullable(attributes)
  })
];



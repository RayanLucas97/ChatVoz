# Chat de Voz — contas, amigos, voz, chat de texto e compartilhamento de tela

Agora o app tem **cadastro e login**. Depois de entrar você vê uma tela de amigos (parecida com a do Discord):
barra de servidores, lista de amigos com status, abas **Disponível / Todos / Pendentes / Adicionar amigo** e o painel
**Ativo agora**, que mostra quais amigos estão em uma sala de voz e deixa você entrar junto com um clique.

O projeto tem 2 arquivos que importam: **`server.js`** (contas, amigos, presença) e **`index.html`** (o app).
Não precisa instalar nada além do **Node.js 18 ou mais novo** (https://nodejs.org).

## 1. Rodar no seu computador

```
node server.js
```

Abra **http://localhost:3000**, clique em **Registre-se** e crie sua conta. Para testar com amigos na mesma
máquina, abra uma janela anônima e crie uma segunda conta. Permita o microfone quando o navegador pedir.

Precisa de internet: a página baixa o PeerJS (biblioteca de voz) de um CDN.
Quer funcionar mesmo se esses CDNs estiverem bloqueados? Baixe `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js`,
salve como `peerjs.min.js` na mesma pasta do `index.html` e o servidor passa a entregá-lo primeiro.

> Abrir o `index.html` com dois cliques **não funciona mais**: o login precisa do `server.js`.

## 2. Colocar online para os amigos

Seus amigos precisam de um endereço **https** que rode o `server.js`. Hospedagens estáticas (Netlify Drop, GitHub Pages)
**não servem mais**, porque não executam Node. Use uma que rode Node: Render, Railway, Fly.io ou um VPS (confira os
planos gratuitos atuais de cada uma). Em qualquer uma:

- Comando de início: `node server.js` (ou `npm start`).
- Variável `TRUST_PROXY=1` (a hospedagem fica na frente do app; sem isso o limite de tentativas de login não enxerga o IP certo).
- **Guarde os dados em disco persistente.** As contas ficam em `data/db.json`. Se a hospedagem apaga o disco a cada
  reinício (comum em planos gratuitos), todas as contas somem. Crie um volume/disco persistente e aponte
  `DATA_DIR=/caminho/do/disco`. Faça cópia desse arquivo de vez em quando.
- A porta vem da variável `PORT` (a hospedagem costuma definir sozinha).

## Contas e amigos

- **Cadastro:** nome de usuário (3 a 20 caracteres: letras minúsculas, números, `_` e `.`), nome de exibição e senha
  (mínimo 8 caracteres). O nome de usuário é como os amigos te encontram; o de exibição é o que aparece na sala.
- **Senha:** guardada com hash scrypt e sal individual, nunca em texto. A sessão fica em cookie `HttpOnly`
  por 30 dias; **Sair da conta** fica na engrenagem, no canto inferior esquerdo.
- **Proteções:** 10 senhas erradas seguidas para o mesmo usuário e endereço bloqueiam por 10 minutos; o cadastro
  é limitado por endereço; pedidos de outros sites são recusados.
- **Amigos:** em **Adicionar amigo**, digite o nome de usuário. A pessoa aceita em **Pendentes**.
  Se vocês se adicionarem ao mesmo tempo, a amizade é aceita na hora. O **⋮** remove um amigo.
- **Online / em voz:** o app avisa o servidor a cada 20 segundos. Quem está numa sala aparece em **Ativo agora**
  (e com "Em voz · nome da sala" na lista). Só seus amigos veem onde você está.
- **Seus servidores** agora ficam na **conta**, não no navegador: aparecem em qualquer aparelho em que você entrar.
- **Sala rápida** (menu lateral): cria uma sala avulsa ou entra por código, como antes.
- **Links de convite** continuam funcionando; quem abre sem ter conta vê o aviso e, depois de entrar, o servidor ou a
  sala já aparece.

## Se esqueceu a senha

Ainda não existe recuperação de senha (não há e-mail no sistema). Quem administra o servidor pode apagar a conta
em `data/db.json` para a pessoa se cadastrar de novo.

## Servidores com várias salas

Na tela inicial, **Criar servidor** monta um servidor seu (nome, ícone e quantas salas de voz quiser, até 12). Ao entrar nele você vê a lista de salas e **escolhe em qual entrar**: nada abre sozinho.

- **Editar** (só o dono): renomear, trocar o ícone, criar e apagar salas. Depois de salvar, copie o convite de novo.
- **Copiar convite**: o link leva o servidor inteiro. Quem abre o link digita o nome e vê o servidor na lista.
- Quem abre um convite mais novo recebe as mudanças; o servidor fica guardado no navegador de cada pessoa.
- A primeira pessoa a entrar numa sala cria a conexão; quem chega depois entra nela. Se quem abriu a sala sair, novos visitantes não encontram quem já estava lá até todos saírem e entrarem de novo.
- Os servidores ficam salvos na sua conta (arquivo `data/db.json` do servidor), então limpar o navegador não apaga a lista.

## O que tem na sala

- Voz entre todos, com indicador verde de quem está falando e botão de mudo.
- **Volume de cada pessoa**: ao lado do nome há um botão 🔈/🔉/🔊 (silenciar só para você) e uma barra de 0% a 200%. Clique duas vezes na barra para voltar a 100%. Só você ouve a mudança; os outros não são afetados.
- Chat de texto na mesma tela (no celular, pelo botão 💬). Quem entra depois vê as últimas mensagens.
- Compartilhar tela: pelo computador (Chrome, Edge ou Firefox atualizados). Navegadores de celular normalmente não permitem **enviar** a tela, mas no celular dá para **ver** a tela dos outros (botão ⛶ para tela cheia; se o som estiver bloqueado, toque em "Ativar som").
- Se o compartilhamento não iniciar, o app mostra o motivo. No Mac, libere "Gravação de Tela" para o navegador em Ajustes > Privacidade e Segurança e reabra o navegador.
- Para compartilhar o som, marque "Compartilhar áudio" na janela do navegador (aparece ao escolher uma aba; no Windows também ao escolher a tela inteira).
- **Compartilhar câmera** (celular ou computador): no celular você escolhe frontal ou traseira e pode trocar ao vivo no botão 🔄 (aparece quando o aparelho tem mais de uma câmera). Tela e câmera funcionam **uma de cada vez**: ao iniciar uma, a outra é trocada.
- Se não houver microfone ou ele for negado, dá para entrar só ouvindo e usando o chat.

## No celular

- A mesma página funciona no celular (Chrome, Safari etc.): voz, chat de texto e ver a tela dos outros.
- A tela do celular fica ligada enquanto você está na sala (para a chamada não cair).
- **Enviar a tela do celular não é possível pelo navegador.** Chrome, Safari, Firefox e Samsung Internet
  de celular não oferecem esse recurso (dado da base de compatibilidade da MDN). Ao tocar em compartilhar,
  o app oferece **compartilhar a câmera** (traseira ou frontal) e mostra como espelhar o celular no computador
  (Android: scrcpy ou "Projetar neste PC" do Windows; iPhone: AirPlay para um Mac ou QuickTime com cabo)
  para então compartilhar a janela do computador na sala.
- Para enviar a tela do celular direto, só um aplicativo nativo (Android/iPhone) consegue — é um projeto à parte.

## Se alguém não consegue entrar na sala

1. Quem criou a sala precisa estar com a página **aberta e na frente**. No celular, se você sair do navegador para
   mandar o código no WhatsApp e demorar, a conexão cai e a sala some para quem tenta entrar. Dica: copie o link,
   volte ao chat e só então envie, ou envie de outro aparelho.
2. Abra o link no Chrome ou Safari, não dentro do Instagram/Facebook/TikTok (o app avisa quando detecta isso).
3. Ao entrar, o app mostra "Conectando à sala…" e só abre a sala quando conecta de verdade. Se não conseguir em
   20 segundos, explica o motivo; o texto entre colchetes (ex.: `[conexão: failed]`) ajuda a achar a causa.
4. Entre pessoas em redes diferentes (4G e wi-fi) a conexão precisa de um servidor de retransmissão (TURN).
   O app usa o TURN público e gratuito do PeerJS, que é compartilhado e pode falhar em horários de pico.
   Para uso frequente, crie um TURN gratuito seu (há opções com plano gratuito, como Metered e Cloudflare;
   confira os planos atuais) e acrescente os dados na lista `ICE_SERVERS` no começo do script do `index.html`.

## Limitações

- Cada sala aceita até **15 pessoas** (quem criou conta como 1); a 16ª pessoa vê "Sala cheia".
- Cada pessoa se conecta direto com todas as outras (14 conexões no máximo), então a voz com 15 depende de internet e computador razoáveis; em celulares mais fracos pode ficar pesado.
- Ao compartilhar tela, quem compartilha envia o vídeo para todos. Com muita gente a qualidade cai automaticamente para caber na internet de quem compartilha.
- Quem criou a sala precisa estar online para novos amigos entrarem; quem já está lá continua conversando se o criador sair.
- O chat não é salvo: as mensagens somem quando todos saem da sala.
- Em redes muito restritas (algumas operadoras e empresas) pode ser preciso um TURN próprio — veja "Se alguém não consegue entrar na sala".
- Usa o servidor gratuito público do PeerJS, que pode ficar instável em horários de pico.
- A sala de voz abre em tela cheia: enquanto você está nela não vê a lista de amigos. Ao sair, volta para a tela inicial.
- Ainda não há mensagens diretas entre amigos; o chat de texto é o da sala de voz.
- Entrar na sala de um amigo só funciona se quem abriu a sala ainda estiver nela (limitação da conexão direta, veja acima).

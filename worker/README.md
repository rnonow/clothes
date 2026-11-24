# 商品ページ読み取りサーバー(Cloudflare Workers)

アプリの「URLから取り込む」で使う小さなサーバーです。Cloudflare の無料枠(1日10万回まで)で動きます。

## 設定手順(はじめの1回だけ、5分ほど)

1. https://dash.cloudflare.com/sign-up で無料アカウントを作る
2. 左メニューの「Compute (Workers)」→「Workers & Pages」→「作成」→「Hello World から開始」
3. 名前を `closet-reader` にして「デプロイ」
4. 「コードを編集」を開き、中身をすべて消して [worker.js](worker.js) の内容を貼り付け、「デプロイ」
5. 表示された URL(`https://closet-reader.<あなたの名前>.workers.dev`)をコピー
6. アプリの設定タブ →「URLから取り込み」に貼り付けて「保存」

## 仕組み

- `GET /?url=<商品ページ>` … ページ内の商品情報(schema.org の Product、OGP タグ)から名前・ブランド・画像・価格・色を返す
- `GET /img?url=<画像>` … 商品画像を中継(アプリ側で縮小して保存するため)
- アプリ(https://rnonow.github.io)以外からの利用は拒否します

ログインが必要なページや、ボット対策の強いサイトは読み取れないことがあります。その場合はアプリで手入力してください。
